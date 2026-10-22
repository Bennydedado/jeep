# Jeep

A Home Screen web app for a 2006 Jeep Liberty CRD: log fill-ups at the pump, see fuel economy, costs and
service reminders, and watch live engine data from the T3 over Bluetooth.

It saves to a Google Sheet through an Apps Script web app, keeps working with no signal, and syncs when
it can. Nothing personal lives in this repository; the app is connected to a sheet with a private setup
link. The Bluetooth messages are in [T3.md](T3.md).

## Listening

[listen/](listen/) is a second, separate Home Screen app: listening stats summed up by the Hub on the PC, which
sends a summary to the same sheet every half hour. It has its own name, icon, manifest and offline copy, and
each app's service worker leaves the other's pages alone.
