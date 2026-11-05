// test_draw.cpp - draws every default T3 screen with the T3's own drawing code (firmware/T3/draw.h) and the real
// Adafruit GFX library and fonts, on a PC, and checks nothing a widget draws spills outside its box, with ordinary
// values and with the widest ones each field can show.
//   g++ -std=c++17 -DARDUINO=200 -I tests/firmware/gfxmock -I <Adafruit GFX library folder>
//       tests/firmware/test_draw.cpp <Adafruit GFX library folder>/Adafruit_GFX.cpp -o t_draw && ./t_draw [out folder|-] [more]
// With an out folder it also writes each screen as a picture (.pgm, 128x64) to look at. "more" is a file of more screens
// to check, one per line (run.sh passes Heep's templates and setups).
#include <Adafruit_GFX.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#define SSD1306_WHITE 1
#define SSD1306_BLACK 0
#include "../../firmware/T3/screens.h"
#include "check.h"
#include <map>
#include <vector>
#include <string>

// the T3's OLED (T3Oled in t3.h): pixels outside the clip box aren't drawn. Here they're also counted: the only
// ones allowed are a letter's tail in the one pixel row just under a row of text.
struct Panel : Adafruit_GFX {
  uint8_t px[SCREEN_H][SCREEN_W];
  int cx0 = -32768, cy0 = -32768, cx1 = 32767, cy1 = 32767;
  int clippedBadly = 0, clippedTails = 0;
  Panel() : Adafruit_GFX(SCREEN_W, SCREEN_H) { clear(); }
  void clear() { memset(px, 0, sizeof(px)); clippedBadly = clippedTails = 0; }
  void clipTo(int x, int y, int w, int h) { cx0 = x; cy0 = y; cx1 = x + w - 1; cy1 = y + h - 1; }
  void clipOff() { cx0 = cy0 = -32768; cx1 = cy1 = 32767; }
  void drawPixel(int16_t x, int16_t y, uint16_t c) override {
    if (x < cx0 || x > cx1 || y < cy0 || y > cy1) { if (x >= cx0 && x <= cx1 && y == cy1 + 1) clippedTails++; else clippedBadly++; return; }
    if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) { clippedBadly++; return; }
    px[y][x] = c ? 1 : 0;
  }
};
static Panel oled;

// what each field shows: "ordinary" values, and the widest each can be
static std::map<std::string, std::string> shown;
static const char* const ORDINARY[] = {
  "kmh=87", "kmhg=86", "kmho=87", "hdg=NE", "hdgd=047\xF7", "otemp=-12.5", "clock=18:42", "date=2026-10-27", "rpm=1850",
  "boost=14.2", "bmax=21.6", "ect=187", "iat=46", "volt=14.1", "load=52", "lph=7.4", "econ=8.5", "maf=38.5", "rail=850",
  "tstate=RUNNING", "tkm=42.7", "ttime=0:38", "tl=3.94", "tavg=9.2", "tavgs=67", "tvmax=104", "tidle=0:03", "totkm=15204",
  "totl=1421", "totavg=9.3", "dte=512", "fuel=61", "gfix=3D FIX", "sats=9/14", "hdop=0.9", "alt=702", "lat=56.24650",
  "lon=-120.84760", "obd=reading", "ble=Heep on", "wifi=connected", "upstat=uploaded", "nano=ok", "sd=logging",
  "sdfree=29811", "logn=2311", "queue=0", "fw=2.23", "up=0:41", "heap=92", "btn=3S", nullptr };
static const char* const WIDEST[] = {
  "kmh=188", "kmhg=188", "kmho=188", "hdg=(NNE)", "hdgd=(359)", "otemp=-40.5", "clock=23:59", "date=2026-12-31",
  "rpm=4800", "boost=28.5", "bmax=29.9", "ect=230", "iat=140", "volt=14.8", "load=100", "lph=25.0", "econ=99.9",
  "maf=199.9", "rail=1800", "tstate=WAITING", "tkm=999.9", "ttime=12:59", "tl=99.99", "tavg=25.5", "tavgs=120",
  "tvmax=188", "tidle=9:59", "totkm=999999", "totl=99999", "totavg=12.5", "dte=1200", "fuel=78", "gfix=GPS BAUD?",
  "sats=12/24", "hdop=25.5", "alt=2500", "lat=-56.24650", "lon=-120.84760", "obd=connected", "ble=Heep on",
  "wifi=not connected", "upstat=not uploaded", "nano=lost", "sd=card error", "sdfree=29811", "logn=123456", "queue=12",
  "fw=2.23", "up=99:59", "heap=180", "btn=3S", nullptr };
