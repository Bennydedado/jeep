// gps.ino - the HGLRC M100 Mini (u-blox M10) on Serial1: position, speed, course, satellites, UTC time.
//
// The M100 sends NMEA by itself as soon as it has power; the T3 only listens (GPS TX -> GPIO 34).
// HGLRC ships it at 115200 baud; a generic M10 starts at 9600. With "GPS baud" on Auto (Heep) the T3 tries
// each speed until it reads sentences with good checksums, so either works without changing anything.
//
// GPS course is the direction of travel, not a compass: it means nothing when stopped or crawling, so it
// is only trusted above the "heading speed" setting (5 km/h by default). Below that, screens show the
// last trusted heading in brackets, or "--" (setting "Keep last heading when stopped").

#define gpsSerial Serial1   // UART1, on the pins in config.h
static const long GPS_BAUDS[] = { 115200, 9600, 38400, 57600, 230400 };
static int gpsBaudIdx = 0;
static uint32_t gpsBaudAt = 0, gpsLastByte = 0, gpsClockAt = 0;
static uint32_t gpsSentencesAtSwitch = 0;

void gpsOpen(long baud) {
  gpsSerial.end();
  gpsSerial.setRxBufferSize(2048);   // room for 0.3 s or more of NMEA even at 10 Hz, so a slow loop() pass never drops sentences
  gpsSerial.begin(baud, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  gps.baud = baud;
  gpsBaudAt = millis();
  gpsSentencesAtSwitch = nmea.sentences;
}
void gpsBegin() {
  pinMode(GPS_RX_PIN, INPUT);
  gpsBaudIdx = 0;
  gpsOpen(cfg.gpsBaud > 0 ? cfg.gpsBaud : GPS_BAUDS[0]);
}

void gpsStep() {
  uint32_t now = millis();
  int n = 0;
  while (gpsSerial.available() && n < 600) { char c = gpsSerial.read(); n++; gps.bytes++; gpsLastByte = now; nmea.feed(c, now); }
  // auto baud: bytes arriving but no good sentence for 2.5 s at this speed -> try the next one
  bool talking = gpsLastByte && now - gpsLastByte < 3000;
  bool sentences = nmea.lastSentenceAt && now - nmea.lastSentenceAt < 3000;
  if (cfg.gpsBaud <= 0 && talking && nmea.sentences == gpsSentencesAtSwitch && now - gpsBaudAt > 2500) {
    gpsBaudIdx = (gpsBaudIdx + 1) % (int)(sizeof(GPS_BAUDS) / sizeof(GPS_BAUDS[0]));
    gpsOpen(GPS_BAUDS[gpsBaudIdx]);
  }
  const NmeaFix& f = nmea.fix;
  gps.valid = f.rmcValid && f.posAt && now - f.posAt < 3000 && (f.quality > 0 || f.satsUsed < 0);
  gps.sats = f.satsUsed;
  gps.inView = nmea.satsInView(now);
  gps.hdop = f.hdop;
  gps.alt = f.alt;
  if (!talking) gps.state = G_NONE;
  else if (!sentences) gps.state = G_NOISE;
  else if (!gps.valid) gps.state = G_SEARCH;
  else gps.state = f.fixType == 2 ? G_2D : (f.fixType == 3 || f.satsUsed >= 4) ? G_3D : G_2D;
  if (gps.valid) {
    gps.lat = f.lat; gps.lon = f.lon; gps.fixAt = f.posAt;
    gps.kmh = f.kmh < 0 ? 0 : f.kmh;
    gps.course = f.course;
    if (gps.kmh >= cfg.hdgMin && f.course >= 0) { gps.heading = f.course; gps.headingAt = now; }
  } else {
    gps.kmh = -1; gps.course = -1;
  }
  // UTC from the satellites sets the clock (once a minute is plenty)
  if (f.rmcValid && f.dateOk && f.timeOk && (!gpsClockAt || now - gpsClockAt > 60000 || timeSrc != 'g')) {
    int64_t t = fixEpochMs(f);
    if (t) { setClock(t + (int64_t)(now - f.timeAt), 'g'); gpsClockAt = now; }
  }
}

// heading text for the screens: "NE" live, "(NE)" last known while stopped, "--" never had one
String headingText() {
  bool live = gps.valid && gps.headingAt && millis() - gps.headingAt < 3000;
  if (live) return cardinal(gps.heading, cfg.hdg16);
  if (cfg.hdgHold && gps.headingAt) return "(" + String(cardinal(gps.heading, cfg.hdg16)) + ")";
  return "--";
}
String courseText() {
  bool live = gps.valid && gps.headingAt && millis() - gps.headingAt < 3000;
  if (!gps.headingAt) return "--";
  char b[12]; snprintf(b, sizeof(b), live ? "%03d\xF7" : "(%03d)", (int)(gps.heading + 0.5f) % 360);
  return b;
}
const char* gpsStateText() {
  switch (gps.state) {
    case G_NONE: return "NO GPS";
    case G_NOISE: return "GPS BAUD?";
    case G_SEARCH: return "SEARCHING";
    case G_2D: return "2D FIX";
    default: return "3D FIX";
  }
}
// the speed the trip and screens use (setting "Speed source")
float speedNow() {
  bool obdOk = obdLinked && car.kmh >= 0 && millis() - car.at < 5000;
  if (cfg.spdSrc == 1) return obdOk ? car.kmh : -1;
  if (cfg.spdSrc == 2) return gps.valid ? gps.kmh : -1;
  if (obdOk) return car.kmh;
  return gps.valid ? gps.kmh : -1;
}
bool speedFromObd() { return cfg.spdSrc != 2 && obdLinked && car.kmh >= 0 && millis() - car.at < 5000; }
