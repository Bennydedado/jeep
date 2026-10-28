# Heep telemetry: installation and maintenance guide

For the 2006 Jeep Liberty CRD ("Heep"): LilyGo T3 trip computer, HGLRC M100 GPS, DS18B20 outdoor probe,
Arduino Nano (stereo, headlights, wheel buttons), microSD logging, and the Heep app.

Written 27 Oct 2026 for T3 firmware 2.0 and Heep 1.1.0. Nothing in this guide was tested on the real hardware:
the code was compiled and tested on a PC with simulated data (see section 17). Every pin marked
**PROVISIONAL** must be checked on your own board before you connect power.

> **Warnings before you start**
>
> - Never connect a 5 V signal straight to a T3 pin. The ESP32 is a 3.3 V chip; 5 V on a GPIO can destroy it.
>   The Nano is a 5 V board: its TX goes through the resistor divider in section 6.
> - Never use GPIO 16 or 17 on the T3 V1.6.1. They are wired to the chip's own flash memory; touching them crashed the T3 before (firmware 1.2).
> - GPIO 34, 35, 36 and 39 are input-only. They can listen, never drive.
> - Disconnect the T3 from the Jeep's 5 V supply before you plug it into the PC by USB, or the two supplies fight.
> - GPIO 12 is a boot-strapping pin. Anything that pulls it high at power-on can stop the T3 booting. This guide doesn't use it.

---

## 1. System overview

```
                     ┌──────────── Jeep 12 V (keyed) ────────────┐
                     │                                            │
               5 V buck converter                                 │
                ┌────┴──────────────┐                             │
                │                   │                             │
        ┌───────▼──────┐     ┌──────▼─────────────┐               │
        │ Arduino Nano │     │ LilyGo T3 V1.6.1   │               │
        │ stereo remote│ TX  │ OLED 128x64        │◄── BLE ──► Vgate iCar Pro (OBD port)
        │ headlights   ├────►│ GPIO 39 (Nano link)│
        │ foot pedal   │ one │ GPIO 34 ◄── TX ────┼── HGLRC M100 GPS (3.3 V)
        │ wheel buttons│ way │ GPIO 4  ◄── data ──┼── DS18B20 probe at the grille (3.3 V, 4.7k pull-up)
        └──────────────┘     │ microSD slot       │  one CSV per trip
                             │ Wi-Fi ─────────────┼──► home Wi-Fi / iPhone hotspot ─► Jeep log sheet (trips)
                             │                    │                                  ─► Track store (GPS tracks, your Drive)
                             │                    │                                  ─► GitHub (new T3 program)
                             │                    │                                  ◄► relay (live numbers, encrypted;
                             └─────────┬──────────┘                                      Heep's commands, signed)
                                       │ BLE (Bluefy) or the relay (Safari)
                                  ┌────▼─────┐
                                  │  Heep    │  Overview · Fill-ups · Service · Live · Map
                                  └──────────┘
```

- **The T3 collects, shows and logs.** It never draws maps. It shows your own screens (temperature and direction,
  boost, speed...) and takes the wheel buttons from the Nano.
- **The Nano keeps its own jobs.** The wire to the T3 only goes Nano → T3, so the T3 can be unplugged, off,
  rebooting or broken and the stereo and headlights work exactly the same.
- **Heep is where you set things up and look back.** T3 settings, screens and buttons, diagnostics, live numbers,
  and the Map & Trip History page.

## 2. Boards and modules

