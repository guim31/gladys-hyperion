# Hyperion

Pilotez votre éclairage d'ambiance [Hyperion.ng](https://hyperion-project.org)
depuis Gladys : le ruban LED derrière la télé, piloté par un Raspberry Pi (ou
tout ordinateur qui fait tourner Hyperion) qui recopie les couleurs de
l'image — l'effet « Ambilight ».

> **Développée sans le matériel : vos retours sont les bienvenus.** Cette
> intégration a été écrite et testée d'après la documentation de l'API JSON
> d'Hyperion, le code d'Hyperion.ng et les vraies réponses de serveur publiées
> par la bibliothèque `hyperion-py`, et non sur un vrai serveur Hyperion.
> Dites-nous ce qui marche et ce qui ne marche pas sur le forum Gladys ou dans
> les issues GitHub.
>
> Cette intégration n'est pas affiliée au projet Hyperion.

## Ce que vous obtenez

- **Un appareil Gladys par instance Hyperion.** Une instance est une sortie
  LED configurée dans Hyperion (la plupart des installations en ont une ; une
  deuxième peut piloter un ruban WLED, un pont Hue…).
- Sur chaque appareil :
  - **Éclairage** : marche/arrêt de l'instance ;
  - **Luminosité** (0-100 %), **Couleur** (une couleur fixe) ;
  - **Effet** : les effets de votre serveur (ceux fournis et les vôtres), ou
    « Aucun » ;
  - **Ambilight** : allumé quand les LED suivent l'image (capture d'écran ou
    capture USB) ;
  - **Affichage en cours** : un texte qui dit ce qu'affichent les LED
    (Ambilight, un effet, une couleur, éteint…) ;
  - un interrupteur par **composant** de votre instance : sortie LED, capture
    d'écran, capture USB, capture audio, lissage, détection des bandes noires.
- **Trois actions de scène** : lancer un effet, afficher une couleur (les deux
  pour une durée donnée si vous le souhaitez), revenir à l'Ambilight.
- **Un widget de tableau de bord** : ce qu'affiche la lumière, et des boutons
  en un geste (Ambilight, deux effets de votre choix, marche/arrêt).

Les changements faits ailleurs (interface web d'Hyperion, télécommande, autre
domotique) apparaissent dans Gladys en moins d'une seconde : Hyperion les
envoie.

## Prérequis

- Gladys Assistant **5.1.0** ou plus récent.
- Un serveur **Hyperion.ng** (version 2.0 ou plus récente) sur le même réseau
  local que Gladys, avec son **serveur JSON** activé (il l'est par défaut, sur
  le port 19444). L'ancien Hyperion « classique » (avant 2.0) n'est pas pris
  en charge.
- **HyperHDR** parle la même API JSON et devrait aussi fonctionner, en
  saisissant son adresse à la main (non testé).
- Pas de compte, pas de cloud : tout reste sur votre réseau.

## Installation et configuration

1. Dans Gladys, ouvrez **Intégrations**, puis **Installer depuis GitHub**, et
   indiquez `https://github.com/guim31/gladys-hyperion`.
2. Ouvrez l'onglet **Configuration** de l'intégration. Rien n'est
   obligatoire : avec les réglages par défaut, Gladys cherche vos serveurs
   Hyperion sur le réseau.
3. Ouvrez l'onglet **Découverte** : un appareil par instance Hyperion est
   listé. Ajoutez ceux que vous voulez.

### Réglages

| Réglage                            | Ce qu'il fait                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adresses IP des serveurs           | Facultatif. Seulement pour un serveur que la découverte automatique ne trouve pas (autre sous-réseau, SSDP/mDNS bloqués). Séparez-les par des virgules ; ajoutez le port de l'API JSON s'il n'est pas 19444 (`192.168.1.20:19445`). |
| Jeton d'API                        | Facultatif. Seulement si Hyperion demande un jeton et que vous en avez créé un vous-même. Le bouton **Demander un jeton** le fait pour vous.                                                                                        |
| Priorité de Gladys                 | La priorité qu'utilise Gladys pour ses couleurs et effets (1 à 253, 128 par défaut). Hyperion affiche la source au numéro **le plus petit** : 128 passe devant les captures d'écran et USB (240 et 250 par défaut).                 |
| Langue des noms de fonctionnalités | La langue des noms donnés aux fonctionnalités des **nouveaux** appareils, et du texte « Affichage en cours ». Un appareil garde les noms avec lesquels il a été créé.                                                               |

### Découverte automatique

Hyperion s'annonce sur le réseau (SSDP et mDNS). L'intégration tourne dans un
conteneur qui ne peut pas entendre ces annonces : elle demande à Gladys de
les écouter pour elle (découverte médiée). Si elle ne trouve rien, le bouton
**Rechercher les serveurs** vous dit pourquoi ; saisissez alors l'adresse IP
du serveur dans la configuration.

