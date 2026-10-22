// T3.ino - the Jeep's trip computer, for a LilyGo T3 V1.6.1 (ESP32) in the 2006 Liberty CRD.
//
// What it does:
//  - reads the engine through a Vgate iCar Pro Bluetooth 4.0 (BLE) OBD adapter plugged into the OBD port
//  - shows fuel economy, the trip, the engine and totals on the T3's little screen (a button flips pages)
//  - keeps every trip in the T3's flash memory: no battery needed, nothing lost when the key goes off
//  - sends finished trips to your Jeep log sheet by itself over home Wi-Fi or your iPhone's hotspot,
//    and Heep can collect them over Bluetooth too (the same trip never lands twice)
//  - talks to Heep's Live screen over Bluetooth (see T3.md)
//
// Nothing to edit in here: the Wi-Fi names, passwords and the sheet link are sent from Heep
// (Live > T3 setup) and kept on the T3.
//
// The LoRa radio is put to sleep and never transmits, so the T3 is safe to run without its antenna.
//
// Arduino IDE: board "TTGO LoRa32-OLED" (Board revision "TTGO LoRa32 V2.1 (1.6.1)"), or "ESP32 Dev Module",
// Partition Scheme "Huge APP (3MB No OTA/1MB SPIFFS)". Libraries: Adafruit SSD1306, Adafruit GFX, LoRa (Sandeep Mistry).

#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <time.h>

#define FW "1.0"

// ---------------------------------------------------------------- pins on the T3 V1.6.1
#define OLED_SDA 21
#define OLED_SCL 22
#define OLED_RST 16       // not wired on every T3; pulsing it is harmless
#define LORA_SCK 5
#define LORA_MISO 19
#define LORA_MOSI 27
#define LORA_CS 18
#define LORA_RST 23
#define LORA_DIO0 26
#define LED_PIN 25
#define BUTTON_PIN 4      // a push button (or a spare pedal / wheel button wire) between IO4 and GND

// ---------------------------------------------------------------- Bluetooth: Heep talks to the "Jeep T3" (Nordic UART)
#define NUS_SVC "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX  "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_TX  "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Preferences prefs;

// ---------------------------------------------------------------- settings (sent from Heep, kept in flash)
struct Net { String ssid, pass; };
Net nets[4];
int netCount = 0;
String sheetUrl, sheetKey, obdName;
float fuelCal = 1.0, distCal = 1.0;
uint32_t bootNo = 0;
float totalKm = 0, totalL = 0;

void loadSettings() {
  prefs.begin("t3", true);
  netCount = prefs.getInt("n", 0);
  if (netCount > 4) netCount = 4;
  for (int i = 0; i < netCount; i++) { nets[i].ssid = prefs.getString(("s" + String(i)).c_str(), ""); nets[i].pass = prefs.getString(("p" + String(i)).c_str(), ""); }
  sheetUrl = prefs.getString("u", "");
  sheetKey = prefs.getString("k", "");
  obdName = prefs.getString("obd", "");
  fuelCal = prefs.getFloat("fc", 1.0);
  distCal = prefs.getFloat("dc", 1.0);
  totalKm = prefs.getFloat("tk", 0);
  totalL = prefs.getFloat("tl", 0);
  prefs.end();
  if (fuelCal < 0.3 || fuelCal > 3) fuelCal = 1.0;
  if (distCal < 0.5 || distCal > 2) distCal = 1.0;
}

// ---------------------------------------------------------------- the clock: from Wi-Fi (internet time) or from Heep
int64_t epochOffset = 0;  // epoch ms minus millis()
bool timeKnown = false;
int64_t nowMs() { return timeKnown ? epochOffset + (int64_t)millis() : 0; }
void setTime(int64_t epochMs) { if (epochMs > 1600000000000LL) { epochOffset = epochMs - (int64_t)millis(); timeKnown = true; } }

// ---------------------------------------------------------------- what the engine says right now
struct Live {
  float kmh = -1, rpm = -1, load = -1, ect = -999, iat = -999, mapKpa = -1, baro = -1, volts = -1, lph = -1;
  bool fuelRatePid = true;   // PID 5E (engine fuel rate), if the ECU has it; most 2006 diesels don't
  uint32_t at = 0;           // when the last answer came in
} car;

