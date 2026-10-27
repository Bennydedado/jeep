// net.ino - Wi-Fi (home, the shop, the iPhone hotspot...), and what the T3 does while it's on:
//   - finished trips -> your Jeep log sheet (the same Apps Script Heep uses)
//   - GPS tracks from the SD card -> your track store (a second, small Apps Script: tracks/TrackStore.gs)
//   - a newer T3 program from GitHub -> installed, only while the Jeep is stopped
//   - live numbers -> the relay (encrypted with a key made from your sheet key), so Heep shows them in any
//     browser; Heep's commands <- the relay (signed with your sheet key, otherwise ignored)
//
// Wi-Fi is only switched on when there's something to do, scanning and joining are checked a step at a
// time, and it backs off when none of your networks is around. Uploads and updates run in their own task
// (on the other core) so the screen and wheel buttons keep working. That task never touches loop()'s
// Strings: it reports through taskEvent() and the Txt status buffers, and asks loop() to save the trip.

uint32_t lastUploadAt = 0;
static uint32_t wifiAt = 0, nextWifiTry = 15000, nextUpdateCheck = 20000, nextUploadTry = 0, wifiIdleSince = 0, mqttTry = 0, lastPub = 0, nextNtpAt = 0;
static volatile bool uploading = false, flushReq = false;
static WiFiClientSecure mqttTls;
static PubSubClient mqtt(mqttTls);
static int64_t lastNonce = 0;
static String subscribed, badVersion;
static QueueHandle_t evQ;
static uint8_t encKey[32];
static String encKeyFor;

// ---------------------------------------------------------------- what Heep's Wi-Fi page shows ({"c":"wifi"})
struct SeenNet { char ssid[33]; int8_t rssi; uint8_t ch; bool open; };
static SeenNet seenNets[16];
static int seenN = -1;                        // -1 = no scan yet
static uint32_t scanAt = 0, joinAt = 0, onSince = 0, wifiWantUntil = 0;
static volatile int wifiReason = 0;           // why the last join/connection ended (ESP-IDF reason code), set by the Wi-Fi task
static int lastReason = 0, blindNext = 0;
static String lastTrySsid, lastTryRes;        // the last network the T3 tried, and how it went
static uint32_t lastTryAt = 0;
static bool scanOnly = false, blindJoin = false;

const char* wifiReasonText(int r) {
  switch (r) {
    case 0: return "";
    case 2: case 14: case 15: case 23: case 202: case 204: return "wrong password?";
    case 201: return "not found (switched off, too far, or 5 GHz only)";
    case 210: case 211: return "found, but its security isn't supported (iPhone: turn on Maximize Compatibility)";
    case 212: return "signal too weak";
    case 4: case 200: return "lost the signal";
    case 203: case 205: return "it wouldn't let the T3 join";
    case 3: case 8: return "disconnected";
    default: return "didn't connect";
  }
}
// the last scan, kept for the Wi-Fi page (strongest first, no duplicates)
static void keepScan(int found) {
  seenN = 0; scanAt = millis();
  for (int k = 0; k < found; k++) {
    String nm = WiFi.SSID(k);
    if (!nm.length()) continue;
    int dup = -1;
    for (int i = 0; i < seenN; i++) if (!strcmp(seenNets[i].ssid, nm.c_str())) dup = i;
    int8_t rssi = (int8_t)WiFi.RSSI(k);
    if (dup >= 0) { if (rssi > seenNets[dup].rssi) seenNets[dup].rssi = rssi; continue; }
    if (seenN >= 16) continue;
    SeenNet& s = seenNets[seenN++];
    strlcpy(s.ssid, nm.c_str(), sizeof(s.ssid));
    s.rssi = rssi; s.ch = (uint8_t)WiFi.channel(k); s.open = WiFi.encryptionType(k) == WIFI_AUTH_OPEN;
  }
  for (int i = 1; i < seenN; i++) for (int k = i; k > 0 && seenNets[k].rssi > seenNets[k - 1].rssi; k--) { SeenNet t = seenNets[k]; seenNets[k] = seenNets[k - 1]; seenNets[k - 1] = t; }
}
// Heep's "Scan now": Wi-Fi on for a minute, look, and join one of yours if it's there
void wifiScanNow() {
  wifiWantUntil = millis() + 60000;
  nextWifiTry = 0;
  if (wifiState == W_ON && !scanOnly && !uploading) { WiFi.scanNetworks(true); scanOnly = true; }
}
String wifiJson() {
  uint32_t now = millis();
  String m = "{\"t\":\"wifi\",\"fw\":\"" FW "\",\"state\":\"" + jsonEsc(wifiNow) + "\",\"on\":" + String(wifiState == W_ON ? "true" : "false");
  if (wifiState == W_ON) m += ",\"ssid\":\"" + jsonEsc(wifiName) + "\",\"rssi\":" + String(WiFi.RSSI()) + ",\"ch\":" + String((int)WiFi.channel()) +
                              ",\"ip\":\"" + WiFi.localIP().toString() + "\",\"onFor\":" + String((now - onSince) / 1000);
  m += ",\"scanning\":" + String(wifiState == W_SCAN || scanOnly ? "true" : "false") + ",\"scanAgo\":" + String(seenN < 0 ? -1L : (long)((now - scanAt) / 1000)) + ",\"seen\":[";
  for (int i = 0; i < seenN; i++) m += String(i ? "," : "") + "[\"" + jsonEsc(seenNets[i].ssid) + "\"," + String((int)seenNets[i].rssi) + "," + String((int)seenNets[i].ch) + "," + String(seenNets[i].open ? 1 : 0) + "]";
  m += "],\"saved\":[";
  for (int i = 0; i < cfg.netCount; i++) m += String(i ? "," : "") + "\"" + jsonEsc(cfg.nets[i].ssid) + "\"";
  m += "]";
  if (lastTrySsid.length()) m += ",\"last\":{\"ssid\":\"" + jsonEsc(lastTrySsid) + "\",\"res\":\"" + jsonEsc(lastTryRes) + "\",\"reason\":" + String(lastReason) + ",\"ago\":" + String((now - lastTryAt) / 1000) + "}";
  m += ",\"relay\":" + String(relayUp() ? 1 : 0) + ",\"up\":\"" + jsonEsc(lastUpload) + "\",\"upd\":\"" + jsonEsc(updStatus) + "\",\"queued\":" + String(queued) + "}";
  return m;
}
static void tryDone(const String& res) { lastTrySsid = wifiName; lastTryRes = res; lastTryAt = millis(); }

