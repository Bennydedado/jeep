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

// ---- 1. includes
#include "T3Link.h"
#include "WheelButtons.h"

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

void setup() {
  // ---- 3. setup lines (skip Serial.begin if your sketch already has one: the T3 finds the speed itself)
  Serial.begin(9600);
  leftButtons.presses().longMs = 600;     // hold this long for a long press
  leftButtons.presses().repeatMs = 250;   // then a repeat this often while held (scrolls pages)
  // ... your existing setup ...
}

void loop() {
  // ---- 4. loop lines
  leftButtons.loop();
  t3.loop();
  // ... your existing loop (pedal, stereo remote, headlights) ...
}
