// display.ino - drawing your screens on the 128x64 OLED, switching between them, sleeping and waking.
//
// Screens come from Heep's screen editor (format in screens.h) and are kept in /screens.txt in the T3's
// flash; if that file is missing or broken the built-in defaults are used. What each field shows is
// fieldText() below. Unknown values show "--" (never a made-up number), unknown fields show "?".

static uint32_t lastDraw = 0, lastTouch = 0, msgUntil = 0;
static bool screenOn = true;
static String msg;

void displayBegin() {
  sunPlaceLoad();
  displaySettingsChanged();
  page = cfg.startPage;
  if (page >= screenCount || !screens[page].on) page = 0, pageStep(0);
  lastTouch = millis();
}
void displaySettingsChanged() {
  oled.setRotation(cfg.flip ? 2 : 0);
  applyBright();
}

// ---------------------------------------------------------------- screens kept in flash
bool loadScreensText(const String& all) {
  Screen tmp[MAX_SCREENS];
  int n = 0, from = 0;
  while (from <= (int)all.length() && n < MAX_SCREENS) {
    int e = all.indexOf('\n', from);
    if (e < 0) e = all.length();
    String line = all.substring(from, e);
    from = e + 1;
    line.trim();
    if (line.length() && parseScreen(line.c_str(), tmp[n])) n++;
  }
  if (n == 0) return false;
  for (int i = 0; i < n; i++) screens[i] = tmp[i];
  screenCount = n;
  screensHash = fnv1a(all.c_str());
  return true;
}
String defaultScreensText() {
  String all;
  for (int i = 0; i < DEFAULT_SCREEN_COUNT; i++) all += (i ? "\n" : "") + String(DEFAULT_SCREENS[i]);
  return all;
}
void loadScreens() {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/screens.txt", "r");
  String all = f ? f.readString() : "";
  if (f) f.close();
  xSemaphoreGive(fsLock);
  if (!all.length() || !loadScreensText(all)) loadScreensText(defaultScreensText());
}
// "" = back to the defaults. Written to a new file first, so a power cut can't leave half a file.
bool saveScreens(const String& all) {
  String text = all.length() ? all : defaultScreensText();
  if (!loadScreensText(text)) { loadScreens(); return false; }
  xSemaphoreTake(fsLock, portMAX_DELAY);
  if (!all.length()) LittleFS.remove("/screens.txt");
  else {
    File f = LittleFS.open("/screens.new", "w");
    if (f) { f.print(text); f.close(); LittleFS.remove("/screens.txt"); LittleFS.rename("/screens.new", "/screens.txt"); }
  }
  xSemaphoreGive(fsLock);
  if (page >= screenCount || !screens[page].on) { page = 0; pageStep(0); }
  return true;
}

// ---------------------------------------------------------------- pages, sleep, brightness
void pageStep(int dir) {
  if (screenCount == 0) return;
  int p = page;
  for (int k = 0; k < screenCount; k++) {
    p = (p + (dir == 0 ? (k ? 1 : 0) : dir) + screenCount) % screenCount;
    if (screens[p].on) { page = p; break; }
  }
  lastDraw = 0;
}
void pageGo(int i) { if (i >= 0 && i < screenCount) { page = i; lastDraw = 0; } }
void pageHome() { pageGo(cfg.startPage); if (!screens[page].on) pageStep(0); }
void flash(const String& m) { msg = m; msgUntil = millis() + 1500; screenWake(); lastDraw = 0; }

void screenWake() { if (!screenOn) { screenOn = true; oled.ssd1306_command(SSD1306_DISPLAYON); } lastTouch = millis(); }
// a press while the screen is off only wakes it (returns true); otherwise it's a normal press
bool screenWakeOnly() { bool was = screenOn; screenWake(); return !was; }
void screenToggle() { if (screenOn) { screenOn = false; oled.clearDisplay(); oled.display(); oled.ssd1306_command(SSD1306_DISPLAYOFF); } else screenWake(); }

