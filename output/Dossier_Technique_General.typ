#let horizontalrule = line(start: (25%,0%), end: (75%,0%))

#show terms.item: it => block(breakable: false)[
  #text(weight: "bold")[#it.term]
  #block(inset: (left: 1.5em, top: -0.4em))[#it.description]
]

#set table(
  inset: 6pt,
  stroke: none
)

#show figure.where(
  kind: table
): set figure.caption(position: top)

#show figure.where(
  kind: image
): set figure.caption(position: bottom)

#let content-to-string(content) = {
  if content.has("text") {
    content.text
  } else if content.has("children") {
    content.children.map(content-to-string).join("")
  } else if content.has("body") {
    content-to-string(content.body)
  } else if content == [ ] {
    " "
  }
}
#let conf(
  title: none,
  subtitle: none,
  authors: (),
  keywords: (),
  date: none,
  abstract-title: none,
  abstract: none,
  thanks: none,
  cols: 1,
  margin: (x: 1.25in, y: 1.25in),
  paper: "us-letter",
  lang: "en",
  region: "US",
  font: none,
  fontsize: 11pt,
  mathfont: none,
  codefont: none,
  linestretch: 1,
  sectionnumbering: none,
  linkcolor: none,
  citecolor: none,
  filecolor: none,
  pagenumbering: "1",
  doc,
) = {
  set document(
    title: title,
    keywords: keywords,
  )
  set document(
      author: authors.map(author => content-to-string(author.name)).join(", ", last: " & "),
  ) if authors != none and authors != ()
  set page(
    paper: paper,
    margin: margin,
    numbering: pagenumbering,
    columns: cols
  )

  set par(
    justify: true,
    leading: linestretch * 0.65em
  )
  set text(lang: lang,
           region: region,
           size: fontsize)

  set text(font: font) if font != none
  show math.equation: set text(font: mathfont) if mathfont != none
  show raw: set text(font: codefont) if codefont != none

  set heading(numbering: sectionnumbering)

  show link: set text(fill: rgb(content-to-string(linkcolor))) if linkcolor != none
  show ref: set text(fill: rgb(content-to-string(citecolor))) if citecolor != none
  show link: this => {
    if filecolor != none and type(this.dest) == label {
      text(this, fill: rgb(content-to-string(filecolor)))
    } else {
      text(this)
    }
  }

  if title != none {
    place(top, float: true, scope: "parent", clearance: 4mm, block(below: 1em, width: 100%)[
      #if title != none {
        align(center, block[
            #text(weight: "bold", size: 1.5em, hyphenate: false)[#title #if thanks != none {
                footnote(thanks, numbering: "*")
                counter(footnote).update(n => n - 1)
              }]
            #(
              if subtitle != none {
                parbreak()
                text(weight: "bold", size: 1.25em, hyphenate: false)[#subtitle]
              }
             )])
      }

      #if authors != none and authors != [] {
        let count = authors.len()
        let ncols = calc.min(count, 3)
        grid(
          columns: (1fr,) * ncols,
          row-gutter: 1.5em,
          ..authors.map(author => align(center)[
            #author.name \
            #author.affiliation \
            #author.email
          ])
        )
      }

      #if date != none {
        align(center)[#block(inset: 1em)[
            #date
          ]]
      }

      #if abstract != none {
        block(inset: 2em)[
          #text(weight: "semibold")[#abstract-title] #h(1em) #abstract
        ]
      }
    ])
  }
  doc
}
#show: doc => conf(
  title: [Smart Operating Room Environment --- Dossier Technique Général
d'Architecture],
  subtitle: [Surveillance environnementale d'un bloc opératoire (zone à
risque 4) --- ESP32, MQTT, jumeau numérique 3D et moteur Fusion AI],
  authors: (
    ( name: [Architecte Système Principal --- Ingénierie Santé 4.0],
      affiliation: "",
      email: "" ),
    ),
  date: [24 octobre 2026],
  lang: "fr",
  abstract-title: [Résumé],
  pagenumbering: "1",
  cols: 1,
  doc,
)

#outline(
  title: auto,
  depth: 3
);

#heading(level: 1, numbering: none)[Fiche d'identification du document]
<fiche-didentification-du-document>
#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Champ], [Valeur],),
    table.hline(),
    [Projet], [Projet 10 --- Smart Operating Room Environment],
    [Référence du document], [SOR-P10-DTG-001],
    [Version du document], [1.0 (première édition)],
    [Date], [24 octobre 2026],
    [Firmware décrit], [ESP32 v1.2.1 (`src/main.cpp`)],
    [Jumeau numérique décrit], [`app.js` (en-tête : version 1.0.0),
    `index.html`, `style.css`],
    [Identifiant d'appareil], [`esp32-or1`],
    [Racine des topics MQTT], [`sor-p10/bloc-or1`],
    [Statut], [Prototype de démonstration --- voir §1.4],
  )]
  , kind: table
  )

#heading(level: 2, numbering: none)[Historique des révisions]
<historique-des-révisions>
#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Version], [Date], [Nature de la modification],),
    table.hline(),
    [1.0], [24/10/2026], [Création : analyse du code (graphe Graphify +
    lecture du firmware et du moteur Fusion AI), architecture, contrats,
    plan de recette],
  )]
  , kind: table
  )

#heading(level: 2, numbering: none)[Méthode d'élaboration et sources]
<méthode-délaboration-et-sources>
Ce dossier s'appuie sur trois sources, par ordre de priorité :

+ #strong[Le code source] (`src/main.cpp`, lu intégralement \; `app.js`,
  lu de la ligne 1 à la ligne 480 : configuration, état, `FusionEngine`,
  `TelemetryService`). #strong[Le code fait foi] en cas de divergence.
+ #strong[Le graphe de connaissances Graphify] (69 nœuds, 105 arêtes, 9
  communautés, 100 % d'arêtes extraites) pour la cartographie des
  fonctions et des appels. Le graphe n'indexe ni `FusionEngine`, ni la
  plupart des fonctions imbriquées de `app.js` (seules 11 fonctions de
  ce fichier y figurent) : l'analyse du moteur Fusion AI repose donc sur
  la lecture directe du code.
+ #strong[Le `README.md` du projet], utilisé comme complément, avec les
  écarts relevés au §5.5.

Les parties de `app.js` situées après la ligne 480 (client MQTT, vues,
scène Three.js, rapports) n'ont pas été relues ligne à ligne : leur
description provient du graphe et du README et est signalée comme telle.

= Objet, périmètre et références
<objet-périmètre-et-références>
== Objet
<objet>
Définir l'architecture matérielle, logicielle et fonctionnelle d'un
système de surveillance continue de l'environnement d'une salle
d'opération : température, hygrométrie, pression, éclairement ambiant et
état de la porte du sas. Le système commande localement un volet de
ventilation (servomoteur), signale les dérives par LED et buzzer, et
transmet la télémétrie à un jumeau numérique 3D qui calcule un indice de
risque explicable.

== Périmètre
<périmètre>
#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Inclus], [Exclus],),
    table.hline(),
    [Acquisition T / HR / P (BME280), éclairement (LDR), porte
    (ultrason)], [Comptage particulaire et prélèvements
    microbiologiques],
    [Alertes à deux niveaux avec hystérésis, signalisation
    locale], [Mesure de la pression différentielle entre locaux],
    [Asservissement du volet CVC par servomoteur], [Pilotage de la
    centrale de traitement d'air (CTA) réelle],
    [Transport MQTT/WSS, repli HTTPS, journal
    d'événements], [Intégration au GTB/GTC hospitalier],
    [Jumeau numérique 3D, Fusion AI, rapports d'audit], [Qualification
    métrologique des capteurs],
  )]
  , kind: table
  )

== Références
<références>
#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Référence], [Usage dans ce dossier],),
    table.hline(),
    [NF EN ISO 14644-1], [Classification de la propreté particulaire de
    l'air (classes ISO 1 à 9), cadre de référence],
    [NF EN ISO 14644-2], [Surveillance des performances d'une salle
    propre, cadre de référence],
    [NF S 90-351 (version d'avril 2013)], [Établissements de santé,
    zones à environnement maîtrisé, exigences de maîtrise de la
    contamination aéroportée \; classification en zones à risque 1 à 4],
    [IEC 60601-1-8], [Référence indicative pour la conception de signaux
    d'alarme (priorités, signalisation) \; le prototype n'en revendique
    pas la conformité],
  )]
  , kind: table
  )

