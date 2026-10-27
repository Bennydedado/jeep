// config.h - every pin, address and fixed number the T3 uses, in one place.
//
// If you move a wire, change it HERE and nowhere else. Everything you can change without rebuilding
// (screens, buttons, units, Wi-Fi, logging...) is set from Heep instead and kept on the T3.
//
// Board: LilyGo T3 V1.6.1 (ESP32-PICO-D4, 4 MB flash, 128x64 SSD1306 OLED, SX1276 LoRa, microSD slot).
// Pin facts below marked [board] come from LilyGo's own pin table for the T3 V1.6.1. Pins marked
// [ours] are choices made for the Jeep wiring; see docs/HARDWARE.md before wiring anything.
#pragma once

#define FW "2.5"                 // bump this on every change: the T3 only installs a version that differs from its own
#define PROTO 2                  // the Heep <-> T3 message version (T3.md)

// ---------------------------------------------------------------- where updates and the live relay live
#define UPDATE_JSON "https://bennydedado.github.io/jeep/firmware/t3.json"
#define RELAY_HOST "broker.emqx.io"
#define RELAY_PORT 8883

// ---------------------------------------------------------------- pins built into the board  [board]
#define OLED_SDA 21
#define OLED_SCL 22
// GPIO 16 and 17 belong to the PICO-D4's own flash/PSRAM: never use them for anything.
#define LORA_SCK 5
#define LORA_MISO 19
#define LORA_MOSI 27
#define LORA_CS 18
#define LORA_RST 23
#define SD_SCK 14                // microSD slot on the back of the board
#define SD_MISO 2
#define SD_MOSI 15
#define SD_CS 13
#define LED_PIN 25

// ---------------------------------------------------------------- pins for the Jeep add-ons  [ours]
// GPS (HGLRC M100 Mini): its TX wire goes to GPIO 34 (input-only pin, the one LilyGo uses for GPS on this board).
#define GPS_RX_PIN 34
// The T3 never needs to talk back to the GPS. Leave -1 unless you wire GPS RX to a free output pin.
// (LilyGo's example uses GPIO 12, but 12 is a boot-strapping pin: see docs/HARDWARE.md before using it.)
#define GPS_TX_PIN -1
// Arduino Nano -> T3 one-way link (steering wheel buttons). Nano TX (5 V) goes through a divider to GPIO 39.
#define NANO_RX_PIN 39
// DS18B20 outdoor probe data wire (with a 4.7 kOhm pull-up to 3.3 V). GPIO 4 was the old optional push button.
#define ONEWIRE_PIN 4

// ---------------------------------------------------------------- limits
#define MAX_NETS 8               // saved Wi-Fi networks
#define MAX_SCREENS 12           // custom screens
#define MAX_WIDGETS 10           // widgets on one screen
#define SCREEN_W 128
#define SCREEN_H 64
