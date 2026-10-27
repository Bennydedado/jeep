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
static float baroLearned = -1;                  // outside air pressure learned from intake pressure (obdpid.h learnBaro)
static String obdProto;
static uint32_t obdHeardAt = 0, supAskAt = 0;   // the adapter answered anything / when 0100 was last asked
static bool askProto = false;
static String raw0100, raw0C, raw0B;           // the engine's last answers, word for word (Diagnostics)
static bool scanOn = false;                     // "Scan the Jeep" is running (further down)
static void scanAnswer(const String& r);
static void scanStep();
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
  return "\"obd\":{\"proto\":\"" + jsonEsc(obdProto) + "\",\"known\":" + String(obdSup.known ? 1 : 0) +
         ",\"raw\":{\"0100\":\"" + jsonEsc(raw0100) + "\",\"0C\":\"" + jsonEsc(raw0C) + "\",\"0B\":\"" + jsonEsc(raw0B) + "\"}" +
         ",\"data\":" + String(car.at && millis() - car.at < 5000 ? 1 : 0) + ",\"sup\":\"" + String(sup) + "\",\"boost\":\"" +
         (bp < 0 ? String("-") : String(bps)) + "\",\"map\":" + num(car.mapKpa >= 0 ? car.mapKpa : NAN, 1) + ",\"baro\":" + num(baroNow(), 1) +
         ",\"baroSrc\":\"" + String(car.baro > 0 && pidOk(0x33) ? "ecu" : baroLearned > 0 ? "learned" : "assumed") + "\"" +
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
  obdHeardAt = millis();                 // the adapter is alive (car.at only moves when the engine itself answers)
  if (scanOn) { scanAnswer(r); return; }
  if (obdCmd == "ATRV") { car.volts = r.toFloat(); return; }
  if (obdCmd == "ATDPN") { obdProto = r.substring(0, 6); return; }
  if (!obdCmd.startsWith("01")) return;
  int pid = (int)strtol(obdCmd.substring(2, 4).c_str(), nullptr, 16);
  if (pid == 0x00) raw0100 = r.substring(0, 40); else if (pid == 0x0C) raw0C = r.substring(0, 24); else if (pid == 0x0B) raw0B = r.substring(0, 24);
  if (pid % 32 == 0) {                   // which values it offers
    bool was = obdSup.known;
    int nx = obdSup.feed(r.c_str(), pid);
    if (nx > 0) supNext = nx;
    if (!was && obdSup.known) { car.at = millis(); memset(pidMiss, 0, sizeof(pidMiss)); askProto = true; }   // the engine just woke up: start fresh
    return;
  }
  uint8_t b[9];
  int n = obdBytes(r.c_str(), pid, b, 9);
  if (!n) { if ((r.indexOf("NODATA") >= 0 || r.indexOf("?") >= 0) && pidMiss[pid] < 255) pidMiss[pid]++; return; }
  car.at = millis();
  pidMiss[pid] = 0;
  int A = b[0], B = n > 1 ? b[1] : 0;
  switch (pid) {
    case 0x0D: car.kmh = A; break;
    case 0x0C: car.rpm = (256 * A + B) / 4.0; break;
    case 0x04: car.load = A * 100.0 / 255; break;
    case 0x05: car.ect = A - 40; break;
    case 0x0F: car.iat = A - 40; break;
    case 0x0B: case 0x87: case 0x70: {
      float k = obdMapKpa(pid, b, n);
      if (k >= 0) { car.mapKpa = k; mapPid = pid; if (!pidOk(0x33)) baroLearned = learnBaro(baroLearned, k, car.rpm, car.kmh, car.load); }
      break;
    }
    case 0x10: car.maf = (256 * A + B) / 100.0; break;
    case 0x23: car.rail = (256 * A + B) * 10.0; break;
    case 0x33: car.baro = A; break;
    case 0x5E: car.lph = (256 * A + B) / 20.0; break;
  }
}
void obdStep() {
  obdConnectStep();
  // a link that died between connecting and attaching, or an adapter that went silent: start over
  if (obdLinked && obdClient && (!obdClient->isConnected() || (obdStage >= 9 && obdHeardAt && millis() - obdHeardAt > 20000))) {
    if (obdClient->isConnected()) obdClient->disconnect();
    obdLinked = false;
  }
  if (!obdLinked) { obdStage = 0; obdBusy = false; supNext = -1; obdHeardAt = 0; memset(pidMiss, 0, sizeof(pidMiss)); return; }
  if (millis() - pidMissClear > 120000) { pidMissClear = millis(); memset(pidMiss, 0, sizeof(pidMiss)); }
  char ch;
  while (xQueueReceive(obdQueue, &ch, 0) == pdTRUE) {
    obdBuf += ch;
    if (ch == '>') { String r = obdBuf; obdBusy = false; obdAnswer(r); }
  }
  if (obdBusy && millis() - obdSentAt > obdTimeout) obdBusy = false;
  if (obdBusy) return;
  if (scanOn) { scanStep(); return; }
  // set the adapter up (protocol: setting "opr", 0 = auto), ask which values the engine offers (0100), and which protocol it found
  const char* setup[] = { "ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0", "0100", "ATDPN" };
  if (obdStage < 9) {
    if (obdStage == 0) obdSup = ObdSupport();
    String c = setup[obdStage];
    if (obdStage == 6) c = "ATSP" + String(constrain(cfg.obdProto, 0, 9));
    obdSendCmdT(c, obdStage == 0 ? 2500 : obdStage == 7 ? 9000 : 1500);
    obdStage++;
    return;
  }
  if (obdStage == 9) { obdStage++; supAskAt = millis(); }
  if (supNext > 0) { char c[6]; snprintf(c, sizeof(c), "01%02X", supNext); supNext = -1; obdSendCmd(c); return; }   // the next block of offered values
  if (askProto) { askProto = false; obdSendCmd("ATDPN"); return; }
  // the engine hasn't answered 0100 yet (key off when the iCar connected): ask again every 20 s, so it's found as soon as
  // the key goes on, instead of waiting for a reconnect
  if (!obdSup.known && millis() - supAskAt > 20000) { supAskAt = millis(); obdSendCmdT("0100", 9000); return; }
  // speed, RPM and boost all the time; the rest now and then; only what the engine offers
  const int fast[] = { 0x0D, 0x0C, boostPid(), 0x04 };
  static const int slow[] = { 0x05, 0x0F, 0x10, 0x23, 0x33, 0x5E, -1 };
  static int slowIdx = 0;
  int k = pollIdx++ % 12;
  int pid = fast[k % 4];
  if (k >= 10) {   // the next slow value the engine offers (battery voltage from the adapter in between)
    pid = -1;
    for (int t = 0; t < 7 && pid < 0; t++) { int c = slow[slowIdx++ % 7]; if (c == -1) { obdSendCmd("ATRV"); return; } if (pidOk(c)) pid = c; }
  }
  if (pid < 0 || !pidOk(pid)) pid = fast[k % 2];
  char c[6]; snprintf(c, sizeof(c), "01%02X", pid);
  obdSendCmd(c);
}

