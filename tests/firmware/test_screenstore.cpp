// Runs the T3's real screen storage code against flash that can fail mid-write.
#include <string>
#include <map>
#include <algorithm>
#include <cctype>
#include "../../firmware/T3/screens.h"
#include "check.h"

class String : public std::string {
public:
  using std::string::string;
  String(const std::string& s) : std::string(s) {}
  int indexOf(char c, int from = 0) const { auto i = find(c, from); return i == npos ? -1 : (int)i; }
  String substring(int a, int b) const { return substr(a, b - a); }
  void trim() {
    auto a = find_first_not_of(" \r\n\t"), b = find_last_not_of(" \r\n\t");
    *this = a == npos ? String() : String(substr(a, b - a + 1));
  }
};

static std::map<std::string, String> files;
static bool failOpen = false, shortWrite = false, failRename = false;
class File {
  std::string path;
  bool valid = false;
public:
  File() = default;
  File(const char* p, bool v) : path(p), valid(v) {}
  explicit operator bool() const { return valid; }
  String readString() const { return files[path]; }
  size_t print(const String& text) {
    auto n = shortWrite ? text.length() / 2 : text.length();
    files[path] = text.substr(0, n);
    return n;
  }
  void close() {}
};
static struct {
  File open(const char* p, const char* mode) {
    if (*mode == 'w') {
      if (failOpen) return File();
      files[p] = "";
      return File(p, true);
    }
    return File(p, files.count(p) > 0);
  }
  bool remove(const char* p) { return files.erase(p) > 0; }
  bool rename(const char* a, const char* b) {
    if (failRename || !files.count(a)) return false;
    files[b] = files[a]; files.erase(a); return true;
  }
} LittleFS;
static int fsLock = 0;
static const int portMAX_DELAY = 0;
static void xSemaphoreTake(int, int) {}
static void xSemaphoreGive(int) {}
static Screen screens[MAX_SCREENS];
static int screenCount = 0, page = 0;
static uint32_t screensHash = 0;
static void pageStep(int) { for (int i = 0; i < screenCount; i++) if (screens[i].on) { page = i; return; } }

#include "../../firmware/T3/screenstore.h"

int main() {
  const String original = defaultScreensText();
  CHECK(saveScreens(original));
  CHECK(screenCount == DEFAULT_SCREEN_COUNT);
  CHECK(files["/screens.txt"] == original);

  static Screen dense;
  static char denseText[1200];
  CHECK(parseScreen(DEFAULT_SCREENS[0], dense));
  for (int i = 1; i < MAX_WIDGETS; i++) dense.w[i] = dense.w[0];
  dense.n = MAX_WIDGETS;
  writeScreen(dense, denseText, sizeof(denseText));
  String full;
  for (int i = 0; i < MAX_SCREENS; i++) full += (i ? "\n" : "") + String(denseText);
  CHECK(saveScreens(full));
  CHECK(screenCount == MAX_SCREENS);
  CHECK(screensHash == fnv1a(full.c_str()));
  CHECK(files["/screens.txt"] == full);
  CHECK(screens[MAX_SCREENS - 1].n == MAX_WIDGETS);
  // A lost confirmation may cause the same complete set to be sent again.
  CHECK(saveScreens(full));
  CHECK(files["/screens.txt"] == full);

  const auto savedHash = screensHash;
  for (int failure = 0; failure < 3; failure++) {
    failOpen = failure == 0; shortWrite = failure == 1; failRename = failure == 2;
    CHECK(!saveScreens(original));
    CHECK(files["/screens.txt"] == full);
    CHECK(screensHash == savedHash && screenCount == MAX_SCREENS);
    CHECK(files.count("/screens.new") == 0);
  }
  failOpen = shortWrite = failRename = false;
  CHECK(!saveScreens("broken"));
  CHECK(!saveScreens(original + "\nbroken"));
  CHECK(!saveScreens(full + "\n" + DEFAULT_SCREENS[0]));
  CHECK(files["/screens.txt"] == full && screensHash == savedHash);
  CHECK(!loadScreensText("broken"));
  CHECK(screensHash == savedHash);

  // Reboot loads the persisted set, and resetting defaults is also durable.
  screenCount = 0; loadScreens();
  CHECK(screenCount == MAX_SCREENS && screensHash == savedHash);
  CHECK(saveScreens(""));
  CHECK(files["/screens.txt"] == original);
  CHECK(screenCount == DEFAULT_SCREEN_COUNT);
  files["/screens.txt"] = "broken"; loadScreens();
  CHECK(screenCount == DEFAULT_SCREEN_COUNT);
  files["/screens.txt"] = previousDefaultScreensText(); loadScreens();
  CHECK(files["/screens.txt"] == original);
  DONE();
}

