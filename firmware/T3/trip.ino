// trip.ino - one trip state machine for everything: the wheel buttons, Heep (Bluetooth or relay) and the
// automatic rules all call tripCommand(), so they can never disagree about whether a trip is running.
//
//   key on .................. a new trip starts (running)
//   pause / resume .......... nothing is added while paused; parking doesn't end a paused trip
//   end ..................... the trip is finished (queued for the sheet, its track file closed) and a new one starts
//   parked for "parkSecs" ... (engine off and not moving, key still on) ends the trip by itself
//   key off ................. power is simply cut: the trip so far is saved every 30 s and finished at the next key-on
//
// Distance comes from the speed source (iCar speed x distance correction, or GPS speed); the GPS track's own
// length is kept separately (gpsKm) so the two can be compared. Fuel only comes from the iCar.

int tripNo = 0;
static uint32_t lastIntegrate = 0, lastSnapshot = 0, quietSince = 0;
static double lastLat = NAN, lastLon = NAN;
static uint32_t lastFixSeen = 0;

String tripJson(const Trip& t) {
  String j = "{\"t\":\"trip\",\"id\":\"" + t.id + "\",\"km\":" + String(t.km, 2) + ",\"l\":" + String(t.l, 2) +
             ",\"s\":" + String((long)t.s) + ",\"idle\":" + String((long)t.idle) + ",\"vmax\":" + String((long)t.vmax) +
             ",\"gkm\":" + String(t.gpsKm, 2);
  if (t.t0) j += ",\"t0\":" + ll(t.t0);
  if (t.t1) j += ",\"t1\":" + ll(t.t1);
  if (!isnan(t.lat0)) j += ",\"a0\":[" + String(t.lat0, 5) + "," + String(t.lon0, 5) + "]";
  if (!isnan(t.lat1)) j += ",\"a1\":[" + String(t.lat1, 5) + "," + String(t.lon1, 5) + "]";
  return j + "}";
}

bool engineOn() { return obdLinked && car.rpm > 300 && millis() - car.at < 5000; }
bool gpsMoving() { return gps.valid && gps.kmh > 3; }
bool tripActive() { return engineOn() || gpsMoving(); }

void newTrip() {
  trip = Trip();
  tripNo++;
  trip.id = "t" + String(bootNo) + "-" + String(tripNo);
  trip.t0 = nowMs();
  lastLat = lastLon = NAN;
  sdTripStart(trip.id);
}

// trips waiting to reach the sheet live in /trips.txt (internal flash), one per line; the trip in progress in /cur.txt
int queuedCount() {
  int n = 0;
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/trips.txt", "r");
  if (f) { while (f.available()) { String l = f.readStringUntil('\n'); if (l.length() > 5) n++; } f.close(); }
  xSemaphoreGive(fsLock);
  return n;
}
void finishTrip(Trip& t) {
  bool real = t.km >= 0.2 || t.gpsKm >= 0.2;   // a key-on in the yard isn't a trip
  xSemaphoreTake(fsLock, portMAX_DELAY);
  if (real) { File f = LittleFS.open("/trips.txt", "a"); if (f) { f.println(tripJson(t)); f.close(); } }
  LittleFS.remove("/cur.txt");
  xSemaphoreGive(fsLock);
  sdTripEnd(t, real);
  if (!real) return;
  totalKm += t.km; totalL += t.l;
  Preferences p; p.begin("t3", false); p.putFloat("tk", totalKm); p.putFloat("tl", totalL); p.end();
  queued = queuedCount();
}
// forget the trips the sheet now has ("|id|id|")
void dropTrips(const String& ids) {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/trips.txt", "r");
  String keep;
  if (f) {
    while (f.available()) {
      String l = f.readStringUntil('\n');
      l.trim();
      if (l.length() < 5) continue;
      int a = l.indexOf("\"id\":\"") + 6, b = l.indexOf('"', a);
      if (ids.indexOf("|" + l.substring(a, b) + "|") < 0) keep += l + "\n";
    }
    f.close();
  }
  f = LittleFS.open("/trips.txt", "w");
  if (f) { f.print(keep); f.close(); }
  xSemaphoreGive(fsLock);
  queued = queuedCount();
}
void snapshot() {
  if (trip.km < 0.05 && trip.gpsKm < 0.05) return;
  trip.t1 = nowMs();
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/cur.txt", "w");
  if (f) { f.print(tripJson(trip)); f.close(); }
  xSemaphoreGive(fsLock);
}
// last time's trip, cut short by the key: finish it now
void recoverTrip() {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File f = LittleFS.open("/cur.txt", "r");
  String j = f ? f.readString() : "";
  if (f) f.close();
  xSemaphoreGive(fsLock);
  if (j.length() < 10) return;
  Trip t;
  int a = j.indexOf("\"id\":\"") + 6, b = j.indexOf('"', a);
  t.id = j.substring(a, b);
  t.km = numField(j, "km"); t.l = numField(j, "l"); t.s = numField(j, "s"); t.idle = numField(j, "idle"); t.vmax = numField(j, "vmax");
  t.gpsKm = numField(j, "gkm");
  t.t0 = llField(j, "t0"); t.t1 = llField(j, "t1");
  int p0 = j.indexOf("\"a0\":["), p1 = j.indexOf("\"a1\":[");
  if (p0 >= 0) { t.lat0 = j.substring(p0 + 6).toFloat(); t.lon0 = j.substring(j.indexOf(',', p0 + 6) + 1).toFloat(); }
  if (p1 >= 0) { t.lat1 = j.substring(p1 + 6).toFloat(); t.lon1 = j.substring(j.indexOf(',', p1 + 6) + 1).toFloat(); }
  finishTrip(t);
}