#strong[Valeurs de la zone 4 relevées dans la documentation publique]
(fabricants, guides professionnels) pour la version 2013 de la NF S
90-351 : classe particulaire ISO 5, cinétique de décontamination CP 5,
classe microbiologique M1, flux unidirectionnel sous la zone protégée,
surpression d'environ 15 Pa ± 5 Pa, plage de température de 19 à 26 °C,
niveau sonore maximal de 48 dBA en zone 4. #strong[Ces valeurs doivent
être vérifiées sur le texte normatif en vigueur] (AFNOR) avant tout
usage réglementaire. Des documents antérieurs ou secondaires indiquent
d'autres valeurs (par exemple CP 10, ou des classes bactériologiques « B
») : elles correspondent à des éditions plus anciennes.

== Portée de la conformité (lecture obligatoire)
<portée-de-la-conformité-lecture-obligatoire>
Le système est un #strong[dispositif de surveillance environnementale
complémentaire]. Il ne mesure ni les particules, ni les UFC, ni la
pression différentielle : il #strong[ne permet donc pas de démontrer la
conformité à l'ISO 14644-1 ni à la NF S 90-351]. Ces normes imposent des
essais de qualification (comptage particulaire, cinétique de
décontamination, débits, pressions, contrôles microbiologiques) réalisés
par du personnel et des instruments qualifiés. Le système apporte une
#strong[surveillance en continu des paramètres de confort et de
maîtrise] (température, hygrométrie, éclairement, ouverture de porte)
qui sont des facteurs d'influence de la contamination, et un historique
d'audit.

Les seuils du prototype (20 à 24 °C, 30 à 60 % HR) sont des
#strong[paramètres de projet], plus resserrés que la plage de 19 à 26 °C
de la norme sur la température. Ils ne sont pas cités comme exigences de
la norme. Les seuils d'hygrométrie et d'éclairement sont à valider avec
l'équipe d'hygiène hospitalière du site.

= Contexte clinique
<contexte-clinique>
== Enjeux
<enjeux>
Le bloc opératoire est un environnement où l'air, la température,
l'hygrométrie et les flux de personnes influencent le risque d'infection
associée aux soins et le confort des équipes. Les facteurs suivants sont
surveillés :

#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Facteur], [Risque clinique ou opérationnel associé],),
    table.hline(),
    [Température élevée], [Inconfort de l'équipe chirurgicale,
    dégradation du matériel électronique, défaillance possible de la
    ventilation],
    [Température basse], [Risque d'hypothermie du patient, notamment en
    chirurgie longue],
    [Hygrométrie élevée], [Condensation et conditions favorables à la
    prolifération microbienne],
    [Hygrométrie basse], [Décharges électrostatiques, dessèchement des
    muqueuses],
    [Éclairement insuffisant], [Visibilité dégradée du champ opératoire
    (hors scialytique)],
    [Porte ouverte], [Rupture du confinement : perturbation des flux et
    de la surpression, entrée d'air non maîtrisé],
  )]
  , kind: table
  )

== Parcours d'usage
<parcours-dusage>
+ Le système surveille en continu, sans intervention humaine.
+ Une dérive franchit un seuil : le firmware lève une alerte, actionne
  le volet de ventilation si nécessaire, allume la LED et, en niveau
  critique, déclenche le buzzer.
+ Le jumeau numérique reçoit la télémétrie, calcule l'indice de risque
  Fusion AI, journalise et affiche l'état.
+ Le soignant évalue la situation, agit (fermeture de porte, forçage de
  ventilation) puis acquitte l'alarme.
+ Le retour à la normale, après franchissement de l'hystérésis, clôt
  l'événement.

== Acteurs
<acteurs>
#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Acteur], [Rôle],),
    table.hline(),
    [Chirurgien, infirmier de bloc (IBODE)], [Perçoit les alarmes
    locales, acquitte, agit sur la porte],
    [Cadre de bloc, hygiéniste], [Consulte le journal d'audit et les
    rapports],
    [Technicien biomédical, service technique], [Maintenance,
    étalonnage, paramétrage des seuils],
    [RSSI / DSI], [Sécurisation du transport et des accès],
  )]
  , kind: table
  )

= Exigences
<exigences>
#figure(
  align(center)[#table(
    columns: (25%, 25%, 25%, 25%),
    align: (left,left,left,left,),
    table.header([ID], [Exigence], [Origine], [Vérifiée par],),
    table.hline(),
    [EXG-01], [Mesurer température, hygrométrie et pression toutes les 2
    s], [`SENSOR_INTERVAL_MS`], [T-01],
    [EXG-02], [Estimer l'éclairement ambiant (valeur
    indicative)], [`readSensors()`], [T-04],
    [EXG-03], [Détecter l'ouverture et la fermeture de la porte en moins
    de 0,5 s], [`ULTRASONIC_INTERVAL_MS`, `DOOR_DEBOUNCE_MS`], [T-05],
    [EXG-04], [Lever des alertes WARNING et CRITICAL avec hystérésis
    pour éviter les oscillations], [`levelHigh()`, `levelLow()`], [T-06
    à T-09],
    [EXG-05], [Asservir le volet CVC à la température et à
    l'hygrométrie], [`updateFan()`, `updateServo()`], [T-10 à T-12],
    [EXG-06], [Signaler localement par LED (deux cadences) et buzzer
    (niveau critique)], [`updateOutputs()`], [T-13, T-14],
    [EXG-07], [Permettre l'acquittement sonore à
    distance], [`onMqttMessage()`], [T-15],
    [EXG-08], [Publier la télémétrie toutes les 2 s et les événements au
    changement d'état], [`publishTelemetry()`], [T-16],
    [EXG-09], [Calculer et afficher un indice de risque
    explicable], [`FusionEngine.evaluate()`], [T-19, T-20],
    [EXG-10], [Rester fonctionnel localement en cas de perte
    réseau], [`loop()`], [T-17],
    [EXG-11], [Détecter un défaut de capteur
    T/H], [`dhtFailCount`], [T-18],
    [EXG-12], [Journaliser les événements avec
    horodatage], [`publishEvent()`, journal du jumeau], [T-16, T-21],
    [EXG-13], [Authentifier et chiffrer les échanges, restreindre les
    commandes], [---], [#strong[Non satisfaite] (§10)],
  )]
  , kind: table
  )

= Architecture générale
<architecture-générale>
== Vue d'ensemble
<vue-densemble>
Le système comprend quatre couches : capteurs et actionneurs, firmware
embarqué, transport, supervision.

#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Couche], [Composants], [Rôle],),
    table.hline(),
    [Terrain], [BME280, LDR, HC-SR04, servomoteur SG90, LED,
    buzzer], [Mesure et action physique],
    [Embarquée], [ESP32 DevKit v1, firmware 1.2.1], [Acquisition, règles
    d'alerte, asservissement, publication],
    [Transport], [Wi-Fi 2,4 GHz, broker MQTT HiveMQ, webhook
    HTTPS], [Acheminement de la télémétrie et des commandes],
    [Supervision], [`index.html`, `app.js` (Three.js, Chart.js,
    `FusionEngine`)], [Jumeau 3D, indice de risque, journal, rapports],
  )]
  , kind: table
  )

#figure(image("architecture_materielle.png", alt: "Synoptique d’architecture matérielle"),
  caption: [
    Synoptique d'architecture matérielle
  ]
)

== Cartographie issue du graphe Graphify
<cartographie-issue-du-graphe-graphify>
Le graphe extrait de `src/main.cpp` et `app.js` donne la structure
suivante. Les communautés sont les regroupements calculés par Graphify
\; le libellé fonctionnel est proposé par l'analyste.

