// fields.h - every value a T3 screen widget can show.
//
// To add one: add a line here (keep the id short, a-z and digits), then give it a value in fieldValue()
// in display.ino, and add the same id to FIELDS in the app's t3screens.js so the editor offers it.
// Never reuse or rename an id that screens may already use; add a new one instead.
#pragma once
#include <string.h>

struct FieldDef {
  const char* id;     // what screens store
  const char* label;  // shown on the T3 (8 characters fit nicely)
  const char* unit;   // shown after the value when the widget's "u" flag is on
  int dp;             // decimals for numbers; -1 = the value is text
};

static const FieldDef FIELDS[] = {
  // driving
  { "kmh", "Speed", "km/h", 0 },        // OBD speed, or GPS speed when the iCar isn't reading (see Speed source)
  { "kmhg", "GPS spd", "km/h", 0 },
  { "kmho", "OBD spd", "km/h", 0 },
  { "hdg", "Heading", "", -1 },         // N, NE... from GPS course while moving; (NE) in brackets = last known, stopped
  { "hdgd", "Course", "deg", -1 },
  { "otemp", "Outside", "C", 1 },       // the grille DS18B20 (unit follows the C/F setting)
  { "clock", "Time", "", -1 },
  { "date", "Date", "", -1 },
  // engine (iCar)
  { "rpm", "RPM", "", 0 },
  { "boost", "Boost", "psi", 1 },
  { "bmax", "Peak boost", "psi", 1 },     // highest boost this trip
  { "ect", "Coolant", "C", 0 },          // unit follows the engine-temperature C/F setting
  { "iat", "Intake", "C", 0 },
  { "volt", "Battery", "V", 1 },
  { "load", "Load", "%", 0 },
  { "lph", "Fuel", "L/h", 1 },
  { "econ", "Now", "L/100", 1 },
  { "maf", "Air flow", "g/s", 1 },      // mass air flow (PID 10)
  { "rail", "Rail", "bar", 0 },         // diesel fuel rail pressure (PID 23)
  // trip
  { "tstate", "Trip", "", -1 },         // RUNNING / PAUSED
  { "tkm", "Trip", "km", 1 },
  { "ttime", "Time", "", -1 },
  { "tl", "Diesel", "L", 2 },
  { "tavg", "Trip avg", "L/100", 1 },
  { "tavgs", "Avg spd", "km/h", 0 },
  { "tvmax", "Top spd", "km/h", 0 },
  { "tidle", "Idle", "", -1 },
  { "totkm", "All km", "km", 0 },
  { "totl", "All L", "L", 0 },
  { "totavg", "All avg", "L/100", 1 },
  // GPS
  { "gfix", "GPS", "", -1 },            // NO GPS / SEARCHING / 2D / 3D
  { "sats", "Sats", "", -1 },           // used/in view
  { "hdop", "HDOP", "", 1 },
  { "alt", "Altitude", "m", 0 },
  { "lat", "Lat", "", 5 },
  { "lon", "Lon", "", 5 },
  // status
  { "obd", "iCar", "", -1 },
  { "ble", "Phone", "", -1 },
  { "wifi", "Wi-Fi", "", -1 },
  { "nano", "Wheel", "", -1 },
  { "sd", "SD", "", -1 },
  { "sdfree", "SD free", "MB", 0 },
  { "logn", "Logged", "", 0 },
  { "queue", "Waiting", "", 0 },
  { "fw", "T3", "", -1 },
  { "up", "Up", "", -1 },
  { "heap", "Memory", "KB", 0 },
  { "btn", "Button", "", -1 },
};
static const int FIELD_COUNT = sizeof(FIELDS) / sizeof(FIELDS[0]);

inline int fieldIndex(const char* id) {
  for (int i = 0; i < FIELD_COUNT; i++) if (!strcmp(FIELDS[i].id, id)) return i;
  return -1;
}