void netBegin() {
  evQ = xQueueCreate(8, 96);
  // did the last update fail? "try" is set once a new program is fully downloaded, just before restarting into
  // it; if we're not that version now, it didn't last its first 20 s and the ESP32 went back to this one.
  // The T3 has no battery, so the key going off (or the starter dipping the power) in those 20 s looks the
  // same as a crash: a version only counts as bad after failing 3 times.
  Preferences p; p.begin("t3", false);
  String tried = p.getString("try", "");
  badVersion = p.getString("bad", "");
  if (tried.length() && tried != FW) {
    int fails = (p.getString("tryv", "") == tried ? p.getInt("tryn", 0) : 0) + 1;
    p.putString("tryv", tried); p.putInt("tryn", fails);
    if (fails >= 3) { badVersion = tried; p.putString("bad", tried); }
    p.remove("try");
  }
  lastNonce = p.getLong64("nonce", 0);
  p.end();
  WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t info) { wifiReason = info.wifi_sta_disconnected.reason; }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
}
// a new program is in flash and the T3 is about to restart into it (Wi-Fi or Bluetooth update)
void markUpdateTry(const String& v) { Preferences p; p.begin("t3", false); p.putString("try", v); p.end(); }
// called once the new program has run 20 s (T3.ino): it's a keeper
void updateConfirmed() { Preferences p; p.begin("t3", false); if (p.getString("try", "") == FW) { p.remove("try"); p.remove("tryv"); p.remove("tryn"); } p.end(); }

void wifiNudge(bool update) { nextWifiTry = 0; nextUploadTry = 0; if (update) nextUpdateCheck = 0; }
void wifiNudge() { wifiNudge(false); }
bool relayUp() { return mqtt.connected(); }
bool uploadBusy() { return uploading; }
void taskEvent(const String& what) { char b[96]; strlcpy(b, what.c_str(), sizeof(b)); if (evQ) xQueueSend(evQ, b, 0); }

