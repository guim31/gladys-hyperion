# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/hub.test.js              # one file
node --test --test-name-pattern "token"   # tests whose name matches
node scripts/probe.mjs <ip> [port]        # read-only check of a real Hyperion
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/app.js registers the handlers before connect()
src/app.js                        every SDK handler -> the hub; "Search" and "Request a token" reports
src/hub.js                        discovery, one link per instance, states, commands, refresh timer, tokens
src/devices.js                    Hyperion instance -> Gladys device (features, values)
src/hyperion/client.js            JSON API client: TCP 19444, newline JSON, tan matching, pushed updates
src/hyperion/model.js             reading serverinfo and its *-update messages; colours
src/hyperion/discovery.js         raw SSDP / mDNS results -> candidate servers
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/widgets.js                    dashboard widget handlers (manifest `widgets`)
src/effects.js                    the effects Hyperion ships with (static lists of the manifest)
src/i18n.js                       every text produced by the code, en/fr/de/es
src/issues.js                     deduplicated problem logs (one line when it starts, one when it ends)
src/store.js                      /data/hyperion-state.json (servers, tokens, captures turned off)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
scripts/probe.mjs                 read-only check of a real server (sysinfo, serverinfo)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en and fr mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
test/helpers/fakeHyperion.js      a fake Hyperion (or HyperHDR: product option) on loopback TCP, from the fixtures
test/fixtures/hyperion/           real serverinfo/sysinfo replies (hyperion-py tests; Hyperion.ng 2.2.1, HyperHDR 22.0.0)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** comes in four languages (`en`, `fr`, `de`, `es`):
  manifest texts, feature names, action and error messages, widget texts (all
  of the code's texts live in `src/i18n.js`), and `docs/{en,fr,de,es}.md` with
  the same sections. German says "du", Spanish "usted". `test/i18n.test.js`
  checks it.
- **Logs.** The info level tells what changes (a server found, lost or back, a
  command of the user), never a push, a refresh or a state. A failure that
  repeats goes through `createIssueLog` (`src/issues.js`). `test/live.test.js`
  fails if a normal cycle writes at the info level or if a token is logged.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the fake Hyperion listens on
  127.0.0.1 only).

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  **Piège du 5.2.0** (GladysAssistant/Gladys#3198, correctif #3199, relevé sur gladys-ping-wol) :
  un appareil **créé sans `should_poll`** n'est jamais sondé, même après correction du cœur (valeur
  stockée à la création), et la 5.2.1 du 13/10/2026 ne le corrige pas. **Le conteneur sonde donc
  lui-même** par un minuteur, qui saute un appareil sondé il y a moins d'une demi-période, en gardant
  `onPoll` comme repli ; seuls les appareils ajoutés (`gladys.devices`) sont lus. Un test le prouve
  sans appeler `onPoll`.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**SDK 0.15 et journaux**

- SDK `@gladysassistant/integration-sdk` **^0.15.0** (12/10/2026) : `DEVICE_POLL_FREQUENCIES`, faux
  Gladys de test (`@gladysassistant/integration-sdk/testing`, à préférer à un faux maison),
  déduplication des états, `parseMdnsTxt`. Lire son README et son CHANGELOG.
- **Journaux calmes** (demande de Guilhem, 13/10/2026) : rien au niveau info pour un cycle normal de
  lecture, un état publié ou un message reçu. L'info ne garde que le cycle de vie : démarrage,
  connexion, perte et retour d'un appareil ou d'un service, erreurs utiles, une ligne par action de
  l'utilisateur. Le reste passe en debug (`LOG_LEVEL=debug`). Une erreur qui se répète écrit une ligne
  au premier échec et une au rétablissement, pas une par tentative. Jamais de secret ni d'adresse
  avec identifiants. Un test vérifie qu'un cycle normal n'écrit rien en info.
