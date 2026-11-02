#pragma once
#include <memory>
#include <new>

// Screen sets are prepared on the heap: all twelve screens take over 5 KB.
// Keeping that array on the 8 KB loop stack can restart the T3 during a Wi-Fi send.
struct PreparedScreens {
  std::unique_ptr<Screen[]> items{new (std::nothrow) Screen[MAX_SCREENS]};
  int count = 0;
};

static bool prepareScreens(const String& all, PreparedScreens& out) {
  if (!out.items) return false;
  int from = 0;
  while (from <= (int)all.length()) {
    int e = all.indexOf('\n', from);
    if (e < 0) e = all.length();
    String line = all.substring(from, e);
    from = e + 1;
    line.trim();
    if (!line.length()) continue;
    if (out.count >= MAX_SCREENS || !parseScreen(line.c_str(), out.items[out.count])) return false;
    out.count++;
  }
  return out.count > 0;
}
static void useScreens(const String& all, const PreparedScreens& ready) {
  for (int i = 0; i < ready.count; i++) screens[i] = ready.items[i];
  screenCount = ready.count;
  screensHash = fnv1a(all.c_str());
}
bool loadScreensText(const String& all) {
  PreparedScreens ready;
  if (!prepareScreens(all, ready)) return false;
  useScreens(all, ready);
  return true;
}
String defaultScreensText() {
  String all;
  for (int i = 0; i < DEFAULT_SCREEN_COUNT; i++) all += (i ? "\n" : "") + String(DEFAULT_SCREENS[i]);
  return all;
}
static String previousDefaultScreensText() {
  String all;
  for (int i = 0; i < DEFAULT_SCREEN_COUNT - 1; i++) all += (i ? "\n" : "") + String(DEFAULT_SCREENS[i]);
  return all;
}
bool saveScreens(const String& all);
void loadScreens() {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/screens.txt", "r");
  String all = f ? f.readString() : "";
  if (f) f.close();
  xSemaphoreGive(fsLock);
  // Add the new status page to the untouched factory set; leave user-edited screen sets alone.
  if (all == previousDefaultScreensText()) {
    String latest = defaultScreensText();
    if (saveScreens(latest)) return;
  }
  if (!all.length() || !loadScreensText(all)) loadScreensText(defaultScreensText());
}
// "" = back to the defaults. Written to a new file first, so a power cut can't leave half a file.
bool saveScreens(const String& all) {
  String text = all.length() ? all : defaultScreensText();
  PreparedScreens ready;
  if (!prepareScreens(text, ready)) return false;
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/screens.new", "w");
  bool ok = false;
  if (f) { ok = f.print(text) == text.length(); f.close(); }
  // LittleFS replaces the old file atomically. Never remove the good copy first.
  if (ok) ok = LittleFS.rename("/screens.new", "/screens.txt");
  if (!ok) LittleFS.remove("/screens.new");
  xSemaphoreGive(fsLock);
  if (!ok) return false;
  // Only show and acknowledge a set after it is safely stored.
  useScreens(text, ready);
  if (page >= screenCount || !screens[page].on) { page = 0; pageStep(0); }
  return true;
}


