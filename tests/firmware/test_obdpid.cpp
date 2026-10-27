// test_obdpid.cpp - which values the engine offers, and intake pressure (boost) from PID 0B, 87 or 70.
#include <stdio.h>
#include "../../firmware/T3/obdpid.h"
#include "check.h"

int main() {
  ObdSupport s;
  CHECK(!s.known && !s.has(0x0C));
  // a typical 0100 answer: BE3EB813 -> 01 03 04 05 06 07 0B 0C 0D 0E 0F 11 13 14 15 1C 1F 20
  CHECK(s.feed("4100BE3EB813", 0x00) == 0x20);          // PID 20 set: ask for 0120 next
  CHECK(s.known);
  CHECK(s.has(0x01) && s.has(0x04) && s.has(0x05) && s.has(0x0B) && s.has(0x0C) && s.has(0x0D) && s.has(0x0F) && s.has(0x20));
  CHECK(!s.has(0x02) && !s.has(0x0A) && !s.has(0x10) && !s.has(0x33));
  // 0120: 80018001 -> 21 30 31 40
  CHECK(s.feed("412080018001", 0x20) == 0x40);
  CHECK(s.has(0x21) && s.has(0x30) && s.has(0x31) && s.has(0x40) && !s.has(0x33));
  // 0140: 44000000 -> 42 46, and no 0160
  CHECK(s.feed("414044000000", 0x40) == -1);
  CHECK(s.has(0x42) && s.has(0x46) && !s.has(0x60));
  char l[200]; s.list(l, sizeof(l));
  CHECK(!strcmp(l, "01 03 04 05 06 07 0B 0C 0D 0E 0F 11 13 14 15 1C 1F 21 30 31 42 46"));
  // two engine computers answering: OR'ed
  ObdSupport t;
  CHECK(t.feed("4100800000014100001000000", 0x00) == 0x20);
  CHECK(t.has(0x01) && t.has(0x0C) && t.has(0x20));
  // junk and NO DATA change nothing
  ObdSupport u;
  CHECK(u.feed("NODATA", 0x00) == -1 && !u.known);
  CHECK(u.feed("SEARCHING...4100", 0x00) == -1 && !u.known);   // cut short: not 8 hex digits
  CHECK(!u.has(0x0C));

  // data bytes
  uint8_t b[8];
  CHECK(obdBytes("410B65", 0x0B, b, 8) == 1 && b[0] == 0x65);
  CHECK(obdBytes("SEARCHING...410C1AF8", 0x0C, b, 8) == 2 && b[0] == 0x1A && b[1] == 0xF8);
  CHECK(obdBytes("NODATA", 0x0B, b, 8) == 0);
  // MAP from each PID
  NEAR(obdMapKpa(0x0B, (const uint8_t[]){ 150 }, 1), 150, 0.01);
  { uint8_t x[] = { 0x01, 0x0F, 0xA0 }; NEAR(obdMapKpa(0x87, x, 3), 0x0FA0 * 0.03125f, 0.01); }    // 125 kPa
  { uint8_t x[] = { 0x02, 0x0F, 0xA0 }; CHECK(obdMapKpa(0x87, x, 3) < 0); }                         // sensor A not supported
  { uint8_t x[] = { 0x03, 0x10, 0x00, 0x12, 0xC0, 0, 0, 0, 0 }; NEAR(obdMapKpa(0x70, x, 9), 0x12C0 * 0.03125f, 0.01); }  // 150 kPa
  { uint8_t x[] = { 0x01, 0x10, 0x00, 0x12, 0xC0 }; CHECK(obdMapKpa(0x70, x, 5) < 0); }             // only commanded boost
  CHECK(obdMapKpa(0x0C, b, 2) < 0);

  // outside air pressure from intake pressure
  CHECK(learnBaro(-1, 93, 0, 0, -1) == 93);                     // key on, engine off: taken as is
  CHECK(learnBaro(93, 150, 2500, 60, 80) == 93);                // driving with boost: ignored
  CHECK(learnBaro(93, 40, 750, 0, 10) == 93);                   // nonsense: ignored
  float bp = learnBaro(-1, 92, 750, 0, 15);                      // idle, nothing learned yet
  CHECK(bp == 92);
  for (int i = 0; i < 20; i++) bp = learnBaro(bp, 94, 750, 0, 15);
  NEAR(bp, 94, 0.1);                                             // rises quickly
  for (int i = 0; i < 20; i++) bp = learnBaro(bp, 90, 750, 0, 15);
  CHECK(bp > 92.5);                                              // a dip at idle (intake restriction) barely moves it
  CHECK(learnBaro(93, 95, 1800, 0, 15) == 93);                  // revving while parked: not idle
  DONE();
}
