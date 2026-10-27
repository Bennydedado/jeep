// test_nmea.cpp - the GPS sentence reader, against real-shaped M10 output (simulated, not from the Jeep).
#include "../../firmware/T3/nmea.h"
#include "check.h"
#include <string>

// wrap a sentence body in $...*HH\r\n with the right checksum
static std::string s(const char* body) {
  unsigned char x = 0; for (const char* p = body; *p; p++) x ^= (unsigned char)*p;
  char t[8]; snprintf(t, sizeof(t), "*%02X\r\n", x);
  return std::string("$") + body + t;
}
static int feed(NmeaParser& p, const std::string& text, uint32_t now) { int n = 0; for (char c : text) if (p.feed(c, now)) n++; return n; }

int main() {
  NmeaParser p;
  // 1. cold start: no fix yet, receiver talking
  CHECK(feed(p, s("GNRMC,,V,,,,,,,,,,N,V"), 1000) == 1);
  CHECK(feed(p, s("GNGGA,,,,,,0,00,99.99,,,,,,"), 1000) == 1);
  CHECK(!p.fix.rmcValid);
  CHECK(p.fix.quality == 0);
  CHECK(p.fix.posAt == 0);
  // 2. a fix near Baldonnel BC, driving east at 63 km/h (34.0 knots)
  feed(p, s("GNRMC,183015.00,A,5612.3456,N,12041.2345,W,34.02,87.5,271026,,,A,V"), 2000);
  feed(p, s("GNGGA,183015.00,5612.3456,N,12041.2345,W,1,09,0.92,701.3,M,-17.0,M,,"), 2000);
  feed(p, s("GNGSA,A,3,05,13,15,18,20,23,24,,,,,,1.71,0.92,1.44,1"), 2000);
  feed(p, s("GPGSV,3,1,11,05,45,123,40,13,30,060,38,15,70,200,44,18,20,300,30,1"), 2000);
  feed(p, s("GPGSV,3,2,11,20,10,010,25,23,50,250,41,24,60,150,42,29,05,330,,1"), 2000);
  feed(p, s("GAGSV,1,1,04,02,40,100,35,08,20,200,30,11,35,050,33,30,60,270,40,7"), 2000);
  CHECK(p.fix.rmcValid);
  NEAR(p.fix.lat, 56.205760, 1e-5);
  NEAR(p.fix.lon, -120.687242, 1e-5);
  NEAR(p.fix.kmh, 63.0, 0.1);
  NEAR(p.fix.course, 87.5, 0.01);
  CHECK(p.fix.quality == 1);
  CHECK(p.fix.satsUsed == 9);
  NEAR(p.fix.hdop, 0.92, 1e-3);
  NEAR(p.fix.alt, 701.3, 0.01);
  CHECK(p.fix.fixType == 3);
  CHECK(p.satsInView(2000) == 15);           // 11 GPS + 4 Galileo
  CHECK(p.satsInView(9000) == -1);           // nothing heard for 7 s: unknown, not zero
  CHECK(p.fix.dateOk && p.fix.timeOk);
  // 2026-10-27 18:30:15 UTC = 1793125815000 ms
  CHECK(fixEpochMs(p.fix) == 1793125815000LL);
  // 3. a corrupted sentence is rejected and changes nothing
  std::string bad = s("GNRMC,183016.00,A,0000.0000,N,00000.0000,E,0.0,0.0,271026,,,A,V");
  bad[20] = '9';
  CHECK(feed(p, bad, 3000) == 0);
  CHECK(p.badSum == 1);
  NEAR(p.fix.lat, 56.205760, 1e-5);
  // 4. losing the signal: RMC goes void, position time stops advancing
  feed(p, s("GNRMC,183020.00,V,,,,,,,271026,,,N,V"), 7000);
  feed(p, s("GNGGA,183020.00,,,,,0,00,99.99,,,,,,"), 7000);
  CHECK(!p.fix.rmcValid);
  CHECK(p.fix.quality == 0);
  CHECK(p.fix.posAt == 2000);
  // 5. garbage and wrong baud rate noise never counts as a sentence
  CHECK(feed(p, std::string("\xff\x13\x80garbage$$$***\n\n", 18), 8000) == 0);
  // 6. cardinal directions
  CHECK(!strcmp(cardinal(0, false), "N"));
  CHECK(!strcmp(cardinal(22.4f, false), "N"));
  CHECK(!strcmp(cardinal(22.6f, false), "NE"));
  CHECK(!strcmp(cardinal(359, false), "N"));
  CHECK(!strcmp(cardinal(200, false), "S"));
  CHECK(!strcmp(cardinal(250, true), "WSW"));
  CHECK(!strcmp(cardinal(-1, false), "--"));
  // 7. distance: 1 degree of latitude is about 111.2 km
  NEAR(distM(56, -120, 57, -120), 111195, 50);
  DONE();
}