| Part | What it is | Status |
|---|---|---|
| LilyGo T3 V1.6.1 | ESP32-PICO-D4, 4 MB flash, SSD1306 128x64 OLED (I2C 0x3C), SX1276 LoRa, microSD slot, CH9102/CH343 USB | You confirmed the model ("T3 V1.6.1, 2×13 headers"). Check the silkscreen says V1.6.1. |
| HGLRC M100 Mini GPS | u-blox M10 (10th gen), GPS/Galileo/BeiDou/GLONASS, 3.3–5 V in, UART, NMEA, up to 10 Hz, 15×15 mm, no compass | From your Amazon order (arriving ~2 Nov). HGLRC lists 115200 baud; generic M10 boards default to 9600. The T3 finds the speed itself. |
| DS18B20 probe | Beenlen waterproof DS18B20, 3 m, 3 wires, −55 to +125 °C | From your Amazon order (5-pack). Wire colours are usually red = VCC, black = GND, yellow = data: **check the listing/label**. |
| 4.7 kΩ resistor | Pull-up for the DS18B20 data line | From your order. |
| Arduino Nano | ATmega328P, 5 V | Existing: stereo remote, high-beam relay, foot pedal. |
| Vgate iCar Pro BLE | OBD-II adapter, Bluetooth 4.0 | Existing. |
| microSD card | Any size, FAT32 | You said it's available. Cards over 32 GB come exFAT: reformat as FAT32. |
| Relay modules (AEDIKO 5 V, opto) | In your order | Not used by anything in this guide. |

## 3. T3 V1.6.1 pins

**Built into the board (from LilyGo's T3 V1.6.1 pin table; the old firmware already used most of these):**

| Function | GPIO | Notes |
|---|---|---|
| OLED SDA / SCL | 21 / 22 | I2C, address 0x3C |
| LoRa SCK / MISO / MOSI / CS / RST / DIO0 | 5 / 19 / 27 / 18 / 23 / 26 | The T3 puts the radio to sleep; it never transmits, safe without an antenna |
| LoRa DIO1 / DIO2 | 33 / 32 | Connected to the radio: don't use for anything else |
| microSD CS / MOSI / MISO / SCK | 13 / 15 / 2 / 14 | Slot on the board; own SPI bus |
| LED | 25 | Not used as an LED from 2.12: the pin is the T3 → Nano wire (the LED flickers while it sends) |
| Battery sense | 35 | Unused (no battery) |
| BOOT button | 0 | Hold while plugging in USB if an install won't start |
| Flash/PSRAM | 16, 17 | **Never use** |

**Used for the Jeep add-ons:**

| Function | GPIO | Direction | Status |
|---|---|---|---|
| GPS TX → T3 | **34** | input only | Verified against LilyGo's own "T3 V1.6.1: how to connect a GPS" page, which uses GPIO 34 for GPS TX. |
| GPS RX ← T3 | not connected | – | The T3 only listens. (LilyGo's page uses GPIO 12 here; 12 is a boot-strapping pin, so it's left out.) |
| DS18B20 data | **4** | in/out | **PROVISIONAL.** GPIO 4 was the old optional push button in firmware 1.x, so it's on the header, but check the silkscreen. |
| Nano → T3 | **39** | input only | **PROVISIONAL.** On most T3 V1.6.x boards 39 is labelled "39" or "VN" on a header. Check yours. If it isn't there, use 36 ("VP") instead and change `NANO_RX_PIN` in `firmware/T3/config.h`. |
| T3 → Nano | **25** | output | 2.12+, right wheel buttons set in Heep: GPIO 25 → 1 kΩ → Nano D8. Optional. **Check the header says 25.** Nowhere near the GPS (34). |
| 3.3 V out | 3V3 | supply | Powers the GPS (~25–40 mA) and the probe (~1.5 mA): well within the T3's regulator. |
| 5 V in | 5V | supply | From the keyed buck converter (as before). |
| GND | GND | | Shared by everything. |

All pins live in **`firmware/T3/config.h`**. If you move a wire, change it there and nowhere else.

## 4. GPS (HGLRC M100 Mini)

| M100 pad | T3 | Notes |
|---|---|---|
| 5V / VCC | **3V3** | 3.3 V supply keeps its TX at 3.3 V logic. Don't use the T3's 5V pin for it. |
| GND / G | GND | |
| TX / T | **GPIO 34** | GPS → T3 |
| RX / R | not connected | |

- Go by the **letters printed beside the pads**, not the wire colours of the SH1.0 cable (they vary).
- No configuration needed. The T3 tries 115200, 9600, 38400, 57600 and 230400 baud until sentences with
  good checksums arrive (Heep: T3 settings → GPS speed = "Find it by itself"; or pick one).
- Reads RMC, GGA, GSA, GSV, VTG (any talker: GP, GN, GA, GB...). Gives position, speed, course, UTC time and
  date, fix quality, 2D/3D, satellites used and in view, HDOP, altitude, age of the last fix.
- **Heading is GPS course, not a compass.** It's only trusted at or above "Trust heading above" (5 km/h by
  default). Stopped, screens show the last heading in brackets, e.g. `(NE)`, or `--` if you turn that off.
  A heading while parked would need a magnetometer (e.g. a QMC5883L or an M10 module with a compass), which
  would also need calibration away from the Jeep's steel; not part of this build.
