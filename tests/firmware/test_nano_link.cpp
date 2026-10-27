// test_nano_link.cpp - the whole button path on a PC: a simulated wheel ladder -> the Nano's WheelButtons.h and
// T3Link.h -> the bytes on the wire -> the T3's JLinkParser. Simulated input, not the real wheel.
#include "mock/Arduino.h"
#include "../../nano/NanoT3Example/T3Link.h"
#include "../../nano/NanoT3Example/WheelButtons.h"
#include "../../firmware/T3/jlink.h"
#include "check.h"
#include <vector>

HardwareSerial wire;
T3Link t3(wire);
std::vector<JEvent> got;
JLinkParser parser;
size_t readPos = 0;
void onPress(uint8_t b, char p) { t3.button(b, p); }
const Window W[] = { { 0, 90 }, { 150, 330 }, { 420, 620 } };
LadderButtons ladder(0, W, 3, onPress);

// run the Nano for `ms` milliseconds with the ladder reading `adc`, and let the T3 read the wire
void run(int adc, int ms) {
  mockAnalog = adc;
  for (int i = 0; i < ms; i++) {
    mockMillis++;
    ladder.loop(); t3.loop();
    JEvent e;
    while (readPos < wire.out.size()) if (parser.feed(wire.out[readPos++], mockMillis, e)) got.push_back(e);
  }
}
int buttons() { int n = 0; for (auto& e : got) if (e.kind == 'B') n++; return n; }
const JEvent* lastButton() { for (int i = (int)got.size() - 1; i >= 0; i--) if (got[i].kind == 'B') return &got[i]; return nullptr; }

int main() {
  run(1023, 1500);                         // idle: only heartbeats
  CHECK(buttons() == 0);
  CHECK(got.size() >= 1 && got[0].kind == 'H' && got[0].proto == 1);
  // a 150 ms tap on button 2 (reads ~240): one short press, even though it goes out twice
  run(240, 150); run(1023, 200);
  CHECK(buttons() == 1 && lastButton()->button == 2 && lastButton()->press == 'S');
  CHECK(parser.dups >= 1);
  // a bouncy contact (10 ms blips) is not a press
  for (int i = 0; i < 5; i++) { run(40, 10); run(1023, 10); }
  run(1023, 100);
  CHECK(buttons() == 1);
  // hold button 3 for 1.2 s: a long press, then repeats every 250 ms, and no short press on release
  run(520, 1200); run(1023, 200);
  int longs = 0, reps = 0, shorts3 = 0;
  for (auto& e : got) if (e.kind == 'B' && e.button == 3) { if (e.press == 'L') longs++; if (e.press == 'R') reps++; if (e.press == 'S') shorts3++; }
  CHECK(longs == 1);
  CHECK(reps == 2);                        // at ~630+250 and ~630+500 ms
  CHECK(shorts3 == 0);
  // a full serial buffer never blocks: the press is dropped quietly after 200 ms
  size_t before = wire.out.size();
  wire.room = 0;
  run(40, 100); run(1023, 400);
  CHECK(wire.out.size() == before);
  wire.room = 64;
  run(1023, 1100);
  CHECK(parser.bad == 0);                  // nothing garbled on the wire
  DONE();
}
