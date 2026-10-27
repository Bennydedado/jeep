// temp.ino - the outdoor DS18B20 probe at the grille (3 wires: red 3.3 V, black GND, yellow data -> GPIO 4,
// with a 4.7 kOhm resistor from data to 3.3 V). Read every 2 s without waiting: start a conversion, come back
// 800 ms later for the answer. A reading only counts if its CRC is right and it's a believable temperature.

OneWire* ow = nullptr;
static uint8_t owRom[8];
static bool owFound = false;
static uint32_t owAskedAt = 0, owNextAt = 0, owSearchAt = 0;
static bool owAsked = false, owFirst = true;

void tempBegin() {
  if (ow) { delete ow; ow = nullptr; }
  owFound = false; owAsked = false; owFirst = true;
  otemp = Temp();
  if (cfg.io4 != 0) { pinMode(ONEWIRE_PIN, INPUT_PULLUP); return; }   // GPIO 4 is the old push button instead
  ow = new OneWire(ONEWIRE_PIN);
  owSearchAt = 0;
}

static bool tempFind() {
  ow->reset_search();
  uint8_t a[8];
  while (ow->search(a)) {
    if (OneWire::crc8(a, 7) != a[7]) continue;
    if (a[0] != 0x28 && a[0] != 0x10 && a[0] != 0x22) continue;   // DS18B20, DS18S20, DS1822
    memcpy(owRom, a, 8);
    for (int i = 0; i < 8; i++) sprintf(otemp.rom + 2 * i, "%02X", a[i]);
    return true;
  }
  return false;
}

void tempStep() {
  if (!ow) return;
  uint32_t now = millis();
  if (!owFound) {
    if (owSearchAt && now - owSearchAt < 10000) return;   // look again every 10 s (probe unplugged, not wired yet)
    owSearchAt = now;
    owFound = tempFind();
    if (!owFound) { otemp.state = 0; otemp.c = NAN; return; }
  }
  if (!owAsked) {
    if (now < owNextAt) return;
    if (!ow->reset()) { tempFail(); return; }
    ow->select(owRom);
    ow->write(0x44);   // convert (12-bit: up to 750 ms)
    owAsked = true; owAskedAt = now;
    return;
  }
  if (now - owAskedAt < 800) return;
  owAsked = false; owNextAt = now + 1200;
  uint8_t d[9];
  if (!ow->reset()) { tempFail(); return; }
  ow->select(owRom);
  ow->write(0xBE);   // read scratchpad
  for (int i = 0; i < 9; i++) d[i] = ow->read();
  if (OneWire::crc8(d, 8) != d[8]) { tempFail(); return; }
  int16_t raw = (d[1] << 8) | d[0];
  float c = owRom[0] == 0x10 ? raw * 0.5f : raw / 16.0f;
  // 85.0 is what a DS18B20 says before its first conversion: never trust it as the first reading
  if (owFirst && raw == 0x0550) { owFirst = false; return; }
  owFirst = false;
  if (c < -55 || c > 125) { tempFail(); return; }
  otemp.c = c + cfg.tempOff;
  otemp.at = now;
  otemp.state = 1;
}

void tempFail() {
  otemp.errors++;
  otemp.state = 2;
  // three failures in a row: look for the probe again (it may have been unplugged and replaced)
  if (millis() - otemp.at > 6000) { owFound = false; owSearchAt = millis(); }
  owNextAt = millis() + 2000;
}

bool tempFresh() { return otemp.state == 1 && !isnan(otemp.c) && millis() - otemp.at < 10000; }
float tempShown() { return cfg.tempF ? otemp.c * 9 / 5 + 32 : otemp.c; }
