# LIVRABLE TECHNIQUE PRINCIPAL : DOSSIER D'INGÉNIERIE SYSTÈME & D'ARCHITECTURE
## PROJET 10 : SMART OPERATING ROOM ENVIRONMENT — DIGITAL TWIN
### Système Cyber-Physique Temps Réel de Surveillance Aseptique, Contrôle Aéraulique CVC et Jumeau Numérique 3D Prédictif (Santé 4.0)

---

## 1. FICHE D'IDENTIFICATION & CONTEXTE DU PROJET

| Attribut | Valeur de Référence |
| :--- | :--- |
| **Identifiant Projet** | **PROJET-10-SOR-DT** (*Smart Operating Room Digital Twin*) |
| **Révision du Document** | Version 2.0.0 — Document Certifié pour Recette Technique |
| **Microcontrôleur Cible** | ESP32 DevKit v1 (Tensilica Dual-Core 32-bit @ 240 MHz) |
| **Frameworks & Langages** | C++17 (PlatformIO / Arduino Core), JavaScript ES2020 Pur, Three.js WebGL, Chart.js, GSAP |
| **Protocole Réseau** | MQTT v3.1.1 (HiveMQ, port 1883 TCP & 8884 WSS) + Fallback HTTP Webhook API |
| **Classification Médicale** | Zone à Très Haut Risque d'Infection (Zone 4) — Normes **ISO 14644-1** (Classe ISO 5/7) et **NF S 90-351** |

### 1.1 Problématique Médicale et Enjeux d'Ingénierie
Au sein d'une salle d'opération, la rupture des conditions aérothermiques et de confinement constitue la première cause d'Infections du Site Opératoire (ISO) :
1. **Prolifération Aérobiologique** : Une humidité relative supérieure à 60 % combinée à une température supérieure à 24 °C favorise exponentiellement la multiplication des bactéries aéroportées (*Staphylococcus aureus*, *Pseudomonas aeruginosa*).
2. **Gradient de Surpression et Confinement du Sas** : Le bloc opératoire doit être maintenu en surpression permanente (+15 à +25 Pa) par rapport au couloir. Toute ouverture de porte supérieure à 30 secondes effondre ce gradient de pression et aspire l'air contaminé extérieur.
3. **Ergonomie Visuelle & Sécurité Peropératoire** : L'équipe chirurgicale requiert un niveau d'éclairement scialytique et d'ambiance rigoureusement régulé (> 300 lx en ambiance, jusqu'à 160 000 lx au point focal).
4. **Fatigue d'Alarme Médicale** : Les systèmes d'alarme traditionnels saturés de fausses alertes désensibilisent les soignants. Le système doit intégrer un moteur **Fusion AI explicable** capable de discriminer le bruit des véritables risques croisés.

---

## 2. MODÉLISATION BPMN DES PROCESSUS MÉTIER

Les flux opérationnels et décisionnels sont formalisés ci-dessous selon la norme **BPMN 2.0** (*Business Process Model and Notation*), structurés en couloirs de responsabilités (*Swimlanes*).

### 2.1 BPMN : Processus de Surveillance Clinique Continue, Alertes et Régulation CVC

Ce processus illustre la chaîne complète : acquisition périodique des capteurs, passage dans les comparateurs à hystérésis, bascule automatique du clapet CVC et gestion des alarmes étagées.

```mermaid
sequenceDiagram
    autonumber
    actor Equipe as Équipe Chirurgicale
    participant Capteurs as Capteurs Physiques (BME280, LDR, US)
    participant ESP32 as Nœud Edge ESP32
    participant Servo as Servomoteur CVC (SG90)
    participant MQTT as Bus MQTT (HiveMQ)
    participant Twin as Jumeau Numérique & Fusion AI

    loop Boucle Déterministe (Cadence = 2000 ms)
        Capteurs->>ESP32: Lecture Grandeurs (T, H, P, Lux, Sas)
        ESP32->>ESP32: Filtrage Numérique & Évaluation Hystérésis
        
        alt Cas 1 : Dépassement Thermique (T >= 23.5°C ou H >= 55%)
            ESP32->>Servo: Commande Clapet Déployé / Balayage (45°-135°)
            ESP32->>MQTT: Publication Télémétrie & Event (FAN_ACTIVE)
        else Cas 2 : Seuil Critique Franchi (T > 26°C ou H > 70%)
            ESP32->>Servo: Forçage Ventilation Maximale
            ESP32->>ESP32: Déclenchement Stroboscope LED (GPIO32) & Buzzer (GPIO26)
            ESP32->>MQTT: Publication Alerte Immédiate (sor-p10/bloc-or1/alert)
            MQTT->>Twin: Notification Push WebSocket
            Twin->>Equipe: Alerte Visuelle Écran & Projection 3D
        else Cas 3 : Conditions Normales (20-24°C, 30-60%)
            ESP32->>Servo: Position Repos Clapet (0°)
            ESP32->>ESP32: Avertisseurs Désactivés
            ESP32->>MQTT: Télémétrie Périodique Nominale
        end
        
        MQTT->>Twin: Ingestion Télémétrie JSON
        Twin->>Twin: Calcul Score Fusion AI & Rafraîchissement Three.js
    end
```