#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Communauté], [Contenu], [Rôle],),
    table.hline(),
    [0], [`Arduino`, `WiFi`, `PubSubClient`, `ArduinoJson`,
    `ESP32Servo`, `Wire`, `Adafruit_BME280`, `Adafruit_Sensor`, `DHT`,
    `HTTPClient`, `WiFiClientSecure`, `time`, `math`], [Dépendances
    importées],
    [1], [`loop()`, `publishEvent()`, `publishJson()`,
    `publishStatus()`, `publishTelemetry()`, `buildTelemetry()`,
    `ensureWifi()`, `ensureMqtt()`, `onMqttMessage()`, `updateFan()`,
    `epochNow()`, `round1()`], [Communication et orchestration],
    [2], [`buildRoom()`, `buildDoor()`, `buildSurgicalTable()`,
    `buildScialyticLamp()`, `buildVentilationSystem()`,
    `buildMedicalEquipment()`, `createHospitalTileTexture()`,
    `initMonitorCanvas()`, `updateMonitorCanvas()`,
    `updateLeaderLines()`, `computeLinearSlope()`,
    `formatTimeLabel()`], [Jumeau numérique (`app.js`)],
    [3], [`AlertId` et ses 8 membres], [Énumération des alertes],
    [4], [`evaluateAlerts()`, `levelHigh()`, `levelLow()`,
    `alertValue()`, `doorOpenSeconds()`], [Moteur de règles à
    hystérésis],
    [5], [`setup()`, `readSensors()`, `readDoor()`,
    `readUltrasonicDistanceCM()`, `buzzerInit()`], [Initialisation et
    acquisition],
    [6], [`updateOutputs()`, `updateServo()`, `buzzerWrite()`,
    `selfTest()`], [Actionneurs],
    [7], [`FanMode` : `FAN_AUTO`, `FAN_FORCE_ON`,
    `FAN_FORCE_OFF`], [Modes de ventilation],
  )]
  , kind: table
  )

Nœuds les plus connectés (« god nodes ») : `loop()` (11 arêtes),
`AlertId` (9), `publishEvent()` (9), `evaluateAlerts()` (8),
`buildTelemetry()` (6), `setup()` (6).

=== Graphe d'appels du firmware
<graphe-dappels-du-firmware>
#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Appelant], [Appelés],),
    table.hline(),
    [`setup()`], [`buzzerInit()`, `selfTest()`,
    `readUltrasonicDistanceCM()`, `readSensors()`, `evaluateAlerts()`],
    [`loop()`], [`ensureWifi()`, `ensureMqtt()`, `readDoor()`,
    `readSensors()`, `evaluateAlerts()`, `updateFan()`,
    `updateOutputs()`, `publishTelemetry()`],
    [`readDoor()`], [`readUltrasonicDistanceCM()`, `publishEvent()`],
    [`evaluateAlerts()`], [`levelHigh()`, `levelLow()`, `alertValue()`,
    `doorOpenSeconds()`, `publishEvent()`],
    [`updateFan()`], [`publishEvent()`],
    [`updateOutputs()`], [`buzzerWrite()`, `updateServo()`],
    [`publishTelemetry()`], [`buildTelemetry()`],
    [`buildTelemetry()`], [`epochNow()`, `round1()`,
    `doorOpenSeconds()`],
    [`publishEvent()`], [`epochNow()`, `round1()`, `publishJson()`],
    [`publishStatus()`], [`publishJson()`],
    [`ensureMqtt()`], [`publishStatus()`, `publishEvent()`],
    [`onMqttMessage()`], [`publishEvent()`],
    [`selfTest()`], [`buzzerWrite()`],
  )]
  , kind: table
  )

=== Moteur Fusion AI : absent du graphe
<moteur-fusion-ai-absent-du-graphe>
Aucun nœud du graphe ne correspond au moteur Fusion AI : il est défini
dans une fonction immédiatement invoquée (`FusionEngine`) dont les
méthodes ne sont pas extraites. Il a été analysé par lecture directe du
code (§8). Pour l'intégrer au graphe, il faut régénérer Graphify après
avoir extrait `FusionEngine` en module de premier niveau.

== Processus médical (BPMN 2.0)
<processus-médical-bpmn-2.0>
Le processus de bout en bout comprend cinq couloirs : surveillance
continue, franchissement de seuils, asservissement CVC et alarme, Fusion
AI, acquittement par le soignant. Mermaid n'ayant pas de type BPMN
natif, la notation est émulée par un diagramme de flux (événements en
cercles, passerelles en losanges, sous-processus à bord double). Pour un
livrable BPMN 2.0 strictement conforme (XML, interchangeable avec un
outil de modélisation), le diagramme doit être redessiné dans un éditeur
BPMN.

#figure(image("bpmn_processus_medical.png", alt: "Processus médical : de la surveillance à l’acquittement"),
  caption: [
    Processus médical : de la surveillance à l'acquittement
  ]
)

== Cycle d'exécution du firmware
<cycle-dexécution-du-firmware>
La boucle `loop()` s'exécute sans interruption. Les périodes sont gérées
par comparaison à `millis()`.

#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Étape], [Fonction], [Période ou déclencheur],),
    table.hline(),
    [1], [`ensureWifi()`], [À chaque tour \; tentative toutes les 10 s
    si déconnecté],
    [2], [`ensureMqtt()` puis `mqtt.loop()`], [À chaque tour \;
    tentative toutes les 5 s si déconnecté],
    [3], [`readDoor()`], [Toutes les 150 ms],
    [4], [`readSensors()`], [Toutes les 2 s],
    [5], [`evaluateAlerts()`], [À chaque tour],
    [6], [`updateFan()`], [À chaque tour],
    [7], [`updateOutputs()` (LED, buzzer, `updateServo()`)], [À chaque
    tour],
    [8], [`publishTelemetry()`], [Toutes les 2 s, ou immédiatement si la
    porte change d'état ou si le niveau global change],
  )]
  , kind: table
  )

Au démarrage, `setup()` initialise la LED, le buzzer, les broches de
l'ultrason, le servomoteur (PWM 50 Hz, impulsions 500 à 2400 µs), l'ADC
(12 bits, atténuation 11 dB), le bus I²C, détecte le BME280 (adresse
0x76 puis 0x77), exécute `selfTest()` (LED, buzzer et servo actionnés
300 ms), mesure l'état initial de la porte, démarre le Wi-Fi en mode
station et configure le client MQTT (tampon 1024 octets, délai de socket
3 s, keep-alive 30 s).

= Architecture matérielle
<architecture-matérielle>
== Cible
<cible>
ESP32 DevKit v1 (module ESP32-WROOM-32, double cœur 240 MHz), alimenté
en 5 V par USB et régulé en 3,3 V par la carte. Framework Arduino sous
PlatformIO (`platform = espressif32`, `board = esp32dev`, 115200 bauds,
téléversement à 921600 bauds).

== Matrice de câblage
<matrice-de-câblage>
Les affectations ci-dessous proviennent des constantes de
`src/main.cpp`. Elles prévalent sur le commentaire d'en-tête du fichier
et sur le README (§5.5).

#figure(
  align(center)[#table(
    columns: (16.67%, 16.67%, 16.67%, 16.67%, 16.67%, 16.67%),
    align: (left,left,left,left,left,left,),
    table.header([GPIO], [Signal], [Sens], [Niveau /
      tension], [Périphérique], [Remarques de conception],),
    table.hline(),
    [21], [SDA], [Bidirectionnel], [3,3 V, collecteur
    ouvert], [BME280], [Pull-up 4,7 kΩ à 3,3 V (souvent présent sur le
    module)],
    [22], [SCL], [Sortie], [3,3 V, collecteur ouvert], [BME280], [Bus
    I²C à 100 kHz (valeur par défaut de `Wire`)],
    [33], [LDR (analogique)], [Entrée], [0 à 3,3 V], [LDR + résistance
    10 kΩ en pont diviseur], [ADC1, compatible avec le Wi-Fi actif \; 12
    bits (0 à 4095), moyenne de 16 échantillons],
    [4], [TRIG], [Sortie], [3,3 V], [HC-SR04], [Impulsion de 10 µs],
    [5], [ECHO], [Entrée], [#strong[5 V côté capteur, 3,3 V toléré par
    l'ESP32]], [HC-SR04], [#strong[Pont diviseur obligatoire] (par
    exemple 1 kΩ / 2 kΩ) \; GPIO 5 est une broche de strapping : ne pas
    forcer de niveau au démarrage],
    [25], [PWM servo], [Sortie], [Signal 3,3 V, 50 Hz, 500 à 2400
    µs], [SG90], [Servo alimenté en 5 V séparé, masses communes,
    condensateur de 470 µF aux bornes],
    [32], [LED alerte], [Sortie], [3,3 V], [LED + résistance série (330
    Ω environ)], [Environ 4 mA avec une LED rouge],
    [26], [Buzzer], [Sortie], [3,3 V], [Buzzer actif], [Au-delà
    d'environ 12 mA, prévoir un transistor NPN (par exemple BC337 avec 1
    kΩ de base)],
    [3V3], [Alimentation], [---], [3,3 V], [BME280, pont LDR], [],
    [5V (VIN)], [Alimentation], [---], [5 V], [HC-SR04, SG90], [],
    [GND], [Masse], [---], [0 V], [Tous], [Masse commune obligatoire],
  )]
  , kind: table
  )

