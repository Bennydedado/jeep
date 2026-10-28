// WheelMap.h - what the right steering wheel buttons do, set in Heep and passed on by the T3.
//
// The map is one short line of text, "<tap>,<hold>;<tap>,<hold>;<tap>,<hold>" for right top, middle, bottom:
//   "V+,V+;AN,HU;V-,V-"   (the default: volume up, answer / hang up, volume down)
// Tokens:  V+ V-  volume      MU mute      PP play/pause   NX next track   PV previous track
//          SR source          SI Siri      AN answer call  HU hang up      HB high beams on/off
//          T1 T2 T3  a T3 button (tap = short press, hold = long press)    --  nothing
//          Kxx  any Kenwood code, 2 hex digits (e.g. K89, to find the answer-call code)
// Tap and hold the same (V+,V+): it goes on press and repeats while held (volume and tracks only).
// Hold "--": tap goes on press, no waiting. Otherwise tap goes on release, hold at 1 s.
//
// The T3 sends the map as "$N,M,<map>*HH" (HH = XOR checksum, like the $J lines) until the Nano's heartbeat
// carries the same hash. The Nano keeps it in EEPROM, so it works the same with the T3 off or unplugged.
// Plain C++ (no Arduino calls) so tests/firmware/test_wheelmap.cpp can run it on a PC.
#pragma once
#include <stdint.h>
#include <string.h>

#define WMAP_DEFAULT "V+,V+;AN,HU;V-,V-"
#define WMAP_MAX 40          // longest map kept (the longest possible is 23)
#define WMAP_HOLD_MS 1000
#define WMAP_REP_DELAY_MS 500
#define WMAP_REP_MS 180

enum WKind : uint8_t { WA_NONE, WA_KW, WA_ANSWER, WA_HANGUP, WA_BEAMS, WA_T3 };
struct WAction {
  uint8_t kind = WA_NONE;
  uint8_t code = 0;          // WA_KW: the Kenwood code; WA_T3: button 1-3
  bool repeats = false;      // may repeat while held
  bool operator==(const WAction& o) const { return kind == o.kind && code == o.code; }
};

inline uint16_t wmapHash(const char* s) {   // same as jlinkMapHash on the T3
  uint32_t h = 2166136261u;
  for (; *s; s++) { h ^= (uint8_t)*s; h *= 16777619u; }
  return (uint16_t)(h ^ (h >> 16));
}

inline int wmapHex(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }

// one token (exactly n chars) -> action; false if it isn't one
inline bool wmapToken(const char* t, int n, WAction& a) {
  a = WAction();
  if (n == 3 && t[0] == 'K' && wmapHex(t[1]) >= 0 && wmapHex(t[2]) >= 0) { a.kind = WA_KW; a.code = wmapHex(t[1]) * 16 + wmapHex(t[2]); return true; }
  if (n != 2) return false;
  static const struct { char t[3]; uint8_t kind, code; bool rep; } T[] = {
    { "V+", WA_KW, 0x14, true }, { "V-", WA_KW, 0x15, true }, { "MU", WA_KW, 0x16, false }, { "PP", WA_KW, 0x0E, false },
    { "NX", WA_KW, 0x0B, true }, { "PV", WA_KW, 0x0A, true }, { "SR", WA_KW, 0x13, false }, { "SI", WA_KW, 0x8B, false },
    { "AN", WA_ANSWER, 0, false }, { "HU", WA_HANGUP, 0, false }, { "HB", WA_BEAMS, 0, false },
    { "T1", WA_T3, 1, false }, { "T2", WA_T3, 2, false }, { "T3", WA_T3, 3, false }, { "--", WA_NONE, 0, false } };
  for (const auto& e : T) if (t[0] == e.t[0] && t[1] == e.t[1]) { a.kind = e.kind; a.code = e.code; a.repeats = e.rep; return true; }
  return false;
}

// the whole map -> out[button][0 tap / 1 hold]; false (and out untouched) unless every part is right
inline bool wmapParse(const char* s, WAction out[3][2]) {
  if (!s || strlen(s) > WMAP_MAX) return false;
  WAction m[3][2];
  const char* p = s;
  for (int b = 0; b < 3; b++)
    for (int k = 0; k < 2; k++) {
      const char* end = p;
      while (*end && *end != ',' && *end != ';') end++;
      if (!wmapToken(p, end - p, m[b][k])) return false;
      char want = k == 0 ? ',' : (b < 2 ? ';' : 0);
      if (*end != want) return false;
      p = end + (want ? 1 : 0);
    }
  memcpy(out, m, sizeof(m));
  return true;
}

// one right button: call every loop with whether it's down; fire(action, isHold) runs the action
struct WButton { bool down = false, held = false; unsigned long downAt = 0, lastRep = 0; };
template <class F>
void wmapStep(WButton& b, const WAction& tap, const WAction& hold, bool isDown, unsigned long now, F fire) {
  bool same = tap == hold, quick = same || hold.kind == WA_NONE;
  if (isDown && !b.down) {
    b.down = true; b.held = false; b.downAt = b.lastRep = now;
    if (quick) fire(tap, false);
    return;
  }
  if (isDown && b.down) {
    if (same) {
      if (tap.repeats && now - b.downAt > WMAP_REP_DELAY_MS && now - b.lastRep > WMAP_REP_MS) { b.lastRep = now; fire(tap, false); }
    } else if (!quick && !b.held && now - b.downAt >= WMAP_HOLD_MS) {
      b.held = true; b.lastRep = now; fire(hold, true);
    } else if (b.held && hold.repeats && now - b.lastRep > WMAP_REP_MS) {
      b.lastRep = now; fire(hold, true);
    }
  }
  if (!isDown && b.down) {
    b.down = false;
    if (!quick && !b.held) fire(tap, false);
  }
}

// reads "$N,M,<map>*HH" lines one character at a time; true when a good line with a good map arrived
class WMapRx {
 public:
  uint16_t good = 0, bad = 0;
  bool feed(char c, char* mapOut) {   // mapOut: WMAP_MAX + 1 chars
    if (c == '$') { len = 0; buf[len++] = c; return false; }
    if (!len || c == '\r') return false;
    if (c != '\n') { if (len < (int)sizeof(buf) - 1) buf[len++] = c; else { len = 0; bad++; } return false; }
    buf[len] = 0; len = 0;
    char* star = strchr(buf, '*');
    if (strncmp(buf, "$N,M,", 5) || !star || wmapHex(star[1]) < 0 || wmapHex(star[2]) < 0 || star[3]) { bad++; return false; }
    uint8_t x = 0;
    for (char* q = buf + 1; q < star; q++) x ^= (uint8_t)*q;
    if (x != wmapHex(star[1]) * 16 + wmapHex(star[2])) { bad++; return false; }
    *star = 0;
    WAction m[3][2];
    if (!wmapParse(buf + 5, m)) { bad++; return false; }
    strcpy(mapOut, buf + 5);
    good++;
    return true;
  }
 private:
  char buf[WMAP_MAX + 16];
  int len = 0;
};
