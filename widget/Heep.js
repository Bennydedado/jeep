// Heep - the Jeep on your iPhone's Home Screen, Today View and Lock Screen (for the free Scriptable app).
// Paste this into a new Scriptable script named "Heep". Heep (the web app) has the steps: Settings > iPhone widget.
// It gets the newest widget from GitHub each time (and keeps a copy for when there's no signal), then runs it.
// Nothing private is in here: your Jeep log link is asked for once and kept in Scriptable's Keychain.
const URL = 'https://bennydedado.github.io/jeep/widget/heep-widget.js';
const fm = FileManager.local();
const path = fm.joinPath(fm.libraryDirectory(), 'heep-widget-module.js');   // out of sight (not in your Scripts list)
try {
  const r = new Request(URL + '?t=' + Math.floor(Date.now() / 600000));
  r.timeoutInterval = 8;
  const code = await r.loadString();
  if (r.response.statusCode === 200 && code.includes('HEEP_WIDGET')) fm.writeString(path, code);
} catch (e) { /* no signal: the copy from last time */ }
if (!fm.fileExists(path)) throw new Error('The Heep widget needs signal the first time, to download itself.');
await importModule(path).run();
