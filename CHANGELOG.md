# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- HyperHDR support (tested with HyperHDR 22.0.0): its servers are found by
  mDNS or by address, shown with their own model ("HyperHDR 22.0.0"), and
  their screen capture, USB capture and HDR tone mapping get a switch each.
  The brightness drives HyperHDR's luminance gain.
- "Rainbow waves", HyperHDR's own effect, in the effect lists of the scene
  action and of the widget.

### Fixed

- A HyperHDR server was refused ("the server has no id"): its sysinfo names
  it `hyperhdr`, not `hyperion`.
- After a command, the state read back could undo a change the server had
  just pushed (seen on HyperHDR with the LED output): pushes received during
  the read are applied again.
- Starting a stopped instance from Gladys could time out: the server takes
  several seconds to open a new LED device (20 s allowed now).

## [1.0.1] - 2026-10-15

### Added

- Hyperion.ng servers found automatically (SSDP and mDNS through Gladys) or by
  IP address, and followed by their id across address changes.
- One device per Hyperion instance: on/off, brightness, colour, effect list,
  Ambilight switch, "Showing now" text, and a switch per component (LED
  output, screen capture, USB capture, audio capture, smoothing, black bar
  detection).
- Live states: changes made in Hyperion show up at once, and the integration
  refreshes and reconnects by itself every minute.
- Scene actions: start an effect, show a colour (both for an optional
  duration), back to the Ambilight.
- "Hyperion" dashboard widget: what the light shows, brightness, buttons for
  the Ambilight, two effects and on/off.
- "Search for servers" and "Request a token" buttons, for a Hyperion that asks
  for a token.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-hyperion/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-hyperion/releases/tag/v1.0.1
