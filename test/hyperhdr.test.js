// -----------------------------------------------------------------------------
// HyperHDR, the Hyperion fork with the same JSON API: what differs, as seen on
// a real HyperHDR 22.0.0 (test/fixtures/hyperion/*hyperhdr-22.0.0.json), and
// the real Hyperion.ng 2.2.1 replies read the same way as before.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HYPERHDR_ID,
  HYPERHDR_SERVERINFO,
  HYPERHDR_SYSINFO,
  SERVERINFO_2_2_1,
  createFakeHyperion,
} from './helpers/fakeHyperion.js';
import { createAll, createWorld, featureId, instanceId, target, until } from './helpers/world.js';
import {
  availableComponents,
  brightness,
  brightnessAdjustment,
  isOn,
  serverIdentity,
} from '../src/hyperion/model.js';
import { mdnsCandidates, ssdpCandidates } from '../src/hyperion/discovery.js';
import { DEFAULT_PORT } from '../src/hyperion/client.js';

const SYSINFO_2_2_1 = JSON.parse(
  readFileSync(new URL('./fixtures/hyperion/sysinfo-2.2.1.json', import.meta.url), 'utf8'),
).info;

async function setup(t, serverOptions = {}) {
  const server = await createFakeHyperion({
    product: 'HyperHDR',
    instances: [{ instance: 0, name: 'Cinema' }],
    ...serverOptions,
  });
  const world = await createWorld({
    servers: [server],
    scan: 'none',
    config: { hosts: `127.0.0.1:${server.port}` },
  });
  t.after(async () => {
    await world.app.stop();
    await server.stop().catch(() => {});
  });
  await createAll(world);
  return { server, world, gladys: world.gladys };
}

const state = (world, server, key) =>
  world.gladys.fake.lastState(featureId(world.gladys, server, 0, key));

const setValue = (world, server, key, value) => {
  const { device, feature } = target(world, server, 0, key);
  return world.gladys.fake.setValue(device, feature, value);
};

test('the sysinfo of each software tells which one answers', () => {
  assert.deepEqual(serverIdentity(HYPERHDR_SYSINFO), {
    product: 'HyperHDR',
    id: HYPERHDR_ID,
    version: '22.0.0',
  });
  assert.deepEqual(serverIdentity(SYSINFO_2_2_1), {
    product: 'Hyperion',
    id: SYSINFO_2_2_1.hyperion.id,
    version: '2.2.1',
  });
  assert.deepEqual(serverIdentity({}), { product: 'Hyperion', id: '', version: null });
});

test('a real Hyperion.ng 2.2.1 keeps the reading of the earlier versions', () => {
  assert.deepEqual(availableComponents(SERVERINFO_2_2_1), [
    'LEDDEVICE',
    'GRABBER',
    'V4L',
    'AUDIO',
    'SMOOTHING',
    'BLACKBORDER',
  ]);
  assert.equal(isOn(SERVERINFO_2_2_1), true);
  assert.equal(brightness(SERVERINFO_2_2_1), 100);
  assert.deepEqual(brightnessAdjustment(SERVERINFO_2_2_1, 40), { brightness: 40 });
});

test('HyperHDR: its components, its brightness, on while its LED output rests', () => {
  // Recorded with nothing to show: HyperHDR had switched LEDDEVICE off itself.
  assert.equal(
    HYPERHDR_SERVERINFO.components.find((entry) => entry.name === 'LEDDEVICE').enabled,
    false,
  );
  assert.equal(isOn(HYPERHDR_SERVERINFO), true);
  assert.deepEqual(availableComponents(HYPERHDR_SERVERINFO), [
    'SMOOTHING',
    'BLACKBORDER',
    'SYSTEMGRABBER',
    'VIDEOGRABBER',
    'HDR',
  ]);
  assert.equal(brightness(HYPERHDR_SERVERINFO), 100);
  assert.equal(brightness({ adjustment: [{ luminanceGain: 0.35 }] }), 35);
  assert.equal(brightness({ adjustment: [{ luminanceGain: 2.5 }] }), 100);
  assert.deepEqual(brightnessAdjustment(HYPERHDR_SERVERINFO, 40), { luminanceGain: 0.4 });
});