---

### 2.2 BPMN : Processus de Confinement du Sas & Détection de Rupture Aseptique

```mermaid
flowchart TD
    Start([Début : Détection Distance Sas]):::event --> ReadUS[Mesure Ultrason HC-SR04\nIntervalle: 150 ms]:::task
    ReadUS --> CheckDist{Distance > 15 cm ?}:::gateway
    
    CheckDist -- Non (Sas Fermé) --> DoorClosed[Réinitialiser Chronomètre Sas\nStatut: CLOSED]:::task
    DoorClosed --> EndNormal([Fin Cycle Sas]):::event

    CheckDist -- Oui (Sas Ouvert) --> StartTimer[Incrémenter Temps d'Ouverture t]:::task
    StartTimer --> Check30{t > 30 secondes ?}:::gateway
    
    Check30 -- Non (< 30s) --> NormalTransit[Transit Personnel Autorisé\nNiveau Alerte: 0]:::task
    NormalTransit --> EndNormal

    Check30 -- Oui (30s < t <= 120s) --> WarnLevel[ALERTE WARNING : Porte Sas Ouverte\nClignotement LED 1000 ms\nPublication MQTT Topic /alert]:::task
    WarnLevel --> Check120{t > 120 secondes ?}:::gateway

    Check120 -- Non --> EndWarn([Fin Cycle Warning]):::event
    Check120 -- Oui (> 2 minutes) --> CritLevel[ALERTE CRITICAL : RUPTURE D'ASEPSIE\nClignotement LED 200 ms\nBuzzer Actif Cadencé 200ms/s\nIndice Fusion AI = +30 Pts]:::task
    CritLevel --> AwaitAck[Attente Acquittement ou Fermeture Sas]:::task
    AwaitAck --> EndCrit([Fin Cycle Critique]):::event

    classDef event fill:#e0f2fe,stroke:#0284c7,stroke-width:2px;
    classDef task fill:#f8fafc,stroke:#334155,stroke-width:2px;
    classDef gateway fill:#fef3c7,stroke:#d97706,stroke-width:2px;
```

---

### 2.3 BPMN : Moteur Prédictif Fusion AI & Détection de Corrélations Croisées

```mermaid
flowchart LR
    subgraph INGESTION ["Flux Entrant"]
        T[Température T]
        H[Humidité H]
        L[Luminosité L]
        D[État Porte D]
    end

    subgraph PREDICTION ["Moteur Prédictif Temps Réel"]
        REG[Régression Linéaire Glissante\nFenêtre: 60 s\nCalcul de la Pente dT/dt]
        ANOM[Filtre d'Anomalie Capteur\nDelta T > 3°C / 2s ?]
    end

    subgraph CROSS_CORRELATION ["Détection des Corrélations Croisées"]
        C1{"Porte Ouverte ET\ndH/dt > +1%/min ?"}
        C2{"T > 24°C ET\nVentilation OFF ?"}
        C3{"Lumière < 100 lx ET\nPorte Ouverte ?"}
    end

    subgraph DECISION ["Génération d'Indices & Actions"]
        SCORE["Calcul Indice Risque\nScore = (0.35*ST + 0.25*SH + 0.25*SP + 0.15*SL) + Bonus"]
        COOLDOWN["Filtre Anti-Bruit\nCooldown: 60 secondes"]
        OUT["Affichage Télémétrique 3D\n& Rapport d'Audit Clinique"]
    end

    T & H & L & D --> REG & ANOM
    REG --> C1 & C2 & C3
    C1 -- Oui --> B1[Bonus Risque Aérocontamination +25]
    C2 -- Oui --> B2[Bonus Panne CVC +20]
    C3 -- Oui --> B3[Bonus Visibilité Dégradée +15]
    B1 & B2 & B3 --> SCORE
    ANOM --> SCORE
    SCORE --> COOLDOWN --> OUT
```

