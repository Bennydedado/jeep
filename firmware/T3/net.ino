// net.ino - Wi-Fi (home, the shop, the iPhone hotspot...), and what the T3 does while it's on:
//   - finished trips -> your Jeep log sheet (the same Apps Script Heep uses)
//   - GPS tracks from the SD card -> your track store (a second, small Apps Script: tracks/TrackStore.gs)
//   - a newer T3 program from GitHub -> installed, only while the Jeep is stopped
//   - live numbers -> the relay, so Heep shows them in any browser; Heep's commands <- the relay (signed)
//
// Wi-Fi is only switched on when there's something to do, never blocks the loop (scan and join are
// checked a step at a time), and backs off when none of your networks is around. Uploads and updates run
// in their own task, so the screen and wheel buttons keep working while they do.

uint32_t lastUploadAt = 0;
static uint32_t wifiAt = 0, nextWifiTry = 15000, nextUpdateCheck = 20000, nextUploadTry = 0, wifiIdleSince = 0, mqttTry = 0, lastPub = 0;
static volatile bool uploading = false;
static WiFiClientSecure mqttTls;
static PubSubClient mqtt(mqttTls);
static int64_t lastNonce = 0;

void wifiNudge(bool update) { nextWifiTry = 0; nextUploadTry = 0; if (update) nextUpdateCheck = 0; }
void wifiNudge() { wifiNudge(false); }
bool relayUp() { return mqtt.connected(); }
void relaySend(const String& line) { if (mqtt.connected() && liveTopic.length()) mqtt.publish(liveTopic.c_str(), line.c_str()); }

// ---------------------------------------------------------------- https POST (Apps Script answers from a second address)
int httpPost(const String& url, const String& body, String& out) {
  WiFiClientSecure tls;
  tls.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.setTimeout(25000);
  if (!http.begin(tls, url)) return -100;
  http.addHeader("Content-Type", "text/plain");
  int code = http.POST(body);
  out = code > 0 ? http.getString() : "";
  http.end();
  return code;
}

// a newer T3 program on GitHub? Fetch it and restart into it (only while the Jeep is stopped)
void checkUpdate() {
  WiFiClientSecure tls;
  tls.setInsecure();
  HTTPClient http;
  String body;
  if (http.begin(tls, UPDATE_JSON)) { if (http.GET() == 200) body = http.getString(); http.end(); }
  String v = jStr(body, "v"), url = jStr(body, "url");
  if (!v.length() || !url.length()) { updStatus = "couldn't check"; return; }
  if (v == FW) { updStatus = "up to date"; return; }
  updStatus = "updating to " + v;
  updating = true;
  snapshot();                              // the trip so far is safe in flash; it carries on after the restart
  sdFlush();
  sdEvent("updating to " + v);
  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return r = httpUpdate.update(tls, url);
  updating = false;
  updStatus = r == HTTP_UPDATE_NO_UPDATES ? "up to date" : "update failed";
  sdEvent("update: " + updStatus);
}

// finished trips -> the Jeep log sheet, as "put" operations with the same ids Heep uses (never twice)
void uploadTrips() {
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
  if (!n || !cfg.sheetUrl.length()) return;
  String body;
  int code = httpPost(cfg.sheetUrl, "{\"k\":\"" + cfg.sheetKey + "\",\"ops\":[" + ops + "]}", body);
  bool ok = code == 200 && body.indexOf("\"ok\":true") >= 0;
  lastUpload = ok ? "sent " + String(n) + (n == 1 ? " trip" : " trips") : (body.indexOf("key") >= 0 ? "sheet key wrong" : "send failed (" + String(code) + ")");
  if (ok) { dropTrips(ids); lastUploadAt = millis(); } else nextUploadTry = millis() + 120000;
}

