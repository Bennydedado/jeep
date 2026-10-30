// test_sun.cpp - sunrise / sunset for the screen's night mode, against published times (a few minutes' slack).
#include "../../firmware/T3/sun.h"
#include "check.h"

static int64_t utc(int y, int mo, int d, int h, int mi) {   // days from civil (Howard Hinnant)
  y -= mo <= 2;
  int64_t era = (y >= 0 ? y : y - 399) / 400, yoe = y - era * 400;
  int64_t doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1, doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return ((era * 146097 + doe - 719468) * 86400 + h * 3600 + mi * 60) * 1000LL;
}

int main() {
  // Vancouver, 21 June 2026: sunrise 05:07 PDT (12:07 UTC), sunset 21:21 PDT (04:21 UTC next day)
  double la = 49.28, lo = -123.12;
  CHECK(fabs(sunEventUtc(172, la, lo, true) - 12.12) < 0.1);
  CHECK(fabs(sunEventUtc(172, la, lo, false) - 4.35) < 0.1);
  CHECK(!sunIsDown(utc(2026, 6, 21, 20, 0), la, lo));    // 1 PM local
  CHECK(sunIsDown(utc(2026, 6, 22, 5, 0), la, lo));      // 10 PM local
  CHECK(sunIsDown(utc(2026, 6, 21, 11, 30), la, lo));    // 4:30 AM local
  CHECK(!sunIsDown(utc(2026, 6, 21, 12, 30), la, lo));   // 5:30 AM local
  // Edmonton, 21 December 2026: sunrise 08:49 MST (15:49 UTC), sunset 16:15 MST (23:15 UTC)
  la = 53.55; lo = -113.49;
  CHECK(sunIsDown(utc(2026, 12, 21, 15, 30), la, lo));
  CHECK(!sunIsDown(utc(2026, 12, 21, 16, 10), la, lo));
  CHECK(!sunIsDown(utc(2026, 12, 21, 23, 0), la, lo));
  CHECK(sunIsDown(utc(2026, 12, 21, 23, 40), la, lo));
  // Tromsø: no sunrise in late December, no sunset in late June
  CHECK(sunEventUtc(355, 69.65, 18.96, true) == -1 && sunIsDown(utc(2026, 12, 21, 11, 0), 69.65, 18.96));
  CHECK(sunEventUtc(172, 69.65, 18.96, true) == -2 && !sunIsDown(utc(2026, 6, 21, 23, 0), 69.65, 18.96));
  DONE();
}
