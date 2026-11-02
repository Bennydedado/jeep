#include "../../firmware/T3/obdmatch.h"
#include "check.h"

int main() {
  CHECK(obdNameMatches("Vgate iCar Pro BLE", ""));
  CHECK(obdNameMatches("IOS-VLinker", ""));
  CHECK(obdNameMatches("MY-ELM327", ""));
  CHECK(!obdNameMatches("Jeep T3", ""));
  CHECK(obdNameStartsWith("JEEP T3", "jeep"));
  CHECK(!obdNameMatches("", ""));
  CHECK(obdNameMatches("Vgate iCar Pro BLE", "icar pro"));
  CHECK(!obdNameMatches("Vgate iCar Pro BLE", "different adapter"));
  CHECK(obdNameMatches("Adapter 42", "adapter"));
  CHECK(!obdNameMatches("Adapter 42", ""));
  DONE();
}