Une fois connu, un serveur est suivi par son **identifiant** (celui
qu'Hyperion montre dans ses informations système), et non par son adresse :
s'il change d'adresse IP, la recherche suivante le retrouve et vos appareils
sont conservés.

### Quand Hyperion demande un jeton

Par défaut, Hyperion ne demande rien sur le réseau local. Si vous avez activé
l'**authentification de l'API locale** dans Hyperion (page Services réseau),
Gladys indique « Hyperion demande un jeton ». Alors :

1. cliquez sur **Demander un jeton** dans la configuration de l'intégration ;
2. dans les 90 secondes, ouvrez l'interface web d'Hyperion : elle affiche une
   demande nommée **Gladys Assistant**. Acceptez-la.

Le jeton est gardé dans le dossier de données de l'intégration et utilisé
ensuite. Vous pouvez aussi créer un jeton vous-même dans Hyperion (gestion des
jetons) et le coller dans le réglage **Jeton d'API**.

## Les appareils

### Éclairage, luminosité, couleur

- **Éclairage** allume ou éteint l'instance (l'interrupteur principal
  d'Hyperion pour cette instance). Allumer une instance arrêtée dans Hyperion
  la démarre.
- **Luminosité** est le réglage de luminosité d'Hyperion (le même que dans son
  interface web). La régler allume la lumière ; 0 l'éteint.
- **Couleur** affiche une couleur fixe à la priorité de Gladys : elle couvre
  l'Ambilight jusqu'à ce que vous y reveniez. Pendant un effet ou
  l'Ambilight, la couleur affichée dans Gladys est la dernière réglée.

### Effet

La liste contient les effets de votre serveur, les vôtres compris. En choisir
un le lance à la priorité de Gladys ; choisir **Aucun** retire ce que Gladys
affichait (couleur ou effet), et l'image revient.

### Ambilight

Allumé quand les LED suivent l'image (capture d'écran ou capture USB).

- **L'allumer** retire les couleurs et effets affichés par-dessus l'image —
  ceux de Gladys, mais aussi ceux d'une autre application (interface web
  d'Hyperion, autre domotique) — et rallume la capture si l'interrupteur
  l'avait coupée.
- **L'éteindre** coupe les captures vidéo (écran et USB). L'intégration retient
  celles qui étaient allumées, pour rallumer les mêmes ensuite.

### Affichage en cours

Un texte qui dit ce qu'affichent les LED : « Ambilight (capture USB) »,
« Effet : Rainbow swirl », « Couleur #FF8800 », « Éteint », « Rien », ou une
autre source (par exemple un client Kodi ou HyperHDR).

### Interrupteurs des composants

Un interrupteur par composant de votre instance : sortie LED, capture
d'écran, capture USB, capture audio (Hyperion 2.1), lissage, détection des
bandes noires. Ils font exactement ce que font les interrupteurs de
l'interface web d'Hyperion. Les composants de plomberie réseau (forwarder,
serveur Boblight) ne sont pas proposés.

## Widget

Ajoutez le widget **Hyperion** à un tableau de bord. Il montre le nom de
l'instance, sa luminosité (en direct) et ce qu'elle affiche, avec des
boutons :

- **Ambilight** : retour à l'image (comme l'interrupteur) ;
- deux **effets** choisis dans les réglages du widget ;
- **Éteindre** / **Allumer**.

Le choix actif porte une icône ✓. Dans les réglages, choisissez l'appareil
(par défaut le premier appareil Hyperion ajouté à Gladys) et les effets des
boutons (les deux premiers choisis sont utilisés).

## Actions de scène

| Action                            | Réglages                                                                                           | Résultat pour les actions suivantes |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Lancer un effet Hyperion          | Appareil ; un effet de la liste, ou le nom exact d'un autre effet ; durée en minutes (facultative) | Nom de l'effet                      |
| Afficher une couleur sur Hyperion | Appareil ; couleur (`#FF8800` ou `255, 136, 0`) ; durée en minutes (facultative)                   | Couleur affichée                    |
| Revenir à l'Ambilight             | Appareil                                                                                           | —                                   |

Avec une **durée**, Hyperion retire de lui-même l'effet ou la couleur une fois
le temps écoulé, et l'image revient — même si Gladys redémarre entre-temps.
Sans durée, ils restent jusqu'à ce que quelque chose les remplace.

Allumer et éteindre, la luminosité et la couleur sont aussi disponibles comme
actions de scène habituelles de Gladys sur les fonctionnalités de l'appareil.

