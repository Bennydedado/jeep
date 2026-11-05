// draw.h - drawing one screen widget on the OLED (included by display.ino). Kept in its own file so the PC test
// (tests/firmware/test_draw.cpp) can draw the default screens with exactly this code and check nothing spills out of
// its box. Needs `oled` (an Adafruit_GFX display), FIELDS, fitLabel() (screens.h), and these three from display.ino:
#pragma once
String unitFor(int f);
String fieldText(int f);
float fieldNumber(int f);

// ---------------------------------------------------------------- one widget
// sizes: 1 the small built-in 6x8 font; 2, 3, 4 smooth bold fonts (9, 12 and 18 pt). Size 2 used to be the built-in
// font doubled (blocky, 10 letters across); from 2.23 it's 9 pt bold, about 13 px tall and easy to read from the seat.
static void useFont(int size) {
  oled.setTextSize(1);
  if (size == 4) oled.setFont(&FreeSansBold18pt7b);
  else if (size == 3) oled.setFont(&FreeSansBold12pt7b);
  else if (size == 2) oled.setFont(&FreeSansBold9pt7b);
  else oled.setFont();
}
static int capHeight(int size) { return size == 4 ? 25 : size == 3 ? 17 : size == 2 ? 13 : 8; }   // rows a digit covers
static int tailDepth(int size) { return size == 4 ? 7 : size == 3 ? 5 : size == 2 ? 4 : 0; }      // g, p, y below that
// the baseline that puts a line of text in the middle of h rows from y (tails and all, when there's room for them)
static int baselineIn(int y, int h, int size) {
  int full = capHeight(size) + tailDepth(size);
  return y + (h > full ? (h - full) / 2 : 0) + capHeight(size) - 1;
}
// the smooth fonts have no degree sign (the course is "047" + 0xF7, the small font's degree): it's drawn as a ring
static uint16_t ink = SSD1306_WHITE;
static int degRing(int size) { return size >= 4 ? 3 : 2; }
static int degWidth(const String& s, int size) {
  if (size == 1) return 0;
  int n = 0;
  for (unsigned i = 0; i < s.length(); i++) if ((uint8_t)s[i] == 0xF7) n++;
  return n * (degRing(size) * 2 + 3);
}
// print at the cursor in the current font (size = the font in use)
static void gprint(const String& s, int size) {
  if (!degWidth(s, size)) { oled.print(s); return; }
  int r = degRing(size);
  String part;
  for (unsigned i = 0; i <= s.length(); i++) {
    char c = i < s.length() ? s[i] : 0;
    if (c && (uint8_t)c != 0xF7) { part += String(c); continue; }
    if (part.length()) { oled.print(part); part = String(""); }
    if (c) {
      int x = oled.getCursorX(), y = oled.getCursorY();
      oled.drawCircle(x + 1 + r, y - capHeight(size) + 1 + r, r, ink);
      oled.setCursor(x + r * 2 + 3, y);
    }
  }
}
// text width/height in the current font; y for printing so the text sits inside [top, top+h)
static void measure(const String& s, int16_t& w, int16_t& h, int16_t& yOff, int size) {
  int16_t x1, y1; uint16_t ww, hh;
  oled.getTextBounds(s, 0, 0, &x1, &y1, &ww, &hh);
  w = (x1 > 0 ? x1 : 0) + ww + degWidth(s, size);   // from the cursor to the right edge of the ink
  if (size >= 2) { h = hh; yOff = -y1; }        // the smooth fonts print from the baseline
  else { h = 8; yOff = 0; }                      // the built-in font prints from the top
}
static int textWidth(const String& s, int size) {
  useFont(size);
  if (size == 1) return (int)s.length() * 6;
  int16_t tw, th, yo;
  measure(s, tw, th, yo, size);
  return tw;
}
// print at a baseline: the smooth fonts print from it, the built-in one from its top
static void printAt(const String& s, int x, int base, int size) {
  useFont(size);
  oled.setCursor(x, size == 1 ? base - 7 : base);   // (the small font's 8 rows include its tails)
  gprint(s, size);
}
// too wide for its box at this size? one size smaller, until it fits (or it's the smallest)
static int fitSize(const String& s, int w, int size) {
  int16_t tw, th, yo;
  while (size > 1) { useFont(size); measure(s, tw, th, yo, size); if (tw <= w) break; size--; }
  return size;
}
static void drawText(const String& s, int x, int y, int w, int h, char align, int size) {
  size = fitSize(s, w, size);
  useFont(size);
  int16_t tw, th, yo;
  measure(s, tw, th, yo, size);
  int cx = align == 'c' ? x + (w - tw) / 2 : align == 'r' ? x + w - tw : x;
  int cy = y + (h - th) / 2 + yo;
  if (size >= 2 && th > h) cy = y + yo;
  oled.setCursor(cx < x ? x : cx, cy);
  gprint(s, size);
  oled.setFont(); oled.setTextSize(1);
}