Broches non utilisées par `main.cpp` : GPIO 2 (LED embarquée déclarée
dans `include/config.h`, fichier non inclus par le firmware), GPIO 27
(capteur de porte à contact, uniquement si `DOOR_SENSOR_ULTRASONIC` vaut
0).

#strong[Conflit de configuration à connaître.] `DHT_PIN` et `TRIG_PIN`
valent tous deux 4. Ce n'est pas un problème dans la configuration
livrée (`SENSOR_BME280 = 1`), mais activer le repli DHT22
(`SENSOR_BME280 = 0`) avec l'ultrason provoquerait un conflit sur le
GPIO 4.

== Choix des capteurs et limites métrologiques
<choix-des-capteurs-et-limites-métrologiques>
#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Capteur], [Grandeur], [Remarques],),
    table.hline(),
    [BME280], [T, HR, P], [Précision typique de l'ordre de ±0,5 à 1 °C,
    ±3 % HR, ±1 hPa selon la fiche constructeur (à vérifier sur la
    révision du composant utilisé). Auto-échauffement possible :
    l'éloigner de l'ESP32 et du servo.],
    [LDR], [Éclairement], [#strong[Valeur non étalonnée.]
    `lux = (ADC / 4095) × 1000`, bornée à \[0 \; 1000\], avec inversion
    possible (`LDR_INVERTED`). C'est un indicateur relatif, pas une
    mesure photométrique : à étalonner contre un luxmètre avant d'en
    tirer une conclusion clinique.],
    [HC-SR04], [Distance], [Portée 2 à 400 cm. Conversion
    `distance = durée × 0,01715 cm/µs` (célérité du son d'environ 343
    m/s, aller-retour). Délai maximal `pulseIn` de 30 ms.],
  )]
  , kind: table
  )

#strong[Logique de porte.] `DOOR_OPEN_IF_GREATER = true` : la porte est
considérée ouverte si la distance mesurée dépasse 15 cm. Un écho absent
(durée nulle, mesure à −1) est interprété comme « ouverte ». Un capteur
débranché déclenche donc une alerte porte au bout de 30 s : c'est un
comportement sûr en cas de défaillance (fail-safe), à confirmer par
l'équipe d'hygiène.

== Alimentation
<alimentation>
Ordres de grandeur à confirmer par mesure : ESP32 jusqu'à environ 250 à
350 mA en émission Wi-Fi, SG90 de 100 à 250 mA en mouvement et jusqu'à
environ 650 mA en blocage, HC-SR04 environ 15 mA, buzzer environ 30 mA.
Une alimentation 5 V d'au moins 1 A est recommandée, avec découplage du
servo.

== Écarts de documentation constatés
<écarts-de-documentation-constatés>
#figure(
  align(center)[#table(
    columns: (25%, 25%, 25%, 25%),
    align: (left,left,left,left,),
    table.header([Élément], [Code (`main.cpp`)], [Commentaire
      d'en-tête], [README],),
    table.hline(),
    [LDR], [GPIO 33], [GPIO 34], [GPIO 34],
    [Buzzer], [GPIO 26], [GPIO 33], [GPIO 26],
    [Ultrason], [TRIG 4, ECHO 5], [TRIG 14, ECHO 35], [TRIG 4, ECHO 5],
    [Adresse BME280], [0x76 par défaut, repli automatique sur
    0x77], [SDA 21, SCL 22], [0x77],
    [Arrêt de ventilation], [T ≤ 22,5 °C et HR ≤ 50 %
    (firmware)], [---], [---],
    [Arrêt de ventilation (jumeau)], [T ≤ 23,0 °C et HR ≤ 52 %
    (`CONFIG.thresholds.fan` dans `app.js`)], [---], [---],
    [`include/config.h`], [Non inclus par `main.cpp` \; contient des
    identifiants Wi-Fi factices], [---], [---],
  )]
  , kind: table
  )

#strong[Recommandation] : aligner le commentaire d'en-tête et le README
sur le code, et centraliser les seuils dans un contrat unique partagé
entre firmware et jumeau.

= Firmware et logique de surveillance
<firmware-et-logique-de-surveillance>
== Seuils et hystérésis
<seuils-et-hystérésis>
Les comparateurs `levelHigh()` et `levelLow()` retournent 0 (NORMAL), 1
(WARNING) ou 2 (CRITICAL). Le niveau précédent est mémorisé : une alerte
levée ne retombe qu'après franchissement d'une bande d'hystérésis, ce
qui évite les basculements répétés autour d'un seuil.

Pour un seuil haut, avec $v$ la valeur, $w$ le seuil d'avertissement,
$c$ le seuil critique, $h$ l'hystérésis et $ell_(p r e v)$ le niveau
précédent :

$ ell = cases(delim: "{", 2 & upright("si ") v > c med upright("ou ")\(ell_(p r e v) = 2 upright(" et ") v > c - h\), 1 & upright("sinon si ") v > w med upright("ou ")\(ell_(p r e v) gt.eq 1 upright(" et ") v > w - h\), 0 & upright("sinon")) $

Pour un seuil bas, les inégalités sont inversées ($v < c$, $v < c + h$,
$v < w$, $v < w + h$).

#figure(
  align(center)[#table(
    columns: (14.29%, 14.29%, 14.29%, 14.29%, 14.29%, 14.29%, 14.29%),
    align: (left,left,left,left,left,left,left,),
    table.header([Alerte], [Grandeur], [Seuil WARNING], [Seuil
      CRITICAL], [Hystérésis], [Effacement WARNING], [Effacement
      CRITICAL],),
    table.hline(),
    [`TEMP_HIGH`], [T (°C)], [\> 24,0], [\> 26,0], [0,5], [≤ 23,5], [≤
    25,5],
    [`TEMP_LOW`], [T (°C)], [\< 20,0], [\< 18,0], [0,5], [≥ 20,5], [≥
    18,5],
    [`HUM_HIGH`], [HR (%)], [\> 60], [\> 70], [2,0], [≤ 58], [≤ 68],
    [`HUM_LOW`], [HR (%)], [\< 30], [\< 20], [2,0], [≥ 32], [≥ 22],
    [`LIGHT_LOW`], [Éclairement indicatif], [\< 300], [\< 100], [20], [≥
    320], [≥ 120],
    [`DOOR_OPEN_LONG`], [Durée d'ouverture (s)], [\> 30], [\>
    120], [Aucune (comparaison stricte)], [Fermeture], [Fermeture],
    [`SENSOR_FAULT`], [Échecs consécutifs], [≥ 3], [≥ 10], [Aucune], [1
    lecture valide], [1 lecture valide],
  )]
  , kind: table
  )

Le niveau global `globalLevel` est le maximum des niveaux individuels.
Tout changement de niveau d'une alerte publie un événement sur
`<base>/alert` (type `raised` ou `cleared`) \; tout changement du niveau
global force une publication immédiate de la télémétrie. Quand le niveau
global retombe à 0, la sourdine du buzzer est réarmée.

== Asservissement du volet CVC
<asservissement-du-volet-cvc>
#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Condition], [Effet],),
    table.hline(),
    [Mode `auto` : T ≥ 23,5 °C #strong[ou] HR ≥ 55 %], [`fanOn = true`],
    [Mode `auto` : T ≤ 22,5 °C #strong[et] HR ≤ 50
    %], [`fanOn = false`],
    [Entre les deux], [État conservé (hystérésis)],
    [Mode `on` / `off` (commande MQTT)], [Forçage \; retour automatique
    en mode `auto` après 600 s (`FAN_OVERRIDE_TIMEOUT_MS`)],
    [`TEMP_HIGH` au niveau CRITICAL], [`fanOn = true` #strong[même en
    mode forcé `off`]],
    [Ventilation active], [Servo en balayage entre 45° et 135° par pas
    de 3° toutes les 15 ms (environ 200 °/s)],
    [Ventilation arrêtée], [Servo ramené à 0°],
  )]
  , kind: table
  )

La ventilation est enclenchée à 23,5 °C, avant le seuil d'avertissement
de 24 °C : la régulation anticipe l'alerte.

== Signalisation locale
<signalisation-locale>
#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Niveau global], [LED GPIO 32], [Buzzer GPIO 26],),
    table.hline(),
    [0 NORMAL], [Éteinte], [Silencieux],
    [1 WARNING], [Clignotement lent (bascule toutes les 500 ms, soit 1
    Hz)], [Silencieux],
    [2 CRITICAL], [Clignotement rapide (bascule toutes les 100 ms, soit
    5 Hz)], [200 ms de signal par période de 1 s, sauf sourdine],
  )]
  , kind: table
  )

