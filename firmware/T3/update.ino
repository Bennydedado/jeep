// update.ino - "Update over Wi-Fi", done from a fresh start.
//
// Downloading from Heep update server needs a secure connection, and that needs about 50 KB of memory in one piece. With
// Bluetooth (the iCar and Heep), Wi-Fi and the relay all running, the T3 often hasn't got that, and the update
// stops with "couldn't reach Heep update server: connection refused". So an update over Wi-Fi restarts the T3 first and does
// the whole thing before Bluetooth and everything else start: join your Wi-Fi, ask Heep update server for t3.json, download
// the new program, restart into it. The screen shows how far it is. If it can't, the T3 starts up as usual with the
// program it has and tells Heep why (the "upd" text in "hi").
//
// Only when you ask from Heep ("update"): the T3 never looks for updates by itself (2.9+).

static uint32_t bootUpdAt = 0;   // restart for the update at this millis() (0 = not asked)
String bootUpdNote;               // how the update at start-up went, for the event log
String bootNote;                  // how sending trips at start-up went, for the event log
String uplNote;                   // how an upload you asked for went (Heep's "Upload now", the wheel's Send trips): in "hi"

// remember to update at the next start, save the trip so far and the card, and restart in 2 s (time to tell Heep)
void bootUpdateSoon(bool manual) {
  Preferences p; p.begin("t3", false); p.putUChar("ub", manual ? 2 : 1); p.end();
  updPct = -1; updPhaseAt = millis();
  updStatus.set("restarting to update over Wi-Fi");
  updPhase = UP_RESTART;
  updating = true;   // the screen says so; Bluetooth updates wait
  flushReq = true;
  bootUpdAt = millis() + 2000;
}
// Heep's "Update over Wi-Fi": not while moving (an unknown speed counts as stopped), allowed with the engine idling
void updateNow() {
  updPct = -1; updPhaseAt = millis();
  if (speedNow() > 1) { updStatus.set("not while the Jeep is moving"); updPhase = UP_FAIL; return; }
  if (!cfg.netCount) { updStatus.set("no Wi-Fi saved: add one in T3 settings"); updPhase = UP_FAIL; return; }
  bootUpdateSoon(true);
}
// ---------------------------------------------------------------- sending trips with a fresh start
// With Bluetooth running, the T3 often can't get the memory for the secure connection to Google, so trips are sent
// at start-up (bootSend below). To get a drive's trip on the sheet without waiting for the next key-on:
//   - parked at home: the trip ends by itself after "parkSecs" with the engine off, then if your Wi-Fi was there in
//     the last 3 minutes and the trip still hasn't gone 20 s later, the T3 restarts and sends it (screen: Wi-Fi/trip status)
//   - or now: the wheel menu's "Send trips" (ends the trip, restarts, sends)
static uint32_t sendRestartAt = 0, parkSendAt = 0;
void restartToSend(const char* why) {
  sdEvent(String("restarting to send trips (") + why + ")");
  flushReq = true;
  sendRestartAt = millis() + 1500;
}
// Upload now (Heep's button, 2.24, and the wheel menu's Send trips): ends the trip if there is one, then restarts and
// sends every trip and GPS track that's waiting, however long it takes, with the bar on the screen. It joins any of
// your saved networks, hotspots that hide from a scan included. Returns why it can't, or "" when it's on its way.
String uploadNow(const char* from, int& nTrips, int& nTracks) {
  nTrips = nTracks = 0;
  if (speedNow() > 3) return "not while driving: stop first";
  if (!cfg.netCount) return "no Wi-Fi saved: add one in T3 settings";
  if (!cfg.sheetUrl.length() && !cfg.trkUrl.length()) return "no trip sheet or track storage set up";
  if (trip.km >= 0.2 || trip.gpsKm >= 0.2) tripCommand("end", from);
  if (sd.ok) sdCountWaiting();
  nTrips = cfg.sheetUrl.length() ? queued : 0;
  nTracks = (sd.ok && cfg.trkUrl.length()) ? sd.tracksWaiting : 0;
  if (nTrips <= 0 && nTracks <= 0) return "nothing waiting: every trip and track is sent";
  Preferences p; p.begin("t3", false); p.putUChar("hsend", 2); p.end();   // 2 = asked for: no time limit, report back
  restartToSend(from);
  return "";
}
void sendTripsNow(const char* from) {
  int a, b;
  String why = uploadNow(from, a, b);
  flash(why.length() ? why.substring(0, 17) : String("Uploading..."));
}
void parkedTripEnded() { parkSendAt = millis() + 20000; }   // trip.ino: the trip ended because the Jeep was parked
// Got home: on one of your Wi-Fi networks that isn't a phone's hotspot, stopped for 5 s, with trips or tracks waiting.
// The T3 ends the trip and restarts, so bootSend has all the memory (the upload shows on the screen, then "Upload
// done"). Once per power-on: RTC memory survives the T3's own restart but not the key going off.
#define HOME_MAGIC 0x484F4D45UL
RTC_NOINIT_ATTR static uint32_t homeSent;
static uint32_t stillSince = 0, nudgedAt = 0;
bool isHotspot(String n) {
  n.toLowerCase();
  return n.indexOf("iphone") >= 0 || n.indexOf("ipad") >= 0 || n.indexOf("android") >= 0 || n.indexOf("hotspot") >= 0 ||
         n.indexOf("galaxy") >= 0 || n.indexOf("pixel") >= 0;
}
static void homeStep(uint32_t now) {
  bool waiting = (queued > 0 && cfg.sheetUrl.length()) || (sd.ok && sd.tracksWaiting > 0 && cfg.trkUrl.length());
  if (homeSent == HOME_MAGIC || sendRestartAt || !waiting || uploading || !cfg.netCount) { stillSince = 0; return; }
  if (speedNow() >= 3) { stillSince = 0; return; }     // (no speed known counts as stopped)
  if (!stillSince) { stillSince = now; return; }
  // just stopped and not on Wi-Fi: look now instead of waiting for the next try (at most every 2 minutes)
  if (wifiState == W_IDLE && now - stillSince > 3000 && (!nudgedAt || now - nudgedAt > 120000)) { nudgedAt = now; wifiNudge(true); }
  if (wifiState != W_ON || isHotspot(wifiName) || now - stillSince < 5000) return;
  homeSent = HOME_MAGIC;
  Preferences p; p.begin("t3", false); p.putUChar("hsend", 1); p.end();
  if (trip.km >= 0.2 || trip.gpsKm >= 0.2) tripCommand("end", "home Wi-Fi");
  restartToSend("home Wi-Fi");
}
static void sendStep() {
  uint32_t now = millis();
  homeStep(now);
  if (parkSendAt && (int32_t)(now - parkSendAt) >= 0) {
    if (uploading && now - parkSendAt < 60000) return;   // give a send that's under way a chance
    parkSendAt = 0;
    bool home = wifiLastOn && now - wifiLastOn < 180000;
    if (queued > 0 && cfg.sheetUrl.length() && home && !tripActive()) restartToSend("parked");
  }
  if (sendRestartAt && (int32_t)(now - sendRestartAt) >= 0 && !flushReq && !uploading) { delay(200); ESP.restart(); }
}