void drawWidget(const Widget& w) {
  oled.clipTo(w.x, w.y, w.w, w.h);   // nothing a widget draws lands outside its box (a g's tail at the bottom of a row)
  uint16_t fg = SSD1306_WHITE;
  if (w.invert) { oled.fillRect(w.x, w.y, w.w, w.h, SSD1306_WHITE); fg = SSD1306_BLACK; }
  oled.setTextColor(fg);
  ink = fg;
  if (w.frame) oled.drawRect(w.x, w.y, w.w, w.h, fg);
  const FieldDef* fd = w.field >= 0 ? &FIELDS[w.field] : nullptr;
  String label = w.text[0] ? String(w.text) : fd ? String(fd->label) : String("?");
  String unit = fd && w.unit ? unitFor(w.field) : String("");
  switch (w.type) {
    case 'n':
      if (w.w >= w.h) oled.drawFastHLine(w.x, w.y, w.w, fg); else oled.drawFastVLine(w.x, w.y, w.h, fg);
      break;
    case 'l':
      drawText(String(w.text), w.x, w.y, w.w, w.h, w.align, w.size);
      break;
    case 'r': {
      // a row: label on the left, value on the right. Size 1 small; size 2 or 3 in the smooth fonts (16 px rows at size
      // 2: four to a screen). A value too long for the row at its size drops to the small font; a label that doesn't
      // fit beside the value is cut back to a whole word, or left out.
      String v = fd ? fieldText(w.field) : String("?");
      if (unit.length() && v != "--") v += " " + unit;
      int pad = w.frame ? 2 : 0;
      int sz = w.size >= 3 ? 3 : w.size == 2 ? 2 : 1;
      if (sz > 1 && textWidth(v, sz) > w.w - 2 * pad - (w.label ? 17 : 0)) sz = 1;   // with a label: room for 2 small letters
      if (sz == 1) {
        oled.setFont(); oled.setTextSize(1);
        int ty = w.y + (w.h - 8) / 2;
        int vx = w.x + w.w - (int)v.length() * 6 - pad;
        if (w.label) { char lb[24]; fitLabel(label.c_str(), vx - w.x - pad, lb, sizeof(lb)); oled.setCursor(w.x + pad, ty); oled.print(lb); }
        oled.setCursor(w.label ? vx : (w.align == 'c' ? w.x + (w.w - (int)v.length() * 6) / 2 : w.align == 'r' ? vx : w.x), ty);
        oled.print(v);
        break;
      }
      int base = baselineIn(w.y, w.h, sz);
      int vw = textWidth(v, sz), vx = w.x + w.w - pad - vw;
      if (w.label) {
        // the label as big as the value if it fits; else small (it's only a reminder of what the number is); else cut
        // back to whole words; else small and cut. Never touching the value (5 px apart).
        int room = vx - w.x - pad - 5, ls = sz;
        String lb = label;
        if (textWidth(lb, sz) > room) {
          if (textWidth(lb, 1) <= room) ls = 1;
          else {
            while (lb.length() && textWidth(lb, sz) > room) { int sp = lb.lastIndexOf(' '); lb = sp > 0 ? lb.substring(0, sp) : String(""); }
            lb.trim();
            if (!lb.length()) { char c[24]; fitLabel(label.c_str(), room + 6, c, sizeof(c)); lb = c; ls = 1; }
          }
        }
        if (lb.length()) printAt(lb, w.x + pad, base, ls);
        printAt(v, vx, base, sz);
      } else printAt(v, w.align == 'c' ? w.x + (w.w - vw) / 2 : w.align == 'r' ? vx : w.x + pad, base, sz);
      oled.setFont(); oled.setTextSize(1);
      break;
    }
    case 'b': {
      float x = fd ? fieldNumber(w.field) : NAN;
      String v = fd ? fieldText(w.field) : String("?");
      if (unit.length() && v != "--") v += " " + unit;
      int top = w.y;
      if (w.label && w.size >= 2 && w.h >= 22) {      // the label and value above the bar in 9 pt
        int vw = textWidth(v, 2);
        String lb = label;
        while (lb.length() && textWidth(lb, 2) > w.w - vw - 5) { int sp = lb.lastIndexOf(' '); lb = sp > 0 ? lb.substring(0, sp) : String(""); }
        if (lb.length()) printAt(lb, w.x, w.y + 12, 2);
        printAt(v, w.x + w.w - vw, w.y + 12, 2);
        oled.setFont(); oled.setTextSize(1);
        top += 17;
      } else if (w.label && w.h >= 14) {
        oled.setFont(); oled.setTextSize(1);
        char lb[24]; fitLabel(label.c_str(), w.w - (int)v.length() * 6, lb, sizeof(lb));
        oled.setCursor(w.x, w.y); oled.print(lb);
        oled.setCursor(w.x + w.w - (int)v.length() * 6, w.y); oled.print(v);
        top += 9;
      }
      int bh = w.y + w.h - top;
      if (bh < 3) bh = 3;
      oled.drawRect(w.x, top, w.w, bh, fg);
      if (!isnan(x)) {
        float f = (x - w.mn) / (w.mx - w.mn);
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        oled.fillRect(w.x + 1, top + 1, (int)((w.w - 2) * f), bh - 2, fg);
      }
      break;
    }
    default: {   // 'v': label on top, the value as big as asked. Beside a big number (size 3 or 4) the label and the
                 // unit are 9 pt (readable); with a smaller number they're the small font.
      int top = w.y, hh = w.h;
      int ls = w.size >= 3 && w.h >= 34 ? 2 : 1;
      if (w.label) {
        int lh = ls == 2 ? 15 : 9;
        drawText(label, w.x + (w.frame ? 2 : 0), w.y + (w.frame ? 1 : 0), w.w - (w.frame ? 4 : 0), lh - 1, w.align, ls);
        top += lh; hh -= lh;
      }
      String v = fd ? fieldText(w.field) : String("?");
      bool sideUnit = unit.length() && v != "--" && w.size >= 2;
      if (unit.length() && v != "--" && w.size < 2) v += " " + unit;
      if (sideUnit) {
        // the number big, the unit beside it, both centred as a pair
        int us = w.size >= 3 ? 2 : 1;
        int uw = textWidth(unit, us) + 3;
        int sz = fitSize(v, w.w - uw, w.size);
        useFont(sz);
        int16_t tw, th, yo; measure(v, tw, th, yo, sz);
        int total = tw + uw;
        int cx = w.align == 'c' ? w.x + (w.w - total) / 2 : w.align == 'r' ? w.x + w.w - total : w.x;
        if (cx < w.x) cx = w.x;
        int cy = top + (hh - th) / 2;
        oled.setCursor(cx, cy + yo); gprint(v, sz);
        if (us == 2 && sz >= 2) printAt(unit, cx + tw + 3, cy + yo, 2);          // on the number's baseline
        else { oled.setFont(); oled.setTextSize(1); oled.setCursor(cx + tw + 2, cy + th - 8); oled.print(unit); }
        oled.setFont(); oled.setTextSize(1);
      } else drawText(v, w.x, top, w.w, hh, w.align, w.size);
    }
  }
  oled.setTextColor(SSD1306_WHITE);
  oled.clipOff();
}