int localHour() {
  int64_t t = nowMs();
  if (!t) return -1;
  int64_t s = t / 1000 + (int64_t)cfg.tzMin * 60;
  return (int)((s / 3600) % 24 + 24) % 24;
}
// where the Jeep last had a GPS fix, for sunset / sunrise (kept so it works before the GPS has a fix)
float sunLat = NAN, sunLon = NAN;
void sunPlaceLoad() { Preferences p; p.begin("t3", true); sunLat = p.getFloat("slat", NAN); sunLon = p.getFloat("slon", NAN); p.end(); }
void sunPlaceSeen(double lat, double lon) {   // gps.ino, on a good fix: saved when it moved ~20 km or more
  if (!isnan(sunLat) && fabs(lat - sunLat) < 0.2 && fabs(lon - sunLon) < 0.3) return;
  sunLat = lat; sunLon = lon;
  Preferences p; p.begin("t3", false); p.putFloat("slat", sunLat); p.putFloat("slon", sunLon); p.end();
}
// night: -1 never, -2 sunset to sunrise (7 PM to 7 AM until the GPS has ever had a fix), else nightFrom..nightTo
bool isNight() {
  int h = localHour();
  if (cfg.nightFrom == -2 && h >= 0) {
    if (!isnan(sunLat)) return sunIsDown(nowMs(), sunLat, sunLon);
    return h >= 19 || h < 7;
  }
  if (cfg.nightFrom < 0 || h < 0) return false;
  return cfg.nightFrom <= cfg.nightTo ? (h >= cfg.nightFrom && h < cfg.nightTo) : (h >= cfg.nightFrom || h < cfg.nightTo);
}
// Heep's brightness sliders: while one is being moved, that level is shown for 4 s whatever the time of day
static int previewLv = -1;
static uint32_t previewUntil = 0;
void brightPreview(int lv) { previewLv = lv; previewUntil = millis() + 4000; screenWake(); }
void applyBright() {
  int b = isNight() ? cfg.brightNight : cfg.bright;
  if (previewLv >= 0 && (int32_t)(millis() - previewUntil) < 0) b = previewLv;
  oled.ssd1306_command(SSD1306_SETCONTRAST);
  oled.ssd1306_command(cfg.brightLv[constrain(b, 0, 2)]);
}

void displayStep() {
  uint32_t now = millis();
  // the engine starting wakes the screen, like a press (so it's never dark at the start of a drive)
  static bool engineWas = false;
  bool eng = engineOn();
  if (eng && !engineWas) screenWake();
  engineWas = eng;
  // sleep after "screenSecs" without a press (0 = never)
  if (cfg.screenSecs > 0 && screenOn && now - lastTouch > (uint32_t)cfg.screenSecs * 1000UL) screenToggle();
  static uint32_t lastBright = 0;
  if (now - lastBright > 60000 || (previewLv >= 0 && (int32_t)(now - previewUntil) >= 0)) { lastBright = now; if ((int32_t)(now - previewUntil) >= 0) previewLv = -1; applyBright(); }
  if (!screenOn || now - lastDraw < (uint32_t)cfg.refreshMs) return;
  lastDraw = now;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextWrap(false);
  if (menuOpen()) menuDraw();
  else if (screenCount && page < screenCount) for (int i = 0; i < screens[page].n; i++) drawWidget(screens[page].w[i]);
  if (updating) { msg = otaMode ? "BT update " + String(otaPercent()) + "%" : String("Updating T3..."); msgUntil = now + 500; }
  if (now < msgUntil) {
    oled.setFont(); oled.setTextSize(1);
    oled.fillRect(10, 22, 108, 20, SSD1306_BLACK); oled.drawRect(10, 22, 108, 20, SSD1306_WHITE);
    oled.setCursor(64 - msg.length() * 3, 28); oled.print(msg);
  }
  oled.display();
}