L'acquittement (`ack`) ou la commande `mute` coupent le buzzer, mais
#strong[ne coupent pas la LED], qui reste le témoin d'état tant que le
niveau n'est pas revenu à 0.

== Contraintes d'exécution à surveiller
<contraintes-dexécution-à-surveiller>
La boucle est mono-tâche et comporte des appels bloquants : `pulseIn`
(jusqu'à 30 ms), connexion MQTT (délai de socket de 3 s) et surtout la
requête HTTPS du repli (`USE_HTTP_FALLBACK = 1`, délais de connexion et
de lecture de 4 s chacun) exécutée à chaque publication. #strong[Si le
webhook est lent ou injoignable, la boucle peut être figée plusieurs
secondes toutes les 2 s], ce qui perturbe le clignotement de la LED, le
cadencement du buzzer, le balayage du servo et la lecture de la porte.
Voir la recommandation R-01 (§12).

= Protocoles et contrats d'échange
<protocoles-et-contrats-déchange>
== Topologie de transport
<topologie-de-transport>
#figure(
  align(center)[#table(
    columns: (25%, 25%, 25%, 25%),
    align: (left,left,left,left,),
    table.header([Lien], [Protocole], [Port], [Sécurité actuelle],),
    table.hline(),
    [ESP32 → broker], [MQTT 3.1.1 sur TCP], [1883], [Aucune (clair, sans
    authentification)],
    [Navigateur → broker], [MQTT sur WebSocket sécurisé], [8884
    (`wss://broker.hivemq.com:8884/mqtt`)], [TLS côté navigateur
    uniquement],
    [ESP32 → webhook], [HTTPS POST (JSON)], [443], [TLS sans
    vérification du certificat (`setInsecure()`)],
    [ESP32 → NTP], [UDP], [123], [--- (`pool.ntp.org`,
    `time.google.com`)],
    [ESP32 → PC], [UART], [---], [115200 bauds, JSON brut par ligne],
  )]
  , kind: table
  )

Le broker est le même, mais les deux extrémités n'utilisent pas le même
écouteur : la liaison côté ESP32 n'est #strong[pas chiffrée],
contrairement à ce que laisse penser l'usage de WSS côté navigateur.

== Topics
<topics>
#figure(
  align(center)[#table(
    columns: (25%, 25%, 25%, 25%),
    align: (left,left,left,left,),
    table.header([Topic], [Sens], [Contenu], [Rétention],),
    table.hline(),
    [`sor-p10/bloc-or1/telemetry`], [ESP32 → supervision], [Trame de
    mesures], [Non],
    [`sor-p10/bloc-or1/alert`], [ESP32 → supervision], [Alertes levées
    ou effacées], [Non],
    [`sor-p10/bloc-or1/event`], [ESP32 → supervision], [Porte,
    commandes, démarrage, erreurs], [Non],
    [`sor-p10/bloc-or1/status`], [ESP32 → supervision], [`online` avec
    IP, RSSI, version], [#strong[Oui] \; testament (Last Will)
    `{"state":"offline"}` à QoS 1, retenu],
    [`sor-p10/bloc-or1/cmd`], [Supervision → ESP32], [Commandes], [Non],
  )]
  , kind: table
  )

La bibliothèque PubSubClient publie en QoS 0 : aucune garantie de
livraison. Le tampon est de 1024 octets : une trame plus grande n'est
pas publiée (`publishJson` retourne `false`).

== Contrat de télémétrie
<contrat-de-télémétrie>
Publiée sur `<base>/telemetry` toutes les 2 s ou sur changement d'état
de la porte ou du niveau global. Les noms `temperature`, `temperature_c`
et `temp` (idem pour l'humidité) sont des #strong[alias volontaires]
assurant la compatibilité avec le jumeau et le workflow
d'automatisation.

```json
{
  "device": "esp32-or1",
  "fw": "1.2.1",
  "seq": 142,
  "ts": 1792758625,
  "uptime_s": 284,
  "temperature": 21.4,
  "temperature_c": 21.4,
  "temp": 21.4,
  "humidity": 48.0,
  "humidity_pct": 48.0,
  "hum": 48.0,
  "lux": 320,
  "ldr_raw": 1310,
  "door": "closed",
  "door_open_s": 0,
  "door_distance_cm": 8.5,
  "fan": false,
  "fan_mode": "auto",
  "fan_actuator": "servo_sg90",
  "servo_angle": 0,
  "pressure_hpa": 1018.0,
  "pressure": 1018.0,
  "led": "off",
  "buzzer": false,
  "buzzer_muted": false,
  "level": 0,
  "level_name": "NORMAL",
  "sensor_fault": false,
  "wifi_rssi": -58,
  "telemetry": {
    "temperature_c": 21.4,
    "humidity_pct": 48.0,
    "lux": 320,
    "door": "closed",
    "door_open_s": 0,
    "fan": false,
    "sensor_fault": false
  },
  "alerts": []
}
```

#figure(
  align(center)[#table(
    columns: (25%, 25%, 25%, 25%),
    align: (left,left,left,left,),
    table.header([Champ], [Type], [Unité / domaine], [Remarque],),
    table.hline(),
    [`seq`], [entier], [Compteur croissant], [Détection de trames
    perdues],
    [`ts`], [entier], [Secondes depuis l'epoch UTC], [#strong[0 si la
    synchronisation NTP n'est pas faite] \; le jumeau interprète une
    valeur supérieure à 1,7 × 10⁹ comme des secondes],
    [`temperature`, `humidity`], [nombre ou `null`], [°C, % HR], [`null`
    tant qu'aucune lecture valide n'a eu lieu \; arrondi à 0,1],
    [`lux`], [entier], [0 à 1000, indicatif], [Voir limites du LDR
    (§5.3)],
    [`door`], [chaîne], [`open` ou `closed`], [Le jumeau accepte aussi
    un booléen],
    [`fan_mode`], [chaîne], [`auto`, `on`, `off`], [],
    [`servo_angle`], [entier], [0 à 135°], [],
    [`pressure_hpa`], [nombre], [hPa], [Absent si le BME280 est
    indisponible],
    [`level` / `level_name`], [entier / chaîne], [0 à 2 / `NORMAL`,
    `WARNING`, `CRITICAL`], [Niveau global],
    [`alerts`], [tableau], [Objets `{code, level}`], [Vide si tout est
    normal],
  )]
  , kind: table
  )

Codes d'alerte : `TEMP_HIGH`, `TEMP_LOW`, `HUM_HIGH`, `HUM_LOW`,
`LIGHT_LOW`, `DOOR_OPEN_LONG`, `SENSOR_FAULT`.

== Contrat d'alerte et d'événement
<contrat-dalerte-et-dévénement>
Publiés sur `<base>/alert` (changements de niveau) et `<base>/event`
(porte, commandes, démarrage).

```json
{
  "device": "esp32-or1",
  "ts": 1792758700,
  "uptime_s": 359,
  "type": "raised",
  "code": "TEMP_HIGH",
  "level": 1,
  "level_name": "WARNING",
  "value": 24.3,
  "message": "Temperature trop elevee dans la salle"
}
```

#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([`type`], [`code`], [Déclencheur],),
    table.hline(),
    [`raised` / `cleared`], [Un code d'alerte], [Changement de niveau
    d'une alerte],
    [`door`], [`DOOR_OPENED` / `DOOR_CLOSED`], [Changement d'état de la
    porte après anti-rebond],
    [`command`], [`FAN_MODE`, `BUZZER_MUTE`, `ACK`], [Commande reçue ou
    expiration du forçage],
    [`boot`], [`ONLINE`], [Connexion MQTT établie],
    [`cmd_error`], [`JSON_INVALID`], [Commande illisible],
  )]
  , kind: table
  )

== Contrat de statut
<contrat-de-statut>
```json
{ "state": "online", "device": "esp32-or1", "fw": "1.2.1", "ip": "192.168.1.42", "rssi": -58 }
```

== Contrat de commande
<contrat-de-commande>
Publié sur `<base>/cmd` par la supervision. Tous les champs sont
optionnels \; `reason` est repris dans le journal.

```json
{ "fan": "on", "mute": true, "ack": true, "publish_now": true, "reason": "ack soignant bloc 1" }
```