- Mount it with a clear view of the sky: under the dash top, behind the windshield, not under metal. First fix
  outdoors takes 30 s to a few minutes (cold start).
- The GPS clock sets the T3's time (better than the phone or internet time).

## 5. Outdoor temperature (DS18B20)

| Probe wire (check the label) | T3 |
|---|---|
| Red (VCC) | 3V3 |
| Black (GND) | GND |
| Yellow (data) | GPIO 4 |
| **4.7 kΩ resistor** | between GPIO 4 and 3V3 |

- Put the resistor at the T3 end. Solder and heat-shrink the probe joint; the 3 m cable reaches the grille.
- Mount the probe in moving air behind the grille, away from the radiator, intercooler and exhaust heat, and
  out of direct sun if you can. Readings are only true outside temperature while moving; parked after a drive,
  engine heat soaks the probe.
- The T3 reads it every 2 s without waiting (12-bit, 0.0625 °C steps), checks the CRC, ignores the 85.0 °C
  "not converted yet" value at power-on, and looks for the probe again every 10 s if it's missing.
- Heep: T3 settings → Outside temperature: °C (default) or °F, and a correction if it reads off.
- The old GPIO 4 push button: set T3 settings → "GPIO 4 is wired to" → Push button if you'd rather keep it (then no probe).

## 6. Nano → T3 link

**Wiring**

```
 Nano D1 (TX) ──[ 10 kΩ ]──┬── T3 GPIO 39
                            │
                         [ 20 kΩ ]
                            │
 Nano GND ──────────────────┴── T3 GND
```

- 5 V × 20 / (10 + 20) = 3.33 V at GPIO 39. Safe. (Two 10 kΩ in series for the 20 kΩ is fine.)
- With the Nano unplugged, the 20 kΩ holds GPIO 39 low: the T3 just hears nothing.
- **Never** connect any T3 pin to the Nano's D0 (RX) or anything else on the Nano.
- Uploading a new Nano sketch over USB works with this wired (D1 only drives the divider).

**The other way (optional, T3 2.12+ and `jeep_controller_v3`): right wheel buttons set in Heep**

```
 T3 GPIO 25 ──[ 1 kΩ ]── Nano D8
```

- 3.3 V is a solid HIGH for the Nano (it needs 3.0 V). The 1 kΩ only protects both pins. Grounds are already joined.
- D8 is AltSoftSerial's receive pin; it also takes D9 and D10 (keep them free). The Nano link runs at 9600 both ways.
- Only one thing goes this way: the right-button map, `$N,M,<map>*HH`, every 2 s until the Nano's heartbeat
  (`$J,<seq>,H,<uptime>,2,<hash>*HH`) shows the same map. The Nano checks it, keeps it in EEPROM and never waits for
  the T3: unplugged, off or broken, the buttons do what they last did.

**Protocol** (Nano → T3 only, text lines, any of 9600–115200 baud; the T3 finds it):

```
$J,<seq>,B,<button 1-3>,<S|L|R>*HH     button: S short, L long (held 0.6 s), R repeat (every 0.25 s while still held)
$J,<seq>,H,<uptime seconds>,1*HH       heartbeat, once a second
```

`HH` = XOR of every character between `$` and `*`, two hex digits (like NMEA). `seq` counts 0–255.
Each press is sent twice 30 ms apart with the same `seq`; the T3 keeps the first good copy. Anything malformed
is dropped and counted, so a bad line can never press a button. Diagnostics shows good/bad/repeat counts and
whether the link is "ok" (heard in the last 3 s), "lost" or "none".

Code: `firmware/T3/jlink.h` (T3 side), `nano/NanoT3Example/T3Link.h` (Nano side).

## 7. Steering wheel buttons

