#!/bin/bash
# tests/run.sh - every test that runs without hardware. From the repo root: bash tests/run.sh
# Needs g++ and node. The browser smoke test also needs Playwright + Chromium (skipped if missing).
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d)
for t in nmea jlink wheelmap sun screens otarx obdpid obdmatch; do g++ -std=c++17 -Wall -O1 -o $T/t_$t tests/firmware/test_$t.cpp && $T/t_$t; done
# The storage routines run on the T3's 8 KB loop stack, including when called over Wi-Fi.
# Catch the old 5 KB temporary array as a compile failure, not just a hardware restart.
g++ -std=c++17 -Wall -O1 -Werror=frame-larger-than=2048 -o $T/t_screenstore tests/firmware/test_screenstore.cpp
$T/t_screenstore
g++ -std=c++17 -Wall -O1 -I tests/firmware/mock -o $T/t_nano tests/firmware/test_nano_link.cpp && $T/t_nano
# The default screens drawn with the T3's own drawing code and the real Adafruit GFX library (the one the T3 is built
# with): nothing spills out of its box. Needs the library installed (arduino-cli lib install "Adafruit GFX Library").
G=$(dirname "$(find "${GFX_DIR:-/nonexistent}" "$(arduino-cli config get directories.user 2>/dev/null)/libraries" ~/Arduino/libraries \
      -maxdepth 2 -name Adafruit_GFX.cpp 2>/dev/null | head -1)")
if [ -f "$G/Adafruit_GFX.cpp" ]; then
  g++ -std=c++17 -Wall -O1 -DARDUINO=200 -I tests/firmware/gfxmock -I "$G" -o $T/t_draw tests/firmware/test_draw.cpp "$G/Adafruit_GFX.cpp"
  node -e "const A=require('./t3screens.js');const s=new Set();A.SCREEN_TEMPLATES.forEach(t=>s.add(t[1]));A.SETUPS.forEach(u=>u.list().forEach(x=>s.add(x)));console.log([...s].filter(x=>x.split('|').length>2).join('\\n'))" > $T/more_screens.txt
  $T/t_draw - $T/more_screens.txt
elif [ -n "$CI" ]; then echo "test_draw: Adafruit GFX library not found"; exit 1
else echo "test_draw skipped (Adafruit GFX library not found; set GFX_DIR to its folder)"; fi
for t in tests/app/test_*.js; do node $t; done
g++ -std=c++17 -Wall -O1 -o $T/scrtool tests/firmware/scrtool.cpp
if node -e "require('playwright')" 2>/dev/null; then
  SHOTS=$T/shots node tests/app/smoke.js
  SHOTS=$T/shots node tests/app/editor.js $T/scrtool   # the screen editor against a pretend T3 using the firmware's own parser
  SHOTS=$T/shots node tests/app/wifi_ota.js            # Wi-Fi page and update over Bluetooth against a pretend T3
  SHOTS=$T/shots node tests/app/wifi_update.js         # Update over Wi-Fi from a fresh start (T3 2.8+): reconnects, or shows why not
  node tests/app/usb_install.js                         # the step-by-step USB installer page (firmware/usb.html)
  SHOTS=$T/shots node tests/app/relay_live.js          # Safari: live numbers and Update over Wi-Fi through the relay
  SHOTS=$T/shots node tests/app/obd_scan.js            # Diagnostics > Scan the Jeep: protocols, computers, values, Use this one
  SHOTS=$T/shots node tests/app/codes_trips.js         # Trouble codes, Driving totals, a trip's breakdown, Live in Safari
  SHOTS=$T/shots node tests/app/overview.js            # Overview economy from the T3 + tanks, Distance to empty, the tank level sent to the T3
  node tests/app/trackstore_paste.js                    # Track storage: paste link|key from another browser, Copy link and key
  SHOTS=$T/shots node tests/app/heat_map.js            # Trips: every trip at once, brighter where they overlap
else echo "smoke.js, editor.js and wifi_ota.js skipped (no Playwright)"; fi
echo "ALL PASSED"
