// otarx.h - receiving a new T3 program over Bluetooth from Heep ("Update over Bluetooth"), the bookkeeping part.
//
// Heep sends the program as packets of  [offset: 4 bytes, little-endian][program bytes]  written to the same
// Bluetooth characteristic as the JSON messages, after {"c":"ota","do":"begin",...} put the T3 in update mode.
// The T3 writes the bytes in order. A packet from further on means one went missing: the T3 asks for it again
// ({"t":"ota","need":<offset>}) and Heep goes back to there. Repeats of bytes it already has are skipped.
// Every ACK_EVERY bytes it says how far it got ({"t":"ota","got":<bytes>}); Heep never runs more than a set
// amount ahead of that, so the T3's buffer can't overflow.
//
// Plain C++ (no Arduino), so tests/firmware/test_otarx.cpp checks it on a PC. ota.ino does the flash writing.
#pragma once
#include <stdint.h>
#include <stddef.h>

struct OtaRx {
  static const uint32_t ACK_EVERY = 4096;
  uint32_t size = 0, got = 0, ackedAt = 0, gaps = 0, dups = 0;
  bool active = false;

  void start(uint32_t total) { size = total; got = 0; ackedAt = 0; gaps = 0; dups = 0; active = total > 0; }

  // one packet. Returns  1 = write `*len` bytes from `*data` (then call wrote()),  0 = nothing to do (a repeat or
  // junk),  -1 = a gap: ask Heep for `got` again.
  int feed(const uint8_t* p, size_t n, const uint8_t** data, size_t* len) {
    *data = nullptr; *len = 0;
    if (!active || n < 5) return 0;
    uint32_t off = (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
    size_t body = n - 4;
    if (off > got) { gaps++; return -1; }                       // something before this one never arrived
    if (off >= size) { dups++; return 0; }                      // past the end: ignore
    uint32_t end = off + (uint32_t)body;
    if (end > size) end = size;                                 // never write past the program
    if (end <= got) { dups++; return 0; }                       // all of it already written
    uint32_t skip = got - off;                                  // overlap with what's written already
    *data = p + 4 + skip;
    *len = end - got;
    return 1;
  }
  void wrote(size_t n) { got += (uint32_t)n; }
  bool done() const { return active && got >= size; }
  bool ackDue() const { return got - ackedAt >= ACK_EVERY || (done() && ackedAt != got); }
  void acked() { ackedAt = got; }
  int percent() const { return size ? (int)((uint64_t)got * 100 / size) : 0; }
};
