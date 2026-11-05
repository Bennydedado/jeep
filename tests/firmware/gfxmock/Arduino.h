// gfxmock/Arduino.h - just enough "Arduino" to build the real Adafruit GFX library and the T3's draw.h on a PC
// (tests/firmware/test_draw.cpp). Only what those two use.
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <string>
#include <algorithm>
#include <vector>
#include <map>   // (before min/max below, which break the standard headers)
class __FlashStringHelper;
class String {
  std::string s;
 public:
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(const std::string& c) : s(c) {}
  String(char c) : s(1, c) {}
  String(int v) : s(std::to_string(v)) {}
  String(long v) : s(std::to_string(v)) {}
  String(unsigned v) : s(std::to_string(v)) {}
  String(unsigned long v) : s(std::to_string(v)) {}
  String(double v, int dp = 2) { char b[40]; snprintf(b, sizeof(b), "%.*f", dp, v); s = b; }
  unsigned length() const { return (unsigned)s.size(); }
  const char* c_str() const { return s.c_str(); }
  char operator[](unsigned i) const { return i < s.size() ? s[i] : 0; }
  String substring(unsigned a) const { return a < s.size() ? String(s.substr(a)) : String(); }
  String substring(unsigned a, unsigned b) const { if (b > s.size()) b = (unsigned)s.size(); return a < b ? String(s.substr(a, b - a)) : String(); }
  int lastIndexOf(char c) const { size_t p = s.rfind(c); return p == std::string::npos ? -1 : (int)p; }
  int indexOf(char c) const { size_t p = s.find(c); return p == std::string::npos ? -1 : (int)p; }
  void trim() { size_t a = s.find_first_not_of(" \t\r\n"); if (a == std::string::npos) { s.clear(); return; } s = s.substr(a, s.find_last_not_of(" \t\r\n") - a + 1); }
  String& operator+=(const String& o) { s += o.s; return *this; }
  friend String operator+(const String& a, const String& b) { return String(a.s + b.s); }
  friend String operator+(const String& a, const char* b) { return String(a.s + b); }
  friend String operator+(const char* a, const String& b) { return String(a + b.s); }
  bool operator==(const String& o) const { return s == o.s; }
  bool operator!=(const String& o) const { return s != o.s; }
  bool operator==(const char* o) const { return s == o; }
  bool operator!=(const char* o) const { return s != o; }
};
#define PROGMEM
#define radians(d) ((d) * M_PI / 180.0)
#ifndef min
#define min(a, b) ((a) < (b) ? (a) : (b))
#endif
#ifndef max
#define max(a, b) ((a) > (b) ? (a) : (b))
#endif
