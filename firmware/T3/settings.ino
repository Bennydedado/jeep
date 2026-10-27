// settings.ino - everything Heep can set, kept in the T3's flash (Preferences, namespace "t3").
//
// To add a setting: a field in Settings (t3.h), a line in loadSettings(), a line in applySettings(),
// a line in settingsJson() so Heep can show it, and the control in Heep (live.js, T3 settings).

String liveTopic, cmdTopic;   // relay channels, named from your sheet key so only your Heep finds them

void loadSettings() {
  xSemaphoreTake(cfgLock, portMAX_DELAY);
  Preferences p;
  p.begin("t3", true);
  cfg.netCount = constrain(p.getInt("n", 0), 0, MAX_NETS);
  for (int i = 0; i < cfg.netCount; i++) { cfg.nets[i].ssid = p.getString(("s" + String(i)).c_str(), ""); cfg.nets[i].pass = p.getString(("p" + String(i)).c_str(), ""); }
  cfg.sheetUrl = p.getString("u", "");
  cfg.sheetKey = p.getString("k", "");
  cfg.obdName = p.getString("obd", "");
  cfg.trkUrl = p.getString("tru", "");
  cfg.trkKey = p.getString("trk", "");
  cfg.fuelCal = p.getFloat("fc", 1.0);
  cfg.distCal = p.getFloat("dc", 1.0);
  totalKm = p.getFloat("tk", 0);
  totalL = p.getFloat("tl", 0);
  cfg.screenSecs = p.getInt("ss", 60);
  cfg.parkSecs = p.getInt("pk", 90);
  cfg.bright = p.getInt("br", 2);
  cfg.brightNight = p.getInt("bn", 0);
  cfg.nightFrom = p.getInt("nf", -1);
  cfg.nightTo = p.getInt("nt", 7);
  cfg.tzMin = p.getInt("tz", -420);
  cfg.startPage = p.getInt("sp", 0);
  cfg.liveWifi = p.getBool("lw", true);
  cfg.spdSrc = p.getInt("spd", 0);
  cfg.hdgMin = p.getInt("hm", 5);
  cfg.hdg16 = p.getBool("h16", false);
  cfg.hdgHold = p.getBool("hh", true);
  cfg.tempF = p.getBool("tf", false);
  cfg.tempOff = p.getFloat("to", 0);
  cfg.gpsBaud = p.getLong("gb", 0);
  cfg.logSec = p.getInt("li", 1);
  cfg.logIdleSec = p.getInt("lis", 10);
  cfg.flushSec = p.getInt("lfl", 5);
  cfg.sdMaxPct = p.getInt("sdm", 90);
  cfg.flip = p.getBool("rot", false);
  cfg.refreshMs = p.getInt("rf", 250);
  cfg.btnMap = p.getString("bm", "prev,home;mark,pause;next,end");
  cfg.io4 = p.getInt("io4", 0);
  cfg.obdProto = constrain(p.getInt("opr", 0), 0, 9);
  p.end();
  // anything out of range goes back to a safe value
  if (cfg.fuelCal < 0.3 || cfg.fuelCal > 3) cfg.fuelCal = 1.0;
  if (cfg.distCal < 0.5 || cfg.distCal > 2) cfg.distCal = 1.0;
  cfg.bright = constrain(cfg.bright, 0, 2); cfg.brightNight = constrain(cfg.brightNight, 0, 2);
  cfg.logSec = constrain(cfg.logSec, 1, 60); cfg.logIdleSec = constrain(cfg.logIdleSec, 1, 300);
  cfg.flushSec = constrain(cfg.flushSec, 2, 60); cfg.sdMaxPct = constrain(cfg.sdMaxPct, 50, 98);
  cfg.refreshMs = constrain(cfg.refreshMs, 100, 2000); cfg.hdgMin = constrain(cfg.hdgMin, 1, 30);
  if (cfg.tempOff < -10 || cfg.tempOff > 10) cfg.tempOff = 0;
  liveTopic = cmdTopic = "";
  if (cfg.sheetKey.length()) {
    String in = "heep-live:" + cfg.sheetKey;
    unsigned char hsh[32];
    mbedtls_sha256((const unsigned char*)in.c_str(), in.length(), hsh, 0);
    char hex[33];
    for (int i = 0; i < 16; i++) sprintf(hex + 2 * i, "%02x", hsh[i]);
    liveTopic = "heep/" + String(hex) + "/live";
    cmdTopic = "heep/" + String(hex) + "/cmd";
  }
  xSemaphoreGive(cfgLock);
}

