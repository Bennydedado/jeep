// jlink.h - the Nano -> T3 wire: one short text line per message, checked like an NMEA sentence.
//
//   $J,<seq>,B,<button 1-3>,<S|L|R>*HH    a steering wheel button: S short press, L long press, R repeat while held
//   $J,<seq>,H,<uptime s>,<protocol>*HH   heartbeat, about once a second
//   $J,<seq>,H,<uptime s>,2,<hash>*HH     protocol 2 (jeep_controller_v3): + the hash of the Nano's right-button map
//   $J,<seq>,E,<what>,<flags>*HH          a headlight event (jeep_controller_v3.2+), for Heep's Diagnostics only:
//                                         <what> 2 letters (SD stalk closed, SU stalk opened, PD pedal, ... see
//                                         HL_WHAT below), <flags> 1-2 hex digits: what the Nano had just done, see HL_*
//
// And the other way (2.12+, T3 TX on NANO_TX_PIN -> Nano D8), only the right-button map, sent until the Nano's
// heartbeat shows the same hash (the Nano keeps it in EEPROM and works the same with or without the T3):
//   $N,M,<settings>*HH                    e.g. $N,M,V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|11|FFFF*HH  (nano/NanoT3Example/WheelMap.h)
//   $N,K,<hh>*HH                          send this Kenwood code once (Heep's code tester; nothing is saved)
//
// HH is the XOR of every character between '$' and '*', in hex (same as NMEA). <seq> counts 0-255 and wraps.
// (2.19+: a seq up to 65535 is taken too, as its low byte, so a Nano sketch with a 16-bit counter keeps working.)
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
#include <stdio.h>

#define JLINK_PROTO 2

// headlight event flags: what the Nano's own pins were doing right after the event. "K1 told high" is what the
// Nano asked K1 to do; nothing here can see whether the relay contacts or the lights actually followed.
#define HL_K1     1    // the Nano is telling K1 to close (high beams)
#define HL_STALK  2    // the stalk wire is grounded (D7, debounced)
#define HL_MODE   4    // headlight mode is on
#define HL_D7RAW  8    // D7 reads grounded right now (not debounced)
#define HL_SAFE  16    // the fail-safe module is switched on (A1)

struct JEvent {
  char kind = 0;     // 'B' button, 'H' heartbeat
  int seq = -1;
  int button = 0;    // 1..3
  char press = 0;    // 'S', 'L', 'R'
  long uptime = 0;   // heartbeat: Nano seconds since power-on
  int proto = 0;     // heartbeat: Nano's protocol version
  long cfg = -1;     // heartbeat (protocol 2): hash of the Nano's right-button map, -1 = not sent
  char what[3] = "";  // 'E': the headlight event, e.g. "SD"
  int flags = 0;     // 'E': HL_* flags
};

// the headlight event names, in plain words (Heep shows these too, in t3.js)
inline const char* jlinkWhat(const char* w) {
  static const char* T[][2] = { { "BT", "Nano started" }, { "SD", "Stalk grounded" }, { "SU", "Stalk released" },
    { "PD", "Pedal tap" }, { "LM", "Left middle" }, { "RM", "Right middle" }, { "WB", "Wheel button (beams)" },
    { "MO", "Headlight mode on" }, { "MX", "Headlight mode off" }, { "MU", "Mode-off undid a tap" } };
  for (auto& t : T) if (!strcmp(t[0], w)) return t[1];
  return "?";
}

