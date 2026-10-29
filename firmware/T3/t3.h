// t3.h - the T3's shared state: settings, what each part knows right now, and the libraries.
//
// The sketch is split into tabs by job (Arduino IDE shows each .ino as a tab; they are joined into one
// program when built, T3.ino first, then the rest in alphabetical order):
//
//   T3.ino        start-up and the main loop: the best place to start reading
//   config.h      pins, addresses, version          fields.h   the values screens can show
//   screens.h     the screen text format             nmea.h     GPS sentences      jlink.h  the Nano wire
//   settings.ino  settings kept in flash, set from Heep
//   phone.ino     Heep over Bluetooth, and every message Heep can send (also used over Wi-Fi)
//   obd.ino       the iCar (Bluetooth OBD) and the engine numbers
//   gps.ino       the M100 GPS               temp.ino     the outdoor DS18B20
//   wheel.ino     the Nano link and what each steering wheel button does
//   trip.ino      the trip: start, pause, resume, end, distance, fuel
//   display.ino   drawing the screens        sdlog.ino    the SD card log and the track files
//   net.ino       Wi-Fi, uploads, updates, the live relay
//   ota.ino       update over Bluetooth (otarx.h: the packet bookkeeping)
//
// Everything runs from loop() in small non-blocking steps, except uploads/updates, which run in their
// own task while Wi-Fi is on so the screen and buttons never freeze.
#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Update.h>
#include "esp_ota_ops.h"
#include <freertos/message_buffer.h>
#include <PubSubClient.h>
#include "mbedtls/sha256.h"
#include "mbedtls/md.h"
#include "mbedtls/gcm.h"
#include "mbedtls/base64.h"
#include <esp_random.h>
#include <sys/time.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <NimBLEDevice.h>
#include <OneWire.h>
#include <esp_system.h>
#include <time.h>
#include "config.h"
#include "fields.h"
#include "screens.h"
#include "nmea.h"
#include "jlink.h"
#include "otarx.h"
#include "obdpid.h"

// ---------------------------------------------------------------- settings (Heep sends them; kept in flash)
struct Net { String ssid, pass; };
struct Settings {
  Net nets[MAX_NETS];
  int netCount = 0;
  String sheetUrl, sheetKey, obdName, trkUrl, trkKey;
  float fuelCal = 1.0, distCal = 1.0;
  int screenSecs = 60, parkSecs = 90, bright = 2, brightNight = 0, startPage = 0;
  int nightFrom = -1, nightTo = 7;          // hours (local) for the night brightness; -1 = never
  int tzMin = -420;                         // local time offset from UTC in minutes (Fort St. John: MST all year)
  bool liveWifi = true;
  int spdSrc = 0;                           // 0 auto (iCar, else GPS) 1 iCar only 2 GPS only
  int hdgMin = 5;                           // km/h: slower than this the GPS course isn't trusted
  bool hdg16 = false, hdgHold = true;       // 16 points instead of 8; show the last heading (in brackets) when stopped
  bool tempF = false;                       // outside temperature in F
  bool engF = true;                         // coolant and intake temperatures in F
  float tempOff = 0;                        // added to the probe reading
  long gpsBaud = 0;                         // 0 = find it by itself
  int logSec = 1, logIdleSec = 10, flushSec = 5, sdMaxPct = 90;
  bool flip = false;                        // screen upside down (mounted the other way)
  int refreshMs = 250;
  String btnMap = "prev,home;mark,pause;next,end";   // button 1;2;3 as short,long
  String wheelMap = "V+,V+;AN,HU;V-,V-";               // the Nano's right buttons (nano/NanoT3Example/WheelMap.h)
  int io4 = 0;                              // GPIO 4: 0 = DS18B20 probe, 1 = old push button
  int obdProto = 0;                         // OBD protocol for the iCar: 0 auto, 1-9 the ELM327 numbers (Heep: Scan the Jeep)
};
extern Settings cfg;
extern String liveTopic, cmdTopic;   // relay channels (settings.ino)
extern String bootUpdNote;           // how an update at start-up went (update.ino)
extern String bootNote;              // how sending trips at start-up went (update.ino)

// ---------------------------------------------------------------- the clock
// Best source wins: GPS ('g') over internet time ('n') over the phone ('a'). 0 = unknown.
extern char timeSrc;
int64_t nowMs();