L'intégration ne déclenche aucun déclencheur de scène propre : utilisez le
déclencheur habituel « la valeur d'un appareil change » sur les
fonctionnalités (Éclairage, Ambilight, Affichage en cours…).

## Exemples de scènes

- **Sonnette** : quand on sonne, _Lancer un effet Hyperion_ « Notify blue »
  pendant 1 minute — la lumière de la télé clignote en bleu, puis l'Ambilight
  revient tout seul.
- **Soirée film** : à 21 h, ou quand la télé s'allume, _Revenir à
  l'Ambilight_ et régler la luminosité à 60 %.
- **Alarme** : quand l'alarme se déclenche, _Afficher une couleur sur
  Hyperion_ `#FF0000` pendant 5 minutes.
- **Bonne nuit** : à minuit, si l'Éclairage est encore allumé, l'éteindre.

## Rafraîchissement et réseau

- Une connexion TCP par instance en marche vers l'API JSON du serveur (port
  19444), gardée ouverte : Hyperion envoie chaque changement au moment où il
  se produit.
- Chaque minute, l'intégration relit aussi chaque instance (pour rattraper une
  mise à jour perdue ou une connexion muette) et reconnecte ce qui est tombé.
  Un serveur qui ne répond pas est recherché à nouveau toutes les 30 minutes.
- Gladys ne reçoit que les valeurs qui changent, plus toutes les valeurs une
  fois toutes les 12 heures (pour ne jamais afficher « Pas de valeur
  récente »).
- Tout reste sur votre réseau local : pas de service cloud, pas de compte, pas
  de quota.

## Dépannage

- **Aucun appareil dans l'onglet Découverte** : cliquez sur **Rechercher les
  serveurs** dans la configuration et lisez le compte rendu. Si la découverte
  automatique est indisponible ou ne trouve rien, saisissez l'adresse IP du
  serveur. Vérifiez dans Hyperion (Services réseau) que le serveur JSON est
  activé, et son port.
- **« Hyperion demande un jeton »** : voir « Quand Hyperion demande un
  jeton ». Un jeton supprimé dans Hyperion est refusé : demandez-en un nouveau.
- **« Le serveur Hyperion ne répond pas »** : le Raspberry Pi est éteint, a
  changé d'adresse, ou le port du serveur JSON a changé. L'intégration
  réessaie chaque minute et recherche à nouveau sur le réseau toutes les
  30 minutes.
- **Une couleur réglée dans Gladys ne s'affiche pas** : une autre source a un
  numéro de priorité plus petit (l'interface web d'Hyperion, une autre
  application). Baissez la priorité de Gladys dans la configuration, ou
  utilisez d'abord _Revenir à l'Ambilight_.
- **De nouveaux effets ou une nouvelle instance n'apparaissent pas** : ouvrez
  l'onglet Découverte et mettez à jour l'appareil (« Mettre à jour »). Les
  noms des fonctionnalités ne changent jamais une fois l'appareil créé.
- **Journaux** : l'intégration n'écrit que ce qui change (un serveur trouvé,
  perdu ou revenu, une commande). Mettez la variable d'environnement
  `LOG_LEVEL` à `debug` pour tout voir. Les jetons ne sont jamais écrits dans
  les journaux.

## Limites

- **Développée sans le matériel** : testée seulement contre un serveur simulé
  (voir le haut de cette page).
- Hyperion.ng 2.0 ou plus récent uniquement ; HyperHDR non testé.
- L'interrupteur Ambilight connaît la capture d'écran et la capture USB ; la
  capture audio (Hyperion 2.1) est un interrupteur à part.
- Les listes d'effets de l'action de scène et des réglages du widget sont les
  effets fournis avec Hyperion (Gladys ne peut pas y lire votre serveur) : pour
  un de vos propres effets, saisissez son nom exact dans l'action de scène.
- Allumer l'Ambilight retire les couleurs et effets de toutes les
  applications, pas seulement ceux de Gladys.
- Une instance arrêtée garde les fonctionnalités qu'elle avait la dernière
  fois qu'elle a tourné.
- Pas d'aperçu vidéo des LED, pas de modification de la configuration
  d'Hyperion (disposition des LED, réglages de capture) : utilisez l'interface
  web d'Hyperion.

## Crédits

L'API JSON d'Hyperion.ng (MIT) et la bibliothèque
[hyperion-py](https://github.com/dermotduffy/hyperion-py) de Dermot Duffy
(MIT), utilisée par l'intégration Home Assistant : leurs tests ont fourni les
vraies réponses de serveur utilisées par les tests de cette intégration. Cette
intégration n'est pas affiliée au projet Hyperion. Hyperion est une marque de
ses propriétaires.