- **Heartbeat** : republier au moins toutes les 12 h une valeur qui ne change pas, sinon le front
  affiche « Pas de valeur récente » au-delà de 48 h.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM mirror.gcr.io/library/node:…` (miroir Docker Hub de Google, même
  empreinte, sans compte) et non `node:…` de Docker Hub ni `public.ecr.aws/docker/library/node:…`
  d'ECR Public : tous deux refusent en 429 les pulls anonymes des runners GitHub dès qu'il y a
  plusieurs builds à la fois (ECR depuis fin octobre 2026). Un échec 429 dans le job « Docker build »
  n'est pas un bug du code. Même parade dans `.github/workflows/build.yml` (posée par
  l'orchestrateur, ne pas la retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).

---

# Hyperion : ce qu'il faut savoir (15/10/2026)

Écrite d'abord sans le matériel (1.0.x), puis **testée le 23/10/2026 contre un vrai Hyperion.ng
2.2.1 et un vrai HyperHDR 22.0.0** (voir « HyperHDR et tests réels » plus bas), sans ruban LED ni
capture vidéo. Les faits ci-dessous viennent du code d'Hyperion.ng (MIT, `libsrc/api`,
`libsrc/ssdp`, `libsrc/mdns`), de `hyperion-py` (MIT), de l'intégration Home Assistant, et de ces
tests. `scripts/probe.mjs <ip>` (lecture seule) lit un vrai serveur.

## API JSON

- TCP 19444, un objet JSON par ligne dans les deux sens. Chaque requête porte un `tan` renvoyé
  dans la réponse ; les vieux serveurs répondent `tan: 0` à une requête mal formée
  (hyperion.ng#1001) : le client rend alors la réponse à la plus ancienne requête de même commande.
- Une connexion est liée à **une instance** (`instance switchTo`, qui exige une instance en marche) :
  une connexion par instance en marche. `serverinfo` + `subscribe` renvoie l'état complet et fait
  pousser `components-update`, `priorities-update`, `adjustment-update`, `effects-update`,
  `instance-update`. L'instance 0 peut être arrêtée.
- **Authentification** : une connexion depuis le réseau local est autorisée sans jeton tant que
  « Local API Authentication » est désactivée (défaut). `sysinfo`, `serverinfo` et les commandes
  exigent l'autorisation ; `authorize tokenRequired`, `login` et `requestToken` non. `requestToken`
  ne répond qu'une fois la demande acceptée ou refusée dans l'interface web (délai serveur 180 s ;
  l'action Gladys est plafonnée à 120 s, on attend 100 s puis on retire la demande avec
  `accept: false`). Les jetons obtenus vont dans `/data/hyperion-state.json`, jamais dans un journal.
- **Priorités** : la plus petite valeur gagne ; l'API accepte 1 à 253 (0 démarrage, 254 effet de
  fond, 255 éteint). Captures par défaut : USB 240, écran 250. Gladys pose ses couleurs et effets à
  `priority` (128) avec `origin: "Gladys"` (4 à 20 caractères). La source visible n'est pas toujours
  la première de la liste (hyperion.ng#964) : chercher `visible: true`.
- **Allumé** = composants `ALL` et `LEDDEVICE` actifs (lecture de hyperion-py). Éteindre envoie
  `componentstate ALL false` (l'instance reste joignable) ; allumer une instance arrêtée envoie
  `startInstance` par une autre connexion du serveur.
- Hypothèse non vérifiée : couper une capture (V4L, GRABBER) la retire de la liste des priorités ;
  par prudence, `captureVisible` exige aussi le composant actif.

## Découverte

- SSDP : `ST: urn:hyperion-project.org:device:basic:1`, `USN: uuid:<id>` (= `sysinfo.hyperion.id`),
  en-têtes `HYPERION-NAME` et `HYPERION-JSS-PORT` depuis 2.0 (absents des alpha : port 19444).
- mDNS : `_hyperiond-json._tcp`, TXT `id=<id>` et `version=`.
- Le cœur ne scanne en SSDP que la **première** entrée `ssdp` du manifeste, et une seule analyse à
  la fois par intégration : SSDP puis mDNS, l'un après l'autre.
- HyperHDR s'annonce autrement (voir plus bas) : trouvé par mDNS seulement.

## Choix

- `should_poll: false` : les états sont poussés par Hyperion ; le minuteur du hub relit chaque
  instance toutes les minutes, reconnecte, et relance une recherche toutes les 30 min tant qu'un
  serveur manque. Heartbeat 12 h via `publishChangedStates`.
- Les noms des fonctionnalités suivent `language` (défaut `fr`) au moment de la création.
- « Ambilight » allumé = une capture vidéo est la source visible. L'allumer efface **toutes** les
  priorités COLOR/EFFECT de 1 à 253 (Gladys et autres clients), et rallume les captures que
  l'interrupteur avait coupées (mémorisées dans `/data`) ; l'éteindre coupe les captures actives.
- Effets du manifeste (action de scène, widget) : liste statique des effets fournis
  (`src/effects.js`), plus un champ libre pour un effet personnel ; un test lie les deux.
- Aucun déclencheur de scène : les états des appareils suffisent.
- `gladys_version` `>=5.1.0` : aucun bouton de widget à formulaire.

## Pièges de la session

- `gladys.fake.action()` du SDK rend `{ success, data: { message } }` : le texte est dans
  `data.message`, pas dans `data`.
- Ne pas simuler `process.stdout.write` dans un test : le rapporteur de `node --test` écrit par là et
  des résultats disparaissent. Le logger du SDK écrit par `console.log` / `console.error` : simuler
  ceux-là.
- Le garde-fou allemand de `test/i18n.test.js` refuse aussi un « Sie »/« Ihre » de troisième
  personne en début de phrase (après deux-points) : tourner la phrase autrement.
- Le validateur du store refuse un `default` sur un champ `secret` (« not allowed for secret
  fields ») : le champ `token` n'en a pas, `DEFAULT_CONFIG.token` reste `''` côté code.

# HyperHDR et tests réels (23/10/2026)

Vérifié sur Hyperion.ng 2.2.1 et HyperHDR 22.0.0 (paquets `.deb` officiels des releases GitHub,
installés dans `public.ecr.aws/docker/library/debian:bookworm-slim` ; Hyperion.ng y demande en plus
`libexpat1`, le reste est embarqué). Les deux démarrent avec une sortie LED « file » vers
`/dev/null`, l'API JSON sur 19444 sans jeton, et acceptent `instance createInstance` (nom de 5
caractères au moins) après `authorize login` avec le mot de passe par défaut (`hyperion` /
`hyperhdr`). « Local API Authentication » : `config setconfig` avec l'objet `network` complet
(HyperHDR) ou `global.settings.network` (Hyperion.ng 2.2). Les sessions déjà ouvertes gardent
leurs droits.

- **`sysinfo`** : HyperHDR remplit `hyperhdr` (`id`, `version`) et pas `hyperion` (le bloc
  `hyperhdr` l'emporte s'il y a les deux, pour garder l'id) : sans
  `serverIdentity`, la 1.0.1 le refusait (« the server has no id »). Le produit est gardé dans le
  serveur (`product`, sauvé dans `/data`) et donne le modèle (`HyperHDR 22.0.0`).
- **Composants** : HyperHDR a `ALL`, `HDR`, `SMOOTHING`, `BLACKBORDER`, `FORWARDER`,
  `VIDEOGRABBER` (USB), `SYSTEMGRABBER` (écran), `LEDDEVICE`. Les deux captures sont des
  `CAPTURE_COMPONENTS`. Les clés `component-systemgrabber`, `component-videograbber`,
  `component-hdr` sont **ajoutées en fin** de `SWITCHABLE_COMPONENTS` : un appareil Hyperion.ng ne
  les a jamais, ses fonctionnalités et leur ordre ne changent pas.
- **HyperHDR pilote `LEDDEVICE` lui-même** : coupé dès qu'il n'y a plus de source, rallumé à la
  source suivante, même après une coupure par l'utilisateur. Donc sur HyperHDR (reconnu à son
  composant `HDR` ou à `videomodehdr`) : allumé = `ALL` seul, pas d'interrupteur « Sortie LED »,
  et `turnOn` n'envoie pas `LEDDEVICE`. Hyperion.ng 2.2.1, lui, garde `LEDDEVICE` tel quel.
- **Luminosité** : l'`adjustment` d'HyperHDR n'a ni `brightness` ni `id` et refuse toute clé
  inconnue (`additionalProperties: false`). Son interface appelle `luminanceGain` (0 à 10, 1 par
  défaut) « Brightness/luminance » : lu 100 % à partir de 1, écrit `level / 100` (un gain > 1 est
  gardé si l'on demande 100 %). Sans `adjustment` connu, le produit du serveur décide.
- **Course `serverinfo`/push** : HyperHDR a répondu à un `serverinfo` envoyé juste après
  `componentstate ALL` avec `LEDDEVICE` **plus ancien** que le `components-update` poussé avant la réponse. Sur HyperHDR seulement, `refreshLink` rejoue sur la réponse les `components-update`
  reçus depuis 1 s avant la requête (`link.recentComponents`) : un push peut partager le segment
  TCP de la réponse à la commande et arriver avant que la relecture commence. `openLink` garde
  aussi les pushes émis avant la résolution du premier `serverinfo`. Le faux serveur simule les deux
  (`staleSnapshots`, `coalesce`). Hyperion.ng garde sa réponse telle quelle.
- **`startInstance`** d'une instance tout juste créée sur HyperHDR a dépassé 5 s (réponse au bout
  d'environ 0,6 s ensuite) : délai de 20 s pour cette commande.
- Une réponse d'erreur d'HyperHDR peut porter `command: "instance"` sans la sous-commande : la
  correspondance se fait par `tan`, ce qui suffit.
- **Durées** (`duration` des couleurs et effets) et `clear` : identiques sur les deux.
- **Effets** : 14 effets de `BUILTIN_EFFECTS` n'existent pas dans HyperHDR 22 (Fire, Snake,
  X-Mas…) ; il ajoute 28 effets « Music: … » (capture audio) et « Rainbow waves » (ajouté aux
  listes). Hyperion.ng 2.2.1 ajoute « Matrix » et « Led Test - Sequence ».
- **Découverte** : SSDP `urn:hyperhdr.eu:device:basic:1`, en-têtes `HYPERHDR-JSS-PORT` et
  `HYPERHDR-NAME` ; le cœur ne cherche que la première cible SSDP du manifeste (celle d'Hyperion),
  HyperHDR n'y répond pas. mDNS `_hyperhdr-http._tcp` (port de l'interface web, TXT `version`
  seul) : le cœur parcourt **tous** les services mDNS déclarés (`runScan`, 5.2.0), donc HyperHDR est
  essayé sur le port JSON par défaut 19444 et identifié par `sysinfo`. Non vérifié en vrai (pas de
  Gladys ni de multicast dans le banc de test).
- Jetons : `tokenRequired`, `login` avec un jeton, refus d'un jeton faux, et `requestToken` accepté
  par une session admin (`authorize answerRequest`) marchent pareil sur les deux.
