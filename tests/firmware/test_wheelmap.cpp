// test_wheelmap.cpp - the right-button map: parsing, the T3 -> Nano line, and tap / hold / repeat timing.
#include "../../nano/NanoT3Example/WheelMap.h"
#include "../../firmware/T3/jlink.h"
#include "check.h"
#include <string>
#include <vector>

struct Fired { WAction a; bool hold; unsigned long at; };
std::vector<Fired> fired;
unsigned long T = 0;

// hold a button down for `ms`, then let go for 300 ms
void press(WButton& b, const WAction& tap, const WAction& hold, int ms) {
  auto f = [](const WAction& a, bool h) { fired.push_back({ a, h, T }); };
  for (int i = 0; i < ms; i++, T++) wmapStep(b, tap, hold, true, T, f);
  for (int i = 0; i < 300; i++, T++) wmapStep(b, tap, hold, false, T, f);
}

int main() {
  WAction m[3][2];
  CHECK(wmapParse(WMAP_DEFAULT, m));
  CHECK(m[0][0].kind == WA_KW && m[0][0].code == 0x14 && m[0][0].repeats && m[0][0] == m[0][1]);
  CHECK(m[1][0].kind == WA_ANSWER && m[1][1].kind == WA_HANGUP);
  CHECK(m[2][1].code == 0x15);
  CHECK(wmapParse("K89,--;T2,HB;NX,PV", m) && m[0][0].code == 0x89 && m[0][1].kind == WA_NONE && m[1][0].kind == WA_T3 && m[1][0].code == 2 && m[1][1].kind == WA_BEAMS);
  // never half-applied: anything wrong and the old map stays
  const char* bad[] = { "", "V+,V+;AN,HU", "V+,V+;AN,HU;V-,V-;", "V+,V+;AN,HU;V-;V-", "V+,V+;AN,XX;V-,V-", "K8G,--;AN,HU;V-,V-", "v+,V+;AN,HU;V-,V-",
                        "V+,V+,AN,HU;V-,V-", "V+ ,V+;AN,HU;V-,V-" };
  WAction keep[3][2]; wmapParse(WMAP_DEFAULT, keep);
  for (auto s : bad) { CHECK(!wmapParse(s, keep)); }
  CHECK(keep[0][0].code == 0x14);
  // both ends hash the same
  CHECK(wmapHash(WMAP_DEFAULT) == jlinkMapHash(WMAP_DEFAULT));

  // the T3's line -> the Nano's reader
  WMapRx rx; char got[WMAP_MAX + 1] = "";
  char line[64]; int n = jlinkMapLine("PP,SI;AN,HU;NX,NX", line, sizeof(line));
  bool ok = false;
  std::string noise = "garbage\n$N,M,V+*00\n";
  for (char c : noise) ok |= rx.feed(c, got);
  CHECK(!ok && rx.bad == 1);
  for (int i = 0; i < n; i++) ok |= rx.feed(line[i], got);
  CHECK(ok && std::string(got) == "PP,SI;AN,HU;NX,NX");
  std::string flipped(line, n); flipped[6] = '-';                    // a bit flipped on the wire
  ok = false; for (char c : flipped) ok |= rx.feed(c, got);
  CHECK(!ok && std::string(got) == "PP,SI;AN,HU;NX,NX");
  n = jlinkMapLine("PP,SI;AN,HU;NX", line, sizeof(line));            // checksum fine, map not
  ok = false; for (int i = 0; i < n; i++) ok |= rx.feed(line[i], got);
  CHECK(!ok);

  // volume (tap = hold): once on press, then repeats after 0.5 s every ~0.18 s
  WButton b;
  wmapParse(WMAP_DEFAULT, m);
  fired.clear(); unsigned long t0 = T; press(b, m[0][0], m[0][1], 100);
  CHECK(fired.size() == 1 && fired[0].at == t0);                    // straight away
  fired.clear(); press(b, m[0][0], m[0][1], 1000);
  CHECK(fired.size() == 4);                                          // press, ~501, ~682, ~863
  // answer / hang up: tap on release, hold at 1 s and nothing on release
  fired.clear(); t0 = T; press(b, m[1][0], m[1][1], 200);
  CHECK(fired.size() == 1 && fired[0].a.kind == WA_ANSWER && fired[0].at == t0 + 200);
  fired.clear(); t0 = T; press(b, m[1][0], m[1][1], 1500);
  CHECK(fired.size() == 1 && fired[0].a.kind == WA_HANGUP && fired[0].hold && fired[0].at == t0 + 1000);
  // hold "--": tap on press
  wmapParse("PP,--;AN,HU;V-,V-", m);
  fired.clear(); t0 = T; press(b, m[0][0], m[0][1], 1500);
  CHECK(fired.size() == 1 && fired[0].a.code == 0x0E && fired[0].at == t0);
  // play/pause both ways: once, never repeats
  wmapParse("PP,PP;AN,HU;V-,V-", m);
  fired.clear(); press(b, m[0][0], m[0][1], 2000);
  CHECK(fired.size() == 1);
  // tap Siri, hold next track (repeats while held)
  wmapParse("SI,NX;AN,HU;V-,V-", m);
  fired.clear(); t0 = T; press(b, m[0][0], m[0][1], 1500);
  CHECK(fired.size() >= 3 && fired[0].a.code == 0x0B && fired[0].hold && fired[0].at == t0 + 1000);
  for (auto& f : fired) CHECK(f.a.code != 0x8B);
  DONE();
}
