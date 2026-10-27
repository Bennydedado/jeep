// test_screens.cpp - the screen text format: defaults parse, round-trip, and bad input is made safe.
#include "../../firmware/T3/screens.h"
#include "check.h"

int main() {
  // every default screen parses, has widgets, and only uses fields that exist
  for (int i = 0; i < DEFAULT_SCREEN_COUNT; i++) {
    Screen sc;
    CHECK(parseScreen(DEFAULT_SCREENS[i], sc));
    CHECK(sc.n > 0);
    for (int k = 0; k < sc.n; k++) {
      const Widget& w = sc.w[k];
      if (w.type != 'l' && w.type != 'n') { if (w.field < 0) printf("  screen %d widget %d: unknown field\n", i, k); CHECK(w.field >= 0); }
      CHECK(w.x + w.w <= SCREEN_W && w.y + w.h <= SCREEN_H);
    }
    // write it back out and parse again: identical
    char a[1200], b[1200];
    writeScreen(sc, a, sizeof(a));
    Screen sc2; CHECK(parseScreen(a, sc2));
    writeScreen(sc2, b, sizeof(b));
    CHECK(!strcmp(a, b));
  }
  // the boost screen
  Screen sc;
  CHECK(parseScreen("Boost|1|v,boost,0,0,128,44,4,c,lu,0,0,|b,boost,0,46,128,18,1,l,lu,0,30,", sc));
  CHECK(!strcmp(sc.name, "Boost") && sc.on && sc.n == 2);
  CHECK(sc.w[0].type == 'v' && sc.w[0].size == 4 && sc.w[0].align == 'c' && sc.w[0].label && sc.w[0].unit);
  CHECK(sc.w[1].type == 'b' && sc.w[1].mx == 30);
  // off screens stay off
  CHECK(parseScreen("Hidden|0|r,rpm,0,0,128,8,1,l,l,0,0,", sc) && !sc.on);
  // out-of-range boxes are clamped onto the display
  CHECK(parseScreen("Big|1|v,kmh,120,60,500,500,9,z,lu,0,0,", sc));
  CHECK(sc.w[0].x == 120 && sc.w[0].w == 8 && sc.w[0].y == 60 && sc.w[0].h == 4 && sc.w[0].size == 4 && sc.w[0].align == 'l');
  // unknown field: kept, shown as "?" by the display
  CHECK(parseScreen("X|1|v,warpfactor,0,0,64,16,1,l,l,0,0,", sc) && sc.n == 1 && sc.w[0].field == -1);
  // bad widgets are skipped, the screen survives
  CHECK(parseScreen("Mixed|1|q,rpm,0,0,1,1|v,rpm|r,rpm,0,0,128,8,1,l,l,0,0,", sc) && sc.n == 1);
  // too many widgets: only MAX_WIDGETS kept
  char many[2000] = "Many|1";
  for (int i = 0; i < 15; i++) strcat(many, "|r,rpm,0,0,128,8,1,l,l,0,0,");
  CHECK(parseScreen(many, sc) && sc.n == MAX_WIDGETS);
  // not a screen
  CHECK(!parseScreen("", sc));
  CHECK(!parseScreen("|1|", sc));
  // bar min/max the wrong way round becomes a sane range
  CHECK(parseScreen("B|1|b,boost,0,0,128,10,1,l,,30,0,", sc) && sc.w[0].mx > sc.w[0].mn);
  // labels never run into the number (the Boost screen's "Peak boost" beside "12.3" in a half-width row)
  char lb[24];
  fitLabel("Peak boost", 64 - 24, lb, sizeof(lb)); CHECK(!strcmp(lb, "Peak"));
  fitLabel("Peak boost", 64 - 12, lb, sizeof(lb)); CHECK(!strcmp(lb, "Peak"));            // "--"
  fitLabel("Peak boost", 128 - 48, lb, sizeof(lb)); CHECK(!strcmp(lb, "Peak boost"));     // full width: all of it
  fitLabel("Satellites", 30, lb, sizeof(lb)); CHECK(!strcmp(lb, "Sate"));                 // one word: cut
  fitLabel("RPM", 62 - 24, lb, sizeof(lb)); CHECK(!strcmp(lb, "RPM"));
  fitLabel("Coolant", 10, lb, sizeof(lb)); CHECK(!strcmp(lb, ""));                        // no room: left out
  // fingerprint is stable
  CHECK(fnv1a("abc") == 0x1A47E90Bu);
  DONE();
}