// ---------------------------------------------------------------- the trip
struct Trip { String id; float km = 0, l = 0, s = 0, idle = 0, vmax = 0; int64_t t0 = 0, t1 = 0; bool running = false; };
Trip trip;
int tripNo = 0;
uint32_t lastIntegrate = 0, lastSnapshot = 0, engineOffSince = 0;
SemaphoreHandle_t fsLock;

String ll(long long v) { char b[24]; snprintf(b, sizeof(b), "%lld", v); return String(b); }

void newTrip() {
  trip = Trip();
  tripNo++;
  trip.id = "t" + String(bootNo) + "-" + String(tripNo);
  trip.t0 = nowMs();
}

String tripJson(const Trip& t) {
  String j = "{\"t\":\"trip\",\"id\":\"" + t.id + "\",\"km\":" + String(t.km, 2) + ",\"l\":" + String(t.l, 2) +
             ",\"s\":" + String((long)t.s) + ",\"idle\":" + String((long)t.idle) + ",\"vmax\":" + String((long)t.vmax);
  if (t.t0) j += ",\"t0\":" + ll(t.t0);
  if (t.t1) j += ",\"t1\":" + ll(t.t1);
  return j + "}";
}

// trips waiting to reach the sheet live in /trips.txt, one per line; the trip in progress in /cur.txt
int queuedCount() {
  int n = 0;
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/trips.txt", "r");
  if (f) { while (f.available()) { String l = f.readStringUntil('\n'); if (l.length() > 5) n++; } f.close(); }
  xSemaphoreGive(fsLock);
  return n;
}
int queued = 0;
void queueTrip(const Trip& t) {
  if (t.km < 0.2) {  // a key-on in the yard isn't a trip
    xSemaphoreTake(fsLock, portMAX_DELAY); LittleFS.remove("/cur.txt"); xSemaphoreGive(fsLock);
    return;
  }
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/trips.txt", "a");
  if (f) { f.println(tripJson(t)); f.close(); }
  LittleFS.remove("/cur.txt");
  xSemaphoreGive(fsLock);
  totalKm += t.km; totalL += t.l;
  prefs.begin("t3", false); prefs.putFloat("tk", totalKm); prefs.putFloat("tl", totalL); prefs.end();
  queued = queuedCount();
}
// forget the trips the sheet now has
void dropTrips(const String& ids) {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/trips.txt", "r");
  String keep;
  if (f) {
    while (f.available()) {
      String l = f.readStringUntil('\n');
      l.trim();
      if (l.length() < 5) continue;
      int a = l.indexOf("\"id\":\"") + 6, b = l.indexOf('"', a);
      String id = l.substring(a, b);
      if (ids.indexOf("|" + id + "|") < 0) keep += l + "\n";
    }
    f.close();
  }
  f = LittleFS.open("/trips.txt", "w");
  if (f) { f.print(keep); f.close(); }
  xSemaphoreGive(fsLock);
  queued = queuedCount();
}
// the trip so far, every 30 s: if the key goes off, the next start finds it here
void snapshot() {
  if (trip.km < 0.05) return;
  trip.t1 = nowMs();
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/cur.txt", "w");
  if (f) { f.print(tripJson(trip)); f.close(); }
  xSemaphoreGive(fsLock);
}
float numField(const String& j, const char* key, float d = 0) {
  int i = j.indexOf("\"" + String(key) + "\":");
  if (i < 0) return d;
  return j.substring(i + strlen(key) + 3).toFloat();
}
long long llField(const String& j, const char* key) {
  int i = j.indexOf("\"" + String(key) + "\":");
  if (i < 0) return 0;
  return atoll(j.substring(i + strlen(key) + 3).c_str());
}
// last time's trip, cut short by the key: finish it now
void recoverTrip() {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/cur.txt", "r");
  String j = f ? f.readString() : "";
  if (f) f.close();
  xSemaphoreGive(fsLock);
  if (j.length() < 10) return;
  Trip t;
  int a = j.indexOf("\"id\":\"") + 6, b = j.indexOf('"', a);
  t.id = j.substring(a, b);
  t.km = numField(j, "km"); t.l = numField(j, "l"); t.s = numField(j, "s"); t.idle = numField(j, "idle"); t.vmax = numField(j, "vmax");
  t.t0 = llField(j, "t0"); t.t1 = llField(j, "t1");
  queueTrip(t);
}

