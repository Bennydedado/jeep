// phone.ino - Heep talks to the T3 here: over Bluetooth (Nordic UART service, one JSON message per line) and,
// when the T3 is on Wi-Fi, through the relay (net.ino passes relay commands to onCommand()). T3.md lists
// every message. Replies go back the way the command came.

#define NUS_SVC "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX  "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_TX  "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

static NimBLECharacteristic* txChar = nullptr;
static QueueHandle_t rxQueue;   // bytes Heep wrote, read in loop()
static String rxLine;
static String pendingScr[MAX_SCREENS];   // a screen set arriving one screen per message
static int pendingScrN = 0;
static volatile uint16_t phoneMtu = 23;   // what Heep's phone agreed to; notifications carry up to MTU - 3 bytes

class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override { phoneMtu = 23; phoneOn = true; }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override { phoneOn = false; phoneMtu = 23; NimBLEDevice::startAdvertising(); }
  void onMTUChange(uint16_t mtu, NimBLEConnInfo&) override { phoneMtu = mtu; }
};
class RxCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    NimBLEAttValue v = c->getValue();
    if (otaMode) { otaPacket(v.data(), v.length()); return; }   // during "Update over Bluetooth" every write is a program packet
    for (size_t i = 0; i < v.length(); i++) { char ch = (char)v.data()[i]; xQueueSend(rxQueue, &ch, 0); }
  }
};
static ServerCB serverCB;
static RxCB rxCB;

