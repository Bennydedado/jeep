# Working on this repository (for Ben, and for any AI helping him)

This file is the map. Read it first, then only the files a change needs. Ben isn't a programmer by trade: keep code
comments in plain English, explain changes in plain words, and never leave him with something half-working.

## What's here

| Path | What | Runs on |
|---|---|---|
| `index.html`, `app.js`, `core.js`, `ui.js`, `views.js`, `app.css` | **Heep**, the Home Screen web app: fill-ups, economy, service, trips (Overview, Fill-ups, Service tabs) | iPhone (Safari / Bluefy), GitHub Pages |
| `live.js` | Live tab: Bluetooth, the relay, the demo, the live dashboard | browser |
| `t3.js` | Sending commands to the T3 (Bluetooth or signed over the relay), T3 settings sheet, Diagnostics | browser |
| `t3screens.js` | T3 screen format, preview, screen/button editor | browser |
| `t3net.js` | Live > Wi-Fi & update: the T3's Wi-Fi state and scan, update over Bluetooth (pairs with `firmware/T3/ota.ino` + `otarx.h`) | browser |
| `map.js`, `trips.js` | Map & Trip History tab (Leaflet), and the track maths (pure functions, tested in Node) | browser |
| `vendor/leaflet/` | Leaflet 1.9.4 (don't edit) | browser |
| `listen/` | A separate app (listening stats). Leave it alone unless asked. | browser |
| `sw.js`, `manifest.webmanifest` | Offline copy of the app | browser |
| `firmware/T3/` | The T3 program (ESP32). `T3.ino` + tabs; `t3.h` explains them; pins in `config.h` | LilyGo T3 |
| `firmware/T3.bin` etc. | **Built by GitHub Actions. Never edit or commit these by hand.** | |
| `nano/` | Nano add-on (`T3Link.h`, `WheelButtons.h`) and the button calibration sketch | Arduino Nano |
| `tracks/TrackStore.gs` | Ben's track store (Apps Script in his Drive) | Google |
| `tests/` | PC tests: `bash tests/run.sh` | PC |
| `docs/HARDWARE.md` | Wiring, setup, troubleshooting | |
| `T3.md` | Every message between Heep and the T3 | |

The Jeep log sheet's own Apps Script (fill-ups, trips) is **not** in this repo; it's bound to the sheet. Don't assume
you can change it. Its API: POST `{"k":key,"ops":[{"q","op":"put"|"del"|"info","tab":"fill"|"serv"|"log"|"trip","row":{...}}]}`,
answers with all tabs (see `core.js` `sync()`).

## Rules that keep things working

1. **T3 pins:** never use GPIO 16 or 17 (flash), don't drive 34/35/36/39 (input-only), no 5 V into any T3 pin, avoid GPIO 12.
   Pin numbers only in `firmware/T3/config.h`.
2. **Bump `FW` in `firmware/T3/config.h`** for every firmware change. T3s only install a newer number.
3. **Bump the app version** for every app change: `VERSION` in `core.js`, every `?v=` in `index.html`, and `CACHE` +
   `SHELL` in `sw.js` (all the same number), or phones keep the old copy.
4. **The Nano must never depend on the T3.** The link is one-way (Nano TX → T3). Nothing on the Nano may wait for the T3.
5. **The T3's loop must never block.** No `delay()` over a few ms, no waiting for Wi-Fi or a server in `loop()`.
   Slow network work goes in `uploadTask` (net.ino), which must not touch loop()'s `String`s
   (use `taskEvent()` and the `Txt` status buffers).
6. **Secrets** (Wi-Fi passwords, sheet key, track key) only go to the T3 over Bluetooth, never the relay, never into the repo.
7. **Honest data:** unknown values show `--`, never a made-up number. GPS heading is "course", not a compass. Gaps in a
   track are never drawn across. Estimated times are marked.
8. **Screens and fields exist twice:** `firmware/T3/fields.h` + `screens.h` and `t3screens.js` must match (the tests check it).
9. Run `bash tests/run.sh` before committing. CI runs the C++ tests and the firmware build on every push to `firmware/T3/`.

## Recipes

**Add a value the T3 can show (e.g. oil temperature):**
1. `firmware/T3/fields.h`: add `{ "oilt", "Oil", "C", 0 },` at the end of the group.
2. `firmware/T3/display.ino`: in `fieldNumber()` add `if (!strcmp(id, "oilt")) return ...;` (or `fieldText()` for text).
3. `t3screens.js`: add `['oilt', 'Oil', 'C', 0, 'Engine']` to `FIELDS` in the same position, and a `SAMPLE` value.
4. Bump `FW` and the app version. `bash tests/run.sh`.

**Read a new OBD value:** add the PID to the poll lists and a `case` in `obdAnswer()` (obd.ino), store it in `Live` (t3.h),
then add a field as above. Add it to `liveJson()` (phone.ino) and to `GAUGES` in live.js if Heep should show it, and to
`rowText()`/`TRACK_HEADER` (sdlog.ino, t3.h; **new columns at the end only**) to log it.

**Add a T3 setting:** `Settings` (t3.h) → `loadSettings()` + `applySettings()` + `settingsJson()` + `resetSettings()` keys
(settings.ino) → `T3_DEFAULTS` + `t3SendSettings()` key list + a control in `t3Setup()` (t3.js). Keep Preferences keys ≤ 15 chars.

**Add a wheel-button action:** handle it in `doAction()` (wheel.ino) and add it to `ACTIONS` in t3screens.js.

**Change a default screen:** edit the same string in `DEFAULT_SCREENS` in **both** `screens.h` and `t3screens.js`.

**Add a page to Heep:** write `renderX(v)` (see `renderMap` in map.js), add a `<script>` in index.html and the file to `SHELL`
in sw.js, add a row to `TAB_DEFS` in app.js (5 tabs is the most that fits; add a sheet or a button instead of a 6th tab).

**Change a pin:** `firmware/T3/config.h`, then `docs/HARDWARE.md` sections 3–6.

## Building and testing

- App: static files, no build step. Test locally with `python3 -m http.server` in the repo root, open http://localhost:8000.
  Headless check: `node tests/app/smoke.js` (Playwright + Chromium).
- T3: see `firmware/README.md`. Nano: Arduino IDE, board Arduino Nano.
- Simulated data: Live → Demo; the Map shows sample trips until track storage is set up; `trips.js` `sampleTrack()`.
