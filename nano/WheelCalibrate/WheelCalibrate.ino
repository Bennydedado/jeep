// WheelCalibrate.ino - find the number each steering wheel button gives on the Nano's analog pin.
//
// Upload this on its own (it doesn't drive anything), open Serial Monitor at 115200, press and hold each
// button in turn. Write down the "steady" number for each, then in NanoT3Example set each button's window
// to roughly halfway to its neighbours. Example: buttons at 40, 240, 520 and idle at 1023 ->
// windows {0,140} {141,380} {381,770}.
//
// Pull-up: A6 and A7 have no internal pull-up, so fit a resistor from the pin to 5 V. If the wheel's
// resistors are unknown, start with 1 kOhm; if all buttons read close together, try 470 Ohm or 2.2 kOhm.
// If you use A0-A5 instead you can test with the internal pull-up (set USE_INTERNAL_PULLUP to true),
// but it's weak (about 35 kOhm) so a real resistor gives cleaner numbers.

const uint8_t PIN = A6;
const bool USE_INTERNAL_PULLUP = false;

void setup() {
  Serial.begin(115200);
  if (USE_INTERNAL_PULLUP) pinMode(PIN, INPUT_PULLUP);
  Serial.println(F("Press and hold one wheel button at a time."));
}

void loop() {
  static int last = -100, stable = 0;
  static unsigned long since = 0;
  int v = analogRead(PIN);
  if (abs(v - last) > 6) { last = v; since = millis(); stable = 0; }
  else if (!stable && millis() - since > 300) {
    stable = 1;
    Serial.print(F("steady: ")); Serial.print(v);
    Serial.println(v > 1000 ? F("   (nothing pressed)") : F(""));
  }
  delay(5);
}
