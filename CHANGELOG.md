# Changes

## 28 Oct 2026 — T3 2.12, Heep 1.1.13: right wheel buttons set in Heep

- **Right steering wheel buttons are programmable** (Live → Screens → Right wheel buttons): tap and hold for top,
  middle and bottom: volume, mute, play/pause, tracks, source, Siri, answer, hang up, high beams, a T3 button, nothing,
  or any Kenwood code (handy for finding the answer-call code). "Saved on the Nano ✓" once the Nano has it.
- One new wire, T3 GPIO 25 → 1 kΩ → Nano D8, and the Nano sketch `jeep_controller_v3` (based on v2, link at 9600).
  The T3 sends the map until the Nano's heartbeat shows it; the Nano keeps it in EEPROM and works without the T3.
- The T3's green LED is no longer used (its pin is the new wire).

## 28 Oct 2026 — T3 2.11, Heep 1.1.12: Heep over Wi-Fi works everywhere

- **"Not connected to the T3" with the T3 on your hotspot:** Heep only counted the relay as connected once the T3 had
  sent something in the last 15 s, and a parked T3 only sends when Live asks. Now the relay stays open on every tab
  while Heep is on screen, and before screens, settings, codes and the rest Heep asks a quiet T3 (signed "status") and
  goes ahead when it answers; if it doesn't within 8 s Heep says so (key on? on Wi-Fi?) instead of "connect".
- **The T3 gets on the relay far more easily:** plain MQTT (1883) instead of TLS, which needed ~40 KB of memory the T3
  often hadn't got with Bluetooth running. Nothing changes for privacy: live numbers are AES-GCM sealed with a key from
  your sheet key and commands are signed with it, as before. TLS is still tried after two failures.
- Without a clock yet (no GPS, no internet time), a correctly signed command sets it, so the first command isn't lost.
- Relay status with reasons on the Wi-Fi page and Diagnostics: connected, or why not (and free memory), commands
  taken and refused (bad signature, replay, time off).
- iPhone widget: its saved copies (heep-lib-core and the rest) showed up in Scriptable's Scripts list. They live in
  Scriptable's Library folder now; the old ones are cleared away and the pasted script updates itself.

## 28 Oct 2026 — Heep 1.1.11: iPhone widget

- **Widgets for the Home Screen, the Today View and the Lock Screen** through the free Scriptable app: small, medium and
  large, the Lock Screen circle, rectangle and line. Blocks: distance to empty (with the tank gauge), fuel economy, cost
  per km, this week, this month, last trip, odometer, next service, last fill-up, and a chart of driving by week. Run
  Heep in Scriptable to preview every size and choose what each shows; or per widget, Parameter "dte,econ,week".
- The script pasted into Scriptable (`widget/Heep.js`) only downloads `widget/heep-widget.js`, so the widget updates
  itself; the numbers come from Heep's own code (core.js, econ.js, trips.js), kept with the last log for no signal.
  The setup link is asked for once and kept in Scriptable's Keychain. Heep: Settings > iPhone widget has the steps.
  Test: `tests/app/test_widget.js` (a pretend Scriptable in Node).

## 28 Oct 2026 — T3 2.10, Heep 1.1.10: economy from the tank and the T3 together, distance to empty, iPhone hotspot

- A saved network matched the scan loosely (an iPhone's name has a curly apostrophe, Ben’s iPhone; typed it's often
  straight) but the T3 then asked for it by the saved spelling, which the phone doesn't answer to. It now joins by the
  exact name it saw, also for Update over Wi-Fi. When the hotspot isn't in the scan, every other try uses the other
  apostrophe.
- **Overview economy before two full tanks:** fuel economy from the T3's trips until there are full tanks, then the last 3
  full tanks plus the T3's driving since the last fill-up. Where both cover a full tank, the tank shows how far off the
  T3's diesel figure is and the T3 is corrected by it (`econ.js`, tested in `tests/app/test_econ.js`). Cost per km the same
  way (economy × pump price until there are tanks). Fuel economy by week from the T3.
