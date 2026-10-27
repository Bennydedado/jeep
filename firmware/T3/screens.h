// screens.h - what a T3 screen is made of, and the short text format screens travel and are stored in.
//
// A screen is a name, an on/off switch and up to MAX_WIDGETS widgets placed on the 128x64 display:
//
//   Boost|1|v,boost,0,0,128,44,4,c,lu,0,0,|b,boost,0,46,128,18,1,l,lu,0,30,
//   ^name ^on  ^ widgets, separated by '|'... see below
//
// Screen text:  <name>|<on 0/1>|<widget>|<widget>|...
// Widget text:  <type>,<field>,<x>,<y>,<w>,<h>,<size>,<align>,<flags>,<min>,<max>,<text>
//   type   v value (small label on top, the number below in `size`)   r row (label left, value right)
//          b bar (label + value on top, a bar from min to max under it)   l label (just `text`)   n line
//   field  one of the ids in fields.h (ignored for l and n)
//   size   1 small 6x8, 2 big 12x16 pixel font, 3 = 12 pt sans, 4 = 18 pt sans (the biggest)
//   align  l c r
//   flags  any of: l = show the label, u = show the unit, f = frame (box around the widget), i = inverted (white box)
//   text   replaces the field's own label (no commas or pipes)
//
// Plain C++ so tests/firmware/test_screens.cpp can check it on a PC. Heep's editor writes the same format
// (app file t3screens.js). Bad numbers are clamped onto the screen; an unknown field shows "?" instead of crashing.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "config.h"
#include "fields.h"

struct Widget {
  char type = 'v';
  int8_t field = -1;      // index into FIELDS, -1 = none/unknown
  int16_t x = 0, y = 0, w = 128, h = 16;
  uint8_t size = 1;
  char align = 'l';
  bool label = true, unit = true, frame = false, invert = false;
  float mn = 0, mx = 100;
  char text[13] = "";
};
struct Screen {
  char name[13] = "";
  bool on = true;
  uint8_t n = 0;
  Widget w[MAX_WIDGETS];
};

inline int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

// copy one '|' or ',' separated piece out of `s` starting at *pos; returns false at the end
// (*pos becomes -1 after the last piece)
inline bool nextPiece(const char* s, int* pos, char sep, char* out, int cap) {
  if (*pos < 0) return false;
  int k = 0, i = *pos;
  while (s[i] && s[i] != sep) { if (k < cap - 1) out[k++] = s[i]; i++; }
  out[k] = 0;
  *pos = s[i] == sep ? i + 1 : -1;
  return true;
}

inline bool parseWidget(const char* s, Widget& w) {
  char p[24]; int pos = 0, i = 0;
  Widget d;
  while (i < 12 && nextPiece(s, &pos, ',', p, sizeof(p))) {
    switch (i) {
      case 0: if (!strchr("vrbln", p[0]) || !p[0]) return false; d.type = p[0]; break;
      case 1: d.field = (int8_t)fieldIndex(p); break;
      case 2: d.x = (int16_t)clampi(atoi(p), 0, SCREEN_W - 1); break;
      case 3: d.y = (int16_t)clampi(atoi(p), 0, SCREEN_H - 1); break;
      case 4: d.w = (int16_t)clampi(atoi(p), 1, SCREEN_W); break;
      case 5: d.h = (int16_t)clampi(atoi(p), 1, SCREEN_H); break;
      case 6: d.size = (uint8_t)clampi(atoi(p), 1, 4); break;
      case 7: d.align = (p[0] == 'c' || p[0] == 'r') ? p[0] : 'l'; break;
      case 8: d.label = strchr(p, 'l') != nullptr; d.unit = strchr(p, 'u') != nullptr; d.frame = strchr(p, 'f') != nullptr; d.invert = strchr(p, 'i') != nullptr; break;
      case 9: d.mn = (float)atof(p); break;
      case 10: d.mx = (float)atof(p); break;
      case 11: strncpy(d.text, p, sizeof(d.text) - 1); d.text[sizeof(d.text) - 1] = 0; break;
    }
    i++;
  }
  if (i < 6) return false;                      // at least type, field and the box
  if (d.x + d.w > SCREEN_W) d.w = SCREEN_W - d.x;
  if (d.y + d.h > SCREEN_H) d.h = SCREEN_H - d.y;
  if (d.mx <= d.mn) d.mx = d.mn + 1;
  w = d;
  return true;
}

