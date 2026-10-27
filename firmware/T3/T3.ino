// T3.ino - the Jeep's trip computer, for a LilyGo T3 V1.6.1 (ESP32) in the 2006 Liberty CRD ("Heep").
//
// What it does:
//  - reads the engine through a Vgate iCar Pro Bluetooth (BLE) OBD adapter
//  - reads the HGLRC M100 GPS (position, speed, heading, satellites) and the outdoor DS18B20 probe at the grille
//  - shows any of your own screens (built in Heep's screen editor) on the 128x64 display
//  - takes steering wheel buttons from the Arduino Nano over a one-way wire (the Nano never depends on the T3)
//  - logs everything to the microSD card, one CSV file per trip, and keeps working with no phone or Wi-Fi
//  - sends finished trips to your Jeep log sheet and GPS tracks to your track store over home Wi-Fi or the
//    iPhone hotspot; Heep can also collect trips over Bluetooth (the same trip never lands twice)
//  - talks to Heep over Bluetooth and, on Wi-Fi, through a relay (see T3.md)
//  - updates itself over Wi-Fi from GitHub when the Jeep is stopped (USB install stays as the fallback)
//
// Nothing to edit for normal use: Wi-Fi, the sheet link, screens, buttons and units are all set from Heep.
// Pins are in config.h. How the tabs fit together is in t3.h. Build: see firmware/README.md.
//
// The LoRa radio is put to sleep and never transmits, so the T3 is safe to run without its antenna.

#include "t3.h"
#include "esp_ota_ops.h"

Settings cfg;
Live car;
Gps gps;
NmeaParser nmea;
Temp otemp;
Wheel wheel;
JLinkParser jlink;
Trip trip;
Sd sd;
float totalKm = 0, totalL = 0;
int queued = 0;
volatile WifiState wifiState = W_IDLE;
String wifiName, wifiNow = "off", wifiSeen;
Txt lastUpload, updStatus, trkStatus;
volatile bool phoneOn = false, obdLinked = false, updating = false;
uint32_t bootNo = 0;
String resetWhy;
Adafruit_SSD1306 oled(SCREEN_W, SCREEN_H, &Wire, -1);
int page = 0;
Screen screens[MAX_SCREENS];
int screenCount = 0;
uint32_t screensHash = 0;
SemaphoreHandle_t fsLock, cfgLock;
char timeSrc = 0;
int64_t epochOffset = 0;   // epoch ms minus millis()

int64_t nowMs() { return timeSrc ? epochOffset + (int64_t)millis() : 0; }
// a better (or equal) clock source replaces the old one; a worse one only fills in when there's none
void setClock(int64_t epochMs, char src) {
  if (epochMs < 1600000000000LL) return;
  const char rank[] = "ang";   // phone < internet < GPS
  if (timeSrc && strchr(rank, src) < strchr(rank, timeSrc)) return;
  epochOffset = epochMs - (int64_t)millis();
  timeSrc = src;
}

const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power on";
    case ESP_RST_SW: return "restart";
    case ESP_RST_PANIC: return "crash";
    case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "low voltage";
    case ESP_RST_DEEPSLEEP: return "sleep";
    default: return "other";
  }
}

// the SX1276 straight to sleep with two register writes (no LoRa library needed, it never transmits)
void loraSleep() {
  pinMode(LORA_RST, OUTPUT); digitalWrite(LORA_RST, LOW); delay(2); digitalWrite(LORA_RST, HIGH); delay(10);
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  pinMode(LORA_CS, OUTPUT);
  auto wr = [](uint8_t reg, uint8_t v) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    digitalWrite(LORA_CS, LOW); SPI.transfer(reg | 0x80); SPI.transfer(v); digitalWrite(LORA_CS, HIGH);
    SPI.endTransaction();
  };
  wr(0x01, 0x00);   // RegOpMode: FSK sleep (the only mode where the LoRa bit can change)
  wr(0x01, 0x80);   // LoRa + sleep
}

// Safe updates: a new program fetched over Wi-Fi has to prove itself. It is only marked good after running
// 20 s; if it crashes or restarts before that, the ESP32 goes back to the previous program by itself.
extern "C" bool verifyRollbackLater() { return true; }
static void confirmUpdateStep() {
  static bool done = false;
  if (done || millis() < 20000) return;
  done = true;
  esp_ota_mark_app_valid_cancel_rollback();
  updateConfirmed();
}

void setup() {
  Serial.begin(115200);
  Serial.println("Jeep T3 " FW " starting");
  resetWhy = resetReason();
  pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW);
  loraSleep();
  // the screen first, so there's something to look at
  Wire.begin(OLED_SDA, OLED_SCL);
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  oled.clearDisplay(); oled.setTextColor(SSD1306_WHITE); oled.setCursor(0, 0); oled.print("Jeep T3 " FW "\nstarting..."); oled.display();
  // flash, settings, screens
  fsLock = xSemaphoreCreateMutex();
  cfgLock = xSemaphoreCreateMutex();
  LittleFS.begin(true);
  Preferences p; p.begin("t3", false); bootNo = p.getUInt("boot", 0) + 1; p.putUInt("boot", bootNo); p.end();
  lastUpload.set("not yet"); trkStatus.set("not set up");
  loadSettings();
  netBegin();
  loadScreens();
  displayBegin();
  // the parts
  sdBegin();
  gpsBegin();
  tempBegin();
  wheelBegin();
  tripBegin();
  phoneBegin();
  obdBegin();
  sdEvent("boot " FW " (" + resetWhy + ")");
}

void loop() {
  obdStep();
  gpsStep();
  tempStep();
  wheelStep();
  tripStep();
  phoneStep();
  wifiStep();
  sdStep();
  displayStep();
  confirmUpdateStep();
  digitalWrite(LED_PIN, obdLinked && (millis() / 500) % 2);
  delay(2);
}