// loop(): once the trip is saved and any upload has finished (10 s at most), restart into the update
void bootUpdateStep() {
  sendStep();
  if (!bootUpdAt || (int32_t)(millis() - bootUpdAt) < 0 || flushReq) return;
  if (uploading && millis() - bootUpdAt < 10000) return;
  sdEvent("restarting to update over Wi-Fi");
  delay(200);
  ESP.restart();
}

static void bootShowAs(const char* title, const String& a, const String& b, int pct) {   // pct -1: no bar
  oled.setRotation(cfg.flip ? 2 : 0);
  oled.clearDisplay(); oled.setTextColor(SSD1306_WHITE); oled.setTextSize(1);
  oled.setCursor(0, 0); oled.print(title);
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);
  oled.setCursor(0, 16); oled.print(a.substring(0, 21));
  oled.setCursor(0, 28); oled.print(b.substring(0, 21));
  if (pct >= 0) { oled.drawRect(0, 46, 128, 10, SSD1306_WHITE); oled.fillRect(2, 48, 124 * constrain(pct, 0, 100) / 100, 6, SSD1306_WHITE); }
  oled.display();
}
static void bootShow(const String& a, const String& b, int pct) { bootShowAs("Update over Wi-Fi", a, b, pct); }


// join one of your saved networks, strongest first; blind = also try the ones a scan can't see (hotspots hide)
static String bootJoin(bool blind) {
  WiFi.mode(WIFI_STA);
  // your networks: the ones a scan sees first, strongest first; then the rest by name (hotspots hide from scans)
  int rssi[MAX_NETS], order[MAX_NETS], n = 0;
  String seenAs[MAX_NETS];   // the name exactly as it's broadcast (the saved one may differ in an apostrophe or capitals)
  for (int i = 0; i < cfg.netCount; i++) rssi[i] = -999;
  int found = WiFi.scanNetworks();
  for (int k = 0; k < found; k++)
    for (int i = 0; i < cfg.netCount; i++) if (ssidKey(WiFi.SSID(k)) == ssidKey(cfg.nets[i].ssid) && WiFi.RSSI(k) > rssi[i]) { rssi[i] = WiFi.RSSI(k); seenAs[i] = WiFi.SSID(k); }
  WiFi.scanDelete();
  for (int i = 0; i < cfg.netCount; i++) order[n++] = i;
  for (int a = 0; a < n; a++) for (int b = a + 1; b < n; b++) if (rssi[order[b]] > rssi[order[a]]) { int t = order[a]; order[a] = order[b]; order[b] = t; }
  String joined;
  for (int t = 0; t < n && t < 4 && !joined.length(); t++) {
    if (!blind && !seenAs[order[t]].length()) continue;   // quick: only networks in sight
    String ssid = seenAs[order[t]].length() ? seenAs[order[t]] : cfg.nets[order[t]].ssid;
    if (!ssid.length()) continue;
    if (blind && bootUp) upSet("Uploading", "joining " + ssid, "any button: hide", -1);   // (the start-up upload: its own screen)
    else if (blind) bootShow("joining", ssid, -1);
    WiFi.begin(ssid.c_str(), cfg.nets[order[t]].pass.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < (blind ? 15000 : 10000)) delay(100);
    if (WiFi.status() == WL_CONNECTED) joined = ssid;
    else { WiFi.disconnect(); delay(300); }
  }
  return joined;
}