static void useValues(const char* const* list) {
  shown.clear();
  for (int i = 0; list[i]; i++) { std::string s = list[i]; size_t e = s.find('='); shown[s.substr(0, e)] = s.substr(e + 1); }
}
static bool tempsF = false;
String fieldText(int f) { auto it = shown.find(FIELDS[f].id); return it == shown.end() ? String("--") : String(it->second); }
float fieldNumber(int f) { auto it = shown.find(FIELDS[f].id); return it == shown.end() ? NAN : (float)atof(it->second.c_str()); }
String unitFor(int f) {
  const char* id = FIELDS[f].id;
  if (!strcmp(id, "otemp") || !strcmp(id, "ect") || !strcmp(id, "iat")) return tempsF ? "F" : "C";
  return FIELDS[f].unit;
}

#include "../../firmware/T3/draw.h"

static void savePgm(const char* dir, const char* name, int set) {
  char path[300], clean[40]; int k = 0;
  for (const char* p = name; *p && k < 30; p++) clean[k++] = isalnum((unsigned char)*p) ? *p : '_';
  clean[k] = 0;
  snprintf(path, sizeof(path), "%s/%s_%d.pgm", dir, clean, set);
  FILE* f = fopen(path, "wb");
  if (!f) return;
  fprintf(f, "P5\n%d %d\n255\n", SCREEN_W, SCREEN_H);
  for (int y = 0; y < SCREEN_H; y++) for (int x = 0; x < SCREEN_W; x++) fputc(oled.px[y][x] ? 255 : 0, f);
  fclose(f);
}

int main(int argc, char** argv) {
  oled.setTextWrap(false);
  std::vector<std::string> all(DEFAULT_SCREENS, DEFAULT_SCREENS + DEFAULT_SCREEN_COUNT);
  if (argc > 2) { FILE* f = fopen(argv[2], "r"); char line[1600]; CHECK(f != nullptr);
    while (f && fgets(line, sizeof(line), f)) { std::string l = line; while (!l.empty() && (l.back() == '\n' || l.back() == '\r')) l.pop_back(); if (!l.empty()) all.push_back(l); }
    if (f) fclose(f); }
  bool pictures = argc > 1 && strcmp(argv[1], "-");
  for (int set = 0; set < 2; set++) {
    useValues(set ? WIDEST : ORDINARY);
    tempsF = set == 1;
    for (size_t i = 0; i < all.size(); i++) {
      Screen sc;
      CHECK(parseScreen(all[i].c_str(), sc));
      // each widget alone: everything it draws stays inside its own box
      for (int k = 0; k < sc.n; k++) {
        const Widget& w = sc.w[k];
        oled.clear();
        drawWidget(w);
        int out = oled.clippedBadly;
        for (int y = 0; y < SCREEN_H; y++) for (int x = 0; x < SCREEN_W; x++)
          if (oled.px[y][x] && (x < w.x || x >= w.x + w.w || y < w.y || y >= w.y + w.h)) out++;
        if (out) printf("  %s, widget %d (%c %s), %s values: %d pixels cut off at its box\n", sc.name, k, w.type,
                        w.field >= 0 ? FIELDS[w.field].id : "-", set ? "widest" : "ordinary", out);
        CHECK(out == 0);
      }
      // no two boxes overlap (a divider line may touch anything)
      for (int a = 0; a < sc.n; a++) for (int b = a + 1; b < sc.n; b++) {
        const Widget &p = sc.w[a], &q = sc.w[b];
        if (p.type == 'n' || q.type == 'n') continue;
        bool overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
        if (overlap) printf("  %s: widgets %d and %d overlap\n", sc.name, a, b);
        CHECK(!overlap);
      }
      oled.clear();
      for (int k = 0; k < sc.n; k++) drawWidget(sc.w[k]);
      if (pictures) savePgm(argv[1], sc.name, set);
    }
  }
  // the degree sign is drawn (a ring) in the smooth fonts, and counted in the width
  useFont(2);
  CHECK(textWidth(String("047\xF7"), 2) > textWidth(String("047"), 2) + 4);
  DONE();
}