- Your plan: keep the ESP clockspring and use the radio wires in its 4-pin wheel-side plug. Factory wheel
  controls are usually a **resistor ladder**: every button on one wire, each with a different resistance.
- **Nano side (PROVISIONAL until you measure):** ladder wire → **A6**, with a pull-up resistor from A6 to 5 V,
  ladder return → GND. A6/A7 are analog-only and have no internal pull-up.
  1. Upload `nano/WheelCalibrate` on its own, open Serial Monitor at 115200, hold each button, write the numbers down.
  2. Put windows halfway between those numbers into `LEFT_WINDOWS` in `nano/NanoT3Example/NanoT3Example.ino`.
- If the buttons turn out to be separate switches to ground, use `PinButtons` from `WheelButtons.h` instead.
- **Adding it to your stereo/headlight sketch** without changing what it does: copy `T3Link.h` and
  `WheelButtons.h` into your sketch folder and copy the four marked blocks from `NanoT3Example.ino`.
  Nothing in them waits or blocks. Keep your existing pedal, stereo and relay code as it is.
  If your sketch already calls `Serial.begin(...)` at another speed, keep it; the T3 finds it.
- **What each button does** is set in Heep (Live → Screens → Steering wheel buttons). Default:

| Button | Press | Hold (0.6 s) |
|---|---|---|
| 1 (top) | Previous screen | Key-on screen |
| 2 (middle) | Mark this spot (in the trip's track) | Pause / resume trip |
| 3 (bottom) | Next screen | End trip (a new one starts) |

  Other actions: screen off/on, brightness, reset peak boost, send/sync now, nothing. Holding Next or Previous
  keeps scrolling. While the T3's screen is off, the first press only wakes it.
- **Right buttons** (stereo, on the Nano; needs the GPIO 25 → D8 wire and `jeep_controller_v3`): set in Heep (Live →
  Screens → Right wheel buttons), tap and hold for each. Default: volume +, answer / hang up, volume −. Choices:
  volume ±, mute, play/pause, next/previous track, source, Siri, answer, hang up, high beams, T3 button 1–3, nothing,
  or any Kenwood code. Tap and hold the same = goes on press and repeats while held. Tokens: `nano/NanoT3Example/WheelMap.h`.

## 8. SD card and logging

- Insert a FAT32 card into the T3's slot. If Diagnostics says "No card", reformat on the PC (FAT32) and reinsert;
  the T3 tries again every 30 s.
- On the card:

| Path | What |
|---|---|
| `/jeep/trips/<trip id>.csv` | Every row of a trip: once a second driving, every 10 s parked (both set in Heep) |
| `/jeep/index.csv` | One line per finished trip: id, start/end time, T3 km, GPS km, litres, seconds, top speed, start/end lat/lon |
| `/jeep/uploaded.txt` | Trips whose track has reached your track store |
| `/jeep/events.log` | Boots (and why), trip start/pause/end and by what, uploads, card housekeeping (rolls over at 512 KB) |

- Trip file columns (added to only at the end, so old files stay readable):
  `ms` epoch ms (blank before the clock is known) · `up` T3 ms since power-on · `tq` time source g GPS / n internet / a phone / - none ·
  `lat,lon` (blank = no fix) · `fix` 0 none … 4 3D · `sats` · `hdop` · `alt` m · `kmh` GPS speed · `crs` course ° (blank under 5 km/h) ·
  `obd_kmh,rpm,boost,ect,iat,volt,load,lph` from the iCar · `otemp` °C · `trip_km` · `ev` event text (marks, trip commands).
- **Power loss:** the T3 has no battery and loses power at key-off. Rows wait in memory for at most "Write to
  card every" (5 s default) and the file is closed after every write, so a key-off costs a few seconds, never the file.
- **Full card:** above "Make room when over" (90 %) the oldest **already uploaded** tracks are deleted. Only at
  98 % are un-uploaded tracks deleted (logged in events.log). The internal flash also keeps a small queue of
  finished-trip summaries for the sheet, as before.

## 9. Wi-Fi, hotspot, Bluetooth

- Heep → Live → T3 settings → Wi-Fi networks: up to 8, tried in your order (home, shop, iPhone hotspot).
  iPhone: Settings → Personal Hotspot → Allow Others to Join and **Maximize Compatibility** on (2.4 GHz only).
- The T3 turns Wi-Fi on only when there's something to do: trips or tracks to upload, an update check, or live
  numbers (while driving, and for 10 minutes after key-on). It scans without blocking, backs off for 30–90 s if
  none of your networks is around, and turns Wi-Fi off after a minute with nothing to do.
- **Bluetooth:** Safari on iPhone can't use Bluetooth. Use **Bluefy** for Bluetooth (Live → Connect). Wi-Fi
  passwords, the sheet link and the track store key are only ever sent to the T3 over Bluetooth.
- **Relay (Safari or any browser):** with the T3 on your hotspot, it sends live numbers once a second through the
  free public broker `broker.emqx.io`, **encrypted** with a key made from your sheet key (AES-256-GCM), on a
  channel named from a hash of that key. Heep's commands back (screens, settings without secrets, trip
  controls) are **signed** (HMAC-SHA256 with your sheet key, with a time stamp the T3 checks), so nobody else
  can control the T3. Uses about 1–2 MB of cell data an hour. Turn off with "Live over Wi-Fi".