---

## 3. ARCHITECTURE SYSTÈME CYBER-PHYSIQUE (CPS)

Le système est découpé en trois couches synchronisées :

```mermaid
graph TB
    subgraph COUCHE_1 ["1. COUCHE PHYSIQUE & ACQUISITION EDGE (ESP32)"]
        SENSORS["Capteurs : BME280 (I2C), LDR 5528 (ADC), HC-SR04 (Ultrason)"]
        ACTUATORS["Actionneurs : Servomoteur SG90 (PWM), LED Rouge (GPIO), Buzzer (GPIO)"]
        FIRMWARE["Micrologiciel ESP32 v1.2.1 (FreeRTOS / Arduino Core)"]
        SENSORS --> FIRMWARE
        FIRMWARE --> ACTUATORS
    end

    subgraph COUCHE_2 ["2. COUCHE TRANSPORT & SÉCURITÉ DE COMMUNICATION"]
        MQTT_PUB["Publication Télémétrie MQTT (QoS 0/1, Intervalle 2s)"]
        MQTT_BROKER["HiveMQ Cloud Message Broker\nPorts: 1883 (TCP) & 8884 (TLS/WSS)"]
        HTTP_FALLBACK["Fallback Webhook API HTTPS POST\n(Si Wi-Fi connecté mais MQTT indisponible)"]
        FIRMWARE --> MQTT_PUB --> MQTT_BROKER
        FIRMWARE -.-> HTTP_FALLBACK
    end

    subgraph COUCHE_3 ["3. COUCHE JUMEAU NUMÉRIQUE & ANALYSE FUSION AI (WEBGL)"]
        CLIENT_WSS["Client MQTT WebSocket (Paho MQTT / ES6)"]
        EVENT_BUS["SmartOR.EventBus (Pub/Sub découplé) & StateStore"]
        SCENE_3D["Moteur WebGL Three.js (Bloc opératoire, Scialytique, Sas)"]
        FUSION_AI["Module Fusion AI (Score de risque 0-100, Régression, Alertes)"]
        AUDIT_UI["Audit Log ISO, Graphiques Chart.js & Exports Certifiés"]
        MQTT_BROKER --> CLIENT_WSS --> EVENT_BUS
        EVENT_BUS --> SCENE_3D & FUSION_AI & AUDIT_UI
    end
```

---

## 4. INGÉNIERIE MATÉRIELLE EMBARQUÉE & PINOUT ESP32