void phoneBegin() {
  rxQueue = xQueueCreate(1600, 1);
  NimBLEDevice::init("Jeep T3");
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(&serverCB, false);
  NimBLEService* svc = server->createService(NUS_SVC);
  txChar = svc->createCharacteristic(NUS_TX, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* rx = svc->createCharacteristic(NUS_RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(&rxCB);
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SVC);
  adv->setName("Jeep T3");
  adv->enableScanResponse(true);
  adv->start();
}

// one message, cut into notifications as big as the link allows (a live message is 2-3 of them on an iPhone,
// instead of 25 with a pause after each: loop() is held up for a few ms, not ~75 ms twice a second)
void phoneSend(const String& line) {
  if (!phoneOn || !txChar) return;
  String s = line + "\n";
  size_t chunk = constrain((int)phoneMtu - 3, 20, 240);
  for (size_t i = 0; i < s.length(); i += chunk) {
    size_t left = s.length() - i, n = left < chunk ? left : chunk;
    txChar->setValue((const uint8_t*)s.c_str() + i, n);
    txChar->notify();
    if (i + n < s.length()) delay(2);
  }
}
// the biggest packet Heep may write (and the T3 notify) on this link
int phoneChunk() { return constrain((int)phoneMtu - 3, 20, 244); }
// answer the way the command came: 0 Bluetooth, 1 relay
void reply(const String& line, int src) { if (src == 1) relaySend(line); else phoneSend(line); }

void phoneStep() {
  char ch;
  while (xQueueReceive(rxQueue, &ch, 0) == pdTRUE) {
    if (ch == '\n') { rxLine.trim(); if (rxLine.length()) onCommand(rxLine, 0); rxLine = ""; }
    else if (rxLine.length() < 1500) rxLine += ch;
  }
  static uint32_t lastLive = 0;
  if (phoneOn && !otaMode && millis() - lastLive > 500) { lastLive = millis(); phoneSend(liveJson()); }
}

// ---------------------------------------------------------------- what Heep can ask (T3.md has the full list)
void onCommand(const String& j, int src) {
  String c = jStr(j, "c");
  if (c == "hello") { int64_t t = llField(j, "now"); setClock(t, 'a'); reply(hiJson(), src); }
  else if (c == "status") reply(hiJson(), src);
  else if (c == "diag") reply(diagJson(), src);
  else if (c == "trips") { if (src == 0) sendTrips(); }
  else if (c == "ack") dropTrips("|" + jStr(j, "id") + "|");
  else if (c == "reset") tripCommand("end", src ? "Heep (Wi-Fi)" : "Heep");
  else if (c == "trip") tripCommand(jStr(j, "do"), src ? "Heep (Wi-Fi)" : "Heep");   // start pause resume end
  else if (c == "act") { doAction(jStr(j, "a"), "Heep"); screenWake(); }       // next prev home mark sleep bright peak send
  else if (c == "page") { pageGo((int)numField(j, "i")); screenWake(); }
  else if (c == "update") { updateNow(); reply(updJson(), src); }   // Heep's "Update over Wi-Fi": progress follows as {"t":"upd"}
  else if (c == "watch") relayWatched();                              // Heep in Safari is showing Live: keep the numbers coming
  else if (c == "obdscan") obdScanStart(src);                         // Heep: Diagnostics > Scan the Jeep
  else if (c == "wifi") { if (numField(j, "scan") > 0) wifiScanNow(); reply(wifiJson(), src); }   // the Wi-Fi page
  else if (c == "ota") { if (src == 0 && jStr(j, "do") == "begin") otaBegin(j); }                  // update over Bluetooth only
  else if (c == "cfg") { applySettings(j, src == 1); screenWake(); wifiNudge(false); reply("{\"t\":\"cfg\",\"ok\":true}", src); reply(hiJson(), src); }
  else if (c == "cfgreset") { resetSettings(); reply("{\"t\":\"cfg\",\"ok\":true,\"reset\":true}", src); reply(hiJson(), src); }
  else if (c == "scr") {
    // one screen of a set: {"c":"scr","i":0,"n":5,"d":"Boost|1|v,boost,..."}
    int i = (int)numField(j, "i"), n = (int)numField(j, "n");
    if (n < 1 || n > MAX_SCREENS || i < 0 || i >= n) { reply("{\"t\":\"scr\",\"ok\":false,\"why\":\"bad count\"}", src); return; }
    if (i == 0) { for (int k = 0; k < MAX_SCREENS; k++) pendingScr[k] = ""; }
    pendingScrN = n;
    pendingScr[i] = jStr(j, "d");
  }
  else if (c == "scrok") {
    // the set is complete: check the fingerprint, then keep it
    int n = (int)numField(j, "n");
    String why = "";
    if (n != pendingScrN) why = "count";
    for (int k = 0; k < n && !why.length(); k++) if (!pendingScr[k].length()) why = "missing " + String(k);
    String all;
    for (int k = 0; k < n && !why.length(); k++) all += (k ? "\n" : "") + pendingScr[k];
    uint32_t h = fnv1a(all.c_str());
    if (!why.length() && String(h, HEX) != jStr(j, "h")) why = "fingerprint";
    if (!why.length() && !saveScreens(all)) why = "won't parse";
    reply(why.length() ? "{\"t\":\"scr\",\"ok\":false,\"why\":\"" + why + "\"}" : "{\"t\":\"scr\",\"ok\":true,\"h\":\"" + String(screensHash, HEX) + "\",\"n\":" + String(screenCount) + "}", src);
    if (!why.length()) flash("Screens updated");
  }
  else if (c == "getscr") {
    for (int k = 0; k < screenCount; k++) { char b[1200]; writeScreen(screens[k], b, sizeof(b)); reply("{\"t\":\"scrd\",\"i\":" + String(k) + ",\"n\":" + String(screenCount) + ",\"d\":\"" + jsonEsc(b) + "\"}", src); }
  }
  else if (c == "scrdef") { saveScreens(""); reply("{\"t\":\"scr\",\"ok\":true,\"h\":\"" + String(screensHash, HEX) + "\",\"n\":" + String(screenCount) + ",\"def\":true}", src); flash("Default screens"); }
}

void sendTrips() {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/trips.txt", "r");
  String lines = f ? f.readString() : "";
  if (f) f.close();
  xSemaphoreGive(fsLock);
  int from = 0;
  while (from < (int)lines.length()) {
    int e = lines.indexOf('\n', from);
    if (e < 0) e = lines.length();
    String j = lines.substring(from, e);
    j.trim();
    from = e + 1;
    if (j.length() > 10) phoneSend(j);
  }
}

String hiJson() {
  extern uint32_t lastUploadAt;
  return "{\"t\":\"hi\",\"fw\":\"" FW "\",\"proto\":" + String(PROTO) + ",\"obd\":" + String(obdLinked ? "true" : "false") +
         ",\"queued\":" + String(queued) + ",\"up\":\"" + jsonEsc(lastUpload) + "\",\"upAgo\":" + String(lastUploadAt ? (long)((millis() - lastUploadAt) / 1000) : -1) +
         ",\"totKm\":" + String(totalKm, 1) + ",\"upd\":\"" + jsonEsc(updStatus) + "\",\"wifi\":\"" + jsonEsc(wifiNow) + "\",\"seen\":\"" + jsonEsc(wifiSeen) +
         "\",\"scrh\":\"" + String(screensHash, HEX) + "\",\"scrn\":" + String(screenCount) + ",\"trk\":\"" + jsonEsc(trkStatus) + "\"," + settingsJson() + "}";
}

// the live numbers: twice a second over Bluetooth, once a second over the relay. Anything unknown is left out.
String liveJson() {
  String m = "{\"t\":\"live\"";
  bool obdOk = obdLinked && millis() - car.at < 5000;
  float v = speedNow();
  if (v >= 0) m += ",\"kmh\":" + String(v, 0) + ",\"src\":\"" + (speedFromObd() ? "obd" : "gps") + "\"";
  if (obdOk) {
    if (car.rpm >= 0) m += ",\"rpm\":" + String(car.rpm, 0);
    if (boostPsi() >= 0) m += ",\"boost\":" + String(boostPsi(), 1);
    if (car.ect > -100) m += ",\"ect\":" + String(car.ect, 0);
    if (car.iat > -100) m += ",\"iat\":" + String(car.iat, 0);
    if (car.volts > 0) m += ",\"v\":" + String(car.volts, 1);
    if (car.load >= 0) m += ",\"load\":" + String(car.load, 0);
    if (car.maf >= 0) m += ",\"maf\":" + String(car.maf, 1);
    if (car.rail >= 0) m += ",\"rail\":" + String(car.rail / 100, 0);
    m += ",\"lph\":" + String(fuelNow(), 2);
  }
  m += ",\"g\":" + String((int)gps.state);
  if (gps.valid) m += ",\"lat\":" + String(gps.lat, 6) + ",\"lon\":" + String(gps.lon, 6) + ",\"gkmh\":" + String(gps.kmh, 1);
  if (gps.headingAt) m += ",\"hdg\":" + String((int)gps.heading) + ",\"hdgAge\":" + String((millis() - gps.headingAt) / 1000);
  if (gps.sats >= 0) m += ",\"sats\":" + String(gps.sats);
  if (gps.inView >= 0) m += ",\"inv\":" + String(gps.inView);
  if (!isnan(gps.hdop)) m += ",\"hdop\":" + String(gps.hdop, 1);
  if (tempFresh()) m += ",\"ot\":" + String(otemp.c, 1);
  m += ",\"tp\":" + String(trip.paused ? 1 : 0) + ",\"pg\":" + String(page) + ",\"btn\":\"" + String(wheel.last) + "\",\"bn\":" + String(wheel.presses);
  m += ",\"nano\":\"" + String(wheelState()) + "\",\"sd\":" + String(sd.ok ? 1 : 0);
  m += ",\"trip\":{\"id\":\"" + trip.id + "\",\"km\":" + String(trip.km, 2) + ",\"l\":" + String(trip.l, 2) + ",\"s\":" + String((long)trip.s) +
       ",\"idle\":" + String((long)trip.idle) + ",\"vmax\":" + String((long)trip.vmax) + ",\"gkm\":" + String(trip.gpsKm, 2) + "}}";
  return m;
}

// everything useful for finding a wiring or setup problem (Heep: Live > Diagnostics)
String diagJson() {
  String m = "{\"t\":\"diag\",\"fw\":\"" FW "\",\"upS\":" + String(millis() / 1000) + ",\"boot\":" + String(bootNo) + ",\"reset\":\"" + resetWhy +
             "\",\"heap\":" + String(ESP.getFreeHeap()) + ",\"heapMin\":" + String(ESP.getMinFreeHeap()) + ",\"clock\":\"" + String(timeSrc ? timeSrc : '-') + "\"";
  m += ",\"gps\":{\"state\":" + String((int)gps.state) + ",\"baud\":" + String(gps.baud) + ",\"bytes\":" + String(gps.bytes) + ",\"ok\":" + String(nmea.sentences) +
       ",\"bad\":" + String(nmea.badSum) + ",\"sats\":" + String(gps.sats) + ",\"inv\":" + String(gps.inView) + ",\"hdop\":" + num(gps.hdop, 1) +
       ",\"age\":" + String(gps.fixAt ? (long)(millis() - gps.fixAt) / 1000 : -1) + ",\"q\":" + String(nmea.fix.quality) + ",\"ft\":" + String(nmea.fix.fixType) + "}";
  m += ",\"temp\":{\"state\":" + String(otemp.state) + ",\"c\":" + num(otemp.c, 2) + ",\"age\":" + String(otemp.at ? (long)(millis() - otemp.at) / 1000 : -1) +
       ",\"err\":" + String(otemp.errors) + ",\"rom\":\"" + String(otemp.rom) + "\",\"pin\":" + String(cfg.io4 == 0 ? ONEWIRE_PIN : -1) + "}";
  m += ",\"nano\":{\"state\":\"" + String(wheelState()) + "\",\"baud\":" + String(wheel.baud) + ",\"good\":" + String(jlink.good) + ",\"bad\":" + String(jlink.bad) +
       ",\"dups\":" + String(jlink.dups) + ",\"up\":" + String(wheel.nanoUp) + ",\"proto\":" + String(wheel.proto) + ",\"last\":\"" + String(wheel.last) +
       "\",\"lastAgo\":" + String(wheel.lastAt ? (long)(millis() - wheel.lastAt) / 1000 : -1) + ",\"presses\":" + String(wheel.presses) + "}";
  m += ",\"wifi\":{\"state\":\"" + jsonEsc(wifiNow) + "\",\"rssi\":" + String(wifiState == W_ON ? WiFi.RSSI() : 0) + ",\"ip\":\"" + (wifiState == W_ON ? WiFi.localIP().toString() : String("")) +
       "\",\"seen\":\"" + jsonEsc(wifiSeen) + "\",\"relay\":" + String(relayUp() ? 1 : 0) + "}";
  m += "," + obdDiagJson();
  m += ",\"ble\":{\"phone\":" + String(phoneOn ? 1 : 0) + ",\"icar\":" + String(obdLinked ? 1 : 0) + ",\"icarAge\":" + String(car.at ? (long)(millis() - car.at) / 1000 : -1) + "}";
  m += ",\"sd\":{\"ok\":" + String(sd.ok ? 1 : 0) + ",\"totalMB\":" + String((uint32_t)(sd.total / 1048576)) + ",\"usedMB\":" + String((uint32_t)(sd.used / 1048576)) +
       ",\"rows\":" + String(sd.rows) + ",\"err\":" + String(sd.errors) + ",\"last\":\"" + jsonEsc(sd.err) + "\",\"file\":\"" + jsonEsc(sd.file) + "\",\"waiting\":" + String(sd.tracksWaiting) + "}";
  m += ",\"up\":{\"sheet\":\"" + jsonEsc(lastUpload) + "\",\"tracks\":\"" + jsonEsc(trkStatus) + "\",\"queued\":" + String(queued) + ",\"fw\":\"" + jsonEsc(updStatus) + "\"}}";
  return m;
}
