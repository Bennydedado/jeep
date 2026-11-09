# Jeep

**The website and firmware hosting have moved to [Heep Life](https://heeplife.ca).**

For a T3 still on 2.31 or 2.32, use Heep Life → Live → Wi-Fi & update → Update over Wi-Fi, while parked with steady power and a saved Wi-Fi network in reach. The old GitHub update address now offers the verified 2.33 firmware from Heep Life. Once installed, the T3 checks Heep Life directly for future updates, only when you request them. Confirm that the T3 reports 2.33 after it restarts.

GitHub remains a source/checks repository and a compatibility update address. It does not publish or change the private Heep Life website. The migration changes no hardware pins, partitions, stored Wi-Fi networks or log/track credentials. See [firmware/MIGRATION.md](firmware/MIGRATION.md).

**Heep**, a Home Screen web app for a 2006 Jeep Liberty CRD: log fill-ups at the pump, see fuel economy, costs and
service reminders, watch live engine, GPS and outside-temperature data from the T3, design the T3's screens, and
look back at every drive on the **Trips** tab (Map & Trip History).

It saves to a Google Sheet through an Apps Script web app, keeps working with no signal, and syncs when it can.
Nothing personal lives in this repository; the app is connected to a sheet with a private setup link.

- **The T3** (LilyGo T3 V1.6.1 in the Jeep): `firmware/` — reads the iCar OBD adapter, the M100 GPS and the outdoor
  probe, takes the steering wheel buttons from the Nano, logs to its SD card, uploads over Wi-Fi, updates itself.
- **The Nano** add-on for the wheel buttons: `nano/`.
- **Track store** for GPS tracks in your own Drive: `tracks/TrackStore.gs`.
- Wiring and setup: [docs/HARDWARE.md](docs/HARDWARE.md). Messages between Heep and the T3: [T3.md](T3.md).
- Changing anything (people or AI): start with [AGENTS.md](AGENTS.md). Tests: `bash tests/run.sh`.

## Listening

[listen/](listen/) is a second, separate Home Screen app: listening stats summed up by the Hub on the PC, which
sends a summary to the same sheet every half hour. It has its own name, icon, manifest and offline copy, and
each app's service worker leaves the other's pages alone.
