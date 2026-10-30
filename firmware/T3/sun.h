// sun.h - sunrise and sunset for "Night mode: sunset to sunrise" (the screen dims when it's dark out).
// The usual almanac formula (accurate to a few minutes), from the date and where the Jeep last had a GPS fix.
// Plain C++ so tests/firmware/test_sun.cpp can check it on a PC.
#pragma once
#include <math.h>
#include <stdint.h>

// UTC hour (0-24) of sunrise (rise) or sunset; -1 = the sun stays down all day, -2 = it stays up all day
inline double sunEventUtc(int dayOfYear, double lat, double lon, bool rise) {
  const double D = M_PI / 180;
  double lngHour = lon / 15;
  double t = dayOfYear + ((rise ? 6 : 18) - lngHour) / 24;
  double M = 0.9856 * t - 3.289;
  double L = fmod(M + 1.916 * sin(M * D) + 0.020 * sin(2 * M * D) + 282.634 + 720, 360);
  double RA = fmod(atan(0.91764 * tan(L * D)) / D + 720, 360);
  RA += floor(L / 90) * 90 - floor(RA / 90) * 90;
  RA /= 15;
  double sinDec = 0.39782 * sin(L * D), cosDec = cos(asin(sinDec));
  double cosH = (cos(90.833 * D) - sinDec * sin(lat * D)) / (cosDec * cos(lat * D));
  if (cosH > 1) return -1;
  if (cosH < -1) return -2;
  double H = (rise ? 360 - acos(cosH) / D : acos(cosH) / D) / 15;
  double T = H + RA - 0.06571 * t - 6.622;
  return fmod(T - lngHour + 48, 24);
}

// is it dark (between sunset and sunrise) at this moment (ms since 1970, UTC) and place?
inline bool sunIsDown(int64_t utcMs, double lat, double lon) {
  int64_t days = utcMs / 86400000LL;
  double hourNow = (utcMs % 86400000LL) / 3600000.0;
  // day of the year from days since 1970 (civil-from-days)
  int64_t z = days + 719468, era = (z >= 0 ? z : z - 146096) / 146097;
  int64_t doe = z - era * 146097, yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int64_t y = yoe + era * 400, doy0 = doe - (365 * yoe + yoe / 4 - yoe / 100);   // day of year counted from 1 March
  int64_t mp = (5 * doy0 + 2) / 153, d = doy0 - (153 * mp + 2) / 5 + 1, m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y++;
  static const int before[] = { 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334 };
  bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
  int doy = before[m - 1] + (int)d + (leap && m > 2 ? 1 : 0);
  double up = sunEventUtc(doy, lat, lon, true), down = sunEventUtc(doy, lat, lon, false);
  if (up == -1 || down == -1) return true;     // polar night
  if (up == -2 || down == -2) return false;    // midnight sun
  bool day = up < down ? (hourNow >= up && hourNow < down) : (hourNow >= up || hourNow < down);
  return !day;
}