#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Champ], [Valeurs], [Effet],),
    table.hline(),
    [`fan`], [`"on"`, `"off"`, `"auto"`], [Forçage du volet (expire
    après 600 s), ou retour à l'automatique],
    [`mute`], [booléen], [Active ou lève la sourdine du buzzer],
    [`ack`], [booléen], [Acquittement : active la sourdine et journalise
    `ACK` avec le niveau courant],
    [`publish_now`], [booléen], [Force une publication immédiate de la
    télémétrie],
  )]
  , kind: table
  )

== Repli HTTPS et sortie série
<repli-https-et-sortie-série>
Si `USE_HTTP_FALLBACK = 1` et le Wi-Fi est connecté, chaque trame de
télémétrie est aussi envoyée en `POST` JSON vers l'URL du webhook
d'automatisation. Chaque trame est également émise sur le port série
(ligne lisible `[OR-DATA]` puis JSON brut), ce qui permet d'alimenter le
jumeau en mode câblé.

= Moteur Fusion AI
<moteur-fusion-ai>
== Nature du moteur
<nature-du-moteur>
Le moteur `FusionEngine` de `app.js` est un #strong[système de scoring à
règles expertes, explicable et déterministe]. Ce n'est pas un modèle
d'apprentissage automatique : les pondérations sont fixées par jugement
d'expert et n'ont pas fait l'objet d'une validation clinique. Il
s'exécute dans le navigateur à chaque trame reçue \; il est indépendant
des niveaux d'alerte calculés par le firmware, qui restent la référence
pour la signalisation locale.

== Formulation mathématique
<formulation-mathématique>
Soit à l'instant $k$ le vecteur de mesures $\(T\,H\,L\,d\,f\)$ :
température (°C), humidité relative (%), éclairement indicatif, état de
la porte ($d = 1$ si ouverte) et état de la ventilation ($f = 1$ si
active). Soit $s_d$ la durée d'ouverture de la porte en secondes,
calculée côté navigateur depuis l'instant de détection de l'ouverture.

#strong[Sous-scores pondérés] (le poids maximal de chaque grandeur est
de 35, 25, 15 et 25 points) :

$ r_T = cases(delim: "{", 35 & T > 26, 20 & 24 < T lt.eq 26, 18 & T < 20, 0 & upright("sinon")) #h(2em) r_H = cases(delim: "{", 25 & H > 70, 15 & 60 < H lt.eq 70, 12 & H < 30, 0 & upright("sinon")) $

$ r_L = cases(delim: "{", 15 & L < 100, 8 & 100 lt.eq L < 300, 0 & upright("sinon")) #h(2em) r_D = cases(delim: "{", 0 & d = 0, 5 & d = 1\,med s_d < 30, 15 & d = 1\,med 30 lt.eq s_d < 120, 25 & d = 1\,med s_d gt.eq 120) $

#strong[Pente par régression linéaire] sur la fenêtre glissante de 60 s,
avec $n gt.eq 3$ points $\(x_i\,y_i\)$ où $x_i$ est le temps en secondes
depuis le premier point de la fenêtre :

$ s_y = 60 dot.op frac(n sum x_i y_i - sum x_i sum y_i, n sum x_i^2 - (sum x_i)^2) quad\[upright("unité de ") y upright(" par minute")\] $

On note $s_T$ la pente de température (°C/min) et $s_H$ la pente
d'humidité (%/min). La pente vaut 0 si la fenêtre contient moins de 3
points ou si le dénominateur est nul.

#strong[Bonus de corrélations croisées] :

$ B_1 = 12 dot.op bb(1) [d = 1 med and med s_H > 1 \, 0] #h(2em) B_2 = 10 dot.op bb(1) [T > 24 med and med f = 0] #h(2em) B_3 = 8 dot.op bb(1) [L < 100 med and med d = 1] $

#strong[Indice de risque], borné et arrondi :

$ R = min (100 \, med max (0 \, med upright(r o u n d) (r_T + r_H + r_L + r_D + B_1 + B_2 + B_3))) $

La somme brute peut atteindre 130 \; la saturation à 100 est atteinte
dès que les sous-scores et bonus dépassent ce plafond.

#strong[Niveau de risque] :

#figure(
  align(center)[#table(
    columns: 2,
    align: (left,left,),
    table.header([Indice $R$], [Niveau],),
    table.hline(),
    [$R gt.eq 70$], [CRITICAL],
    [$40 lt.eq R < 70$], [HIGH],
    [$20 lt.eq R < 40$], [MODERATE],
    [$R < 20$], [LOW],
  )]
  , kind: table
  )

== Corrélations cliniques
<corrélations-cliniques>
#figure(
  align(center)[#table(
    columns: (25%, 25%, 25%, 25%),
    align: (left,left,left,left,),
    table.header([ID], [Condition], [Bonus], [Interprétation clinique],),
    table.hline(),
    [`CORR_DOOR_HUM`], [Porte ouverte et
    $s_H > 1\,0 med %\/upright(m i n)$], [+12], [Perturbation du flux,
    risque d'aérocontamination croisée],
    [`CORR_HEAT_NO_VENT`], [$T > 24 med degree upright(C)$ et
    ventilation inactive], [+10], [Défaillance probable de la
    ventilation thermique],
    [`CORR_DARK_DOOR`], [$L < 100$ et porte ouverte], [+8], [Conditions
    opératoires dégradées],
  )]
  , kind: table
  )

== Prédiction thermique précoce
<prédiction-thermique-précoce>
Si $s_T > 0\,15 med degree upright(C\/m i n)$ et
$T < 24 med degree upright(C)$, le temps estimé avant franchissement du
seuil d'avertissement est :

$ t_24 = frac(24 - T, s_T) quad\[upright(m i n)\] $

Une alerte `PREDICT_TEMP_OVERRUN` (niveau WARNING) est émise si
$0 < t_24 lt.eq 5 med upright(m i n)$. L'extrapolation est linéaire :
elle ne tient pas compte de la régulation par ventilation.

== Détection d'anomalies de mesure
<détection-danomalies-de-mesure>
Entre deux échantillons consécutifs, une alerte d'anomalie est émise si
$\|Delta T\|> 3 med degree upright(C)$ (`ANOMALY_TEMP_JUMP`) ou
$\|Delta H\|> 15 med %$ (`ANOMALY_HUM_JUMP`). Le README parle d'une
fenêtre de 2 s, correspondant à la période de publication \; le code
compare les deux derniers points de l'historique, quel que soit leur
écart temporel.

== Anti-bruit et retour à la normale
<anti-bruit-et-retour-à-la-normale>
Chaque alerte est identifiée par une clé \; elle n'est ré-émise qu'après
un délai de 60 s (`fusionCooldownMs`). Quand $R = 0$, qu'aucune alerte
n'est active et qu'au moins une corrélation avait été signalée, le
moteur journalise « Conformité rétablie » et réinitialise les
corrélations actives.

== Exemples de calcul
<exemples-de-calcul>
#figure(
  align(center)[#table(
    columns: (10%, 10%, 10%, 10%, 10%, 10%, 10%, 10%, 10%, 10%),
    align: (left,left,left,left,left,left,left,left,left,left,),
    table.header([Cas], [$T$], [$H$], [$L$], [Porte], [Ventilation], [$s_H$], [Calcul], [$R$], [Niveau],),
    table.hline(),
    [Nominal], [21,4], [48], [320], [Fermée], [Arrêt], [0], [0], [0], [LOW],
    [Dérive modérée], [25,2], [62], [250], [Ouverte 45
    s], [Arrêt], [0,3], [20 + 15 + 8 + 15 + 10], [68], [HIGH],
    [Dérive avec corrélation d'humidité], [25,2], [62], [250], [Ouverte
    45 s], [Arrêt], [1,4], [20 + 15 + 8 + 15 + 12 +
    10], [80], [CRITICAL],
  )]
  , kind: table
  )

== Limites du moteur
<limites-du-moteur>
- Le moteur ne distingue pas les seuils critiques bas (T \< 18 °C, HR \<
  20 %) : ils reçoivent le même sous-score que l'avertissement bas (18
  et 12 points), alors que le firmware les classe CRITICAL.
- Le score dépend de la connexion du navigateur : sans supervision
  active, seul le niveau local du firmware subsiste.
- La durée d'ouverture de la porte est mesurée côté navigateur, alors
  que le firmware publie `door_open_s` : les deux peuvent diverger après
  une reconnexion.
- Les pondérations et corrélations sont à valider avec l'équipe
  d'hygiène et à confronter à des données réelles de site avant tout
  usage décisionnel.