// ---------------------------------------------------------------- what the engine says (iCar)
struct Live {
  float kmh = -1, rpm = -1, load = -1, ect = -999, iat = -999, mapKpa = -1, baro = -1, volts = -1, lph = -1;
  float maf = -1, rail = -1;                // air flow g/s, fuel rail pressure kPa (PIDs 10, 23)
  uint32_t at = 0;
};
extern Live car;

// ---------------------------------------------------------------- GPS
enum GpsState { G_NONE, G_NOISE, G_SEARCH, G_2D, G_3D };   // no data / data but no NMEA / no fix / fixes
struct Gps {
  GpsState state = G_NONE;
  long baud = 0;
  bool valid = false;                       // a good position right now (fresh, fix, quality)
  double lat = 0, lon = 0;
  float kmh = -1, course = -1, hdop = NAN, alt = NAN;
  int sats = -1, inView = -1;
  float heading = -1;                       // last trusted course (moving fast enough)
  uint32_t headingAt = 0;
  uint32_t fixAt = 0, bytes = 0;
};
extern Gps gps;
extern NmeaParser nmea;

// ---------------------------------------------------------------- outdoor temperature
struct Temp {
  int state = 0;                            // 0 off/not found, 1 ok, 2 errors
  float c = NAN;                            // degrees C, offset applied
  uint32_t at = 0, errors = 0;
  char rom[17] = "";
};
extern Temp otemp;

// ---------------------------------------------------------------- the Nano link (steering wheel buttons)
struct Wheel {
  uint32_t heardAt = 0;                     // last good message of any kind
  long baud = 0, nanoUp = 0;
  int proto = 0;
  long cfg = -1;                            // the Nano's right-button map hash (protocol 2), -1 = never said
  uint32_t mapSent = 0, mapSentAt = 0;      // map lines sent to the Nano
  char last[8] = "-";                       // last button, e.g. "3S"
  uint32_t lastAt = 0, presses = 0;
};
extern Wheel wheel;
extern JLinkParser jlink;

// ---------------------------------------------------------------- the trip
struct Trip {
  String id;
  float km = 0, l = 0, s = 0, idle = 0, vmax = 0, boostMax = 0;
  int64_t t0 = 0, t1 = 0;
  bool paused = false;
  // GPS track summary (what the map uses)
  double lat0 = NAN, lon0 = NAN, lat1 = NAN, lon1 = NAN;
  float gpsKm = 0;
};
extern Trip trip;
extern float totalKm, totalL;
extern int queued;

// short status texts written by the upload task (core 0) and read by loop() (core 1): fixed buffers, never Strings,
// so the two can't corrupt each other's memory (at worst a text reads half-updated for a moment)
struct Txt {
  char s[112] = "";   // long enough for "couldn't reach GitHub: ... (-60 dBm, 80 KB free)"
  void set(const String& v) { strlcpy(s, v.c_str(), sizeof(s)); }
  operator String() const { return String(s); }
  bool empty() const { return !s[0]; }
};
// ---------------------------------------------------------------- SD card
struct Sd {
  bool ok = false;
  uint64_t total = 0, used = 0;
  uint32_t rows = 0, errors = 0, tracksWaiting = 0;
  String file;   // loop() only
  Txt err;
};
extern Sd sd;
// the columns of every trip file on the card (and of the tracks Heep downloads); add new ones at the END only
#define TRACK_HEADER "ms,up,tq,lat,lon,fix,sats,hdop,alt,kmh,crs,obd_kmh,rpm,boost,ect,iat,volt,load,lph,otemp,trip_km,ev"

// ---------------------------------------------------------------- connections
enum WifiState { W_IDLE, W_SCAN, W_JOIN, W_ON };
extern volatile WifiState wifiState;
extern String wifiName, wifiNow, wifiSeen;
extern Txt lastUpload, updStatus, trkStatus;
void taskEvent(const String& what);   // log an event from the upload task (passed to loop())
bool uploadBusy();
extern volatile bool phoneOn, obdLinked, updating;
extern volatile bool otaMode;          // an update over Bluetooth is coming in (ota.ino)
extern uint32_t bootNo;
extern String resetWhy;

// ---------------------------------------------------------------- the screen
extern Adafruit_SSD1306 oled;
extern int page;
extern Screen screens[MAX_SCREENS];
extern int screenCount;
extern uint32_t screensHash;
extern SemaphoreHandle_t fsLock;
extern SemaphoreHandle_t cfgLock;   // held while settings are (re)loaded, and while the upload task copies them