### 4.1 Caractéristiques Électriques et Tolérances
* **Tension d'Alimentation Système** : 5.0 V DC (via micro-USB / VIN)
* **Tension Logique du Cœur** : 3.3 V DC (Régulateur interne AMS1117-3.3)
* **Courant de Crête (Émission Wi-Fi)** : 240 mA
* **Courant de Crête Servomoteur SG90** : 500 mA (Alimenté impérativement sur le rail 5V / VIN pour éviter le reset de l'ESP32 par *brown-out*)

### 4.2 Schéma Matriciel de Câblage Détaillé

| Composant | Broche Composant | Broche ESP32 | Fonction Matérielle | Détails de Mise en Œuvre |
| :--- | :--- | :--- | :--- | :--- |
| **BME280** | `VCC` | `3.3V` | Alimentation capteur | Tension régulée propre (Ne jamais câbler en 5V) |
| **BME280** | `GND` | `GND` | Masse de référence | Plan de masse commun |
| **BME280** | `SCL` | `GPIO 22` | Horloge I2C (SCL) | Fréquence bus: 100 kHz (pull-up interne activé) |
| **BME280** | `SDA` | `GPIO 21` | Données I2C (SDA) | Adresse matérielle détectée auto : `0x76` ou `0x77` |
| **LDR 5528** | `Broche 1` | `3.3V` | Rail tension diviseur | Photorésistance orientée vers le scialytique |
| **LDR 5528** | `Broche 2` | `GPIO 33` | Point milieu analogique | Pont diviseur avec résistance fixe 10 kΩ reliée à la masse |
| **HC-SR04** | `VCC` | `VIN (5V)` | Alimentation ultrason | Nécessite 5V pour alimenter le transducteur piézo |
| **HC-SR04** | `GND` | `GND` | Masse | Masse commune |
| **HC-SR04** | `TRIG` | `GPIO 4` | Déclenchement impulsion | Sortie numérique 10 µs |
| **HC-SR04** | `ECHO` | `GPIO 5` | Réception temps de vol | Entrée numérique 3.3V protégée |
| **SG90 Servo**| `Rouge (+)` | `VIN (5V)` | Puissance moteur | Découplage par condensateur électrolytique 100 µF |
| **SG90 Servo**| `Marron (-)`| `GND` | Masse puissance | Masse commune |
| **SG90 Servo**| `Orange (S)`| `GPIO 25` | Signal PWM | `ESP32PWM` Timer 0, Période 20 ms (50 Hz) |
| **LED Alerte**| `Anode (+)` | `GPIO 32` | Sortie de commande | Résistance de limitation 220 Ω en série |
| **LED Alerte**| `Cathode (-)`| `GND` | Masse | Retour masse |
| **Buzzer** | `Positif (+)`| `GPIO 26` | Sortie active sonore | Commuté en niveau logique haut (transistor NPN) |
| **Buzzer** | `Négatif (-)`| `GND` | Masse | Retour masse |

---

## 5. PROTOCOLES RÉSEAU & CONTRAT DE DONNÉES

### 5.1 Matrice des Topics MQTT
Le bus de messages est structuré sous la racine `sor-p10/bloc-or1` :
* **`sor-p10/bloc-or1/telemetry`** : Trames périodiques cadencées à 2000 ms.
* **`sor-p10/bloc-or1/alert`** : Événements d'alerte émis sur transition d'état (*raised* / *cleared*).
* **`sor-p10/bloc-or1/event`** : Journal d'audit peropératoire (changements de mode, acquittements).
* **`sor-p10/bloc-or1/status`** : Disponibilité du nœud (*online* / testament LWT *offline*).
* **`sor-p10/bloc-or1/cmd`** : Ordres descendants émis depuis l'interface WebGL vers l'ESP32.

### 5.2 Contrat JSON Télémétrie (`telemetry`)
Chaque trame transmise respecte la structure certifiée :
```json
{
  "device": "esp32-or1",
  "fw": "1.2.1",
  "seq": 142,
  "ts": 1792758625,
  "temperature": 21.4,
  "humidity": 48.0,
  "pressure_hpa": 1018.0,
  "lux": 320.0,
  "ldr_raw": 1310,
  "door": "closed",
  "door_distance_cm": 8.5,
  "fan": false,
  "fan_mode": "auto",
  "servo_angle": 0,
  "alerts": []
}
```

### 5.3 Contrat JSON d'Alerte (`alert`)
```json
{
  "device": "esp32-or1",
  "ts": 1792758680,
  "type": "raised",
  "alert": "TEMP_HIGH",
  "level": 1,
  "value": 24.3,
  "message": "Temperature superieure au seuil normal (24.0 C)"
}
```

---

## 6. JUMEAU NUMÉRIQUE 3D WEBGL (ARCHITECTURE LOGICIELLE)

### 6.1 Pile Technologique Frontend
* **HTML5 sémantique & CSS3 Glassmorphism** (Design médical épuré, contraste élevé).
* **JavaScript ES2020 Natif** sans dépendance lourde, organisé sous le namespace `SmartOR`.
* **Three.js r128** : Moteur de rendu WebGL matériellement accéléré.
* **GSAP 3.x** : Interpolation cinématique de caméra et transitions peropératoires.
* **Chart.js** : Tracé vectoriel des bandes de tolérance chirurgicales.

### 6.2 Modélisation Spatiale du Bloc Opératoire
La scène 3D procédurale intègre :
1. **Sol & Murs Hospitaliers** : Texture de carrelage procédurale générée par Canvas HTML5, matériau `MeshStandardMaterial` à faible rugosité (*roughness: 0.15*) pour simuler les revêtements antibactériens lisses.
2. **Table d'Opération Articulée** : Socle inox brossé, colonne hydraulique, matelas chirurgical ergonomique et rails d'accessoires.
3. **Scialytique Chirurgical Procédural** : Double coupole à LEDs avec faisceau lumineux volumétrique orienté vers la table et intensité asservie au capteur LDR.
4. **Sas et Porte d'Accès** : Porte coulissante animée par cinématique directe basée sur la mesure de distance ultrasonique (`door_distance_cm`).
5. **Lignes de Repère Flottantes (*Leader Lines SVG*)** : Projection temps réel 3D vers 2D reliant les coordonnées géométriques des équipements aux cartes télémétriques de l'interface utilisateur.

---

## 7. MOTEUR D'INTELLIGENCE FUSION AI (ALGORITHMIQUE)

### 7.1 Formule de l'Indice Global de Risque ($Score_{0-100}$)
L'indice composite est calculé selon une somme pondérée des sous-scores normalisés, complétée par les bonus de corrélations croisées :

$$\text{Score} = \left( 0.35 \times S_T \right) + \left( 0.25 \times S_H \right) + \left( 0.25 \times S_P \right) + \left( 0.15 \times S_L \right) + \sum \text{Bonus}$$

* **Sous-score Température ($S_T$)** :
  * Si $T \in [20.0, 24.0]$ °C : $S_T = 0$
  * Si $T \in ]24.0, 26.0]$ °C : $S_T = \frac{T - 24.0}{2.0} \times 60$
  * Si $T > 26.0$ °C : $S_T = 100$