// a {"c":"cfg",...} message. Over the relay (fromRelay) the secrets are refused: Wi-Fi passwords,
// the sheet link and key only ever arrive over Bluetooth.
bool applySettings(const String& j, bool fromRelay) {
  Preferences p;
  p.begin("t3", false);
  if (!fromRelay) {
    String w[2 * MAX_NETS];
    int n = jStrings(j, "wifi", w, 2 * MAX_NETS);
    if (n >= 0) {
      int k = 0;
      for (int i = 0; i + 1 < n && k < MAX_NETS; i += 2) if (w[i].length()) { p.putString(("s" + String(k)).c_str(), w[i]); p.putString(("p" + String(k)).c_str(), w[i + 1]); k++; }
      p.putInt("n", k);
    }
    if (has(j, "u")) p.putString("u", jStr(j, "u"));
    if (has(j, "k")) p.putString("k", jStr(j, "k"));
    if (has(j, "tru")) p.putString("tru", jStr(j, "tru"));
    if (has(j, "trk")) p.putString("trk", jStr(j, "trk"));
  }
  if (has(j, "obd")) p.putString("obd", jStr(j, "obd").substring(0, 24));
  if (has(j, "fc")) p.putFloat("fc", numFieldOr(j, "fc", 1));
  if (has(j, "dc")) p.putFloat("dc", numFieldOr(j, "dc", 1));
  if (has(j, "ss")) p.putInt("ss", constrain((int)numFieldOr(j, "ss", 60), 0, 3600));
  if (has(j, "pk")) p.putInt("pk", constrain((int)numFieldOr(j, "pk", 90), 30, 1800));
  if (has(j, "br")) p.putInt("br", constrain((int)numFieldOr(j, "br", 2), 0, 2));
  if (has(j, "bn")) p.putInt("bn", constrain((int)numFieldOr(j, "bn", 0), 0, 2));
  if (has(j, "nf")) p.putInt("nf", constrain((int)numFieldOr(j, "nf", -1), -1, 23));
  if (has(j, "nt")) p.putInt("nt", constrain((int)numFieldOr(j, "nt", 7), 0, 23));
  if (has(j, "tz")) p.putInt("tz", constrain((int)numFieldOr(j, "tz", -420), -720, 840));
  if (has(j, "lw")) p.putBool("lw", numFieldOr(j, "lw", 1) > 0);
  if (has(j, "sp")) p.putInt("sp", constrain((int)numFieldOr(j, "sp", 0), 0, MAX_SCREENS - 1));
  if (has(j, "spd")) p.putInt("spd", constrain((int)numFieldOr(j, "spd", 0), 0, 2));
  if (has(j, "hm")) p.putInt("hm", constrain((int)numFieldOr(j, "hm", 5), 1, 30));
  if (has(j, "h16")) p.putBool("h16", numFieldOr(j, "h16", 0) > 0);
  if (has(j, "hh")) p.putBool("hh", numFieldOr(j, "hh", 1) > 0);
  if (has(j, "tf")) p.putBool("tf", numFieldOr(j, "tf", 0) > 0);
  if (has(j, "to")) p.putFloat("to", constrain(numFieldOr(j, "to", 0), -10.0f, 10.0f));
  if (has(j, "gb")) p.putLong("gb", (long)numFieldOr(j, "gb", 0));
  if (has(j, "li")) p.putInt("li", constrain((int)numFieldOr(j, "li", 1), 1, 60));
  if (has(j, "lis")) p.putInt("lis", constrain((int)numFieldOr(j, "lis", 10), 1, 300));
  if (has(j, "lfl")) p.putInt("lfl", constrain((int)numFieldOr(j, "lfl", 5), 2, 60));
  if (has(j, "sdm")) p.putInt("sdm", constrain((int)numFieldOr(j, "sdm", 90), 50, 98));
  if (has(j, "rot")) p.putBool("rot", numFieldOr(j, "rot", 0) > 0);
  if (has(j, "rf")) p.putInt("rf", constrain((int)numFieldOr(j, "rf", 250), 100, 2000));
  if (has(j, "bm")) { String bm = jStr(j, "bm"); if (bm.length() < 120) p.putString("bm", bm); }
  if (has(j, "io4")) p.putInt("io4", constrain((int)numFieldOr(j, "io4", 0), 0, 1));
  if (has(j, "opr")) p.putInt("opr", constrain((int)numFieldOr(j, "opr", 0), 0, 9));
  p.end();
  long oldBaud = cfg.gpsBaud; int oldIo4 = cfg.io4, oldOpr = cfg.obdProto;
  loadSettings();
  if (cfg.gpsBaud != oldBaud) gpsBegin();
  if (cfg.io4 != oldIo4) tempBegin();
  if (cfg.obdProto != oldOpr) obdRestart();   // talk to the iCar again on the new protocol
  displaySettingsChanged();
  return true;
}