// ---------------------------------------------------------------- "Scan the Jeep" (Heep: Diagnostics)
// A Jeep can have more than one computer on the diagnostic port, on different wires: the 2006 CRD's diesel computer
// (Bosch) and the Chrysler side can answer on different protocols, and "auto" stops at the first that answers.
// The scan tries each protocol in turn with headers on (so the answer shows WHICH computer replied), asks what it
// offers (0100/0120/0140), and sends each result to Heep: {"t":"obdscan","p":"5","a":"<0100>","b":"<0120>","c":"<0140>","d":"<ATDPN>"}.
// Afterwards the adapter is set up again from scratch with the chosen protocol (setting "opr", 0 = auto).
static const char SCAN_PROTOS[] = "254316";   // J1850 VPW, KWP2000 fast, KWP2000 5-baud, ISO 9141-2, J1850 PWM, CAN 11-bit 500k
static int scanI = 0, scanS = 0;
static String scanA, scanB, scanC, scanD;
static int scanSrc = 0;
void obdScanStart(int src) {
  if (!obdLinked) { reply("{\"t\":\"obdscan\",\"error\":\"the iCar isn't connected\"}", src); return; }
  scanOn = true; scanI = 0; scanS = 0; scanSrc = src; obdBusy = false;
  scanA = scanB = scanC = scanD = "";
  sdEvent("obd scan started");
  reply("{\"t\":\"obdscan\",\"start\":true,\"n\":" + String(strlen(SCAN_PROTOS)) + "}", src);
}
static void scanAnswer(const String& r) {
  String x = r.substring(0, 160);
  if (obdCmd == "0100") scanA = x; else if (obdCmd == "0120") scanB = x; else if (obdCmd == "0140") scanC = x; else if (obdCmd == "ATDPN") scanD = x.substring(0, 6);
}
static void scanStep() {
  char p = SCAN_PROTOS[scanI];
  bool answered = scanA.indexOf("4100") >= 0;
  switch (scanS++) {
    case 0: scanA = scanB = scanC = scanD = ""; obdSendCmdT(String("ATSP") + p, 2000); return;
    case 1: obdSendCmdT("ATH1", 1000); return;
    case 2: obdSendCmdT("0100", 10000); return;
    case 3: if (answered) { obdSendCmdT("0120", 5000); return; } scanS = 5; scanStep(); return;
    case 4: obdSendCmdT("0140", 5000); return;
    case 5: obdSendCmdT("ATDPN", 1000); return;
    default: {
      String m = "{\"t\":\"obdscan\",\"i\":" + String(scanI) + ",\"n\":" + String(strlen(SCAN_PROTOS)) + ",\"p\":\"" + String(p) +
                 "\",\"a\":\"" + jsonEsc(scanA) + "\",\"b\":\"" + jsonEsc(scanB) + "\",\"c\":\"" + jsonEsc(scanC) + "\",\"d\":\"" + jsonEsc(scanD) + "\"}";
      reply(m, scanSrc);
      sdEvent("obd scan " + String(p) + ": " + scanA.substring(0, 60));
      scanI++; scanS = 0;
      if (scanI >= (int)strlen(SCAN_PROTOS)) {
        scanOn = false;
        reply("{\"t\":\"obdscan\",\"done\":true}", scanSrc);
        obdRestart();   // set the adapter up again (headers off, your protocol setting)
      }
    }
  }
}
void obdRestart() { obdStage = 0; obdBusy = false; supNext = -1; obdSup = ObdSupport(); memset(pidMiss, 0, sizeof(pidMiss)); }

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
// outside air pressure: the engine's own (PID 33), else learned at idle / key-on (about 93 kPa at Fort St. John), else sea level
float baroNow() { return car.baro > 0 && pidOk(0x33) ? car.baro : baroLearned > 0 ? baroLearned : 101.3; }
float boostPsi() { if (car.mapKpa < 0 || millis() - car.at > 5000) return -1; float b = (car.mapKpa - baroNow()) * 0.145038; return b < 0 ? 0 : b; }
