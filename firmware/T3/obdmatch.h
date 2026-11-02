// Pure name matching for the BLE OBD scan, kept separate so the adapter-name rules can be tested on a PC.
#pragma once

inline char obdFold(char c) { return c >= 'A' && c <= 'Z' ? (char)(c + ('a' - 'A')) : c; }

inline bool obdNameContains(const char* name, const char* needle) {
  if (!name || !needle || !needle[0]) return false;
  for (const char* p = name; *p; p++) {
    const char* a = p;
    const char* b = needle;
    while (*a && *b && obdFold(*a) == obdFold(*b)) { a++; b++; }
    if (!*b) return true;
  }
  return false;
}

inline bool obdNameStartsWith(const char* name, const char* prefix) {
  if (!name || !prefix || !prefix[0]) return false;
  while (*name && *prefix && obdFold(*name) == obdFold(*prefix)) { name++; prefix++; }
  return !*prefix;
}

inline bool obdNameMatches(const char* name, const char* configured) {
  if (!name || !name[0]) return false;
  if (configured && configured[0]) return obdNameContains(name, configured);
  static const char* const names[] = { "vlink", "v-link", "icar", "vgate", "obd", "elm", "vlinker", "ios-vlink" };
  for (const char* candidate : names) if (obdNameContains(name, candidate)) return true;
  return false;
}
