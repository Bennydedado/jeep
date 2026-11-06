# Changes

## 5 Nov 2026 — T3 2.32: tracks through the house receiver, and Google's 400 fixed

- 2.31 got through to Google, which answered "400". The HTTP library follows Apps Script's redirect with a GET that
  still carries the POST's Content-Length; the T3 now makes that second request itself, cleanly.
- At key-on at home the T3 looks for the house receiver (the thermostat Heltec, `jeep-house` on the Wi-Fi) and hands
  it the tracks over plain HTTP, signed with the track key; the receiver sends them on to the track store. The T3
  no longer needs memory for Google's secure connection for tracks at home. Needs the updated receiver sketch
  (flashed over USB once); without it the T3 sends straight to Google as before.
- Track rows only carry plain characters (a damaged byte on the card can't spoil a part any more).

## 5 Nov 2026 — T3 2.31: give back the Bluetooth Classic memory at start

- 2.30 showed the start-up try failing too: "at start: -11, 54 KB free, 33 KB block". The NimBLE library includes a
  header that marks Bluetooth Classic as in use, so Arduino kept its memory (~36 KB) reserved until Bluetooth
  started, which is after the start-up upload. The T3 only uses Bluetooth LE: it now releases Classic's memory first
  thing at power-on, so the upload has it. The start-up note (Diagnostics) also gives the memory at that moment.

## 5 Nov 2026 — T3 2.30: which try failed

- Still "-1, 55 KB free, 37 KB block" with the iCar connected: a try while driving passed the 56 KB check, then the
  part and the connection used it up. While Bluetooth runs, tracks now need 100 KB in one piece (in practice: they
  wait for key-on at home). A failure now starts with "at start:" or "driving:", so it's clear which try it was.

## 5 Nov 2026 — T3 2.29: tracks wait for key-on instead of failing while driving

- Ben's T3 showed "track send failed (-1, 54 KB free, 43 KB block, 20 rows)" with the iCar connected: with Bluetooth
  running there isn't one piece of memory big enough for the secure connection, however small the part. While
  Bluetooth is on, tracks are no longer tried unless at least 56 KB is free in one piece; they go at key-on at home
  (before Bluetooth starts) or with Upload now. The status from that try is no longer overwritten by failing ones.

## 5 Nov 2026 — T3 2.28, Heep 1.1.33: tracks that fail with -1

- Tracks failed with "send failed (-1)": the T3 couldn't open the secure connection, most likely because a 250-row part
  (two copies of about 30 KB) left too little memory for it. Parts are now built in one copy, start at 120 rows at
  key-on (50 while driving), and when the connection can't be opened the same part is tried again at once at half
  the size, down to 20 rows. The size that worked is kept. A failure now also says the largest free memory block and
  the part size, so the next problem shows its cause.
- Track storage: when the link works but the key doesn't match, Heep says so plainly and how to paste link|key.

## 5 Nov 2026 — T3 2.27, Heep 1.1.32: say why tracks don't arrive

- When an upload stops short, the T3 screen now says why and what to do, for 12 s: "track key wrong / Heep: Send
  settings", "send failed (-1)", "Wi-Fi lost" and so on, instead of only "Upload paused".
- The T3 tells Heep which track store it sends to as a short fingerprint of the link and key (never the key itself).
  Heep's Trips page compares it with its own store and warns when the T3 has no track storage or an old key, with a
  tap straight to T3 settings > Send settings. It also says how many GPS tracks are still on the T3.

## 5 Nov 2026 — T3 2.26: uploads keep going until they're done

- At key-on the T3 no longer stops sending tracks after 25 s ("12 to go, next time"): it keeps going until every trip
  and track is up or the Wi-Fi is gone (driving away). What's sent is remembered and never sent again; a track cut
  off part way carries on where it stopped.
- The upload now runs in the background: your screens, the GPS, logging and the wheel buttons work while it goes.
  Any wheel button hides the "Uploading" screen and the upload carries on ("Upload done" flashes when it finishes).
  The iCar and Heep connect over Bluetooth once it's over, because the upload needs that memory.

## 5 Nov 2026 — T3 2.25, Heep 1.1.31: Safari can send Wi-Fi passwords and links

- Heep in Safari (over the Wi-Fi relay) can now send Wi-Fi networks, the sheet link and the track storage link and key
  to the T3, not just Bluefy. They travel sealed (AES-256-GCM with the key from your sheet key) in their own `sec`
  message; only a T3 with the same sheet key can open them. Nothing secret ever goes in the clear. The very first
  hookup (giving the T3 the sheet key) still needs Bluetooth once.
- CI pins Playwright below 1.65 (1.65.0 was published without its playwright-core).

## 5 Nov 2026 — T3 2.24, Heep 1.1.30: Upload trips and tracks now

- Heep: T3 settings has **Upload trips and tracks now** and shows what's waiting. The T3 answers straight away (what
  it's sending, or why it can't: driving, no Wi-Fi saved, nothing waiting), ends the trip, restarts and sends every trip
  and GPS track with no time limit, the bar on its screen. It tries all your saved networks, hotspots included. When
  Heep is back in touch it says how it went ("sent 2 trips and 3 tracks"). The old "Try Wi-Fi and update now" button is
  now "Check for a T3 update now", since that's all it does.
