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

  // the whole settings line: right | pedal | options | codes
  WConfig c = wcfgDefault();
  CHECK(c.pedal[0].code == 0x0E && c.pedal[1].code == 0x0B && c.pedal[2].code == 0x0A && c.pedal[3].code == 0x8B);
  CHECK(c.lmidBeams && c.lmidMode && c.answer == 0xFF && c.hangup == 0xFF);
  CHECK(wcfgParse("PP,--;AN,HU;V-,V-|SI,MU,SR,HB|01|8992", c));
  CHECK(!c.lmidBeams && c.lmidMode && c.answer == 0x89 && c.hangup == 0x92 && c.pedal[3].kind == WA_BEAMS && c.right[0][0].code == 0x0E);
  CHECK(wcfgParse("V+,V+;AN,HU;V-,V-", c) && c.answer == 0x89 && !c.lmidBeams);   // right buttons only: the rest stays
  const char* badc[] = { "V+,V+;AN,HU;V-,V-|PP,NX,PV|11|FFFF", "V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|12|FFFF", "V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|11|FFF",
                         "V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|11", "V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|11|FFFF|", "V+,V+;AN,HU;V-,V-|PP,NX,PV,SI,|11|FFFF",
                         "V+,V+;AN,HU;V-,V-|PP,NX,PV,SI|11|FFFG" };
  for (auto s2 : badc) { WConfig k = c; CHECK(!wcfgParse(s2, k)); CHECK(k.answer == 0x89); }
  CHECK(strlen("K8A,K8B;K8C,K8D;K8E,K8F|K90,K91,K92,K93|11|FFFF") <= WMAP_MAX);
  CHECK(wmapHash(WCFG_DEFAULT) == jlinkMapHash(WCFG_DEFAULT));
  { // the T3's lines for both
    WMapRx r2; char o[WMAP_MAX + 1] = ""; uint8_t code = 0; char got2 = 0;
    char l2[96]; int k2 = jlinkMapLine(WCFG_DEFAULT, l2, sizeof(l2));
    for (int i = 0; i < k2; i++) got2 |= r2.feed(l2[i], o, &code);
    CHECK(got2 == 'M' && std::string(o) == WCFG_DEFAULT);
    got2 = 0; k2 = jlinkNLine("K,8A", l2, sizeof(l2));
    for (int i = 0; i < k2; i++) got2 |= r2.feed(l2[i], o, &code);
    CHECK(got2 == 'K' && code == 0x8A && std::string(o) == WCFG_DEFAULT);
    got2 = 0; k2 = jlinkNLine("K,8", l2, sizeof(l2));
    for (int i = 0; i < k2; i++) got2 |= r2.feed(l2[i], o, &code);
    CHECK(got2 == 0);
  }

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