test('HyperHDR found by mDNS (its web service) is tried on the JSON port', () => {
  const [candidate] = mdnsCandidates([
    {
      name: 'hyperhdr-host:8090._hyperhdr-http._tcp.local',
      addresses: ['192.0.2.30'],
      port: 8090,
      txt: ['version=22.0.0'],
    },
  ]);
  assert.deepEqual(candidate, {
    id: null,
    host: '192.0.2.30',
    port: DEFAULT_PORT,
    name: null,
    version: '22.0.0',
    via: 'mdns',
  });
  // Its own SSDP answer (the core searches the Hyperion target only, but a
  // reply that reaches us is read).
  const [ssdp] = ssdpCandidates([
    {
      source_ip: '192.0.2.30',
      headers: [
        'HTTP/1.1 200 OK',
        'ST: urn:hyperhdr.eu:device:basic:1',
        `USN: uuid:${HYPERHDR_ID}`,
        'HYPERHDR-JSS-PORT: 19445',
        'HYPERHDR-NAME: Living room',
      ].join('\r\n'),
    },
  ]);
  assert.equal(ssdp.id, HYPERHDR_ID);
  assert.equal(ssdp.port, 19445);
  assert.equal(ssdp.name, 'Living room');
});

test('a HyperHDR server becomes a device with its own components', async (t) => {
  const { server, world, gladys } = await setup(t);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, instanceId(gladys, server, 0));
  assert.equal(device.model, 'HyperHDR 22.0.0');
  assert.deepEqual(
    device.features.map((feature) => feature.external_id.split(':').pop()),
    [
      'power',
      'brightness',
      'color',
      'effect',
      'ambilight',
      'source',
      'component-smoothing',
      'component-blackborder',
      'component-systemgrabber',
      'component-videograbber',
      'component-hdr',
    ],
  );
  assert.deepEqual(
    device.features.slice(-3).map((feature) => feature.name),
    ["Capture d'écran", 'Capture USB', 'Tone mapping HDR'],
  );
  assert.equal(state(world, server, 'power'), 1);
  assert.equal(state(world, server, 'brightness'), 100);
  assert.equal(state(world, server, 'source'), 'Rien');
  const report = await gladys.fake.action('search', {});
  assert.match(report.data.message.en, /HyperHDR 22\.0\.0, 1 instance\(s\)/);
});

test('HyperHDR: brightness goes through luminanceGain, colours and components work', async (t) => {
  const { server, world } = await setup(t);
  await setValue(world, server, 'brightness', 40);
  assert.deepEqual(
    server.requests.filter((request) => request.command === 'adjustment').at(-1).adjustment,
    { luminanceGain: 0.4 },
  );
  await until(() => state(world, server, 'brightness') === 40, { message: 'brightness 40' });

  await setValue(world, server, 'color', 0x0000ff);
  await until(() => state(world, server, 'source') === 'Couleur #0000FF', { message: 'colour' });
  // HyperHDR turned its LED output on by itself: no LEDDEVICE command sent.
  assert.ok(!server.requests.some((request) => request.componentstate?.component === 'LEDDEVICE'));

  await setValue(world, server, 'component-hdr', 1);
  await until(() => state(world, server, 'component-hdr') === 1, { message: 'HDR on' });
});

test('HyperHDR: the Ambilight switch drives its system and video grabbers', async (t) => {
  const { server, world } = await setup(t);
  await setValue(world, server, 'ambilight', 0);
  await until(() => state(world, server, 'component-videograbber') === 0, {
    message: 'video grabber off',
  });
  await setValue(world, server, 'ambilight', 1);
  await until(() => state(world, server, 'component-videograbber') === 1, {
    message: 'video grabber back',
  });
  // The system grabber was off before: it stays off.
  assert.equal(state(world, server, 'component-systemgrabber'), 0);
});

test('a serverinfo older than the pushes before it does not undo them', async (t) => {
  const { server, world } = await setup(t);
  await setValue(world, server, 'color', 0xff0000);
  server.staleSnapshots = true;
  const hub = world.hub.servers.get(HYPERHDR_ID);
  const led = () =>
    hub.infos.get(0).components.find((component) => component.name === 'LEDDEVICE').enabled;
  assert.equal(led(), true);
  // ALL off: LEDDEVICE follows (pushed), then the reply to the refresh that
  // follows the command still says LEDDEVICE on.
  await setValue(world, server, 'power', 0);
  await until(() => state(world, server, 'power') === 0, { message: 'off' });
  assert.equal(led(), false);
  await setValue(world, server, 'power', 1);
  await until(() => state(world, server, 'power') === 1, { message: 'on' });
  assert.equal(led(), true);
});