// ---------------------------------------------------------------- Heep over Bluetooth (the T3 is the server)
BLEServer* server = nullptr;
BLECharacteristic* txChar = nullptr;
volatile bool phoneOn = false;
QueueHandle_t rxQueue;   // bytes Heep wrote, read in loop()

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { phoneOn = true; }
  void onDisconnect(BLEServer* s) override { phoneOn = false; delay(50); s->startAdvertising(); }
};
class RxCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    auto v = c->getValue();
    String s = String(v.c_str());
    for (size_t i = 0; i < s.length(); i++) { char ch = s[i]; xQueueSend(rxQueue, &ch, 0); }
  }
};
void phoneSend(const String& line) {
  if (!phoneOn || !txChar) return;
  String s = line + "\n";
  for (size_t i = 0; i < s.length(); i += 20) {
    String part = s.substring(i, i + 20);
    txChar->setValue((uint8_t*)part.c_str(), part.length());
    txChar->notify();
    delay(4);
  }
}

// ---------------------------------------------------------------- the iCar over Bluetooth (the T3 is the client)
BLEAdvertisedDevice* obdFound = nullptr;
BLEClient* obdClient = nullptr;
BLERemoteCharacteristic* obdWrite = nullptr;
bool obdWriteResp = false;
volatile bool obdLinked = false;
QueueHandle_t obdQueue;   // bytes the iCar sent
uint32_t lastScan = 0;

bool looksLikeObd(BLEAdvertisedDevice& d) {
  String n = String(d.getName().c_str());
  n.toLowerCase();
  if (n.length() == 0 || n.startsWith("jeep")) return false;
  if (obdName.length()) { String want = obdName; want.toLowerCase(); return n.indexOf(want) >= 0; }
  const char* names[] = { "vlink", "v-link", "icar", "vgate", "obd", "elm", "vlinker", "ios-vlink" };
  for (auto k : names) if (n.indexOf(k) >= 0) return true;
  return false;
}
class ScanCB : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice d) override {
    if (!obdFound && looksLikeObd(d)) { obdFound = new BLEAdvertisedDevice(d); BLEDevice::getScan()->stop(); }
  }
};
class ObdClientCB : public BLEClientCallbacks {
  void onConnect(BLEClient*) override {}
  void onDisconnect(BLEClient*) override { obdLinked = false; }
};
void obdNotify(BLERemoteCharacteristic*, uint8_t* data, size_t len, bool) {
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
    BLERemoteService* svc = obdClient->getService(BLEUUID(t.svc));
    if (!svc) continue;
    BLERemoteCharacteristic* rx = svc->getCharacteristic(BLEUUID(t.rx));
    BLERemoteCharacteristic* tx = svc->getCharacteristic(BLEUUID(t.tx));
    if (!rx || !tx) continue;
    if (rx->canNotify()) rx->registerForNotify(obdNotify);
    else if (rx->canIndicate()) rx->registerForNotify(obdNotify, false);
    else continue;
    obdWrite = tx;
    obdWriteResp = !tx->canWriteNoResponse();
    return true;
  }
  return false;
}
void obdConnectStep() {
  if (obdLinked) return;
  if (!obdFound) {
    if (millis() - lastScan < 8000) return;
    lastScan = millis();
    BLEScan* sc = BLEDevice::getScan();
    sc->setActiveScan(true);
    sc->start(2, false);   // blocks 2 s at most; stops early when the iCar shows up
    sc->clearResults();
    return;
  }
  if (!obdClient) { obdClient = BLEDevice::createClient(); obdClient->setClientCallbacks(new ObdClientCB()); }
  if (obdClient->connect(obdFound) && obdAttach()) obdLinked = true;
  else { if (obdClient->isConnected()) obdClient->disconnect(); }
  delete obdFound; obdFound = nullptr;
}

// ---------------------------------------------------------------- ELM327 commands, one at a time
String obdBuf;
bool obdBusy = false;
uint32_t obdSentAt = 0, obdTimeout = 1500;
String obdCmd;
int obdStage = 0;       // 0 = reset the adapter, then set it up, then ask for engine values
int pollIdx = 0;
bool pidMissing[256];