- The wheel menu's "Send trips" is now "Upload now" and does the same (tracks too; it used to stop at "No trips waiting"
  even with tracks to send).

## 5 Nov 2026 — Heep 1.1.29: a Mix tab for your own screen set

- Live → Screens has a fifth tab, **Mix**. "Add a screen" now lists every screen from your other tabs (with your
  changes) as well as the templates; picking one adds a copy you can change without touching the original.

## 4 Nov 2026 — T3 2.23, Heep 1.1.28: screens you can read from the seat, setups, full-screen map

- Size 2 text is now a smooth 9 pt bold font (about 13 px tall) instead of the blocky doubled small font. The default
  screens use it for every row: four rows to a screen, label on the left, value on the right. Labels and units beside
  a big number are 9 pt too.
- A row's label stays as big as the value when it fits, otherwise it goes small rather than disappearing; only a value
  too long for the row drops to the small font. Nothing a widget draws can spill into the next one (the bottom pixel
  of a g or y at the foot of a row is trimmed).
- New default screens (11): Drive, Temp & dir, Boost, Economy, Trip, Trip 2, Engine, GPS, Connections, System, Trip
  status. A course in degrees shows its degree sign in the big fonts.
- Heep: **setups** at the top of Live → Screens: Everything, Daily, Towing and Road trip. Tap one and its screens go
  to the T3; each keeps its own changes. Rows and bars have a size choice in the editor, and the preview draws the T3's
  big fonts at their real size.
- Heep: the map has a **full screen** button.
- Tests: `tests/firmware/test_draw.cpp` draws every default screen, template and setup with the T3's own drawing code
  (`firmware/T3/draw.h`) and the real Adafruit GFX fonts, with ordinary and widest values, and checks nothing leaves
  its box.

## 4 Nov 2026 — T3 2.22, Heep 1.1.27: GPS tracks upload when you get home, with a progress bar

- Getting home: once the T3 is on one of your Wi-Fi networks (not a phone hotspot) and the Jeep has stopped for 5 s
  with trips or tracks waiting, it ends the trip, restarts and sends everything before Bluetooth starts, when all the
  memory is free. The screen shows **Uploading** with a bar while things actually go up, then **Upload done**.
- Key-on: trips, then tracks for up to 25 s, the same way (joining Wi-Fi no longer puts "Trip status" on the screen).
- A track that doesn't finish carries on where it stopped next time instead of starting over, in bigger pieces at
  start-up (250 rows).
- Heep: Track storage has **Copy link and key**, and accepts that line pasted in another browser (Bluefy → Safari, or
  the Hub), so they all use the same storage. The trip sheet says when tracks go up.

## 4 Nov 2026 — T3 2.21, Heep 1.1.26: the iCar stays connected (and comes back) during a drive

- The T3 now waits 8 s without hearing the iCar before calling the Bluetooth link lost (it was 2.56 s). The ESP32 has
  one radio for Bluetooth and Wi-Fi, and a Wi-Fi scan for your hotspot (to upload trips or tracks) could keep it busy
  long enough to drop the iCar.
- When the link does drop, the T3 reconnects straight to the iCar it already knows, every 3 s, instead of only
  searching every 8 s; every 4th try searches again in case the adapter changed.
- While the iCar is reconnecting during a drive, Wi-Fi waits (up to 2 minutes) instead of scanning over the top of it.
- Each drop and reconnect is written to `/jeep/events.log` on the SD card (with what Wi-Fi was doing at the time), and
  Diagnostics → iCar shows how many times the link dropped since key-on.

## 3 Nov 2026 — T3 2.20, Heep 1.1.25: holding a wheel button does its job once

- Holding the top button jumps to the key-on screen and stays there, however long you hold it. Before, it went to the
  key-on screen and then kept stepping through screens while held. Only a button whose hold is set to next or
  previous screen keeps scrolling while held.

## 3 Nov 2026 — T3 2.19, Heep 1.1.24: see what the Nano link is doing

- Diagnostics → Steering wheel shows **Bytes heard on GPIO 39**, what that means in plain words, and the **Last text
  heard**, so "nothing arrives" (wiring) can be told apart from "garbage arrives" (divider level or baud).
- The T3 takes a Nano message counter up to 65535 (as its low byte), so an older Nano sketch with a 16-bit counter
  no longer stops being heard after about four minutes.
- New Diagnostics section **Headlights**: the Nano's last 12 headlight events (jeep_controller v3.2): what happened
  (stalk, pedal, mode) and what the Nano told K1 to do right after. Shown only; the T3 never acts on them.

## 2 Nov 2026 — T3 2.18: keep screen transfers from restarting the T3

