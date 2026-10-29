// net.ino - Wi-Fi (home, the shop, the iPhone hotspot...), and what the T3 does while it's on:
//   - finished trips -> your Jeep log sheet (the same Apps Script Heep uses)
//   - GPS tracks from the SD card -> your track store (a second, small Apps Script: tracks/TrackStore.gs)
//   - (a newer T3 program: only when you ask from Heep, see update.ino)
//   - live numbers -> the relay (encrypted with a key made from your sheet key), so Heep shows them in any
//     browser; Heep's commands <- the relay (signed with your sheet key, otherwise ignored)
//
// Wi-Fi is only switched on when there's something to do, scanning and joining are checked a step at a
// time, and it backs off when none of your networks is around. Uploads and updates run in their own task
// (on the other core) so the screen and wheel buttons keep working. That task never touches loop()'s
// Strings: it reports through taskEvent() and the Txt status buffers, and asks loop() to save the trip.

uint32_t lastUploadAt = 0;
static uint32_t wifiAt = 0, nextWifiTry = 15000, nextUploadTry = 0, wifiIdleSince = 0, mqttTry = 0, lastPub = 0, nextNtpAt = 0;
static volatile bool uploading = false, flushReq = false;
// The relay goes over plain MQTT (port 1883) by default: everything on it is already sealed end to end (live numbers
// AES-GCM with a key from your sheet key, commands signed with it), and a TLS connection needs ~40 KB of memory the T3
// often hasn't got with Bluetooth running (it then never got on the relay). Two failures in a row: TLS (8883) next.
static WiFiClient mqttTcp;
static WiFiClientSecure mqttTls;
static PubSubClient mqtt(mqttTcp);
static bool relayTls = false;
static int relayFails = 0;
static Txt relayTxt;                 // how the relay is doing, for Heep's Wi-Fi page and Diagnostics
static uint32_t relayCmds = 0, relayRefused = 0;
static Txt relayRefusedWhy;
static int64_t lastNonce = 0;
static volatile bool relayBusy = false;       // a relay connection attempt is running in its own task (loop() keeps its hands off mqtt)
static uint32_t watchedAt = 0, nonceSavedAt = 0;
// "Update over Wi-Fi" progress for Heep: written by the upload task, reported by loop() over Bluetooth and the relay
enum UpdPhase { UP_NONE, UP_WAIT, UP_CHECK, UP_DOWNLOAD, UP_DONE, UP_FAIL, UP_CURRENT, UP_RESTART };
static volatile int updPhase = UP_NONE, updPct = -1;
static Txt updVer;
static uint32_t updPhaseAt = 0;
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
  m += ",\"relay\":" + String(relayUp() ? 1 : 0) + ",\"relayTxt\":\"" + jsonEsc(relayStatus()) + "\",\"up\":\"" + jsonEsc(lastUpload) + "\",\"upd\":\"" + jsonEsc(updStatus) + "\",\"queued\":" + String(queued) + "}";
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

void wifiNudge(bool) { nextWifiTry = 0; nextUploadTry = 0; }
// Heep (in Safari, through the relay) says it's watching: send live numbers for the next 90 s even when parked
void relayWatched() { if (!watchedAt || millis() - watchedAt > 90000) lastPub = 0; watchedAt = millis(); }
String updJson() {
  const char* ph[] = { "none", "wait", "check", "download", "done", "fail", "current", "restart" };
  return "{\"t\":\"upd\",\"phase\":\"" + String(ph[updPhase]) + "\",\"pct\":" + String((int)updPct) + ",\"v\":\"" + jsonEsc(updVer) +
         "\",\"text\":\"" + jsonEsc(updStatus) + "\",\"fw\":\"" FW "\"}";
}
void wifiNudge() { wifiNudge(false); }
bool relayUp() { return !relayBusy && mqtt.connected(); }
// for Heep: connected or why not, and what came in
String relayStatus() {
  if (!liveWanted()) return cfg.liveWifi ? "off (no sheet key yet)" : "off (Live over Wi-Fi is off)";
  if (wifiState != W_ON) return "waiting for Wi-Fi";
  String s = relayUp() ? String("connected") + (relayTls ? " (TLS)" : "") : relayTxt.empty() ? String("connecting") : String(relayTxt);
  s += " · " + String(relayCmds) + " commands";
  if (relayRefused) s += ", " + String(relayRefused) + " refused (last: " + String(relayRefusedWhy) + ")";
  return s;
}
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
  if (relayBusy || !mqtt.connected() || !liveTopic.length()) return;
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
  lastUpload.set(ok ? "sent " + String(n) + (n == 1 ? " trip" : " trips") : (body.indexOf("key") >= 0 ? "sheet key wrong" : "send failed (" + String(code) + ", " + String(ESP.getFreeHeap() / 1024) + " KB free)"));
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
  if (nextUploadTry < millis() + 1000) nextUploadTry = millis() + 60000;   // done for now; look again in a minute
  uploading = false;
  vTaskDelete(nullptr);
}