// ---------------------------------------------------------------- one widget
static void useFont(int size) {
  oled.setTextSize(1);
  if (size == 4) oled.setFont(&FreeSansBold18pt7b);
  else if (size == 3) oled.setFont(&FreeSansBold12pt7b);
  else { oled.setFont(); oled.setTextSize(size == 2 ? 2 : 1); }
}
// text width/height in the current font; y for printing so the text sits inside [top, top+h)
static void measure(const String& s, int16_t& w, int16_t& h, int16_t& yOff, int size) {
  int16_t x1, y1; uint16_t ww, hh;
  oled.getTextBounds(s, 0, 0, &x1, &y1, &ww, &hh);
  w = ww;
  if (size >= 3) { h = hh; yOff = -y1; }        // proportional fonts print from the baseline
  else { h = size == 2 ? 16 : 8; yOff = 0; }     // the built-in font prints from the top
}
// too wide for its box at this size? one size smaller, until it fits (or it's the smallest)
static int fitSize(const String& s, int w, int size) {
  int16_t tw, th, yo;
  while (size > 1) { useFont(size); measure(s, tw, th, yo, size); if (tw <= w) break; size--; }
  return size;
}
static void drawText(const String& s, int x, int y, int w, int h, char align, int size) {
  size = fitSize(s, w, size);
  useFont(size);
  int16_t tw, th, yo;
  measure(s, tw, th, yo, size);
  int cx = align == 'c' ? x + (w - tw) / 2 : align == 'r' ? x + w - tw : x;
  int cy = y + (h - th) / 2 + yo;
  if (size >= 3 && th > h) cy = y + yo;
  oled.setCursor(cx < x ? x : cx, cy);
  oled.print(s);
  oled.setFont(); oled.setTextSize(1);
}

void drawWidget(const Widget& w) {
  uint16_t fg = SSD1306_WHITE;
  if (w.invert) { oled.fillRect(w.x, w.y, w.w, w.h, SSD1306_WHITE); fg = SSD1306_BLACK; }
  oled.setTextColor(fg);
  if (w.frame) oled.drawRect(w.x, w.y, w.w, w.h, fg);
  const FieldDef* fd = w.field >= 0 ? &FIELDS[w.field] : nullptr;
  String label = w.text[0] ? String(w.text) : fd ? String(fd->label) : String("?");
  String unit = fd && w.unit ? unitFor(w.field) : String("");
  switch (w.type) {
    case 'n':
      if (w.w >= w.h) oled.drawFastHLine(w.x, w.y, w.w, fg); else oled.drawFastVLine(w.x, w.y, w.h, fg);
      break;
    case 'l':
      drawText(String(w.text), w.x, w.y, w.w, w.h, w.align, w.size);
      break;
    case 'r': {
      String v = fd ? fieldText(w.field) : String("?");
      if (unit.length() && v != "--") v += " " + unit;
      oled.setFont(); oled.setTextSize(1);
      int ty = w.y + (w.h - 8) / 2;
      int vx = w.x + w.w - (int)v.length() * 6 - (w.frame ? 2 : 0);
      if (w.label) { char lb[24]; fitLabel(label.c_str(), vx - w.x - (w.frame ? 2 : 0), lb, sizeof(lb)); oled.setCursor(w.x + (w.frame ? 2 : 0), ty); oled.print(lb); }
      oled.setCursor(w.label ? vx : (w.align == 'c' ? w.x + (w.w - (int)v.length() * 6) / 2 : w.align == 'r' ? vx : w.x), ty);
      oled.print(v);
      break;
    }
    case 'b': {
      float x = fd ? fieldNumber(w.field) : NAN;
      String v = fd ? fieldText(w.field) : String("?");
      if (unit.length() && v != "--") v += " " + unit;
      int top = w.y;
      if (w.label && w.h >= 14) {
        oled.setFont(); oled.setTextSize(1);
        char lb[24]; fitLabel(label.c_str(), w.w - (int)v.length() * 6, lb, sizeof(lb));
        oled.setCursor(w.x, w.y); oled.print(lb);
        oled.setCursor(w.x + w.w - (int)v.length() * 6, w.y); oled.print(v);
        top += 9;
      }
      int bh = w.y + w.h - top;
      if (bh < 3) bh = 3;
      oled.drawRect(w.x, top, w.w, bh, fg);
      if (!isnan(x)) {
        float f = (x - w.mn) / (w.mx - w.mn);
        if (f < 0) f = 0; if (f > 1) f = 1;
        oled.fillRect(w.x + 1, top + 1, (int)((w.w - 2) * f), bh - 2, fg);
      }
      break;
    }
    default: {   // 'v': label on top (small), the value as big as asked
      int top = w.y, hh = w.h;
      if (w.label) {
        oled.setFont(); oled.setTextSize(1);
        drawText(label, w.x + (w.frame ? 2 : 0), w.y + (w.frame ? 1 : 0), w.w - (w.frame ? 4 : 0), 8, w.align, 1);
        top += 9; hh -= 9;
      }
      String v = fd ? fieldText(w.field) : String("?");
      bool smallUnit = unit.length() && v != "--" && w.size >= 2;
      if (unit.length() && v != "--" && w.size < 2) v += " " + unit;
      if (smallUnit) {
        // the number big, the unit small beside it, both centred as a pair
        int uw = unit.length() * 6 + 2;
        int sz = fitSize(v, w.w - uw, w.size);
        useFont(sz);
        int16_t tw, th, yo; measure(v, tw, th, yo, sz);
        int total = tw + uw;
        int cx = w.align == 'c' ? w.x + (w.w - total) / 2 : w.align == 'r' ? w.x + w.w - total : w.x;
        if (cx < w.x) cx = w.x;
        int cy = top + (hh - th) / 2;
        oled.setCursor(cx, cy + yo); oled.print(v);
        oled.setFont(); oled.setTextSize(1);
        oled.setCursor(cx + tw + 2, cy + th - 8); oled.print(unit);
      } else drawText(v, w.x, top, w.w, hh, w.align, w.size);
    }
  }
  oled.setTextColor(SSD1306_WHITE);
}

