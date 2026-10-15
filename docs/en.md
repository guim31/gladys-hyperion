# Hyperion

Control your [Hyperion.ng](https://hyperion-project.org) ambient lighting from
Gladys: the LED strip behind the TV, driven by a Raspberry Pi (or any computer
running Hyperion) that copies the colours of the picture — the "Ambilight"
effect.

> **Developed without the hardware: feedback welcome.** This integration was
> written and tested against the Hyperion JSON API documentation, the code of
> Hyperion.ng and the real server replies published by the `hyperion-py`
> library, not against a real Hyperion server. Please report what works and
> what does not on the Gladys forum or in the GitHub issues.
>
> This integration is not affiliated with the Hyperion project.

## What you get

- **One Gladys device per Hyperion instance.** An instance is one LED output
  configured in Hyperion (most people have one; a second one can drive a WLED
  strip, a Hue bridge...).
- On each device:
  - **Light**: on/off of the instance;
  - **Brightness** (0-100 %), **Color** (a fixed colour);
  - **Effect**: the effects of your server (the built-in ones and yours), or
    "None";
  - **Ambilight**: on when the LEDs follow the picture (screen or USB
    capture);
  - **Showing now**: a text telling what the LEDs show (Ambilight, an
    effect, a colour, off...);
  - one switch per **component** your instance has: LED output, screen
    capture, USB capture, audio capture, smoothing, black bar detection.
- **Three scene actions**: start an effect, show a colour (both for a given
  time if you want), go back to the Ambilight.
- **A dashboard widget**: what the light shows, and one-tap buttons
  (Ambilight, two effects of your choice, on/off).

Changes made elsewhere (Hyperion web interface, remote, another home
automation) show up in Gladys within a second: Hyperion pushes them.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A **Hyperion.ng** server (version 2.0 or later) on the same local network
  as Gladys, with its **JSON server** enabled (it is by default, on port
  19444). The old "classic" Hyperion (before 2.0) is not supported.
- **HyperHDR** speaks the same JSON API and should work too, by entering its
  address by hand (not tested).
- No account, no cloud: everything stays on your network.

## Installation and configuration

1. In Gladys, open **Integrations**, then **Install from GitHub**, and give
   `https://github.com/guim31/gladys-hyperion`.
2. Open the **Configuration** tab of the integration. Nothing is mandatory:
   with the default settings, Gladys looks for your Hyperion servers on the
   network.
3. Open the **Discovery** tab: one device per Hyperion instance is listed. Add
   the ones you want.

### Settings

| Setting                       | What it does                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server IP addresses           | Optional. Only for a server the automatic discovery does not find (another subnet, SSDP/mDNS blocked). Separate them with commas; add the JSON API port when it is not 19444 (`192.168.1.20:19445`).    |
| API token                     | Optional. Only if Hyperion asks for a token and you created one yourself. The **Request a token** button does it for you.                                                                               |
| Priority of Gladys            | The priority Gladys uses for its colours and effects (1 to 253, 128 by default). Hyperion shows the source with the **lowest** number: 128 covers the screen and USB captures (240 and 250 by default). |
| Language of the feature names | The language of the names given to the features of **new** devices, and of the "Showing now" text. A device keeps the names it was created with.                                                        |

### Automatic discovery

Hyperion announces itself on the network (SSDP and mDNS). The integration
runs in a container that cannot hear these announcements: it asks Gladys to
listen for it (mediated discovery). If it finds nothing, the **Search for
servers** button tells you why; enter the IP address of the server in the
configuration.

Once known, a server is followed by its **id** (the one Hyperion shows in its
system information), not by its address: if it gets a new IP address, the
next search finds it again and your devices are kept.

### When Hyperion asks for a token

By default, Hyperion does not ask for anything on the local network. If you
turned on **Local API Authentication** in Hyperion (Network Services page),
Gladys says "Hyperion asks for a token". Then:

1. click **Request a token** in the configuration of the integration;
2. within 90 seconds, open the Hyperion web interface: it shows a request
   named **Gladys Assistant**. Accept it.

The token is kept in the integration's data folder and used from then on.
You can also create a token yourself in Hyperion (token management) and paste
it in the **API token** setting.

## The devices

### Light, brightness, colour

- **Light** turns the instance on or off (Hyperion's main switch for this
  instance). Turning on an instance that was stopped in Hyperion starts it.
- **Brightness** is Hyperion's brightness setting (the same as in its web
  interface). Setting it turns the light on; 0 turns it off.
- **Color** shows a fixed colour at the priority of Gladys: it covers the
  Ambilight until you go back to it. While an effect or the Ambilight runs,
  the colour shown in Gladys is the last one set.

### Effect

The list holds the effects of your server, your own included. Choosing one
starts it at the priority of Gladys; choosing **None** removes what Gladys
showed (colour or effect), and the picture comes back.

### Ambilight

On when the LEDs follow the picture (screen capture or USB capture).

- **Turning it on** removes the colours and effects shown over the picture —
  those set by Gladys, and also those set by another application (Hyperion
  web interface, another home automation) — and turns the capture on again if
  the switch turned it off.
