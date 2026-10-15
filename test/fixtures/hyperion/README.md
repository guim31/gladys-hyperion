# Hyperion fixtures

Real replies of a Hyperion.ng server, used by the fake server of
`test/helpers/fakeHyperion.js`.

- `serverinfo-2.0.0-alpha.8.json`: the `serverinfo` reply of a Hyperion.ng
  2.0.0-alpha.8 server with two instances (USB capture shown), from the test
  suite of [hyperion-py](https://github.com/dermotduffy/hyperion-py)
  (`tests/testdata/serverinfo_response_1.json`, MIT, © Dermot Duffy). Only the
  host name was changed.
- `sysinfo-2.0.0-alpha.8.json`: the `sysinfo` reply of the same test suite
  (`TEST_SYSINFO_RESPONSE`), with an invented server id.

The SSDP and mDNS answers are built by the fake server from the formats of
the Hyperion.ng source code (`libsrc/ssdp/SSDPServer.cpp`,
`libsrc/mdns/MdnsProvider.cpp`), with documentation addresses (192.0.2.x) in
the unit tests.
