// T3Link.h - the Nano's side of the Nano -> T3 wire: steering wheel button presses and a heartbeat.
//
// Add it to your existing Nano sketch without changing what the Nano already does:
//
//   #include "T3Link.h"
//   T3Link t3(Serial);                    // Serial = pin D1 (TX). The T3 only listens.
//   void setup() { Serial.begin(9600); ... your setup ... }
//   void loop()  { t3.loop(); ... your loop ... }
//   ... when a T3 button is pressed:  t3.button(1, 'S');   // 'S' short, 'L' long, 'R' repeat while held
//
// Never blocks: if the serial buffer is full the heartbeat is skipped and a press waits for the next loop()
// (and is dropped after 200 ms rather than delaying anything). If the T3 is unplugged, off, rebooting or
// broken, nothing here notices or cares: the stereo and headlight code keeps running exactly the same.
//
// Wire format (same as firmware/T3/jlink.h on the T3):   $J,<seq>,B,<1-3>,<S|L|R>*HH   and   $J,<seq>,H,<uptime s>,1*HH
// Each press is sent twice, 30 ms apart, with the same seq; the T3 keeps one. HH = XOR checksum in hex.
//
// Your own Serial.print() debug lines are fine: the T3 ignores anything that isn't a checksummed $J line.
// Wiring: D1 (TX) -> 10k -> T3 GPIO 39 -> 20k -> GND, and Nano GND to T3 GND. Never wire the T3 to D0 (RX).
#pragma once
#include <Arduino.h>

#define T3LINK_PROTO 1   // 2 once mapHash() is set (WheelMap.h: right buttons set in Heep)

class T3Link {
 public:
  explicit T3Link(HardwareSerial& port) : s(port) {}

  // call every loop(): sends the heartbeat and the second copy of a press
  void loop() {
    unsigned long now = millis();
    if (pendingLen && now - pendingAt >= 30) {
      if (fits(pendingLen)) { s.write((const uint8_t*)pending, pendingLen); pendingLen = 0; }
      else if (now - pendingAt > 200) pendingLen = 0;
    }
    if (now - lastBeat >= 1000) {
      lastBeat = now;
      char body[40];
      if (hasMap) snprintf(body, sizeof(body), "J,%u,H,%lu,2,%X", seq, now / 1000UL, map);
      else snprintf(body, sizeof(body), "J,%u,H,%lu,%d", seq, now / 1000UL, T3LINK_PROTO);
      seq++;
      char line[40];
      int n = frame(body, line);
      if (fits(n)) s.write((const uint8_t*)line, n);
    }
  }

  // the hash of the right-button map this Nano uses (wmapHash): the T3 resends the map until it matches
  void mapHash(uint16_t h) { map = h; hasMap = true; }

  // a button press for the T3: button 1-3, press 'S', 'L' or 'R'
  void button(uint8_t b, char press) {
    if (b < 1 || b > 3 || (press != 'S' && press != 'L' && press != 'R')) return;
    char body[24];
    snprintf(body, sizeof(body), "J,%u,B,%u,%c", seq, b, press);
    seq++;
    pendingLen = frame(body, pending);
    if (fits(pendingLen)) s.write((const uint8_t*)pending, pendingLen);
    pendingAt = millis();   // the repeat goes out from loop() 30 ms later
  }

 private:
  HardwareSerial& s;
  uint8_t seq = 0;
  uint16_t map = 0;
  bool hasMap = false;
  unsigned long lastBeat = 0, pendingAt = 0;
  char pending[40];
  int pendingLen = 0;

  bool fits(int n) { return s.availableForWrite() >= n; }
  static int frame(const char* body, char* out) {
    uint8_t x = 0;
    for (const char* p = body; *p; p++) x ^= (uint8_t)*p;
    return snprintf(out, 40, "$%s*%02X\n", body, x);
  }
};
