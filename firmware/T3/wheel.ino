// wheel.ino - steering wheel buttons: the Nano reads them and sends one line per press (jlink.h); this tab
// turns each press into an action. The other way (2.12+, NANO_TX_PIN) only carries the Nano's right-button
// map from Heep; the Nano keeps it, so nothing the T3 does (or fails to do) can stop its stereo or headlight jobs.
//
// Wiring: Nano TX (D1) -> 10 kOhm -> GPIO 39, and GPIO 39 -> 20 kOhm -> GND (makes the Nano's 5 V into 3.3 V).
//         GPIO 25 -> 1 kOhm -> Nano D8 (right-button map; jeep_controller_v3 only).
// Grounds joined. The baud rate is found automatically (9600 is what nano/T3Link uses).
//
// What each button does is set in Heep (T3 screens & buttons > Buttons) and stored as cfg.btnMap:
//   "short,long;short,long;short,long" for buttons 1, 2, 3, e.g. "prev,home;mark,pause;next,end"
// Actions: none next prev home mark pause end sleep bright peak send menu (the wheel settings menu, menu.ino)

#define nanoSerial Serial2   // UART2: receive on NANO_RX_PIN, send the button map on NANO_TX_PIN
static const long NANO_BAUDS[] = { 9600, 19200, 38400, 57600, 115200 };
static int nanoBaudIdx = 0;
static uint32_t nanoBaudAt = 0, nanoGoodAtSwitch = 0, nanoLastByte = 0;
// the old optional push button on GPIO 4 (only when Heep's "GPIO 4" setting says button)
static bool btnDown = false, btnLong = false;
static uint32_t btnAt = 0;

void wheelOpen(long baud) {
  nanoSerial.end();
  nanoSerial.begin(baud, SERIAL_8N1, NANO_RX_PIN, NANO_TX_PIN);   // sends at the speed the Nano uses (9600 for v3)
  wheel.baud = baud;
  nanoBaudAt = millis();
  nanoGoodAtSwitch = jlink.good;
}
void wheelBegin() {
  pinMode(NANO_RX_PIN, INPUT);
  wheelOpen(NANO_BAUDS[0]);
  if (cfg.io4 == 1) pinMode(ONEWIRE_PIN, INPUT_PULLUP);
}

void wheelStep() {
  uint32_t now = millis();
  JEvent e;
  int n = 0;
  while (nanoSerial.available() && n < 200) {
    char c = nanoSerial.read(); n++; nanoLastByte = now;
    if (jlink.feed(c, now, e)) {
      wheel.heardAt = now;
      if (e.kind == 'H') { wheel.nanoUp = e.uptime; wheel.proto = e.proto; wheel.cfg = e.cfg; }
      else if (e.kind == 'B') onWheelButton(e.button, e.press, "wheel");
    }
  }
  // bytes but nothing good for 3 s at this speed: try the next speed
  if (nanoLastByte && now - nanoLastByte < 2000 && jlink.good == nanoGoodAtSwitch && now - nanoBaudAt > 3000) {
    nanoBaudIdx = (nanoBaudIdx + 1) % 5;
    wheelOpen(NANO_BAUDS[nanoBaudIdx]);
  }
  if (cfg.io4 == 1) localButtonStep();
  wheelMapStep(now);
}

// Heep's "Test a code": the Nano sends this Kenwood code once (2 hex digits). False if it can't go now.
bool wheelTestCode(String x) {
  x.toUpperCase();
  if (x.length() != 2 || !isxdigit(x[0]) || !isxdigit(x[1]) || strcmp(wheelMapState(), "none") == 0) return false;
  char line[24];
  int n = jlinkNLine(("K," + x).c_str(), line, sizeof(line));
  if (!n || nanoSerial.availableForWrite() < n) return false;
  nanoSerial.write((const uint8_t*)line, n);
  return true;
}

