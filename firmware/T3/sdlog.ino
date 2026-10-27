// sdlog.ino - the microSD card: one CSV file per trip with everything the T3 knows, an index of finished
// trips, an event log, and the bookkeeping for uploading tracks. The card is the original record: uploads
// copy from it, and nothing is deleted until it has been uploaded (unless the card is nearly full).
//
// On the card (FAT32, any size; format it on a PC if the T3 says "no card"):
//   /jeep/trips/<trip id>.csv   one row every second while driving (every 10 s parked), plus event rows
//   /jeep/index.csv             one line per finished trip: totals, start and end points
//   /jeep/uploaded.txt          trip ids whose track has reached your track store
//   /jeep/events.log            boots, errors, trip commands (rolls over at 512 KB)
//
// The T3 has no battery: the key going off cuts power at any moment. So rows are collected in memory and
// written every few seconds (Heep: "Write to card every"), with the file closed after each write, so a
// power cut loses at most those few seconds and never the file.

SPIClass sdSPI(HSPI);
static SemaphoreHandle_t sdLock;
static String sdBuf, curTrack;
static uint32_t lastRow = 0, lastFlush = 0, lastMount = 0;

void sdBegin() {
  sdLock = xSemaphoreCreateMutex();
  sdMount();
}
bool sdMount() {
  lastMount = millis();
  SD.end();
  sdSPI.end();
  sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS, sdSPI, 20000000) || SD.cardType() == CARD_NONE) { sd.ok = false; sd.err = "no card"; return false; }
  SD.mkdir("/jeep"); SD.mkdir("/jeep/trips");
  sd.ok = true; sd.err = "";
  sdSpace();
  sdHousekeep();
  sdCountWaiting();
  return true;
}
void sdSpace() { if (sd.ok) { sd.total = SD.totalBytes(); sd.used = SD.usedBytes(); } }
void sdFail(const String& why) { sd.ok = false; sd.err = why; sd.errors++; }

// append text to a file; false (and the card marked failed) if it didn't go
bool sdAppend(const String& path, const String& text) {
  if (!sd.ok) return false;
  xSemaphoreTake(sdLock, portMAX_DELAY);
  File f = SD.open(path, FILE_APPEND);
  bool ok = f && f.print(text) == text.length();
  if (f) f.close();
  xSemaphoreGive(sdLock);
  if (!ok) sdFail("write failed");
  return ok;
}

void sdEvent(const String& what) {
  String ts = nowMs() ? ll(nowMs()) : String("");
  Serial.println(what);
  if (!sd.ok) return;
  sdAppend("/jeep/events.log", ts + "," + String(millis()) + "," + what + "\n");
  if (curTrack.length()) sdBuf += rowText(what);   // also into the trip, so the map can show it
}
void sdMarker(const String& what) { if (curTrack.length()) { sdBuf += rowText(what); lastFlush = 0; } }

void sdTripStart(const String& id) {
  curTrack = "/jeep/trips/" + id + ".csv";
  sd.file = id + ".csv";
  sdBuf = "";
  if (sd.ok && !SD.exists(curTrack)) sdAppend(curTrack, String(TRACK_HEADER) + "\n");
}
void sdTripEnd(const Trip& t, bool real) {
  sdFlush();
  String path = "/jeep/trips/" + t.id + ".csv";
  if (sd.ok) {
    if (!real) { xSemaphoreTake(sdLock, portMAX_DELAY); SD.remove(path); xSemaphoreGive(sdLock); }
    else {
      String a = "\"" + t.id + "\"," + (t.t0 ? ll(t.t0) : String("")) + "," + (t.t1 ? ll(t.t1) : String("")) + "," + String(t.km, 2) + "," + String(t.gpsKm, 2) + "," +
                 String(t.l, 2) + "," + String((long)t.s) + "," + String((long)t.vmax) + "," + num(t.lat0, 5) + "," + num(t.lon0, 5) + "," + num(t.lat1, 5) + "," + num(t.lon1, 5) + "\n";
      if (!SD.exists("/jeep/index.csv")) sdAppend("/jeep/index.csv", "id,t0,t1,km,gps_km,litres,seconds,vmax,lat0,lon0,lat1,lon1\n");
      sdAppend("/jeep/index.csv", a);
    }
    sdSpace();
    sdHousekeep();
    sdCountWaiting();
  }
  curTrack = "";
}

