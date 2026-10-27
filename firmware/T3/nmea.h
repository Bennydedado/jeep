// nmea.h - reads the GPS's NMEA sentences (RMC, GGA, GSA, GSV, VTG) one character at a time.
//
// Plain C++ with no Arduino calls, so the same file is tested on a PC (tests/firmware/test_nmea.cpp).
// Every sentence's checksum is checked; a sentence that fails it is counted and thrown away.
// Nothing here decides whether a fix is "good enough": gps.ino does that with the numbers kept here.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

struct NmeaFix {
  // position: only meaningful while rmcValid && quality > 0
  double lat = 0, lon = 0;        // degrees, south and west negative
  float kmh = -1;                 // speed over ground, km/h (-1 = never had one)
  float course = -1;              // course over ground, degrees true (-1 = not given)
  float alt = NAN;                // metres above mean sea level (GGA)
  float hdop = NAN;               // horizontal dilution of precision: under 2 good, over 5 poor
  int quality = 0;                // GGA fix quality: 0 none, 1 GPS, 2 DGPS/SBAS, 6 estimated
  int fixType = 0;                // GSA: 1 none, 2 = 2D, 3 = 3D (0 = no GSA seen)
  int satsUsed = -1;              // GGA: satellites used in the fix
  bool rmcValid = false;          // RMC status A (active) vs V (void)
  // UTC from RMC (date) + time; dateOk only when RMC carried a real date
  int year = 0, month = 0, day = 0, hour = 0, minute = 0;
  float second = 0;
  bool dateOk = false, timeOk = false;
  uint32_t posAt = 0;             // ms (caller's clock) of the last valid position
  uint32_t timeAt = 0;            // ms when the UTC time above was read
};

class NmeaParser {
 public:
  NmeaFix fix;
  uint32_t sentences = 0, badSum = 0, chars = 0;
  uint32_t lastSentenceAt = 0;    // any good sentence, valid fix or not
  // satellites in view, per constellation (GP, GL, GA, GB/BD, GQ), each with when it was last heard
  int inView[6] = {0, 0, 0, 0, 0, 0};
  uint32_t inViewAt[6] = {0, 0, 0, 0, 0, 0};

  // total satellites in view across systems heard in the last 5 s
  int satsInView(uint32_t now) const {
    int n = 0; bool any = false;
    for (int i = 0; i < 6; i++) if (inViewAt[i] && now - inViewAt[i] < 5000) { n += inView[i]; any = true; }
    return any ? n : -1;
  }

  // feed one character; returns true when it completed a good sentence
  bool feed(char c, uint32_t now) {
    chars++;
    if (c == '$') { len = 0; buf[len++] = c; return false; }
    if (len == 0) return false;
    if (c == '\r') return false;
    if (c == '\n') { buf[len] = 0; bool ok = sentence(now); len = 0; return ok; }
    if (len < (int)sizeof(buf) - 1) buf[len++] = c; else len = 0;   // too long: not NMEA, start over
    return false;
  }

  static int hexv(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; }

 private:
  char buf[100];
  int len = 0;
  char* f[24];
  int nf = 0;

