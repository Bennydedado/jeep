# T3 firmware

The Jeep's trip computer for a LilyGo T3 V1.6.1. Start reading at `T3/T3.ino`; `T3/t3.h` lists every tab and its job;
pins are in `T3/config.h`. Wiring and setup: `../docs/HARDWARE.md`. Messages: `../T3.md`.

## Normal use: nothing to build

Push a change to `firmware/T3/` on GitHub and **Build the T3** (`.github/workflows/t3.yml`) runs the PC tests, compiles,
and publishes `T3.bin`, `t3.json` and the USB install files here. T3s in the field fetch it over Wi-Fi (newer versions
only, only when stopped). **Bump `FW` in `config.h` every time**, or the T3s won't take it.
`build.log` shows the last result; if it says the build failed, nothing was published and the T3s keep what they have.

## Building yourself

Arduino IDE 2:
1. Boards Manager: add `https://espressif.github.io/arduino-esp32/package_esp32_index.json`, install **esp32 by Espressif 3.3.12**.
2. Library Manager: **NimBLE-Arduino 2.5.2**, **Adafruit SSD1306 2.5.17**, **Adafruit GFX Library 1.13.0**, **Adafruit BusIO**,
   **PubSubClient 2.8**, **OneWire 2.3.8**. (Versions as in the workflow. NimBLE 3.x changes its API: stay on 2.x.)
3. Board **ESP32 Dev Module**, Partition Scheme **Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)**. Don't change the
   partition scheme: OTA and the settings/trip storage depend on it.
4. Open `firmware/T3/T3.ino` (the other tabs open with it). Upload with the T3 unplugged from the Jeep.

arduino-cli (what CI does):
```
arduino-cli compile --fqbn "esp32:esp32:esp32:PartitionScheme=min_spiffs" --export-binaries --output-dir out firmware/T3
```

Size on 27 Oct 2026: 1,534,984 bytes of 1,966,080 (78%). Version 1.5 was at 98% with the stock BLE library; 2.0 uses
NimBLE, which is how there was room for the GPS, SD card and screens.

## Tests without hardware

`bash tests/run.sh` from the repo root (g++ and node; Playwright optional). The GPS reader (`nmea.h`), the Nano wire
(`jlink.h`) and the screen format (`screens.h`, `fields.h`) are plain C++ on purpose so they can be tested on a PC.

## OTA and getting back

- The T3 marks a new program good only after 20 s of running (`confirmUpdateStep()` in T3.ino). Crash or restart before
  that and the bootloader goes back to the previous program; that version number is then skipped (`badVersion`, net.ino).
- USB install page: https://bennydedado.github.io/jeep/firmware/ (Chrome/Edge). Always works; hold BOOT if needed.
- Version 1.5 = git commit `792a80f` (its `T3.bin` and the install files are in that commit).

## Nano

`../nano/NanoT3Example` (T3Link.h + WheelButtons.h to copy into your own sketch) and `../nano/WheelCalibrate`.
Board: Arduino Nano (ATmega328P). The example compiles to 4.4 KB / 310 bytes RAM.
