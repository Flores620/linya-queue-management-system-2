#include <Keyboard.h>

const byte BUTTON_PINS[] = {2, 3, 4, 5};
const char SHORTCUT_KEYS[] = {'n', 'b', 'p', 'o'};
const byte BUTTON_COUNT = sizeof(BUTTON_PINS) / sizeof(BUTTON_PINS[0]);
const unsigned long DEBOUNCE_MS = 35;

bool lastReadings[BUTTON_COUNT] = {HIGH, HIGH, HIGH, HIGH};
bool buttonStates[BUTTON_COUNT] = {HIGH, HIGH, HIGH, HIGH};
unsigned long lastDebounceTimes[BUTTON_COUNT] = {0, 0, 0, 0};

void sendShortcut(char key) {
  Keyboard.press(KEY_LEFT_CTRL);
  Keyboard.press(KEY_LEFT_ALT);
  Keyboard.press(KEY_LEFT_SHIFT);
  Keyboard.press(key);
  delay(25);
  Keyboard.releaseAll();
}

void setup() {
  for (byte i = 0; i < BUTTON_COUNT; i++) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  }

  Keyboard.begin();
}

void loop() {
  const unsigned long now = millis();

  for (byte i = 0; i < BUTTON_COUNT; i++) {
    const bool reading = digitalRead(BUTTON_PINS[i]);

    if (reading != lastReadings[i]) {
      lastDebounceTimes[i] = now;
      lastReadings[i] = reading;
    }

    if (now - lastDebounceTimes[i] >= DEBOUNCE_MS && reading != buttonStates[i]) {
      buttonStates[i] = reading;
      if (buttonStates[i] == LOW) {
        sendShortcut(SHORTCUT_KEYS[i]);
      }
    }
  }
}