  bool sentence(uint32_t now) {
    char* star = strchr(buf, '*');
    if (!star || star - buf < 6 || hexv(star[1]) < 0 || hexv(star[2]) < 0) { badSum++; return false; }
    uint8_t sum = 0;
    for (char* p = buf + 1; p < star; p++) sum ^= (uint8_t)*p;
    if (sum != (uint8_t)(hexv(star[1]) * 16 + hexv(star[2]))) { badSum++; return false; }
    *star = 0;
    // split on commas (empty fields stay as "")
    nf = 0;
    char* p = buf + 1;
    f[nf++] = p;
    while (*p && nf < 24) { if (*p == ',') { *p = 0; f[nf++] = p + 1; } p++; }
    sentences++;
    lastSentenceAt = now;
    const char* id = f[0];
    if (strlen(id) < 5) return true;
    const char* type = id + 2;
    if (!strcmp(type, "RMC")) rmc(now);
    else if (!strcmp(type, "GGA")) gga(now);
    else if (!strcmp(type, "GSA")) gsa();
    else if (!strcmp(type, "GSV")) gsv(id, now);
    else if (!strcmp(type, "VTG")) vtg();
    return true;
  }
  const char* fld(int i) const { return i < nf ? f[i] : ""; }
  static double nmeaDeg(const char* v, const char* hemi) {
    if (!*v) return NAN;
    double raw = atof(v);
    int deg = (int)(raw / 100);
    double d = deg + (raw - deg * 100) / 60.0;
    if (*hemi == 'S' || *hemi == 'W') d = -d;
    return d;
  }
  void utcTime(const char* t, uint32_t now) {
    if (strlen(t) < 6) { fix.timeOk = false; return; }
    fix.hour = (t[0] - '0') * 10 + (t[1] - '0');
    fix.minute = (t[2] - '0') * 10 + (t[3] - '0');
    fix.second = (float)atof(t + 4);
    fix.timeOk = fix.hour < 24 && fix.minute < 60 && fix.second < 61;
    fix.timeAt = now;
  }
  void rmc(uint32_t now) {
    // $xxRMC,time,status,lat,N,lon,E,knots,course,date,magvar,E,mode*cs
    utcTime(fld(1), now);
    fix.rmcValid = fld(2)[0] == 'A';
    const char* d = fld(9);
    if (strlen(d) == 6) {
      fix.day = (d[0] - '0') * 10 + (d[1] - '0');
      fix.month = (d[2] - '0') * 10 + (d[3] - '0');
      fix.year = 2000 + (d[4] - '0') * 10 + (d[5] - '0');
      fix.dateOk = fix.month >= 1 && fix.month <= 12 && fix.day >= 1 && fix.day <= 31 && fix.year >= 2024;
    } else fix.dateOk = false;
    if (!fix.rmcValid) return;
    double la = nmeaDeg(fld(3), fld(4)), lo = nmeaDeg(fld(5), fld(6));
    if (isnan(la) || isnan(lo) || fabs(la) > 90 || fabs(lo) > 180) { fix.rmcValid = false; return; }
    fix.lat = la; fix.lon = lo; fix.posAt = now;
    if (*fld(7)) fix.kmh = (float)(atof(fld(7)) * 1.852);
    fix.course = *fld(8) ? (float)atof(fld(8)) : -1;
  }
  void gga(uint32_t now) {
    // $xxGGA,time,lat,N,lon,E,quality,sats,hdop,alt,M,geoid,M,age,station*cs
    fix.quality = atoi(fld(6));
    fix.satsUsed = *fld(7) ? atoi(fld(7)) : -1;
    fix.hdop = *fld(8) ? (float)atof(fld(8)) : NAN;
    fix.alt = *fld(9) ? (float)atof(fld(9)) : NAN;
    if (fix.quality > 0) {
      double la = nmeaDeg(fld(2), fld(3)), lo = nmeaDeg(fld(4), fld(5));
      if (!isnan(la) && !isnan(lo)) { fix.lat = la; fix.lon = lo; fix.posAt = now; }
    }
  }
  void gsa() {
    // $xxGSA,mode,fixType,sv x12,pdop,hdop,vdop[,systemId]*cs
    int t = atoi(fld(2));
    if (t >= 1 && t <= 3) fix.fixType = t;
  }
  void gsv(const char* id, uint32_t now) {
    // $xxGSV,totalMsgs,msgNo,satsInView,... : only the first message of each group needs reading
    if (atoi(fld(2)) != 1) return;
    int k = -1;
    if (id[0] == 'G' && id[1] == 'P') k = 0;
    else if (id[0] == 'G' && id[1] == 'L') k = 1;
    else if (id[0] == 'G' && id[1] == 'A') k = 2;
    else if ((id[0] == 'G' && id[1] == 'B') || (id[0] == 'B' && id[1] == 'D')) k = 3;
    else if (id[0] == 'G' && id[1] == 'Q') k = 4;
    else k = 5;
    inView[k] = atoi(fld(3));
    inViewAt[k] = now;
  }
  void vtg() {
    // $xxVTG,courseTrue,T,courseMag,M,knots,N,kmh,K,mode*cs
    if (*fld(7)) fix.kmh = (float)atof(fld(7));
    if (*fld(1)) fix.course = (float)atof(fld(1));
  }
};

// helpers shared with the screens and the log
inline const char* cardinal(float deg, bool sixteen) {
  static const char* p16[] = { "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW" };
  static const char* p8[] = { "N", "NE", "E", "SE", "S", "SW", "W", "NW" };
  if (deg < 0 || isnan(deg)) return "--";
  while (deg >= 360) deg -= 360;
  if (sixteen) return p16[(int)((deg + 11.25f) / 22.5f) % 16];
  return p8[(int)((deg + 22.5f) / 45.0f) % 8];
}
// days since 1970-01-01 for a civil date (Howard Hinnant's algorithm), for GPS -> epoch time
inline int64_t daysFromCivil(int y, int m, int d) {
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int64_t)doe - 719468;
}
inline int64_t fixEpochMs(const NmeaFix& f) {
  if (!f.dateOk || !f.timeOk) return 0;
  return (daysFromCivil(f.year, f.month, f.day) * 86400LL + f.hour * 3600LL + f.minute * 60LL) * 1000LL + (int64_t)(f.second * 1000);
}
// metres between two points (haversine); good to well under 1 % for driving distances
inline double distM(double la1, double lo1, double la2, double lo2) {
  const double r = 6371000.0, k = 3.14159265358979 / 180.0;
  double dla = (la2 - la1) * k, dlo = (lo2 - lo1) * k;
  double a = sin(dla / 2) * sin(dla / 2) + cos(la1 * k) * cos(la2 * k) * sin(dlo / 2) * sin(dlo / 2);
  return 2 * r * atan2(sqrt(a), sqrt(1 - a));
}
