# T3 update bridge to Heep Life

The website stays at https://heeplife.ca. Old firmware still asks https://bennydedado.github.io/jeep/firmware/t3.json. That static manifest advertises the already-built 2.33 migration firmware at https://heeplife.ca/firmware/T3.bin, without an HTTP redirect. Older firmware can therefore read it normally.

The 2.33 program itself uses https://heeplife.ca/firmware/t3.json for subsequent manual updates. The old GitHub address remains a compatibility bridge, so a T3 that has been offline can migrate later. The GitHub build workflow no longer overwrites firmware manifests or publishes binaries.

## Install over Wi-Fi

1. Park the Jeep and keep steady power on the T3. Have one of its saved Wi-Fi networks in reach.
2. Open Heep on https://heeplife.ca, connect to the T3, and use Live → Wi-Fi & update → Update over Wi-Fi.
3. Keep power on through the download and restart. Check that On the T3 reports 2.33.
4. Future requested Wi-Fi updates go directly to Heep Life. No USB is needed for this migration if the existing Wi-Fi update succeeds.

This publication does not remotely start an update. No settings, keys, logs or SD data are erased. The actual hardware installation must be confirmed on the Jeep.

## Verified migration build

- Version: 2.33
- Board: LilyGo T3 V1.6.1, ESP32-PICO-D4
- Partition layout: Minimal SPIFFS, unchanged (application starts at 0x10000)
- Binary size: 1663840 bytes
- SHA-256: 676ff7c952517a63cbb027e2025421559dd46a6e794f2abc11581903a6fbb01c
- Download: https://heeplife.ca/firmware/T3.bin

The firmware source matches the prior 2.32 source except for config.h (version and update address) and update.ino (update-server wording). It was built locally with the pinned ESP32 core/libraries, tested and published on Heep Life before this GitHub bridge. Do not relabel a different binary as this version. Future builds and releases must be verified and published on Heep Life; keep the compatibility manifest for legacy devices valid.