String ssidKey(String v) { v.replace("\xE2\x80\x99", "'"); v.replace("\xE2\x80\x98", "'"); v.trim(); v.toLowerCase(); return v; }
// the relay: connected whenever the T3 is on Wi-Fi ("Live over Wi-Fi" on), so Heep in Safari can always reach it.
// Live numbers go out while driving, for the first 10 minutes after key-on, and whenever Heep says it's watching.
bool lwPause = false;   // "Live over Wi-Fi" paused until the next restart (set by Heep during an update over Bluetooth)
bool liveWanted() { return cfg.liveWifi && !lwPause && liveTopic.length(); }
bool livePublish() {
  static uint32_t activeAt = 0;
  if (tripActive()) activeAt = millis();
  return millis() < 600000 || (activeAt && millis() - activeAt < 300000) || (watchedAt && millis() - watchedAt < 90000);
}
bool uploadWanted() { return ((queued > 0 && cfg.sheetUrl.length()) || (sd.tracksWaiting > 0 && cfg.trkUrl.length())) && millis() >= nextUploadTry; }
void wifiOff(uint32_t retryIn) {
  if (!relayBusy && mqtt.connected()) mqtt.disconnect();
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  wifiState = W_IDLE; nextWifiTry = millis() + retryIn;
}

// ---------------------------------------------------------------- Heep's commands over the relay: only if signed with your sheet key
static void refused(const char* why) { relayRefused++; relayRefusedWhy.set(why); }
void onRelay(char* topic, byte* payload, unsigned int len) {
  String j; j.reserve(len + 1);
  for (unsigned int i = 0; i < len; i++) j += (char)payload[i];
  int64_t n = llField(j, "n");
  String m = jStr(j, "m"), h = jStr(j, "h");
  if (!m.length() || h.length() != 64) { refused("not a command"); return; }
  if (n <= lastNonce) { refused("already seen (replay)"); return; }
  // with a clock: within 10 minutes of it, else it's a recording. Without one yet (no GPS, no internet time) the
  // signature and the nonce still have to be right, and the command's own time sets the clock
  if (timeSrc && llabs(n - nowMs()) > 10LL * 60 * 1000) { refused("time off by more than 10 min"); return; }
  String msg = ll(n) + "|" + m;
  unsigned char mac[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), (const unsigned char*)cfg.sheetKey.c_str(), cfg.sheetKey.length(),
                  (const unsigned char*)msg.c_str(), msg.length(), mac);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", mac[i]);
  if (h != String(hex)) { refused("bad signature (different sheet key?)"); return; }
  if (!timeSrc) setClock(n, 'a');
  lastNonce = n; relayCmds++;
  // kept in flash at most every 5 minutes (Heep's "watching" note comes every 30 s); older replays fail the time check anyway
  if (!nonceSavedAt || millis() - nonceSavedAt > 300000) { nonceSavedAt = millis(); Preferences p; p.begin("t3", false); p.putLong64("nonce", n); p.end(); }
  onCommand(m, 1);
}

// things the upload task asked loop() to do
static void netChores() {
  char b[96];
  while (evQ && xQueueReceive(evQ, b, 0) == pdTRUE) sdEvent(String(b));
  if (flushReq) { snapshot(); sdFlush(); flushReq = false; }
  // "Update over Wi-Fi" progress to Heep, both ways it may be listening; a result stays up for a minute
  static int sentPhase = -1, sentPct = -2;
  static uint32_t sentAt = 0;
  int ph = updPhase, pc = updPct;
  if (ph == UP_WAIT && wifiState != W_ON && !strstr(updStatus.s, "Wi-Fi")) updStatus.set("getting on Wi-Fi");
  if (ph != UP_NONE && (ph != sentPhase || pc != sentPct) && millis() - sentAt > 500) {
    sentPhase = ph; sentPct = pc; sentAt = millis();
    String m = updJson();
    phoneSend(m); relaySend(m);
  }
  if ((ph == UP_FAIL || ph == UP_CURRENT) && millis() - sentAt > 60000) { updPhase = UP_NONE; sentPhase = -1; }
}