void obdSendCmd(const String& cmd, uint32_t timeout = 1500) {
  if (!obdWrite) return;
  String c = cmd + "\r";
  obdWrite->writeValue((uint8_t*)c.c_str(), c.length(), obdWriteResp);
  obdCmd = cmd; obdBusy = true; obdSentAt = millis(); obdTimeout = timeout; obdBuf = "";
}
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
  if (!obdLinked) { obdStage = 0; obdBusy = false; return; }
  char ch;
  while (xQueueReceive(obdQueue, &ch, 0) == pdTRUE) {
    obdBuf += ch;
    if (ch == '>') { String r = obdBuf; obdBusy = false; obdAnswer(r); }
  }
  if (obdBusy && millis() - obdSentAt > obdTimeout) obdBusy = false;
  if (obdBusy) return;
  const char* setup[] = { "ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATAT1", "ATSP0", "0100" };
  if (obdStage < 8) { obdSendCmd(setup[obdStage], obdStage == 0 ? 2500 : obdStage == 7 ? 9000 : 1500); obdStage++; return; }
  // speed, RPM and load all the time; the rest now and then
  static const int fast[] = { 0x0D, 0x0C, 0x04 };
  static const int slow[] = { 0x05, 0x0F, 0x0B, 0x33, 0x5E, -1 };
  int k = pollIdx++ % 12;
  int pid = k < 9 ? fast[k % 3] : slow[(pollIdx / 12) % 6];
  if (pid == -1) { obdSendCmd("ATRV"); return; }
  if (pidMissing[pid]) pid = fast[k % 3];
  char c[6]; snprintf(c, sizeof(c), "01%02X", pid);
  obdSendCmd(c);
}

// fuel right now, litres per hour: the ECU's own number if it has one, otherwise worked out from load and RPM
// (a 2.8 CRD makes about 400 Nm; diesel burns about 240 g per kWh). Heep's fuel correction trims it.
float fuelNow() {
  if (car.rpm <= 0) return 0;
  if (!pidMissing[0x5E] && car.lph >= 0) return car.lph * fuelCal;
  float load = car.load < 0 ? 20 : car.load;
  float lph = load / 100.0 * car.rpm * 0.0105;
  if (lph < 0.6) lph = 0.6;
  return lph * fuelCal;
}
float boostPsi() { if (car.mapKpa < 0) return -1; float b = (car.mapKpa - (car.baro > 0 ? car.baro : 101)) * 0.145038; return b < 0 ? 0 : b; }
bool engineOn() { return obdLinked && car.rpm > 300 && millis() - car.at < 5000; }

void integrate() {
  uint32_t now = millis();
  float dt = (now - lastIntegrate) / 1000.0;
  lastIntegrate = now;
  if (dt <= 0 || dt > 5) return;
  if (!engineOn()) {
    if (!engineOffSince) engineOffSince = now;
    // parked with the key on for 90 s: that trip is over (it goes to the sheet while the key is still on)
    if (trip.km >= 0.2 && now - engineOffSince > 90000) { trip.t1 = nowMs(); queueTrip(trip); newTrip(); }
    return;
  }
  engineOffSince = 0;
  if (!trip.t0) trip.t0 = nowMs() ? nowMs() - (int64_t)((trip.s) * 1000) : 0;
  float kmh = car.kmh < 0 ? 0 : car.kmh;
  trip.km += kmh * dt / 3600.0 * distCal;
  trip.l += fuelNow() * dt / 3600.0;
  trip.s += dt;
  if (kmh < 2) trip.idle += dt;
  if (kmh > trip.vmax) trip.vmax = kmh;
}

// ---------------------------------------------------------------- Wi-Fi: home or the iPhone's hotspot, then the sheet
enum WifiState { W_IDLE, W_SCAN, W_JOIN, W_SEND };
volatile WifiState wifiState = W_IDLE;
uint32_t wifiAt = 0, nextWifiTry = 15000;
String wifiName, lastUpload = "not yet";
uint32_t lastUploadAt = 0;
volatile bool uploadDone = false;