// GPS tracks from the SD card -> the track store, 200 rows per request. Each part can be sent again
// safely (the store replaces it); a trip only counts as uploaded when the store confirms every row.
void uploadTracks() {
  if (!cfg.trkUrl.length() || !sd.ok) return;
  String ids[3];
  int n = sdWaitingIds(ids, 3);
  for (int k = 0; k < n; k++) {
    const String& id = ids[k];
    int part = 0, total = 0, got = 0;
    bool more = true, ok = true;
    while (more && ok && wifiState == W_ON) {
      String rows = sdTrackRows(id, part * 200, 200, &got, &more);
      if (!got) break;
      String body;
      int code = httpPost(cfg.trkUrl, "{\"k\":\"" + jsonEsc(cfg.trkKey) + "\",\"op\":\"part\",\"id\":\"" + id + "\",\"p\":" + String(part) +
                          ",\"rows\":" + String(got) + ",\"csv\":\"" + jsonEsc(rows) + "\"}", body);
      ok = code == 200 && body.indexOf("\"ok\":true") >= 0;
      if (!ok) trkStatus = body.indexOf("key") >= 0 ? "track store key wrong" : "track send failed (" + String(code) + ")";
      total += got; part++;
    }
    if (!ok) { nextUploadTry = millis() + 120000; return; }
    String body;
    int code = httpPost(cfg.trkUrl, "{\"k\":\"" + jsonEsc(cfg.trkKey) + "\",\"op\":\"fin\",\"id\":\"" + id + "\",\"parts\":" + String(part) + ",\"rows\":" + String(total) +
                        ",\"head\":\"" + jsonEsc(String(TRACK_HEADER)) + "\",\"idx\":\"" + jsonEsc(sdIndexLine(id)) + "\"}", body);
    if (code == 200 && body.indexOf("\"ok\":true") >= 0 && (long)numField(body, "rows") == total) {
      sdMarkUploaded(id);
      trkStatus = "sent " + id;
      sdEvent("track uploaded " + id + " (" + String(total) + " rows)");
    } else { trkStatus = "track not confirmed (" + String(code) + ")"; nextUploadTry = millis() + 120000; return; }
  }
}

void uploadTask(void*) {
  if (queued > 0) uploadTrips();
  uploadTracks();
  if (millis() >= nextUpdateCheck) {
    if (speedNow() <= 1 && !engineOn()) { nextUpdateCheck = millis() + 6UL * 3600 * 1000; checkUpdate(); }
    else nextUpdateCheck = millis() + 10UL * 60 * 1000;   // moving: try again in a bit
  }
  if (nextUploadTry < millis() + 1000) nextUploadTry = millis() + 60000;   // done for now; look again in a minute
  uploading = false;
  vTaskDelete(nullptr);
}

String ssidKey(String v) { v.replace("\xE2\x80\x99", "'"); v.replace("\xE2\x80\x98", "'"); v.trim(); v.toLowerCase(); return v; }
// live numbers over Wi-Fi while driving, and for the first 10 minutes after key-on (so Heep can reach a parked T3)
bool liveWanted() { static uint32_t activeAt = 0; if (tripActive()) activeAt = millis(); return cfg.liveWifi && liveTopic.length() && (millis() < 600000 || millis() - activeAt < 300000); }
bool uploadWanted() { return ((queued > 0 && cfg.sheetUrl.length()) || (sd.tracksWaiting > 0 && cfg.trkUrl.length())) && millis() >= nextUploadTry; }
void wifiOff(uint32_t retryIn) {
  if (mqtt.connected()) mqtt.disconnect();
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  wifiState = W_IDLE; nextWifiTry = millis() + retryIn;
}

// ---------------------------------------------------------------- Heep's commands over the relay: only if signed with your sheet key
void onRelay(char* topic, byte* payload, unsigned int len) {
  String j; j.reserve(len + 1);
  for (unsigned int i = 0; i < len; i++) j += (char)payload[i];
  int64_t n = llField(j, "n");
  String m = jStr(j, "m"), h = jStr(j, "h");
  if (!m.length() || h.length() != 64 || n <= lastNonce) return;
  if (timeSrc && llabs(n - nowMs()) > 10LL * 60 * 1000) return;   // too old or from the future: a replay
  String msg = ll(n) + "|" + m;
  unsigned char mac[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), (const unsigned char*)cfg.sheetKey.c_str(), cfg.sheetKey.length(),
                  (const unsigned char*)msg.c_str(), msg.length(), mac);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", mac[i]);
  if (h != String(hex)) return;
  lastNonce = n;
  onCommand(m, 1);
}