= Jumeau numérique 3D
<jumeau-numérique-3d>
== Composants
<composants>
#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Élément], [Source], [Rôle],),
    table.hline(),
    [Scène 3D], [`buildRoom()`, `buildDoor()`, `buildSurgicalTable()`,
    `buildScialyticLamp()`, `buildVentilationSystem()`,
    `buildMedicalEquipment()`], [Salle, porte, table, scialytique,
    ventilation, équipements],
    [Texture de carrelage], [`createHospitalTileTexture()`], [Rendu
    procédural du sol et des murs],
    [Moniteur 3D], [`initMonitorCanvas()`,
    `updateMonitorCanvas()`], [Écran de signes vitaux dessiné dans la
    scène],
    [Cartes flottantes], [`updateLeaderLines()`], [Lignes d'annotation
    vers les valeurs mesurées],
    [Tendances], [`computeLinearSlope()`, `formatTimeLabel()`], [Pente
    et axes temporels],
    [Bus interne], [`EventBus`], [Publication/abonnement entre modules],
    [État central], [`State`], [Mesures courantes, historique (1800
    points, soit 1 h à 2 s), événements (500 maximum), statistiques],
  )]
  , kind: table
  )

== Vues applicatives (d'après le README)
<vues-applicatives-daprès-le-readme>
#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Route], [Vue],),
    table.hline(),
    [`#overview`], [Scène 3D, cartes flottantes, état clinique, indice
    Fusion AI],
    [`#room`], [Inspection de la salle avec ciblage caméra],
    [`#live`], [Trois graphiques temps réel et tableau des 20 dernières
    mesures],
    [`#events`], [Journal d'audit filtrable, acquittement],
    [`#reports`], [Synthèse d'audit et exports HTML, CSV, PDF],
  )]
  , kind: table
  )

== Modes de fonctionnement
<modes-de-fonctionnement>
`State.mode` prend trois valeurs : `sim` (simulation), `mqtt` (temps
réel via WSS) et `replay` (rejeu). Le topic de base est configurable et
conservé dans le `localStorage` du navigateur.

= Sécurité et fiabilité
<sécurité-et-fiabilité>
#figure(
  align(center)[#table(
    columns: (25%, 25%, 25%, 25%),
    align: (left,left,left,left,),
    table.header([Réf.], [Constat], [Gravité], [Recommandation],),
    table.hline(),
    [S-01], [Les commandes `cmd` (dont `ack`, `mute`, `fan`) sont
    acceptées de #strong[tout client] du broker public, sans
    authentification], [Élevée], [Broker privé, authentification par
    client, ACL sur `/cmd`, signature des commandes],
    [S-02], [Transport ESP32 → broker en clair (port
    1883)], [Élevée], [MQTT sur TLS (8883) avec vérification du
    certificat],
    [S-03], [Identifiants Wi-Fi et URL du webhook codés en dur dans
    `main.cpp`], [Moyenne], [Stockage en NVS ou fichier de configuration
    exclu du dépôt \; révoquer l'URL actuelle si elle a été publiée],
    [S-04], [`httpsClient.setInsecure()` : certificat non
    vérifié], [Moyenne], [Épingler le certificat de l'autorité],
    [S-05], [Topics prévisibles (`sor-p10/bloc-or1/#`) sur un broker
    public : la télémétrie est lisible par n'importe
    qui], [Moyenne], [Broker privé, préfixe non devinable, ACL],
    [S-06], [Un acquittement distant silencieux coupe le buzzer d'une
    alarme critique], [Élevée], [Acquittement local (bouton) en
    complément \; l'acquittement distant ne doit pas être le seul
    moyen],
    [F-01], [Appels bloquants dans `loop()` (HTTPS, connexion
    MQTT)], [Moyenne], [Désactiver le repli HTTPS ou l'exécuter dans une
    tâche FreeRTOS dédiée],
    [F-02], [Pas de chien de garde (watchdog)
    applicatif], [Moyenne], [Activer le watchdog de tâche ESP32],
    [F-03], [Mesure d'éclairement non étalonnée], [Moyenne], [Étalonnage
    contre luxmètre ou renommage en « indice de luminosité »],
    [F-04], [Publication en QoS 0, sans file d'attente hors
    ligne], [Faible], [QoS 1 ou mémoire tampon locale],
    [F-05], [`ts = 0` tant que NTP n'est pas
    synchronisé], [Faible], [Horodater côté jumeau ou retenir la
    publication jusqu'à synchronisation],
    [F-06], [Chemin d'alerte sans redondance (un seul capteur par
    grandeur)], [Moyenne], [Double capteur ou contrôle croisé pour
    l'usage clinique],
  )]
  , kind: table
  )

= Plan de validation et de recette
<plan-de-validation-et-de-recette>
== Principes
<principes>
- Les essais ci-dessous vérifient le #strong[comportement du prototype]
  par rapport aux exigences du §3. Ils ne remplacent pas la
  qualification de la salle (ISO 14644, NF S 90-351), qui relève d'un
  laboratoire ou d'un organisme compétent.
- Les critères d'acceptation numériques sont des #strong[propositions du
  projet] à valider avec l'équipe d'hygiène et le biomédical.
- Instruments recommandés : thermo-hygromètre de référence étalonné,
  luxmètre, règle ou gabarit de distance, chronomètre, analyseur de
  trames MQTT (client MQTT de bureau), alimentation réglable.

== Essais
<essais>
#figure(
  align(center)[#table(
    columns: (25%, 25%, 25%, 25%),
    align: (left,left,left,left,),
    table.header([ID], [Exigence], [Procédure], [Critère d'acceptation],),
    table.hline(),
    [T-01], [EXG-01], [Comparer 30 mesures du BME280 à la référence
    étalonnée en environnement stable], [Écart de température ≤ 0,5 °C
    et d'humidité ≤ 3 % HR (proposition) \; période entre trames de 2 s
    ± 0,2 s],
    [T-02], [EXG-01], [Contrôler `pressure_hpa` contre un baromètre de
    référence], [Écart ≤ 1 hPa],
    [T-03], [EXG-01], [Déconnecter le BME280 puis le
    reconnecter], [Détection par le firmware, reprise après reconnexion
    \; adresse 0x76 ou 0x77 reconnue],
    [T-04], [EXG-02], [Éclairer le LDR à trois niveaux mesurés au
    luxmètre], [Valeurs monotones croissantes \; courbe d'étalonnage
    consignée],
    [T-05], [EXG-03], [Ouvrir et fermer la porte 20 fois], [Changement
    d'état détecté en moins de 0,5 s \; aucune fausse bascule \;
    événement `DOOR_OPENED` / `DOOR_CLOSED` publié],
    [T-06], [EXG-04], [Faire monter T de 23 à 27 °C puis redescendre
    (étuve ou source de chaleur contrôlée)], [`TEMP_HIGH` WARNING à \>
    24,0, CRITICAL à \> 26,0 \; effacement à ≤ 25,5 puis ≤ 23,5 \; pas
    de basculement répété autour des seuils],
    [T-07], [EXG-04], [Idem pour T basse (\< 20 °C, \< 18 °C)], [Seuils
    et effacements de §6.1 respectés],
    [T-08], [EXG-04], [Faire varier l'humidité de 50 à 75 % puis de 50 à
    15 %], [`HUM_HIGH` et `HUM_LOW` aux seuils du tableau, effacements à
    ±2 %],
    [T-09], [EXG-04], [Laisser la porte ouverte 35 s puis 125
    s], [`DOOR_OPEN_LONG` WARNING après 30 s, CRITICAL après 120 s \;
    effacement à la fermeture],
    [T-10], [EXG-05], [Passer T à 23,5 °C en mode
    `auto`], [`fan = true`, servo en balayage 45° à 135°],
    [T-11], [EXG-05], [Redescendre T à 22,5 °C et HR à 50
    %], [`fan = false`, servo à 0°],
    [T-12], [EXG-05], [Commande `fan: off` avec T \> 26 °C], [La
    ventilation est quand même activée (alerte critique) \; retour à
    `auto` après 600 s sinon],
    [T-13], [EXG-06], [Provoquer WARNING puis CRITICAL], [LED à 1 Hz
    puis à 5 Hz (mesure à l'oscilloscope ou à la vidéo)],
    [T-14], [EXG-06], [Provoquer CRITICAL], [Buzzer 200 ms par seconde
    \; niveau sonore adapté au bloc (à régler)],
    [T-15], [EXG-07], [Envoyer `{"ack": true}` pendant une alarme
    critique], [Buzzer coupé, événement `ACK` publié, LED toujours
    active \; sourdine levée au retour à 0],
    [T-16], [EXG-08, 12], [Capturer 5 min de trames], [`seq` strictement
    croissant, trame ≤ 1024 octets, événements présents sur `/alert` et
    `/event`],
    [T-17], [EXG-10], [Couper le Wi-Fi pendant une dérive
    critique], [LED, buzzer, servo et alertes locales fonctionnent \;
    reconnexion automatique (Wi-Fi ≤ 10 s, MQTT ≤ 5 s) \; testament
    `offline` publié à la perte],
    [T-18], [EXG-11], [Débrancher le BME280], [`SENSOR_FAULT` WARNING
    après 3 échecs (environ 6 s), CRITICAL après 10 (environ 20 s) \;
    #strong[à confirmer en essai] : le comportement de la bibliothèque
    lorsque le capteur disparaît en cours d'exécution],
    [T-19], [EXG-09], [Rejouer les trois cas du §8.7], [Indices 0, 68 et
    80 \; niveaux LOW, HIGH, CRITICAL],
    [T-20], [EXG-09], [Injecter une montée de T de 0,3 °C/min depuis 22
    °C], [`PREDICT_TEMP_OVERRUN` émise lorsque le temps estimé ≤ 5 min
    \; pas de ré-émission avant 60 s],
    [T-21], [EXG-12], [Exporter le journal CSV après une séance
    d'essais], [Tous les événements horodatés, sans doublon dans la
    fenêtre anti-bruit],
    [T-22], [Robustesse], [Appliquer 72 h de fonctionnement
    continu], [Aucun redémarrage inopiné \; mémoire libre stable (suivi
    de `ESP.getFreeHeap()`)],
    [T-23], [Sécurité], [Publier une commande depuis un client non
    autorisé], [#strong[Doit être refusée] une fois S-01 corrigé \; en
    l'état, l'essai met en évidence la faille],
  )]
  , kind: table
  )

== Matrice de couverture
<matrice-de-couverture>
#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Exigence], [Essais], [État attendu avec le code
      actuel],),
    table.hline(),
    [EXG-01 à EXG-12], [T-01 à T-22], [Satisfaites sous réserve des
    résultats d'essai],
    [EXG-13], [T-23], [#strong[Non satisfaite]],
  )]
  , kind: table
  )

