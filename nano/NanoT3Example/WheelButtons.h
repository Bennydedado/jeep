// WheelButtons.h - steering wheel buttons on the Nano, read without blocking, turned into presses:
//   S = short press (released before longMs), L = long press (held longMs), R = repeat every repeatMs while still held.
//
// Two kinds of wiring, pick the one that matches yours:
//   LadderButtons  - all buttons on one wire with different resistors (how factory wheel controls usually work),
//                    read on an analog pin. Needs a pull-up resistor from that pin to 5 V (A6/A7 have no internal one).
//                    Run nano/WheelCalibrate first to see the number each button gives, then fill in the windows.
//   PinButtons     - one wire per button to GND, pins set to INPUT_PULLUP.
//
// Both call your function with (button number, press). Button numbers are yours to choose: the example sends
// buttons 1-3 to the T3 and could keep others for the stereo.
#pragma once
#include <Arduino.h>

typedef void (*PressFn)(uint8_t button, char press);

// turns "which button is down right now" (0 = none) into S / L / R presses, with debouncing
class PressMaker {
 public:
  unsigned int debounceMs = 30, longMs = 600, repeatMs = 250;
  explicit PressMaker(PressFn fn) : cb(fn) {}
  void update(uint8_t down) {
    unsigned long now = millis();
    if (down != raw) { raw = down; rawAt = now; return; }
    if (now - rawAt < debounceMs) return;                 // not settled yet
    if (down != held) {                                   // a settled change
      if (held && !longSent) cb(held, 'S');               // released before it got long: a short press
      held = down; heldAt = now; longSent = false;
      return;
    }
    if (held && !longSent && now - heldAt >= longMs) { cb(held, 'L'); longSent = true; repeatAt = now; }
    else if (held && longSent && now - repeatAt >= repeatMs) { cb(held, 'R'); repeatAt = now; }
  }
 private:
  PressFn cb;
  uint8_t raw = 0, held = 0;
  unsigned long rawAt = 0, heldAt = 0, repeatAt = 0;
  bool longSent = false;
};

struct Window { int lo, hi; };   // analogRead() range for one button

class LadderButtons {
 public:
  // pin: analog pin; windows[i] is button i+1
  LadderButtons(uint8_t pin, const Window* windows, uint8_t count, PressFn fn) : p(pin), w(windows), n(count), maker(fn) {}
  PressMaker& presses() { return maker; }
  void loop() {
    if (millis() - lastRead < 5) return;                  // 200 reads a second is plenty
    lastRead = millis();
    int v = analogRead(p);
    uint8_t down = 0;
    for (uint8_t i = 0; i < n; i++) if (v >= w[i].lo && v <= w[i].hi) { down = i + 1; break; }
    maker.update(down);
  }
 private:
  uint8_t p; const Window* w; uint8_t n;
  PressMaker maker;
  unsigned long lastRead = 0;
};

class PinButtons {
 public:
  // pins[i] is button i+1, wired to GND
  PinButtons(const uint8_t* pins, uint8_t count, PressFn fn) : ps(pins), n(count), maker(fn) {}
  PressMaker& presses() { return maker; }
  void begin() { for (uint8_t i = 0; i < n; i++) pinMode(ps[i], INPUT_PULLUP); }
  void loop() {
    uint8_t down = 0;
    for (uint8_t i = 0; i < n; i++) if (digitalRead(ps[i]) == LOW) { down = i + 1; break; }
    maker.update(down);
  }
 private:
  const uint8_t* ps; uint8_t n;
  PressMaker maker;
};