// returns false if the text isn't a screen at all; widgets that don't parse are skipped
inline bool parseScreen(const char* s, Screen& out) {
  Screen sc;
  char p[80]; int pos = 0;
  if (!nextPiece(s, &pos, '|', p, sizeof(p)) || !p[0]) return false;
  strncpy(sc.name, p, sizeof(sc.name) - 1);
  if (!nextPiece(s, &pos, '|', p, sizeof(p))) return false;
  sc.on = p[0] != '0';
  while (sc.n < MAX_WIDGETS && nextPiece(s, &pos, '|', p, sizeof(p))) {
    if (!p[0]) continue;
    Widget w;
    if (parseWidget(p, w)) sc.w[sc.n++] = w;
  }
  out = sc;
  return true;
}

inline void fmtNum(char* b, int cap, float v) {
  if (v == (int)v) snprintf(b, cap, "%d", (int)v); else snprintf(b, cap, "%g", v);
}
inline int writeScreen(const Screen& sc, char* out, int cap) {
  int k = snprintf(out, cap, "%s|%d", sc.name, sc.on ? 1 : 0);
  for (int i = 0; i < sc.n && k < cap; i++) {
    const Widget& w = sc.w[i];
    char fl[5]; int f = 0;
    if (w.label) fl[f++] = 'l';
    if (w.unit) fl[f++] = 'u';
    if (w.frame) fl[f++] = 'f';
    if (w.invert) fl[f++] = 'i';
    fl[f] = 0;
    char mn[16], mx[16];
    fmtNum(mn, sizeof(mn), w.mn); fmtNum(mx, sizeof(mx), w.mx);
    k += snprintf(out + k, cap - k, "|%c,%s,%d,%d,%d,%d,%d,%c,%s,%s,%s,%s", w.type, w.field >= 0 ? FIELDS[w.field].id : "-",
                  w.x, w.y, w.w, w.h, w.size, w.align, fl, mn, mx, w.text);
  }
  return k;
}

// a short fingerprint of the screen set, so Heep can tell the T3 has exactly what it sent (FNV-1a, 32 bit)
// A row's (or bar's) label next to its value in the small font (6 px a character): cut so a blank character is left
// before the value, at a space when there is one, and left out if fewer than 2 characters fit. `room` = pixels from
// where the label starts to where the value starts. "Peak boost" beside "12.3" in a half-width row -> "Peak".
// Heep's preview does the same (fitLabel in t3screens.js).
inline void fitLabel(const char* label, int room, char* out, int cap) {
  int len = (int)strlen(label), n = room / 6 - 1, cut;
  if (n >= len) cut = len;
  else if (n < 2) cut = 0;
  else {
    cut = n;
    while (cut > 0 && label[cut] != ' ') cut--;   // back to a space (label[n] is the first character that won't fit)
    if (cut < 2) cut = n;                          // one long word: cut it
  }
  while (cut > 0 && label[cut - 1] == ' ') cut--;
  if (cut > cap - 1) cut = cap - 1;
  memcpy(out, label, cut); out[cut] = 0;
}

inline uint32_t fnv1a(const char* s, uint32_t h = 2166136261u) { while (*s) { h ^= (uint8_t)*s++; h *= 16777619u; } return h; }

