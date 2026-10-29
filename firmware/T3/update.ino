// update.ino - "Update over Wi-Fi", done from a fresh start.
//
// Downloading from GitHub needs a secure connection, and that needs about 50 KB of memory in one piece. With
// Bluetooth (the iCar and Heep), Wi-Fi and the relay all running, the T3 often hasn't got that, and the update
// stops with "couldn't reach GitHub: connection refused". So an update over Wi-Fi restarts the T3 first and does
// the whole thing before Bluetooth and everything else start: join your Wi-Fi, ask GitHub for t3.json, download
// the new program, restart into it. The screen shows how far it is. If it can't, the T3 starts up as usual with the
// program it has and tells Heep why (the "upd" text in "hi").
//
// Only when you ask from Heep ("update"): the T3 never looks for updates by itself (2.9+).

static uint32_t bootUpdAt = 0;   // restart for the update at this millis() (0 = not asked)
String bootUpdNote;               // how the update at start-up went, for the event log
String bootNote;                  // how sending trips at start-up went, for the event log

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
// loop(): once the trip is saved and any upload has finished (10 s at most), restart into the update
void bootUpdateStep() {
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
    if (blind) bootShow("joining", ssid, -1); else bootShowAs("Sending trips", "joining", ssid, -1);
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
  bootShow("on " + joined, "asking GitHub...", -1);
  String body, why;
  for (int attempt = 0; attempt < 3 && !body.length(); attempt++) {
    if (attempt) { bootShow("on " + joined, "asking GitHub (" + String(attempt + 1) + "/3)", -1); delay(2000); }
    WiFiClientSecure tls;
    tls.setInsecure();
    tls.setHandshakeTimeout(20);
    HTTPClient http;
    http.setConnectTimeout(15000);
    http.setTimeout(15000);
    if (!http.begin(tls, String(UPDATE_JSON) + "?t=" + String(millis()))) { why = "bad address"; continue; }
    int code = http.GET();
    if (code == 200) body = http.getString();
    else why = code < 0 ? HTTPClient::errorToString(code) : "GitHub said " + String(code);
    http.end();
  }
  String v = jStr(body, "v"), url = jStr(body, "url");
  if (!v.length() || !url.length())
    return "couldn't reach GitHub: " + (why.length() ? why : String("no answer")) + " (" + String(WiFi.RSSI()) + " dBm, " + String(ESP.getFreeHeap() / 1024) + " KB free)";
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

// at key-on (T3.ino setup, after the last trip is finished and before Bluetooth): trips waiting for the sheet go now,
// while all the memory is free. With Bluetooth running the secure connection to Google often can't get the ~50 KB it
// needs, so trips sat on the T3. Only networks in sight, about 10 s at most when there's nothing to join.
void bootSend() {
  if (queued <= 0 || !cfg.sheetUrl.length() || !cfg.netCount) return;
  bootShowAs("Sending trips", String(queued) + (queued == 1 ? " trip" : " trips") + " waiting", "looking for Wi-Fi...", -1);
  String joined = bootJoin(false);
  if (joined.length()) {
    if (!timeSrc) {   // the trip times are kept; this is only for a trip that never had a clock
      configTime(0, 0, "pool.ntp.org", "time.google.com");
      struct tm tmv; if (getLocalTime(&tmv, 3000)) { struct timeval tv; gettimeofday(&tv, nullptr); setClock((int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000, 'n'); }
    }
    bootShowAs("Sending trips", "on " + joined, "sending...", -1);
    uploadTrips(cfg.sheetUrl, cfg.sheetKey);
    bootNote = "trips at start: " + String(lastUpload);
  } else bootNote = "trips at start: no Wi-Fi in sight";
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
}
