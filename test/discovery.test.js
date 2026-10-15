// -----------------------------------------------------------------------------
// Reading the raw SSDP and mDNS results the core relays.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mdnsCandidates,
  mergeCandidates,
  parseSsdpHeaders,
  ssdpCandidates,
} from '../src/hyperion/discovery.js';

const ID = '4f2a9c1e-0b7d-5e3a-9c61-2d8e7f1a0b35';

// The M-SEARCH answer of Hyperion.ng 2.x (libsrc/ssdp/SSDPServer.cpp).
const answer = [
  'HTTP/1.1 200 OK',
  'CACHE-CONTROL: max-age = 1800',
  'DATE: Thu, 15 Oct 2026 10:00:00 GMT',
  'EXT: ',
  'LOCATION: http://192.0.2.20:8090/description.xml',
  'SERVER: Raspbian GNU/Linux 11 (bullseye)/11 UPnP/1.0 Hyperion/2.0.16',
  'ST: urn:hyperion-project.org:device:basic:1',
  `USN: uuid:${ID}`,
  'HYPERION-NAME: Living room',
  'HYPERION-JSS-PORT: 19445',
  'HYPERION-FBS-PORT: 19400',
  '',
  '',
].join('\r\n');

test('the SSDP answer of Hyperion.ng', () => {
  assert.equal(parseSsdpHeaders(answer)['hyperion-jss-port'], '19445');
  assert.deepEqual(
    ssdpCandidates([{ source_ip: '192.0.2.20', source_port: 1900, headers: answer }]),
    [
      {
        id: ID,
        host: '192.0.2.20',
        port: 19445,
        name: 'Living room',
        version: '2.0.16',
        via: 'ssdp',
      },
    ],
  );
});

test('an older answer without the Hyperion headers, and foreign answers', () => {
  // 2.0.0-alpha: no HYPERION-* headers, the JSON port is the default one.
  const older = [
    'HTTP/1.1 200 OK',
    'LOCATION: http://192.0.2.21:8090/description.xml',
    'SERVER: Raspbian GNU/Linux 10 (buster)/10 UPnP/1.0 Hyperion/2.0.0-alpha.8',
    'ST: urn:hyperion-project.org:device:basic:1',
    `USN: uuid:${ID.toUpperCase()}`,
  ].join('\r\n');
  const router = 'HTTP/1.1 200 OK\r\nSERVER: Linux UPnP/1.0 MiniUPnPd\r\nST: upnp:rootdevice\r\n';
  assert.deepEqual(
    ssdpCandidates([
      { source_ip: '192.0.2.21', headers: older },
      { source_ip: '192.0.2.1', headers: router },
      { headers: 'garbage' },
      null,
    ]),
    [
      {
        id: ID,
        host: '192.0.2.21',
        port: 19444,
        name: null,
        version: '2.0.0-alpha.8',
        via: 'ssdp',
      },
    ],
  );
  // No source address: the LOCATION host.
  assert.equal(ssdpCandidates([{ headers: older }])[0].host, '192.0.2.21');
});

test('the mDNS record of the JSON API', () => {
  assert.deepEqual(
    mdnsCandidates([
      {
        name: 'Living room@hyperion._hyperiond-json._tcp.local',
        host: 'hyperion.local',
        addresses: ['fe80::1', '192.0.2.20'],
        port: 19444,
        txt: [`ID=${ID}`, 'version=2.0.16'],
      },
      { name: 'other._http._tcp.local', addresses: ['192.0.2.30'], port: 80, txt: [] },
      { name: 'x._hyperiond-json._tcp.local', addresses: ['fe80::2'], port: 19444, txt: [] },
    ]),
    [{ id: ID, host: '192.0.2.20', port: 19444, name: null, version: '2.0.16', via: 'mdns' }],
  );
});

test('a server found twice is one candidate, completed by the second answer', () => {
  const ssdp = { id: ID, host: '192.0.2.20', port: 19444, name: null, version: null, via: 'ssdp' };
  const mdns = {
    id: ID,
    host: '192.0.2.20',
    port: 19444,
    name: null,
    version: '2.0.16',
    via: 'mdns',
  };
  const manual = { id: null, host: '192.0.2.20', port: 19444, via: 'manual' };
  const other = { id: null, host: '192.0.2.40', port: 19444, via: 'manual' };
  assert.deepEqual(mergeCandidates([ssdp], [mdns], [manual, other]), [
    { ...ssdp, version: '2.0.16' },
    other,
  ]);
});