- "Networks nearby" in Diagnostics is what the T3's last scan saw (with signal strength). The T3 can't see how
  many devices are on your hotspot.

## 10. Everything you can set from Heep

**Live → T3 settings:** Wi-Fi networks · Live over Wi-Fi on/off · track storage · speed source (Auto / iCar / GPS) ·
trust heading above (km/h) · 8 or 16 compass points · keep last heading when stopped · °C/°F · probe correction ·
GPIO 4 = probe or push button · fuel correction % · distance correction % · trip ends after parking for ·
log a row every (driving / parked) · write to card every · make room when over % · time zone · GPS baud · iCar name ·
Send settings · Try Wi-Fi and update now · Put T3 settings back to new.

**Live → Screens:** up to 12 screens, each on/off, in any order; per screen up to 10 widgets:
value (label + number in size 1–4, auto-shrinks), row (label left, value right), bar (from/to), text, line;
position and size in T3 pixels; label/unit/box/inverted; any of 46 values (`firmware/T3/fields.h`).
Templates: blank, boost gauge, temperature & direction, one big number, two big numbers, list of six.
Preview with live numbers when connected. Send to T3 (it confirms with a fingerprint), Load from T3,
default screens. **Buttons:** press and hold action for each wheel button.
**Display:** key-on screen, screen off after, brightness, night hours and night brightness, redraw rate, upside-down mounting.

**Map:** track storage setup, named places (Home, the shop...).

Settings are kept in the T3's flash and survive restarts and updates. Anything out of range is put back to a
safe value; a broken or missing screen file falls back to the built-in screens.

## 11. Map & Trip History (Heep only)

- **Where tracks come from:** the T3 uploads each finished trip's CSV to your **track store**, a small Apps
  Script in your own Google Drive (`tracks/TrackStore.gs`), separate from the Jeep log sheet's script.
  Set it up once: Map → Set up track storage (Heep puts a fresh key into the script for you), then
  T3 settings → Send settings over Bluetooth. Tracks go up 100 rows per request; a trip only counts as uploaded
  when the store confirms every row. Files: Drive folder "Jeep tracks", one CSV per trip + `index.json`.
- **What the page shows:** trip list (month filter, newest/oldest/longest/coldest), start → end (named places or
  coordinates), distance, time, top speed, temperature range. A trip: the recorded track in unbroken pieces
  coloured by speed or temperature (or plain), start/end markers, hollow dots where the GPS lost and regained the
  signal (**no line is ever drawn across a gap**), likely stops (under 3 km/h for 2+ minutes within 60 m), marks
  from the wheel button, replay with speed control, tap the map for the nearest recorded point, speed/temperature/
  boost charts (scrubbing moves the marker), CSV download, delete from the store, the Jeep's live or last known position.
- **Honesty rules in the code:** the original track is never altered (drawing uses a simplified copy; numbers
  use every point); nothing is snapped to roads; times worked out from the T3's own clock before it knew the real
  time are marked "approx."; a trip with no clock at all shows no times rather than made-up ones.
