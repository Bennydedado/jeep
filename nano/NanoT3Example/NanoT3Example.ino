// NanoT3Example.ino - the three left steering wheel buttons -> the T3, as a small add-on to the Nano.
//
// THIS IS AN EXAMPLE, NOT A REPLACEMENT for your stereo/headlight sketch. To add T3 buttons to your sketch:
//   1. Copy T3Link.h and WheelButtons.h into your sketch's folder (they show up as tabs).
//   2. Copy the four marked blocks below (includes, the objects, the setup lines, the loop lines) into it.
//   3. Run WheelCalibrate once and put your own numbers in LEFT_WINDOWS.
// Nothing in here waits or blocks, so your pedal, stereo and headlight code keeps its timing.
//
// Wiring (see docs/HARDWARE.md):
//   left wheel buttons ladder -> A6, with a pull-up resistor A6 -> 5 V (the value from WheelCalibrate's notes)
//   D1 (TX) -> 10 kOhm -> T3 GPIO 39;  T3 GPIO 39 -> 20 kOhm -> GND;  Nano GND -> T3 GND
//   optional (block 5, right buttons set in Heep): T3 GPIO 25 -> 1 kOhm -> D8 (AltSoftSerial; D9, D10 then taken)

// ---- 1. includes
#include "T3Link.h"
#include "WheelButtons.h"
#include "WheelMap.h"
#include <AltSoftSerial.h>
#include <EEPROM.h>

// ---- 2. the objects (PROVISIONAL numbers: replace them with what WheelCalibrate shows for YOUR wheel)
const uint8_t LEFT_PIN = A6;
const Window LEFT_WINDOWS[] = {
  { 0, 90 },      // button 1 (top)    e.g. reads ~40
  { 150, 330 },   // button 2 (middle) e.g. reads ~240
  { 420, 620 },   // button 3 (bottom) e.g. reads ~520
};                // nothing pressed reads ~1023 (the pull-up)
T3Link t3(Serial);
void onLeftPress(uint8_t button, char press) { t3.button(button, press); }
LadderButtons leftButtons(LEFT_PIN, LEFT_WINDOWS, 3, onLeftPress);

// ---- 5. optional: the right buttons, set in Heep (T3 screens & buttons > Right wheel buttons)
// The T3 sends the map down GPIO 25 -> D8; it's kept in EEPROM so the buttons work the same without the T3.
const uint8_t RIGHT_PIN = A7;
const Window RIGHT_WINDOWS[] = { { 0, 90 }, { 150, 330 }, { 420, 620 } };   // top, middle, bottom (PROVISIONAL)
AltSoftSerial fromT3;   // RX D8
WMapRx mapRx;
char mapText[WMAP_MAX + 1] = WMAP_DEFAULT;
WAction rightMap[3][2];
WButton rightBtn[3];
void sendKenwood(uint8_t code) { (void)code; /* your stereo remote code here */ }
void runAction(const WAction& a, bool isHold) {
  if (a.kind == WA_KW) sendKenwood(a.code);
  else if (a.kind == WA_T3) t3.button(a.code, isHold ? 'L' : 'S');
  // WA_ANSWER, WA_HANGUP, WA_BEAMS: your own codes / relay
}
void loadMap() {
  char s[WMAP_MAX + 1];
  for (int i = 0; i <= WMAP_MAX; i++) s[i] = EEPROM.read(1 + i);
  s[WMAP_MAX] = 0;
  if (EEPROM.read(0) == 0xA7 && wmapParse(s, rightMap)) strcpy(mapText, s); else wmapParse(WMAP_DEFAULT, rightMap);
  t3.mapHash(wmapHash(mapText));
}
void rightLoop() {
  char got[WMAP_MAX + 1];
  for (int n = 0; n < 32 && fromT3.available(); n++)
    if (mapRx.feed((char)fromT3.read(), got) && strcmp(got, mapText) && wmapParse(got, rightMap)) {
      strcpy(mapText, got);
      EEPROM.update(0, 0xA7);
      for (int i = 0; ; i++) { EEPROM.update(1 + i, got[i]); if (!got[i]) break; }
      t3.mapHash(wmapHash(mapText));
    }
  int v = analogRead(RIGHT_PIN);
  for (int i = 0; i < 3; i++) wmapStep(rightBtn[i], rightMap[i][0], rightMap[i][1], v >= RIGHT_WINDOWS[i].lo && v <= RIGHT_WINDOWS[i].hi, millis(), runAction);
}

void setup() {
  // ---- 3. setup lines (skip Serial.begin if your sketch already has one: the T3 finds the speed itself)
  Serial.begin(9600);
  leftButtons.presses().longMs = 600;     // hold this long for a long press
  leftButtons.presses().repeatMs = 250;   // then a repeat this often while held (scrolls pages)
  fromT3.begin(9600);                     // block 5 only; the T3 sends at the speed it hears on D1, so use 9600
  loadMap();
  // ... your existing setup ...
}

void loop() {
  // ---- 4. loop lines
  leftButtons.loop();
  t3.loop();
  rightLoop();                            // block 5 only
  // ... your existing loop (pedal, stereo remote, headlights) ...
}