- **Turning it off** turns the video captures off (screen and USB). The
  integration remembers which ones were on, to turn the same ones on later.

### Showing now

A text that tells what the LEDs show: "Ambilight (USB capture)", "Effect:
Rainbow swirl", "Color #FF8800", "Off", "Nothing", or another source (for
example a Kodi or HyperHDR client).

### Component switches

One switch per component your instance has: LED output, screen capture, USB
capture, audio capture (Hyperion 2.1), smoothing, black bar detection. They
do exactly what the switches of the Hyperion web interface do. The network
plumbing components (forwarder, Boblight server) are not offered.

## Widget

Add the **Hyperion** widget to a dashboard. It shows the name of the
instance, its brightness (live) and what it shows now, with buttons:

- **Ambilight**: back to the picture (same as the switch);
- two **effects** chosen in the widget settings;
- **Turn off** / **Turn on**.

The active choice carries a ✓ icon. In the settings, choose the device (the
first Hyperion device added to Gladys by default) and the effects of the
buttons (the first two chosen are used).

## Scene actions

| Action                   | Settings                                                                                             | Result for the next actions |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------- |
| Start a Hyperion effect  | Device; an effect from the list, or the exact name of another effect; duration in minutes (optional) | Effect name                 |
| Show a color on Hyperion | Device; colour (`#FF8800` or `255, 136, 0`); duration in minutes (optional)                          | Colour shown                |
| Back to the Ambilight    | Device                                                                                               | —                           |

With a **duration**, Hyperion removes the effect or the colour by itself when
the time is up, and the picture comes back — even if Gladys restarts in the
meantime. Without a duration, it stays until something replaces it.

Turning the light on and off, the brightness and the colour are also
available as the usual Gladys scene actions on the device features.

The integration fires no scene trigger of its own: use the usual "a device
value changes" trigger on the features (Light, Ambilight, Showing now...).

## Scene examples

- **Doorbell**: when the doorbell rings, _Start a Hyperion effect_ "Notify
  blue" for 1 minute — the TV light flashes blue, then the Ambilight comes
  back by itself.
- **Movie night**: at 9 pm, or when the TV turns on, _Back to the Ambilight_
  and set the brightness to 60 %.
- **Alarm**: when the alarm goes off, _Show a color on Hyperion_ `#FF0000`
  for 5 minutes.
- **Good night**: at midnight, if the Light is still on, turn it off.

## Refresh and network use

- One TCP connection per running instance to the JSON API of the server (port
  19444), kept open: Hyperion pushes every change as it happens.
- Every minute, the integration also reads each instance again (to catch a
  lost update or a silent connection) and reconnects what dropped. A server
  that does not answer is searched for again every 30 minutes.
- Gladys only receives the values that changed, plus every value again once
  every 12 hours (so it never shows "no recent value").
- Everything stays on your local network: there is no cloud service, no
  account and no quota.

## Troubleshooting

- **No device in the Discovery tab**: click **Search for servers** in the
  configuration and read the report. If automatic discovery is unavailable or
  finds nothing, enter the IP address of the server. Check in Hyperion
  (Network Services) that the JSON server is enabled, and its port.
- **"Hyperion asks for a token"**: see "When Hyperion asks for a token". A
  token deleted in Hyperion is refused: request a new one.
- **"The Hyperion server does not answer"**: the Raspberry Pi is off, has a
  new address, or the JSON server port changed. The integration retries every
  minute and searches the network again every 30 minutes.
- **A colour set in Gladys does not show**: another source has a lower
  priority number (the Hyperion web interface, another application). Lower
  the priority of Gladys in the configuration, or use _Back to the Ambilight_
  first.
- **New effects or a new instance do not show**: open the Discovery tab and
  update the device ("Update"). Feature names never change once a device is
  created.
- **Logs**: the integration only logs what changes (a server found, lost or
  back, a command). Set the `LOG_LEVEL` environment variable to `debug` to see
  everything. Tokens are never written in the logs.

## Limits

- **Developed without the hardware**: tested against a simulated server only
  (see the top of this page).
- Hyperion.ng 2.0 or later only; HyperHDR untested.
- The Ambilight switch knows the screen capture and the USB capture; the
  audio capture (Hyperion 2.1) is a separate switch.
- The effect lists of the scene action and of the widget settings are the
  effects Hyperion ships with (Gladys cannot read your server there): for one
  of your own effects, type its exact name in the scene action.
- Turning the Ambilight on removes the colours and effects of every
  application, not only those of Gladys.
- A stopped instance keeps the features it had when it last ran.
- No video preview of the LEDs, no editing of Hyperion's configuration (LED
  layout, capture settings): use the Hyperion web interface.

## Credits

The JSON API of Hyperion.ng (MIT) and the
[hyperion-py](https://github.com/dermotduffy/hyperion-py) library by Dermot
Duffy (MIT), used by the Home Assistant integration: their tests provided the
real server replies used by the tests of this integration. This integration
is not affiliated with the Hyperion project. Hyperion is a trademark of its
owners.
