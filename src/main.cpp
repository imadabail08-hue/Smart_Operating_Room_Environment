/*
 * ============================================================================
 * PROJET 10 - SMART OPERATING ROOM ENVIRONMENT
 * Firmware ESP32 v1.2.1
 * ============================================================================
 *
 * CAPTEURS ET ACTIONNEURS
 *   BME280       : SDA GPIO 21 / SCL GPIO 22
 *   DHT22        : GPIO 4 (si SENSOR_BME280 = 0)
 *   LDR          : GPIO 34
 *   LED alerte   : GPIO 32
 *   Servo SG90   : GPIO 25
 *   Buzzer actif : GPIO 33
 *   Ultrason     : TRIG GPIO 14 / ECHO GPIO 35
 *
 * COMMUNICATION
 *   Wi-Fi + MQTT + HTTP Webhook
 *   JSON sur le port série à 115200 bauds
 *
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <ESP32Servo.h>
#include <time.h>
#include <math.h>

// ============================================================================
// 1. OPTIONS DU PROJET
// ============================================================================

#define FW_VERSION              "1.2.1"
#define DEVICE_ID               "esp32-or1"

#define WOKWI_SIM               0
#define SENSOR_BME280           1
#define BUZZER_ACTIVE           1
#define DOOR_SENSOR_ULTRASONIC  1
#define USE_HTTP_FALLBACK       1

#if SENSOR_BME280
  #include <Wire.h>
  #include <Adafruit_Sensor.h>
  #include <Adafruit_BME280.h>
#else
  #include <DHT.h>
#endif

// ============================================================================
// 2. CONFIGURATION WI-FI
// ============================================================================

#if WOKWI_SIM

static const char* WIFI_SSID = "Wokwi-GUEST";
static const char* WIFI_PASS = "";
static const int WIFI_CHANNEL = 6;
static const bool LDR_INVERTED = true;

#else

static const char* WIFI_SSID = "0000";
static const char* WIFI_PASS = "88888888";
static const int WIFI_CHANNEL = 0;
static const bool LDR_INVERTED = false;

#endif

// ============================================================================
// 3. CONFIGURATION MQTT ET HTTP
// ============================================================================

static const char* MQTT_HOST = "broker.hivemq.com";
static const uint16_t MQTT_PORT = 1883;

#define MQTT_BASE       "sor-p10/bloc-or1"
#define TOPIC_TELEMETRY MQTT_BASE "/telemetry"
#define TOPIC_ALERT     MQTT_BASE "/alert"
#define TOPIC_EVENT     MQTT_BASE "/event"
#define TOPIC_STATUS    MQTT_BASE "/status"
#define TOPIC_CMD       MQTT_BASE "/cmd"

static const char* HTTP_FALLBACK_URL =
  "https://stg-orch-api.abafusion.ai/webhook/webhook-7d90cffa-c455-42f7-8ce3-d34472da005e/operating-room-telemetry";

// ============================================================================
// 4. CONFIGURATION DES BROCHES
// ============================================================================

static const uint8_t DHT_PIN       = 4;
static const uint8_t I2C_SDA_PIN   = 21;
static const uint8_t I2C_SCL_PIN   = 22;
static const uint8_t LDR_PIN       = 33;
static const uint8_t LED_ALERT_PIN = 32;
static const uint8_t SERVO_PIN     = 25;
static const uint8_t BUZZER_PIN    = 26;

#if DOOR_SENSOR_ULTRASONIC

static const uint8_t TRIG_PIN = 4;
static const uint8_t ECHO_PIN = 5;

static const float DOOR_DIST_THRESHOLD_CM = 15.0f;
static const bool DOOR_OPEN_IF_GREATER = true;

#else

static const uint8_t DOOR_PIN = 27;

#endif

// ============================================================================
// 5. TEMPORISATIONS
// ============================================================================

static const uint32_t SENSOR_INTERVAL_MS      = 2000;
static const uint32_t PUBLISH_INTERVAL_MS     = 2000;
static const uint32_t WIFI_RETRY_MS           = 10000;
static const uint32_t MQTT_RETRY_MS           = 5000;
static const uint32_t DOOR_DEBOUNCE_MS        = 80;
static const uint32_t ULTRASONIC_INTERVAL_MS  = 150;
static const uint32_t FAN_OVERRIDE_TIMEOUT_MS = 600000UL;
static const uint32_t SERVO_STEP_MS           = 15;

// ============================================================================
// 6. SEUILS DE SURVEILLANCE
// ============================================================================

// Température : degrés Celsius
static const float T_HIGH_WARN = 24.0f;
static const float T_HIGH_CRIT = 26.0f;
static const float T_LOW_WARN  = 20.0f;
static const float T_LOW_CRIT  = 18.0f;
static const float T_HYST      = 0.5f;

// Humidité : pourcentage
static const float H_HIGH_WARN = 60.0f;
static const float H_HIGH_CRIT = 70.0f;
static const float H_LOW_WARN  = 30.0f;
static const float H_LOW_CRIT  = 20.0f;
static const float H_HYST      = 2.0f;

// Luminosité
static const float LUX_WARN       = 300.0f;
static const float LUX_CRIT       = 100.0f;
static const float LUX_HYST       = 20.0f;
static const float LUX_FULL_SCALE = 1000.0f;

// Porte
static const uint32_t DOOR_WARN_S = 30;
static const uint32_t DOOR_CRIT_S = 120;

// Commande automatique du servo
static const float FAN_T_ON  = 23.5f;
static const float FAN_T_OFF = 22.5f;
static const float FAN_H_ON  = 55.0f;
static const float FAN_H_OFF = 50.0f;

// Défauts capteur
static const uint8_t DHT_FAIL_WARN = 3;
static const uint8_t DHT_FAIL_CRIT = 10;

// Corrections de mesure
static const float TEMP_OFFSET = 0.0f;
static const float HUM_OFFSET  = 0.0f;

static uint8_t BME_ADDR = 0x76;

// ============================================================================
// 7. CONFIGURATION DU SERVO
// ============================================================================

static const int SERVO_CLOSED_ANGLE = 0;
static const int SERVO_OPEN_ANGLE   = 90;
static const bool SERVO_SWEEP       = true;
static const int SERVO_SWEEP_MIN    = 45;
static const int SERVO_SWEEP_MAX    = 135;
static const int SERVO_STEP_DEG     = 3;

// ============================================================================
// 8. TYPES ET ÉTATS GLOBAUX
// ============================================================================

enum AlertId : uint8_t {
  AL_TEMP_HIGH = 0,
  AL_TEMP_LOW,
  AL_HUM_HIGH,
  AL_HUM_LOW,
  AL_LIGHT_LOW,
  AL_DOOR_OPEN,
  AL_SENSOR_FAULT,
  AL_COUNT
};

static const char* const ALERT_NAMES[AL_COUNT] = {
  "TEMP_HIGH",
  "TEMP_LOW",
  "HUM_HIGH",
  "HUM_LOW",
  "LIGHT_LOW",
  "DOOR_OPEN_LONG",
  "SENSOR_FAULT"
};

static const char* const ALERT_MSG[AL_COUNT] = {
  "Temperature trop elevee dans la salle",
  "Temperature trop basse dans la salle",
  "Humidite trop elevee (risque de contamination)",
  "Humidite trop basse (risque electrostatique)",
  "Luminosite ambiante insuffisante",
  "Porte du bloc ouverte trop longtemps",
  "Defaut de lecture du capteur T/H"
};

static const char* const LEVEL_NAMES[3] = {
  "NORMAL", "WARNING", "CRITICAL"
};

static const char* const LED_NAMES[3] = {
  "off", "blink_slow", "blink_fast"
};

enum FanMode : uint8_t {
  FAN_AUTO = 0,
  FAN_FORCE_ON,
  FAN_FORCE_OFF
};

static const char* const FAN_MODE_NAMES[3] = {
  "auto", "on", "off"
};

// ============================================================================
// 9. OBJETS MATÉRIELS ET VARIABLES
// ============================================================================

#if SENSOR_BME280
Adafruit_BME280 bme;
static bool bmeOk = false;
#else
DHT dht(DHT_PIN, DHT22);
#endif

Servo servo;

static int servoAngle = 0;
static int servoTarget = 0;
static uint32_t lastServoStep = 0;

static float pressure = NAN;
static float temperature = NAN;
static float humidity = NAN;
static float lux = 0.0f;

static uint16_t ldrRawValue = 0;
static bool haveTH = false;
static uint8_t dhtFailCount = 0;

static bool doorRaw = false;
static bool doorOpen = false;
static bool doorChanged = false;

static uint32_t doorRawSince = 0;
static uint32_t doorOpenSince = 0;
static uint32_t lastUltrasonicCheck = 0;

static float doorDistanceCm = 0.0f;

static uint8_t alertLevel[AL_COUNT] = {0};
static uint8_t alertPrev[AL_COUNT] = {0};

static uint8_t globalLevel = 0;
static uint8_t prevGlobalLevel = 0;

static bool fanOn = false;
static FanMode fanMode = FAN_AUTO;
static uint32_t fanOverrideSince = 0;

static bool buzzerMuted = false;
static bool buzzerActive = false;
static bool buzzerHw = false;

static uint32_t lastSensor = 0;
static uint32_t lastPublish = 0;
static uint32_t lastWifiAttempt = 0;
static uint32_t lastMqttAttempt = 0;
static uint32_t seqCounter = 0;

static bool publishNow = false;
static bool ntpStarted = false;
static bool wifiWasUp = false;

WiFiClient netClient;
WiFiClientSecure httpsClient;
PubSubClient mqtt(netClient);

// ============================================================================
// 10. FONCTIONS UTILITAIRES
// ============================================================================

static float round1(float value) {
  return roundf(value * 10.0f) / 10.0f;
}

static uint32_t epochNow() {
  time_t now = time(nullptr);
  return (now > 1700000000) ? (uint32_t)now : 0;
}

static uint32_t doorOpenSeconds() {
  return doorOpen ? (millis() - doorOpenSince) / 1000UL : 0;
}

// ============================================================================
// 11. CAPTEUR ULTRASONORE
// ============================================================================

#if DOOR_SENSOR_ULTRASONIC

static float readUltrasonicDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration <= 0) {
    return -1.0f;
  }

  return (float)duration * 0.01715f;
}

#endif

// ============================================================================
// 12. CALCUL DES NIVEAUX D'ALERTE
// ============================================================================

static uint8_t levelHigh(
  float value,
  float warning,
  float critical,
  float hysteresis,
  uint8_t previousLevel
) {
  if (value > critical) return 2;
  if (previousLevel == 2 && value > critical - hysteresis) return 2;
  if (value > warning) return 1;
  if (previousLevel >= 1 && value > warning - hysteresis) return 1;

  return 0;
}

static uint8_t levelLow(
  float value,
  float warning,
  float critical,
  float hysteresis,
  uint8_t previousLevel
) {
  if (value < critical) return 2;
  if (previousLevel == 2 && value < critical + hysteresis) return 2;
  if (value < warning) return 1;
  if (previousLevel >= 1 && value < warning + hysteresis) return 1;

  return 0;
}

// ============================================================================
// 13. COMMANDE DU BUZZER
// ============================================================================

static void buzzerInit() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
}

static void buzzerWrite(bool on) {
  if (on == buzzerHw) return;

  buzzerHw = on;

#if BUZZER_ACTIVE
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);

#elif defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(BUZZER_PIN, on ? 128 : 0);

#else
  ledcWrite(8, on ? 128 : 0);
#endif
}

// ============================================================================
// 14. PUBLICATION JSON ET ÉVÉNEMENTS
// ============================================================================

static bool publishJson(
  const char* topic,
  JsonDocument& doc,
  bool retain
) {
  if (!mqtt.connected()) return false;

  char buffer[1024];
  size_t length = serializeJson(doc, buffer, sizeof(buffer));

  if (length == 0 || length >= sizeof(buffer)) {
    return false;
  }

  return mqtt.publish(topic, buffer, retain);
}

static void publishEvent(
  const char* topic,
  const char* type,
  const char* code,
  uint8_t level,
  float value,
  const char* message
) {
  if (!mqtt.connected()) return;

  JsonDocument doc;

  doc["device"]     = DEVICE_ID;
  doc["ts"]         = epochNow();
  doc["uptime_s"]   = millis() / 1000UL;
  doc["type"]       = type;
  doc["code"]       = code;
  doc["level"]      = level;
  doc["level_name"] = LEVEL_NAMES[level > 2 ? 2 : level];
  doc["value"]      = round1(value);
  doc["message"]    = message;

  publishJson(topic, doc, false);
}

static void publishStatus() {
  JsonDocument doc;

  doc["state"]  = "online";
  doc["device"] = DEVICE_ID;
  doc["fw"]     = FW_VERSION;
  doc["ip"]     = WiFi.localIP().toString();
  doc["rssi"]   = WiFi.RSSI();

  publishJson(TOPIC_STATUS, doc, true);
}

// ============================================================================
// 15. CONSTRUCTION DE LA TÉLÉMÉTRIE
// ============================================================================

static float alertValue(uint8_t id) {
  switch (id) {
    case AL_TEMP_HIGH:
    case AL_TEMP_LOW:
      return temperature;

    case AL_HUM_HIGH:
    case AL_HUM_LOW:
      return humidity;

    case AL_LIGHT_LOW:
      return lux;

    case AL_DOOR_OPEN:
      return (float)doorOpenSeconds();

    case AL_SENSOR_FAULT:
      return (float)dhtFailCount;

    default:
      return 0.0f;
  }
}

static void buildTelemetry(JsonDocument& doc) {
  doc["device"]   = DEVICE_ID;
  doc["fw"]       = FW_VERSION;
  doc["seq"]      = ++seqCounter;
  doc["ts"]       = epochNow();
  doc["uptime_s"] = millis() / 1000UL;

  if (haveTH) {
    doc["temperature"]   = round1(temperature);
    doc["temperature_c"] = round1(temperature);
    doc["temp"]          = round1(temperature);

    doc["humidity"]     = round1(humidity);
    doc["humidity_pct"] = round1(humidity);
    doc["hum"]          = round1(humidity);
  } else {
    doc["temperature"]   = nullptr;
    doc["temperature_c"] = nullptr;
    doc["temp"]          = nullptr;

    doc["humidity"]     = nullptr;
    doc["humidity_pct"] = nullptr;
    doc["hum"]          = nullptr;
  }

  doc["lux"]         = (int)lux;
  doc["ldr_raw"]     = ldrRawValue;
  doc["door"]        = doorOpen ? "open" : "closed";
  doc["door_open_s"] = doorOpenSeconds();

#if DOOR_SENSOR_ULTRASONIC
  doc["door_distance_cm"] = round1(doorDistanceCm);
#endif

  doc["fan"]          = fanOn;
  doc["fan_mode"]     = FAN_MODE_NAMES[fanMode];
  doc["fan_actuator"] = "servo_sg90";
  doc["servo_angle"]  = servoAngle;

#if SENSOR_BME280
  if (bmeOk && !isnan(pressure)) {
    doc["pressure_hpa"] = round1(pressure);
    doc["pressure"]     = round1(pressure);
  }
#endif

  doc["led"]          = LED_NAMES[globalLevel > 2 ? 2 : globalLevel];
  doc["buzzer"]       = buzzerActive;
  doc["buzzer_muted"] = buzzerMuted;
  doc["level"]        = globalLevel;
  doc["level_name"]   = LEVEL_NAMES[globalLevel > 2 ? 2 : globalLevel];
  doc["sensor_fault"] = alertLevel[AL_SENSOR_FAULT] > 0;
  doc["wifi_rssi"]    = WiFi.RSSI();

  // Sous-objet attendu par le workflow d'automatisation.
  JsonObject telemetry = doc["telemetry"].to<JsonObject>();

  telemetry["temperature_c"] = haveTH ? round1(temperature) : 0.0f;
  telemetry["humidity_pct"]  = haveTH ? round1(humidity) : 0.0f;
  telemetry["lux"]           = (int)lux;
  telemetry["door"]          = doorOpen ? "open" : "closed";
  telemetry["door_open_s"]   = doorOpenSeconds();
  telemetry["fan"]           = fanOn;
  telemetry["sensor_fault"]  = alertLevel[AL_SENSOR_FAULT] > 0;

  JsonArray alerts = doc["alerts"].to<JsonArray>();

  for (uint8_t i = 0; i < AL_COUNT; i++) {
    if (alertLevel[i] > 0) {
      JsonObject alert = alerts.add<JsonObject>();

      alert["code"]  = ALERT_NAMES[i];
      alert["level"] = alertLevel[i];
    }
  }
}

// ============================================================================
// 16. PUBLICATION DE LA TÉLÉMÉTRIE
// ============================================================================

static void publishTelemetry() {
  JsonDocument doc;
  buildTelemetry(doc);

  char line[1024];
  size_t length = serializeJson(doc, line, sizeof(line));

  if (length == 0 || length >= sizeof(line)) {
    Serial.println("[TELEMETRY] Erreur de creation du JSON");
    return;
  }

  Serial.printf(
    "[OR-DATA] T:%.1f C | H:%.1f %% | Lux:%.0f | Porte:%s | "
    "P:%.1f hPa | Fan:%s | Risque:%s\n",
    haveTH ? temperature : 0.0f,
    haveTH ? humidity : 0.0f,
    lux,
    doorOpen ? "OUVERTE" : "FERMEE",
    isnan(pressure) ? 1013.25f : pressure,
    fanOn ? "ON" : "OFF",
    LEVEL_NAMES[globalLevel > 2 ? 2 : globalLevel]
  );

  // JSON brut pour le Digital Twin via le port série.
  Serial.println(line);

  // Publication MQTT.
  if (mqtt.connected()) {
    mqtt.publish(TOPIC_TELEMETRY, line, false);
  }

#if USE_HTTP_FALLBACK
  // Transmission au workflow d'automatisation.
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;

    httpsClient.setInsecure();
    http.setConnectTimeout(4000);
    http.setTimeout(4000);

    if (http.begin(httpsClient, HTTP_FALLBACK_URL)) {
      http.addHeader("Content-Type", "application/json");

      int code = http.POST((uint8_t*)line, length);

      Serial.printf("[WORKFLOW] Code HTTP : %d\n", code);

      if (code > 0) {
        String response = http.getString();

        if (response.length() > 0) {
          Serial.printf("[WORKFLOW] Reponse : %s\n", response.c_str());
        }
      } else {
        Serial.printf(
          "[WORKFLOW] Erreur : %s\n",
          http.errorToString(code).c_str()
        );
      }

      http.end();
    }
  }
#endif
}

// ============================================================================
// 17. TRAITEMENT DES COMMANDES MQTT
// ============================================================================

static void onMqttMessage(
  char* topic,
  byte* payload,
  unsigned int length
) {
  JsonDocument doc;

  DeserializationError error =
    deserializeJson(doc, payload, length);

  if (error) {
    publishEvent(
      TOPIC_EVENT, "cmd_error", "JSON_INVALID",
      0, 0, "Commande JSON invalide"
    );
    return;
  }

  const char* reason = doc["reason"] | "manual";

  if (doc["fan"].is<const char*>()) {
    String fanCommand = doc["fan"].as<String>();

    if (fanCommand == "on") {
      fanMode = FAN_FORCE_ON;
      fanOverrideSince = millis();
    } else if (fanCommand == "off") {
      fanMode = FAN_FORCE_OFF;
      fanOverrideSince = millis();
    } else if (fanCommand == "auto") {
      fanMode = FAN_AUTO;
    }

    Serial.printf(
      "[CMD] fan=%s (%s)\n",
      fanCommand.c_str(), reason
    );

    publishEvent(
      TOPIC_EVENT, "command", "FAN_MODE",
      0, (float)fanMode, reason
    );
  }

  if (doc["mute"].is<bool>()) {
    buzzerMuted = doc["mute"].as<bool>();

    Serial.printf(
      "[CMD] mute=%d (%s)\n",
      buzzerMuted, reason
    );

    publishEvent(
      TOPIC_EVENT, "command", "BUZZER_MUTE",
      0, buzzerMuted ? 1.0f : 0.0f, reason
    );
  }

  if (doc["ack"] | false) {
    buzzerMuted = true;

    Serial.printf("[CMD] ack (%s)\n", reason);

    publishEvent(
      TOPIC_EVENT, "command", "ACK",
      globalLevel, 0, reason
    );
  }

  if (doc["publish_now"] | false) {
    publishNow = true;
  }
}

// ============================================================================
// 18. CONNEXION WI-FI
// ============================================================================

static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasUp) {
      wifiWasUp = true;

      Serial.printf(
        "[WiFi] Connecte : IP=%s RSSI=%d dBm\n",
        WiFi.localIP().toString().c_str(),
        WiFi.RSSI()
      );

      if (!ntpStarted) {
        configTime(0, 0, "pool.ntp.org", "time.google.com");
        ntpStarted = true;
      }
    }

    return;
  }

  wifiWasUp = false;

  uint32_t now = millis();

  if (lastWifiAttempt != 0 &&
      now - lastWifiAttempt < WIFI_RETRY_MS) {
    return;
  }

  lastWifiAttempt = now;

  Serial.printf("[WiFi] Connexion a '%s'...\n", WIFI_SSID);

  WiFi.disconnect();

  if (WIFI_CHANNEL > 0) {
    WiFi.begin(WIFI_SSID, WIFI_PASS, WIFI_CHANNEL);
  } else {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
}

// ============================================================================
// 19. CONNEXION MQTT
// ============================================================================

static void ensureMqtt() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) {
    return;
  }

  uint32_t now = millis();

  if (lastMqttAttempt != 0 &&
      now - lastMqttAttempt < MQTT_RETRY_MS) {
    return;
  }

  lastMqttAttempt = now;

  String clientId =
    String(DEVICE_ID) + "-" +
    String((uint32_t)ESP.getEfuseMac(), HEX);

  Serial.printf(
    "[MQTT] Connexion a %s:%u...\n",
    MQTT_HOST, MQTT_PORT
  );

  bool connected = mqtt.connect(
    clientId.c_str(),
    nullptr,
    nullptr,
    TOPIC_STATUS,
    1,
    true,
    "{\"state\":\"offline\"}"
  );

  if (connected) {
    Serial.println("[MQTT] Connecte avec succes !");

    mqtt.subscribe(TOPIC_CMD);
    publishStatus();

    publishEvent(
      TOPIC_EVENT, "boot", "ONLINE",
      0, 0, "ESP32 en ligne"
    );
  } else {
    Serial.printf("[MQTT] Echec rc=%d\n", mqtt.state());
  }
}

// ============================================================================
// 20. LECTURE DE L'ÉTAT DE LA PORTE
// ============================================================================

static void readDoor() {
  uint32_t now = millis();
  bool raw = false;

#if DOOR_SENSOR_ULTRASONIC

  if (now - lastUltrasonicCheck < ULTRASONIC_INTERVAL_MS) {
    return;
  }

  lastUltrasonicCheck = now;

  float distance = readUltrasonicDistanceCM();

  if (distance > 0.0f) {
    doorDistanceCm = distance;

    raw = DOOR_OPEN_IF_GREATER
      ? (distance > DOOR_DIST_THRESHOLD_CM)
      : (distance < DOOR_DIST_THRESHOLD_CM);
  } else {
    raw = DOOR_OPEN_IF_GREATER;
  }

#else

  raw = (digitalRead(DOOR_PIN) == HIGH);

#endif

  if (raw != doorRaw) {
    doorRaw = raw;
    doorRawSince = now;
  }

  if (doorRaw != doorOpen &&
      now - doorRawSince >= DOOR_DEBOUNCE_MS) {
    doorOpen = doorRaw;

    if (doorOpen) {
      doorOpenSince = now;
    }

    doorChanged = true;

#if DOOR_SENSOR_ULTRASONIC
    Serial.printf(
      "[PORTE] %s | Distance=%.1f cm | Seuil=%.1f cm\n",
      doorOpen ? "OUVERTE" : "FERMEE",
      doorDistanceCm,
      DOOR_DIST_THRESHOLD_CM
    );
#else
    Serial.printf(
      "[PORTE] %s\n",
      doorOpen ? "OUVERTE" : "FERMEE"
    );
#endif

    publishEvent(
      TOPIC_EVENT,
      "door",
      doorOpen ? "DOOR_OPENED" : "DOOR_CLOSED",
      0,
      doorOpen ? 1.0f : 0.0f,
      doorOpen ? "Porte ouverte" : "Porte fermee"
    );
  }
}

// ============================================================================
// 21. LECTURE DES CAPTEURS
// ============================================================================

static void readSensors() {
  float t = NAN;
  float h = NAN;

#if SENSOR_BME280

  if (!bmeOk) {
    bmeOk = bme.begin(BME_ADDR);

    if (!bmeOk) {
      bmeOk = bme.begin(0x77);
    }
  }

  if (bmeOk) {
    t = bme.readTemperature();
    h = bme.readHumidity();
    pressure = bme.readPressure() / 100.0f;
  }

#else

  t = dht.readTemperature();
  h = dht.readHumidity();

#endif

  if (isnan(t) || isnan(h)) {
    if (dhtFailCount < 255) {
      dhtFailCount++;
    }

    Serial.printf(
      "[T/H] Echec de lecture (%u)\n",
      dhtFailCount
    );
  } else {
    dhtFailCount = 0;

    temperature = t + TEMP_OFFSET;
    humidity = constrain(h + HUM_OFFSET, 0.0f, 100.0f);

    haveTH = true;
  }

  // Moyenne de 16 mesures analogiques du LDR.
  uint32_t sum = 0;

  for (uint8_t i = 0; i < 16; i++) {
    sum += analogRead(LDR_PIN);
    delayMicroseconds(200);
  }

  ldrRawValue = (uint16_t)(sum / 16);

  float ratio = ldrRawValue / 4095.0f;

  if (LDR_INVERTED) {
    ratio = 1.0f - ratio;
  }

  lux = constrain(
    ratio * LUX_FULL_SCALE,
    0.0f,
    LUX_FULL_SCALE
  );

  Serial.printf(
    "[LDR] ADC brut (GPIO%u) = %u / 4095 -> Lux = %.0f\n",
    LDR_PIN, ldrRawValue, lux
  );
}

// ============================================================================
// 22. MOTEUR DE RÈGLES ET ALERTES
// ============================================================================

static void evaluateAlerts() {
  if (haveTH) {
    alertLevel[AL_TEMP_HIGH] = levelHigh(
      temperature, T_HIGH_WARN, T_HIGH_CRIT,
      T_HYST, alertLevel[AL_TEMP_HIGH]
    );

    alertLevel[AL_TEMP_LOW] = levelLow(
      temperature, T_LOW_WARN, T_LOW_CRIT,
      T_HYST, alertLevel[AL_TEMP_LOW]
    );

    alertLevel[AL_HUM_HIGH] = levelHigh(
      humidity, H_HIGH_WARN, H_HIGH_CRIT,
      H_HYST, alertLevel[AL_HUM_HIGH]
    );

    alertLevel[AL_HUM_LOW] = levelLow(
      humidity, H_LOW_WARN, H_LOW_CRIT,
      H_HYST, alertLevel[AL_HUM_LOW]
    );
  }

  alertLevel[AL_LIGHT_LOW] = levelLow(
    lux, LUX_WARN, LUX_CRIT,
    LUX_HYST, alertLevel[AL_LIGHT_LOW]
  );

  uint32_t openSeconds = doorOpenSeconds();

  alertLevel[AL_DOOR_OPEN] =
    (openSeconds > DOOR_CRIT_S) ? 2 :
    (openSeconds > DOOR_WARN_S) ? 1 : 0;

  alertLevel[AL_SENSOR_FAULT] =
    (dhtFailCount >= DHT_FAIL_CRIT) ? 2 :
    (dhtFailCount >= DHT_FAIL_WARN) ? 1 : 0;

  globalLevel = 0;

  for (uint8_t i = 0; i < AL_COUNT; i++) {
    if (alertLevel[i] > globalLevel) {
      globalLevel = alertLevel[i];
    }

    if (alertLevel[i] != alertPrev[i]) {
      const char* type =
        (alertLevel[i] > 0) ? "raised" : "cleared";

      Serial.printf(
        "[ALERTE] %s %s niveau=%u valeur=%.1f\n",
        ALERT_NAMES[i],
        type,
        alertLevel[i],
        alertValue(i)
      );

      publishEvent(
        TOPIC_ALERT,
        type,
        ALERT_NAMES[i],
        alertLevel[i],
        alertValue(i),
        ALERT_MSG[i]
      );

      alertPrev[i] = alertLevel[i];
    }
  }

  if (globalLevel != prevGlobalLevel) {
    publishNow = true;
    prevGlobalLevel = globalLevel;
  }

  if (globalLevel == 0) {
    buzzerMuted = false;
  }
}

// ============================================================================
// 23. COMMANDE AUTOMATIQUE DU SERVO
// ============================================================================

static void updateFan() {
  if (fanMode != FAN_AUTO &&
      millis() - fanOverrideSince > FAN_OVERRIDE_TIMEOUT_MS) {
    fanMode = FAN_AUTO;

    publishEvent(
      TOPIC_EVENT, "command", "FAN_MODE",
      0, 0, "retour automatique apres expiration"
    );
  }

  if (fanMode == FAN_FORCE_ON) {
    fanOn = true;
  } else if (fanMode == FAN_FORCE_OFF) {
    fanOn = false;
  } else if (haveTH) {
    if (temperature >= FAN_T_ON || humidity >= FAN_H_ON) {
      fanOn = true;
    } else if (
      temperature <= FAN_T_OFF &&
      humidity <= FAN_H_OFF
    ) {
      fanOn = false;
    }
  }

  if (alertLevel[AL_TEMP_HIGH] == 2) {
    fanOn = true;
  }
}

static void updateServo() {
  uint32_t now = millis();

  if (!fanOn) {
    servoTarget = SERVO_CLOSED_ANGLE;
  } else if (SERVO_SWEEP) {
    if (servoAngle == servoTarget ||
        servoTarget == SERVO_CLOSED_ANGLE) {
      servoTarget =
        (servoAngle <= SERVO_SWEEP_MIN + 1)
        ? SERVO_SWEEP_MAX
        : SERVO_SWEEP_MIN;
    }
  } else {
    servoTarget = SERVO_OPEN_ANGLE;
  }

  if (now - lastServoStep < SERVO_STEP_MS) {
    return;
  }

  lastServoStep = now;

  if (servoAngle < servoTarget) {
    servoAngle += SERVO_STEP_DEG;

    if (servoAngle > servoTarget) {
      servoAngle = servoTarget;
    }
  } else if (servoAngle > servoTarget) {
    servoAngle -= SERVO_STEP_DEG;

    if (servoAngle < servoTarget) {
      servoAngle = servoTarget;
    }
  } else {
    return;
  }

  servo.write(servoAngle);
}

// ============================================================================
// 24. MISE À JOUR DE LA LED ET DU BUZZER
// ============================================================================

static void updateOutputs() {
  uint32_t now = millis();

  bool ledState = false;

  if (globalLevel == 1) {
    ledState = ((now / 500UL) % 2UL) == 0;
  } else if (globalLevel >= 2) {
    ledState = ((now / 100UL) % 2UL) == 0;
  }

  digitalWrite(
    LED_ALERT_PIN,
    ledState ? HIGH : LOW
  );

  buzzerActive =
    (globalLevel >= 2 &&
     !buzzerMuted &&
     (now % 1000UL) < 200UL);

  buzzerWrite(buzzerActive);

  updateServo();
}

// ============================================================================
// 25. AUTO-TEST AU DÉMARRAGE
// ============================================================================

static void selfTest() {
  Serial.println("[TEST] Auto-test au demarrage...");

  digitalWrite(LED_ALERT_PIN, HIGH);
  buzzerWrite(true);
  servo.write(SERVO_OPEN_ANGLE);

  delay(300);

  buzzerWrite(false);
  digitalWrite(LED_ALERT_PIN, LOW);
  servo.write(SERVO_CLOSED_ANGLE);

  delay(300);

  servoAngle = SERVO_CLOSED_ANGLE;
  servoTarget = SERVO_CLOSED_ANGLE;
}

// ============================================================================
// 26. INITIALISATION
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("=========================================================");
  Serial.println(" PROJET 10 - SMART OPERATING ROOM ENVIRONMENT (ESP32)");
  Serial.printf(" Firmware %s - Appareil : %s\n", FW_VERSION, DEVICE_ID);
  Serial.println("=========================================================");

  pinMode(LED_ALERT_PIN, OUTPUT);
  digitalWrite(LED_ALERT_PIN, LOW);

  buzzerInit();

#if DOOR_SENSOR_ULTRASONIC

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  Serial.printf(
    "[CONFIG] Ultrason : TRIG=GPIO%u, ECHO=GPIO%u, Seuil=%.1f cm\n",
    TRIG_PIN, ECHO_PIN, DOOR_DIST_THRESHOLD_CM
  );

#else

  pinMode(DOOR_PIN, INPUT_PULLUP);

#endif

  ESP32PWM::allocateTimer(0);

  servo.setPeriodHertz(50);
  servo.attach(SERVO_PIN, 500, 2400);
  servo.write(SERVO_CLOSED_ANGLE);

  servoAngle = SERVO_CLOSED_ANGLE;
  servoTarget = SERVO_CLOSED_ANGLE;

  analogReadResolution(12);
  analogSetPinAttenuation(LDR_PIN, ADC_11db);

#if SENSOR_BME280

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  bmeOk = bme.begin(0x76);

  if (!bmeOk) {
    bmeOk = bme.begin(0x77);

    if (bmeOk) {
      BME_ADDR = 0x77;
      Serial.println("[BME280] Detecte sur l'adresse 0x77");
    } else {
      Serial.println("[BME280] Capteur non detecte sur 0x76 ou 0x77");
    }
  } else {
    BME_ADDR = 0x76;
    Serial.println("[BME280] Detecte sur l'adresse 0x76");
  }

#else

  dht.begin();

#endif

  selfTest();

#if DOOR_SENSOR_ULTRASONIC

  float initialDistance = readUltrasonicDistanceCM();

  if (initialDistance > 0.0f) {
    doorDistanceCm = initialDistance;
  }

  doorRaw = doorOpen =
    DOOR_OPEN_IF_GREATER
    ? (doorDistanceCm > DOOR_DIST_THRESHOLD_CM)
    : (doorDistanceCm < DOOR_DIST_THRESHOLD_CM);

#else

  doorRaw = doorOpen = (digitalRead(DOOR_PIN) == HIGH);

#endif

  doorOpenSince = millis();
  doorRawSince = millis();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(1024);
  mqtt.setSocketTimeout(3);
  mqtt.setKeepAlive(30);

  readSensors();

  lastSensor = millis();

  evaluateAlerts();

  Serial.println(
    "[SYSTEM] Initialisation terminee. Boucle active."
  );
}

// ============================================================================
// 27. BOUCLE PRINCIPALE
// ============================================================================

void loop() {
  ensureWifi();
  ensureMqtt();

  if (mqtt.connected()) {
    mqtt.loop();
  }

  readDoor();

  uint32_t now = millis();

  if (now - lastSensor >= SENSOR_INTERVAL_MS) {
    lastSensor = now;
    readSensors();
  }

  evaluateAlerts();
  updateFan();
  updateOutputs();

  if (
    doorChanged ||
    publishNow ||
    (now - lastPublish >= PUBLISH_INTERVAL_MS)
  ) {
    lastPublish = now;
    doorChanged = false;
    publishNow = false;

    publishTelemetry();
  }
}