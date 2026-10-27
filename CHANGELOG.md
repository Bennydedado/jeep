# Changes

## 27 Oct 2026 — T3 2.1, Heep 1.1.1: Wi-Fi page and update over Bluetooth

- **Heep: Live > Wi-Fi & update.** What the T3 is connected to (signal, channel, address, how long), your saved networks
  in the order it tries them (in range or not, signal, how the last try went), every 2.4 GHz network it can see (tap one to add
  it with the exact name), and tips for what's wrong: wrong password, iPhone hotspot hidden or on 5 GHz/WPA3 (Maximize
  Compatibility), a saved name that's nearly but not exactly the real one, weak signal. Scan now. Works with older T3s too (less detail).
- **Update over Bluetooth** (T3 2.1+): Heep downloads the newest program from GitHub and sends it over the Bluetooth link in
  numbered packets; lost ones are sent again, the T3 checks the SHA-256 and the ESP32's own image check before switching, and the
  20 s rollback still applies. About 2-4 minutes. For when the T3 can't get onto Wi-Fi.
- **T3 Wi-Fi:** remembers why a join failed (ESP-IDF reason), keeps the full scan, scans on request without dropping a connection,
  asks for your networks by name when none show up in a scan (hidden iPhone hotspots), and pauses the iCar Bluetooth search while
  Wi-Fi scans and joins (one radio: the search could make it miss the handshake).
- Tests: `test_otarx.cpp` (packet bookkeeping), `tests/app/wifi_ota.js` (the page and a full update with a lost packet, restart and reconnect).

## 27 Oct 2026 — review before release (same versions: T3 2.0, Heep 1.1.0)

Checked and fixed before merging the overnight work:
- **Build:** the workflow looked for the version in `T3.ino`, but 2.0 keeps it in `config.h`, so `t3.json` said `"v":""` and no
  T3 would ever have updated. It now reads `config.h`, refuses to publish without a version, logs whether the core's bootloader
  rollback is on, and runs the Nano link test too. New `nano.yml` compiles `nano/` for an ATmega328P Nano.
- **T3 updates:** a version was marked "bad" if the key went off during the download or the first 20 s. Now "try" is only
  written once the whole program is in flash, and a version needs to fail 3 times before it's skipped (no battery: power cuts happen).
- **T3 iCar:** one "NO DATA" (cranking, busy bus) blanked that value (boost, speed...) until the next restart. Now it takes 3 in a
  row, and missing values are asked for again every 2 minutes and after reconnecting.
- **T3 Bluetooth:** messages go out in pieces as big as the phone allows (2-3 per live message instead of 25 with pauses), so
  loop() isn't held up ~75 ms twice a second. GPS buffer doubled to 2 KB. The engine starting wakes the screen.
- **Heep:** lists inside long sheets were squeezed to nothing (the T3 screen list didn't show at all); some sheets and the Live
  page were wider than the phone. Bluetooth messages are now sent one at a time (overlapping sends could mix their bytes).
  In the screen editor, tapping "+ Add" right after typing a number was lost; the 15 s wait for the T3 starts after the upload.
- **Tests:** `tests/app/editor.js` builds and sends screens through the editor to a pretend T3 that checks them with the T3's own
  screen code (`tests/firmware/scrtool.cpp`), incl. 12 full screens, reordering, hiding, loading back and button settings.
- Sample GPS data moved to downtown Fort St. John.

## 27 Oct 2026 — T3 2.0, Heep 1.1.0, Nano link 1 (overnight session)

Compiled and tested on a PC with simulated data only; not yet run on the Jeep's hardware.

**T3 2.0**
- Split into tabs by job; all pins in `config.h`; `t3.h` explains the layout.
- Bluetooth moved to NimBLE: the program went from 98% to 78% of its space.
- HGLRC M100 GPS on GPIO 34: auto baud, position, speed, course (trusted only when moving), 2D/3D, satellites used and in view,
  HDOP, altitude, UTC time sets the clock. Speed source: auto / iCar / GPS.
- DS18B20 outdoor probe on GPIO 4 (non-blocking, CRC-checked).
- One-way Nano link on GPIO 39 (checksummed, duplicate-safe, auto baud); configurable button actions.
- Screens are data: up to 12 of your own, 10 widgets each, 46 values, edited in Heep. New defaults lead with
  Temperature & direction, then Drive, Boost, Economy, Trip, Engine, GPS, Connections, Logging, System.
- One trip state machine (start/pause/resume/end/auto-park) for buttons, Heep and the relay; peak boost per trip; marks.
- microSD: a CSV per trip, index, events log, retention that deletes uploaded tracks first.
- Tracks upload to your own track store (Apps Script in Drive), 100 rows a request, confirmed before counted.
- Relay: live data encrypted (now that it includes position); commands from Heep signed with the sheet key.
- OTA: only newer versions; a new program must run 20 s or the T3 rolls back and skips that version.
- Diagnostics message; settings for units, heading, logging, display night mode, upside-down mounting, time zone.

**Heep 1.1.0**
- Map tab: Map & Trip History (recorded tracks only, gaps never bridged, stops, marks, replay, charts, CSV, places).
- Live: heading and outside temperature cards, connection chips, stale warning, trip pause/end/mark, T3 page buttons.
- Screens & buttons editor with pixel preview; T3 settings regrouped; Diagnostics.
- Works with the T3 over the relay in Safari for screens, settings (not secrets) and trip controls.

**Nano**
- `T3Link.h` and `WheelButtons.h` add-ons (non-blocking), `WheelCalibrate` sketch.

## Earlier
See git history (T3 1.0–1.5: iCar trip computer, sheet uploads, OTA, live over Wi-Fi; Heep 1.0.x).