// the right-button map is only for a Nano that says protocol 2 with a hash; the bare minimum is checked here (the
// Nano checks every token and ignores a map it doesn't understand)
bool wheelMapOk(const String& m) {
  if (m.length() < 17 || m.length() > 64) return false;
  for (unsigned i = 0; i < m.length(); i++) if (!strchr("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-,;|", m[i])) return false;
  return true;
}
// "saved" (the Nano has it), "sending", "old" (the Nano's sketch can't take one), "none" (no Nano heard)
const char* wheelMapState() {
  if (strcmp(wheelState(), "ok")) return "none";
  if (wheel.proto < 2 || wheel.cfg < 0) return "old";
  return wheel.cfg == jlinkMapHash(cfg.wheelMap.c_str()) ? "saved" : "sending";
}
// every 2 s until the Nano's heartbeat shows the same map; never waits for room
void wheelMapStep(uint32_t now) {
  if (strcmp(wheelMapState(), "sending") || now - wheel.mapSentAt < 2000) return;
  char line[96];
  int n = jlinkMapLine(cfg.wheelMap.c_str(), line, sizeof(line));
  if (n && nanoSerial.availableForWrite() >= n) { nanoSerial.write((const uint8_t*)line, n); wheel.mapSent++; }
  wheel.mapSentAt = now;
}

// "ok" (heard in the last 3 s), "lost" (heard before, not now), "none" (never)
const char* wheelState() {
  if (!wheel.heardAt) return "none";
  return millis() - wheel.heardAt < 3000 ? "ok" : "lost";
}

String actionFor(int button, char press) {
  // pull "short,long" for this button out of the map
  int b = 1, from = 0;
  String m = cfg.btnMap + ";";
  while (b < button) { int k = m.indexOf(';', from); if (k < 0) return "none"; from = k + 1; b++; }
  int end = m.indexOf(';', from);
  String pair = m.substring(from, end);
  int comma = pair.indexOf(',');
  String shortA = comma < 0 ? pair : pair.substring(0, comma), longA = comma < 0 ? "none" : pair.substring(comma + 1);
  shortA.trim(); longA.trim();
  if (press == 'S') return shortA;
  if (press == 'L') return longA;
  // held down after a long press: keep scrolling, but never repeat anything else
  if (press == 'R' && (shortA == "next" || shortA == "prev")) return shortA;
  return "none";
}

void onWheelButton(int button, char press, const char* from) {
  snprintf(wheel.last, sizeof(wheel.last), "%d%c", button, press);
  wheel.lastAt = millis();
  wheel.presses++;
  if (screenWakeOnly()) return;   // the first press while the screen is off only wakes it
  if (menuOpen()) { menuButton(button, press); return; }
  String a = actionFor(button, press);
  doAction(a, from);
}

// every way of changing pages or the trip ends up here: buttons, Heep, the relay
void doAction(const String& a, const char* from) {
  if (a == "next") pageStep(1);
  else if (a == "prev") pageStep(-1);
  else if (a == "home") pageHome();
  else if (a == "mark") { tripMark(from); flash("Marked"); }
  else if (a == "pause") { tripCommand(trip.paused ? "resume" : "pause", from); }
  else if (a == "end") tripCommand("end", from);
  else if (a == "sleep") screenToggle();
  else if (a == "bright") { cfg.bright = (cfg.bright + 1) % 3; applyBright(); flash(cfg.bright == 2 ? "Bright" : cfg.bright == 1 ? "Medium" : "Dim"); }
  else if (a == "peak") { trip.boostMax = 0; flash("Peak reset"); }
  else if (a == "send") { wifiNudge(); flash("Sending..."); }
  else if (a == "menu") menuStart();
}

// GPIO 4 push button to GND: tap = next screen, hold 1.5 s = button 2's long action
void localButtonStep() {
  bool down = digitalRead(ONEWIRE_PIN) == LOW;
  uint32_t now = millis();
  if (down && !btnDown) { btnDown = true; btnAt = now; btnLong = false; }
  if (down && btnDown && !btnLong && now - btnAt > 1500) { btnLong = true; onWheelButton(2, 'L', "button"); }
  if (!down && btnDown) { btnDown = false; if (!btnLong && now - btnAt > 40) onWheelButton(3, 'S', "button"); }
}
