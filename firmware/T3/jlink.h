// jlink.h - the Nano -> T3 wire: one short text line per message, checked like an NMEA sentence.
//
//   $J,<seq>,B,<button 1-3>,<S|L|R>*HH    a steering wheel button: S short press, L long press, R repeat while held
//   $J,<seq>,H,<uptime s>,<protocol>*HH   heartbeat, about once a second
//
// HH is the XOR of every character between '$' and '*', in hex (same as NMEA). <seq> counts 0-255 and wraps.
// The Nano sends every button message twice, 30 ms apart, with the same seq: the T3 keeps the first good copy
// and ignores the repeat, so one garbled line can't lose a press, and a duplicate can't double it.
// Anything that doesn't parse perfectly is dropped and counted: a bad line can never trigger an action.
//
// Plain C++ (no Arduino calls) so tests/firmware/test_jlink.cpp can run it on a PC.
// The Nano side of this is nano/T3Link/T3Link.h.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define JLINK_PROTO 1

struct JEvent {
  char kind = 0;     // 'B' button, 'H' heartbeat
  int seq = -1;
  int button = 0;    // 1..3
  char press = 0;    // 'S', 'L', 'R'
  long uptime = 0;   // heartbeat: Nano seconds since power-on
  int proto = 0;     // heartbeat: Nano's protocol version
};

class JLinkParser {
 public:
  uint32_t good = 0, bad = 0, dups = 0;
  int lastSeq = -1;
  uint32_t lastSeqAt = 0;

  // feed one character; returns true and fills `out` when a new (not repeated) good message arrived
  bool feed(char c, uint32_t now, JEvent& out) {
    if (c == '$') { len = 0; buf[len++] = c; return false; }
    if (len == 0) return false;
    if (c == '\r') return false;
    if (c == '\n') { buf[len] = 0; len = 0; return line(now, out); }
    if (len < (int)sizeof(buf) - 1) buf[len++] = c; else { len = 0; bad++; }
    return false;
  }

  static int hexv(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
  static uint8_t sum(const char* from, const char* to) { uint8_t s = 0; for (const char* p = from; p < to; p++) s ^= (uint8_t)*p; return s; }

 private:
  char buf[48];
  int len = 0;

  static bool allDigits(const char* s) { if (!*s) return false; for (; *s; s++) if (*s < '0' || *s > '9') return false; return true; }

  bool line(uint32_t now, JEvent& out) {
    char* star = strchr(buf, '*');
    if (strncmp(buf, "$J,", 3) || !star || hexv(star[1]) < 0 || hexv(star[2]) < 0 || star[3]) { bad++; return false; }
    if (sum(buf + 1, star) != (uint8_t)(hexv(star[1]) * 16 + hexv(star[2]))) { bad++; return false; }
    *star = 0;
    char* f[6]; int n = 0;
    char* p = buf + 3;
    f[n++] = p;
    while (*p && n < 6) { if (*p == ',') { *p = 0; f[n++] = p + 1; } p++; }
    if (*p) { bad++; return false; }        // more fields than any message has
    if (!allDigits(f[0])) { bad++; return false; }
    JEvent e;
    e.seq = atoi(f[0]);
    if (e.seq > 255) { bad++; return false; }
    if (n == 4 && !strcmp(f[1], "B")) {
      if (strlen(f[2]) != 1 || f[2][0] < '1' || f[2][0] > '3') { bad++; return false; }
      if (strlen(f[3]) != 1 || !strchr("SLR", f[3][0])) { bad++; return false; }
      e.kind = 'B'; e.button = f[2][0] - '0'; e.press = f[3][0];
    } else if (n == 4 && !strcmp(f[1], "H")) {
      if (!allDigits(f[2]) || !allDigits(f[3])) { bad++; return false; }
      e.kind = 'H'; e.uptime = atol(f[2]); e.proto = atoi(f[3]);
    } else { bad++; return false; }
    good++;
    // the same seq again within 2 s is the deliberate repeat (or an echo): ignore it
    if (e.seq == lastSeq && now - lastSeqAt < 2000) { dups++; return false; }
    lastSeq = e.seq; lastSeqAt = now;
    out = e;
    return true;
  }
};
