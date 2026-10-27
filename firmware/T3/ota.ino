// ota.ino - "Update over Bluetooth": Heep downloads the new T3 program from GitHub on the phone and sends it to
// the T3 over the Bluetooth link, for when Wi-Fi isn't working. Protocol in otarx.h and T3.md.
//
//   Heep  {"c":"ota","do":"begin","size":1535424,"sha":"<SHA-256 hex>","v":"2.1"}
//   T3    {"t":"ota","ok":true,"ready":true,"chunk":182,"ack":4096}      (or "ok":false with "why")
//   Heep  binary packets [offset][bytes]... (the T3 treats every write as a packet until the update ends)
//   T3    {"t":"ota","got":<bytes>} every 4 KB, {"t":"ota","need":<offset>} if one went missing
//   T3    {"t":"ota","done":true,"v":"2.1"} -> restarts into it 1.5 s later
//
// The program is checked twice before it's used: its SHA-256 against what Heep computed, then the ESP32's own
// image check. After the restart it gets the same 20 s to prove itself as a Wi-Fi update (T3.ino), or the ESP32
// goes back to the program that's running now. A packet of four 0xFF bytes from Heep cancels.

volatile bool otaMode = false;
static MessageBufferHandle_t otaBuf = nullptr;   // packets from the Bluetooth task, drained by loop()
static size_t otaBufSize = 0;
static OtaRx otaRx;
static mbedtls_sha256_context otaSha;
static bool otaShaOn = false;
static String otaWant, otaVer;
static uint32_t otaLastPkt = 0, otaLastNeed = 0, otaRestartAt = 0;
static volatile uint32_t otaDropped = 0;

int otaPercent() { return otaRx.percent(); }

// from the Bluetooth task, for every write while an update is on: straight into the buffer, never waits
void otaPacket(const uint8_t* p, size_t n) {
  if (!otaBuf || n > 260 || xMessageBufferSend(otaBuf, p, n, 0) != n) otaDropped++;
}

static void otaFail(const String& why) {
  if (otaMode || otaRx.active) Update.abort();
  if (otaShaOn) { mbedtls_sha256_free(&otaSha); otaShaOn = false; }
  otaMode = false; updating = false; otaRx.active = false;
  if (otaBuf) xMessageBufferReset(otaBuf);
  phoneSend("{\"t\":\"ota\",\"ok\":false,\"why\":\"" + jsonEsc(why) + "\"}");
  sdEvent("bluetooth update stopped: " + why);
  flash("Update stopped");
}

void otaBegin(const String& j) {
  uint32_t size = (uint32_t)llField(j, "size");
  String sha = jStr(j, "sha"), v = jStr(j, "v");
  sha.toLowerCase();
  const esp_partition_t* next = esp_ota_get_next_update_partition(nullptr);
  String why;
  if (otaMode) why = "already updating";
  else if (updating || uploadBusy()) why = "busy with a Wi-Fi update or upload: try again in a minute";
  else if (!next || size < 4096 || size > next->size) why = "the program is the wrong size";
  else if (sha.length() != 64) why = "no checksum";
  if (!why.length()) {
    // Wi-Fi and the relay's secure connection use a lot of memory: switch them off first. Then the receive buffer:
    // made once and kept; as big as memory allows (Heep keeps less than its size in flight, "win" below).
    wifiOff(180000);
    static const size_t sizes[] = { 24576, 16384, 12288 };
    for (size_t k = 0; k < 3 && !otaBuf; k++) if ((otaBuf = xMessageBufferCreate(sizes[k]))) otaBufSize = sizes[k];
    if (!otaBuf) why = relayUp() || WiFi.getMode() != WIFI_OFF ? "not enough memory yet (Wi-Fi still closing): try again in a few seconds" : "not enough memory";
    else if (!Update.begin(size, U_FLASH)) why = String("can't start: ") + Update.errorString();
  }
  if (why.length()) { phoneSend("{\"t\":\"ota\",\"ok\":false,\"why\":\"" + jsonEsc(why) + "\"}"); return; }
  xMessageBufferReset(otaBuf);
  mbedtls_sha256_init(&otaSha); mbedtls_sha256_starts(&otaSha, 0); otaShaOn = true;
  otaRx.start(size);
  otaWant = sha; otaVer = v.substring(0, 12);
  otaDropped = 0; otaLastPkt = millis(); otaLastNeed = 0;
  updating = true;
  sdEvent("bluetooth update to " + otaVer + " (" + String(size) + " bytes, buffer " + String(otaBufSize) + ")");
  otaMode = true;    // from here every write from Heep is a packet
  // win: how far ahead of the last "got" Heep may run, leaving room for the 4-byte length of each buffered packet
  phoneSend("{\"t\":\"ota\",\"ok\":true,\"ready\":true,\"chunk\":" + String(phoneChunk()) + ",\"ack\":" + String(OtaRx::ACK_EVERY) +
            ",\"win\":" + String(otaBufSize - 4096) + "}");
}

static void otaFinish() {
  unsigned char h[32];
  mbedtls_sha256_finish(&otaSha, h); mbedtls_sha256_free(&otaSha); otaShaOn = false;
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", h[i]);
  if (otaWant != hex) { otaFail("the checksum didn't match: nothing changed"); return; }
  if (!Update.end(true)) { otaFail(String("not a good program: ") + Update.errorString()); return; }
  otaMode = false; otaRx.active = false;
  markUpdateTry(otaVer);   // net.ino: counts as a failed try if it doesn't last its first 20 s
  phoneSend("{\"t\":\"ota\",\"done\":true,\"v\":\"" + jsonEsc(otaVer) + "\"}");
  sdEvent("bluetooth update done (" + String(otaRx.gaps) + " resends), restarting");
  snapshot(); sdFlush();
  flash("Restarting...");
  otaRestartAt = millis() + 1500;
}

void otaStep() {
  if (otaRestartAt && millis() > otaRestartAt) ESP.restart();
  if (!otaMode) return;
  if (!phoneOn) { otaFail("Bluetooth dropped"); return; }
  static uint8_t pkt[264];
  uint32_t t0 = millis();
  while (otaMode && millis() - t0 < 40) {   // a few ms of flash writing per pass, so the screen keeps updating
    size_t n = xMessageBufferReceive(otaBuf, pkt, sizeof(pkt), 0);
    if (!n) break;
    otaLastPkt = millis();
    if (n == 4 && pkt[0] == 0xFF && pkt[1] == 0xFF && pkt[2] == 0xFF && pkt[3] == 0xFF) { otaFail("cancelled in Heep"); return; }
    const uint8_t* d; size_t len;
    int r = otaRx.feed(pkt, n, &d, &len);
    if (r == 1) {
      if (Update.write((uint8_t*)d, len) != len) { otaFail(String("flash write failed: ") + Update.errorString()); return; }
      mbedtls_sha256_update(&otaSha, d, len);
      otaRx.wrote(len);
    } else if (r == -1 && millis() - otaLastNeed > 300) {
      otaLastNeed = millis();
      phoneSend("{\"t\":\"ota\",\"need\":" + String(otaRx.got) + "}");
    }
    if (otaRx.ackDue()) { otaRx.acked(); phoneSend("{\"t\":\"ota\",\"got\":" + String(otaRx.got) + "}"); }
    if (otaRx.done()) { otaFinish(); return; }
  }
  if (millis() - otaLastPkt > 15000) otaFail("nothing arrived for 15 s");
}