// the screens a new T3 starts with (and "Restore defaults" in Heep goes back to). Keep in step with t3screens.js.
static const char* const DEFAULT_SCREENS[] = {
  "Temp & dir|1|l,-,0,0,60,8,1,c,,0,0,HEADING|l,-,66,0,62,8,1,c,,0,0,OUTSIDE|v,hdg,0,10,62,30,4,c,,0,0,|v,otemp,66,10,62,30,4,c,u,0,0,|n,-,63,2,1,46,1,l,,0,0,|r,hdgd,0,48,62,8,1,l,,0,0,|r,gfix,0,56,128,8,1,l,l,0,0,|r,sats,66,48,62,8,1,r,l,0,0,",
  "Drive|1|v,kmh,0,0,80,40,4,l,lu,0,0,|v,hdg,82,0,46,20,2,r,,0,0,|v,otemp,82,22,46,18,1,r,u,0,0,|r,tavg,0,46,128,8,1,l,lu,0,0,|r,tkm,0,56,128,8,1,l,lu,0,0,",
  "Boost|1|v,boost,0,0,128,40,4,c,lu,0,0,|b,boost,0,42,128,12,1,l,,0,30,|r,bmax,0,56,64,8,1,l,l,0,0,|r,rpm,66,56,62,8,1,r,l,0,0,",
  "Economy|1|v,tavg,0,0,128,40,4,c,lu,0,0,|r,econ,0,44,128,8,1,l,lu,0,0,|r,tkm,0,54,128,8,1,l,lu,0,0,",
  "Trip|1|r,tstate,0,0,128,8,1,l,l,0,0,|r,tkm,0,10,128,8,1,l,lu,0,0,|r,ttime,0,19,128,8,1,l,l,0,0,|r,tl,0,28,128,8,1,l,lu,0,0,|r,tavgs,0,37,128,8,1,l,lu,0,0,|r,tvmax,0,46,128,8,1,l,lu,0,0,|r,tidle,0,55,128,8,1,l,l,0,0,",
  "Engine|1|r,rpm,0,0,128,8,1,l,l,0,0,|r,boost,0,10,128,8,1,l,lu,0,0,|r,ect,0,20,128,8,1,l,lu,0,0,|r,iat,0,30,128,8,1,l,lu,0,0,|r,volt,0,40,128,8,1,l,lu,0,0,|r,load,0,50,128,8,1,l,lu,0,0,",
  "GPS|1|r,gfix,0,0,128,8,1,l,l,0,0,|r,sats,0,9,128,8,1,l,l,0,0,|r,hdop,0,18,128,8,1,l,l,0,0,|r,kmhg,0,27,128,8,1,l,lu,0,0,|r,lat,0,36,128,8,1,l,l,0,0,|r,lon,0,45,128,8,1,l,l,0,0,|r,alt,0,54,128,8,1,l,lu,0,0,",
  "Connections|1|r,obd,0,0,128,8,1,l,l,0,0,|r,ble,0,10,128,8,1,l,l,0,0,|r,wifi,0,20,128,8,1,l,l,0,0,|r,nano,0,30,128,8,1,l,l,0,0,|r,queue,0,40,128,8,1,l,l,0,0,|r,clock,0,50,128,8,1,l,l,0,0,",
  "Logging|1|r,sd,0,0,128,8,1,l,l,0,0,|r,sdfree,0,10,128,8,1,l,lu,0,0,|r,logn,0,20,128,8,1,l,l,0,0,|r,queue,0,30,128,8,1,l,l,0,0,|r,tstate,0,40,128,8,1,l,l,0,0,",
  "System|1|r,fw,0,0,128,8,1,l,l,0,0,|r,up,0,10,128,8,1,l,l,0,0,|r,heap,0,20,128,8,1,l,lu,0,0,|r,btn,0,30,128,8,1,l,l,0,0,|r,date,0,40,128,8,1,l,l,0,0,|r,totkm,0,50,128,8,1,l,lu,0,0,",
};
static const int DEFAULT_SCREEN_COUNT = sizeof(DEFAULT_SCREENS) / sizeof(DEFAULT_SCREENS[0]);
