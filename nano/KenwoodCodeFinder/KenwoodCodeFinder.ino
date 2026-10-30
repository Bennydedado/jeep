// KenwoodCodeFinder.ino - step through the Kenwood remote codes (NEC, address 0xB9) one at a time, by hand,
// to find the ones nobody knows yet (answer call, hang up, band...). For a laptop on the Nano's USB.
//
// The easier way is in Heep (Live > Screens > Nano > Find stereo codes): it needs jeep_controller_v3 and the
// T3, and keeps your notes. This sketch is for when you'd rather use a laptop, or the T3 isn't wired yet.
//
// Upload it to the Nano on your board (it uses the same D3 -> Q1 -> stereo remote wire), open Tools > Serial
// Monitor at 115200 baud with "Newline" selected, key on, stereo on. Then type:
//   (just Enter)  send the next code          b   go back one and send it
//   r             send the same code again     8A  jump to code 8A and send it (any 2 hex digits)
// Or press the foot pedal (D5) for "next" without touching the laptop.
// Every code it sends is printed, with the name if it's already known. Write down what the stereo does.
// Some codes turn the stereo off or change the source: that's fine, just put it back.
//
// While this sketch runs the headlights are stock (the fail-safe relay stays off). Put jeep_controller_v3 back
// on when you're done.

const int KW_OUT = 3, PEDAL = 5, RELAY_K1 = 4, FAILSAFE = A1;
const bool FAILSAFE_ACTIVE_LOW = false;   // same as in jeep_controller_v3
const byte KW_ADDR = 0xB9;

int code = 0x0F;   // starts after the codes everyone knows

const char* knownName(byte c) {
  switch (c) {
    case 0x0A: return "track -";  case 0x0B: return "track +";  case 0x0C: return "rewind";   case 0x0D: return "fast forward";
    case 0x0E: return "play/pause"; case 0x13: return "source"; case 0x14: return "volume +"; case 0x15: return "volume -";
    case 0x16: return "mute";     case 0x1C: return "tuner";    case 0x1D: return "tape";     case 0x1E: return "cd";
    case 0x1F: return "cd-md-ch"; case 0x5E: return "dnpp";     case 0x8B: return "Siri";
    default: return c <= 0x09 ? "number key" : "";
  }
}

void pulse(unsigned int hi, unsigned int lo) { digitalWrite(KW_OUT, HIGH); delayMicroseconds(hi); digitalWrite(KW_OUT, LOW); delayMicroseconds(lo); }
void sendByte(byte d) { for (int i = 0; i < 8; i++) { pulse(562, (d & 1) ? 1687 : 562); d >>= 1; } }
void sendKenwood(byte c) {
  pulse(9000, 4500);
  sendByte(KW_ADDR); sendByte((byte)~KW_ADDR); sendByte(c); sendByte((byte)~c);
  pulse(562, 0);
}

void sendNow() {
  code = (code + 256) % 256;
  sendKenwood((byte)code);
  Serial.print(F("sent 0x"));
  if (code < 0x10) Serial.print('0');
  Serial.print(code, HEX);
  const char* n = knownName(code);
  if (*n) { Serial.print(F("   (known: ")); Serial.print(n); Serial.print(')'); }
  Serial.println(F("   <- what did the stereo do?"));
}

int hexv(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; }

void setup() {
  digitalWrite(FAILSAFE, FAILSAFE_ACTIVE_LOW ? HIGH : LOW);   // fail-safe relay off: stalk wired straight through
  pinMode(FAILSAFE, OUTPUT);
  pinMode(RELAY_K1, OUTPUT); digitalWrite(RELAY_K1, LOW);
  pinMode(KW_OUT, OUTPUT); digitalWrite(KW_OUT, LOW);
  pinMode(PEDAL, INPUT_PULLUP);
  Serial.begin(115200);
  Serial.println(F("Kenwood code finder. Enter = next, b = back, r = again, or type 2 hex digits. Pedal = next."));
  Serial.print(F("Next code: 0x")); Serial.println(code, HEX);
}

char line[8];
byte len = 0;
bool pedalWas = false;
unsigned long pedalAt = 0;

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (len < sizeof(line) - 1) line[len++] = c; continue; }
    line[len] = 0;
    if (len == 0) { code++; sendNow(); }
    else if (len == 1 && (line[0] == 'b' || line[0] == 'B')) { code--; sendNow(); }
    else if (len == 1 && (line[0] == 'r' || line[0] == 'R')) sendNow();
    else if (len == 2 && hexv(line[0]) >= 0 && hexv(line[1]) >= 0) { code = hexv(line[0]) * 16 + hexv(line[1]); sendNow(); }
    else Serial.println(F("? Enter = next, b = back, r = again, or 2 hex digits like 8A"));
    len = 0;
  }
  bool down = digitalRead(PEDAL) == LOW;
  if (down && !pedalWas && millis() - pedalAt > 300) { pedalAt = millis(); code++; sendNow(); }
  pedalWas = down;
}