// ---------------------------------------------------------------- the relay: encrypted out (AES-256-GCM), signed in
static void relayKey() {
  if (encKeyFor == cfg.sheetKey) return;
  String in = "heep-enc:" + cfg.sheetKey;
  mbedtls_sha256((const unsigned char*)in.c_str(), in.length(), encKey, 0);
  encKeyFor = cfg.sheetKey;
}
// {"e":"<base64 of 12-byte nonce + ciphertext + 16-byte tag>"}: the broker only ever sees noise
void relaySend(const String& line) {
  if (!mqtt.connected() || !liveTopic.length()) return;
  relayKey();
  size_t n = line.length();
  uint8_t* buf = (uint8_t*)malloc(12 + n + 16);
  if (!buf) return;
  esp_fill_random(buf, 12);
  mbedtls_gcm_context g;
  mbedtls_gcm_init(&g);
  bool ok = mbedtls_gcm_setkey(&g, MBEDTLS_CIPHER_ID_AES, encKey, 256) == 0 &&
            mbedtls_gcm_crypt_and_tag(&g, MBEDTLS_GCM_ENCRYPT, n, buf, 12, nullptr, 0, (const uint8_t*)line.c_str(), buf + 12, 16, buf + 12 + n) == 0;
  mbedtls_gcm_free(&g);
  if (ok) {
    size_t olen = 0, cap = (12 + n + 16 + 2) / 3 * 4 + 1;
    char* b64 = (char*)malloc(cap + 8);
    if (b64 && mbedtls_base64_encode((unsigned char*)b64, cap, &olen, buf, 12 + n + 16) == 0) {
      b64[olen] = 0;
      String msg = String("{\"e\":\"") + b64 + "\"}";
      mqtt.publish(liveTopic.c_str(), msg.c_str());
    }
    free(b64);
  }
  free(buf);
}

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

// "2.1" newer than "2.0.3"? (numbers compared part by part)
bool verNewer(const String& a, const String& b) {
  int i = 0, j = 0;
  while (i < (int)a.length() || j < (int)b.length()) {
    long x = 0, y = 0;
    while (i < (int)a.length() && a[i] != '.') { if (isDigit(a[i])) x = x * 10 + (a[i] - '0'); i++; }
    while (j < (int)b.length() && b[j] != '.') { if (isDigit(b[j])) y = y * 10 + (b[j] - '0'); j++; }
    if (x != y) return x > y;
    i++; j++;
  }
  return false;
}

// a newer T3 program on GitHub? Fetch it and restart into it (only while the Jeep is stopped)
void checkUpdate() {
  WiFiClientSecure tls;
  tls.setInsecure();
  HTTPClient http;
  String body;
  if (http.begin(tls, UPDATE_JSON)) { if (http.GET() == 200) body = http.getString(); http.end(); }
  String v = jStr(body, "v"), url = jStr(body, "url");
  if (!v.length() || !url.length()) { updStatus.set("couldn't check"); return; }
  if (!verNewer(v, FW)) { updStatus.set("up to date (" FW ")"); return; }   // never goes backwards
  if (v == badVersion) { updStatus.set(v + " failed before; waiting for a newer one"); return; }
  updStatus.set("updating to " + v);
  // loop() saves the trip so far and writes the card, then the download starts
  flushReq = true;
  for (int i = 0; i < 40 && flushReq; i++) vTaskDelay(pdMS_TO_TICKS(50));
  updating = true;
  // restart ourselves (not inside httpUpdate) so "try" is only written once the whole program is in flash:
  // a download cut short by the key never counts against that version
  httpUpdate.rebootOnUpdate(false);
  t_httpUpdate_return r = httpUpdate.update(tls, url);
  if (r == HTTP_UPDATE_OK) {
    markUpdateTry(v);
    delay(200);
    ESP.restart();
  }
  updating = false;
  updStatus.set(r == HTTP_UPDATE_NO_UPDATES ? "up to date" : "update failed");
  taskEvent("update: " + String(updStatus));
}

// finished trips -> the Jeep log sheet, as "put" operations with the same ids Heep uses (never twice)
void uploadTrips(const String& url, const String& key) {
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
  if (!n || !url.length()) return;
  String body;
  int code = httpPost(url, "{\"k\":\"" + jsonEsc(key) + "\",\"ops\":[" + ops + "]}", body);
  bool ok = code == 200 && body.indexOf("\"ok\":true") >= 0;
  lastUpload.set(ok ? "sent " + String(n) + (n == 1 ? " trip" : " trips") : (body.indexOf("key") >= 0 ? "sheet key wrong" : "send failed (" + String(code) + ")"));
  if (ok) { dropTrips(ids); lastUploadAt = millis(); } else nextUploadTry = millis() + 120000;
}