- Prepare new screens on the heap instead of putting the entire twelve-screen set on the small loop stack.
- Handle signed Wi-Fi commands after the MQTT receive callback returns, leaving more stack space for parsing and flash writes.
- Confirm screens only after the complete file is written and renamed successfully. A failed write preserves the previous screens.
- Test the firmware's actual storage code with full screen sets, malformed input, failed writes, and failed renames.

## 2 Nov 2026 — T3 2.17, Heep 1.1.23: reliable screen sending in Safari

- Live → Screens & buttons sends screen layouts through the Wi-Fi relay from Safari when the T3 is online; Bluefy is not required.
- T3 confirms each screen, Heep retries a missed packet and a lost final confirmation, and the set fingerprint confirms the complete layout.
- Screen send buttons use a general send icon instead of a Bluetooth icon.

## 2 Nov 2026 — T3 2.16, Heep 1.1.22: trip upload status and Jeep expense log

- Trip sending no longer takes over the display with a repeated “Sending trips” screen. A dedicated status screen
  shows only Wi-Fi connected/not connected and trips uploaded/not uploaded. The same screen is available from Heep →
  Live → Screens & buttons → Add a screen.
- Heep’s Service tab has a separate Jeep expense log with category totals and filtering, brand/part and installed-km
  details, an optional explicitly selected Maintenance reminder, and CSV export. Existing log columns are reused.
- Map & Trip History is named Trips throughout the app and project docs.
- No new T3 wire message was added; the screen status fields use the existing screen format.

## 30 Oct 2026 — T3 2.15, Heep 1.1.20: set your own brightness levels

- Heep → Screens → Display → Brightness levels: tap Low, Medium or High and slide to set what it means (0-100%).
  The T3 shows that level while you slide. Brightness, Night brightness and the wheel menu use your levels.

## 30 Oct 2026 — Heep 1.1.19: headlight mode with tap, hold

- Heep → Nano → Headlight mode: "Turn it on / off with" Tap, tap, hold (as before) or Tap, hold. A plain hold is still
  the pedal's Hold action. Needs the updated jeep_controller_v3.

## 29 Oct 2026 — Heep 1.1.18: bad stereo codes stay off; right middle in headlight mode

- Find stereo codes: "Bad: never send again" marks a code (one that turned the stereo off, say). Bad codes are skipped by
  ◀ ▶ and Nothing / Save → next, and Send refuses them. ✕ in the list allows one again, and "Send this banned code once" (two taps) sends one on purpose.
- Headlight mode: the right middle wheel button can switch the beams too (Heep: Nano, Headlight mode: middle buttons). Needs the updated jeep_controller_v3.

## 29 Oct 2026 — T3 2.14, Heep 1.1.16: the wheel menu, the pedal and finding stereo codes

- **T3 settings from the steering wheel:** the new "Settings menu" button action (default: hold left middle). Brightness,
  night brightness, night mode, screen-off time, key-on screen, °C/°F, upside down, Live over Wi-Fi, reset peak, send
  trips, end trip. Top / bottom move, middle changes, hold middle to close. Heep picks the changes up when it connects.
- **Night mode, sunset to sunrise:** works out the times from where the GPS last was. Night hours in Heep are now
  shown as 7 PM / 7 AM.
- **The Nano's pedal is set in Heep** (1, 2, 3 clicks and hold), and **headlight mode can be pedal-only**: the left
  middle button can be left out of switching the beams and of turning the mode on/off.
- **Find stereo codes in Heep:** the Nano sends one Kenwood code; tap Nothing or write what it did, and it sends the next
  code you haven't tried. Your notes are kept and named in the pickers; "Use as Answer / Hang up" puts a code to work.
  Answer and hang-up codes are entered in Heep instead of the sketch. `nano/KenwoodCodeFinder` does the same from a
  laptop.
- **Trips reach the sheet at the end of a drive at home:** parked with the key on, the trip ends after the park time;
  if your Wi-Fi was there the T3 restarts and sends it ("Sending trips"). Or use the menu's "Send trips".
- The clock comes from the GPS as soon as it knows the time, before it has a position, so trips aren't "time approximate".
- Nano sketch `jeep_controller_v3` updated (same file name): it reads all of the above.
- Diagnostics → Steering wheel shows whether the Nano has your settings. Wiring drawings in `docs/wiring/`.

## 29 Oct 2026 — Heep 1.1.14: Fuel left screen

- New screen to add in Heep (Screens → Add a screen → Fuel left): litres left big, a tank bar (0–78 L) and the
  distance to empty underneath. Uses the tank level Heep sends the T3 from your last full fill-up.

## 28 Oct 2026 — T3 2.13: trips reach the sheet

- Trips could sit on the T3 for good: the secure connection to Google needs ~50 KB of memory in one piece, which the
  T3 often hasn't got with Bluetooth running (the same thing that stopped updates over Wi-Fi). Now at every key-on the
  T3 sends the waiting trips first, before Bluetooth starts, if your Wi-Fi is in sight (a few seconds; skipped quickly
  when it isn't). The screen says "Sending trips". Sending while driving still happens as before.
- A failed send says how much memory was free (Diagnostics → Uploads).

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
