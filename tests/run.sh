#!/bin/bash
# tests/run.sh - every test that runs without hardware. From the repo root: bash tests/run.sh
# Needs g++ and node. The browser smoke test also needs Playwright + Chromium (skipped if missing).
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d)
for t in nmea jlink screens otarx obdpid; do g++ -std=c++17 -Wall -O1 -o $T/t_$t tests/firmware/test_$t.cpp && $T/t_$t; done
g++ -std=c++17 -Wall -O1 -I tests/firmware/mock -o $T/t_nano tests/firmware/test_nano_link.cpp && $T/t_nano
for t in tests/app/test_*.js; do node $t; done
g++ -std=c++17 -Wall -O1 -o $T/scrtool tests/firmware/scrtool.cpp
if node -e "require('playwright')" 2>/dev/null; then
  SHOTS=$T/shots node tests/app/smoke.js
  SHOTS=$T/shots node tests/app/editor.js $T/scrtool   # the screen editor against a pretend T3 using the firmware's own parser
  SHOTS=$T/shots node tests/app/wifi_ota.js            # Wi-Fi page and update over Bluetooth against a pretend T3
  node tests/app/usb_install.js                         # the step-by-step USB installer page (firmware/usb.html)
  SHOTS=$T/shots node tests/app/relay_live.js          # Safari: live numbers and Update over Wi-Fi through the relay
  SHOTS=$T/shots node tests/app/obd_scan.js            # Diagnostics > Scan the Jeep: protocols, computers, values, Use this one
else echo "smoke.js, editor.js and wifi_ota.js skipped (no Playwright)"; fi
echo "ALL PASSED"
