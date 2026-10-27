// test_otarx.cpp - "Update over Bluetooth" bookkeeping: in-order packets, a lost packet, repeats, overlaps, the end.
#include "../../firmware/T3/otarx.h"
#include "check.h"
#include <string.h>
#include <vector>

static std::vector<uint8_t> pkt(uint32_t off, const std::vector<uint8_t>& prog, size_t body) {
  std::vector<uint8_t> p = { (uint8_t)off, (uint8_t)(off >> 8), (uint8_t)(off >> 16), (uint8_t)(off >> 24) };
  for (size_t i = off; i < off + body && i < prog.size(); i++) p.push_back(prog[i]);
  return p;
}

int main() {
  std::vector<uint8_t> prog(10000);
  for (size_t i = 0; i < prog.size(); i++) prog[i] = (uint8_t)(i * 7 + 3);
  std::vector<uint8_t> out;
  OtaRx rx;
  const uint8_t* d; size_t n;
  auto give = [&](uint32_t off, size_t body) {
    auto p = pkt(off, prog, body);
    int r = rx.feed(p.data(), p.size(), &d, &n);
    if (r == 1) { out.insert(out.end(), d, d + n); rx.wrote(n); }
    return r;
  };

  // not started: nothing happens
  CHECK(give(0, 100) == 0 && out.empty());
  rx.start(prog.size());
  CHECK(rx.active && !rx.done() && rx.percent() == 0);

  // in order
  CHECK(give(0, 178) == 1 && rx.got == 178);
  CHECK(!rx.ackDue());
  // one lost: the next one is a gap, nothing written, ask for 356... er, for what we have (178)
  CHECK(give(356, 178) == -1 && rx.got == 178 && rx.gaps == 1);
  // the same packet again (Heep went back): fine
  CHECK(give(178, 178) == 1 && rx.got == 356);
  // a repeat of something already written is skipped
  CHECK(give(0, 178) == 0 && rx.dups == 1);
  // an overlap writes only the new part
  CHECK(give(300, 178) == 1 && rx.got == 478 && out.size() == 478);
  // too short to be a packet
  { uint8_t junk[3] = { 1, 2, 3 }; CHECK(rx.feed(junk, 3, &d, &n) == 0); }
  // the rest, in 178-byte packets; an ack every 4 KB
  int acks = 0;
  while (!rx.done()) { CHECK(give(rx.got, 178) == 1); if (rx.ackDue()) { acks++; rx.acked(); } }
  CHECK(acks == 3);                                  // 4096, 8192, then the end (10000)
  CHECK(rx.got == prog.size() && out == prog);
  CHECK(rx.percent() == 100);
  // after the end: packets past it are ignored, never written
  CHECK(give(10000, 50) == 0 && out.size() == prog.size());
  // a last packet that runs past the end is cut at the end
  OtaRx r2; r2.start(100);
  { auto p = pkt(0, prog, 150); CHECK(r2.feed(p.data(), p.size(), &d, &n) == 1 && n == 100); r2.wrote(n); CHECK(r2.done() && r2.ackDue()); }
  // offsets above 64 KB (all four header bytes used)
  std::vector<uint8_t> big(200000, 0x5A);
  OtaRx r3; r3.start(big.size()); r3.got = 70000;
  { std::vector<uint8_t> p = { (uint8_t)70000, (uint8_t)(70000 >> 8), (uint8_t)(70000 >> 16), 0, 1, 2, 3 }; CHECK(r3.feed(p.data(), p.size(), &d, &n) == 1 && n == 3); }
  DONE();
}
