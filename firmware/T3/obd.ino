// obd.ino - the Vgate iCar Pro (Bluetooth LE OBD adapter, ELM327 commands): the T3 is its client.
// It scans for the adapter, connects without stopping the loop, then asks for one engine value at a time.

static NimBLEAddress obdAddr;
static bool obdFound = false;
static volatile bool obdConnected = false;
static NimBLEClient* obdClient = nullptr;
static NimBLERemoteCharacteristic* obdWrite = nullptr;
static bool obdWriteResp = false;
static QueueHandle_t obdQueue;   // bytes the iCar sent
static uint32_t lastScan = 0, connectAt = 0;
static bool connecting = false;

bool looksLikeObd(const NimBLEAdvertisedDevice* d) {
  String n = String(d->getName().c_str());
  n.toLowerCase();
  if (n.length() == 0 || n.startsWith("jeep")) return false;
  if (cfg.obdName.length()) { String want = cfg.obdName; want.toLowerCase(); return n.indexOf(want) >= 0; }
  const char* names[] = { "vlink", "v-link", "icar", "vgate", "obd", "elm", "vlinker", "ios-vlink" };
  for (auto k : names) if (n.indexOf(k) >= 0) return true;
  return false;
}
class ScanCB : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* d) override {
    if (!obdFound && looksLikeObd(d)) { obdAddr = d->getAddress(); obdFound = true; NimBLEDevice::getScan()->stop(); }
  }
};
class ObdClientCB : public NimBLEClientCallbacks {
  void onConnect(NimBLEClient*) override { obdConnected = true; }
  void onConnectFail(NimBLEClient*, int) override { obdConnected = false; connecting = false; }
  void onDisconnect(NimBLEClient*, int) override { obdConnected = false; obdLinked = false; connecting = false; }
};
static ScanCB scanCB;
static ObdClientCB obdCB;

void obdNotify(NimBLERemoteCharacteristic*, uint8_t* data, size_t len, bool) {
  for (size_t i = 0; i < len; i++) { char ch = (char)data[i]; xQueueSend(obdQueue, &ch, 0); }
}
// the service and characteristics the common BLE OBD adapters use
bool obdAttach() {
  struct Try { const char *svc, *rx, *tx; };
  const Try tries[] = {
    { "0000fff0-0000-1000-8000-00805f9b34fb", "0000fff1-0000-1000-8000-00805f9b34fb", "0000fff2-0000-1000-8000-00805f9b34fb" },  // iCar Pro / IOS-Vlink
    { "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f", "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f" },  // vLinker
    { "0000ffe0-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb", "0000ffe1-0000-1000-8000-00805f9b34fb" },  // clones
    { "000018f0-0000-1000-8000-00805f9b34fb", "00002af0-0000-1000-8000-00805f9b34fb", "00002af1-0000-1000-8000-00805f9b34fb" },  // clones
  };
  for (auto& t : tries) {
    NimBLERemoteService* svc = obdClient->getService(t.svc);
    if (!svc) continue;
    NimBLERemoteCharacteristic* rx = svc->getCharacteristic(t.rx);
    NimBLERemoteCharacteristic* tx = svc->getCharacteristic(t.tx);
    if (!rx || !tx) continue;
    bool ok = false;
    if (rx->canNotify()) ok = rx->subscribe(true, obdNotify);
    else if (rx->canIndicate()) ok = rx->subscribe(false, obdNotify);
    if (!ok) continue;
    obdWrite = tx;
    obdWriteResp = !tx->canWriteNoResponse();
    return true;
  }
  return false;
}

void obdBegin() {
  obdQueue = xQueueCreate(512, 1);
  NimBLEScan* sc = NimBLEDevice::getScan();
  sc->setScanCallbacks(&scanCB, false);
  sc->setActiveScan(true);
  sc->setInterval(100); sc->setWindow(60);
}

void obdConnectStep() {
  if (obdLinked) return;
  uint32_t now = millis();
  if (connecting) {
    if (obdConnected) {
      connecting = false;
      if (obdAttach()) { obdLinked = true; sdEvent("iCar connected"); }
      else obdClient->disconnect();
    } else if (now - connectAt > 8000) { connecting = false; if (obdClient) obdClient->disconnect(); }
    return;
  }
  if (!obdFound) {
    if (NimBLEDevice::getScan()->isScanning() || now - lastScan < 8000) return;
    lastScan = now;
    NimBLEDevice::getScan()->start(2000, false);   // runs by itself for 2 s; stops early when the iCar shows up
    return;
  }
  if (!obdClient) { obdClient = NimBLEDevice::createClient(); obdClient->setClientCallbacks(&obdCB, false); obdClient->setConnectTimeout(6000); }
  obdFound = false;
  obdConnected = false;
  connecting = true; connectAt = now;
  if (!obdClient->connect(obdAddr, true, true)) connecting = false;   // async: onConnect tells us
}

