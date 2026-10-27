// scrtool.cpp - the T3's own screen code (firmware/T3/screens.h) as a command-line tool, so the app tests can
// check that what Heep's editor sends is exactly what the T3 will keep. Reads a screen set (one screen per line)
// on stdin and prints:
//   hash <fnv1a of the whole set, hex>       (what the T3 compares with the fingerprint Heep sends)
//   <widget count>\t<the screen as the T3 writes it back>    for every line, or  BAD\t<line>  if it won't parse
#include "../../firmware/T3/screens.h"
#include <string>
#include <iostream>

int main() {
  std::string all, line;
  bool first = true;
  while (std::getline(std::cin, line)) { if (!first) all += "\n"; all += line; first = false; }
  printf("hash %x\n", fnv1a(all.c_str()));
  size_t from = 0;
  while (from <= all.size()) {
    size_t e = all.find('\n', from);
    if (e == std::string::npos) e = all.size();
    std::string s = all.substr(from, e - from);
    from = e + 1;
    if (s.empty()) continue;
    Screen sc;
    if (!parseScreen(s.c_str(), sc)) { printf("BAD\t%s\n", s.c_str()); continue; }
    char out[1200];
    writeScreen(sc, out, sizeof(out));
    printf("%d\t%s\n", sc.n, out);
  }
  return 0;
}