- **Distance to empty:** the tank counted down from the last full fill-up with the diesel the T3 measured (corrected) and,
  for driving it didn't log, the distance at your economy. Overview tile and gauge, Live, and its own screen (live while
  the T3 is connected). New T3 fields **To empty** and **Fuel left** (Heep sends the level; the T3 counts down as it burns),
  and a "Distance to empty" screen template. Test: `tests/app/overview.js`.

## 27 Oct 2026 — T3 2.9, Heep 1.1.9: updates only when you ask

- 2.8 kept restarting to "look for updates": its regular check still ran in the background, failed for want of memory,
  asked for a fresh start, the fresh start found nothing new, and round again. The T3 now never looks for updates by
  itself: only Heep's Update over Wi-Fi (or over Bluetooth) does it. A 2.8 T3 in that loop installs 2.9 by itself on its
  next round.
- Live shows "T3 x.y is ready" when GitHub has something newer than the T3 you're connected to.

## 27 Oct 2026 — T3 2.8, Heep 1.1.8: Update over Wi-Fi from a fresh start

- **"couldn't reach GitHub: connection refused"** with a strong signal: the secure download needs about 50 KB of memory in
  one piece, and with Bluetooth (iCar and Heep), Wi-Fi and the relay running there wasn't enough. Now Update over Wi-Fi
  restarts the T3 first and does it all before Bluetooth starts: join your Wi-Fi, check GitHub, download, restart into the
  new version. The T3's screen shows progress; Heep keeps reconnecting for up to 5 minutes and shows the result. The regular
  automatic check also downloads this way (and tries a fresh start, at most twice in a row, when it can't get through).
- The reason when it can't was cut to 48 letters ("(sign"): status texts now hold 112, and say signal and free memory.
- The relay never connects alongside an update check, and a check waits for a relay connection being set up.
- Test: `tests/app/wifi_update.js`.

## 27 Oct 2026 — T3 2.7, Heep 1.1.7: trouble codes, trip breakdowns, Live in Safari

- **Trouble codes** (Live > Trouble codes): the T3 asks each bus "Scan the Jeep" found a computer on (the diesel's on the
  K-line, the transmission on the Chrysler bus) for the check-engine light, stored codes and pending codes; Heep decodes them,
  says what the common ones mean and links each to a search. Clear codes takes two taps and is refused while moving.
  Decoding in `codes.js`, tested in `tests/app/test_codes.js` and `tests/app/codes_trips.js`.
- **Trip breakdowns without a GPS:** a trip's distance comes from the T3's trip meter (else the engine's speed) instead of 0;
  fuel from the engine's fuel rate; charts for speed, RPM, boost, coolant, load, fuel rate, intake and battery. Live's trips
  open a breakdown (and point to track storage for the charts).
- **Driving totals** by week, month and year on Live (distance, time, diesel, L/100 km, top speed, a bar per period).
- **Live in Safari:** a "Live over Wi-Fi" card (relay connected, asked the T3, last heard, what to check) instead of a
  "needs Bluefy" dead end. Bluefy steps are tucked underneath.
- **Peak boost label** on the T3's Boost screen no longer runs into the number: row labels are cut to fit (`fitLabel`, the
  same in the screen editor's preview). The field is now called "Peak boost".
- **Live over Wi-Fi after a Bluetooth update:** the switch-off to free memory only lasts until the restart (`lwu`), and the
  first start of a new version turns it back on if an older Heep left it off.

## 27 Oct 2026 — T3 2.6, Heep 1.1.6: polish after the first drive

- **Boost at altitude:** the CRD doesn't report outside air pressure, so boost assumed sea level (~1 psi low at Fort St. John).
  The T3 now learns it from intake pressure with the key on / engine stopped and at idle (`learnBaro`, tested). Diagnostics says
  where it came from.
- **Engine temps in °F** (coolant, intake) on the T3's screens, Live and the screen editor; own setting (T3 settings > Engine
  temperatures), default °F. Outside temperature keeps its own °C/°F setting.
- **Air flow (MAF) and fuel rail pressure** as screen fields and live values (the CRD offers both on the K-line). Slow values
  are only asked for when the engine offers them.
- **Update over Bluetooth "not enough memory"** (2.4/2.5 keep Wi-Fi and the relay up): the T3 switches Wi-Fi off first and
  falls back to a smaller buffer; Heep, for T3s that still refuse, turns Live over Wi-Fi off for a minute and back on after.
- **Update over Wi-Fi "couldn't reach GitHub":** 3 tries with longer timeouts, a cache-busting t3.json fetch, the relay steps
  aside unless there's plenty of memory, and the message says why (error, signal, free memory).

## 27 Oct 2026 — T3 2.5, Heep 1.1.5: Scan the Jeep

- The 2006 CRD answered on J1850 VPW (the Chrysler bus) with only check-engine status, RPM and throttle. The diesel's own
  computer usually talks on the K-line (KWP2000), which "auto" never reaches because VPW answers first.
- Diagnostics > **Scan the Jeep's computers**: the T3 tries J1850 VPW, KWP2000 fast and slow, ISO 9141-2, J1850 PWM and CAN in
  turn with headers on, and Heep shows which computer answered on each and every value it offers, marks the one with the most,
  and "Use this one" sets the protocol (T3 settings > iCar > Talk to the Jeep on; setting `opr`). Results are kept on the phone.
- Test: `tests/app/obd_scan.js`.

## 27 Oct 2026 — T3 2.4, Heep 1.1.4: live numbers in Safari any time; Update over Wi-Fi with a progress bar

- **Live in Safari (no Bluefy):** the T3 stays on the relay whenever it's on Wi-Fi, and sends live numbers while you're looking:
  Heep sends a signed "watching" note every 30 s while Live is open (before, a parked T3 went quiet 10 minutes after key-on).
- **Update over Wi-Fi** (Live > Wi-Fi & update): the T3 reports getting on Wi-Fi, checking, the download %, installed and
  restarting, over Bluetooth and the relay, so it works from Safari too. Allowed with the engine idling, never while moving; an
  unknown speed (no GPS, engine silent) no longer blocks updates.
- Connecting to the relay no longer freezes the T3's screen: it happens in its own task. The relay nonce is saved at most every 5 minutes.
- Tests: `tests/app/relay_live.js` (Safari, pretend relay + T3: signatures, encryption, live numbers, update progress, restart).

## 27 Oct 2026 — T3 2.3, Heep 1.1.3: tell "iCar connected" from "engine answering"

- The T3 treated any answer from the iCar (even "NO DATA" with the key off) as engine data, so Live said "iCar reading" with
  nothing behind it. Engine values now only count when the engine itself answers; the adapter's own answers just keep the link alive.
- If the iCar connected while the key was off, the engine's list of values was never asked for again: now 0100 is asked every
  20 s until the engine answers, and the misses are cleared the moment it does.
- Diagnostics: "Engine answering" yes/no, the engine's last answers word for word (0100, RPM, intake pressure), protocol "A0" explained.

## 27 Oct 2026 — T3 2.2, Heep 1.1.2: which engine values the iCar offers; boost fallbacks

- No boost on the Jeep: the T3 asked for intake pressure (PID 0B) and, if the engine didn't answer, never showed boost. It now
  reads the engine's own list of offered values (0100/0120/... answers, which it used to ignore), only asks for those, and
  takes boost from PID 0B, or PID 87 or 70 on diesels that report it there. `obdpid.h` + `test_obdpid.cpp`.
- Heep Diagnostics: "Engine (through the iCar)": where boost comes from, intake/air pressure, protocol, every value the engine
  offers in plain names, and which didn't answer. Status dots in Diagnostics show as dots again (were grey bars).
- Step-by-step USB installer (`firmware/usb.html`), for when the regular one sticks on "Preparing installation".

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
