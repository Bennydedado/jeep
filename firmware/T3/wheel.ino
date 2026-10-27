// wheel.ino - steering wheel buttons: the Nano reads them and sends one line per press (jlink.h); this tab
// turns each press into an action. The link only goes Nano -> T3, so nothing the T3 does (or fails to do)
// can ever affect the Nano's stereo or headlight jobs.
//
// Wiring: Nano TX (D1) -> 10 kOhm -> GPIO 39, and GPIO 39 -> 20 kOhm -> GND (makes the Nano's 5 V into 3.3 V).
// Grounds joined. The baud rate is found automatically (9600 is what nano/T3Link uses).
//
// What each button does is set in Heep (T3 screens & buttons > Buttons) and stored as cfg.btnMap:
//   "short,long;short,long;short,long" for buttons 1, 2, 3, e.g. "prev,home;mark,pause;next,end"
// Actions: none next prev home mark pause end sleep bright peak send

HardwareSerial nanoSerial(2);
static const long NANO_BAUDS[] = { 9600, 19200, 38400, 57600, 115200 };
static int nanoBaudIdx = 0;
static uint32_t nanoBaudAt = 0, nanoGoodAtSwitch = 0, nanoLastByte = 0;
// the old optional push button on GPIO 4 (only when Heep's "GPIO 4" setting says button)
static bool btnDown = false, btnLong = false;
static uint32_t btnAt = 0;

void wheelOpen(long baud) {
  nanoSerial.end();
  nanoSerial.begin(baud, SERIAL_8N1, NANO_RX_PIN, -1);   // receive only: the T3 never drives a wire to the Nano
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
      if (e.kind == 'H') { wheel.nanoUp = e.uptime; wheel.proto = e.proto; }
      else if (e.kind == 'B') onWheelButton(e.button, e.press, "wheel");
    }
  }
  // bytes but nothing good for 3 s at this speed: try the next speed
  if (nanoLastByte && now - nanoLastByte < 2000 && jlink.good == nanoGoodAtSwitch && now - nanoBaudAt > 3000) {
    nanoBaudIdx = (nanoBaudIdx + 1) % 5;
    wheelOpen(NANO_BAUDS[nanoBaudIdx]);
  }
  if (cfg.io4 == 1) localButtonStep();
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
}

// GPIO 4 push button to GND: tap = next screen, hold 1.5 s = button 2's long action
void localButtonStep() {
  bool down = digitalRead(ONEWIRE_PIN) == LOW;
  uint32_t now = millis();
  if (down && !btnDown) { btnDown = true; btnAt = now; btnLong = false; }
  if (down && btnDown && !btnLong && now - btnAt > 1500) { btnLong = true; onWheelButton(2, 'L', "button"); }
  if (!down && btnDown) { btnDown = false; if (!btnLong && now - btnAt > 40) onWheelButton(3, 'S', "button"); }
}
