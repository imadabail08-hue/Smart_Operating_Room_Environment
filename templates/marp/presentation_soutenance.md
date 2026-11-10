---
marp: true
theme: default
size: 16:9
paginate: true
math: katex
lang: fr
header: "Smart Operating Room Environment — Projet 10"
footer: "Santé 4.0 · Firmware 1.2.1 · Soutenance technique"
style: |
  :root {
    --navy: #0B2545;
    --teal: #0E7C86;
    --teal-light: #E3F4F5;
    --ink: #101820;
    --grey: #4A5563;
    --line: #C9D3DD;
    --ok-bg: #0B6B3A;
    --warn-bg: #8A5A00;
    --crit-bg: #A4161A;
    --info-bg: #0B2545;
  }
  section {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    background: #FFFFFF;
    color: var(--ink);
    font-size: 24px;
    padding: 64px 70px 56px 70px;
    line-height: 1.35;
  }
  section::after { color: var(--grey); font-size: 15px; }
  header, footer { color: var(--grey); font-size: 14px; }
  h1 { color: var(--navy); font-size: 1.55em; border-bottom: 5px solid var(--teal); padding-bottom: 6px; margin-bottom: 14px; }
  h2 { color: var(--teal); font-size: 1.05em; margin: 0 0 6px 0; }
  strong { color: var(--navy); }
  a { color: var(--teal); }
  code { background: var(--teal-light); color: var(--navy); border-radius: 4px; padding: 0 5px; font-size: 0.85em; }
  table { font-size: 0.68em; border-collapse: collapse; width: 100%; }
  th { background: var(--navy); color: #FFFFFF; padding: 6px 10px; text-align: left; }
  td { border-bottom: 1px solid var(--line); padding: 5px 10px; background: #FFFFFF; }
  tr:nth-child(even) td { background: #F3F7FA; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  .columns3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
  .columns4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 14px; font-size: 0.8em; }
  .card { border: 2px solid var(--navy); border-left: 10px solid var(--teal); border-radius: 6px; padding: 10px 16px; background: #FFFFFF; }
  .card.crit { border-left-color: var(--crit-bg); }
  .card.warn { border-left-color: var(--warn-bg); }
  .card h2 { margin-top: 0; }
  .badge { display: inline-block; color: #FFFFFF; font-weight: 700; font-size: 0.62em; padding: 2px 10px; border-radius: 12px; letter-spacing: 0.4px; }
  .ok { background: var(--ok-bg); }
  .warn-b { background: var(--warn-bg); }
  .crit-b { background: var(--crit-bg); }
  .info { background: var(--info-bg); }
  .kpi { text-align: center; border: 2px solid var(--navy); border-radius: 8px; padding: 10px 6px; }
  .kpi .v { font-size: 1.9em; font-weight: 800; color: var(--navy); line-height: 1.05; }
  .kpi .l { font-size: 0.62em; color: var(--grey); }
  .small { font-size: 0.7em; color: var(--grey); }
  section.lead { background: var(--navy); color: #FFFFFF; justify-content: center; }
  section.lead h1 { color: #FFFFFF; border-bottom: 6px solid var(--teal); font-size: 2.1em; }
  section.lead h2 { color: #8FE0E6; font-size: 1.1em; }
  section.lead strong { color: #FFFFFF; }
  section.lead header, section.lead footer, section.lead::after { color: #B9C7D6; }
  section.end { background: var(--teal-light); }
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Smart Operating Room Environment

## Surveillance environnementale d'un bloc opératoire, ESP32 et jumeau numérique 3D

**Projet 10 · Santé 4.0**

<span class="badge ok">FIRMWARE 1.2.1</span> <span class="badge info">PROTOTYPE DE DÉMONSTRATION</span>

<span class="small" style="color:#B9C7D6">Soutenance technique · 24 octobre 2026</span>

<!--
Ouverture : le projet surveille en continu température, hygrométrie, éclairement et porte d'un bloc opératoire, agit localement sur la ventilation, et alimente un jumeau numérique qui calcule un indice de risque explicable.
Préciser dès le départ que c'est un prototype de surveillance complémentaire, pas un système de qualification ISO 14644 ou NF S 90-351.
-->

---

# Enjeux cliniques

<div class="columns">
<div>

## Pourquoi surveiller ?

- **Infections associées aux soins** : l'air, l'humidité et les flux de personnes influencent le risque
- **Porte du sas** : chaque ouverture perturbe la surpression et les flux
- **Confort et sécurité** : chaleur excessive, froid, électricité statique
- **Traçabilité** : un historique daté pour l'audit d'hygiène

</div>
<div>

## Cadre de référence

| Référence | Rôle |
| :--- | :--- |
| ISO 14644-1 | Classes de propreté particulaire |
| NF S 90-351 | Zones à risque 1 à 4 en santé |
| Zone 4 | ISO 5, flux unidirectionnel, 19 à 26 °C |

<span class="badge warn-b">VALEURS À VÉRIFIER SUR LE TEXTE EN VIGUEUR</span>

</div>
</div>

<!--
Les valeurs de la zone 4 proviennent de documentation publique (version 2013). À confirmer sur le texte AFNOR avant tout usage réglementaire.
-->

---

# Périmètre : ce que le système fait, et ne fait pas

<div class="columns">
<div class="card">

## Couvert <span class="badge ok">INCLUS</span>

- Température, humidité, pression (BME280)
- Éclairement indicatif (LDR)
- État de la porte (ultrason HC-SR04)
- Asservissement du volet CVC (servo SG90)
- Alerte LED, buzzer, journal d'audit
- Jumeau 3D et indice Fusion AI

</div>
<div class="card crit">

## Hors périmètre <span class="badge crit-b">EXCLU</span>

- Comptage particulaire, UFC
- Pression différentielle entre locaux
- Pilotage de la vraie centrale de traitement d'air
- Qualification métrologique
- **Preuve de conformité ISO 14644 / NF S 90-351**

</div>
</div>

<!--
Message clé : surveillance complémentaire des facteurs d'influence de la contamination. La qualification de la salle reste du ressort d'un laboratoire compétent.
-->

---

# Architecture système en quatre couches

<div class="columns4">
<div class="card">

## Terrain
BME280 · LDR · HC-SR04 · SG90 · LED · buzzer

</div>
<div class="card">

## Embarquée
ESP32 DevKit v1 · `loop()` · règles à hystérésis

</div>
<div class="card">

## Transport
Wi-Fi · MQTT 1883 · WSS 8884 · webhook HTTPS

</div>
<div class="card">

## Supervision
`app.js` · Three.js · Fusion AI · journal

</div>
</div>

<br>

![h:340 center](../../output/architecture_materielle.png)

<!--
Le synoptique complet est généré depuis output/architecture_materielle.mmd. Insister sur le fait que l'alerte locale ne dépend pas du réseau.
-->

---

# Architecture matérielle : ESP32 DevKit v1

| GPIO | Signal | Périphérique | Remarque |
| :--- | :--- | :--- | :--- |
| 21 / 22 | SDA / SCL, I²C | BME280 (0x76 ou 0x77) | Détection automatique de l'adresse |
| 33 | ADC1, 12 bits | LDR + 10 kΩ | Moyenne de 16 échantillons |
| 4 / 5 | TRIG / ECHO | HC-SR04 | **Pont diviseur sur ECHO (5 V vers 3,3 V)** |
| 25 | PWM 50 Hz | Servo SG90 | Alimentation 5 V séparée |
| 32 | Sortie | LED d'alerte | 1 Hz warning, 5 Hz critical |
| 26 | Sortie | Buzzer actif | 200 ms par seconde en critical |

<span class="badge info">LE CODE FAIT FOI</span> <span class="badge warn-b">README ET EN-TÊTE DU FICHIER À CORRIGER</span>

<span class="small">Écarts relevés : LDR (33 dans le code, 34 dans le README), buzzer, ultrason et adresse du BME280.</span>

<!--
Le dossier technique contient la matrice complète avec tensions et recommandations de câblage. Les écarts de documentation sont listés au chapitre 5.5.
-->

---

# Firmware : seuils et hystérésis

<div class="columns">
<div>

| Alerte | WARNING | CRITICAL |
| :--- | :--- | :--- |
| Température haute | > 24,0 °C | > 26,0 °C |
| Température basse | < 20,0 °C | < 18,0 °C |
| Humidité haute | > 60 % | > 70 % |
| Humidité basse | < 30 % | < 20 % |
| Éclairement | < 300 | < 100 |
| Porte ouverte | > 30 s | > 120 s |

</div>
<div>

## Asservissement CVC

- ON : **T ≥ 23,5 °C** ou **HR ≥ 55 %**
- OFF : **T ≤ 22,5 °C** et **HR ≤ 50 %**
- Servo : balayage 45° ↔ 135°, pas de 3° / 15 ms
- Critique thermique : ventilation **forcée**

<span class="badge ok">ANTICIPE LE SEUIL DE 24 °C</span>

</div>
</div>

<span class="small">Hystérésis : 0,5 °C · 2 % HR · 20 sur l'éclairement. Une alerte ne retombe qu'après franchissement de la bande.</span>

<!--
Expliquer l'hystérésis : à 24,2 °C l'alerte se lève, elle ne s'efface qu'à 23,5 °C ou moins, ce qui évite les oscillations autour du seuil.
-->

---

# Processus médical (BPMN 2.0)

![h:420 center](../../output/bpmn_processus_medical.png)

<span class="small">Surveillance continue → franchissement de seuils → asservissement CVC → alarme → acquittement soignant.</span>

<!--
Dérouler le diagramme couloir par couloir. Préciser que Mermaid émule la notation BPMN ; un livrable BPMN 2.0 en XML demande un éditeur dédié.
-->

---

# Moteur Fusion AI : un score explicable

<div class="columns">
<div>

$$R=\min\Big(100,\ r_T+r_H+r_L+r_D+B_1+B_2+B_3\Big)$$

| Grandeur | Poids max |
| :--- | :--- |
| Température | 35 |
| Humidité | 25 |
| Éclairement | 15 |
| Porte | 25 |

</div>
<div>

## Corrélations cliniques

- Porte ouverte **et** humidité en hausse : **+12**
- T > 24 °C **et** ventilation arrêtée : **+10**
- Éclairement < 100 **et** porte ouverte : **+8**

<span class="badge ok">R < 20 LOW</span> <span class="badge info">20 à 39 MODERATE</span> <span class="badge warn-b">40 à 69 HIGH</span> <span class="badge crit-b">≥ 70 CRITICAL</span>

</div>
</div>

**Prédiction** : régression sur 60 s, alerte si le seuil de 24 °C est atteint en moins de 5 min.

<!--
Règles expertes, déterministes, explicables : ce n'est pas du machine learning. Les pondérations sont à valider cliniquement. Exemple : T=25,2 ; HR=62 ; 250 ; porte 45 s ; ventilation arrêtée donne 68 (HIGH), et 80 (CRITICAL) avec une montée d'humidité de 1,4 %/min.
-->

---

# Démonstration du jumeau numérique 3D

<div class="columns">
<div>

## Scénario de démonstration

1. **État nominal** : 21,4 °C, 48 %, porte fermée, indice 0
2. **Ouverture de porte** : chronomètre d'ouverture, événement journalisé
3. **Dérive thermique** : ventilation, servo en balayage
4. **Alarme critique** : LED rapide, buzzer
5. **Acquittement** puis retour à la normale

</div>
<div>

## Les 5 vues

| Vue | Contenu |
| :--- | :--- |
| `#overview` | Scène 3D, cartes, indice |
| `#room` | Inspection caméra |
| `#live` | Graphiques temps réel |
| `#events` | Journal, acquittement |
| `#reports` | Audit, export CSV, HTML, PDF |

</div>
</div>

<span class="badge info">THREE.JS</span> <span class="badge info">CHART.JS</span> <span class="badge info">MQTT / WSS</span> <span class="badge ok">MODES : SIM · MQTT · REPLAY</span>

<!--
Lancer le jumeau (Live Server ou python -m http.server 8000). Le mode simulation permet de dérouler le scénario sans matériel ; le mode MQTT utilise le broker public de démonstration.
-->

---

# Métriques clés

<div class="columns3">
<div class="kpi"><div class="v">2 s</div><div class="l">période de mesure et de publication</div></div>
<div class="kpi"><div class="v">150 ms</div><div class="l">scrutation de la porte, anti-rebond 80 ms</div></div>
<div class="kpi"><div class="v">7</div><div class="l">codes d'alerte à deux niveaux</div></div>
</div>

<br>

| Indicateur | Valeur | Statut |
| :--- | :--- | :--- |
| Graphe Graphify | 69 nœuds · 105 arêtes · 9 communautés | <span class="badge ok">EXTRAIT</span> |
| Alerte locale sans réseau | LED, buzzer, servo autonomes | <span class="badge ok">IMPLÉMENTÉ</span> |
| Détection porte | < 0,5 s attendu | <span class="badge warn-b">À VALIDER EN RECETTE</span> |
| Précision T / HR | ±0,5 °C / ±3 % attendu | <span class="badge warn-b">À VALIDER EN RECETTE</span> |
| Éclairement | Indicatif, non étalonné | <span class="badge crit-b">ÉCART</span> |
| Sécurité des échanges | Broker public, sans authentification | <span class="badge crit-b">ÉCART</span> |

<!--
Aucun résultat de recette n'est affiché : les essais T-01 à T-23 du dossier technique restent à exécuter. Les valeurs « attendues » sont des critères d'acceptation proposés.
-->

---

# Limites et feuille de route

<div class="columns">
<div class="card crit">

## Priorité haute <span class="badge crit-b">À TRAITER</span>

- Sécuriser MQTT : broker privé, TLS, ACL sur `/cmd`
- Sortir la requête HTTPS de la boucle principale
- Acquittement **local** par bouton

</div>
<div class="card warn">

## Priorité moyenne <span class="badge warn-b">PLANIFIÉ</span>

- Contrat de seuils unique firmware / jumeau
- Étalonnage de l'éclairement
- Extraire et tester `FusionEngine`
- Valider les pondérations avec l'hygiène hospitalière

</div>
</div>

<span class="small">Détail : chapitres 10 et 12 du dossier technique SOR-P10-DTG-001.</span>

<!--
Être franc sur deux points : un acquittement distant sur un broker public peut couper un buzzer critique, et un appel HTTPS bloquant peut figer la boucle de plusieurs secondes.
-->

---

<!-- _class: end -->

# Conclusion

- Une chaîne complète **capteurs → règles locales → MQTT → jumeau 3D**
- Un moteur de risque **explicable**, formalisé mathématiquement
- Un **plan de recette** de 23 essais et une traçabilité exigences / tests
- Un prototype **prêt à être durci**, pas encore à être déployé en clinique

<br>

<span class="badge ok">ÉTAPE SUIVANTE</span> **Recette en laboratoire, puis sécurisation du transport**

## Merci · Questions

<!--
Clôture : revenir sur la distinction entre surveillance complémentaire et qualification de la salle. Inviter aux questions.
-->