void wifiStep() {
  uint32_t now = millis();
  bool want = uploadWanted() || now >= nextUpdateCheck || liveWanted();
  switch (wifiState) {
    case W_IDLE:
      if (!want || cfg.netCount == 0 || now < nextWifiTry) return;
      WiFi.mode(WIFI_STA);
      WiFi.scanNetworks(true);
      wifiState = W_SCAN; wifiAt = now; wifiNow = "looking";
      return;
    case W_SCAN: {
      int found = WiFi.scanComplete();
      if (found == WIFI_SCAN_RUNNING && now - wifiAt < 10000) return;
      int pick = -1;
      for (int i = 0; i < cfg.netCount && pick < 0; i++)                 // in the order you listed them in Heep
        for (int k = 0; k < found; k++) if (ssidKey(WiFi.SSID(k)) == ssidKey(cfg.nets[i].ssid)) { pick = i; break; }
      // nearby networks (what the scan saw, not who is connected to them)
      wifiSeen = "";
      for (int k = 0, n = 0; k < found && n < 8; k++) { String nm = WiFi.SSID(k); if (nm.length() && wifiSeen.indexOf(nm) < 0) { wifiSeen += (n++ ? ", " : "") + nm + " (" + String(WiFi.RSSI(k)) + ")"; } }
      if (found <= 0) wifiSeen = "no Wi-Fi at all";
      WiFi.scanDelete();
      if (pick < 0) { wifiNow = "none of yours in range"; wifiOff(liveWanted() ? 30000 : 90000); return; }
      wifiName = cfg.nets[pick].ssid;
      WiFi.begin(cfg.nets[pick].ssid.c_str(), cfg.nets[pick].pass.c_str());
      wifiState = W_JOIN; wifiAt = now; wifiNow = "joining " + wifiName;
      return;
    }
    case W_JOIN:
      if (WiFi.status() == WL_CONNECTED) {
        if (timeSrc != 'g') configTime(0, 0, "pool.ntp.org", "time.google.com");   // answers arrive by themselves
        wifiState = W_ON; wifiIdleSince = 0; wifiNow = "on " + wifiName;
      } else if (now - wifiAt > 15000) { lastUpload = "couldn't join " + wifiName; wifiNow = "couldn't join " + wifiName + " (password?)"; wifiOff(liveWanted() ? 30000 : 90000); }
      return;
    case W_ON:
      if (WiFi.status() != WL_CONNECTED) { wifiNow = "lost " + wifiName; wifiOff(5000); return; }
      if (timeSrc != 'g') { struct tm tmv; if (getLocalTime(&tmv, 0)) { time_t t; time(&t); setClock((int64_t)t * 1000, 'n'); } }
      if (uploading) { if (mqtt.connected()) mqtt.loop(); return; }
      if (uploadWanted() || now >= nextUpdateCheck) {
        uploading = true;
        xTaskCreatePinnedToCore(uploadTask, "upload", 16384, nullptr, 1, nullptr, 0);
        return;
      }
      if (liveWanted()) {
        wifiIdleSince = 0;
        if (!mqtt.connected()) {
          if (now - mqttTry < 10000) return;
          mqttTry = now;
          mqttTls.setInsecure();
          mqttTls.setTimeout(5);
          mqtt.setServer(RELAY_HOST, RELAY_PORT);
          mqtt.setBufferSize(2048);
          mqtt.setCallback(onRelay);
          String id = "jeep-t3-" + String((uint32_t)ESP.getEfuseMac(), HEX);
          if (mqtt.connect(id.c_str())) mqtt.subscribe(cmdTopic.c_str());
          return;
        }
        mqtt.loop();
        if (now - lastPub >= 1000) { lastPub = now; relaySend(liveJson()); }
        return;
      }
      if (mqtt.connected()) mqtt.disconnect();
      if (!wifiIdleSince) wifiIdleSince = now;
      if (now - wifiIdleSince > 60000) { wifiNow = "off (nothing to send)"; wifiOff(30000); }
      return;
  }
}