void uploadTask(void*) {
  // every trip waiting, in one go
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/trips.txt", "r");
  String lines = f ? f.readString() : "";
  if (f) f.close();
  xSemaphoreGive(fsLock);
  String ops, ids = "|";
  int n = 0, from = 0;
  int64_t now = nowMs();
  while (from < (int)lines.length() && n < 40) {
    int e = lines.indexOf('\n', from);
    if (e < 0) e = lines.length();
    String j = lines.substring(from, e);
    from = e + 1;
    if (j.length() < 10) continue;
    int a = j.indexOf("\"id\":\"") + 6, b = j.indexOf('"', a);
    String id = j.substring(a, b);
    long long t1 = llField(j, "t1"), t0 = llField(j, "t0");
    float s = numField(j, "s");
    String note = "";
    if (!t1) { t1 = now; note = "time approximate"; }
    if (!t0) t0 = t1 - (long long)(s * 1000);
    if (n) ops += ",";
    ops += "{\"q\":\"" + id + "\",\"op\":\"put\",\"tab\":\"trip\",\"row\":{\"id\":\"" + id + "\",\"t0\":" + ll(t0) + ",\"t1\":" + ll(t1) +
           ",\"km\":" + String(numField(j, "km"), 2) + ",\"lit\":" + String(numField(j, "l"), 2) + ",\"vmax\":" + String((long)numField(j, "vmax")) +
           ",\"idle\":" + String((long)(numField(j, "idle") / 60 + 0.5)) + ",\"note\":\"" + note + "\"}}";
    ids += id + "|";
    n++;
  }
  bool ok = false;
  if (n) {
    WiFiClientSecure tls;
    tls.setInsecure();
    HTTPClient http;
    http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);   // Google answers from a second address
    http.setTimeout(20000);
    if (http.begin(tls, sheetUrl)) {
      http.addHeader("Content-Type", "text/plain");
      int code = http.POST("{\"k\":\"" + sheetKey + "\",\"ops\":[" + ops + "]}");
      String body = code > 0 ? http.getString() : "";
      ok = code == 200 && body.indexOf("\"ok\":true") >= 0;
      lastUpload = ok ? "sent " + String(n) + (n == 1 ? " trip" : " trips") : (body.indexOf("key") >= 0 ? "sheet key wrong" : "send failed (" + String(code) + ")");
      http.end();
    } else lastUpload = "bad sheet link";
  }
  if (ok) { dropTrips(ids); lastUploadAt = millis(); }
  uploadDone = true;
  vTaskDelete(nullptr);
}
void wifiStep() {
  uint32_t now = millis();
  switch (wifiState) {
    case W_IDLE:
      if (queued == 0 || netCount == 0 || sheetUrl.length() == 0 || now < nextWifiTry) return;
      WiFi.mode(WIFI_STA);
      WiFi.scanNetworks(true);
      wifiState = W_SCAN; wifiAt = now;
      return;
    case W_SCAN: {
      int found = WiFi.scanComplete();
      if (found == WIFI_SCAN_RUNNING && now - wifiAt < 10000) return;
      int pick = -1;
      for (int i = 0; i < netCount && pick < 0; i++)                 // home first, then the hotspot
        for (int k = 0; k < found; k++) if (WiFi.SSID(k) == nets[i].ssid) { pick = i; break; }
      WiFi.scanDelete();
      if (pick < 0) { WiFi.mode(WIFI_OFF); wifiState = W_IDLE; nextWifiTry = now + 60000; return; }
      wifiName = nets[pick].ssid;
      WiFi.begin(nets[pick].ssid.c_str(), nets[pick].pass.c_str());
      wifiState = W_JOIN; wifiAt = now;
      return;
    }
    case W_JOIN:
      if (WiFi.status() == WL_CONNECTED) {
        configTime(0, 0, "pool.ntp.org", "time.google.com");
        struct tm tmv;
        if (getLocalTime(&tmv, 3000)) { time_t t; time(&t); setTime((int64_t)t * 1000); }
        uploadDone = false;
        xTaskCreatePinnedToCore(uploadTask, "upload", 16384, nullptr, 1, nullptr, 0);
        wifiState = W_SEND; wifiAt = now;
      } else if (now - wifiAt > 15000) { lastUpload = "couldn't join " + wifiName; WiFi.disconnect(true); WiFi.mode(WIFI_OFF); wifiState = W_IDLE; nextWifiTry = now + 60000; }
      return;
    case W_SEND:
      if (!uploadDone && now - wifiAt < 60000) return;
      WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
      wifiState = W_IDLE; nextWifiTry = now + 120000;
      return;
  }
}