// ---------------------------------------------------------------- what each field shows
String unitFor(int f) {
  const char* id = FIELDS[f].id;
  if (!strcmp(id, "otemp")) return cfg.tempF ? "F" : "C";
  if (!strcmp(id, "ect") || !strcmp(id, "iat")) return cfg.engF ? "F" : "C";
  return FIELDS[f].unit;
}
static String fmt(float v, int dp) { return isnan(v) ? String("--") : String(v, dp); }
static String hm(float s) { long m = (long)(s / 60); char b[24]; snprintf(b, sizeof(b), "%ld:%02ld", m / 60, m % 60); return b; }

// the number behind a field (for bars); NAN when there isn't one right now
float fieldNumber(int f) {
  const char* id = FIELDS[f].id;
  bool obdOk = obdLinked && millis() - car.at < 5000;
  if (!strcmp(id, "kmh")) { float v = speedNow(); return v < 0 ? NAN : v; }
  if (!strcmp(id, "kmhg")) return gps.valid ? gps.kmh : NAN;
  if (!strcmp(id, "kmho")) return obdOk && car.kmh >= 0 ? car.kmh : NAN;
  if (!strcmp(id, "otemp")) return tempFresh() ? tempShown() : NAN;
  if (!strcmp(id, "rpm")) return obdOk && car.rpm >= 0 ? car.rpm : NAN;
  if (!strcmp(id, "boost")) { float b = boostPsi(); return b < 0 ? NAN : b; }
  if (!strcmp(id, "bmax")) return trip.boostMax;
  if (!strcmp(id, "ect")) return obdOk && car.ect > -100 ? (cfg.engF ? car.ect * 9 / 5 + 32 : car.ect) : NAN;
  if (!strcmp(id, "iat")) return obdOk && car.iat > -100 ? (cfg.engF ? car.iat * 9 / 5 + 32 : car.iat) : NAN;
  if (!strcmp(id, "maf")) return obdOk && car.maf >= 0 ? car.maf : NAN;
  if (!strcmp(id, "rail")) return obdOk && car.rail >= 0 ? car.rail / 100 : NAN;
  if (!strcmp(id, "volt")) return obdOk && car.volts > 0 ? car.volts : NAN;
  if (!strcmp(id, "load")) return obdOk && car.load >= 0 ? car.load : NAN;
  if (!strcmp(id, "lph")) return engineOn() ? fuelNow() : NAN;
  if (!strcmp(id, "econ")) { float v = speedNow(); return engineOn() && v > 3 ? fuelNow() / v * 100 : NAN; }
  if (!strcmp(id, "tkm")) return trip.km;
  if (!strcmp(id, "tl")) return trip.l;
  if (!strcmp(id, "tavg")) return trip.km >= 0.5 && trip.l > 0 ? trip.l / trip.km * 100 : NAN;
  if (!strcmp(id, "tavgs")) return trip.s > 30 ? trip.km / (trip.s / 3600) : NAN;
  if (!strcmp(id, "tvmax")) return trip.vmax;
  if (!strcmp(id, "totkm")) return totalKm + trip.km;
  if (!strcmp(id, "totl")) return totalL + trip.l;
  if (!strcmp(id, "totavg")) return totalKm + trip.km >= 1 ? (totalL + trip.l) / (totalKm + trip.km) * 100 : NAN;
  if (!strcmp(id, "fuel")) return fuelLeft();
  if (!strcmp(id, "dte")) return fuelToEmpty();
  if (!strcmp(id, "hdop")) return gps.hdop;
  if (!strcmp(id, "alt")) return gps.valid ? gps.alt : NAN;
  if (!strcmp(id, "lat")) return gps.valid ? gps.lat : NAN;
  if (!strcmp(id, "lon")) return gps.valid ? gps.lon : NAN;
  if (!strcmp(id, "sdfree")) return sd.ok ? (sd.total - sd.used) / 1048576.0 : NAN;
  if (!strcmp(id, "logn")) return sd.rows;
  if (!strcmp(id, "queue")) return queued + sd.tracksWaiting;
  if (!strcmp(id, "heap")) return ESP.getFreeHeap() / 1024.0;
  return NAN;
}

