#!/bin/bash
# tests/run.sh - every test that runs without hardware. From the repo root: bash tests/run.sh
# Needs g++ and node. The browser smoke test also needs Playwright + Chromium (skipped if missing).
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d)
for t in nmea jlink screens; do g++ -std=c++17 -Wall -O1 -o $T/t_$t tests/firmware/test_$t.cpp && $T/t_$t; done
g++ -std=c++17 -Wall -O1 -I tests/firmware/mock -o $T/t_nano tests/firmware/test_nano_link.cpp && $T/t_nano
for t in tests/app/test_*.js; do node $t; done
if node -e "require('playwright')" 2>/dev/null; then SHOTS=$T/shots node tests/app/smoke.js; else echo "smoke.js skipped (no Playwright)"; fi
echo "ALL PASSED"