// ---------------------------------------------------------------- messages from Heep
String rxLine;
String jStr(const String& j, const char* key) {
  int i = j.indexOf("\"" + String(key) + "\":\"");
  if (i < 0) return "";
  i += strlen(key) + 4;
  String out;
  while (i < (int)j.length() && j[i] != '"') {
    if (j[i] == '\\' && i + 1 < (int)j.length()) { i++; char e = j[i]; out += e == 'n' ? '\n' : e == 't' ? '\t' : e; }
    else out += j[i];
    i++;
  }
  return out;
}
// "wifi":["home name","home password","hotspot name","hotspot password"]
int jStrings(const String& j, const char* key, String* out, int max) {
  int i = j.indexOf("\"" + String(key) + "\":[");
  if (i < 0) return -1;
  i += strlen(key) + 4;
  int n = 0;
  while (i < (int)j.length() && j[i] != ']' && n < max) {
    if (j[i] != '"') { i++; continue; }
    i++;
    String s;
    while (i < (int)j.length() && j[i] != '"') { if (j[i] == '\\' && i + 1 < (int)j.length()) i++; s += j[i]; i++; }
    i++;
    out[n++] = s;
  }
  return n;
}
void sendHi() {
  phoneSend("{\"t\":\"hi\",\"fw\":\"" FW "\",\"obd\":" + String(obdLinked ? "true" : "false") + ",\"nets\":" + String(netCount) +
            ",\"sheet\":" + String(sheetUrl.length() ? "true" : "false") + ",\"queued\":" + String(queued) +
            ",\"up\":\"" + lastUpload + "\",\"upAgo\":" + String(lastUploadAt ? (long)((millis() - lastUploadAt) / 1000) : -1) +
            ",\"fc\":" + String(fuelCal, 3) + ",\"dc\":" + String(distCal, 3) + ",\"totKm\":" + String(totalKm, 1) + "}");
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
void onPhoneLine(const String& j) {
  String c = jStr(j, "c");
  if (c == "hello") { setTime(llField(j, "now")); sendHi(); }
  else if (c == "trips") sendTrips();
  else if (c == "ack") dropTrips("|" + jStr(j, "id") + "|");
  else if (c == "reset") { trip.t1 = nowMs(); queueTrip(trip); newTrip(); }
  else if (c == "status") sendHi();
  else if (c == "cfg") {
    String w[8];
    int n = jStrings(j, "wifi", w, 8);
    prefs.begin("t3", false);
    if (n >= 0) {
      int k = 0;
      for (int i = 0; i + 1 < n && k < 4; i += 2) if (w[i].length()) { prefs.putString(("s" + String(k)).c_str(), w[i]); prefs.putString(("p" + String(k)).c_str(), w[i + 1]); k++; }
      prefs.putInt("n", k);
    }
    if (j.indexOf("\"u\":") >= 0) prefs.putString("u", jStr(j, "u"));
    if (j.indexOf("\"k\":") >= 0) prefs.putString("k", jStr(j, "k"));
    if (j.indexOf("\"obd\":") >= 0) prefs.putString("obd", jStr(j, "obd"));
    if (j.indexOf("\"fc\":") >= 0) prefs.putFloat("fc", numField(j, "fc", 1));
    if (j.indexOf("\"dc\":") >= 0) prefs.putFloat("dc", numField(j, "dc", 1));
    prefs.end();
    loadSettings();
    nextWifiTry = millis() + 2000;
    phoneSend("{\"t\":\"cfg\",\"ok\":true}");
    sendHi();
  }
}
void phoneStep() {
  char ch;
  while (xQueueReceive(rxQueue, &ch, 0) == pdTRUE) {
    if (ch == '\n') { rxLine.trim(); if (rxLine.length()) onPhoneLine(rxLine); rxLine = ""; }
    else if (rxLine.length() < 1200) rxLine += ch;
  }
  static uint32_t lastLive = 0;
  if (phoneOn && millis() - lastLive > 500) {
    lastLive = millis();
    String m = "{\"t\":\"live\"";
    if (engineOn() || obdLinked) {
      if (car.kmh >= 0) m += ",\"kmh\":" + String(car.kmh, 0);
      if (car.rpm >= 0) m += ",\"rpm\":" + String(car.rpm, 0);
      if (boostPsi() >= 0) m += ",\"boost\":" + String(boostPsi(), 1);
      if (car.ect > -100) m += ",\"ect\":" + String(car.ect, 0);
      if (car.iat > -100) m += ",\"iat\":" + String(car.iat, 0);
      if (car.volts > 0) m += ",\"v\":" + String(car.volts, 1);
      if (car.load >= 0) m += ",\"load\":" + String(car.load, 0);
      m += ",\"lph\":" + String(fuelNow(), 2);
    }
    m += ",\"trip\":{\"km\":" + String(trip.km, 2) + ",\"l\":" + String(trip.l, 2) + ",\"s\":" + String((long)trip.s) + ",\"idle\":" + String((long)trip.idle) + "}}";
    phoneSend(m);
  }
}

// ---------------------------------------------------------------- the screen and the button
int page = 0;
const int PAGES = 6;
uint32_t pressAt = 0, msgUntil = 0;
bool pressed = false, longDone = false;
String msg;
// the screen sleeps after a minute without a press; the next press only wakes it
#define SCREEN_SECS 60
bool screenOn = true, wakePress = false;
uint32_t lastTouch = 0;
void screenWake() { if (!screenOn) { screenOn = true; oled.ssd1306_command(SSD1306_DISPLAYON); } lastTouch = millis(); }
void screenSleepStep() {
  if (screenOn && millis() - lastTouch > SCREEN_SECS * 1000UL) { screenOn = false; oled.clearDisplay(); oled.display(); oled.ssd1306_command(SSD1306_DISPLAYOFF); }
}

void flash(const String& m) { msg = m; msgUntil = millis() + 1500; screenWake(); }
void buttonStep() {
  bool down = digitalRead(BUTTON_PIN) == LOW;
  uint32_t now = millis();
  if (down && !pressed) { pressed = true; pressAt = now; longDone = false; wakePress = !screenOn; screenWake(); }
  if (down && pressed) lastTouch = now;
  if (down && pressed && !longDone && !wakePress && now - pressAt > 1500) {
    longDone = true;
    // hold: a new trip on the trip pages, send now on the status page
    if (page <= 1) { trip.t1 = nowMs(); queueTrip(trip); newTrip(); flash("New trip"); }
    else if (page == 5) { nextWifiTry = 0; flash("Sending..."); }
  }
  if (!down && pressed) { pressed = false; if (!longDone && !wakePress && now - pressAt > 40) page = (page + 1) % PAGES; }
}
String hm(float s) { long m = (long)(s / 60); char b[12]; snprintf(b, sizeof(b), "%ld:%02ld", m / 60, m % 60); return b; }
String avgText(float l, float km) { return km >= 0.5 ? String(l / km * 100, 1) : "--"; }
void title(const char* t) {
  oled.setFont(); oled.setTextSize(1); oled.setCursor(0, 0); oled.print(t);
  String s = String(obdLinked ? "OBD" : "---") + (phoneOn ? " PH" : "") + (wifiState != W_IDLE ? " WF" : "");
  oled.setCursor(128 - s.length() * 6, 0); oled.print(s);
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);
}
void bigValue(const String& v, int y) {
  oled.setFont(&FreeSansBold18pt7b);
  int16_t x1, y1; uint16_t w, h;
  oled.getTextBounds(v, 0, y, &x1, &y1, &w, &h);
  oled.setCursor((128 - w) / 2, y); oled.print(v);
  oled.setFont();
}
void row(int y, const String& a, const String& b) { oled.setCursor(0, y); oled.print(a); oled.setCursor(128 - b.length() * 6, y); oled.print(b); }
void draw() {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  float lph = fuelNow(), kmh = car.kmh < 0 ? 0 : car.kmh;
  String now = !engineOn() ? "--" : kmh > 3 ? String(lph / kmh * 100, 1) : String(lph, 1) + " L/h";
  switch (page) {
    case 0:  // fuel economy, the headline
      title("ECONOMY  L/100km");
      bigValue(avgText(trip.l, trip.km), 42);
      oled.setCursor(0, 47); oled.print("trip avg   now " + now);
      oled.setCursor(0, 56); oled.print(String(trip.km, 1) + " km  " + String(trip.l, 2) + " L");
      break;
    case 1:  // the trip
      title("TRIP");
      oled.setTextSize(1);
      row(14, "Distance", String(trip.km, 1) + " km");
      row(24, "Time", hm(trip.s) + "  idle " + hm(trip.idle));
      row(34, "Diesel", String(trip.l, 2) + " L");
      row(44, "Average", avgText(trip.l, trip.km) + " L/100");
      row(54, "Top speed", String((int)trip.vmax) + " km/h");
      break;
    case 2:  // the engine
      title("ENGINE");
      row(14, "RPM", car.rpm >= 0 ? String((int)car.rpm) : "--");
      row(24, "Boost", boostPsi() >= 0 ? String(boostPsi(), 1) + " psi" : "--");
      row(34, "Coolant", car.ect > -100 ? String((int)car.ect) + " C" : "--");
      row(44, "Intake", car.iat > -100 ? String((int)car.iat) + " C" : "--");
      row(54, "Battery", car.volts > 0 ? String(car.volts, 1) + " V" : "--");
      break;
    case 3:  // speed, big
      title("SPEED  km/h");
      bigValue(engineOn() ? String((int)kmh) : "--", 42);
      oled.setCursor(0, 50); oled.print("RPM " + String(car.rpm >= 0 ? (int)car.rpm : 0) + "   " + String(lph, 1) + " L/h");
      break;
    case 4:  // all trips
      title("ALL TRIPS");
      row(14, "Distance", String(totalKm + trip.km, 0) + " km");
      row(24, "Diesel", String(totalL + trip.l, 0) + " L");
      row(34, "Average", avgText(totalL + trip.l, totalKm + trip.km) + " L/100");
      row(44, "This start", String(trip.km, 1) + " km");
      row(54, "Load", car.load >= 0 ? String((int)car.load) + " %" : "--");
      break;
    case 5:  // how it's connected
      title("STATUS  T3 " FW);
      row(14, "iCar", obdLinked ? (car.at && millis() - car.at < 5000 ? "reading" : "connected") : "looking...");
      row(24, "Phone", phoneOn ? "Heep connected" : "-");
      row(34, "Wi-Fi", netCount == 0 ? "set up in Heep" : wifiState == W_IDLE ? String(netCount) + " saved" : wifiName.substring(0, 12));
      row(44, "Waiting", String(queued) + (queued == 1 ? " trip" : " trips"));
      row(54, "Sheet", lastUpload.substring(0, 14));
      break;
  }
  if (millis() < msgUntil) { oled.fillRect(14, 22, 100, 20, SSD1306_BLACK); oled.drawRect(14, 22, 100, 20, SSD1306_WHITE); oled.setCursor(64 - msg.length() * 3, 28); oled.print(msg); }
  oled.display();
}