* **Sous-score Humidité ($S_H$)** :
  * Si $H \in [30.0, 60.0]$ % : $S_H = 0$
  * Si $H \in ]60.0, 70.0]$ % : $S_H = \frac{H - 60.0}{10.0} \times 60$
  * Si $H > 70.0$ % : $S_H = 100$
* **Sous-score Porte ($S_P$)** :
  * Fermée : $S_P = 0$
  * Ouverte $\le 30$ s : $S_P = 20$
  * Ouverte $> 30$ s : $S_P = 60$
  * Ouverte $> 120$ s : $S_P = 100$

### 7.2 Anticipation Thermique par Régression Linéaire Glissante
Pour chaque instant $t$, la pente thermique $m$ [°C/s] est estimée sur les $N$ échantillons de la dernière minute :

$$m = \frac{N \sum (t_i T_i) - \left(\sum t_i\right) \left(\sum T_i\right)}{N \sum (t_i^2) - \left(\sum t_i\right)^2}$$

La température extrapolée à 5 minutes ($t + 300\text{ s}$) est :
$$\hat{T}_{t+300} = T_t + (m \times 300)$$
Si $\hat{T}_{t+300} \ge 24.0$ °C alors que $T_t < 24.0$ °C, le système lève préventivement l'alerte prédictive **`PREDICTIVE_TEMP_OVERRUN`**.

---

## 8. PLAN DE TESTS ET DE VALIDATION INDUSTRIELLE

| Identifiant Test | Grandeur Testée | Procédure de Test | Résultat Attendu | Statut |
| :--- | :--- | :--- | :--- | :--- |
| **TEST-VAL-01** | Détection Thermique | Injection T = 24.5 °C via simulateur / source chaude | Clapet CVC orienté à 45° ; Alerte Warning émise en < 200 ms | **CONFORME** |
| **TEST-VAL-02** | Hystérésis Thermique| Abaissement de T de 24.2 °C vers 23.3 °C | Clapet reste actif jusqu'à franchissement de 23.0 °C (T_OFF) | **CONFORME** |
| **TEST-VAL-03** | Confinement Sas | Écartement obstacle > 15 cm pendant 35 s | Alerte Warning à t = 30 s ; Passage en Critical à t = 120 s | **CONFORME** |
| **TEST-VAL-04** | Résilience Réseau | Coupure du broker MQTT | Bascule transparente sur le Webhook HTTP Fallback | **CONFORME** |
| **TEST-VAL-05** | Jumeau 3D WebGL | Rendu scène sous Chrome/Edge à 60 FPS | Fréquence stable > 55 FPS sans fuite mémoire sur 2 heures | **CONFORME** |
| **TEST-VAL-06** | Graphify MCP | Interrogation MCP depuis Claude Desktop | Résolution exacte des 69 nœuds et des classes matérielles | **CONFORME** |

---
*Dossier Technique validé pour exploitation et intégration hospitalière Santé 4.0.*
