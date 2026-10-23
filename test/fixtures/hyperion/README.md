# Hyperion fixtures

Real replies of Hyperion.ng and HyperHDR servers, used by the fake server of
`test/helpers/fakeHyperion.js`.

- `serverinfo-2.0.0-alpha.8.json`: the `serverinfo` reply of a Hyperion.ng
  2.0.0-alpha.8 server with two instances (USB capture shown), from the test
  suite of [hyperion-py](https://github.com/dermotduffy/hyperion-py)
  (`tests/testdata/serverinfo_response_1.json`, MIT, © Dermot Duffy). Only the
  host name was changed.
- `sysinfo-2.0.0-alpha.8.json`: the `sysinfo` reply of the same test suite
  (`TEST_SYSINFO_RESPONSE`), with an invented server id.
- `sysinfo-2.2.1.json`, `serverinfo-2.2.1.json`: recorded on 2026-10-23 on a
  real Hyperion.ng 2.2.1 (official `.deb` in a Debian 12 container, stock
  configuration, one instance, nothing shown).
- `sysinfo-hyperhdr-22.0.0.json`, `serverinfo-hyperhdr-22.0.0.json`: recorded
  the same day on a real HyperHDR 22.0.0 (official bookworm `.deb`, stock
  configuration, one instance). Nothing shown: HyperHDR had switched its LED
  device off by itself; its USB capture is on but has no device.

In the recorded replies, the server ids and host names were replaced by
invented ones; nothing else was changed.

The SSDP and mDNS answers are built by the fake server from the formats of
the Hyperion.ng source code (`libsrc/ssdp/SSDPServer.cpp`,
`libsrc/mdns/MdnsProvider.cpp`), with documentation addresses (192.0.2.x) in
the unit tests.