// the hash both ends use for the right-button map (same as wmapHash in nano/NanoT3Example/WheelMap.h)
inline uint16_t jlinkMapHash(const char* s) {
  uint32_t h = 2166136261u;
  for (; *s; s++) { h ^= (uint8_t)*s; h *= 16777619u; }
  return (uint16_t)(h ^ (h >> 16));
}
// "$N,<body>*HH\n" into out; returns its length (0 if it doesn't fit)
inline int jlinkNLine(const char* body, char* out, int cap) {
  int n = snprintf(out, cap, "$N,%s*", body);
  if (n < 0 || n + 4 > cap) return 0;
  uint8_t x = 0;
  for (int i = 1; i < n - 1; i++) x ^= (uint8_t)out[i];
  return n + snprintf(out + n, cap - n, "%02X\n", x);
}
// the Nano's settings ("$N,M,<settings>*HH") and a Kenwood code to send once ("$N,K,<hh>*HH")
inline int jlinkMapLine(const char* map, char* out, int cap) {
  char body[96];
  if (snprintf(body, sizeof(body), "M,%s", map) >= (int)sizeof(body)) return 0;
  return jlinkNLine(body, out, cap);
}

class JLinkParser {
 public:
  uint32_t good = 0, bad = 0, dups = 0;
  uint32_t bytes = 0;      // every byte heard at all: 0 means nothing reaches GPIO 39 (wiring), not a bad line
  int lastSeq = -1;
  uint32_t lastSeqAt = 0;

  // the last few characters heard, oldest first: line ends as '|', unprintable ones as '.' (garbage vs. real "$J," lines)
  void rawText(char* out, int cap) const {
    uint32_t n = rawLen < sizeof(raw) ? rawLen : sizeof(raw);
    int k = 0;
    for (uint32_t i = 0; i < n && k < cap - 1; i++) out[k++] = raw[(rawLen - n + i) % sizeof(raw)];
    out[k] = 0;
  }

  // feed one character; returns true and fills `out` when a new (not repeated) good message arrived
  bool feed(char c, uint32_t now, JEvent& out) {
    bytes++;
    if (c != '\r') { raw[rawLen % sizeof(raw)] = c == '\n' ? '|' : (c >= 32 && c < 127) ? c : '.'; rawLen++; }
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
  char raw[32];
  uint32_t rawLen = 0;

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
    if (strlen(f[0]) > 5) { bad++; return false; }
    long sq = atol(f[0]);
    if (sq > 65535) { bad++; return false; }
    e.seq = (int)(sq & 255);
    if (n == 4 && !strcmp(f[1], "B")) {
      if (strlen(f[2]) != 1 || f[2][0] < '1' || f[2][0] > '3') { bad++; return false; }
      if (strlen(f[3]) != 1 || !strchr("SLR", f[3][0])) { bad++; return false; }
      e.kind = 'B'; e.button = f[2][0] - '0'; e.press = f[3][0];
    } else if ((n == 4 || n == 5) && !strcmp(f[1], "H")) {
      if (!allDigits(f[2]) || !allDigits(f[3])) { bad++; return false; }
      e.kind = 'H'; e.uptime = atol(f[2]); e.proto = atoi(f[3]);
      if (n == 5) {
        int k = strlen(f[4]);
        if (k < 1 || k > 4) { bad++; return false; }
        long v = 0;
        for (int i = 0; i < k; i++) { int d = hexv(f[4][i]); if (d < 0) { bad++; return false; } v = v * 16 + d; }
        e.cfg = v;
      }
    } else if (n == 4 && !strcmp(f[1], "E")) {
      if (strlen(f[2]) != 2 || f[2][0] < 'A' || f[2][0] > 'Z' || f[2][1] < 'A' || f[2][1] > 'Z') { bad++; return false; }
      int k = strlen(f[3]);
      if (k < 1 || k > 2) { bad++; return false; }
      int v = 0;
      for (int i = 0; i < k; i++) { int d = hexv(f[3][i]); if (d < 0) { bad++; return false; } v = v * 16 + d; }
      e.kind = 'E'; e.what[0] = f[2][0]; e.what[1] = f[2][1]; e.what[2] = 0; e.flags = v;
    } else { bad++; return false; }
    good++;
    // the same seq again within 2 s is the deliberate repeat (or an echo): ignore it
    if (e.seq == lastSeq && now - lastSeqAt < 2000) { dups++; return false; }
    lastSeq = e.seq; lastSeqAt = now;
    out = e;
    return true;
  }
};
