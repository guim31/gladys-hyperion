# Hyperion for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that controls [Hyperion.ng](https://hyperion-project.org) servers — the
ambient lighting ("Ambilight") behind a TV, driven by a Raspberry Pi — over
their local JSON API.

> **Developed without the hardware: feedback welcome.** Everything was built
> and tested against the Hyperion JSON API documentation, the Hyperion.ng
> source code and the real server replies published by `hyperion-py`, through
> a simulated server. Nothing has run against a real Hyperion yet. Please
> report what works and what does not.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

- **Discovery**: Hyperion servers are found through Gladys' mediated SSDP
  (`urn:hyperion-project.org:device:basic:1`) and mDNS
  (`_hyperiond-json._tcp`) discovery, or by IP address. A server is followed by
  its Hyperion id, so a new IP address keeps the devices.
- **One device per Hyperion instance**, with:
  - light on/off (the instance's `ALL` component; a stopped instance is
    started), brightness, fixed colour;
  - the effect list of the server (built-in and user effects), "None" to go
    back;
  - an **Ambilight** switch (on when a screen or USB capture is what the LEDs
    show; on → removes the colours and effects shown over the picture; off →
    turns the video captures off, remembering which ones);
  - a "Showing now" text (Ambilight, effect, colour, off...);
  - one switch per component: LED output, screen capture, USB capture, audio
    capture, smoothing, black bar detection.
- **Live**: one connection per running instance, subscribed to Hyperion's
  updates (pushed as they happen), plus the integration's own refresh every
  minute; Gladys never needs to poll.
- **Scene actions**: start an effect (built-in list or any name, optional
  duration), show a colour (optional duration), back to the Ambilight.
- **Dashboard widget**: what the light shows, live brightness, buttons for
  Ambilight, two chosen effects and on/off.
- **Optional token**: when Hyperion's "Local API Authentication" is on, a
  "Request a token" button sends a request the user accepts in the Hyperion
  web interface (like Home Assistant does), or a token can be pasted.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Hyperion.ng 2.0 or later, JSON server enabled (port 19444 by default), on
  the same local network as Gladys. HyperHDR (same JSON API) should work by IP
  address, untested.

## Installation

In Gladys: **Integrations → Install from GitHub**, then
`https://github.com/guim31/gladys-hyperion`. Open the **Discovery** tab and
add the instances you want. See the [documentation](docs/en.md) for the
settings, the token and the troubleshooting.

## How it works

- The JSON API is newline-delimited JSON over TCP (port 19444). Each request
  carries a `tan` that the reply echoes. A connection is bound to one instance
  (`instance switchTo`), hence one connection per running instance. `serverinfo`
  with `subscribe` returns the full state and makes the server push
  `components-update`, `priorities-update`, `adjustment-update`,
  `effects-update` and `instance-update`.
- The integration runs in Gladys' sandbox (bridge network, read-only rootfs,
  256 MB): SSDP and mDNS go through the core; only unicast TCP to the server
  leaves the container.
- Colours and effects are set at the configured priority (128 by default,
  origin `Gladys`), below the captures (240/250) — the lowest number wins.
- States go through the SDK's `publishChangedStates` (only changes, plus a
  12-hour heartbeat). Devices are published with `should_poll: false`; the
  hub's own timer reads every instance every minute, reconnects, and searches
  the network again every 30 minutes while a server is lost.
- `/data/hyperion-state.json` keeps the known servers (to publish their
  devices while they are off), the tokens obtained by "Request a token" and the
  captures the Ambilight switch turned off.

## Limitations

- Developed and tested without a real Hyperion (see above).
- Hyperion.ng 2.0+ only; HyperHDR untested.
- The effect lists of the scene action and of the widget settings are the
  effects Hyperion ships with: a custom effect is named in a free text field.
- Turning the Ambilight on clears the colours and effects of every API client,
  not only Gladys'.
- No LED preview, no editing of Hyperion's configuration.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + fake Hyperion servers on loopback
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store . --skip-image-check   # store validator
```

```
index.js                 SDK wiring (src/app.js registers the handlers)
src/app.js               every SDK handler -> the hub; action reports
src/hub.js               discovery, links, states, commands, refresh timer, token request
src/devices.js           Hyperion instance -> Gladys device, feature values
src/hyperion/client.js   JSON API client (TCP, tan matching, pushed updates)
src/hyperion/model.js    reading serverinfo and its updates, colours
src/hyperion/discovery.js SSDP and mDNS results
src/scenes.js            scene actions
src/widgets.js           "Hyperion" dashboard widget
src/i18n.js              every text, in en/fr/de/es
src/store.js             /data/hyperion-state.json
scripts/probe.mjs        read-only check of a real server
test/                    node --test; SDK fake Gladys, fake Hyperion (test/helpers)
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To check a real server without Gladys (read-only: sysinfo and serverinfo,
nothing is changed, the token is never printed):

```bash
node scripts/probe.mjs 192.168.1.20            # HYPERION_TOKEN=... if Hyperion asks for one
```

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="hyperion" \
HYPERION_DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image and the
GitHub Release, but then `version` in `package.json` and in the manifest (with
the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [hyperion-py](https://github.com/dermotduffy/hyperion-py) by Dermot Duffy
  (MIT): the protocol details (tan handling, subscriptions, token request) and
  the real `serverinfo` / `sysinfo` replies of its test suite, used as fixtures
  in `test/fixtures/hyperion/` (server id replaced).
- Home Assistant's
  [`hyperion`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/hyperion)
  integration (Apache-2.0): the SSDP search target, the token flow, the
  component switches, the light as a priority.
- [Hyperion.ng](https://github.com/hyperion-project/hyperion.ng) (MIT): the
  JSON-RPC schemas, the authorization rules and the SSDP/mDNS announcements,
  read in its source code.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the Hyperion
project. "Hyperion" is the name of its owners' project.

## License

Apache-2.0
