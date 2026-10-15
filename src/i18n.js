// -----------------------------------------------------------------------------
// Every text the integration produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js checks it).
//
// Feature names are frozen when the user adds the device: they are written in
// the language of the configuration at that moment. The other texts follow
// the configuration language each time they are produced (Gladys does not
// tell a device integration the language of its user), except the widget,
// which receives it.
// -----------------------------------------------------------------------------

export const LANGS = ['en', 'fr', 'de', 'es'];

/** The text of `table` in `language`, English when missing. */
export const pick = (table, language) => table[language] ?? table.en;

/** A multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(LANGS.map((language) => [language, render(language)]));

// Feature names, by feature key.
export const NAMES = {
  en: {
    power: 'Light',
    brightness: 'Brightness',
    color: 'Color',
    effect: 'Effect',
    ambilight: 'Ambilight',
    source: 'Showing now',
    'component-leddevice': 'LED output',
    'component-grabber': 'Screen capture',
    'component-v4l': 'USB capture',
    'component-audio': 'Audio capture',
    'component-smoothing': 'Smoothing',
    'component-blackborder': 'Black bar detection',
    noEffect: 'None',
  },
  fr: {
    power: 'Éclairage',
    brightness: 'Luminosité',
    color: 'Couleur',
    effect: 'Effet',
    ambilight: 'Ambilight',
    source: 'Affichage en cours',
    'component-leddevice': 'Sortie LED',
    'component-grabber': "Capture d'écran",
    'component-v4l': 'Capture USB',
    'component-audio': 'Capture audio',
    'component-smoothing': 'Lissage',
    'component-blackborder': 'Détection des bandes noires',
    noEffect: 'Aucun',
  },
  de: {
    power: 'Licht',
    brightness: 'Helligkeit',
    color: 'Farbe',
    effect: 'Effekt',
    ambilight: 'Ambilight',
    source: 'Aktuelle Anzeige',
    'component-leddevice': 'LED-Ausgang',
    'component-grabber': 'Bildschirmaufnahme',
    'component-v4l': 'USB-Aufnahme',
    'component-audio': 'Audioaufnahme',
    'component-smoothing': 'Glättung',
    'component-blackborder': 'Schwarze-Balken-Erkennung',
    noEffect: 'Keiner',
  },
  es: {
    power: 'Luz',
    brightness: 'Brillo',
    color: 'Color',
    effect: 'Efecto',
    ambilight: 'Ambilight',
    source: 'Mostrando ahora',
    'component-leddevice': 'Salida LED',
    'component-grabber': 'Captura de pantalla',
    'component-v4l': 'Captura USB',
    'component-audio': 'Captura de audio',
    'component-smoothing': 'Suavizado',
    'component-blackborder': 'Detección de bandas negras',
    noEffect: 'Ninguno',
  },
};

// What the LEDs show (the "Showing now" text feature and the widget).
export const SOURCE_TEXT = {
  en: {
    off: 'Off',
    nothing: 'Nothing',
    ambilight: (capture) => `Ambilight (${capture})`,
    effect: (name) => `Effect: ${name}`,
    color: (hex) => `Color ${hex}`,
    other: (source) => `Other source: ${source}`,
    GRABBER: 'screen capture',
    V4L: 'USB capture',
  },
  fr: {
    off: 'Éteint',
    nothing: 'Rien',
    ambilight: (capture) => `Ambilight (${capture})`,
    effect: (name) => `Effet : ${name}`,
    color: (hex) => `Couleur ${hex}`,
    other: (source) => `Autre source : ${source}`,
    GRABBER: "capture d'écran",
    V4L: 'capture USB',
  },
  de: {
    off: 'Aus',
    nothing: 'Nichts',
    ambilight: (capture) => `Ambilight (${capture})`,
    effect: (name) => `Effekt: ${name}`,
    color: (hex) => `Farbe ${hex}`,
    other: (source) => `Andere Quelle: ${source}`,
    GRABBER: 'Bildschirmaufnahme',
    V4L: 'USB-Aufnahme',
  },
  es: {
    off: 'Apagado',
    nothing: 'Nada',
    ambilight: (capture) => `Ambilight (${capture})`,
    effect: (name) => `Efecto: ${name}`,
    color: (hex) => `Color ${hex}`,
    other: (source) => `Otra fuente: ${source}`,
    GRABBER: 'captura de pantalla',
    V4L: 'captura USB',
  },
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noServer: {
    en: 'No Hyperion server found. Check that it is on the same network, or enter its IP address.',
    fr: "Aucun serveur Hyperion trouvé. Vérifiez qu'il est sur le même réseau, ou saisissez son adresse IP.",
    de: 'Kein Hyperion-Server gefunden. Prüfe, ob er im selben Netzwerk ist, oder gib seine IP-Adresse ein.',
    es: 'No se ha encontrado ningún servidor Hyperion. Compruebe que está en la misma red o introduzca su dirección IP.',
  },
  tokenNeeded: {
    en: 'Hyperion asks for a token: use "Request a token", or paste one in the configuration.',
    fr: 'Hyperion demande un jeton : utilisez « Demander un jeton », ou collez-en un dans la configuration.',
    de: 'Hyperion verlangt ein Token: Nutze „Token anfordern“ oder füge eines in der Konfiguration ein.',
    es: 'Hyperion pide un token: use «Solicitar un token» o pegue uno en la configuración.',
  },
  unreachable: {
    en: 'The Hyperion server does not answer. Check that it is on and on the network.',
    fr: 'Le serveur Hyperion ne répond pas. Vérifiez qu’il est allumé et sur le réseau.',
    de: 'Der Hyperion-Server antwortet nicht. Prüfe, ob er eingeschaltet und im Netzwerk ist.',
    es: 'El servidor Hyperion no responde. Compruebe que está encendido y conectado a la red.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

// Errors shown to the user (a command, a scene action, a widget button).
export const ERRORS = {
  en: {
    unknownDevice: 'This Hyperion device is not known (any more): search for servers again.',
    unreachable: (name) => `${name} does not answer.`,
    unknownEffect: (effect) => `Unknown effect "${effect}".`,
    noEffect: 'Choose an effect, or type the name of one.',
    badColor: (color) => `"${color}" is not a color: write it like #FF8800.`,
    refused: (reason) => `Hyperion refused the command (${reason}).`,
  },
  fr: {
    unknownDevice: "Cet appareil Hyperion n'est pas (ou plus) connu : relancez la recherche.",
    unreachable: (name) => `${name} ne répond pas.`,
    unknownEffect: (effect) => `Effet « ${effect} » inconnu.`,
    noEffect: "Choisissez un effet, ou saisissez le nom d'un effet.",
    badColor: (color) => `« ${color} » n'est pas une couleur : écrivez-la comme #FF8800.`,
    refused: (reason) => `Hyperion a refusé la commande (${reason}).`,
  },
  de: {
    unknownDevice: 'Dieses Hyperion-Gerät ist (nicht mehr) bekannt: Starte die Suche erneut.',
    unreachable: (name) => `${name} antwortet nicht.`,
    unknownEffect: (effect) => `Unbekannter Effekt „${effect}“.`,
    noEffect: 'Wähle einen Effekt oder gib den Namen eines Effekts ein.',
    badColor: (color) => `„${color}“ ist keine Farbe: Schreib sie wie #FF8800.`,
    refused: (reason) => `Hyperion hat den Befehl abgelehnt (${reason}).`,
  },
  es: {
    unknownDevice: 'Este dispositivo Hyperion no es (o ya no es) conocido: vuelva a buscar.',
    unreachable: (name) => `${name} no responde.`,
    unknownEffect: (effect) => `Efecto «${effect}» desconocido.`,
    noEffect: 'Elija un efecto o escriba el nombre de uno.',
    badColor: (color) => `«${color}» no es un color: escríbalo como #FF8800.`,
    refused: (reason) => `Hyperion ha rechazado el comando (${reason}).`,
  },
};

// The report under the "Search for servers" button.
export const SEARCH_TEXT = {
  en: {
    none: 'No Hyperion server found.',
    count: (servers, reachable) => `${servers} server(s), ${reachable} answering:`,
    server: (name, address, version, instances) =>
      `${name} (${address}, Hyperion ${version}, ${instances} instance(s))`,
    unreachable: 'not answering',
    tokenNeeded: (address) => `${address} asks for a token.`,
    noDiscovery:
      'Automatic discovery through Gladys is unavailable: enter the IP address of the server.',
    ignored: (list) => `Ignored addresses: ${list}.`,
    noAnswer: (list) => `No answer from: ${list}.`,
  },
  fr: {
    none: 'Aucun serveur Hyperion trouvé.',
    count: (servers, reachable) => `${servers} serveur(s), ${reachable} répondent :`,
    server: (name, address, version, instances) =>
      `${name} (${address}, Hyperion ${version}, ${instances} instance(s))`,
    unreachable: 'ne répond pas',
    tokenNeeded: (address) => `${address} demande un jeton.`,
    noDiscovery:
      "La découverte automatique par Gladys est indisponible : saisissez l'adresse IP du serveur.",
    ignored: (list) => `Adresses ignorées : ${list}.`,
    noAnswer: (list) => `Pas de réponse de : ${list}.`,
  },
  de: {
    none: 'Kein Hyperion-Server gefunden.',
    count: (servers, reachable) => `${servers} Server, davon ${reachable} erreichbar:`,
    server: (name, address, version, instances) =>
      `${name} (${address}, Hyperion ${version}, ${instances} Instanz(en))`,
    unreachable: 'antwortet nicht',
    tokenNeeded: (address) => `${address} verlangt ein Token.`,
    noDiscovery:
      'Die automatische Erkennung über Gladys ist nicht verfügbar: Gib die IP-Adresse des Servers ein.',
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
    noAnswer: (list) => `Keine Antwort von: ${list}.`,
  },
  es: {
    none: 'No se ha encontrado ningún servidor Hyperion.',
    count: (servers, reachable) => `${servers} servidor(es), ${reachable} responden:`,
    server: (name, address, version, instances) =>
      `${name} (${address}, Hyperion ${version}, ${instances} instancia(s))`,
    unreachable: 'no responde',
    tokenNeeded: (address) => `${address} pide un token.`,
    noDiscovery:
      'El descubrimiento automático a través de Gladys no está disponible: introduzca la dirección IP del servidor.',
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
    noAnswer: (list) => `Sin respuesta de: ${list}.`,
  },
};

// The report under the "Request a token" button.
export const TOKEN_TEXT = {
  en: {
    notNeeded: 'No Hyperion server asks for a token: nothing to do.',
    granted: (address) => `${address}: token received and saved.`,
    denied: (address) => `${address}: request denied or not accepted in time.`,
    failed: (address) => `${address}: the request could not be sent.`,
  },
  fr: {
    notNeeded: 'Aucun serveur Hyperion ne demande de jeton : rien à faire.',
    granted: (address) => `${address} : jeton reçu et enregistré.`,
    denied: (address) => `${address} : demande refusée ou pas acceptée à temps.`,
    failed: (address) => `${address} : la demande n'a pas pu être envoyée.`,
  },
  de: {
    notNeeded: 'Kein Hyperion-Server verlangt ein Token: nichts zu tun.',
    granted: (address) => `${address}: Token erhalten und gespeichert.`,
    denied: (address) => `${address}: Anfrage abgelehnt oder nicht rechtzeitig angenommen.`,
    failed: (address) => `${address}: Die Anfrage konnte nicht gesendet werden.`,
  },
  es: {
    notNeeded: 'Ningún servidor Hyperion pide un token: no hay nada que hacer.',
    granted: (address) => `${address}: token recibido y guardado.`,
    denied: (address) => `${address}: solicitud rechazada o no aceptada a tiempo.`,
    failed: (address) => `${address}: no se ha podido enviar la solicitud.`,
  },
};

// The dashboard widget.
export const WIDGET_TEXT = {
  en: {
    pick: 'Choose a Hyperion device in the widget settings, or add one in the Discovery tab.',
    unreachable: 'The Hyperion server does not answer.',
    showing: 'Showing',
    brightness: 'Brightness',
    ambilight: 'Ambilight',
    turnOff: 'Turn off',
    turnOn: 'Turn on',
  },
  fr: {
    pick: "Choisissez un appareil Hyperion dans les réglages du widget, ou ajoutez-en un dans l'onglet Découverte.",
    unreachable: 'Le serveur Hyperion ne répond pas.',
    showing: 'Affichage',
    brightness: 'Luminosité',
    ambilight: 'Ambilight',
    turnOff: 'Éteindre',
    turnOn: 'Allumer',
  },
  de: {
    pick: 'Wähle ein Hyperion-Gerät in den Widget-Einstellungen oder füge eines im Tab „Entdecken“ hinzu.',
    unreachable: 'Der Hyperion-Server antwortet nicht.',
    showing: 'Anzeige',
    brightness: 'Helligkeit',
    ambilight: 'Ambilight',
    turnOff: 'Ausschalten',
    turnOn: 'Einschalten',
  },
  es: {
    pick: 'Elija un dispositivo Hyperion en los ajustes del widget o añada uno en la pestaña Descubrir.',
    unreachable: 'El servidor Hyperion no responde.',
    showing: 'Mostrando',
    brightness: 'Brillo',
    ambilight: 'Ambilight',
    turnOff: 'Apagar',
    turnOn: 'Encender',
  },
};

/** An Error whose message is in the configuration language. */
export function userError(language, key, ...args) {
  const text = pick(ERRORS, language)[key];
  const error = new Error(typeof text === 'function' ? text(...args) : text);
  error.userFacing = true;
  return error;
}
