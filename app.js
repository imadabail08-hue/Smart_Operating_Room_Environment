/**
 * ============================================================================
 *  SMART OPERATING ROOM DIGITAL TWIN — APPLICATION LOGIQUE & FUSION AI
 *  Version 1.0.0 — Production-Ready
 * ============================================================================
 */
'use strict';

(function(root) {
  // Namespace racine unique
  const SmartOR = {};
  root.SmartOR = SmartOR;

  // --------------------------------------------------------------------------
  // 1. CONFIGURATION GLOBALE ET SEUILS CLINIQUES
  // --------------------------------------------------------------------------
  const CONFIG = {
    thresholds: {
      temp: {
        minWarn: 20.0,
        maxWarn: 24.0,
        maxCrit: 26.0,
        hysteresis: 0.5
      },
      hum: {
        minWarn: 30.0,
        maxWarn: 60.0,
        maxCrit: 70.0,
        hysteresis: 2.0
      },
      lux: {
        normal: 300.0,
        warn: 300.0,
        crit: 100.0
      },
      door: {
        warnSeconds: 30,
        critSeconds: 120,
        distThresholdCm: 15.0
      },
      fan: {
        autoTempOn: 23.5,
        autoTempOff: 23.0,
        autoHumOn: 55.0,
        autoHumOff: 52.0,
        forceCriticalTemp: 26.0
      }
    },
    mqtt: {
      defaultBroker: 'wss://broker.hivemq.com:8884/mqtt',
      defaultBaseTopic: 'sor-p10/bloc-or1',
      reconnectIntervalMs: 3000
    },
    limits: {
      maxHistoryPoints: 1800, // 1 heure à 2s d'intervalle
      maxEvents: 500,
      tableRows: 20,
      fusionCooldownMs: 60000 // Anti-bruit 60 secondes
    }
  };
  SmartOR.CONFIG = CONFIG;

  // --------------------------------------------------------------------------
  // 2. BUS D'ÉVÉNEMENTS INTERNE (PUB / SUB)
  // --------------------------------------------------------------------------
  const EventBus = (function() {
    const listeners = {};

    return {
      on: function(event, callback) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
      },
      off: function(event, callback) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(cb => cb !== callback);
      },
      emit: function(event, data) {
        if (!listeners[event]) return;
        for (let i = 0; i < listeners[event].length; i++) {
          try {
            listeners[event][i](data);
          } catch (err) {
            console.error(`[EventBus] Erreur sur l'événement '${event}':`, err);
          }
        }
      }
    };
  })();
  SmartOR.EventBus = EventBus;

  // --------------------------------------------------------------------------
  // 3. ÉTAT CENTRAL DE L'APPLICATION (STATE STORE)
  // --------------------------------------------------------------------------
  const State = {
    mode: 'sim', // 'sim' | 'mqtt' | 'replay'
    connected: false,
    lastSeen: 0,
    doorOpenSince: null,
    
    // Télémétrie actuelle (valeurs initiales strictes du prompt)
    current: {
      temp: 21.4,
      hum: 48.0,
      pressure_hpa: 1018.0,
      lux: 320.0,
      ldr_raw: 1310,
      door: false,
      door_distance_cm: 8.5,
      fan: false,
      fan_mode: 'auto',
      servo_angle: 0,
      alerts: [],
      ts: Date.now()
    },

    // Indice et analyse Fusion AI
    fusion: {
      riskScore: 0,
      riskLevel: 'LOW', // LOW, MODERATE, HIGH, CRITICAL
      correlations: [],
      prediction: null,
      tempSlope: 0
    },

    // Historique glissant et journal
    history: [],
    events: [],
    
    // Statistiques cumulées pour les rapports
    stats: {
      startTime: Date.now(),
      totalPoints: 0,
      compliantPoints: 0,
      doorOpenSeconds: 0,
      doorCycles: 0,
      maxRisk: 0,
      temp: { min: Infinity, max: -Infinity, sum: 0 },
      hum:  { min: Infinity, max: -Infinity, sum: 0 },
      lux:  { min: Infinity, max: -Infinity, sum: 0 },
      alertsByType: {}
    }
  };
  SmartOR.State = State;

  // --------------------------------------------------------------------------
  // 4. MOTEUR DE RÈGLES CLINIQUE & FUSION AI (FUSION ENGINE)
  // --------------------------------------------------------------------------
  const FusionEngine = (function() {
    const lastEmittedAlerts = {};
    const activeCorrelations = {};

    // Régression linéaire simple sur les 60 dernières secondes
    function computeLinearSlope(history, key, windowMs) {
      if (!history || history.length < 3) return 0;
      const now = Date.now();
      const recent = history.filter(p => (now - p.ts) <= windowMs);
      if (recent.length < 3) return 0;

      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      const n = recent.length;
      const t0 = recent[0].ts;

      for (let i = 0; i < n; i++) {
        const x = (recent[i].ts - t0) / 1000; // secondes
        const y = recent[i][key];
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
      }

      const denom = (n * sumX2 - sumX * sumX);
      if (denom === 0) return 0;
      const slopePerSec = (n * sumXY - sumX * sumY) / denom;
      return slopePerSec * 60; // pente en °C par minute
    }

    return {
      evaluate: function(current, history) {
        const now = Date.now();
        const th = CONFIG.thresholds;
        let risk = 0;
        const activeAlerts = [];
        const correlations = [];

        // 1. Évaluation Température (Pondération 35%)
        let tempRisk = 0;
        if (current.temp > th.temp.maxCrit) {
          tempRisk = 35;
          activeAlerts.push({ code: 'TEMP_HIGH_CRIT', level: 'CRITICAL', msg: `Température critique (${current.temp.toFixed(1)} °C > ${th.temp.maxCrit} °C)` });
        } else if (current.temp > th.temp.maxWarn) {
          tempRisk = 20;
          activeAlerts.push({ code: 'TEMP_HIGH_WARN', level: 'WARNING', msg: `Température élevée (${current.temp.toFixed(1)} °C > ${th.temp.maxWarn} °C)` });
        } else if (current.temp < th.temp.minWarn) {
          tempRisk = 18;
          activeAlerts.push({ code: 'TEMP_LOW_WARN', level: 'WARNING', msg: `Température basse (${current.temp.toFixed(1)} °C < ${th.temp.minWarn} °C)` });
        }

        // 2. Évaluation Humidité (Pondération 25%)
        let humRisk = 0;
        if (current.hum > th.hum.maxCrit) {
          humRisk = 25;
          activeAlerts.push({ code: 'HUM_HIGH_CRIT', level: 'CRITICAL', msg: `Humidité critique (${current.hum.toFixed(0)} % > ${th.hum.maxCrit} %)` });
        } else if (current.hum > th.hum.maxWarn) {
          humRisk = 15;
          activeAlerts.push({ code: 'HUM_HIGH_WARN', level: 'WARNING', msg: `Humidité élevée (${current.hum.toFixed(0)} % > ${th.hum.maxWarn} %)` });
        } else if (current.hum < th.hum.minWarn) {
          humRisk = 12;
          activeAlerts.push({ code: 'HUM_LOW_WARN', level: 'WARNING', msg: `Humidité basse (${current.hum.toFixed(0)} % < ${th.hum.minWarn} %)` });
        }

        // 3. Évaluation Luminosité (Pondération 15%)
        let luxRisk = 0;
        if (current.lux < th.lux.crit) {
          luxRisk = 15;
          activeAlerts.push({ code: 'LUX_CRIT', level: 'CRITICAL', msg: `Éclairage insuffisant scialytique (${current.lux.toFixed(0)} lx < ${th.lux.crit} lx)` });
        } else if (current.lux < th.lux.warn) {
          luxRisk = 8;
          activeAlerts.push({ code: 'LUX_WARN', level: 'WARNING', msg: `Éclairage atténué (${current.lux.toFixed(0)} lx < ${th.lux.warn} lx)` });
        }

        // 4. Évaluation Porte (Pondération 25%)
        let doorRisk = 0;
        const doorSeconds = State.doorOpenSince ? Math.floor((now - State.doorOpenSince) / 1000) : 0;
        if (current.door) {
          if (doorSeconds >= th.door.critSeconds) {
            doorRisk = 25;
            activeAlerts.push({ code: 'DOOR_OPEN_CRIT', level: 'CRITICAL', msg: `Porte ouverte depuis ${doorSeconds}s (Rupture d'asepsie majeure)` });
          } else if (doorSeconds >= th.door.warnSeconds) {
            doorRisk = 15;
            activeAlerts.push({ code: 'DOOR_OPEN_WARN', level: 'WARNING', msg: `Porte ouverte depuis ${doorSeconds}s (> ${th.door.warnSeconds}s)` });
          } else {
            doorRisk = 5;
          }
        }

        // Somme de base
        risk = tempRisk + humRisk + luxRisk + doorRisk;

        // 5. Corrélations croisées cliniques
        // Corrélation 1 : Porte ouverte + humidité en hausse => Risque de contamination
        const humSlope = computeLinearSlope(history, 'hum', 60000);
        if (current.door && humSlope > 1.0) {
          risk += 12;
          const corr = {
            id: 'CORR_DOOR_HUM',
            title: 'Risque d\'aérocontamination croisée',
            desc: `Porte ouverte avec élévation rapide de l'humidité (+${humSlope.toFixed(1)}%/min). Perturbation du flux laminaire.`,
            level: 'CRITICAL'
          };
          correlations.push(corr);
          this.emitUniqueAlert(corr.id, corr.level, 'Fusion AI : ' + corr.title, corr.desc);
        }

        // Corrélation 2 : Température > 24 °C + Ventilation OFF => Défaillance CVC
        if (current.temp > th.temp.maxWarn && !current.fan) {
          risk += 10;
          const corr = {
            id: 'CORR_HEAT_NO_VENT',
            title: 'Défaillance de ventilation thermique',
            desc: `Température à ${current.temp.toFixed(1)} °C sans activation du volet de ventilation. Risque de surchauffe matériel.`,
            level: 'WARNING'
          };
          correlations.push(corr);
          this.emitUniqueAlert(corr.id, corr.level, 'Fusion AI : ' + corr.title, corr.desc);
        }

        // Corrélation 3 : Luminosité < 100 lx + Porte ouverte => Conditions dégradées
        if (current.lux < th.lux.crit && current.door) {
          risk += 8;
          const corr = {
            id: 'CORR_DARK_DOOR',
            title: 'Conditions opératoires dégradées',
            desc: `Faible visibilité chirurgicale combinée à une ouverture de porte inopinée.`,
            level: 'WARNING'
          };
          correlations.push(corr);
          this.emitUniqueAlert(corr.id, corr.level, 'Fusion AI : ' + corr.title, corr.desc);
        }

        // 6. Détection d'anomalies brutales (Sauts capteurs)
        if (history.length >= 2) {
          const prev = history[history.length - 2];
          const dTemp = Math.abs(current.temp - prev.temp);
          const dHum  = Math.abs(current.hum - prev.hum);

          if (dTemp > 3.0) {
            this.emitUniqueAlert('ANOMALY_TEMP_JUMP', 'WARNING', 'Capteur thermique douteux', `Variation brutale de température : ${dTemp.toFixed(1)} °C en 2s.`);
          }
          if (dHum > 15.0) {
            this.emitUniqueAlert('ANOMALY_HUM_JUMP', 'WARNING', 'Capteur hygrométrique douteux', `Saut hygrométrique anormal : ${dHum.toFixed(1)} % en 2s.`);
          }
        }

        // 7. Prédiction de tendance thermique par régression
        const tempSlope = computeLinearSlope(history, 'temp', 60000);
        let prediction = null;
        if (tempSlope > 0.15 && current.temp < th.temp.maxWarn) {
          const minToWarn = (th.temp.maxWarn - current.temp) / tempSlope;
          if (minToWarn > 0 && minToWarn <= 5.0) {
            prediction = `Dépassement du seuil (24 °C) prévu dans ${minToWarn.toFixed(1)} min à cette allure (+${tempSlope.toFixed(2)} °C/min).`;
            this.emitUniqueAlert('PREDICT_TEMP_OVERRUN', 'WARNING', 'Tendance thermique défavorable', prediction);
          }
        }

        // Borne de l'indice de risque
        risk = Math.min(100, Math.max(0, Math.round(risk)));

        let riskLevel = 'LOW';
        if (risk >= 70) riskLevel = 'CRITICAL';
        else if (risk >= 40) riskLevel = 'HIGH';
        else if (risk >= 20) riskLevel = 'MODERATE';

        // Émission d'un retour à la normale si toutes les alertes ont disparu
        if (risk === 0 && activeAlerts.length === 0 && Object.keys(activeCorrelations).length > 0) {
          EventBus.emit('event:new', {
            level: 'INFO',
            rule: 'Conformité rétablie',
            message: 'Tous les paramètres environnementaux sont revenus dans les plages cliniques nominales.',
            values: `T=${current.temp.toFixed(1)}°C, H=${current.hum.toFixed(0)}%, Lux=${current.lux.toFixed(0)}lx`,
            ts: now
          });
          for (let k in activeCorrelations) delete activeCorrelations[k];
        }

        // Gestion des alertes locales standard
        activeAlerts.forEach(a => {
          this.emitUniqueAlert(a.code, a.level, a.code, a.msg);
        });

        return {
          riskScore: risk,
          riskLevel: riskLevel,
          correlations: correlations,
          prediction: prediction,
          tempSlope: tempSlope
        };
      },

      emitUniqueAlert: function(key, level, rule, message) {
        const now = Date.now();
        const last = lastEmittedAlerts[key] || 0;
        if (now - last > CONFIG.limits.fusionCooldownMs) {
          lastEmittedAlerts[key] = now;
          activeCorrelations[key] = true;
          EventBus.emit('event:new', {
            level: level,
            rule: rule,
            message: message,
            values: `T=${State.current.temp.toFixed(1)}°C, H=${State.current.hum.toFixed(0)}%, Porte=${State.current.door ? 'Ouverte' : 'Fermée'}`,
            ts: now
          });
        }
      }
    };
  })();
  SmartOR.FusionEngine = FusionEngine;

  // --------------------------------------------------------------------------
  // 5. PARSEUR DE TÉLÉMÉTRIE ET GESTIONNAIRE D'ÉTAT
  // --------------------------------------------------------------------------
  const TelemetryService = (function() {
    return {
      processIncoming: function(rawPayload) {
        let data = null;
        if (typeof rawPayload === 'object' && rawPayload !== null) {
          data = rawPayload;
        } else if (typeof rawPayload === 'string') {
          try {
            data = JSON.parse(rawPayload);
          } catch (e) {
            // Ignorer les messages non JSON
            return;
          }
        }
        if (!data) return;

        // Normalisation et prise en compte des alias (temp/temperature/temperature_c, hum/humidity/humidity_pct, nested telemetry)
        const tObj = (data.telemetry && typeof data.telemetry === 'object') ? data.telemetry : {};
        
        const rawT = (typeof data.temp === 'number') ? data.temp : ((typeof data.temperature === 'number') ? data.temperature : ((typeof data.temperature_c === 'number') ? data.temperature_c : ((typeof tObj.temperature_c === 'number') ? tObj.temperature_c : State.current.temp)));
        const rawH = (typeof data.hum === 'number') ? data.hum : ((typeof data.humidity === 'number') ? data.humidity : ((typeof data.humidity_pct === 'number') ? data.humidity_pct : ((typeof tObj.humidity_pct === 'number') ? tObj.humidity_pct : State.current.hum)));
        const rawP = (typeof data.pressure_hpa === 'number') ? data.pressure_hpa : ((typeof data.pressure === 'number') ? data.pressure : State.current.pressure_hpa);
        const rawL = (typeof data.lux === 'number') ? data.lux : ((typeof tObj.lux === 'number') ? tObj.lux : State.current.lux);
        const rawLdr = (typeof data.ldr_raw === 'number') ? data.ldr_raw : State.current.ldr_raw;
        const rawD = (typeof data.door === 'boolean') ? data.door : (data.door === 'open' || tObj.door === 'open');
        const rawDist = (typeof data.door_distance_cm === 'number') ? data.door_distance_cm : (typeof data.door_dist === 'number' ? data.door_dist : State.current.door_distance_cm);
        const rawFan = (typeof data.fan === 'boolean') ? data.fan : (typeof tObj.fan === 'boolean' ? tObj.fan : State.current.fan);
        const rawFanMode = data.fan_mode || State.current.fan_mode;
        const rawServo = (typeof data.servo_angle === 'number') ? data.servo_angle : State.current.servo_angle;

        const parsed = {
          temp: rawT,
          hum: rawH,
          pressure_hpa: rawP,
          lux: rawL,
          ldr_raw: rawLdr,
          door: rawD,
          door_distance_cm: rawDist,
          fan: rawFan,
          fan_mode: rawFanMode,
          servo_angle: rawServo,
          alerts: Array.isArray(data.alerts) ? data.alerts : [],
          ts: data.ts ? (data.ts > 1700000000 ? data.ts * 1000 : data.ts) : Date.now()
        };

        // Gestion du chronomètre de porte
        if (parsed.door && !State.current.door) {
          State.doorOpenSince = Date.now();
          State.stats.doorCycles++;
        } else if (!parsed.door && State.current.door) {
          if (State.doorOpenSince) {
            State.stats.doorOpenSeconds += Math.floor((Date.now() - State.doorOpenSince) / 1000);
          }
          State.doorOpenSince = null;
        }

        // Mise à jour de l'état actuel
        State.current = parsed;
        State.lastSeen = Date.now();

        // Ajout à l'historique glissant
        State.history.push({ ...parsed });
        if (State.history.length > CONFIG.limits.maxHistoryPoints) {
          State.history.shift();
        }

        // Évaluation Fusion AI
        State.fusion = FusionEngine.evaluate(State.current, State.history);

        // Mise à jour des statistiques d'audit
        this.updateStats(parsed, State.fusion.riskScore);

        // Notification générale par bus
        EventBus.emit('telemetry:updated', {
          current: State.current,
          fusion: State.fusion,
          history: State.history
        });
      },

      updateStats: function(cur, risk) {
        const s = State.stats;
        s.totalPoints++;
        if (risk < 20) s.compliantPoints++;
        if (risk > s.maxRisk) s.maxRisk = risk;

        if (cur.temp < s.temp.min) s.temp.min = cur.temp;
        if (cur.temp > s.temp.max) s.temp.max = cur.temp;
        s.temp.sum += cur.temp;

        if (cur.hum < s.hum.min) s.hum.min = cur.hum;
        if (cur.hum > s.hum.max) s.hum.max = cur.hum;
        s.hum.sum += cur.hum;

        if (cur.lux < s.lux.min) s.lux.min = cur.lux;
        if (cur.lux > s.lux.max) s.lux.max = cur.lux;
        s.lux.sum += cur.lux;
      }
    };
  })();
  SmartOR.TelemetryService = TelemetryService;

  // --------------------------------------------------------------------------
  // 6. CLIENT MQTT WEBSOCKETS (HIVE MQ)
  // --------------------------------------------------------------------------
  const MqttService = (function() {
    let client = null;
    let baseTopic = CONFIG.mqtt.defaultBaseTopic;

    // Récupération localStorage avec try/catch
    try {
      const savedTopic = localStorage.getItem('smartor_mqtt_base');
      if (savedTopic) baseTopic = savedTopic;
    } catch (e) {
      console.warn('[MQTT] Accès localStorage restreint.');
    }

    return {
      getBaseTopic: function() { return baseTopic; },
      setBaseTopic: function(newTopic) {
        baseTopic = newTopic.trim();
        try {
          localStorage.setItem('smartor_mqtt_base', baseTopic);
        } catch (e) {}
        if (client && client.connected) {
          this.reconnect();
        }
      },

      connect: function() {
        if (client) {
          try { client.end(true); } catch (e) {}
        }

        const clientId = 'smartor-web-' + Math.random().toString(16).substr(2, 8);
        EventBus.emit('connection:status', { state: 'connecting', msg: 'Connexion MQTT...' });

        try {
          client = mqtt.connect(CONFIG.mqtt.defaultBroker, {
            clientId: clientId,
            clean: true,
            connectTimeout: 5000,
            reconnectPeriod: CONFIG.mqtt.reconnectIntervalMs
          });

          client.on('connect', () => {
            EventBus.emit('connection:status', { state: 'online', msg: 'MQTT connecté' });
            const subFilter = baseTopic + '/#';
            client.subscribe(subFilter, (err) => {
              if (err) console.error('[MQTT] Erreur souscription:', err);
              else console.log('[MQTT] Souscrit à :', subFilter);
            });
          });

          client.on('message', (topic, payload) => {
            const str = payload.toString();
            if (topic.endsWith('/telemetry')) {
              TelemetryService.processIncoming(str);
            } else if (topic.endsWith('/alert') || topic.endsWith('/event')) {
              try {
                const ev = JSON.parse(str);
                EventBus.emit('event:new', {
                  level: (ev.level === 2) ? 'CRITICAL' : ((ev.level === 1) ? 'WARNING' : 'INFO'),
                  rule: ev.code || 'Firmware ESP32',
                  message: ev.message || 'Événement matériel reçu',
                  values: `Valeur: ${ev.value ?? '--'}`,
                  ts: Date.now()
                });
              } catch (e) {}
            }
          });

          client.on('error', (err) => {
            EventBus.emit('connection:status', { state: 'offline', msg: 'Erreur MQTT' });
          });

          client.on('close', () => {
            if (State.mode === 'mqtt') {
              EventBus.emit('connection:status', { state: 'offline', msg: 'MQTT déconnecté' });
            }
          });
        } catch (err) {
          console.error('[MQTT] Échec initialisation:', err);
          EventBus.emit('connection:status', { state: 'offline', msg: 'Erreur réseau' });
        }
      },

      disconnect: function() {
        if (client) {
          try { client.end(true); } catch (e) {}
          client = null;
        }
      },

      reconnect: function() {
        this.disconnect();
        this.connect();
      },

      publishCommand: function(cmdObj) {
        if (!client || !client.connected) return false;
        const topic = baseTopic + '/cmd';
        const payload = JSON.stringify(cmdObj);
        client.publish(topic, payload);
        return true;
      }
    };
  })();
  SmartOR.MqttService = MqttService;

  // --------------------------------------------------------------------------
  // 6b. SERVICE DE LIAISON SÉRIE DIRECTE USB / WEB SERIAL API (TERMINAL)
  // --------------------------------------------------------------------------
  const SerialService = (function() {
    let port = null;
    let reader = null;
    let keepReading = false;
    let lineBuffer = '';

    return {
      isSupported: function() {
        return ('serial' in navigator);
      },

      connect: async function() {
        if (!this.isSupported()) {
          alert("L'API Web Serial est supportée nativement par Google Chrome et Microsoft Edge. Veuillez utiliser l'un de ces navigateurs pour connecter directement le Terminal Série de l'ESP32.");
          return false;
        }

        try {
          EventBus.emit('connection:status', { state: 'connecting', msg: 'Sélection port COM...' });
          port = await navigator.serial.requestPort();
          await port.open({ baudRate: 115200 });
          keepReading = true;
          EventBus.emit('connection:status', { state: 'online', msg: 'Terminal USB connecté (115200)' });
          
          if (typeof Notyf !== 'undefined') {
            new Notyf().success('ESP32 relié par câble Série USB à 115200 bauds !');
          }

          this.readLoop();
          return true;
        } catch (err) {
          console.warn('[WebSerial] Annulé ou échec de connexion:', err);
          EventBus.emit('connection:status', { state: 'offline', msg: 'Terminal non connecté' });
          return false;
        }
      },

      readLoop: async function() {
        try {
          const textDecoder = new TextDecoderStream();
          port.readable.pipeTo(textDecoder.writable);
          reader = textDecoder.readable.getReader();

          while (keepReading) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              lineBuffer += value;
              const lines = lineBuffer.split(/\r?\n/);
              lineBuffer = lines.pop(); // Conserve le fragment non terminé
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                  try {
                    const json = JSON.parse(trimmed);
                    TelemetryService.processIncoming(json);
                  } catch (e) {
                    // Trame partielle
                  }
                }
              }
            }
          }
        } catch (err) {
          console.warn('[WebSerial] Fin de lecture du flux série:', err);
        } finally {
          if (reader) {
            try { reader.releaseLock(); } catch (e) {}
          }
        }
      },

      disconnect: async function() {
        keepReading = false;
        if (reader) {
          try { await reader.cancel(); } catch (e) {}
          reader = null;
        }
        if (port) {
          try { await port.close(); } catch (e) {}
          port = null;
        }
        EventBus.emit('connection:status', { state: 'offline', msg: 'Terminal déconnecté' });
      }
    };
  })();
  SmartOR.SerialService = SerialService;

  // --------------------------------------------------------------------------
  // 7. MOTEUR DE SIMULATION ET SCÉNARIOS
  // --------------------------------------------------------------------------
  const SimulationEngine = (function() {
    let simInterval = null;
    let servoAngle = 0;
    let servoDir = 1;
    let autoTourStep = 0;
    let autoTourActive = false;

    return {
      start: function() {
        if (simInterval) clearInterval(simInterval);
        simInterval = setInterval(() => this.tick(), 1500);
      },

      stop: function() {
        if (simInterval) {
          clearInterval(simInterval);
          simInterval = null;
        }
      },

      tick: function() {
        if (State.mode !== 'sim') return;

        const cur = State.current;
        const th = CONFIG.thresholds;

        // Dérive réaliste aléatoire
        const driftEnabled = document.getElementById('simSwitchDrift')?.checked ?? true;
        if (driftEnabled) {
          cur.temp += (Math.random() - 0.49) * 0.08;
          cur.hum  += (Math.random() - 0.49) * 0.25;
          cur.lux  += (Math.random() - 0.49) * 1.5;
          cur.pressure_hpa += (Math.random() - 0.49) * 0.05;

          // Bornes raisonnables
          cur.temp = Math.max(16, Math.min(34, cur.temp));
          cur.hum  = Math.max(15, Math.min(88, cur.hum));
          cur.lux  = Math.max(0,  Math.min(750, cur.lux));
        }

        // Logique de ventilation automatique (ou forcée)
        if (cur.fan_mode === 'on') {
          cur.fan = true;
        } else if (cur.fan_mode === 'off') {
          cur.fan = false;
        } else {
          // Mode AUTO avec hystérésis
          if (cur.temp >= th.fan.autoTempOn || cur.hum >= th.fan.autoHumOn) {
            cur.fan = true;
          } else if (cur.temp <= th.fan.autoTempOff && cur.hum <= th.fan.autoHumOff) {
            cur.fan = false;
          }
          if (cur.temp > th.fan.forceCriticalTemp) {
            cur.fan = true; // Sécurité incendie / surchauffe
          }
        }

        // Animation du balayage du servo SG90
        if (cur.fan) {
          servoAngle += 4 * servoDir;
          if (servoAngle >= 135) { servoAngle = 135; servoDir = -1; }
          if (servoAngle <= 45)  { servoAngle = 45;  servoDir = 1; }
        } else {
          // Retour progressif vers 0°
          if (servoAngle > 0) servoAngle = Math.max(0, servoAngle - 6);
        }
        cur.servo_angle = servoAngle;

        // Distance ultrason synchronisée
        cur.door_distance_cm = cur.door ? 48.0 : 8.5;

        // Envoi dans la chaîne de traitement
        TelemetryService.processIncoming({ ...cur, ts: Date.now() });

        // Mise à jour synchrone des sliders du panneau si ouvert
        this.syncSlidersUI();
      },

      syncSlidersUI: function() {
        const cur = State.current;
        const setVal = (id, textId, val, unit) => {
          const el = document.getElementById(id);
          const txt = document.getElementById(textId);
          if (el && document.activeElement !== el) el.value = val;
          if (txt) txt.textContent = val.toFixed(1) + ' ' + unit;
        };
        setVal('simSliderTemp', 'simValTemp', cur.temp, '°C');
        setVal('simSliderHum',  'simValHum',  cur.hum,  '%');
        setVal('simSliderLux',  'simValLux',  cur.lux,  'lx');
        setVal('simSliderPress','simValPress',cur.pressure_hpa, 'hPa');
      },

      applyScenario: function(type) {
        const cur = State.current;
        switch (type) {
          case 'normal':
            cur.temp = 21.4;
            cur.hum = 48.0;
            cur.lux = 320.0;
            cur.door = false;
            State.doorOpenSince = null;
            cur.fan_mode = 'auto';
            break;
          case 'door_open':
            cur.door = true;
            State.doorOpenSince = Date.now() - 35000; // Déjà ouverte depuis 35s pour tester
            break;
          case 'temp_high':
            cur.temp = 26.8; // Déclenche alerte CRITICAL
            break;
          case 'hum_high':
            cur.hum = 74.0;  // Déclenche alerte CRITICAL
            break;
          case 'critical_incident':
            cur.temp = 27.6;
            cur.hum = 75.0;
            cur.lux = 90.0;
            cur.door = true;
            State.doorOpenSince = Date.now() - 45000;
            cur.fan_mode = 'off';
            break;
          case 'light_fail':
            cur.lux = 45.0;  // Déclenche alerte scialytique
            break;
          case 'sensor_fault':
            cur.temp = 48.5; // Hors plage clinique
            break;
          case 'auto_tour':
            this.runAutoTour();
            return;
        }
        const sw = document.getElementById('simSwitchDoor');
        if (sw) sw.checked = cur.door;
        TelemetryService.processIncoming({ ...cur, ts: Date.now() });
      },

      runAutoTour: function() {
        if (autoTourActive) return;
        autoTourActive = true;
        EventBus.emit('event:new', {
          level: 'INFO',
          rule: 'Visite guidée automatique',
          message: 'Démarrage du scénario de démonstration sur 2 minutes.',
          values: 'Tour auto',
          ts: Date.now()
        });

        const steps = [
          { delay: 0,     type: 'normal' },
          { delay: 15000, type: 'door_open' },
          { delay: 40000, type: 'temp_high' },
          { delay: 70000, type: 'hum_high' },
          { delay: 95000, type: 'light_fail' },
          { delay: 115000,type: 'normal' }
        ];

        steps.forEach(st => {
          setTimeout(() => {
            if (State.mode === 'sim') this.applyScenario(st.type);
            if (st.type === 'normal' && st.delay > 0) autoTourActive = false;
          }, st.delay);
        });
      }
    };
  })();
  SmartOR.SimulationEngine = SimulationEngine;

  // --------------------------------------------------------------------------
  // 8. GESTIONNAIRE DE RELECTURE (REPLAY SERVICE CSV / JSON)
  // --------------------------------------------------------------------------
  const ReplayService = (function() {
    let replayInterval = null;

    return {
      loadFile: function(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target.result;
          if (file.name.endsWith('.json')) {
            this.playJson(content);
          } else {
            this.playCsv(content);
          }
        };
        reader.readAsText(file);
      },

      playJson: function(text) {
        try {
          const records = JSON.parse(text);
          if (!Array.isArray(records)) throw new Error('Format attendu: tableau JSON');
          this.startPlayback(records);
        } catch (err) {
          alert('Fichier JSON invalide pour la relecture : ' + err.message);
        }
      },

      playCsv: function(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 2) return;
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const records = [];

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          if (cols.length < headers.length) continue;
          const rec = {};
          headers.forEach((h, idx) => {
            const val = cols[idx];
            if (h.includes('temp')) rec.temp = parseFloat(val);
            else if (h.includes('hum')) rec.hum = parseFloat(val);
            else if (h.includes('lux')) rec.lux = parseFloat(val);
            else if (h.includes('press')) rec.pressure_hpa = parseFloat(val);
            else if (h.includes('door') || h.includes('porte')) rec.door = (val === 'true' || val === '1' || val === 'open');
          });
          records.push(rec);
        }
        this.startPlayback(records);
      },

      startPlayback: function(records) {
        if (replayInterval) clearInterval(replayInterval);
        let idx = 0;
        EventBus.emit('connection:status', { state: 'online', msg: `Relecture (${records.length} pts)` });

        replayInterval = setInterval(() => {
          if (idx >= records.length) {
            clearInterval(replayInterval);
            EventBus.emit('connection:status', { state: 'offline', msg: 'Relecture terminée' });
            return;
          }
          TelemetryService.processIncoming(records[idx]);
          idx++;
        }, 1500);
      },

      stop: function() {
        if (replayInterval) {
          clearInterval(replayInterval);
          replayInterval = null;
        }
      }
    };
  })();
  SmartOR.ReplayService = ReplayService;

  // --------------------------------------------------------------------------
  // 9. GESTION DES GRAPHIQUES TEMPS RÉEL (CHART.JS)
  // --------------------------------------------------------------------------
  const ChartManager = (function() {
    let chartTemp = null;
    let chartHum = null;
    let chartLightPress = null;

    function formatTimeLabel(ts) {
      const d = new Date(ts);
      return d.toLocaleTimeString('fr-FR', { minute: '2-digit', second: '2-digit' });
    }

    return {
      init: function() {
        if (typeof Chart === 'undefined') {
          console.warn('[ChartManager] Chart.js non disponible.');
          return;
        }

        // Configuration par défaut Chart.js
        Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
        Chart.defaults.color = '#64748b';
        Chart.defaults.borderColor = '#e2e8f0';

        // 1. Graphique Température
        const ctxTemp = document.getElementById('chartTemperature')?.getContext('2d');
        if (ctxTemp) {
          chartTemp = new Chart(ctxTemp, {
            type: 'line',
            data: {
              labels: [],
              datasets: [
                {
                  label: 'Température (°C)',
                  data: [],
                  borderColor: '#ef4444',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  borderWidth: 2.2,
                  fill: true,
                  tension: 0.25,
                  pointRadius: 0
                },
                // Limite haute 24 °C
                {
                  label: 'Max Conforme (24 °C)',
                  data: [],
                  borderColor: 'rgba(245, 158, 11, 0.75)',
                  borderWidth: 1.5,
                  borderDash: [5, 4],
                  fill: false,
                  pointRadius: 0
                },
                // Limite basse 20 °C
                {
                  label: 'Min Conforme (20 °C)',
                  data: [],
                  borderColor: 'rgba(245, 158, 11, 0.75)',
                  borderWidth: 1.5,
                  borderDash: [5, 4],
                  fill: false,
                  pointRadius: 0
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              scales: {
                y: { min: 18, max: 28, grid: { color: '#f1f5f9' } },
                x: { grid: { display: false } }
              },
              plugins: { legend: { display: false } }
            }
          });
        }

        // 2. Graphique Humidité
        const ctxHum = document.getElementById('chartHumidity')?.getContext('2d');
        if (ctxHum) {
          chartHum = new Chart(ctxHum, {
            type: 'line',
            data: {
              labels: [],
              datasets: [
                {
                  label: 'Humidité (%)',
                  data: [],
                  borderColor: '#0284c7',
                  backgroundColor: 'rgba(2, 132, 199, 0.08)',
                  borderWidth: 2.2,
                  fill: true,
                  tension: 0.25,
                  pointRadius: 0
                },
                {
                  label: 'Max Conforme (60 %)',
                  data: [],
                  borderColor: 'rgba(245, 158, 11, 0.75)',
                  borderWidth: 1.5,
                  borderDash: [5, 4],
                  fill: false,
                  pointRadius: 0
                },
                {
                  label: 'Min Conforme (30 %)',
                  data: [],
                  borderColor: 'rgba(245, 158, 11, 0.75)',
                  borderWidth: 1.5,
                  borderDash: [5, 4],
                  fill: false,
                  pointRadius: 0
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              scales: {
                y: { min: 20, max: 80, grid: { color: '#f1f5f9' } },
                x: { grid: { display: false } }
              },
              plugins: { legend: { display: false } }
            }
          });
        }

        // 3. Graphique Luminosité & Pression
        const ctxLP = document.getElementById('chartLightPressure')?.getContext('2d');
        if (ctxLP) {
          chartLightPress = new Chart(ctxLP, {
            type: 'line',
            data: {
              labels: [],
              datasets: [
                {
                  label: 'Luminosité (lx)',
                  data: [],
                  borderColor: '#f59e0b',
                  backgroundColor: 'rgba(245, 158, 11, 0.05)',
                  borderWidth: 2,
                  yAxisID: 'yLux',
                  tension: 0.2,
                  pointRadius: 0
                },
                {
                  label: 'Pression (hPa)',
                  data: [],
                  borderColor: '#64748b',
                  borderWidth: 1.8,
                  borderDash: [4, 4],
                  yAxisID: 'yPress',
                  tension: 0.2,
                  pointRadius: 0
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              animation: false,
              scales: {
                yLux: {
                  type: 'linear',
                  position: 'left',
                  min: 0,
                  max: 800,
                  grid: { color: '#f1f5f9' }
                },
                yPress: {
                  type: 'linear',
                  position: 'right',
                  min: 990,
                  max: 1040,
                  grid: { display: false }
                },
                x: { grid: { display: false } }
              },
              plugins: { legend: { display: false } }
            }
          });
        }
      },

      update: function(history) {
        if (!history || history.length === 0) return;
        // Fenêtre glissante de 5 min (150 points à 2s d'intervalle)
        const windowPoints = history.slice(-150);
        const labels = windowPoints.map(p => formatTimeLabel(p.ts));

        if (chartTemp) {
          chartTemp.data.labels = labels;
          chartTemp.data.datasets[0].data = windowPoints.map(p => p.temp);
          chartTemp.data.datasets[1].data = windowPoints.map(() => 24.0);
          chartTemp.data.datasets[2].data = windowPoints.map(() => 20.0);
          chartTemp.update('none'); // Mise à jour performante sans animation
        }

        if (chartHum) {
          chartHum.data.labels = labels;
          chartHum.data.datasets[0].data = windowPoints.map(p => p.hum);
          chartHum.data.datasets[1].data = windowPoints.map(() => 60.0);
          chartHum.data.datasets[2].data = windowPoints.map(() => 30.0);
          chartHum.update('none');
        }

        if (chartLightPress) {
          chartLightPress.data.labels = labels;
          chartLightPress.data.datasets[0].data = windowPoints.map(p => p.lux);
          chartLightPress.data.datasets[1].data = windowPoints.map(p => p.pressure_hpa);
          chartLightPress.update('none');
        }
      }
    };
  })();
  SmartOR.ChartManager = ChartManager;

  // --------------------------------------------------------------------------
  // 10. MOTEUR AUDIO & NOTIFICATIONS TOAST HAUTE FIDÉLITÉ
  // --------------------------------------------------------------------------
  const AudioAlert = (function() {
    let audioCtx = null;
    return {
      playBeep: function(freq = 880, duration = 0.18) {
        try {
          if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          }
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
          gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + duration);
        } catch (e) {
          // Bloqué si aucune interaction préalable
        }
      }
    };
  })();
  SmartOR.AudioAlert = AudioAlert;

  const NotyfToast = (function() {
    let instance = null;
    return {
      init: function() {
        if (typeof Notyf !== 'undefined') {
          instance = new Notyf({
            duration: 4500,
            position: { x: 'right', y: 'top' },
            ripple: true,
            dismissible: true,
            types: [
              { type: 'warning', background: '#f59e0b', icon: false },
              { type: 'critical', background: '#dc2626', icon: false },
              { type: 'ai', background: '#8b5cf6', icon: false }
            ]
          });
        }
      },
      warn: function(msg) {
        if (instance) instance.open({ type: 'warning', message: msg });
      },
      error: function(msg) {
        if (instance) instance.open({ type: 'critical', message: msg });
      },
      ai: function(msg) {
        if (instance) instance.open({ type: 'ai', message: msg });
      },
      success: function(msg) {
        if (instance) instance.success(msg);
      }
    };
  })();
  SmartOR.NotyfToast = NotyfToast;

  // --------------------------------------------------------------------------
  // 10. MOTEUR 3D WEBGL DE LA SALLE OPÉRATOIRE (THREE.JS PROCEDURAL ENGINE)
  // --------------------------------------------------------------------------
  const ThreeEngine = (function() {
    let scene, camera, renderer, controls;
    let container = null;
    let animId = null;
    let initialized = false;

    // Références éléments 3D
    let tableGroup;
    let scialyticGroup, scialyticSpotLight, scialyticBeamMesh, scialyticLenses = [];
    let doorHinge, doorLeaf, doorStatusLight;
    let damperBlades = [];
    let airParticleGeo, airParticles, airPositions;
    let beaconMesh, beaconLight;
    let monitorCanvas, monitorCtx, monitorTexture;
    let ecgPhase = 0;

    // Raycaster pour fiches équipements
    let raycaster, mouse;
    const interactiveMeshes = [];
    let lastCur = { temp: 21.4, hum: 48, lux: 320, pressure_hpa: 1018, door: false, servo_angle: 0, fan: false };

    // Création de texture de carrelage d'hôpital réaliste
    function createHospitalTileTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      // Fond carrelage bleu-gris médical
      ctx.fillStyle = '#b0c5d6';
      ctx.fillRect(0, 0, 512, 512);

      // Dalles 64x64 avec joints clairs
      const tileSize = 64;
      for (let x = 0; x < 512; x += tileSize) {
        for (let y = 0; y < 512; y += tileSize) {
          const grad = ctx.createLinearGradient(x, y, x + tileSize, y + tileSize);
          grad.addColorStop(0, '#c6d7e6');
          grad.addColorStop(0.5, '#b8ccdd');
          grad.addColorStop(1, '#a6bed2');
          ctx.fillStyle = grad;
          ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);

          ctx.strokeStyle = '#d9e7f2';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 1, y + 1, tileSize - 2, tileSize - 2);
        }
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(10, 8);
      return tex;
    }

    // Moniteur patient : tracé dynamique ECG / SpO2 sur canvas 2D
    function initMonitorCanvas() {
      monitorCanvas = document.createElement('canvas');
      monitorCanvas.width = 512;
      monitorCanvas.height = 288;
      monitorCtx = monitorCanvas.getContext('2d');
      monitorTexture = new THREE.CanvasTexture(monitorCanvas);
    }

    function updateMonitorCanvas(cur) {
      if (!monitorCtx) return;
      const ctx = monitorCtx;
      const w = 512;
      const h = 288;

      ctx.fillStyle = '#050c14';
      ctx.fillRect(0, 0, w, h);

      // Grille clinique
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // En-tête télémétrie patient
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.fillText('BLOC OR-1 • PATIENT #4092 • ADULTE', 16, 24);

      // Fréquence cardiaque (Vert)
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 22px "JetBrains Mono", monospace';
      ctx.fillText('ECG: 72 bpm', 16, 56);

      // SpO2 (Cyan)
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 20px "JetBrains Mono", monospace';
      ctx.fillText('SpO2: 99 %', 190, 56);

      // Température & Pression
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 16px "JetBrains Mono", monospace';
      ctx.fillText(`T: ${cur.temp.toFixed(1)}°C  P: ${cur.pressure_hpa.toFixed(0)}hPa`, 335, 56);

      // Tracé ECG P-Q-R-S-T
      ecgPhase += 0.08;
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 8;
      ctx.beginPath();

      for (let x = 0; x < w; x += 3) {
        const t = (x * 0.035 - ecgPhase) % (Math.PI * 2);
        let yWave = Math.sin(t) * 4;
        const cycle = ((x * 0.035 - ecgPhase) / (Math.PI * 2)) % 1;
        const normCycle = cycle < 0 ? cycle + 1 : cycle;
        if (normCycle > 0.45 && normCycle < 0.55) {
          if (normCycle < 0.48) yWave = -6;
          else if (normCycle < 0.51) yWave = 48;
          else yWave = -14;
        } else if (normCycle > 0.65 && normCycle < 0.78) {
          yWave = 12 * Math.sin((normCycle - 0.65) / 0.13 * Math.PI);
        }
        const py = 135 - yWave;
        if (x === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Tracé pléthysmographique SpO2 (Cyan)
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < w; x += 4) {
        const t = (x * 0.04 - ecgPhase * 0.95);
        const pleth = Math.pow(Math.max(0, Math.sin(t)), 2) * 28;
        const py = 230 - pleth;
        if (x === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();

      monitorTexture.needsUpdate = true;
    }

    // Construction procédurale du bloc opératoire
    function buildRoom() {
      // 1. Sol carrelé hospitalier
      const tileTex = createHospitalTileTexture();
      const floorMat = new THREE.MeshStandardMaterial({
        map: tileTex,
        roughness: 0.22,
        metalness: 0.15
      });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      // Plinthes murales inox
      const skirtingMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 });
      const skirtBack = new THREE.Mesh(new THREE.BoxGeometry(18, 0.12, 0.05), skirtingMat);
      skirtBack.position.set(0, 0.06, -6.95);
      scene.add(skirtBack);

      // 2. Murs
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9e5f0, roughness: 0.6, metalness: 0.05 });
      const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.75, roughness: 0.25 });

      // Mur de fond
      const backWall = new THREE.Mesh(new THREE.PlaneGeometry(18, 5), wallMat);
      backWall.position.set(0, 2.5, -7.0);
      backWall.receiveShadow = true;
      scene.add(backWall);

      const railBack = new THREE.Mesh(new THREE.BoxGeometry(18, 0.26, 0.08), railMat);
      railBack.position.set(0, 1.15, -6.95);
      scene.add(railBack);

      // Panneau de gaz médicaux
      const gasPanel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.38, 0.08), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.5, roughness: 0.4 }));
      gasPanel.position.set(-2.2, 1.65, -6.94);
      scene.add(gasPanel);

      const portColors = [0xffffff, 0xeab308, 0x1e293b, 0x2563eb];
      for (let i = 0; i < 4; i++) {
        const port = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 16), new THREE.MeshStandardMaterial({ color: portColors[i], metalness: 0.8, roughness: 0.2 }));
        port.rotation.x = Math.PI / 2;
        port.position.set(-2.9 + i * 0.45, 1.65, -6.88);
        scene.add(port);
      }

      // Horloge murale numérique chirurgicale
      const clockBox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.08), new THREE.MeshStandardMaterial({ color: 0x0f172a }));
      clockBox.position.set(0, 3.8, -6.94);
      scene.add(clockBox);

      // Mur gauche
      const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), wallMat);
      leftWall.position.set(-9.0, 2.5, 0);
      leftWall.rotation.y = Math.PI / 2;
      leftWall.receiveShadow = true;
      scene.add(leftWall);

      const railLeft = new THREE.Mesh(new THREE.BoxGeometry(14, 0.26, 0.08), railMat);
      railLeft.position.set(-8.95, 1.15, 0);
      railLeft.rotation.y = Math.PI / 2;
      scene.add(railLeft);

      // Armoire stérile murale gauche (Inox)
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, metalness: 0.7, roughness: 0.3 });
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 3.2), cabMat);
      cab.position.set(-8.75, 1.6, -2.5);
      cab.castShadow = true;
      scene.add(cab);

      // Mur droit
      const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), wallMat);
      rightWall.position.set(9.0, 2.5, 0);
      rightWall.rotation.y = -Math.PI / 2;
      rightWall.receiveShadow = true;
      scene.add(rightWall);

      // Plafond modulaire
      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.8 }));
      ceiling.position.set(0, 4.8, 0);
      ceiling.rotation.x = Math.PI / 2;
      scene.add(ceiling);

      // Dalles LED plafonniers
      const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.2 });
      const panelPositions = [
        [-3.6, 4.78, -2.5],
        [3.6, 4.78, -2.5],
        [-3.6, 4.78, 2.5],
        [3.6, 4.78, 2.5]
      ];
      panelPositions.forEach(p => {
        const pMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 1.2), panelMat);
        pMesh.position.set(p[0], p[1], p[2]);
        scene.add(pMesh);
      });
    }

    // Porte hospitalière motorisée avec capteur ultrason HC-SR04
    function buildDoor() {
      const doorGroup = new THREE.Group();

      const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5, roughness: 0.4 });
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 1.65), frameMat);
      frameTop.position.set(8.9, 2.82, 1.6);
      doorGroup.add(frameTop);

      const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 0.1), frameMat);
      frameLeft.position.set(8.9, 1.4, 0.8);
      doorGroup.add(frameLeft);

      const frameRight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.8, 0.1), frameMat);
      frameRight.position.set(8.9, 1.4, 2.4);
      doorGroup.add(frameRight);

      // Charnière de pivotement (GSAP 90°)
      doorHinge = new THREE.Group();
      doorHinge.position.set(8.9, 0, 2.35);

      doorLeaf = new THREE.Group();
      doorLeaf.position.set(0, 0, 0);

      const leafBodyMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.15 });
      const leafBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.7, 1.48), leafBodyMat);
      leafBody.position.set(0, 1.35, -0.74);
      leafBody.castShadow = true;
      doorLeaf.add(leafBody);

      // Hublot transparent
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.5,
        roughness: 0.1,
        transmission: 0.8,
        thickness: 0.05
      });
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.45), glassMat);
      glass.position.set(0, 1.7, -0.74);
      doorLeaf.add(glass);

      // Plaque de protection inox
      const pushMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.2 });
      const kickPlate = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.45, 1.45), pushMat);
      kickPlate.position.set(0, 0.25, -0.74);
      doorLeaf.add(kickPlate);

      // Barre anti-panique
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 16), pushMat);
      handle.position.set(-0.06, 1.1, -0.74);
      doorLeaf.add(handle);

      doorHinge.add(doorLeaf);
      doorGroup.add(doorHinge);

      // Voyant d'état sas au-dessus de la porte
      const ledMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.2 });
      const doorStatusMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), ledMat);
      doorStatusMesh.rotation.z = Math.PI / 2;
      doorStatusMesh.position.set(8.8, 2.95, 1.6);
      doorGroup.add(doorStatusMesh);

      doorStatusLight = new THREE.PointLight(0x22c55e, 1.2, 4);
      doorStatusLight.position.set(8.65, 2.95, 1.6);
      doorGroup.add(doorStatusLight);

      // Capteur ultrasonique HC-SR04
      const ultraBox = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.16), new THREE.MeshStandardMaterial({ color: 0x1e3a8a }));
      ultraBox.position.set(8.82, 1.8, 0.7);
      doorGroup.add(ultraBox);

      leafBody.userData = { equipment: 'door' };
      interactiveMeshes.push(leafBody);

      scene.add(doorGroup);
    }

    // Table d'opération ergonomique chirurgicale centrale
    function buildSurgicalTable() {
      tableGroup = new THREE.Group();
      tableGroup.position.set(0, 0, 0);

      const chassisMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.35 });
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 1.85), chassisMat);
      chassis.position.set(0, 0.12, 0);
      chassis.castShadow = true;
      tableGroup.add(chassis);

      // 4 Roulettes
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
      const wheelPos = [
        [-0.4, 0.08, -0.85],
        [0.4, 0.08, -0.85],
        [-0.4, 0.08, 0.85],
        [0.4, 0.08, 0.85]
      ];
      wheelPos.forEach(wp => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wp[0], wp[1], wp[2]);
        tableGroup.add(wheel);
      });

      // Colonne centrale motorisée
      const colMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.85, roughness: 0.18 });
      const colOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.5, 32), colMat);
      colOuter.position.set(0, 0.42, 0);
      colOuter.castShadow = true;
      tableGroup.add(colOuter);

      const colInner = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 32), colMat);
      colInner.position.set(0, 0.72, 0);
      colInner.castShadow = true;
      tableGroup.add(colInner);

      const gimbal = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), chassisMat);
      gimbal.position.set(0, 0.98, 0);
      tableGroup.add(gimbal);

      // Matelas chirurgical bleu stérile (#0284c7)
      const cushionMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.35,
        metalness: 0.08
      });

      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.12, 0.85), cushionMat);
      torso.position.set(0, 1.06, -0.05);
      torso.castShadow = true;
      torso.receiveShadow = true;
      tableGroup.add(torso);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.10, 0.35), cushionMat);
      head.position.set(0, 1.09, -0.68);
      head.rotation.x = -0.06;
      head.castShadow = true;
      tableGroup.add(head);

      const legLeft = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.10, 0.75), cushionMat);
      legLeft.position.set(-0.19, 1.04, 0.78);
      legLeft.castShadow = true;
      tableGroup.add(legLeft);

      const legRight = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.10, 0.75), cushionMat);
      legRight.position.set(0.19, 1.04, 0.78);
      legRight.castShadow = true;
      tableGroup.add(legRight);

      // Rails latéraux inox
      const railMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.15 });
      const railL = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 16), railMat);
      railL.rotation.x = Math.PI / 2;
      railL.position.set(-0.41, 1.02, 0);
      tableGroup.add(railL);

      const railR = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 16), railMat);
      railR.rotation.x = Math.PI / 2;
      railR.position.set(0.41, 1.02, 0);
      tableGroup.add(railR);

      torso.userData = { equipment: 'table' };
      interactiveMeshes.push(torso);

      scene.add(tableGroup);
    }

    // Scialytique chirurgical articulé avec SpotLight réactive (LDR)
    function buildScialyticLamp() {
      scialyticGroup = new THREE.Group();

      const flangeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 32), flangeMat);
      flange.position.set(0.4, 4.74, -0.3);
      scialyticGroup.add(flange);

      const armMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.4 });
      const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 16), armMat);
      arm1.rotation.z = 0.55;
      arm1.rotation.x = 0.25;
      arm1.position.set(0.65, 4.25, -0.2);
      scialyticGroup.add(arm1);

      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), flangeMat);
      elbow.position.set(0.92, 3.8, -0.1);
      scialyticGroup.add(elbow);

      const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 16), armMat);
      arm2.rotation.z = -0.7;
      arm2.position.set(0.55, 3.48, -0.1);
      scialyticGroup.add(arm2);

      // Coupole scialytique
      const domeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.2 });
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.62, 0.16, 36), domeMat);
      dome.position.set(0.2, 3.2, -0.1);
      dome.rotation.x = 0.12;
      dome.castShadow = true;
      scialyticGroup.add(dome);

      const handleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.15 });
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.24, 16), handleMat);
      handle.position.set(0.2, 3.02, -0.08);
      scialyticGroup.add(handle);

      // 7 Optiques LED
      scialyticLenses = [];
      const lensMat = new THREE.MeshStandardMaterial({
        color: 0xfffaed,
        emissive: 0xfffaed,
        emissiveIntensity: 1.6,
        roughness: 0.1
      });

      const centerLens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 24), lensMat);
      centerLens.position.set(0.2, 3.12, -0.1);
      centerLens.rotation.x = 0.12;
      scialyticGroup.add(centerLens);
      scialyticLenses.push(centerLens);

      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const lx = 0.2 + Math.cos(ang) * 0.38;
        const lz = -0.1 + Math.sin(ang) * 0.38;
        const pLens = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.03, 24), lensMat);
        pLens.position.set(lx, 3.12, lz);
        pLens.rotation.x = 0.12;
        scialyticGroup.add(pLens);
        scialyticLenses.push(pLens);
      }

      // SpotLight chirurgicale
      scialyticSpotLight = new THREE.SpotLight(0xfffaed, 2.2);
      scialyticSpotLight.position.set(0.2, 3.15, -0.1);
      scialyticSpotLight.angle = Math.PI / 6.2;
      scialyticSpotLight.penumbra = 0.45;
      scialyticSpotLight.distance = 12;
      scialyticSpotLight.castShadow = true;
      scialyticSpotLight.shadow.mapSize.width = 1024;
      scialyticSpotLight.shadow.mapSize.height = 1024;

      const scialyticTarget = new THREE.Object3D();
      scialyticTarget.position.set(0, 1.05, 0);
      scene.add(scialyticTarget);
      scialyticSpotLight.target = scialyticTarget;

      scene.add(scialyticSpotLight);

      // Cône volumétrique translucide
      const coneGeo = new THREE.ConeGeometry(0.85, 2.1, 32, 1, true);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xfffaed,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      scialyticBeamMesh = new THREE.Mesh(coneGeo, coneMat);
      scialyticBeamMesh.position.set(0.1, 2.1, -0.05);
      scialyticBeamMesh.rotation.x = Math.PI;
      scene.add(scialyticBeamMesh);

      dome.userData = { equipment: 'scialytic' };
      interactiveMeshes.push(dome);

      scene.add(scialyticGroup);
    }

    // Système de ventilation CVC & Volet orienté par servomoteur SG90
    function buildVentilationSystem() {
      const ventGroup = new THREE.Group();

      const plenumMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.3 });
      const plenum = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.08, 1.65), plenumMat);
      plenum.position.set(0, 4.76, 0);
      ventGroup.add(plenum);

      const gridMat = new THREE.MeshStandardMaterial({ color: 0x334155, wireframe: true });
      const grid = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5, 8, 8), gridMat);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(0, 4.71, 0);
      ventGroup.add(grid);

      // 4 Lames de volet motorisées orientables (Servomoteur SG90)
      damperBlades = [];
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8, roughness: 0.2 });
      for (let i = 0; i < 4; i++) {
        const bladeGroup = new THREE.Group();
        bladeGroup.position.set(-0.45 + i * 0.3, 4.68, 0);

        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 1.4), bladeMat);
        bladeGroup.add(blade);
        ventGroup.add(bladeGroup);
        damperBlades.push(bladeGroup);
      }

      // Filets d'air descendants laminaire (Flux propre ISO 5)
      const particleCount = 180;
      airParticleGeo = new THREE.BufferGeometry();
      airPositions = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount; i++) {
        const r = Math.sqrt(Math.random()) * 0.85;
        const theta = Math.random() * Math.PI * 2;
        airPositions[i * 3 + 0] = Math.cos(theta) * r;
        airPositions[i * 3 + 1] = 1.1 + Math.random() * 3.5;
        airPositions[i * 3 + 2] = Math.sin(theta) * r * 1.3;
      }
      airParticleGeo.setAttribute('position', new THREE.BufferAttribute(airPositions, 3));

      const particleMat = new THREE.PointsMaterial({
        color: 0x38bdf8,
        size: 0.045,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending
      });
      airParticles = new THREE.Points(airParticleGeo, particleMat);
      airParticles.visible = true; // Actif pour simuler la propreté aérobie
      ventGroup.add(airParticles);

      plenum.userData = { equipment: 'ventilation' };
      interactiveMeshes.push(plenum);

      scene.add(ventGroup);
    }

    // Chariots de monitoring médical, Anesthésie & Bras suspendu
    function buildMedicalEquipment() {
      const standMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.2 });

      // 1. Chariot de monitoring des signes vitaux (Gauche)
      const monGroup = new THREE.Group();
      monGroup.position.set(-2.4, 0, -0.8);
      monGroup.rotation.y = 0.45;

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 6), standMat);
      base.position.set(0, 0.08, 0);
      monGroup.add(base);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 16), standMat);
      pole.position.set(0, 1.0, 0);
      monGroup.add(pole);

      const screenMat = new THREE.MeshStandardMaterial({
        map: monitorTexture,
        roughness: 0.1,
        emissive: 0xffffff,
        emissiveMap: monitorTexture,
        emissiveIntensity: 0.95
      });
      const caseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 });

      const screenCase = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.52, 0.08), caseMat);
      screenCase.position.set(0, 1.95, 0);
      monGroup.add(screenCase);

      const monitorScreenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.80, 0.47), screenMat);
      monitorScreenMesh.position.set(0, 1.95, 0.045);
      monGroup.add(monitorScreenMesh);

      screenCase.userData = { equipment: 'table' };
      interactiveMeshes.push(screenCase);

      scene.add(monGroup);

      // 2. Chariot chirurgical d'endoscopie (Droite)
      const cartGroup = new THREE.Group();
      cartGroup.position.set(2.3, 0, -1.2);
      cartGroup.rotation.y = -0.4;

      const cartBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.7), new THREE.MeshStandardMaterial({ color: 0x334155 }));
      cartBody.position.set(0, 0.75, 0);
      cartGroup.add(cartBody);

      const cartScreen = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.48, 0.06), new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0284c7, emissiveIntensity: 0.3 }));
      cartScreen.position.set(0, 1.8, 0);
      cartGroup.add(cartScreen);

      scene.add(cartGroup);

      // 3. Bras plafonnier d'anesthésie articulé (Ceiling Anesthesia Pendant)
      const anesthGroup = new THREE.Group();
      anesthGroup.position.set(-3.2, 4.74, -2.5);

      const ceilingFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.12, 24), standMat);
      anesthGroup.add(ceilingFlange);

      const arm1A = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.18), standMat);
      arm1A.position.set(0.7, -0.15, 0);
      anesthGroup.add(arm1A);

      const pivotA = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 16), standMat);
      pivotA.position.set(1.4, -0.22, 0);
      anesthGroup.add(pivotA);

      const colA = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.3 }));
      colA.position.set(1.4, -1.1, 0);
      colA.castShadow = true;
      anesthGroup.add(colA);

      const anesthScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32), new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0284c7, emissiveIntensity: 0.6 }));
      anesthScreen.position.set(1.4, -0.85, 0.26);
      anesthGroup.add(anesthScreen);

      const hoseMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.5 });
      const hose1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 12), hoseMat);
      hose1.position.set(1.2, -1.8, 0.2);
      hose1.rotation.z = -0.3;
      anesthGroup.add(hose1);

      colA.userData = { equipment: 'anesthesia' };
      interactiveMeshes.push(colA);

      scene.add(anesthGroup);

      // 4. Balise d'alerte aseptique murale (LED GPIO 32)
      const beaconGroup = new THREE.Group();
      beaconGroup.position.set(3.8, 3.8, -6.92);

      const beaconBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.08), standMat);
      beaconGroup.add(beaconBase);

      const beaconDomeMat = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x22c55e,
        emissiveIntensity: 0.5,
        roughness: 0.2
      });
      beaconMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 24), beaconDomeMat);
      beaconMesh.position.set(0, 0, 0.1);
      beaconGroup.add(beaconMesh);

      beaconLight = new THREE.PointLight(0x22c55e, 0, 4);
      beaconLight.position.set(0, 0, 0.2);
      beaconGroup.add(beaconLight);

      beaconMesh.userData = { equipment: 'beacon' };
      interactiveMeshes.push(beaconMesh);

      scene.add(beaconGroup);
    }

    // Points d'ancrage 3D réels pour les étiquettes et lignes de repère
    const anchorPoints = {
      lux: new THREE.Vector3(0.2, 3.2, -0.1),
      temp: new THREE.Vector3(-0.6, 1.2, -0.1),
      hum: new THREE.Vector3(-1.8, 1.4, -0.8),
      door: new THREE.Vector3(7.8, 1.6, 1.6)
    };
    let trackingMode = true;

    // Projection 3D-vers-2D et tracé des lignes de repère SVG
    function updateLeaderLines() {
      const svg = document.getElementById('threeLeaderLinesSvg');
      if (!svg) return;
      if (!trackingMode || !camera || !renderer) {
        svg.innerHTML = '';
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w === 0 || h === 0) return;

      const cards = {
        lux: document.getElementById('cardLux'),
        temp: document.getElementById('cardTemp'),
        hum: document.getElementById('cardHum'),
        door: document.getElementById('cardDoor')
      };

      let svgHtml = '';

      for (let key in anchorPoints) {
        const card = cards[key];
        if (!card) continue;

        const targetWorld = anchorPoints[key].clone();
        const pScreen = targetWorld.project(camera);

        if (pScreen.z > 1) continue;

        const tx = (pScreen.x * 0.5 + 0.5) * w;
        const ty = (-pScreen.y * 0.5 + 0.5) * h;

        const cardRect = card.getBoundingClientRect();
        let cx = (cardRect.left - rect.left) + cardRect.width / 2;
        let cy = (cardRect.top - rect.top) + cardRect.height / 2;

        if (tx > cx) cx += cardRect.width / 2 - 8;
        else cx -= cardRect.width / 2 - 8;

        const midX = cx + (tx - cx) * 0.5;
        svgHtml += `
          <path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${midX.toFixed(1)} ${cy.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}" class="leader-line" />
          <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="4.5" class="target-node" />
        `;
      }

      svg.innerHTML = svgHtml;
    }

    return {
      init: function(containerId) {
        if (initialized) return;
        container = document.getElementById(containerId);
        if (!container) return;

        const w = container.clientWidth || 800;
        const h = container.clientHeight || 540;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xbdd1e2);
        scene.fog = new THREE.FogExp2(0xbdd1e2, 0.028);

        camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 60);
        camera.position.set(0, 3.2, 5.8);

        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;

        container.appendChild(renderer.domElement);

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.target.set(0, 1.15, 0);
        controls.maxPolarAngle = Math.PI / 2 - 0.04;
        controls.minDistance = 2.0;
        controls.maxDistance = 14.0;

        const ambLight = new THREE.AmbientLight(0xd9e8f5, 0.7);
        scene.add(ambLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.65);
        dirLight.position.set(4, 8, 4);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        scene.add(dirLight);

        initMonitorCanvas();
        buildRoom();
        buildDoor();
        buildSurgicalTable();
        buildScialyticLamp();
        buildVentilationSystem();
        buildMedicalEquipment();

        raycaster = new THREE.Raycaster();
        mouse = new THREE.Vector2();

        renderer.domElement.addEventListener('pointerdown', (e) => {
          const rect = renderer.domElement.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObjects(interactiveMeshes, true);
          if (intersects.length > 0) {
            let hit = intersects[0].object;
            while (hit && !hit.userData.equipment && hit.parent) {
              hit = hit.parent;
            }
            if (hit && hit.userData.equipment) {
              UiController.openEquipmentModal(hit.userData.equipment);
            }
          }
        });

        window.addEventListener('resize', () => this.onResize());
        if (typeof ResizeObserver !== 'undefined') {
          new ResizeObserver(() => this.onResize()).observe(container);
        }

        // Bouton de toggle lignes de repère
        document.getElementById('btnToggleTracking')?.addEventListener('click', () => {
          this.toggleTracking();
        });

        initialized = true;
        this.animate();
      },

      toggleTracking: function() {
        trackingMode = !trackingMode;
        const label = document.getElementById('labelToggleTracking');
        const svg = document.getElementById('threeLeaderLinesSvg');
        if (label) label.textContent = trackingMode ? 'Lignes 3D : ON' : 'Lignes 3D : OFF';
        if (svg) svg.style.opacity = trackingMode ? '1' : '0';
        if (!trackingMode && svg) svg.innerHTML = '';
        return trackingMode;
      },

      onResize: function() {
        if (!container || !renderer || !camera) return;
        const w = container.clientWidth || 800;
        const h = container.clientHeight || 540;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      },

      setCameraPreset: function(preset) {
        if (!camera || !controls || typeof gsap === 'undefined') return;
        const presets = {
          table:       { pos: { x: 0,    y: 2.1, z: 3.4 }, target: { x: 0,    y: 1.1, z: 0 } },
          scialytic:   { pos: { x: 0.6,  y: 3.2, z: 2.2 }, target: { x: 0.2,  y: 2.9, z: -0.1 } },
          door:        { pos: { x: 4.5,  y: 2.1, z: 3.4 }, target: { x: 7.8,  y: 1.5, z: 1.6 } },
          ventilation: { pos: { x: 0.8,  y: 3.8, z: 1.8 }, target: { x: 0,    y: 4.5, z: 0 } },
          anesthesia:  { pos: { x: -1.6, y: 2.6, z: -0.8}, target: { x: -2.0, y: 2.4, z: -2.2 } },
          reset:       { pos: { x: 0,    y: 3.2, z: 5.8 }, target: { x: 0,    y: 1.15,z: 0 } }
        };
        const p = presets[preset] || presets.reset;
        gsap.to(camera.position, {
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z,
          duration: 1.1,
          ease: 'power2.inOut',
          onUpdate: () => controls.update()
        });
        gsap.to(controls.target, {
          x: p.target.x,
          y: p.target.y,
          z: p.target.z,
          duration: 1.1,
          ease: 'power2.inOut',
          onUpdate: () => controls.update()
        });
      },

      update: function(cur) {
        if (!initialized) return;

        // 1. Mise à jour de la lumière du scialytique (LDR)
        if (scialyticSpotLight && typeof gsap !== 'undefined') {
          const targetIntensity = Math.max(0.1, Math.min(3.8, (cur.lux / 300.0) * 2.2));
          gsap.to(scialyticSpotLight, { intensity: targetIntensity, duration: 0.4 });

          const beamOpacity = Math.max(0.02, Math.min(0.35, (cur.lux / 300.0) * 0.14));
          if (scialyticBeamMesh) {
            gsap.to(scialyticBeamMesh.material, { opacity: beamOpacity, duration: 0.4 });
          }

          scialyticLenses.forEach(lens => {
            const emissiveInt = Math.max(0.2, Math.min(2.8, (cur.lux / 300.0) * 1.6));
            gsap.to(lens.material, { emissiveIntensity: emissiveInt, duration: 0.4 });
          });
        }

        // 2. Animation d'ouverture / fermeture fluide de la porte (GSAP 90°)
        if (doorHinge && typeof gsap !== 'undefined') {
          const targetAngle = cur.door ? -Math.PI / 2 : 0;
          gsap.to(doorHinge.rotation, {
            y: targetAngle,
            duration: 0.85,
            ease: 'power2.out'
          });

          if (doorStatusLight) {
            doorStatusLight.color.setHex(cur.door ? 0xef4444 : 0x22c55e);
          }
        }

        // 3. Orientation du volet de ventilation (Servomoteur SG90 0-180°)
        if (damperBlades.length > 0 && typeof gsap !== 'undefined') {
          const bladeRad = (cur.servo_angle * Math.PI) / 180;
          damperBlades.forEach(b => {
            gsap.to(b.rotation, { z: bladeRad, duration: 0.4, ease: 'power1.out' });
          });
        }

        // 4. Filets d'air descendants
        if (airParticles) {
          airParticles.visible = true;
        }

        // 5. Balise d'alerte murale
        const th = CONFIG.thresholds;
        const isCrit = (cur.temp > th.temp.maxCrit || cur.hum > th.hum.maxCrit || (State.doorOpenSince && (Date.now() - State.doorOpenSince) > th.door.critSeconds * 1000));
        const isWarn = !isCrit && (cur.temp > th.temp.maxWarn || cur.hum > th.hum.maxWarn || cur.lux < th.lux.warn || cur.door);

        if (beaconMesh && beaconLight) {
          if (isCrit) {
            beaconMesh.material.color.setHex(0xef4444);
            beaconMesh.material.emissive.setHex(0xef4444);
            beaconLight.color.setHex(0xef4444);
            beaconLight.intensity = 2.0;
          } else if (isWarn) {
            beaconMesh.material.color.setHex(0xf59e0b);
            beaconMesh.material.emissive.setHex(0xf59e0b);
            beaconLight.color.setHex(0xf59e0b);
            beaconLight.intensity = 1.0;
          } else {
            beaconMesh.material.color.setHex(0x22c55e);
            beaconMesh.material.emissive.setHex(0x22c55e);
            beaconLight.color.setHex(0x22c55e);
            beaconLight.intensity = 0.0;
          }
        }

        lastCur = cur;
      },

      animate: function() {
        animId = requestAnimationFrame(() => this.animate());

        updateMonitorCanvas(lastCur);

        // Flux laminaire descendant
        if (airParticles && airPositions) {
          const pos = airPositions;
          const speed = lastCur.fan ? 0.045 : 0.018;
          for (let i = 0; i < pos.length / 3; i++) {
            pos[i * 3 + 1] -= speed;
            if (pos[i * 3 + 1] < 1.08) {
              pos[i * 3 + 1] = 4.65;
            }
          }
          airParticleGeo.attributes.position.needsUpdate = true;
        }

        // Mise à jour continue des lignes de repère d'ancrage SVG
        updateLeaderLines();

        if (beaconLight && beaconLight.intensity > 0) {
          const time = Date.now() * 0.006;
          beaconMesh.material.emissiveIntensity = 0.5 + 0.5 * Math.sin(time);
        }

        controls.update();
        renderer.render(scene, camera);
      }
    };
  })();
  SmartOR.ThreeEngine = ThreeEngine;

  // SceneRenderer délègue directement à ThreeEngine
  const SceneRenderer = {
    init: function() {
      ThreeEngine.init('webglCanvasContainer');
    },
    render: function(cur) {
      ThreeEngine.update(cur);
    }
  };
  SmartOR.SceneRenderer = SceneRenderer;

  // --------------------------------------------------------------------------
  // 11. CONTRÔLEUR DU TIROIR D'HISTORIQUE TÉLÉMÉTRIQUE 24H (DRAWER CONTROLLER)
  // --------------------------------------------------------------------------
  const DrawerController = (function() {
    let chartInstance = null;

    const sensorConfigs = {
      temp: {
        title: 'Capteur Température BME280',
        pin: 'I2C (0x77) • SDA GPIO 21 / SCL GPIO 22',
        icon: 'thermometer',
        normTitle: 'Norme NF S 90-351 — Température de confort stérile',
        normDesc: 'Plage clinique recommandée : 20,0°C à 24,0°C. Réduit le stress thermique du personnel et ralentit la prolifération microbienne dans le champ opératoire.',
        unit: '°C',
        decimals: 1,
        color: '#0284c7',
        minWarn: 20.0,
        maxWarn: 24.0,
        dataKey: 'temp'
      },
      hum: {
        title: 'Capteur Humidité Relative BME280',
        pin: 'I2C (0x77) • SDA GPIO 21 / SCL GPIO 22',
        icon: 'droplets',
        normTitle: 'Norme NF S 90-351 — Hygrométrie aseptique',
        normDesc: 'Plage optimale : 30% à 60%. En dessous de 30%, risque de décharges électrostatiques ; au-dessus de 60%, risque d\'aérocontamination croisée.',
        unit: '%',
        decimals: 0,
        color: '#06b6d4',
        minWarn: 30.0,
        maxWarn: 60.0,
        dataKey: 'hum'
      },
      lux: {
        title: 'Photorésistance LDR du Scialytique',
        pin: 'ADC1 (GPIO 34) • Pont diviseur 10 kΩ',
        icon: 'sun',
        normTitle: 'Norme d\'Éclairage Chirurgical EN 12464-1',
        normDesc: 'L\'éclairement sur le champ opératoire doit dépasser 300 lx (jusqu\'à 1000 lx pour la micro-chirurgie) pour garantir l\'acuité visuelle sans ombre portée.',
        unit: 'lx',
        decimals: 0,
        color: '#f59e0b',
        minWarn: 300,
        maxWarn: 1000,
        dataKey: 'lux'
      },
      door: {
        title: 'Sas d\'Accès & Télémètre HC-SR04',
        pin: 'TRIG (GPIO 4) / ECHO (GPIO 5)',
        icon: 'door-open',
        normTitle: 'Gestion du Confinement et Sas d\'Accès',
        normDesc: 'Toute ouverture supérieure à 30 secondes compromet le gradient de surpression stérile et favorise l\'entrée d\'air non filtré depuis les couloirs septiques.',
        unit: '',
        decimals: 0,
        color: '#16a34a',
        dataKey: 'door'
      }
    };

    return {
      init: function() {
        document.getElementById('drawerCloseBtn')?.addEventListener('click', () => this.close());
        document.getElementById('drawerBackdrop')?.addEventListener('click', () => this.close());

        // Clic sur les 4 cartes flottantes pour ouvrir le tiroir historique
        document.getElementById('cardLux')?.addEventListener('click', () => this.open('lux'));
        document.getElementById('cardTemp')?.addEventListener('click', () => this.open('temp'));
        document.getElementById('cardHum')?.addEventListener('click', () => this.open('hum'));
        document.getElementById('cardDoor')?.addEventListener('click', () => this.open('door'));
      },

      open: function(sensorKey) {
        const drawer = document.getElementById('sensorHistoryDrawer');
        const backdrop = document.getElementById('drawerBackdrop');
        if (!drawer) return;

        const cfg = sensorConfigs[sensorKey] || sensorConfigs.temp;
        const cur = State.current;

        document.getElementById('drawerSensorTitle').textContent = cfg.title;
        document.getElementById('drawerSensorPin').textContent = cfg.pin;
        document.getElementById('drawerNormTitle').textContent = cfg.normTitle;
        document.getElementById('drawerNormDesc').textContent = cfg.normDesc;

        const iconContainer = document.getElementById('drawerSensorIcon');
        if (iconContainer) {
          iconContainer.innerHTML = `<i data-lucide="${cfg.icon}" class="w-5 h-5"></i>`;
        }

        if (sensorKey === 'door') {
          document.getElementById('drawerCurrentVal').textContent = cur.door ? 'Ouverte' : 'Fermée';
          document.getElementById('drawerStatMin').textContent = 'Fermée';
          document.getElementById('drawerStatAvg').textContent = `${State.stats.doorCycles} cycle(s)`;
          document.getElementById('drawerStatMax').textContent = `${Math.floor(State.stats.doorOpenSeconds)} s cumulées`;
        } else {
          const val = cur[cfg.dataKey];
          document.getElementById('drawerCurrentVal').textContent = `${val.toFixed(cfg.decimals)} ${cfg.unit}`;
          const stat = State.stats[cfg.dataKey] || { min: val, max: val, sum: val };
          const avg = State.stats.totalPoints > 0 ? (stat.sum / State.stats.totalPoints) : val;
          document.getElementById('drawerStatMin').textContent = `${stat.min !== Infinity ? stat.min.toFixed(cfg.decimals) : val.toFixed(cfg.decimals)} ${cfg.unit}`;
          document.getElementById('drawerStatAvg').textContent = `${avg.toFixed(cfg.decimals)} ${cfg.unit}`;
          document.getElementById('drawerStatMax').textContent = `${stat.max !== -Infinity ? stat.max.toFixed(cfg.decimals) : val.toFixed(cfg.decimals)} ${cfg.unit}`;
        }

        // Événements récents de ce capteur
        const eventsList = document.getElementById('drawerSensorEventsList');
        if (eventsList) {
          const sensorEvents = State.events.filter(e => {
            const m = (e.rule + ' ' + e.message).toLowerCase();
            if (sensorKey === 'temp') return m.includes('temp') || m.includes('thermiq');
            if (sensorKey === 'hum') return m.includes('hum') || m.includes('aéro');
            if (sensorKey === 'lux') return m.includes('lux') || m.includes('scialytic') || m.includes('éclairage');
            if (sensorKey === 'door') return m.includes('porte') || m.includes('sas');
            return true;
          });

          if (sensorEvents.length === 0) {
            eventsList.innerHTML = '<span class="text-slate-400 text-center py-2">Aucune anomalie récente sur ce capteur.</span>';
          } else {
            eventsList.innerHTML = sensorEvents.slice(0, 5).map(e => `
              <div class="p-2 rounded bg-slate-50 border border-slate-200 flex justify-between items-center text-[11px]">
                <div>
                  <strong class="text-slate-800 block">${UiController.escapeHtml(e.rule)}</strong>
                  <span class="text-slate-500">${UiController.escapeHtml(e.message)}</span>
                </div>
                <span class="font-mono text-slate-400 text-[10px] ml-2">${new Date(e.ts).toLocaleTimeString('fr-FR')}</span>
              </div>
            `).join('');
          }
        }

        this.renderChart(sensorKey, cfg);

        drawer.classList.add('open');
        backdrop?.classList.remove('hidden');
        backdrop?.classList.add('active');
        if (typeof lucide !== 'undefined') lucide.createIcons();
      },

      renderChart: function(sensorKey, cfg) {
        const canvas = document.getElementById('drawerSensorChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const recent = State.history.slice(-40);

        const labels = recent.map(p => new Date(p.ts).toLocaleTimeString('fr-FR', { minute: '2-digit', second: '2-digit' }));
        const dataValues = recent.map(p => sensorKey === 'door' ? (p.door ? 1 : 0) : p[cfg.dataKey]);

        if (chartInstance) {
          chartInstance.destroy();
        }

        chartInstance = new Chart(ctx, {
          type: sensorKey === 'door' ? 'bar' : 'line',
          data: {
            labels: labels,
            datasets: [{
              label: cfg.title,
              data: dataValues,
              borderColor: cfg.color,
              backgroundColor: cfg.color + '22',
              borderWidth: 2,
              fill: sensorKey !== 'door',
              tension: 0.35,
              pointRadius: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false }
            },
            scales: {
              x: { display: false },
              y: {
                grid: { color: 'rgba(226, 232, 240, 0.6)' },
                ticks: {
                  font: { size: 10, family: 'JetBrains Mono' },
                  callback: val => `${val} ${cfg.unit}`
                }
              }
            }
          }
        });
      },

      close: function() {
        const drawer = document.getElementById('sensorHistoryDrawer');
        const backdrop = document.getElementById('drawerBackdrop');
        drawer?.classList.remove('open');
        backdrop?.classList.remove('active');
        setTimeout(() => backdrop?.classList.add('hidden'), 250);
      }
    };
  })();
  SmartOR.DrawerController = DrawerController;

  // --------------------------------------------------------------------------
  // 12. CONTRÔLEUR D'INTERFACE UTILISATEUR (UI CONTROLLER)
  // --------------------------------------------------------------------------
  const UiController = (function() {
    let currentFilter = 'ALL';
    let prevValues = {};

    return {
      init: function() {
        NotyfToast.init();
        DrawerController.init();
        this.bindNavigation();
        this.bindCameraPresets();
        this.bindDataSources();
        this.bindSimulationDrawer();
        this.bindEventsToolbar();
        this.bindReportsExports();
        this.bindLayerToggles();

        // Réception des événements
        EventBus.on('telemetry:updated', ({ current, fusion, history }) => {
          this.updateFloatingCards(current);
          this.updateHeaderCompliance(fusion.riskScore, current);
          this.updateKpis(current, fusion);
          this.updateWorkflowPipeline(current, fusion);
          this.updateTelemetryTable(history);
          SceneRenderer.render(current);
          ChartManager.update(history);
          this.updateReportSummary();
        });

        EventBus.on('event:new', (ev) => {
          this.addEventToJournal(ev);
          if (ev.level === 'CRITICAL') {
            NotyfToast.error(ev.message);
            AudioAlert.playBeep(920, 0.25);
          } else if (ev.level === 'WARNING') {
            NotyfToast.warn(ev.message);
          } else if (ev.rule && ev.rule.includes('Fusion AI')) {
            NotyfToast.ai(ev.message);
          }
        });

        EventBus.on('connection:status', ({ state, msg }) => {
          this.updateConnectionPill(state, msg);
        });

        // Détection de l'ancre d'URL au chargement (#overview, #room, etc.)
        const initialHash = window.location.hash.replace('#', '') || 'overview';
        this.switchView(initialHash);
      },

      bindNavigation: function() {
        document.querySelectorAll('.sidebar-nav .nav-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const viewName = btn.getAttribute('data-view');
            this.switchView(viewName);
          });
        });

        window.addEventListener('hashchange', () => {
          const hash = window.location.hash.replace('#', '') || 'overview';
          this.switchView(hash);
        });
      },

      bindCameraPresets: function() {
        document.querySelectorAll('.btn-camera').forEach(btn => {
          btn.addEventListener('click', () => {
            const cam = btn.getAttribute('data-cam');
            ThreeEngine.setCameraPreset(cam);
          });
        });
      },

      switchView: function(viewId) {
        const targetView = document.getElementById('view-' + viewId);
        if (!targetView) return;

        // Mise à jour des boutons sidebar
        document.querySelectorAll('.sidebar-nav .nav-btn').forEach(btn => {
          const isCurrent = btn.getAttribute('data-view') === viewId;
          btn.classList.toggle('active', isCurrent);
          btn.setAttribute('aria-current', isCurrent ? 'page' : 'false');
        });

        // Affichage de la section
        document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active', 'hidden'));
        document.querySelectorAll('.view-section').forEach(sec => {
          if (sec.id !== 'view-' + viewId) sec.classList.add('hidden');
        });
        targetView.classList.add('active');

        // Titre dynamique de vue
        const headings = {
          overview: { title: 'Vue d\'ensemble', sub: 'Bloc Opératoire Stérile OR-1 • Surveillance environnementale 3D' },
          room:     { title: 'Salle opératoire', sub: 'Inspection 3D du bloc stérile, ciblage caméra et calques techniques' },
          live:     { title: 'Données temps réel', sub: 'Surveillance des séries temporelles, zones cibles et historique récent' },
          events:   { title: 'Événements & Alertes', sub: 'Journal d\'audit clinique, traçabilité des anomalies et moteur Fusion AI' },
          reports:  { title: 'Rapports & Conformité', sub: 'Synthèse statistique certifiée, analyse des risques et exports d\'audit' }
        };
        const h = headings[viewId] || headings.overview;
        document.getElementById('viewHeading').textContent = h.title;
        document.getElementById('viewSubheading').textContent = h.sub;
        window.location.hash = '#' + viewId;

        // Déplacement dynamique du viewport 3D partagé
        const container = document.getElementById('threeViewportContainer');
        if (viewId === 'overview') {
          const slot = document.getElementById('overviewViewportSlot');
          if (slot && container && !slot.contains(container)) {
            slot.appendChild(container);
            ThreeEngine.onResize();
          }
        } else if (viewId === 'room') {
          const slot = document.getElementById('roomViewportSlot');
          if (slot && container && !slot.contains(container)) {
            slot.appendChild(container);
            ThreeEngine.onResize();
          }
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
      },

      bindDataSources: function() {
        const select = document.getElementById('dataSourceSelect');
        const mqttBox = document.getElementById('mqttQuickConfig');
        const serialBox = document.getElementById('serialQuickConfig');
        const replayBtn = document.getElementById('replayTriggerBtn');
        const topicInput = document.getElementById('mqttBaseTopicInput');
        const reconnectBtn = document.getElementById('mqttReconnectBtn');
        const connectSerialBtn = document.getElementById('btnConnectSerial');

        if (topicInput) topicInput.value = MqttService.getBaseTopic();

        connectSerialBtn?.addEventListener('click', () => {
          SerialService.connect();
        });

        select?.addEventListener('change', (e) => {
          const val = e.target.value;
          State.mode = val;
          mqttBox?.classList.toggle('hidden', val !== 'mqtt');
          serialBox?.classList.toggle('hidden', val !== 'serial');
          replayBtn?.classList.toggle('hidden', val !== 'replay');

          const pipelineSourceBadge = document.getElementById('pipelineSourceBadge');
          if (pipelineSourceBadge) {
            if (val === 'mqtt') pipelineSourceBadge.textContent = 'MQTT HiveMQ (sor-p10/bloc-or1)';
            else if (val === 'serial') pipelineSourceBadge.textContent = 'Port Série USB Direct (115200)';
            else if (val === 'sim') pipelineSourceBadge.textContent = 'Simulation Locale (60 FPS)';
            else pipelineSourceBadge.textContent = 'Relecture Fichier Session';
          }

          if (val === 'sim') {
            MqttService.disconnect();
            SerialService.disconnect();
            ReplayService.stop();
            SimulationEngine.start();
            EventBus.emit('connection:status', { state: 'sim', msg: 'Mode Simulation' });
          } else if (val === 'mqtt') {
            SimulationEngine.stop();
            SerialService.disconnect();
            ReplayService.stop();
            MqttService.connect();
          } else if (val === 'serial') {
            SimulationEngine.stop();
            MqttService.disconnect();
            ReplayService.stop();
            SerialService.connect();
          } else if (val === 'replay') {
            SimulationEngine.stop();
            MqttService.disconnect();
            SerialService.disconnect();
            EventBus.emit('connection:status', { state: 'offline', msg: 'En attente de fichier' });
          }
        });

        topicInput?.addEventListener('change', (e) => {
          MqttService.setBaseTopic(e.target.value);
        });

        reconnectBtn?.addEventListener('click', () => {
          MqttService.reconnect();
        });

        // Bouton de replay
        const fileInput = document.getElementById('replayFileInput');
        replayBtn?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            ReplayService.loadFile(e.target.files[0]);
          }
        });
      },

      bindSimulationDrawer: function() {
        const drawer = document.getElementById('simulationDrawer');
        const toggleHdr = document.getElementById('simToggleHeader');
        const collapseBtn = document.getElementById('simDrawerCollapseBtn');
        const icon = document.getElementById('simCollapseIcon');

        const toggleDrawer = () => {
          const isCollapsed = drawer.classList.toggle('collapsed');
          toggleHdr.setAttribute('aria-expanded', !isCollapsed);
          if (icon) {
            icon.setAttribute('data-lucide', isCollapsed ? 'chevron-up' : 'chevron-down');
            lucide.createIcons();
          }
        };

        collapseBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleDrawer();
        });
        toggleHdr?.addEventListener('click', toggleDrawer);

        // Sliders
        const bindSlider = (id, key) => {
          const el = document.getElementById(id);
          el?.addEventListener('input', (e) => {
            State.current[key] = parseFloat(e.target.value);
            TelemetryService.processIncoming({ ...State.current });
          });
        };
        bindSlider('simSliderTemp', 'temp');
        bindSlider('simSliderHum', 'hum');
        bindSlider('simSliderLux', 'lux');
        bindSlider('simSliderPress', 'pressure_hpa');

        // Switch porte
        document.getElementById('simSwitchDoor')?.addEventListener('change', (e) => {
          State.current.door = e.target.checked;
          TelemetryService.processIncoming({ ...State.current });
        });

        // Boutons scénarios
        document.querySelectorAll('.btn-scenario').forEach(btn => {
          btn.addEventListener('click', () => {
            SimulationEngine.applyScenario(btn.getAttribute('data-scenario'));
          });
        });

        // Commandes actionneurs (Ventilateur Auto / ON / OFF)
        document.querySelectorAll('.btn-segmented .seg-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-segmented .seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const mode = btn.getAttribute('data-fan');
            State.current.fan_mode = mode;
            if (State.mode === 'mqtt') {
              MqttService.publishCommand({ fan: mode, reason: 'dashboard_ui' });
            }
            TelemetryService.processIncoming({ ...State.current });
          });
        });

        // Boutons sourdine & acquitter
        document.getElementById('btnCmdMute')?.addEventListener('click', () => {
          if (State.mode === 'mqtt') MqttService.publishCommand({ mute: true });
          EventBus.emit('event:new', { level: 'INFO', rule: 'Sourdine', message: 'Alarme sonore coupée par l\'opérateur.', values: 'Mute: true', ts: Date.now() });
        });

        document.getElementById('btnCmdAck')?.addEventListener('click', () => {
          if (State.mode === 'mqtt') MqttService.publishCommand({ ack: true });
          EventBus.emit('event:new', { level: 'INFO', rule: 'Acquittement', message: 'Toutes les alertes ont été acquittées manuellement.', values: 'Ack: true', ts: Date.now() });
        });

        // Bouton réinitialiser
        document.getElementById('btnResetSimulation')?.addEventListener('click', () => {
          SimulationEngine.applyScenario('normal');
        });
      },

      bindEventsToolbar: function() {
        document.querySelectorAll('.filter-pill').forEach(pill => {
          pill.addEventListener('click', () => {
            document.querySelectorAll('.filter-pill').forEach(p => {
              p.classList.remove('active');
              p.setAttribute('aria-selected', 'false');
            });
            pill.classList.add('active');
            pill.setAttribute('aria-selected', 'true');
            currentFilter = pill.getAttribute('data-filter');
            this.filterEvents();
          });
        });

        document.getElementById('eventSearchInput')?.addEventListener('input', () => {
          this.filterEvents();
        });

        document.getElementById('btnAcknowledgeAll')?.addEventListener('click', () => {
          document.getElementById('btnCmdAck')?.click();
        });
      },

      bindReportsExports: function() {
        document.getElementById('btnExportHtml')?.addEventListener('click', () => this.exportReportHtml());
        document.getElementById('btnExportCsv')?.addEventListener('click', () => this.exportEventsCsv());
        document.getElementById('btnPrintReport')?.addEventListener('click', () => window.print());
      },

      bindLayerToggles: function() {
        const toggleLayer = (id, selector) => {
          document.getElementById(id)?.addEventListener('change', (e) => {
            document.querySelectorAll(selector).forEach(el => {
              el.style.display = e.target.checked ? '' : 'none';
            });
          });
        };
        toggleLayer('layerToggleDoor', '#doorSystem');
        toggleLayer('layerToggleVent', '#ventilationSystem');
        toggleLayer('layerToggleLight', '#scialyticLamp');
        toggleLayer('layerToggleMonitors', '#monitor1, #monitor2');
      },

      animateNumber: function(elementId, targetValue, decimals, unit) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const raw = el.getAttribute('data-val');
        const startVal = raw !== null ? parseFloat(raw) : (parseFloat(el.textContent) || 0);
        if (Math.abs(startVal - targetValue) < 0.01) {
          el.textContent = `${targetValue.toFixed(decimals)} ${unit}`;
          return;
        }
        el.setAttribute('data-val', targetValue);
        if (typeof gsap !== 'undefined') {
          const obj = { val: startVal };
          gsap.to(obj, {
            val: targetValue,
            duration: 0.45,
            ease: 'power1.out',
            onUpdate: () => {
              el.textContent = `${obj.val.toFixed(decimals)} ${unit}`;
            }
          });
        } else {
          el.textContent = `${targetValue.toFixed(decimals)} ${unit}`;
        }
      },

      updateFloatingCards: function(cur) {
        const th = CONFIG.thresholds;

        // 1. Luminosité
        const cardLux = document.getElementById('cardLux');
        if (cardLux) {
          this.animateNumber('valLux', cur.lux, 0, 'lx');
          cardLux.classList.remove('state-warn', 'state-crit');
          if (cur.lux < th.lux.crit) {
            cardLux.classList.add('state-crit');
          } else if (cur.lux < th.lux.warn) {
            cardLux.classList.add('state-warn');
          }
        }

        // 2. Température
        const cardTemp = document.getElementById('cardTemp');
        if (cardTemp) {
          this.animateNumber('valTemp', cur.temp, 1, '°C');
          cardTemp.classList.remove('state-warn', 'state-crit');
          if (cur.temp > th.temp.maxCrit) {
            cardTemp.classList.add('state-crit');
          } else if (cur.temp > th.temp.maxWarn || cur.temp < th.temp.minWarn) {
            cardTemp.classList.add('state-warn');
          }
        }

        // 3. Humidité
        const cardHum = document.getElementById('cardHum');
        if (cardHum) {
          this.animateNumber('valHum', cur.hum, 0, '%');
          cardHum.classList.remove('state-warn', 'state-crit');
          if (cur.hum > th.hum.maxCrit) {
            cardHum.classList.add('state-crit');
          } else if (cur.hum > th.hum.maxWarn || cur.hum < th.hum.minWarn) {
            cardHum.classList.add('state-warn');
          }
        }

        // 4. Contact Porte
        const cardDoor = document.getElementById('cardDoor');
        const valDoor = document.getElementById('valDoor');
        const doorBadge = document.getElementById('cardDoorBadge');
        const doorIcon = document.getElementById('doorIconSvg');

        if (cardDoor && valDoor) {
          cardDoor.classList.remove('state-warn', 'state-crit');
          const seconds = State.doorOpenSince ? Math.floor((Date.now() - State.doorOpenSince) / 1000) : 0;

          if (cur.door) {
            valDoor.textContent = 'Ouverte';
            valDoor.className = 'text-2xl font-extrabold text-red-600 tracking-tight transition-colors duration-300';
            if (doorBadge) {
              doorBadge.className = 'w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-red-600/40 transition-colors duration-300 open';
            }
            if (doorIcon) {
              doorIcon.setAttribute('data-lucide', 'lock-open');
              if (typeof lucide !== 'undefined') lucide.createIcons();
            }
            if (seconds >= th.door.critSeconds) cardDoor.classList.add('state-crit');
            else if (seconds >= th.door.warnSeconds) cardDoor.classList.add('state-warn');
          } else {
            valDoor.textContent = 'Fermée';
            valDoor.className = 'text-2xl font-extrabold text-green-600 tracking-tight transition-colors duration-300';
            if (doorBadge) {
              doorBadge.className = 'w-9 h-9 rounded-xl bg-green-600 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-green-600/30 transition-colors duration-300';
            }
            if (doorIcon) {
              doorIcon.setAttribute('data-lucide', 'lock');
              if (typeof lucide !== 'undefined') lucide.createIcons();
            }
          }
        }
      },

      updateHeaderCompliance: function(riskScore, cur) {
        const badge = document.getElementById('globalComplianceBadge');
        const title = document.getElementById('globalComplianceTitle');
        const sub = document.getElementById('globalComplianceSub');
        const icon = document.getElementById('globalComplianceIcon');
        const fill = document.getElementById('riskRingFill');
        const riskTxt = document.getElementById('fusionRiskValue');
        const riskState = document.getElementById('fusionRiskState');

        // Score Fusion AI
        if (riskTxt) riskTxt.textContent = riskScore;
        if (fill) {
          fill.setAttribute('stroke-dasharray', `${riskScore}, 100`);
          fill.style.stroke = (riskScore >= 70) ? '#ef4444' : ((riskScore >= 40) ? '#f59e0b' : '#22c55e');
        }

        if (riskState) {
          riskState.textContent = (riskScore >= 70) ? 'Risque Critique' : ((riskScore >= 40) ? 'Risque Élevé' : ((riskScore >= 20) ? 'Risque Modéré' : 'Risque Faible'));
        }

        // Bandeau global
        if (badge && title && sub && icon) {
          badge.classList.remove('ok', 'warn', 'crit');
          if (riskScore >= 70) {
            badge.classList.add('crit');
            title.textContent = 'BLOC EN ALERTE CRITIQUE';
            sub.textContent = 'Violation des règles d\'asepsie ou de sécurité';
            icon.innerHTML = '<i data-lucide="alert-octagon"></i>';
          } else if (riskScore >= 20) {
            badge.classList.add('warn');
            title.textContent = 'VIGILANCE ENVIRONNEMENTALE';
            sub.textContent = 'Paramètres en dérive modérée';
            icon.innerHTML = '<i data-lucide="alert-triangle"></i>';
          } else {
            badge.classList.add('ok');
            title.textContent = 'BLOC CONFORME';
            sub.textContent = 'Paramètres cliniques nominaux';
            icon.innerHTML = '<i data-lucide="check-circle-2"></i>';
          }
          lucide.createIcons();
        }

        // Bandeau IA en vue d'ensemble
        const aiBanner = document.getElementById('overviewAiAlertBanner');
        const aiTitle = document.getElementById('aiBannerRuleTitle');
        const aiText = document.getElementById('aiBannerRuleText');
        const aiTime = document.getElementById('aiBannerTime');

        if (aiBanner && State.fusion.correlations.length > 0) {
          const firstCorr = State.fusion.correlations[0];
          aiBanner.classList.remove('hidden', 'crit');
          if (firstCorr.level === 'CRITICAL') aiBanner.classList.add('crit');
          if (aiTitle) aiTitle.textContent = firstCorr.title;
          if (aiText) aiText.textContent = firstCorr.desc;
          if (aiTime) aiTime.textContent = new Date().toLocaleTimeString('fr-FR');
        } else if (aiBanner && State.fusion.prediction) {
          aiBanner.classList.remove('hidden', 'crit');
          if (aiTitle) aiTitle.textContent = 'Tendance prédictive IA';
          if (aiText) aiText.textContent = State.fusion.prediction;
          if (aiTime) aiTime.textContent = new Date().toLocaleTimeString('fr-FR');
        } else if (aiBanner) {
          aiBanner.classList.add('hidden');
        }
      },

      updateKpis: function(cur, fusion) {
        const pEl = document.getElementById('kpiPressure');
        const sEl = document.getElementById('kpiServo');
        const fEl = document.getElementById('kpiFanStatus');
        const slEl = document.getElementById('kpiTempSlope');
        const slDesc = document.getElementById('kpiSlopeDesc');
        const cEl = document.getElementById('kpiComplianceRate');

        if (pEl) pEl.innerHTML = `${cur.pressure_hpa.toFixed(1)} <small class="text-xs text-slate-500">hPa</small>`;
        if (sEl) sEl.innerHTML = `${cur.servo_angle.toFixed(0)}° <small class="text-xs text-slate-500">(${cur.fan ? 'ON' : 'OFF'})</small>`;
        if (fEl) fEl.textContent = `Mode ${cur.fan_mode.toUpperCase()}`;
        if (slEl) slEl.innerHTML = `${fusion.tempSlope >= 0 ? '+' : ''}${fusion.tempSlope.toFixed(2)} <small class="text-xs text-slate-500">°C/min</small>`;
        if (slDesc) {
          slDesc.textContent = Math.abs(fusion.tempSlope) < 0.05 ? 'Stable' : (fusion.tempSlope > 0 ? 'En hausse' : 'En baisse');
          slDesc.className = `text-[11px] font-semibold ${Math.abs(fusion.tempSlope) > 0.2 ? 'text-amber-600' : 'text-green-600'}`;
        }
        if (cEl) {
          const rate = State.stats.totalPoints > 0 ? Math.round((State.stats.compliantPoints / State.stats.totalPoints) * 100) : 100;
          cEl.innerHTML = `${rate} <small class="text-xs text-slate-500">%</small>`;
        }

        // Mise à jour de la jauge visuelle de gradient de surpression stérile (ISO 5)
        const pDelta = (cur.pressure_hpa - 1013.25);
        const pDeltaEl = document.getElementById('kpiPressDelta');
        const pBadge = document.getElementById('badgePressState');
        const pDesc = document.getElementById('kpiPressDesc');
        const pMarker = document.getElementById('pressureGaugeMarker');

        if (pDeltaEl) pDeltaEl.textContent = `(ΔP: ${pDelta >= 0 ? '+' : ''}${pDelta.toFixed(1)} Pa)`;
        if (pBadge && pDesc && pMarker) {
          if (cur.pressure_hpa >= 1015.0) {
            pBadge.className = 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700';
            pBadge.textContent = '+15 Pa OK';
            pDesc.className = 'text-[10px] font-semibold text-green-600 block mt-1';
            pDesc.textContent = 'Surpression stérile active (ISO 5)';
            const pos = Math.min(94, Math.max(54, 52 + (cur.pressure_hpa - 1015) * 5.5));
            pMarker.style.left = `${pos}%`;
          } else if (cur.pressure_hpa >= 1011.0) {
            pBadge.className = 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700';
            pBadge.textContent = 'Pression limite';
            pDesc.className = 'text-[10px] font-semibold text-amber-600 block mt-1';
            pDesc.textContent = 'Gradient de surpression affaibli';
            pMarker.style.left = '36%';
          } else {
            pBadge.className = 'text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 animate-pulse';
            pBadge.textContent = 'Dépression Critique';
            pDesc.className = 'text-[10px] font-semibold text-red-600 block mt-1';
            pDesc.textContent = 'Rupture d\'asepsie : risque d\'inversion de flux';
            pMarker.style.left = '10%';
          }
        }
      },

      updateTelemetryTable: function(history) {
        const tbody = document.getElementById('telemetryTableBody');
        if (!tbody) return;
        const recent = history.slice(-CONFIG.limits.tableRows).reverse();
        
        let html = '';
        recent.forEach(r => {
          const timeStr = new Date(r.ts).toLocaleTimeString('fr-FR');
          const isOk = (r.temp >= 20 && r.temp <= 24 && r.hum >= 30 && r.hum <= 60 && !r.door);
          html += `<tr>
            <td><strong>${timeStr}</strong></td>
            <td>${r.temp.toFixed(1)}</td>
            <td>${r.hum.toFixed(0)}</td>
            <td>${r.pressure_hpa.toFixed(1)}</td>
            <td>${r.lux.toFixed(0)}</td>
            <td><span class="status-tag ${r.door ? 'crit' : 'ok'}">${r.door ? 'Ouverte' : 'Fermée'}</span></td>
            <td>${r.fan ? 'ON (' + r.servo_angle.toFixed(0) + '°)' : 'OFF'}</td>
            <td>${State.fusion.riskScore}/100</td>
            <td><span class="status-tag ${isOk ? 'ok' : 'crit'}">${isOk ? 'Conforme' : 'Alerte'}</span></td>
          </tr>`;
        });
        tbody.innerHTML = html;
      },

      addEventToJournal: function(ev) {
        State.events.unshift(ev);
        if (State.events.length > CONFIG.limits.maxEvents) State.events.pop();

        // Incrément des statistiques
        State.stats.alertsByType[ev.rule] = (State.stats.alertsByType[ev.rule] || 0) + 1;

        // Mise à jour du compteur badge sidebar
        const counter = document.getElementById('navEventsCounter');
        if (counter) {
          const critCount = State.events.filter(e => e.level === 'CRITICAL').length;
          counter.textContent = critCount > 0 ? critCount : '';
          counter.setAttribute('data-count', critCount);
        }

        this.filterEvents();
      },

      filterEvents: function() {
        const container = document.getElementById('eventsListContainer');
        if (!container) return;

        const search = document.getElementById('eventSearchInput')?.value.toLowerCase() || '';
        const counts = { ALL: 0, INFO: 0, WARNING: 0, CRITICAL: 0, FUSION_AI: 0 };

        State.events.forEach(e => {
          counts.ALL++;
          if (e.level === 'INFO') counts.INFO++;
          if (e.level === 'WARNING') counts.WARNING++;
          if (e.level === 'CRITICAL') counts.CRITICAL++;
          if (e.rule && e.rule.includes('Fusion AI')) counts.FUSION_AI++;
        });

        const setCnt = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.textContent = val;
        };
        setCnt('countAll', counts.ALL);
        setCnt('countInfo', counts.INFO);
        setCnt('countWarn', counts.WARNING);
        setCnt('countCrit', counts.CRITICAL);
        setCnt('countAi', counts.FUSION_AI);

        const filtered = State.events.filter(e => {
          const matchFilter = (currentFilter === 'ALL') ||
            (currentFilter === 'FUSION_AI' && e.rule && e.rule.includes('Fusion AI')) ||
            (e.level === currentFilter);
          const matchSearch = !search ||
            (e.rule && e.rule.toLowerCase().includes(search)) ||
            (e.message && e.message.toLowerCase().includes(search)) ||
            (e.values && e.values.toLowerCase().includes(search));
          return matchFilter && matchSearch;
        });

        if (filtered.length === 0) {
          container.innerHTML = '<div style="text-align:center; padding:32px; color:#94a3b8;">Aucun événement correspondant aux critères de recherche.</div>';
          return;
        }

        let html = '';
        filtered.forEach(e => {
          const isAi = e.rule && e.rule.includes('Fusion AI');
          const badgeClass = isAi ? 'ai' : (e.level === 'CRITICAL' ? 'crit' : (e.level === 'WARNING' ? 'warn' : 'info'));
          const timeStr = new Date(e.ts).toLocaleTimeString('fr-FR');

          html += `<div class="event-row">
            <span class="event-level-badge ${badgeClass}">${isAi ? 'Fusion AI' : e.level}</span>
            <div class="event-body">
              <div class="event-header-line">
                <span class="event-rule-name">${this.escapeHtml(e.rule)}</span>
                <span class="event-time">${timeStr}</span>
              </div>
              <p class="event-message">${this.escapeHtml(e.message)}</p>
              ${e.values ? `<span class="event-values-tag">${this.escapeHtml(e.values)}</span>` : ''}
            </div>
          </div>`;
        });
        container.innerHTML = html;
      },

      updateReportSummary: function() {
        const s = State.stats;
        const durSec = Math.floor((Date.now() - s.startTime) / 1000);
        const durStr = `${String(Math.floor(durSec / 3600)).padStart(2, '0')}h ${String(Math.floor((durSec % 3600) / 60)).padStart(2, '0')}m`;

        const setT = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.textContent = val;
        };

        setT('repDuration', durStr);
        setT('repPointsCount', `${s.totalPoints} mesures synchronisées`);
        const complianceRate = s.totalPoints > 0 ? ((s.compliantPoints / s.totalPoints) * 100).toFixed(1) : '100.0';
        setT('repCompliance', complianceRate + ' %');
        
        const doorMin = Math.floor(s.doorOpenSeconds / 60);
        const doorSec = s.doorOpenSeconds % 60;
        setT('repDoorDuration', `${String(doorMin).padStart(2, '0')}:${String(doorSec).padStart(2, '0')}`);
        setT('repDoorCount', `${s.doorCycles} cycle(s) d'ouverture`);
        setT('repMaxRisk', `${s.maxRisk} / 100`);
        setT('repAlertsCount', `${State.events.length} incident(s) journalisé(s)`);
        setT('reportGeneratedAt', 'Dernière actualisation : ' + new Date().toLocaleString('fr-FR'));

        // Tableau statistiques
        const tbody = document.getElementById('reportStatsBody');
        if (tbody && s.totalPoints > 0) {
          const avgT = (s.temp.sum / s.totalPoints).toFixed(1);
          const avgH = (s.hum.sum / s.totalPoints).toFixed(0);
          const avgL = (s.lux.sum / s.totalPoints).toFixed(0);

          tbody.innerHTML = `
            <tr>
              <td><strong>Température ambiante</strong></td>
              <td>20,0 – 24,0 °C</td>
              <td>${s.temp.min.toFixed(1)} °C</td>
              <td><strong>${avgT} °C</strong></td>
              <td>${s.temp.max.toFixed(1)} °C</td>
              <td><span class="status-tag ok">Stable (CVC régulé)</span></td>
            </tr>
            <tr>
              <td><strong>Humidité relative</strong></td>
              <td>30 – 60 %</td>
              <td>${s.hum.min.toFixed(0)} %</td>
              <td><strong>${avgH} %</strong></td>
              <td>${s.hum.max.toFixed(0)} %</td>
              <td><span class="status-tag ${avgH > 60 ? 'warn' : 'ok'}">${avgH > 60 ? 'Humidité limite' : 'Zone aseptique'}</span></td>
            </tr>
            <tr>
              <td><strong>Luminosité scialytique</strong></td>
              <td>> 300 lx</td>
              <td>${s.lux.min.toFixed(0)} lx</td>
              <td><strong>${avgL} lx</strong></td>
              <td>${s.lux.max.toFixed(0)} lx</td>
              <td><span class="status-tag ${avgL < 300 ? 'warn' : 'ok'}">${avgL < 300 ? 'Atténuation' : 'Éclairage froid'}</span></td>
            </tr>
          `;
        }

        // Tableau incidents
        const incBody = document.getElementById('reportIncidentsBody');
        if (incBody) {
          let html = '';
          for (let rule in s.alertsByType) {
            html += `<tr>
              <td><strong>${this.escapeHtml(rule)}</strong></td>
              <td><span class="event-level-badge warn">Surveillé</span></td>
              <td>${s.alertsByType[rule]}</td>
              <td>Variable</td>
              <td>Surveillance continue requise</td>
            </tr>`;
          }
          if (!html) html = '<tr><td colspan="5" style="text-align:center; color:#64748b;">Aucune anomalie critique enregistrée sur la séance.</td></tr>';
          incBody.innerHTML = html;
        }
      },

      openEquipmentModal: function(equipKey) {
        const modal = document.getElementById('equipmentModal');
        if (!modal) return;

        const cur = State.current;
        const details = {
          scialytic: {
            title: 'Scialytique Chirurgical & Éclairage',
            role: 'Éclairage du champ opératoire stérile sans ombre portée',
            sensor: 'Photorésistance LDR + Pont diviseur 10 kΩ',
            pin: 'GPIO 34 (Entrée analogique ADC1)',
            val: `${cur.lux.toFixed(0)} lx (ADC brut: ${cur.ldr_raw})`,
            desc: 'La luminosité clinique doit rester supérieure à 300 lx pendant les interventions chirurgicales pour garantir l\'acuité visuelle de l\'équipe opératoire.'
          },
          ventilation: {
            title: 'Système de Ventilation CVC & Volet',
            role: 'Maintien de la pression différentielle stérile et évacuation de la chaleur',
            sensor: 'Capteur environnemental BME280 + Servomoteur SG90',
            pin: 'I2C (SDA GPIO 21 / SCL GPIO 22) & Servo PWM (GPIO 25)',
            val: `Volet: ${cur.servo_angle.toFixed(0)}° • Ventilateur: ${cur.fan ? 'ACTIF' : 'ARRÊT'}`,
            desc: 'Le servomoteur SG90 oriente le volet de surpression entre 45° et 135° pour assurer le balayage d\'air propre vers l\'extérieur du bloc.'
          },
          door: {
            title: 'Sas d\'Accès & Détection Ultrason',
            role: 'Préservation du confinement stérile contre les flux d\'air non filtrés',
            sensor: 'Télémètre ultrasonique HC-SR04',
            pin: 'TRIG (GPIO 4) / ECHO (GPIO 5)',
            val: `État: ${cur.door ? 'OUVERTE' : 'FERMÉE'} • Distance: ${cur.door_distance_cm.toFixed(1)} cm`,
            desc: 'Une porte ouverte plus de 30 secondes altère le confinement stérile et déclenche une alerte de risque d\'aérocontamination croisée.'
          },
          table: {
            title: 'Table d\'Opération Chirurgicale',
            role: 'Support stérile ergonomique et motorisé du patient',
            sensor: 'Centrale inertielle / Surveillance environnementale globale',
            pin: 'Bus d\'alimentation sécurisé',
            val: 'Position neutre verrouillée',
            desc: 'Table à plateau modulaire radiotransparent, équipée de matelas viscoélastiques à décharge de pression.'
          },
          beacon: {
            title: 'Balise Lumineuse d\'Alerte du Bloc',
            role: 'Signalisation optique immédiate des dépassements de conformité',
            sensor: 'Voyant LED haute visibilité',
            pin: 'GPIO 32 (Sortie numérique)',
            val: State.fusion.riskScore >= 70 ? 'Clignotement rapide 5 Hz' : (State.fusion.riskScore >= 20 ? 'Clignotement lent 1 Hz' : 'Éteinte (Normal)'),
            desc: 'Permet à l\'équipe soignante d\'être informée instantanément d\'une dérive environnementale sans dépendre uniquement des alertes sonores.'
          }
        };

        const d = details[equipKey] || details.table;
        document.getElementById('modalEquipTitle').textContent = d.title;
        document.getElementById('modalEquipRole').textContent = d.role;
        document.getElementById('modalEquipSensor').textContent = d.sensor;
        document.getElementById('modalEquipPin').textContent = d.pin;
        document.getElementById('modalEquipValue').textContent = d.val;
        document.getElementById('modalEquipDesc').textContent = d.desc;

        modal.classList.remove('hidden');
        document.getElementById('modalCloseBtn')?.focus();

        const closeHandler = () => {
          modal.classList.add('hidden');
          document.removeEventListener('keydown', keyHandler);
        };
        const keyHandler = (e) => {
          if (e.key === 'Escape') closeHandler();
        };

        document.getElementById('modalCloseBtn').onclick = closeHandler;
        modal.onclick = (e) => { if (e.target === modal) closeHandler(); };
        document.addEventListener('keydown', keyHandler);
      },

      updateWorkflowPipeline: function(cur, fusion) {
        const sSensors = document.getElementById('wfStepSensorsVal');
        const sEsp = document.getElementById('wfStepEspVal');
        const sAi = document.getElementById('wfStepAiVal');
        const sAiLed = document.getElementById('wfStep4Led');
        const sAlert = document.getElementById('wfStepAlertVal');

        if (sSensors) {
          sSensors.textContent = `${cur.temp.toFixed(1)}°C / ${cur.hum.toFixed(0)}% / ${cur.lux.toFixed(0)}lx`;
        }

        if (sEsp) {
          const doorStr = cur.door ? 'Porte Ouverte' : 'Porte Fermée';
          const src = (State.mode === 'serial') ? 'Port Série Direct' : ((State.mode === 'mqtt') ? 'MQTT HiveMQ' : 'Simulateur');
          sEsp.textContent = `${src} • ${doorStr}`;
        }

        if (sAi && sAiLed) {
          const score = fusion ? fusion.riskScore : 0;
          if (score >= 70) {
            sAi.textContent = `CRITICAL (Score ${score})`;
            sAi.className = 'text-[10px] text-red-600 font-bold font-mono truncate';
            sAiLed.className = 'w-2 h-2 rounded-full bg-red-500 animate-ping';
          } else if (score >= 20) {
            sAi.textContent = `WARNING (Score ${score})`;
            sAi.className = 'text-[10px] text-amber-600 font-bold font-mono truncate';
            sAiLed.className = 'w-2 h-2 rounded-full bg-amber-500';
          } else {
            sAi.textContent = `NORMAL (Score ${score})`;
            sAi.className = 'text-[10px] text-emerald-600 font-bold font-mono truncate';
            sAiLed.className = 'w-2 h-2 rounded-full bg-emerald-500';
          }
        }

        if (sAlert) {
          const score = fusion ? fusion.riskScore : 0;
          if (score >= 70) {
            sAlert.textContent = 'Alarme Sonore Active';
          } else if (score >= 20) {
            sAlert.textContent = 'Vigilance Paramètres';
          } else {
            sAlert.textContent = 'Nominal (NF S 90-351)';
          }
        }
      },

      updateConnectionPill: function(state, msg) {
        const dot = document.querySelector('#connStatusPill .status-dot');
        const label = document.getElementById('connStatusLabel');
        const lastTime = document.getElementById('lastSeenTimestamp');

        if (dot) dot.className = `status-dot ${state}`;
        if (label) label.textContent = msg;
        if (lastTime) lastTime.textContent = new Date().toLocaleTimeString('fr-FR');
      },

      exportReportHtml: function() {
        const content = document.getElementById('printableReport')?.innerHTML;
        if (!content) return;
        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport d'Audit Clinique — Smart Operating Room</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #0b1220; }
    h1 { font-size: 20px; text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; }
    .status-tag { font-weight: bold; }
  </style>
</head>
<body>${content}</body>
</html>`;
        this.downloadBlob(html, 'rapport-audit-bloc-or1.html', 'text/html');
      },

      exportEventsCsv: function() {
        if (State.events.length === 0) {
          alert('Aucun événement à exporter.');
          return;
        }
        let csv = 'Horodatage,Niveau,Regle,Message,Valeurs\n';
        State.events.forEach(e => {
          const t = new Date(e.ts).toISOString();
          const clean = str => `"${(str || '').replace(/"/g, '""')}"`;
          csv += `${t},${clean(e.level)},${clean(e.rule)},${clean(e.message)},${clean(e.values)}\n`;
        });
        this.downloadBlob(csv, 'journal-evenements-or1.csv', 'text/csv;charset=utf-8;');
      },

      downloadBlob: function(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },

      escapeHtml: function(str) {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
    };
  })();
  SmartOR.UiController = UiController;

  // --------------------------------------------------------------------------
  // 12. INITIALISATION AU CHARGEMENT DU DOM
  // --------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    // Initialisation des icônes Lucide
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    // Démarrage des composants
    ChartManager.init();
    SceneRenderer.init();
    UiController.init();

    // Démarrage par défaut : Mode Broker MQTT (ESP32 Matériel HiveMQ)
    State.mode = 'mqtt';
    MqttService.connect();

    // Enregistrement de l'événement initial de démarrage
    EventBus.emit('event:new', {
      level: 'INFO',
      rule: 'Système Digital Twin',
      message: 'Connexion active au broker MQTT HiveMQ (sor-p10/bloc-or1). En attente de télémétrie ESP32.',
      values: 'MQTT wss://broker.hivemq.com:8884/mqtt',
      ts: Date.now()
    });
  });

})(window);

