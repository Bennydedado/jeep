# Changes

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