static const char* mqttWhy(int s) {
  switch (s) {
    case -4: return "no answer in time"; case -3: return "connection lost"; case -2: return "couldn't reach the relay";
    case -1: return "disconnected"; case 1: case 2: case 3: return "the relay refused"; case 4: case 5: return "not allowed";
  }
  return "unknown";
}
// connecting to the relay (up to ~10 s on a slow hotspot) happens in its own task so the screen never freezes
static void relayConnectTask(void*) {
  xSemaphoreTake(cfgLock, portMAX_DELAY);
  String topic = cmdTopic;
  xSemaphoreGive(cfgLock);
  bool tls = relayFails >= 2 && relayFails % 2 == 0;   // plain first; after two misses every other try is TLS
  if (tls) {
    mqttTls.setInsecure();
    mqttTls.setConnectionTimeout(4000);
    mqttTls.setHandshakeTimeout(6);
    mqtt.setClient(mqttTls);
    mqtt.setServer(RELAY_HOST, RELAY_PORT_TLS);
  } else {
    mqtt.setClient(mqttTcp);
    mqtt.setServer(RELAY_HOST, RELAY_PORT);
  }
  mqtt.setBufferSize(2048);
  mqtt.setSocketTimeout(4);
  mqtt.setCallback(onRelay);
  relayTxt.set(String("connecting") + (tls ? " (TLS)" : ""));
  String id = "jeep-t3-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  if (mqtt.connect(id.c_str()) && mqtt.subscribe(topic.c_str())) {
    subscribed = topic; relayTls = tls; relayFails = 0;
    relayTxt.set(String("connected") + (tls ? " (TLS)" : ""));
  } else {
    relayFails++;
    relayTxt.set("couldn't connect" + String(tls ? " (TLS)" : "") + ": " + mqttWhy(mqtt.state()) + " (" + String(ESP.getFreeHeap() / 1024) + " KB free)");
  }
  relayBusy = false;
  vTaskDelete(nullptr);
}
// keep the relay connection up and send live numbers when they're wanted
static void relayKeep(uint32_t now) {
  if (relayBusy) return;
  if (mqtt.connected() && subscribed != cmdTopic) mqtt.disconnect();   // the sheet key changed: listen on the new channel
  if (!mqtt.connected()) {
    if (now - mqttTry < 10000 || (uploading && ESP.getFreeHeap() < 150000)) return;
    mqttTry = now;
    relayBusy = true;
    if (xTaskCreatePinnedToCore(relayConnectTask, "relay", 12288, nullptr, 1, nullptr, 0) != pdPASS) relayBusy = false;
    return;
  }
  mqtt.loop();
  if (now - lastPub >= 1000 && livePublish()) { lastPub = now; relaySend(liveJson()); }
}

void wifiStep() {
  netChores();
  if (otaMode) return;                                               // an update over Bluetooth has the radio
  uint32_t now = millis();
  bool asked = now < wifiWantUntil;                                  // Heep's Wi-Fi page asked for a look
  bool want = uploadWanted() || liveWanted() || asked;
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
      String seenAs;                                                     // the name exactly as it's broadcast
      for (int i = 0; i < cfg.netCount && pick < 0; i++)                 // in the order you listed them in Heep
        for (int k = 0; k < found; k++) if (ssidKey(WiFi.SSID(k)) == ssidKey(cfg.nets[i].ssid)) { pick = i; seenAs = WiFi.SSID(k); break; }
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
        pick = blindNext % cfg.netCount;
        // an iPhone's name has a curly apostrophe (Ben’s iPhone); typed on a keyboard it's often straight. Not seen,
        // the name has to match exactly: every other round, try it with the other apostrophe
        if ((blindNext / cfg.netCount) % 2) {
          seenAs = cfg.nets[pick].ssid;
          if (seenAs.indexOf("\xE2\x80\x99") >= 0) seenAs.replace("\xE2\x80\x99", "'"); else seenAs.replace("'", "\xE2\x80\x99");
        }
        blindNext++;
      }
      wifiName = cfg.nets[pick].ssid;
      wifiReason = 0;
      // seen in the scan: join it by the exact name it broadcasts (the saved one may differ in an apostrophe or capitals)
      WiFi.begin((seenAs.length() ? seenAs : cfg.nets[pick].ssid).c_str(), cfg.nets[pick].pass.c_str());
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
        if (updPhase == UP_WAIT) { updPhase = UP_FAIL; updStatus.set("couldn't get on Wi-Fi (" + wifiName + ": " + res + ")"); }
        wifiOff(asked ? 5000 : livePublish() ? 30000 : 60000);
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
      if (uploading) { if (liveWanted()) relayKeep(now); return; }   // the upload has its own connection; the relay can carry its progress
      if (!scanOnly && uploadWanted()) {
        if (relayBusy) return;   // the relay is connecting: let it finish first
        // two secure connections at once need a lot of memory: unless there's plenty, the relay waits
        if (mqtt.connected() && ESP.getFreeHeap() < 110000) mqtt.disconnect();
        if (updPhase == UP_WAIT) updStatus.set("starting");
        uploading = true;
        if (xTaskCreatePinnedToCore(uploadTask, "upload", 16384, nullptr, 1, nullptr, 0) != pdPASS) { uploading = false; nextUploadTry = now + 60000; }
        return;
      }
      if (liveWanted()) { wifiIdleSince = 0; relayKeep(now); return; }
      if (!relayBusy && mqtt.connected()) mqtt.disconnect();
      if (asked || scanOnly) { wifiIdleSince = 0; return; }           // Heep's Wi-Fi page is watching: stay on
      if (!wifiIdleSince) wifiIdleSince = now;
      if (now - wifiIdleSince > 60000) { wifiNow = "off (nothing to send)"; wifiOff(30000); }
      return;
  }
}
