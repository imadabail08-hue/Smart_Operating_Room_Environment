# Architecture du projet Smart Operating Room Environment

Analyse issue du graphe de connaissances Graphify (serveur `graphify` : 69 nœuds, 105 arêtes, 9 communautés, 100 % d'arêtes extraites) — 24 octobre 2026

## Périmètre et limites de l'analyse

Le graphe est une extraction statique de `src/main.cpp` (firmware ESP32) et `app.js` (jumeau numérique 3D). Il montre la structure du code et les appels de fonctions, mais ni les valeurs de seuils, ni le câblage des broches. Les éléments déduits qui ne figurent pas explicitement dans le graphe sont signalés comme tels.

Le second serveur (`graphify_tp03`) concerne un projet de jumeau numérique d'hexapode, sans rapport, et a été écarté.

## 1. Nœud matériel ESP32 (`main.cpp`)

### Dépendances importées

- `Wire`, `Adafruit_Sensor` et `Adafruit_BME280` : bus I²C et capteur BME280 (température, humidité, pression).
- `DHT` : second capteur ou solution de repli (le graphe ne précise pas lequel).
- `ESP32Servo` : pilotage du servomoteur.
- `WiFi`, `WiFiClientSecure`, `HTTPClient`, `PubSubClient` : connexion réseau, MQTT et HTTP.
- `ArduinoJson` : sérialisation de la télémétrie.
- `time` et `math` : horodatage et calculs.

### Acquisition

- `readSensors()` (L892), appelée dans `setup()` et `loop()`, lit le BME280 et, selon toute vraisemblance, le LDR. Aucun nœud ne le confirme directement ; seule l'alerte `AL_LIGHT_LOW` en témoigne.
- `readUltrasonicDistanceCM()` (L325) mesure la distance au capteur ultrason.
- `readDoor()` (L818) appelle `readUltrasonicDistanceCM()` : l'ultrason sert de détecteur d'ouverture de porte. Elle publie ensuite un événement via `publishEvent()`.
- `doorOpenSeconds()` (L315) calcule la durée d'ouverture de la porte.

### Alertes

- `evaluateAlerts()` (L969) s'appuie sur `levelHigh()` et `levelLow()`, qui comparent les valeurs aux seuils avec une logique d'hystérésis (déduit des noms). Elle lit les valeurs via `alertValue()` et publie via `publishEvent()`.
- L'énumération `AlertId` (L189) définit 7 alertes : `AL_TEMP_HIGH`, `AL_TEMP_LOW`, `AL_HUM_HIGH`, `AL_HUM_LOW`, `AL_LIGHT_LOW`, `AL_DOOR_OPEN`, `AL_SENSOR_FAULT`, plus `AL_COUNT`.

### Actionneurs et asservissement CVC

- `FanMode` (L228) est une énumération à trois modes : `FAN_AUTO`, `FAN_FORCE_ON` et `FAN_FORCE_OFF`.
- `updateFan()` (L1053) est appelée à chaque cycle de `loop()` après `evaluateAlerts()`. Elle publie un événement quand l'état change.
- `updateOutputs()` (L1130) appelle `updateServo()` (L1084), qui actionne le servomoteur du volet ou de la bouche CVC, ainsi que `buzzerWrite()` pour le buzzer. Le graphe ne montre pas la loi de commande du servo.
- `buzzerInit()` et `selfTest()` initialisent et testent les sorties au démarrage.

### Communication

- `ensureWifi()` (L720) et `ensureMqtt()` (L766) sont appelées à chaque tour de `loop()`.
- `onMqttMessage()` (L642) reçoit les commandes, probablement le changement de `FanMode`, puisqu'elle publie un événement.
- `buildTelemetry()` (L490) construit le JSON, avec `epochNow()` pour l'horodatage, `round1()` pour l'arrondi et `doorOpenSeconds()`.
- `publishTelemetry()` (L571), `publishStatus()` (L450) et `publishEvent()` (L425) s'appuient tous sur `publishJson()` (L408).

### Cycle principal

`loop()` (L1301, 11 connexions, nœud le plus central du graphe) enchaîne :

1. `ensureWifi()` puis `ensureMqtt()`.
2. `readDoor()`.
3. `readSensors()`.
4. `evaluateAlerts()`.
5. `updateFan()`.
6. `updateOutputs()`, qui commande le servo et le buzzer.
7. `publishTelemetry()`.

`setup()` (L1183) initialise le buzzer, effectue un `selfTest()`, puis une première lecture des capteurs et une première évaluation des alertes.

## 2. Jumeau numérique 3D (`app.js`)

Le graphe y montre une scène 3D construite par fonctions :

- `buildRoom()` (avec `createHospitalTileTexture()` pour le carrelage), `buildDoor()`, `buildSurgicalTable()`, `buildScialyticLamp()`, `buildVentilationSystem()` et `buildMedicalEquipment()`.
- `initMonitorCanvas()` et `updateMonitorCanvas()` : écran de monitoring dessiné dans la scène.
- `updateLeaderLines()` : lignes d'annotation reliant les éléments 3D à leurs valeurs.
- `computeLinearSlope()` (L154) et `formatTimeLabel()` : calcul de tendance et mise en forme des axes temporels.

Le graphe ne contient aucune arête entre le firmware et `app.js`. Le lien passe par MQTT ou HTTP, ce qui échappe à l'analyse statique.

## 3. Moteur Fusion AI : absent du graphe

Aucun nœud ne correspond à un moteur « Fusion AI ». Une requête sur ce thème n'a renvoyé que des éléments de scène 3D et les alertes. Le seul candidat est `computeLinearSlope()`, qui calcule une pente de régression : ce serait un indice de tendance ou de prédiction côté jumeau, mais il s'agit d'une hypothèse. Si Fusion AI se trouve dans un fichier non indexé (autre langage, backend, notebook), il faut régénérer le graphe avec ces sources.

## Synthèse

Capteurs (BME280, LDR, ultrason) → `readSensors()` / `readDoor()` → `evaluateAlerts()` → `updateFan()` / `updateServo()` / `buzzerWrite()`, avec en parallèle `buildTelemetry()` → MQTT → jumeau 3D `app.js`.