// ---------------------------------------------------------------- start
void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW);
  // LoRa off for good: asleep, never transmitting, fine with no antenna on
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  LoRa.setPins(LORA_CS, LORA_RST, LORA_DIO0);
  if (LoRa.begin(915E6)) LoRa.sleep();
  // the screen
  pinMode(OLED_RST, OUTPUT); digitalWrite(OLED_RST, LOW); delay(20); digitalWrite(OLED_RST, HIGH);
  Wire.begin(OLED_SDA, OLED_SCL);
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  oled.clearDisplay(); oled.setTextColor(SSD1306_WHITE); oled.setCursor(0, 0); oled.print("Jeep T3 " FW "\nstarting..."); oled.display();
  // flash and settings
  fsLock = xSemaphoreCreateMutex();
  LittleFS.begin(true);
  prefs.begin("t3", false); bootNo = prefs.getUInt("boot", 0) + 1; prefs.putUInt("boot", bootNo); prefs.end();
  loadSettings();
  recoverTrip();
  queued = queuedCount();
  newTrip();
  // Bluetooth: Heep connects to us, we connect to the iCar
  rxQueue = xQueueCreate(1400, 1);
  obdQueue = xQueueCreate(512, 1);
  WiFi.mode(WIFI_OFF);
  BLEDevice::init("Jeep T3");
  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  BLEService* svc = server->createService(NUS_SVC);
  txChar = svc->createCharacteristic(NUS_TX, BLECharacteristic::PROPERTY_NOTIFY);
  txChar->addDescriptor(new BLE2902());
  BLECharacteristic* rx = svc->createCharacteristic(NUS_RX, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCB());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SVC);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  BLEDevice::getScan()->setAdvertisedDeviceCallbacks(new ScanCB());
  lastIntegrate = millis();
  lastTouch = millis();   // on for a minute after the key goes on
}

void loop() {
  obdConnectStep();
  obdStep();
  integrate();
  phoneStep();
  wifiStep();
  buttonStep();
  if (millis() - lastSnapshot > 30000) { lastSnapshot = millis(); snapshot(); }
  static uint32_t lastDraw = 0;
  screenSleepStep();
  if (screenOn && millis() - lastDraw > 250) { lastDraw = millis(); draw(); }
  digitalWrite(LED_PIN, obdLinked && (millis() / 500) % 2);
  delay(5);
}
