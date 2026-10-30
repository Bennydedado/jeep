// menu.ino - T3 settings from the steering wheel: give any wheel button the "Settings menu" action in Heep
// (the default is holding button 2). While it's open:
//   button 1 (top)    up          (hold to keep going)
//   button 3 (bottom) down        (hold to keep going)
//   button 2 (middle) change the highlighted setting / do it
//   hold button 2     close       (it also closes by itself after 30 s)
// Every change is saved straight away, the same way Heep's "Send settings" saves it, and Heep picks it up the next
// time it connects (settingsJson's "mc" counts changes made here).

static bool menuIsOpen = false;
static int menuSel = 0, menuTop = 0;
static uint32_t menuAt = 0, menuConfirmAt = 0;
static int menuConfirmItem = -1;
int menuChanges = 0;   // saved as "mc"; Heep copies the settings back when it sees this change

enum { MI_BRIGHT, MI_NIGHTBR, MI_NIGHT, MI_SLEEP, MI_HOME, MI_TEMP, MI_ENGT, MI_FLIP, MI_LIVE, MI_PEAK, MI_SEND, MI_END, MI_CLOSE, MI_COUNT };
static const char* const MENU_NAMES[MI_COUNT] = { "Brightness", "Night bright", "Night mode", "Screen off", "Key-on scr", "Outside temp",
                                                   "Engine temp", "Upside down", "Live Wi-Fi", "Reset peak", "Send trips", "End trip", "Close" };
static const int SLEEP_STEPS[] = { 30, 60, 120, 300, 900, 0 };

bool menuOpen() {
  if (menuIsOpen && millis() - menuAt > 30000) menuIsOpen = false;
  return menuIsOpen;
}
void menuStart() { menuIsOpen = true; menuSel = 0; menuTop = 0; menuAt = millis(); menuConfirmItem = -1; screenWake(); }

static String hour12(int h) { return String(h % 12 == 0 ? 12 : h % 12) + (h < 12 ? "AM" : "PM"); }
static String menuValue(int i) {
  static const char* const LV[] = { "Low", "Medium", "High" };
  switch (i) {
    case MI_BRIGHT: return LV[constrain(cfg.bright, 0, 2)];
    case MI_NIGHTBR: return LV[constrain(cfg.brightNight, 0, 2)];
    case MI_NIGHT: return cfg.nightFrom == -1 ? String("Off") : cfg.nightFrom == -2 ? String("Sunset") : hour12(cfg.nightFrom) + "-" + hour12(cfg.nightTo);
    case MI_SLEEP: return cfg.screenSecs == 0 ? String("Never") : cfg.screenSecs < 60 ? String(cfg.screenSecs) + " s" : String(cfg.screenSecs / 60) + " min";
    case MI_HOME: return cfg.startPage < screenCount ? String(screens[cfg.startPage].name).substring(0, 9) : String("?");
    case MI_TEMP: return cfg.tempF ? "F" : "C";
    case MI_ENGT: return cfg.engF ? "F" : "C";
    case MI_FLIP: return cfg.flip ? "Yes" : "No";
    case MI_LIVE: return cfg.liveWifi ? "On" : "Off";
    case MI_SEND: return queued > 0 ? String(queued) + " waiting" : String("none");
    default: return menuConfirmItem == i && millis() - menuConfirmAt < 3000 ? String("again?") : String("");
  }
}
// save one setting the same way Heep does
static void menuSet(const String& key, long v) {
  applySettings("{\"" + key + "\":" + String(v) + "}", true);
  menuChanges++;
  Preferences p; p.begin("t3", false); p.putInt("mc", menuChanges); p.end();
}
static bool confirmed(int i) {   // "do it" items need a second press within 3 s
  if (menuConfirmItem == i && millis() - menuConfirmAt < 3000) { menuConfirmItem = -1; return true; }
  menuConfirmItem = i; menuConfirmAt = millis();
  return false;
}
static void menuChange(int i) {
  switch (i) {
    case MI_BRIGHT: menuSet("br", (cfg.bright + 1) % 3); break;
    case MI_NIGHTBR: menuSet("bn", (cfg.brightNight + 1) % 3); break;
    case MI_NIGHT: {   // Off -> Sunset -> 7PM-7AM -> 8PM.. -> 11PM -> Off
      int nf = cfg.nightFrom;
      if (nf == -1) menuSet("nf", -2);
      else if (nf == -2) { menuSet("nt", 7); menuSet("nf", 19); }
      else if (nf >= 19 && nf < 23) menuSet("nf", nf + 1);
      else menuSet("nf", -1);
      break;
    }
    case MI_SLEEP: {
      int k = 0;
      while (k < 6 && SLEEP_STEPS[k] != cfg.screenSecs) k++;
      menuSet("ss", SLEEP_STEPS[(k + 1) % 6]);
      break;
    }
    case MI_HOME: {
      int p = cfg.startPage;
      for (int k = 0; k < screenCount; k++) { p = (p + 1) % screenCount; if (screens[p].on) break; }
      menuSet("sp", p);
      break;
    }
    case MI_TEMP: menuSet("tf", cfg.tempF ? 0 : 1); break;
    case MI_ENGT: menuSet("etf", cfg.engF ? 0 : 1); break;
    case MI_FLIP: menuSet("rot", cfg.flip ? 0 : 1); break;
    case MI_LIVE: menuSet("lw", cfg.liveWifi ? 0 : 1); break;
    case MI_PEAK: trip.boostMax = 0; flash("Peak reset"); break;
    case MI_SEND: if (confirmed(i)) { menuIsOpen = false; sendTripsNow("wheel menu"); } break;
    case MI_END: if (confirmed(i)) { menuIsOpen = false; tripCommand("end", "wheel menu"); } break;
    case MI_CLOSE: menuIsOpen = false; break;
  }
}
// a wheel press while the menu is open (wheel.ino sends them all here)
void menuButton(int button, char press) {
  menuAt = millis();
  if (button == 2 && press == 'L') { menuIsOpen = false; return; }
  if (button == 2) { if (press == 'S') menuChange(menuSel); return; }
  if (button == 1) menuSel = (menuSel + MI_COUNT - 1) % MI_COUNT;
  if (button == 3) menuSel = (menuSel + 1) % MI_COUNT;
  if (menuSel < menuTop) menuTop = menuSel;
  if (menuSel > menuTop + 3) menuTop = menuSel - 3;
}

// display.ino draws this instead of the screen while the menu is open
void menuDraw() {
  oled.setFont(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0); oled.print("T3 settings");
  String pos = String(menuSel + 1) + "/" + String(MI_COUNT);
  oled.setCursor(128 - pos.length() * 6, 0); oled.print(pos);
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);
  for (int r = 0; r < 4; r++) {
    int i = menuTop + r;
    if (i >= MI_COUNT) break;
    int y = 13 + r * 12;
    bool sel = i == menuSel;
    if (sel) oled.fillRect(0, y - 1, 128, 11, SSD1306_WHITE);
    oled.setTextColor(sel ? SSD1306_BLACK : SSD1306_WHITE);
    oled.setCursor(2, y + 1); oled.print(MENU_NAMES[i]);
    String v = menuValue(i);
    oled.setCursor(126 - v.length() * 6, y + 1); oled.print(v);
  }
  oled.setTextColor(SSD1306_WHITE);
}
