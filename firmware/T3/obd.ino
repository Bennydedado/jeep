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
    // the ESP32 has one radio: a Bluetooth scan while Wi-Fi is looking or joining can make it miss the
    // network's answers (handshake timeouts), so the iCar search waits until Wi-Fi is done
    if (wifiState == W_SCAN || wifiState == W_JOIN || otaMode) return;
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
static uint8_t pidMiss[256];   // "NO DATA" answers in a row for each PID
static uint32_t pidMissClear = 0;
// a PID counts as missing (not asked for any more) after 3 "NO DATA" in a row: one miss while cranking or a
// busy bus mustn't blank boost or speed for the whole drive. Everything gets another chance every 2 minutes.
static bool pidMissing(int pid) { return pidMiss[pid & 0xFF] >= 3; }
// what the engine computer says it offers (answers to 0100, 0120...): only those are asked for
static ObdSupport obdSup;
static int supNext = -1, mapPid = -1;
static String obdProto;
static bool pidOk(int pid) { return !pidMissing(pid) && (!obdSup.known || obdSup.has(pid)); }
// where boost comes from: intake pressure (PID 0B) on most engines; some diesels only offer PID 87 or PID 70
static int boostPid() {
  if (pidOk(0x0B)) return 0x0B;
  if (obdSup.known && obdSup.has(0x87) && !pidMissing(0x87)) return 0x87;
  if (obdSup.known && obdSup.has(0x70) && !pidMissing(0x70)) return 0x70;
  return -1;
}
// for Diagnostics: what the engine offers and where boost comes from
String obdDiagJson() {
  char sup[200]; obdSup.list(sup, sizeof(sup));
  String miss;
  for (int p = 1; p < 0xA0; p++) if (pidMissing(p)) { char b[4]; snprintf(b, sizeof(b), "%02X", p); miss += (miss.length() ? " " : "") + String(b); }
  int bp = boostPid();
  char bps[4]; snprintf(bps, sizeof(bps), "%02X", bp < 0 ? 0 : bp);
  return "\"obd\":{\"proto\":\"" + jsonEsc(obdProto) + "\",\"known\":" + String(obdSup.known ? 1 : 0) + ",\"sup\":\"" + String(sup) + "\",\"boost\":\"" +
         (bp < 0 ? String("-") : String(bps)) + "\",\"map\":" + num(car.mapKpa >= 0 ? car.mapKpa : NAN, 1) + ",\"baro\":" + num(car.baro > 0 ? car.baro : NAN, 0) +
         ",\"miss\":\"" + miss + "\"}";
}

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
  if (obdCmd == "ATDPN") { obdProto = r.substring(0, 6); return; }
  if (!obdCmd.startsWith("01")) return;
  int pid = (int)strtol(obdCmd.substring(2, 4).c_str(), nullptr, 16);
  if (pid % 32 == 0) { int nx = obdSup.feed(r.c_str(), pid); if (nx > 0) supNext = nx; return; }   // which values it offers
  uint8_t b[9];
  int n = obdBytes(r.c_str(), pid, b, 9);
  if (!n) { if ((r.indexOf("NODATA") >= 0 || r.indexOf("?") >= 0) && pidMiss[pid] < 255) pidMiss[pid]++; return; }
  pidMiss[pid] = 0;
  int A = b[0], B = n > 1 ? b[1] : 0;
  switch (pid) {
    case 0x0D: car.kmh = A; break;
    case 0x0C: car.rpm = (256 * A + B) / 4.0; break;
    case 0x04: car.load = A * 100.0 / 255; break;
    case 0x05: car.ect = A - 40; break;
    case 0x0F: car.iat = A - 40; break;
    case 0x0B: case 0x87: case 0x70: { float k = obdMapKpa(pid, b, n); if (k >= 0) { car.mapKpa = k; mapPid = pid; } break; }
    case 0x33: car.baro = A; break;
    case 0x5E: car.lph = (256 * A + B) / 20.0; break;
  }
}
void obdStep() {
  obdConnectStep();
  // a link that died between connecting and attaching, or an adapter that went silent: start over
  if (obdLinked && obdClient && (!obdClient->isConnected() || (obdStage >= 9 && car.at && millis() - car.at > 20000))) {
    if (obdClient->isConnected()) obdClient->disconnect();
    obdLinked = false;
  }
  if (!obdLinked) { obdStage = 0; obdBusy = false; supNext = -1; memset(pidMiss, 0, sizeof(pidMiss)); return; }
  if (millis() - pidMissClear > 120000) { pidMissClear = millis(); memset(pidMiss, 0, sizeof(pidMiss)); }
  char ch;
  while (xQueueReceive(obdQueue, &ch, 0) == pdTRUE) {
    obdBuf += ch;
    if (ch == '>') { String r = obdBuf; obdBusy = false; obdAnswer(r); }
  }
  if (obdBusy && millis() - obdSentAt > obdTimeout) obdBusy = false;
  if (obdBusy) return;
  // set the adapter up, ask which values the engine offers (0100), and which protocol it found (ATDPN)
  const char* setup[] = { "ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0", "0100", "ATDPN" };
  if (obdStage < 9) { if (obdStage == 0) obdSup = ObdSupport(); obdSendCmdT(setup[obdStage], obdStage == 0 ? 2500 : obdStage == 7 ? 9000 : 1500); obdStage++; return; }
  if (supNext > 0) { char c[6]; snprintf(c, sizeof(c), "01%02X", supNext); supNext = -1; obdSendCmd(c); return; }   // the next block of offered values
  // speed, RPM and boost all the time; the rest now and then; only what the engine offers
  const int fast[] = { 0x0D, 0x0C, boostPid(), 0x04 };
  static const int slow[] = { 0x05, 0x0F, 0x33, 0x5E, -1 };
  int k = pollIdx++ % 12;
  int pid = k < 10 ? fast[k % 4] : slow[(pollIdx / 12) % 5];
  if (k >= 10 && pid == -1) { obdSendCmd("ATRV"); return; }
  if (pid < 0 || !pidOk(pid)) pid = fast[k % 2];
  char c[6]; snprintf(c, sizeof(c), "01%02X", pid);
  obdSendCmd(c);
}

// fuel right now, litres per hour: the ECU's own number if it has one, otherwise worked out from load and RPM
// (a 2.8 CRD makes about 400 Nm; diesel burns about 240 g per kWh). Heep's fuel correction trims it.
float fuelNow() {
  if (car.rpm <= 0) return 0;
  if (pidOk(0x5E) && car.lph >= 0) return car.lph * cfg.fuelCal;
  float load = car.load < 0 ? 20 : car.load;
  float lph = load / 100.0 * car.rpm * 0.0105;
  if (lph < 0.6) lph = 0.6;
  return lph * cfg.fuelCal;
}
float boostPsi() { if (car.mapKpa < 0 || millis() - car.at > 5000) return -1; float b = (car.mapKpa - (car.baro > 0 ? car.baro : 101)) * 0.145038; return b < 0 ? 0 : b; }