String rowText(const String& ev) {
  bool obdOk = obdLinked && millis() - car.at < 5000;
  int64_t t = nowMs();
  String r;
  r.reserve(140);
  r += t ? ll(t) : String(""); r += ","; r += String(millis()); r += ","; r += timeSrc ? String(timeSrc) : String("-"); r += ",";
  if (gps.valid) { r += String(gps.lat, 6); r += ","; r += String(gps.lon, 6); } else r += ",";
  r += ","; r += String((int)gps.state); r += ",";
  r += gps.sats >= 0 ? String(gps.sats) : String(""); r += ",";
  r += isnan(gps.hdop) ? String("") : String(gps.hdop, 1); r += ",";
  r += gps.valid && !isnan(gps.alt) ? String(gps.alt, 0) : String(""); r += ",";
  r += gps.valid ? String(gps.kmh, 1) : String(""); r += ",";
  r += gps.valid && gps.course >= 0 ? String(gps.course, 0) : String(""); r += ",";
  r += obdOk && car.kmh >= 0 ? String(car.kmh, 0) : String(""); r += ",";
  r += obdOk && car.rpm >= 0 ? String(car.rpm, 0) : String(""); r += ",";
  r += boostPsi() >= 0 ? String(boostPsi(), 1) : String(""); r += ",";
  r += obdOk && car.ect > -100 ? String(car.ect, 0) : String(""); r += ",";
  r += obdOk && car.iat > -100 ? String(car.iat, 0) : String(""); r += ",";
  r += obdOk && car.volts > 0 ? String(car.volts, 1) : String(""); r += ",";
  r += obdOk && car.load >= 0 ? String(car.load, 0) : String(""); r += ",";
  r += engineOn() ? String(fuelNow(), 2) : String(""); r += ",";
  r += tempFresh() ? String(otemp.c, 1) : String(""); r += ",";
  r += String(trip.km, 3); r += ",";
  String e = ev; e.replace(",", ";"); e.replace("\n", " ");
  r += e; r += "\n";
  return r;
}

void sdFlush() {
  if (!sdBuf.length() || !curTrack.length()) { sdBuf = ""; return; }
  if (sdAppend(curTrack, sdBuf)) { int n = 0; for (size_t i = 0; i < sdBuf.length(); i++) if (sdBuf[i] == '\n') n++; sd.rows += n; }
  sdBuf = "";
}

void sdStep() {
  uint32_t now = millis();
  if (!sd.ok) { if (now - lastMount > 30000) { if (sdMount() && trip.id.length()) sdTripStart(trip.id); } return; }
  uint32_t every = (tripActive() && !trip.paused ? cfg.logSec : cfg.logIdleSec) * 1000UL;
  if (curTrack.length() && now - lastRow >= every) { lastRow = now; sdBuf += rowText(""); }
  if (sdBuf.length() > 4000 || (sdBuf.length() && now - lastFlush >= (uint32_t)cfg.flushSec * 1000UL)) { lastFlush = now; sdFlush(); }
  static uint32_t lastSpace = 0;
  if (now - lastSpace > 300000) { lastSpace = now; sdSpace(); }
}

// ---------------------------------------------------------------- uploads: which tracks still need to go
bool sdUploaded(const String& id) {
  xSemaphoreTake(sdLock, portMAX_DELAY);
  File f = SD.open("/jeep/uploaded.txt", FILE_READ);
  bool found = false;
  if (f) { while (f.available() && !found) { String l = f.readStringUntil('\n'); l.trim(); if (l == id) found = true; } f.close(); }
  xSemaphoreGive(sdLock);
  return found;
}
void sdMarkUploaded(const String& id) { sdAppend("/jeep/uploaded.txt", id + "\n"); sdCountWaiting(); }