== Recette réglementaire et qualification (hors périmètre du prototype)
<recette-réglementaire-et-qualification-hors-périmètre-du-prototype>
#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Essai], [Cadre], [Réalisé par],),
    table.hline(),
    [Comptage particulaire, classe ISO 5 en zone protégée], [NF EN ISO
    14644-1 / NF S 90-351], [Laboratoire compétent],
    [Cinétique de décontamination], [NF S 90-351], [Laboratoire
    compétent],
    [Pression différentielle, débits, taux de brassage], [NF S
    90-351], [Bureau de contrôle ou prestataire qualifié],
    [Contrôles microbiologiques de l'air et des surfaces], [NF S
    90-351], [Laboratoire de microbiologie],
    [Étalonnage des capteurs], [Procédure qualité du site], [Service
    biomédical],
    [Analyse de risques et dossier de maîtrise], [Politique qualité du
    site], [Équipe opérationnelle d'hygiène],
  )]
  , kind: table
  )

= Risques et recommandations
<risques-et-recommandations>
#figure(
  align(center)[#table(
    columns: (33.33%, 33.33%, 33.33%),
    align: (left,left,left,),
    table.header([Réf.], [Recommandation], [Priorité],),
    table.hline(),
    [R-01], [Sortir la requête HTTPS de la boucle principale (tâche
    dédiée) ou la désactiver], [Haute],
    [R-02], [Sécuriser le transport et les commandes (S-01 à S-05) avant
    toute connexion à un environnement réel], [Haute],
    [R-03], [Ajouter un bouton d'acquittement local et un témoin de
    perte de communication], [Haute],
    [R-04], [Centraliser les seuils dans un fichier de contrat unique
    partagé firmware / jumeau, et corriger l'écart des seuils d'arrêt de
    ventilation (22,5 °C / 50 % contre 23,0 °C / 52 %)], [Moyenne],
    [R-05], [Aligner le commentaire d'en-tête du firmware et le README
    sur le câblage réel (§5.4), supprimer ou utiliser
    `include/config.h`], [Moyenne],
    [R-06], [Étalonner ou renommer la mesure d'éclairement], [Moyenne],
    [R-07], [Extraire `FusionEngine` en module de premier niveau,
    ajouter des tests unitaires, et le faire figurer dans le graphe
    Graphify], [Moyenne],
    [R-08], [Valider pondérations et seuils avec l'hygiène hospitalière,
    sur des données réelles], [Moyenne],
    [R-09], [Ajouter un contrôle de la pression différentielle (capteur
    dédié) pour se rapprocher des exigences de la zone 4], [Basse],
    [R-10], [Fixer la version du jumeau (en-tête 1.0.0) et la lier à
    celle du firmware (1.2.1) par un contrat versionné], [Basse],
  )]
  , kind: table
  )

= Annexes
<annexes>
== Dépendances logicielles (`platformio.ini`)
<dépendances-logicielles-platformio.ini>
#figure(
  align(center)[#table(
    columns: 2,
    align: (left,left,),
    table.header([Bibliothèque], [Version],),
    table.hline(),
    [PubSubClient (knolleary)], [^2.8],
    [ArduinoJson (bblanchon)], [^7.0.0],
    [ESP32Servo (madhephaestus)], [^3.0.5],
    [Adafruit BME280 Library], [^2.2.4],
    [Adafruit Unified Sensor], [^1.1.14],
    [DHT sensor library (Adafruit)], [^1.4.6],
  )]
  , kind: table
  )

== Options de compilation du firmware
<options-de-compilation-du-firmware>
#figure(
  align(center)[#table(
    columns: 3,
    align: (left,left,left,),
    table.header([Option], [Valeur livrée], [Effet],),
    table.hline(),
    [`WOKWI_SIM`], [0], [1 : réseau et LDR adaptés au simulateur Wokwi],
    [`SENSOR_BME280`], [1], [0 : repli sur un DHT22 (GPIO 4)],
    [`BUZZER_ACTIVE`], [1], [0 : buzzer passif piloté en PWM],
    [`DOOR_SENSOR_ULTRASONIC`], [1], [0 : contact de porte sur GPIO 27],
    [`USE_HTTP_FALLBACK`], [1], [0 : désactive l'envoi HTTPS],
  )]
  , kind: table
  )

== Constantes de temporisation
<constantes-de-temporisation>
#figure(
  align(center)[#table(
    columns: 2,
    align: (left,left,),
    table.header([Constante], [Valeur],),
    table.hline(),
    [`SENSOR_INTERVAL_MS`], [2000 ms],
    [`PUBLISH_INTERVAL_MS`], [2000 ms],
    [`ULTRASONIC_INTERVAL_MS`], [150 ms],
    [`DOOR_DEBOUNCE_MS`], [80 ms],
    [`WIFI_RETRY_MS`], [10 000 ms],
    [`MQTT_RETRY_MS`], [5000 ms],
    [`SERVO_STEP_MS`], [15 ms],
    [`FAN_OVERRIDE_TIMEOUT_MS`], [600 000 ms],
  )]
  , kind: table
  )

== Glossaire
<glossaire>
#figure(
  align(center)[#table(
    columns: (50%, 50%),
    align: (left,left,),
    table.header([Terme], [Définition],),
    table.hline(),
    [BPMN], [Business Process Model and Notation],
    [CP], [Cinétique de décontamination particulaire (NF S 90-351)],
    [CVC], [Chauffage, ventilation, climatisation],
    [GTB / GTC], [Gestion technique du bâtiment / centralisée],
    [IBODE], [Infirmier de bloc opératoire diplômé d'État],
    [M1], [Classe de propreté microbiologique de la zone 4 (NF S 90-351,
    version 2013)],
    [NTP], [Network Time Protocol],
    [UFC], [Unité formant colonie],
    [WSS], [WebSocket sécurisé],
  )]
  , kind: table
  )

== Génération des livrables
<génération-des-livrables>
Les commandes de compilation (diagrammes, PDF via Typst, DOCX via
Pandoc, diaporama via Marp) sont fournies dans le script
`output/build_all.ps1`.