// ---------------------------------------------------------------- ELM327 commands, one at a time
static String obdBuf, obdCmd;
static bool obdBusy = false;
static uint32_t obdSentAt = 0, obdTimeout = 1500;
static int obdStage = 0;   // 0 = reset the adapter, then set it up, then ask for engine values
static int pollIdx = 0;
static bool pidMissing[256];

void obdSendCmdT(const String& cmd, uint32_t timeout) {
  if (!obdWrite) return;
  String c = cmd + "\r";
  obdWrite->writeValue((const uint8_t*)c.c_str(), c.length(), obdWriteResp);
  obdCmd = cmd; obdBusy = true; obdSentAt = millis(); obdTimeout = timeout; obdBuf = "";
}
void obdSendCmd(const String& cmd) { obdSendCmdT(cmd, 1500); }
int hexByte(const String& s, int at) { return (int)strtol(s.substring(at, at + 2).c_str(), nullptr, 16); }
void obdAnswer(String r) {
  r.replace(" ", ""); r.replace("\r", ""); r.replace("\n", ""); r.replace(">", ""); r.toUpperCase();
  car.at = millis();
  if (obdCmd == "ATRV") { car.volts = r.toFloat(); return; }
  if (!obdCmd.startsWith("01")) return;
  int pid = (int)strtol(obdCmd.substring(2, 4).c_str(), nullptr, 16);
  String want = "41" + obdCmd.substring(2, 4);
  int i = r.indexOf(want);
  if (i < 0) { if (r.indexOf("NODATA") >= 0 || r.indexOf("?") >= 0) pidMissing[pid] = true; return; }
  i += 4;
  int A = r.length() >= (unsigned)i + 2 ? hexByte(r, i) : 0, B = r.length() >= (unsigned)i + 4 ? hexByte(r, i + 2) : 0;
  switch (pid) {
    case 0x0D: car.kmh = A; break;
    case 0x0C: car.rpm = (256 * A + B) / 4.0; break;
    case 0x04: car.load = A * 100.0 / 255; break;
    case 0x05: car.ect = A - 40; break;
    case 0x0F: car.iat = A - 40; break;
    case 0x0B: car.mapKpa = A; break;
    case 0x33: car.baro = A; break;
    case 0x5E: car.lph = (256 * A + B) / 20.0; break;
  }
}
void obdStep() {
  obdConnectStep();
  if (!obdLinked) { obdStage = 0; obdBusy = false; return; }
  char ch;
  while (xQueueReceive(obdQueue, &ch, 0) == pdTRUE) {
    obdBuf += ch;
    if (ch == '>') { String r = obdBuf; obdBusy = false; obdAnswer(r); }
  }
  if (obdBusy && millis() - obdSentAt > obdTimeout) obdBusy = false;
  if (obdBusy) return;
  const char* setup[] = { "ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0", "0100" };
  if (obdStage < 8) { obdSendCmdT(setup[obdStage], obdStage == 0 ? 2500 : obdStage == 7 ? 9000 : 1500); obdStage++; return; }
  // speed, RPM and boost (MAP) all the time; the rest now and then
  static const int fast[] = { 0x0D, 0x0C, 0x0B, 0x04 };
  static const int slow[] = { 0x05, 0x0F, 0x33, 0x5E, -1 };
  int k = pollIdx++ % 12;
  int pid = k < 10 ? fast[k % 4] : slow[(pollIdx / 12) % 5];
  if (pid == -1) { obdSendCmd("ATRV"); return; }
  if (pidMissing[pid]) pid = fast[k % 2];
  char c[6]; snprintf(c, sizeof(c), "01%02X", pid);
  obdSendCmd(c);
}

// fuel right now, litres per hour: the ECU's own number if it has one, otherwise worked out from load and RPM
// (a 2.8 CRD makes about 400 Nm; diesel burns about 240 g per kWh). Heep's fuel correction trims it.
float fuelNow() {
  if (car.rpm <= 0) return 0;
  if (!pidMissing[0x5E] && car.lph >= 0) return car.lph * cfg.fuelCal;
  float load = car.load < 0 ? 20 : car.load;
  float lph = load / 100.0 * car.rpm * 0.0105;
  if (lph < 0.6) lph = 0.6;
  return lph * cfg.fuelCal;
}
float boostPsi() { if (car.mapKpa < 0 || millis() - car.at > 5000) return -1; float b = (car.mapKpa - (car.baro > 0 ? car.baro : 101)) * 0.145038; return b < 0 ? 0 : b; }
