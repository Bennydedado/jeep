// test_jlink.cpp - the Nano -> T3 button link: good lines, repeats, and everything that must be ignored.
#include "../../firmware/T3/jlink.h"
#include "check.h"
#include <string>
#include <stdio.h>
#include <string.h>

static std::string frame(const char* body) {
  unsigned char x = 0; for (const char* p = body; *p; p++) x ^= (unsigned char)*p;
  char t[8]; snprintf(t, sizeof(t), "*%02X\n", x);
  return std::string("$") + body + t;
}
static int feed(JLinkParser& p, const std::string& text, uint32_t now, JEvent* last = nullptr) {
  int n = 0; JEvent e;
  for (char c : text) if (p.feed(c, now, e)) { n++; if (last) *last = e; }
  return n;
}

int main() {
  JLinkParser p; JEvent e;
  // a short press of button 3
  CHECK(feed(p, frame("J,7,B,3,S"), 100, &e) == 1);
  CHECK(e.kind == 'B' && e.button == 3 && e.press == 'S' && e.seq == 7);
  // the deliberate second copy 30 ms later is ignored
  CHECK(feed(p, frame("J,7,B,3,S"), 130) == 0);
  CHECK(p.dups == 1);
  // the same seq much later (after wrapping round) is a new press
  CHECK(feed(p, frame("J,7,B,3,S"), 5000) == 1);
  // heartbeat
  CHECK(feed(p, frame("J,8,H,123,1"), 5100, &e) == 1);
  CHECK(e.kind == 'H' && e.uptime == 123 && e.proto == 1);
  // long press and repeat
  CHECK(feed(p, frame("J,9,B,1,L"), 5200, &e) == 1 && e.press == 'L' && e.button == 1);
  CHECK(feed(p, frame("J,10,B,1,R"), 5450, &e) == 1 && e.press == 'R');
  // things that must never become a press
  uint32_t bad0 = p.bad;
  std::string flipped = frame("J,11,B,2,S"); flipped[9] = '3';      // a bit flipped on the wire: checksum fails
  CHECK(feed(p, flipped, 6000) == 0);
  CHECK(feed(p, frame("J,12,B,4,S"), 6000) == 0);                    // no button 4
  CHECK(feed(p, frame("J,13,B,0,S"), 6000) == 0);
  CHECK(feed(p, frame("J,14,B,2,X"), 6000) == 0);                    // unknown press type
  CHECK(feed(p, frame("J,70000,B,2,S"), 6000) == 0);                 // seq out of range
  CHECK(feed(p, frame("J,15,B,2,S,9"), 6000) == 0);                  // extra field
  CHECK(feed(p, frame("J,16,Q,2,S"), 6000) == 0);                    // unknown kind
  CHECK(feed(p, frame("X,17,B,2,S"), 6000) == 0);                    // not ours
  CHECK(feed(p, "$J,18,B,2,S\n", 6000) == 0);                        // no checksum
  CHECK(feed(p, "$J,19,B,2,S*ZZ\n", 6000) == 0);
  CHECK(feed(p, "Nano debug: pedal pressed 2x\r\n", 6000) == 0);     // the Nano's own Serial.print lines
  CHECK(feed(p, std::string(200, 'A') + "\n", 6000) == 0);           // noise
  CHECK(p.bad - bad0 == 10);
  // a truncated line followed by a good one: the good one still gets through
  CHECK(feed(p, std::string("$J,20,B,2") + frame("J,21,B,2,S"), 7000, &e) == 1 && e.seq == 21);
  // protocol 2 heartbeat: + the Nano's right-button map hash
  CHECK(feed(p, frame("J,22,H,50,2,3FA0"), 8000, &e) == 1);
  CHECK(e.kind == 'H' && e.proto == 2 && e.cfg == 0x3FA0);
  CHECK(feed(p, frame("J,23,H,51,1"), 9000, &e) == 1 && e.cfg == -1);
  CHECK(feed(p, frame("J,24,H,52,2,XYZ"), 10000) == 0);              // not hex
  CHECK(feed(p, frame("J,25,H,53,2,12345"), 10000) == 0);            // too long
  CHECK(feed(p, frame("J,26,H,54,2,1,2"), 10000) == 0);              // extra field
  // 2.19: a 16-bit seq from an older Nano sketch is taken as its low byte (300 -> 44), so the link keeps working
  CHECK(feed(p, frame("J,300,H,60,2,3FA0"), 20000, &e) == 1 && e.kind == 'H' && e.seq == 44);
  CHECK(feed(p, frame("J,300,H,60,2,3FA0"), 20010) == 0);            // its repeat is still a repeat
  CHECK(feed(p, frame("J,65535,H,61,2,3FA0"), 21000, &e) == 1 && e.seq == 255);
  CHECK(feed(p, frame("J,123456,H,61,2,3FA0"), 22000) == 0);         // too long
  // 2.19: headlight events (jeep_controller_v3.2)
  CHECK(feed(p, frame("J,27,E,SD,13"), 23000, &e) == 1);
  CHECK(e.kind == 'E' && !strcmp(e.what, "SD") && e.flags == (HL_K1 | HL_STALK | HL_SAFE));
  CHECK(!strcmp(jlinkWhat("SD"), "Stalk grounded") && !strcmp(jlinkWhat("ZZ"), "?"));
  CHECK(feed(p, frame("J,28,E,PD,4"), 23100, &e) == 1 && e.flags == HL_MODE);
  CHECK(feed(p, frame("J,29,E,sd,1"), 23200) == 0);                   // lower case
  CHECK(feed(p, frame("J,30,E,SDX,1"), 23200) == 0);                  // 3 letters
  CHECK(feed(p, frame("J,31,E,SD,123"), 23200) == 0);                 // 3 hex digits
  CHECK(feed(p, frame("J,32,E,SD,G"), 23200) == 0);                   // not hex
  CHECK(feed(p, frame("J,33,E,SD"), 23200) == 0);                     // no flags
  // 2.19: bytes heard and the last raw text, so Diagnostics can tell "nothing arrives" from "garbage arrives"
  JLinkParser q; char raw[40];
  q.rawText(raw, sizeof(raw));
  CHECK(q.bytes == 0 && raw[0] == 0);
  feed(q, std::string("\x01\xFF" "ab\r\n"), 0);
  q.rawText(raw, sizeof(raw));
  CHECK(q.bytes == 6 && !strcmp(raw, "..ab|"));
  feed(q, frame("J,1,H,5,2,3FA0") + frame("J,2,H,6,2,3FA0"), 1000);
  q.rawText(raw, sizeof(raw));
  CHECK(strlen(raw) == 32);
  CHECK(std::string(raw).find("|$J,2,H,6,2,3FA0*") != std::string::npos);
  char tiny[5]; q.rawText(tiny, sizeof(tiny)); CHECK(strlen(tiny) == 4);
  // the T3 -> Nano map line
  char line[64];
  int n = jlinkMapLine("V+,V+;AN,HU;V-,V-", line, sizeof(line));
  CHECK(n > 0 && std::string(line, n) == frame("N,M,V+,V+;AN,HU;V-,V-"));
  CHECK(jlinkMapLine(std::string(70, 'A').c_str(), line, sizeof(line)) == 0);
  CHECK(jlinkMapHash("") == (uint16_t)(2166136261u ^ (2166136261u >> 16)));
  CHECK(jlinkMapHash("V+,V+;AN,HU;V-,V-") != jlinkMapHash("V-,V-;AN,HU;V+,V+"));
  DONE();
}