- **Map pictures:** OpenStreetMap tiles, need signal. With no signal the track still draws on a grid. Your tracks
  are never sent to the map service; only tile requests (which reveal the area you're looking at) go there.
  Leaflet 1.9.4 (BSD-2) is included in the app (`vendor/leaflet/`) so the page works offline.
- Until track storage is set up, the page shows three made-up sample trips, labelled Sample.

## 12. Building and flashing over USB

**T3 (easiest, no tools):** PC, Chrome or Edge → https://bennydedado.github.io/jeep/firmware/ → Install → pick the
T3's COM port. If it sits on "Connecting", hold BOOT (IO0) while clicking Install. Driver: WCH CH343SER.

**T3 from source:** see `firmware/README.md` (Arduino IDE or arduino-cli, ESP32 core 3.3.12, board "ESP32 Dev
Module", Partition Scheme "Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)", libraries NimBLE-Arduino 2.5.2,
Adafruit SSD1306 2.5.17, Adafruit GFX 1.13.0, Adafruit BusIO, PubSubClient 2.8, OneWire 2.3.8).

**Nano:** Arduino IDE, board "Arduino Nano", processor "ATmega328P" (or "(Old Bootloader)" if upload fails).
Open your own sketch with the T3Link additions and upload as usual.

## 13. Over-the-air (OTA) updates

- Already part of the T3 since 1.3: GitHub Actions builds the T3 whenever `firmware/T3/` changes and publishes
  `firmware/T3.bin` + `t3.json`. The T3 checks about 20 s after key-on and every 6 h, only installs a **newer**
  version, and only while the Jeep is stopped.
- **New in 2.0 – automatic rollback:** a new program must run for 20 s before it's kept. If it crashes or
  restarts before that, the ESP32 goes back to the previous program by itself. A version that fails that way 3 times
  isn't fetched again (a key-off in those 20 s counts as one failure, so a single power cut doesn't block a version).
- **New in 2.1 – update over Bluetooth:** Live > Wi-Fi & update > "Update over Bluetooth" (Heep in Bluefy, connected by
  Bluetooth). The phone downloads the program from GitHub and sends it to the T3; about 2-4 minutes; same checks and rollback.
  Use it when the T3 can't get onto Wi-Fi. A T3 still on 1.5 or 2.0 can't do this yet: it needs one update by Wi-Fi or USB first.
