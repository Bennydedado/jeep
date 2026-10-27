// obdpid.h - reading the engine computer's answers (OBD-II mode 01) without Arduino, so tests/firmware/test_obdpid.cpp
// can check it on a PC.
//
//  - which values the engine offers: the answers to 0100, 0120, 0140, 0160, 0180 are 32-bit masks
//    (bit 31 = the first PID of that block). The T3 only asks for what's offered.
//  - intake pressure for boost: PID 0B (MAP, kPa) on most engines; some diesels only give PID 87 (MAP, 1/32 kPa)
//    or PID 70 (boost pressure sensor, 1/32 kPa).
//
// Answers arrive with spaces, line breaks and the '>' prompt already removed and in capitals, e.g. "410B65".
// With several engine computers answering, the same "41xx" can appear more than once: masks are OR'ed together.
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

struct ObdSupport {
  uint32_t mask[5] = { 0, 0, 0, 0, 0 };   // PIDs 01-20, 21-40, 41-60, 61-80, 81-A0
  bool known = false;                     // an answer to 0100 arrived

  bool has(int pid) const {
    if (pid <= 0 || pid > 0xA0) return false;
    int b = (pid - 1) / 32, bit = 31 - ((pid - 1) % 32);
    return (mask[b] >> bit) & 1;
  }
  // an answer to 01<base> (base 00, 20, 40, 60, 80). Returns the next block to ask for, or -1.
  int feed(const char* r, int base) {
    if (base < 0 || base > 0x80 || base % 32) return -1;
    char want[5]; snprintf4(want, base);
    bool any = false;
    for (const char* p = strstr(r, want); p; p = strstr(p + 4, want)) {
      if (strlen(p) < 12) break;
      char hex[9]; memcpy(hex, p + 4, 8); hex[8] = 0;
      mask[base / 32] |= (uint32_t)strtoul(hex, nullptr, 16);
      any = true;
    }
    if (!any) return -1;
    if (base == 0) known = true;
    return (base < 0x80 && has(base + 0x20)) ? base + 0x20 : -1;
  }
  // "04 05 0B 0C ..." for Diagnostics
  int list(char* out, int cap) const {
    int k = 0; out[0] = 0;
    for (int pid = 1; pid <= 0xA0 && k < cap - 4; pid++) if (has(pid) && pid % 32) k += snprintf(out + k, cap - k, k ? " %02X" : "%02X", pid);
    return k;
  }
 private:
  static void snprintf4(char* w, int base) { const char* hx = "0123456789ABCDEF"; w[0] = '4'; w[1] = '1'; w[2] = hx[(base >> 4) & 15]; w[3] = hx[base & 15]; w[4] = 0; }
};

// the data bytes after "41<pid>" in an answer (up to max); returns how many
inline int obdBytes(const char* r, int pid, uint8_t* out, int max) {
  const char* hx = "0123456789ABCDEF";
  char want[5] = { '4', '1', hx[(pid >> 4) & 15], hx[pid & 15], 0 };
  const char* p = strstr(r, want);
  if (!p) return 0;
  p += 4;
  int n = 0;
  while (n < max && p[0] && p[1]) {
    char h[3] = { p[0], p[1], 0 };
    char* end;
    long v = strtol(h, &end, 16);
    if (*end) break;
    out[n++] = (uint8_t)v;
    p += 2;
  }
  return n;
}

// intake manifold pressure in kPa from PID 0B, 87 or 70; -1 if this answer doesn't have it
inline float obdMapKpa(int pid, const uint8_t* b, int n) {
  if (pid == 0x0B && n >= 1) return b[0];
  if (pid == 0x87 && n >= 3 && (b[0] & 1)) return ((b[1] << 8) | b[2]) * 0.03125f;   // sensor A
  if (pid == 0x70 && n >= 5 && (b[0] & 2)) return ((b[3] << 8) | b[4]) * 0.03125f;   // boost pressure sensor A
  return -1;
}