// "Restore defaults" in Heep: every display/units/logging setting back to new, Wi-Fi and the sheet kept
void resetSettings() {
  Preferences p;
  p.begin("t3", false);
  const char* keys[] = { "ss", "pk", "br", "bn", "nf", "nt", "tz", "sp", "spd", "hm", "h16", "hh", "tf", "to", "gb", "li", "lis", "lfl", "sdm", "rot", "rf", "bm", "io4", "opr" };
  for (auto k : keys) p.remove(k);
  p.end();
  loadSettings();
  displaySettingsChanged();
}

// the settings as Heep shows them (no passwords or keys ever leave the T3)
String settingsJson() {
  String ss = "[";
  for (int i = 0; i < cfg.netCount; i++) ss += String(i ? "," : "") + "\"" + jsonEsc(cfg.nets[i].ssid) + "\"";
  ss += "]";
  return "\"fc\":" + String(cfg.fuelCal, 3) + ",\"dc\":" + String(cfg.distCal, 3) + ",\"ss\":" + String(cfg.screenSecs) +
         ",\"pk\":" + String(cfg.parkSecs) + ",\"br\":" + String(cfg.bright) + ",\"bn\":" + String(cfg.brightNight) +
         ",\"nf\":" + String(cfg.nightFrom) + ",\"nt\":" + String(cfg.nightTo) + ",\"tz\":" + String(cfg.tzMin) +
         ",\"sp\":" + String(cfg.startPage) + ",\"lw\":" + String(cfg.liveWifi ? 1 : 0) + ",\"spd\":" + String(cfg.spdSrc) +
         ",\"hm\":" + String(cfg.hdgMin) + ",\"h16\":" + String(cfg.hdg16 ? 1 : 0) + ",\"hh\":" + String(cfg.hdgHold ? 1 : 0) +
         ",\"tf\":" + String(cfg.tempF ? 1 : 0) + ",\"to\":" + String(cfg.tempOff, 1) + ",\"gb\":" + String(cfg.gpsBaud) +
         ",\"li\":" + String(cfg.logSec) + ",\"lis\":" + String(cfg.logIdleSec) + ",\"lfl\":" + String(cfg.flushSec) +
         ",\"sdm\":" + String(cfg.sdMaxPct) + ",\"rot\":" + String(cfg.flip ? 1 : 0) + ",\"rf\":" + String(cfg.refreshMs) +
         ",\"bm\":\"" + jsonEsc(cfg.btnMap) + "\",\"io4\":" + String(cfg.io4) + ",\"opr\":" + String(cfg.obdProto) + ",\"obdName\":\"" + jsonEsc(cfg.obdName) +
         "\",\"ssids\":" + ss + ",\"nets\":" + String(cfg.netCount) + ",\"sheet\":" + String(cfg.sheetUrl.length() ? "true" : "false") +
         ",\"trkSet\":" + String(cfg.trkUrl.length() ? "true" : "false");
}

// ---------------------------------------------------------------- small JSON helpers (the messages are flat and simple)
bool has(const String& j, const char* key) { return j.indexOf("\"" + String(key) + "\":") >= 0; }
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
float numFieldOr(const String& j, const char* key, float d) {
  int i = j.indexOf("\"" + String(key) + "\":");
  if (i < 0) return d;
  return j.substring(i + strlen(key) + 3).toFloat();
}
float numField(const String& j, const char* key) { return numFieldOr(j, key, 0); }
long long llField(const String& j, const char* key) {
  int i = j.indexOf("\"" + String(key) + "\":");
  if (i < 0) return 0;
  return atoll(j.substring(i + strlen(key) + 3).c_str());
}
// a string ready to sit inside "..." in JSON: quotes and backslashes escaped, new lines as \n, other control characters dropped
String jsonEsc(const String& v) {
  String o;
  o.reserve(v.length() + 8);
  for (size_t i = 0; i < v.length(); i++) {
    char c = v[i];
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if (c == '\n') o += "\\n";
    else if ((uint8_t)c >= 32) o += c;
  }
  return o;
}
String ll(long long v) { char b[24]; snprintf(b, sizeof(b), "%lld", v); return String(b); }
String num(float v, int dp) { return isnan(v) ? String("null") : String(v, dp); }