// the update itself: only comes back if it didn't install (the answer says why)
static String bootUpdateRun() {
  if (!cfg.netCount) return "no Wi-Fi saved";
  bootShow("looking for Wi-Fi...", "", -1);
  String joined = bootJoin(true);
  if (!joined.length()) return "couldn't join your Wi-Fi";
  bootShow("on " + joined, "asking Heep update server...", -1);
  String body, why;
  for (int attempt = 0; attempt < 3 && !body.length(); attempt++) {
    if (attempt) { bootShow("on " + joined, "asking Heep update server (" + String(attempt + 1) + "/3)", -1); delay(2000); }
    WiFiClientSecure tls;
    tls.setInsecure();
    tls.setHandshakeTimeout(20);
    HTTPClient http;
    http.setConnectTimeout(15000);
    http.setTimeout(15000);
    if (!http.begin(tls, String(UPDATE_JSON) + "?t=" + String(millis()))) { why = "bad address"; continue; }
    int code = http.GET();
    if (code == 200) body = http.getString();
    else why = code < 0 ? HTTPClient::errorToString(code) : "Heep update server said " + String(code);
    http.end();
  }
  String v = jStr(body, "v"), url = jStr(body, "url");
  if (!v.length() || !url.length())
    return "couldn't reach Heep update server: " + (why.length() ? why : String("no answer")) + " (" + String(WiFi.RSSI()) + " dBm, " + String(ESP.getFreeHeap() / 1024) + " KB free)";
  if (!verNewer(v, FW)) return "up to date (" FW ")";
  if (v == badVersion) return v + " failed before; waiting for a newer one";
  bootShow("downloading " + v, "keep the key on", 0);
  HTTPUpdate up(30000);   // a slow hotspot can pause for a while mid-download
  up.rebootOnUpdate(false);
  int shown = -1;
  up.onProgress([&](int cur, int total) {
    int pct = total > 0 ? (int)((int64_t)cur * 100 / total) : 0;
    if (pct / 2 != shown) { shown = pct / 2; bootShow("downloading " + v, String(pct) + "%  keep the key on", pct); }
  });
  WiFiClientSecure tls;
  tls.setInsecure();
  tls.setHandshakeTimeout(20);
  t_httpUpdate_return r = up.update(tls, url);
  if (r == HTTP_UPDATE_OK) {
    markUpdateTry(v);   // counts against v only now that it's all in flash
    bootShow("installed " + v, "restarting...", 100);
    delay(1000);
    ESP.restart();
  }
  return r == HTTP_UPDATE_NO_UPDATES ? String("up to date") : "download failed: " + up.getLastErrorString();
}