void tripBegin() {
  recoverTrip();
  queued = queuedCount();
  newTrip();
  lastIntegrate = millis();
}

// every change of trip state, from anywhere
void tripCommand(const String& c, const char* from) {
  if (c == "pause" && !trip.paused) { trip.paused = true; flash("Trip paused"); }
  else if (c == "resume" && trip.paused) { trip.paused = false; flash("Trip resumed"); }
  else if (c == "end" || c == "reset" || (c == "start" && !trip.paused)) {
    trip.t1 = nowMs();
    finishTrip(trip);
    newTrip();
    flash(c == "start" ? "New trip" : "Trip ended");
  } else if (c == "start" && trip.paused) { trip.paused = false; flash("Trip resumed"); }
  else return;
  sdEvent("trip " + c + " (" + String(from) + ")");
}
void tripMark(const char* from) { sdMarker(String("mark ") + from); }

void tripStep() {
  uint32_t now = millis();
  float dt = (now - lastIntegrate) / 1000.0;
  if (dt < 0.2) return;
  lastIntegrate = now;
  if (dt > 5) return;   // a long stall: skip rather than guess
  // the GPS track: start/end points and its own length
  if (gps.valid && gps.fixAt != lastFixSeen) {
    lastFixSeen = gps.fixAt;
    if (isnan(trip.lat0)) { trip.lat0 = gps.lat; trip.lon0 = gps.lon; }
    trip.lat1 = gps.lat; trip.lon1 = gps.lon;
    bool goodGeom = isnan(gps.hdop) || gps.hdop < 5;
    if (!trip.paused && goodGeom && gps.kmh > 2) {
      if (!isnan(lastLat)) {
        double d = distM(lastLat, lastLon, gps.lat, gps.lon);
        if (d < 120) trip.gpsKm += d / 1000.0;   // > 120 m between 1 s fixes = a jump, not driving
      }
      lastLat = gps.lat; lastLon = gps.lon;
    } else if (gps.kmh <= 2) { lastLat = gps.lat; lastLon = gps.lon; }
  }
  if (!tripActive()) {
    if (!quietSince) quietSince = now;
    if (!trip.paused && (trip.km >= 0.2 || trip.gpsKm >= 0.2) && now - quietSince > (uint32_t)cfg.parkSecs * 1000) tripCommand("end", "parked");
  } else quietSince = 0;
  if (!trip.paused && tripActive()) {
    if (!trip.t0) trip.t0 = nowMs() ? nowMs() - (int64_t)(trip.s * 1000) : 0;
    float v = speedNow();
    if (v < 0) v = 0;
    trip.km += v * dt / 3600.0 * (speedFromObd() ? cfg.distCal : 1.0);
    if (engineOn()) trip.l += fuelNow() * dt / 3600.0;
    trip.s += dt;
    if (engineOn() && v < 2) trip.idle += dt;
    if (v > trip.vmax) trip.vmax = v;
    float b = boostPsi();
    if (b > trip.boostMax) trip.boostMax = b;
  }
  if (now - lastSnapshot > 30000) { lastSnapshot = now; snapshot(); }
}