- **Live > Wi-Fi & update** also shows what Wi-Fi the T3 is on, what it can see, and why one of yours won't join.
- Not tested on the device yet: the first OTA from 1.5 to 2.0 will be the first real test (1.5 does the
  download; 2.0's rollback protection applies from then on).

## 14. Getting back to the previous firmware

1. If 2.0 won't start properly, the rollback above should return to 1.5 on its own within a couple of restarts.
2. By hand: the 1.5 build is in git history. In GitHub, `firmware/T3.bin`, `bootloader.bin`, `partitions.bin`,
   `boot_app0.bin` and `manifest.json` at commit `792a80f` are 1.5. Restore those files (or ask Claude to), wait for
   Pages to update, then use the USB install page. Or in Arduino IDE open `firmware/T3/T3.ino` from that commit.
3. A USB install always works, whatever state the T3 is in (hold BOOT if needed).
Note: the T3 never installs an *older* version by itself, so after a manual downgrade, bump `FW` in config.h for the fixed version.

## 15. Connecting the app and checking telemetry

1. Key on. T3 shows its key-on screen within ~2 s.
2. Bluefy → Heep → Live → Connect → Jeep T3. Chips at the top show Bluetooth, GPS, temp probe, wheel link, SD, iCar.
3. T3 settings → add Wi-Fi → Send settings. Map → Set up track storage → T3 settings → Send settings again.
4. Live → Diagnostics: every part with its state and counters (updates every 2 s; says when it's stale).
5. Numbers older than 3 s are greyed out with "No new numbers for N s".

## 16. Troubleshooting

| Symptom (Diagnostics) | Likely cause / what to check |
|---|---|
| GPS "No data from the GPS" | No power (3V3/GND), or TX not on GPIO 34. Measure 3.3 V at the module. |
| GPS "Data, but not GPS sentences" | Wrong baud being forced: set GPS speed to "Find it by itself". Bytes but bad checksums: loose wire or noise. |
| GPS "Searching" for >5 min | No sky view (under metal), or indoors. Check satellites in view; under 4 used = no 3D fix. |
| HDOP over 5 | Poor geometry/obstructions: positions are kept but not used for distance. |
| Temp "Not found" | Pull-up missing, data on the wrong pin, red/black swapped (probe gets warm!), or GPIO 4 set to push button. |
| Temp errors climbing | Long unshielded run next to injector/alternator wiring, weak pull-up: try 2.2 kΩ. |
| Wheel "Never heard it" | Divider wiring, no common ground, T3Link not added to the Nano, or Nano TX on the wrong pin. "bad" counting up: noise or loose joint. |
| Wheel ok but buttons do nothing | Calibrate the ladder windows; check "Last button" changes when you press. |
| SD "No card" | FAT32? Card fully inserted? Try another card. "write failed": card worn or removed. |
| Wi-Fi "none of yours in range" | Hotspot off, 5 GHz only (turn on Maximize Compatibility), name typed differently. |
| Wi-Fi "couldn't join" | Password. |
| Trips "sheet key wrong" | Re-send T3 settings from the phone connected to the right Jeep log. |
| Tracks "track store key wrong" | Re-do Map → Track storage, then Send settings over Bluetooth. |
| Program "update failed" / "failed before" | The next GitHub build will be fetched when it's newer; USB install always works. |
| Free memory under ~30 KB | Report it (Diagnostics screenshot): the upload is the hungriest part. |

## 17. Repository, versions, changes

- Repository: https://github.com/Bennydedado/jeep — app at the root, `firmware/T3/` (T3), `nano/` (Nano add-on),
  `tracks/TrackStore.gs` (track store), `tests/` (PC tests), `docs/` (this guide), `AGENTS.md` (how the code is laid out for anyone, or any AI, changing it).
- Versions: T3 firmware **2.0** (protocol 2), Heep **1.1.0**, Nano link protocol **1**.
- Test status (27 Oct 2026): T3 compiles (ESP32 core 3.3.12, 1,534,984 bytes = 78% of the app slot; 1.5 was 98%);
  Nano example compiles (4.4 KB); PC tests pass for GPS parsing, Nano link (incl. a simulated ladder through
  to the T3 parser), screen format (app and T3 agree byte for byte), trip statistics, track store, relay crypto,
  and a headless-browser run through every tab. **Nothing has run on the real T3, GPS, probe or Nano yet.**
- Change log: see `CHANGELOG.md`.

## 18. Installation checklist and first test

**Before power**

- [ ] T3 silkscreen says V1.6.1; GPIO 34, 39 (or 36), 4, 3V3, GND located on the headers
- [ ] GPS: VCC→3V3, GND, TX→34 (by the pad labels)
- [ ] Probe: red→3V3, black→GND, yellow→4, 4.7 kΩ 4↔3V3
- [ ] Nano D1 → 10 kΩ → 39; 39 → 20 kΩ → GND; grounds joined. Measure: Nano idle TX gives ~3.3 V at 39
- [ ] Nothing on GPIO 16/17/12; no 5 V on any T3 GPIO
- [ ] FAT32 card in the slot
- [ ] T3 installed by USB with 2.0 (or let 1.5 update itself over Wi-Fi once pushed)

**First key-on (parked, outside)**

- [ ] T3 shows "Temp & dir": temperature appears within 2–3 s
- [ ] Nano: stereo, pedal and headlights work as before (also with the T3 unplugged!)
- [ ] Heep → Connect → chips; Diagnostics: GPS bytes increasing, sentences good, baud found
- [ ] Within a few minutes: GPS 3D fix, 6+ satellites, HDOP under 2
- [ ] Each wheel button: Diagnostics "Last button" changes; screens change
- [ ] SD: "Logging", rows increasing
- [ ] Wi-Fi: joins the hotspot; Live works in Safari (relay)

**First drive**

- [ ] Heading shows live above 5 km/h, brackets when stopped
- [ ] Speed matches the speedometer (or GPS); distance roughly matches the odometer
- [ ] Mark a spot with button 2; end the trip with a long press on button 3
- [ ] At home/hotspot: trip arrives in the Jeep log; track appears on the Map page with the mark