String fieldText(int f) {
  const char* id = FIELDS[f].id;
  if (FIELDS[f].dp >= 0) return fmt(fieldNumber(f), FIELDS[f].dp);
  if (!strcmp(id, "hdg")) return headingText();
  if (!strcmp(id, "hdgd")) return courseText();
  if (!strcmp(id, "gfix")) return gpsStateText();
  if (!strcmp(id, "sats")) { if (gps.state == G_NONE) return "--"; return (gps.sats >= 0 ? String(gps.sats) : String("?")) + "/" + (gps.inView >= 0 ? String(gps.inView) : String("?")); }
  if (!strcmp(id, "tstate")) return trip.paused ? "PAUSED" : tripActive() ? "RUNNING" : "WAITING";
  if (!strcmp(id, "ttime")) return hm(trip.s);
  if (!strcmp(id, "tidle")) return hm(trip.idle);
  if (!strcmp(id, "clock") || !strcmp(id, "date")) {
    int64_t t = nowMs();
    if (!t) return "--";
    time_t s = (time_t)(t / 1000 + (int64_t)cfg.tzMin * 60);
    struct tm tmv; gmtime_r(&s, &tmv);
    char b[32];
    if (!strcmp(id, "clock")) snprintf(b, sizeof(b), "%02d:%02d", tmv.tm_hour, tmv.tm_min);
    else snprintf(b, sizeof(b), "%04d-%02d-%02d", tmv.tm_year + 1900, tmv.tm_mon + 1, tmv.tm_mday);
    return b;
  }
  if (!strcmp(id, "obd")) return obdLinked ? (millis() - car.at < 5000 ? "reading" : "connected") : "looking";
  if (!strcmp(id, "ble")) return phoneOn ? "Heep on" : "-";
  if (!strcmp(id, "wifi")) return wifiState == W_ON ? wifiName.substring(0, 12) : wifiState == W_IDLE ? String(cfg.netCount) + " saved" : String("joining");
  if (!strcmp(id, "nano")) return wheelState();
  if (!strcmp(id, "sd")) return sd.ok ? "logging" : !sd.err.empty() ? String(sd.err).substring(0, 12) : String("no card");
  if (!strcmp(id, "fw")) return FW;
  if (!strcmp(id, "up")) return hm(millis() / 1000);
  if (!strcmp(id, "btn")) return wheel.last;
  return "?";
}