// the finished trips (oldest first) whose track hasn't been uploaded: up to `max` ids
int sdWaitingIds(String* out, int max) {
  if (!sd.ok) return 0;
  String done;
  xSemaphoreTake(sdLock, portMAX_DELAY);
  File u = SD.open("/jeep/uploaded.txt", FILE_READ);
  if (u) { done = "|"; while (u.available()) { String l = u.readStringUntil('\n'); l.trim(); if (l.length()) done += l + "|"; } u.close(); }
  int n = 0;
  File f = SD.open("/jeep/index.csv", FILE_READ);
  if (f) {
    f.readStringUntil('\n');
    while (f.available() && n < max) {
      String l = f.readStringUntil('\n');
      if (l.length() < 4 || l[0] != '"') continue;
      String id = l.substring(1, l.indexOf('"', 1));
      if (done.indexOf("|" + id + "|") < 0 && SD.exists("/jeep/trips/" + id + ".csv")) out[n++] = id;
    }
    f.close();
  }
  xSemaphoreGive(sdLock);
  return n;
}
void sdCountWaiting() { String ids[50]; sd.tracksWaiting = sdWaitingIds(ids, 50); }
// the index line for a trip (what the track store lists)
String sdIndexLine(const String& id) {
  String out;
  xSemaphoreTake(sdLock, portMAX_DELAY);
  File f = SD.open("/jeep/index.csv", FILE_READ);
  if (f) { while (f.available()) { String l = f.readStringUntil('\n'); if (l.startsWith("\"" + id + "\"")) { out = l; out.trim(); } } f.close(); }
  xSemaphoreGive(sdLock);
  return out;
}
// rows [from, from+count) of a track (not counting the header); `more` says if there are rows after them
String sdTrackRows(const String& id, int from, int count, int* got, bool* more) {
  String out;
  *got = 0; *more = false;
  xSemaphoreTake(sdLock, portMAX_DELAY);
  File f = SD.open("/jeep/trips/" + id + ".csv", FILE_READ);
  if (f) {
    f.readStringUntil('\n');
    int i = 0;
    while (f.available()) {
      String l = f.readStringUntil('\n');
      if (!l.length()) continue;
      if (i >= from + count) { *more = true; break; }
      if (i >= from) { out += l; out += "\n"; (*got)++; }
      i++;
    }
    f.close();
  }
  xSemaphoreGive(sdLock);
  return out;
}

// ---------------------------------------------------------------- keeping the card from filling up
void sdHousekeep() {
  if (!sd.ok || !sd.total) return;
  // the event log rolls over
  xSemaphoreTake(sdLock, portMAX_DELAY);
  File e = SD.open("/jeep/events.log", FILE_READ);
  size_t es = e ? e.size() : 0;
  if (e) e.close();
  if (es > 512 * 1024) { SD.remove("/jeep/events.old"); SD.rename("/jeep/events.log", "/jeep/events.old"); }
  xSemaphoreGive(sdLock);
  // over the limit: delete the oldest uploaded tracks first; only when nearly full, the oldest of any
  for (int round = 0; round < 40 && sd.used * 100 / sd.total >= (uint64_t)cfg.sdMaxPct; round++) {
    bool desperate = sd.used * 100 / sd.total >= 98;
    String victim; long best = LONG_MAX; int bestN = INT_MAX;
    xSemaphoreTake(sdLock, portMAX_DELAY);
    File dir = SD.open("/jeep/trips");
    if (dir) {
      for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
        String nm = String(f.name());
        f.close();
        int slash = nm.lastIndexOf('/'); if (slash >= 0) nm = nm.substring(slash + 1);
        if (!nm.startsWith("t") || !nm.endsWith(".csv")) continue;
        String id = nm.substring(0, nm.length() - 4);
        if ("/jeep/trips/" + nm == curTrack) continue;
        long boot = id.substring(1, id.indexOf('-')).toInt(); int n = id.substring(id.indexOf('-') + 1).toInt();
        if (boot < best || (boot == best && n < bestN)) {
          xSemaphoreGive(sdLock); bool up = sdUploaded(id); xSemaphoreTake(sdLock, portMAX_DELAY);
          if (up || desperate) { best = boot; bestN = n; victim = id; }
        }
      }
      dir.close();
    }
    if (victim.length()) SD.remove("/jeep/trips/" + victim + ".csv");
    xSemaphoreGive(sdLock);
    if (!victim.length()) break;
    sdEvent(String(desperate ? "card full: deleted " : "deleted uploaded ") + victim);
    sdSpace();
  }
}