// GPS tracks from the SD card -> the track store, 100 rows per request. Each part can be sent again safely
// (the store replaces it); a trip only counts as uploaded when the store confirms every row arrived.
// A track the store keeps refusing doesn't hold up the others.
#define PART_ROWS 100
void uploadTracks(const String& url, const String& key) {
  if (!url.length() || !sd.ok) return;
  String ids[3];
  int n = sdWaitingIds(ids, 3);
  bool anyFail = false;
  for (int k = 0; k < n && wifiState == W_ON; k++) {
    const String& id = ids[k];
    int part = 0, total = 0, got = 0;
    uint32_t pos = 0;
    bool more = true, ok = true;
    while (more && ok && wifiState == W_ON) {
      String rows = sdTrackRows(id, &pos, PART_ROWS, &got, &more);
      if (!got) break;
      String body;
      int code = httpPost(url, "{\"k\":\"" + jsonEsc(key) + "\",\"op\":\"part\",\"id\":\"" + id + "\",\"p\":" + String(part) +
                          ",\"rows\":" + String(got) + ",\"csv\":\"" + jsonEsc(rows) + "\"}", body);
      ok = code == 200 && body.indexOf("\"ok\":true") >= 0;
      if (!ok) trkStatus.set(body.indexOf("\"key\"") >= 0 ? String("track store key wrong") : "track send failed (" + String(code) + ")");
      total += got; part++;
    }
    if (!ok || more) { anyFail = true; continue; }
    String body;
    int code = httpPost(url, "{\"k\":\"" + jsonEsc(key) + "\",\"op\":\"fin\",\"id\":\"" + id + "\",\"parts\":" + String(part) + ",\"rows\":" + String(total) +
                        ",\"head\":\"" + jsonEsc(String(TRACK_HEADER)) + "\",\"idx\":\"" + jsonEsc(sdIndexLine(id)) + "\"}", body);
    if (code == 200 && body.indexOf("\"ok\":true") >= 0 && (long)numField(body, "rows") == total) {
      sdMarkUploaded(id);
      trkStatus.set("sent " + id);
      taskEvent("track uploaded " + id + " (" + String(total) + " rows)");
    } else { trkStatus.set("track not confirmed (" + String(code) + ")"); anyFail = true; }
  }
  if (anyFail) nextUploadTry = millis() + 120000;
}

void uploadTask(void*) {
  // copies of what the task needs, taken while loop() can't be changing them
  xSemaphoreTake(cfgLock, portMAX_DELAY);
  String sUrl = cfg.sheetUrl, sKey = cfg.sheetKey, tUrl = cfg.trkUrl, tKey = cfg.trkKey;
  xSemaphoreGive(cfgLock);
  if (queued > 0) uploadTrips(sUrl, sKey);
  uploadTracks(tUrl, tKey);
  if (millis() >= nextUpdateCheck) {
    // only when the Jeep is known to be stopped (or nothing at all can tell its speed)
    float v = speedNow();
    bool stopped = (v >= 0 && v <= 1 && !engineOn()) || (v < 0 && !obdLinked && gps.state <= G_NOISE);
    if (stopped) { nextUpdateCheck = millis() + 6UL * 3600 * 1000; checkUpdate(); }
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
  if (!timeSrc) return;   // no clock yet: can't tell a fresh command from a recorded one
  String j; j.reserve(len + 1);
  for (unsigned int i = 0; i < len; i++) j += (char)payload[i];
  int64_t n = llField(j, "n");
  String m = jStr(j, "m"), h = jStr(j, "h");
  if (!m.length() || h.length() != 64 || n <= lastNonce) return;
  if (llabs(n - nowMs()) > 10LL * 60 * 1000) return;   // too old or from the future: a replay
  String msg = ll(n) + "|" + m;
  unsigned char mac[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), (const unsigned char*)cfg.sheetKey.c_str(), cfg.sheetKey.length(),
                  (const unsigned char*)msg.c_str(), msg.length(), mac);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", mac[i]);
  if (h != String(hex)) return;
  lastNonce = n;
  Preferences p; p.begin("t3", false); p.putLong64("nonce", n); p.end();
  onCommand(m, 1);
}

// things the upload task asked loop() to do
static void netChores() {
  char b[96];
  while (evQ && xQueueReceive(evQ, b, 0) == pdTRUE) sdEvent(String(b));
  if (flushReq) { snapshot(); sdFlush(); flushReq = false; }
}

