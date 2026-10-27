// mock/Arduino.h - just enough "Arduino" to run the Nano's T3Link.h and WheelButtons.h on a PC.
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string>
static unsigned long mockMillis = 0;
static int mockAnalog = 1023;
inline unsigned long millis() { return mockMillis; }
inline int analogRead(uint8_t) { return mockAnalog; }
inline int digitalRead(uint8_t) { return 1; }
inline void pinMode(uint8_t, uint8_t) {}
#define INPUT_PULLUP 2
#define LOW 0
struct HardwareSerial {
  std::string out; int room = 64;
  int availableForWrite() { return room; }
  size_t write(const uint8_t* b, size_t n) { out.append((const char*)b, n); return n; }
};