// at start-up (T3.ino setup, before Bluetooth and the rest): the update asked for above
void bootUpdate() {
  Preferences p; p.begin("t3", false);
  uint8_t ub = p.getUChar("ub", 0);
  if (ub) p.remove("ub");   // cleared before trying: whatever happens in there, the next start is a normal one
  p.end();
  if (!ub) return;
  String why = bootUpdateRun();
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  updStatus.set(why);
  updPhase = why.startsWith("up to date") ? UP_CURRENT : UP_FAIL; updPhaseAt = millis();
  bootUpdNote = "update over Wi-Fi: " + why;   // into the card's event log once it's started (T3.ino)
  oled.clearDisplay(); oled.setCursor(0, 0); oled.print("Jeep T3 " FW "\n" + why.substring(0, 80)); oled.display();
  delay(2500);   // long enough to read
}

// at start-up (2.26): trips waiting for the sheet, then GPS tracks waiting for the track store, go up in the
// background while the T3 starts as usual (screens, GPS, the card, the wheel buttons). Bluetooth (the iCar and Heep)
// waits until it's over, because the secure connection to Google needs ~50 KB of memory in one piece. It keeps going
// until everything is up or the Wi-Fi is gone (driving away): no time limit. The T3 remembers where a track got to,
// so whatever doesn't go now carries on next time; what's gone is marked sent and never goes again.
//   - key-on: only networks in sight, quietly; "Uploading" with a bar shows once something actually goes up
//   - arrived home or asked for (Heep's Upload now, the wheel menu): the same, hidden hotspots tried too when asked
// Any wheel button hides the upload screen (the upload carries on); "Upload done" flashes when it finishes.
volatile bool bootUp = false;          // the start-up upload is running (loop: Wi-Fi and Bluetooth wait for it)
volatile bool upScreen = false;        // its screen is showing
static volatile uint32_t upUntil = 0;  // the end screen goes at this millis() (0: still going)
static volatile int upPctShown = -1;
static char upTitle[24], upWhat[32], upSub[32], upWhy[32];
static volatile bool upFlashDone = false;
static char upDoneText[24];
static uint32_t upTotal = 0, upDone = 0;
static int upN = 0, upSent = 0;
static bool upAsked = false, upHome = false;
static void upSet(const char* title, const String& what, const String& sub, int pct) {
  strlcpy(upTitle, title, sizeof(upTitle)); strlcpy(upWhat, what.c_str(), sizeof(upWhat)); strlcpy(upSub, sub.c_str(), sizeof(upSub));
  upWhy[0] = 0;
  upPctShown = pct;
}
static void upShow(const String& what) {
  int pct = upTotal ? (int)min((uint64_t)100, (uint64_t)upDone * 100 / upTotal) : 0;
  upSet("Uploading", what, String(pct) + "%  any button: hide", pct);
}
static void upPart(uint32_t bytes) {
  upDone += bytes;
  upShow(upN > 1 ? "trip " + String(min(upSent + 1, upN)) + " of " + String(upN) : String("GPS track"));
}
// display.ino: the upload screen instead of your screens while it's showing
bool upScreenDraw() {
  if (!upScreen) return false;
  if (upUntil && (int32_t)(millis() - upUntil) >= 0) { upScreen = false; upUntil = 0; return false; }
  oled.setFont(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0); oled.print(upTitle);
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);
  oled.setCursor(0, 16); oled.print(upWhat);
  oled.setCursor(0, 28); oled.print(upSub);
  if (upWhy[0]) { oled.setCursor(0, 40); oled.print(upWhy); }
  int pct = upPctShown;
  if (pct >= 0) { oled.drawRect(0, 46, 128, 10, SSD1306_WHITE); oled.fillRect(2, 48, 124 * constrain(pct, 0, 100) / 100, 6, SSD1306_WHITE); }
  return true;
}
// wheel.ino: any button while it shows hides it; the upload carries on
bool upScreenHide() {
  if (!upScreen) return false;
  upScreen = false; upUntil = 0;
  if (bootUp) flash("Uploading behind");
  return true;
}
// why an upload stopped short, in two lines of 21 characters for the screen: what went wrong, and what to do
static void upWhyText(bool tripsLeft, String& why, String& fix) {
  String t = tripsLeft ? String(lastUpload) : String(trkStatus);
  if (WiFi.status() != WL_CONNECTED) { why = "Wi-Fi lost"; fix = "rest next time"; }
  else if (t.indexOf("key wrong") >= 0) { why = tripsLeft ? "sheet key wrong" : "track key wrong"; fix = "Heep: Send settings"; }
  else if (t.indexOf("not confirmed") >= 0) { why = "store lost a part"; fix = "resends next time"; }
  else if (t.indexOf("failed") >= 0) {
    int a = t.indexOf('('), b = t.indexOf(',', a);
    why = "send failed" + (a > 0 && b > a ? " (" + t.substring(a + 1, b) + ")" : String(""));
    fix = "tries again next time";
  } else { why = "rest next time"; fix = "on your Wi-Fi"; }
}
static void bootSendTask(void*) {
  String joined = bootJoin(upAsked);                     // asked for: hotspots that hide from a scan are tried too
  if (!joined.length()) {
    bootNote = "uploads at start: no Wi-Fi in sight";
    if (upAsked) { uplNote = "couldn't join your Wi-Fi: nothing was sent"; upSet("Upload failed", "couldn't join Wi-Fi", "nothing was sent", -1); upScreen = true; upUntil = millis() + 3000; }
    WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
    bootUp = false;
    vTaskDelete(nullptr);
    return;
  }
  if (!timeSrc) {   // the trip times are kept; this is only for a trip that never had a clock
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    struct tm tmv; if (getLocalTime(&tmv, 3000)) { struct timeval tv; gettimeofday(&tv, nullptr); setClock((int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000, 'n'); }
  }
  bool trips = queued > 0 && cfg.sheetUrl.length();
  bool tracks = sd.ok && sd.tracksWaiting > 0 && cfg.trkUrl.length();
  int tripsBefore = queued;
  uint32_t heapAtStart = ESP.getFreeHeap() / 1024, blockAtStart = ESP.getMaxAllocHeap() / 1024;
  upTotal = tracks ? sdWaitingBytes(&upN) : 0; upDone = 0; upSent = 0;
  if (!upAsked) upScreen = true;                         // quiet until now: something is going up
  if (trips) {
    upShow("trips to Jeep log");
    uploadTrips(cfg.sheetUrl, cfg.sheetKey);
    bootNote = "trips at start: " + String(lastUpload);
  }
  if (tracks) {
    upShow("finding the house receiver");
    bool viaHouse = findHouseReceiver();                 // 2.32: hand the tracks to it if it's there
    upPart(0);
    while (WiFi.status() == WL_CONNECTED && sd.tracksWaiting > 0) {
      int sent = uploadTracks(cfg.trkUrl, cfg.trkKey, 0, viaHouse ? 250 : 120, upPart);
      upSent += sent;
      sdCountWaiting();
      if (!sent) break;                                   // refused, or the Wi-Fi went: the rest next time
    }
    bootNote += String(bootNote.length() ? "; " : "") + "tracks at start: " + String(upSent) + " sent, " + String(sd.tracksWaiting) +
                " waiting (" + String(trkStatus) + ")" + (upHome ? " [home]" : "") + (upAsked ? " [asked]" : "") +
                " [" + String(heapAtStart) + " KB free, " + String(blockAtStart) + " KB block on Wi-Fi" + (viaHouse ? ", via the house receiver" : "") + "]";
    trkGateway = IPAddress();                            // only at start: driving tries go straight to Google
  }
  bool allDone = (!trips || queued == 0) && (!tracks || sd.tracksWaiting == 0);
  if (upAsked) {
    int tripsSent = trips ? tripsBefore - queued : 0;
    String s = "sent " + String(tripsSent) + (tripsSent == 1 ? " trip" : " trips") + " and " + String(upSent) + (upSent == 1 ? " track" : " tracks");
    if (!allDone) s += "; still waiting: " + String(trips ? queued : 0) + " trips, " + String(tracks ? sd.tracksWaiting : 0) + " tracks (" +
                       (trips && queued ? String(lastUpload) : String(trkStatus)) + ")";
    uplNote = s;
  }
  String done = allDone ? String(upSent ? String(upSent) + (upSent == 1 ? " trip's track" : " trips' tracks") : String("trips")) + " sent"
                        : (tracks ? String(sd.tracksWaiting) + " track" + (sd.tracksWaiting == 1 ? "" : "s") + " to go" : String("trips to go"));
  // paused: say why on the screen (2.27), so a wrong track key doesn't look like "it just stops"
  String why = "", fix = "";
  if (!allDone) upWhyText(trips && queued, why, fix);
  if (upScreen) {
    upSet(allDone ? "Upload done" : "Upload paused", done, allDone ? String("") : why, allDone ? 100 : -1);
    if (!allDone) strlcpy(upWhy, fix.c_str(), sizeof(upWhy));
    upUntil = millis() + (allDone ? 3000 : 12000);
  }
  else { strlcpy(upDoneText, allDone ? "Upload done" : "Upload paused", sizeof(upDoneText)); upFlashDone = true; }
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  bootUp = false;
  vTaskDelete(nullptr);
}
// T3.ino setup(): starts the upload if there's anything to send (true = it's running, Bluetooth waits)
bool bootSend() {
  Preferences pr; pr.begin("t3", false);
  uint8_t hs = pr.getUChar("hsend", 0);                  // 1: got home (sendStep), 2: asked for (uploadNow)
  if (hs) pr.remove("hsend");
  pr.end();
  upHome = hs > 0; upAsked = hs == 2;
  bool trips = queued > 0 && cfg.sheetUrl.length();
  bool tracks = sd.ok && sd.tracksWaiting > 0 && cfg.trkUrl.length();
  if ((!trips && !tracks) || !cfg.netCount) { if (upAsked) uplNote = "nothing was waiting"; return false; }
  if (upAsked) { upSet("Uploading", "joining Wi-Fi...", "any button: hide", -1); upScreen = true; }
  bootUp = true;
  if (xTaskCreatePinnedToCore(bootSendTask, "bootsend", 16384, nullptr, 1, nullptr, 0) != pdPASS) { bootUp = false; upScreen = false; return false; }
  return true;
}
// loop(): an upload that finished behind your screens says so, and goes in the card's event log
void bootSendStep() {
  static bool logged = false;
  if (upFlashDone) { upFlashDone = false; flash(upDoneText); }
  if (!bootUp && !logged && bootNote.length()) { logged = true; sdEvent(bootNote); }
}