void wifiStep() {
  netChores();
  if (otaMode) return;                                               // an update over Bluetooth has the radio
  uint32_t now = millis();
  bool asked = now < wifiWantUntil;                                  // Heep's Wi-Fi page asked for a look
  bool want = uploadWanted() || now >= nextUpdateCheck || liveWanted() || asked;
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
      keepScan(found);
      WiFi.scanDelete();
      blindJoin = pick < 0;
      if (pick < 0) {
        // none of yours in the scan. An iPhone hotspot often stops showing up in scans while it still lets known
        // devices join, so ask for one of yours by name anyway (a different one each time round).
        pick = blindNext++ % cfg.netCount;
      }
      wifiName = cfg.nets[pick].ssid;
      wifiReason = 0;
      WiFi.begin(cfg.nets[pick].ssid.c_str(), cfg.nets[pick].pass.c_str());
      wifiState = W_JOIN; wifiAt = joinAt = now;
      wifiNow = blindJoin ? "none of yours seen; asking for " + wifiName + " by name" : "joining " + wifiName;
      return;
    }
    case W_JOIN: {
      if (WiFi.status() == WL_CONNECTED) {
        if (timeSrc != 'g') configTime(0, 0, "pool.ntp.org", "time.google.com");   // answers arrive by themselves
        wifiState = W_ON; wifiIdleSince = 0; wifiNow = "on " + wifiName; nextNtpAt = now + 2000; onSince = now;
        lastReason = 0; tryDone("joined");
        return;
      }
      // the Wi-Fi task said why it failed: give it a moment in case it gets in anyway, then say so
      int why = wifiReason;
      if ((why && now - wifiAt > 4000) || now - wifiAt > 15000) {
        lastReason = why;
        String res = why ? String(wifiReasonText(why)) : String("no answer");
        tryDone(res + (blindJoin ? " (wasn't in the scan)" : ""));
        wifiNow = "couldn't join " + wifiName + ": " + res;
        lastUpload.set("couldn't join " + wifiName);
        wifiOff(asked ? 5000 : liveWanted() ? 30000 : 90000);
      }
      return;
    }
    case W_ON:
      if (WiFi.status() != WL_CONNECTED) {
        lastReason = wifiReason; tryDone(String("dropped: ") + wifiReasonText(wifiReason));
        wifiNow = "lost " + wifiName; scanOnly = false; wifiOff(5000); return;
      }
      if (scanOnly) {   // Heep's "Scan now" while already on: look around without dropping the connection
        int found = WiFi.scanComplete();
        if (found != WIFI_SCAN_RUNNING) { if (found >= 0) keepScan(found); WiFi.scanDelete(); scanOnly = false; }
      }
      // internet time, once a minute, to the millisecond (the GPS's time wins when there is one)
      if (timeSrc != 'g' && now >= nextNtpAt) {
        nextNtpAt = now + 60000;
        struct timeval tv; gettimeofday(&tv, nullptr);
        if (tv.tv_sec > 1600000000) setClock((int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000, 'n');
        else nextNtpAt = now + 2000;
      }
      if (uploading) return;                                          // the upload has the connection (and the memory) to itself
      if (!scanOnly && (uploadWanted() || now >= nextUpdateCheck)) {
        if (mqtt.connected()) mqtt.disconnect();
        uploading = true;
        if (xTaskCreatePinnedToCore(uploadTask, "upload", 16384, nullptr, 1, nullptr, 0) != pdPASS) { uploading = false; nextUploadTry = now + 60000; }
        return;
      }
      if (liveWanted()) {
        wifiIdleSince = 0;
        if (mqtt.connected() && subscribed != cmdTopic) mqtt.disconnect();   // the sheet key changed: listen on the new channel
        if (!mqtt.connected()) {
          if (now - mqttTry < 10000) return;
          mqttTry = now;
          mqttTls.setInsecure();
          mqttTls.setConnectionTimeout(4000);
          mqttTls.setHandshakeTimeout(6);
          mqtt.setServer(RELAY_HOST, RELAY_PORT);
          mqtt.setBufferSize(2048);
          mqtt.setSocketTimeout(4);
          mqtt.setCallback(onRelay);
          String id = "jeep-t3-" + String((uint32_t)ESP.getEfuseMac(), HEX);
          if (mqtt.connect(id.c_str()) && mqtt.subscribe(cmdTopic.c_str())) subscribed = cmdTopic;
          return;
        }
        mqtt.loop();
        if (now - lastPub >= 1000) { lastPub = now; relaySend(liveJson()); }
        return;
      }
      if (mqtt.connected()) mqtt.disconnect();
      if (asked || scanOnly) { wifiIdleSince = 0; return; }           // Heep's Wi-Fi page is watching: stay on
      if (!wifiIdleSince) wifiIdleSince = now;
      if (now - wifiIdleSince > 60000) { wifiNow = "off (nothing to send)"; wifiOff(30000); }
      return;
  }
}
