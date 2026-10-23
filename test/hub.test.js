// -----------------------------------------------------------------------------
// The hub end to end: discovery, devices, states and commands, against fake
// Hyperion servers on the loopback interface and the SDK's fake Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { CONNECTION_TEXT } from '../src/i18n.js';
import {
  SERVER_ID,
  VALID_TOKEN,
  createFakeHyperion,
  instanceInfo,
} from './helpers/fakeHyperion.js';
import {
  createAll,
  createWorld,
  featureId,
  instanceId,
  settle,
  target,
  until,
} from './helpers/world.js';

/** A world with one server (two instances), every device added. */
async function setup(t, { server: serverOptions, ...options } = {}) {
  const server = await createFakeHyperion(serverOptions);
  const world = await createWorld({ servers: [server], ...options });
  t.after(async () => {
    await world.app.stop();
    await server.stop().catch(() => {});
  });
  return { server, world, gladys: world.gladys };
}

const state = (world, server, instance, key) =>
  world.gladys.fake.lastState(featureId(world.gladys, server, instance, key));

const setValue = (world, server, instance, key, value) => {
  const { device, feature } = target(world, server, instance, key);
  return world.gladys.fake.setValue(device, feature, value);
};

const requestsOf = (server, command) =>
  server.requests.filter((request) => request.command === command);

test('a server found by SSDP becomes one device per instance', async (t) => {
  const { server, gladys, world } = await setup(t);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['TV', 'Desk'],
  );
  const [tv] = devices;
  assert.equal(tv.external_id, instanceId(gladys, server, 0));
  assert.equal(tv.model, 'Hyperion 2.0.0-alpha.8');
  assert.equal(tv.should_poll, false);
  assert.deepEqual(tv.params, [
    { name: 'IP_ADDRESS', value: '127.0.0.1' },
    { name: 'HYPERION_PORT', value: String(server.port) },
    { name: 'HYPERION_ID', value: SERVER_ID },
    { name: 'HYPERION_INSTANCE', value: '0' },
  ]);
  // French by default, the fixture's components only (no audio capture).
  assert.deepEqual(
    tv.features.map((feature) => feature.name),
    [
      'Éclairage',
      'Luminosité',
      'Couleur',
      'Effet',
      'Ambilight',
      'Affichage en cours',
      'Sortie LED',
      "Capture d'écran",
      'Capture USB',
      'Lissage',
      'Détection des bandes noires',
    ],
  );
  const effect = tv.features.find((feature) => feature.external_id.endsWith(':effect'));
  assert.equal(effect.supported_options[0].value, 'none');
  assert.equal(effect.supported_options[0].label, 'Aucun');
  assert.equal(effect.supported_options.length, 40);
  assert.deepEqual(gladys.fake.connectionStatuses, [{ connected: true }]);

  // Nothing is sent for devices Gladys does not have yet.
  assert.equal(gladys.fake.states.length, 0);
  await createAll(world);
  assert.equal(state(world, server, 0, 'power'), 1);
  assert.equal(state(world, server, 0, 'brightness'), 83);
  assert.equal(state(world, server, 0, 'ambilight'), 1);
  assert.equal(state(world, server, 0, 'source'), 'Ambilight (capture USB)');
  assert.equal(state(world, server, 0, 'effect'), 'none');
  assert.equal(state(world, server, 0, 'component-v4l'), 1);
  assert.equal(state(world, server, 0, 'component-grabber'), 0);
});

test('the server is remembered under /data, and found by mDNS or by its address', async (t) => {
  const server = await createFakeHyperion();
  t.after(() => server.stop());

  const byMdns = await createWorld({ servers: [server], scan: 'mdns' });
  assert.equal(byMdns.gladys.fake.discoveredDevices.length, 2);
  await byMdns.app.stop();
  const saved = JSON.parse(await readFile(join(byMdns.dataDir, 'hyperion-state.json'), 'utf8'));
  assert.equal(saved.servers[SERVER_ID].port, server.port);
  assert.deepEqual(
    saved.servers[SERVER_ID].instances.map((instance) => instance.name),
    ['TV', 'Desk'],
  );

  const byAddress = await createWorld({
    servers: [server],
    scan: 'none',
    config: { hosts: `http://127.0.0.1:${server.port}/` },
  });
  assert.equal(byAddress.gladys.fake.discoveredDevices.length, 2);
  await byAddress.app.stop();

  // No scan, no address: the server is still known from /data.
  const remembered = await createWorld({
    servers: [server],
    scan: 'none',
    dataDir: byMdns.dataDir,
  });
  assert.equal(remembered.gladys.fake.discoveredDevices.length, 2);
  await remembered.app.stop();
});

test('nothing found: Gladys says so, and the search report explains why', async (t) => {
  const world = await createWorld({ servers: [], config: { hosts: '127.0.0.1:1, 300.1.2.3' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.gladys.fake.connectionStatuses.at(-1), {
    connected: false,
    message: CONNECTION_TEXT.noServer,
  });
  // The core refuses the scans (an older Gladys, a manifest without them).
  t.mock.method(world.gladys, 'scanNetwork', async () => {
    throw new GladysApiError(403, 'FORBIDDEN', 'network_discovery: capture type not declared');
  });
  const ack = await world.gladys.fake.action('search', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'No Hyperion or HyperHDR server found. Automatic discovery through Gladys is unavailable: enter the IP ' +
      'address of the server. No answer from: 127.0.0.1:1. Ignored addresses: 300.1.2.3.',
  );
  assert.match(ack.data.message.fr, /^Aucun serveur Hyperion ou HyperHDR trouvé\./);
});

test('the search report lists the servers', async (t) => {
  const { gladys, server } = await setup(t);
  const ack = await gladys.fake.action('search', {});
  assert.equal(
    ack.data.message.en,
    `1 server(s), 1 answering: My Hyperion Config (127.0.0.1:${server.port}, Hyperion ` +
      '2.0.0-alpha.8, 2 instance(s)).',
  );
  assert.equal(
    ack.data.message.de,
    `1 Server, davon 1 erreichbar: My Hyperion Config (127.0.0.1:${server.port}, Hyperion ` +
      '2.0.0-alpha.8, 2 Instanz(en)).',
  );
});

test('on, off and brightness drive the instance', async (t) => {
  const { server, world } = await setup(t);
  await createAll(world);

  assert.deepEqual(await setValue(world, server, 0, 'power', 0), { success: true });
  assert.deepEqual(requestsOf(server, 'componentstate').at(-1).componentstate, {
    component: 'ALL',
    state: false,
  });
  assert.equal(state(world, server, 0, 'power'), 0);
  assert.equal(state(world, server, 0, 'source'), 'Éteint');
  assert.equal(state(world, server, 0, 'ambilight'), 0);
  assert.equal(state(world, server, 1, 'power'), 1, 'the other instance is untouched');

  await setValue(world, server, 0, 'brightness', 40);
  const adjustment = requestsOf(server, 'adjustment').at(-1);
  assert.deepEqual(adjustment.adjustment, { id: 'default', brightness: 40 });
  assert.equal(adjustment.instance, 0);
  assert.equal(state(world, server, 0, 'brightness'), 40);
  assert.equal(state(world, server, 0, 'power'), 1, 'a brightness turns the light on');

  await setValue(world, server, 0, 'brightness', 0);
  assert.equal(state(world, server, 0, 'power'), 0, 'brightness 0 turns it off');
  await setValue(world, server, 0, 'power', 1);
  assert.equal(state(world, server, 0, 'power'), 1);
  assert.equal(state(world, server, 0, 'brightness'), 40, 'the brightness is kept');
});

test('a colour and an effect cover the capture, at the priority of the configuration', async (t) => {
  const { server, world } = await setup(t, { config: { priority: 64, language: 'en' } });
  await createAll(world);

  await setValue(world, server, 1, 'color', 0xff8800);
  const color = requestsOf(server, 'color').at(-1);
  assert.deepEqual(
    {
      instance: color.instance,
      priority: color.priority,
      color: color.color,
      origin: color.origin,
    },
    { instance: 1, priority: 64, color: [255, 136, 0], origin: 'Gladys' },
  );
  assert.equal(state(world, server, 1, 'color'), 0xff8800);
  assert.equal(state(world, server, 1, 'source'), 'Color #FF8800');
  assert.equal(state(world, server, 1, 'ambilight'), 0);

  await setValue(world, server, 1, 'effect', 'Rainbow swirl');
  assert.deepEqual(requestsOf(server, 'effect').at(-1).effect, { name: 'Rainbow swirl' });
  assert.equal(state(world, server, 1, 'effect'), 'Rainbow swirl');
  assert.equal(state(world, server, 1, 'source'), 'Effect: Rainbow swirl');
  assert.equal(state(world, server, 1, 'color'), 0xff8800, 'the last colour stays');

  const unknown = await setValue(world, server, 1, 'effect', 'Disco');
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /Unknown effect "Disco"/);

  await setValue(world, server, 1, 'effect', 'none');
  assert.deepEqual(requestsOf(server, 'clear').at(-1).priority, 64);
  assert.equal(state(world, server, 1, 'effect'), 'none');
  assert.equal(state(world, server, 1, 'source'), 'Ambilight (USB capture)');
  assert.equal(state(world, server, 1, 'ambilight'), 1);
});

test('the Ambilight switch: back to the picture, or the captures off and on again', async (t) => {
  const { server, world } = await setup(t);
  await createAll(world);

  // Another application set a colour above ours, and Gladys an effect.
  server.mutate(0, (info) => {
    info.priorities.push({
      active: true,
      componentId: 'COLOR',
      origin: 'Web',
      owner: 'System',
      priority: 1,
      value: { RGB: [0, 0, 255] },
    });
  });
  await setValue(world, server, 0, 'effect', 'Candle');
  assert.equal(state(world, server, 0, 'ambilight'), 0);
  assert.equal(state(world, server, 0, 'source'), 'Couleur #0000FF');

  await setValue(world, server, 0, 'ambilight', 1);
  assert.deepEqual(
    requestsOf(server, 'clear')
      .map((request) => request.priority)
      .sort(),
    [1, 128],
  );
  assert.equal(state(world, server, 0, 'ambilight'), 1);
  assert.equal(state(world, server, 0, 'source'), 'Ambilight (capture USB)');

  // Off: the USB capture (the only one on) is turned off...
  await setValue(world, server, 0, 'ambilight', 0);
  assert.deepEqual(
    requestsOf(server, 'componentstate').map((request) => request.componentstate),
    [{ component: 'V4L', state: false }],
  );
  assert.equal(state(world, server, 0, 'ambilight'), 0);
  assert.equal(state(world, server, 0, 'component-v4l'), 0);
  // ... and on again: that one only, not the screen capture that was off.
  await setValue(world, server, 0, 'ambilight', 1);
  assert.deepEqual(
    requestsOf(server, 'componentstate')
      .slice(1)
      .map((request) => request.componentstate),
    [{ component: 'V4L', state: true }],
  );
  assert.equal(state(world, server, 0, 'component-v4l'), 1);
  assert.equal(state(world, server, 0, 'component-grabber'), 0);
});

test('the component switches', async (t) => {
  const { server, world } = await setup(t);
  await createAll(world);
  await setValue(world, server, 0, 'component-smoothing', 0);
  assert.deepEqual(requestsOf(server, 'componentstate').at(-1).componentstate, {
    component: 'SMOOTHING',
    state: false,
  });
  assert.equal(state(world, server, 0, 'component-smoothing'), 0);
  await setValue(world, server, 0, 'component-grabber', 1);
  assert.equal(state(world, server, 0, 'component-grabber'), 1);
});

test('a token: Gladys says it is needed, the action asks for one, then everything works', async (t) => {
  const { server, world, gladys } = await setup(t, { server: { tokenRequired: true } });
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.deepEqual(gladys.fake.connectionStatuses.at(-1), {
    connected: false,
    message: CONNECTION_TEXT.tokenNeeded,
  });

  const action = gladys.fake.action('request_token', {});
  await until(() => server.tokenRequests.length === 1, { message: 'the token request' });
  assert.equal(server.tokenRequests[0].comment, 'Gladys Assistant');
  assert.match(server.tokenRequests[0].id, /^[A-Za-z0-9]{5}$/);
  server.approveToken();
  const ack = await action;
  assert.equal(ack.data.message.en, `127.0.0.1:${server.port}: token received and saved.`);

  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.deepEqual(gladys.fake.connectionStatuses.at(-1), { connected: true });
  // The token is kept under /data, readable by the container user only.
  await world.hub.store.flush();
  const file = join(world.dataDir, 'hyperion-state.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.tokens[SERVER_ID], VALID_TOKEN);
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  // Nothing left to ask.
  const again = await gladys.fake.action('request_token', {});
  assert.equal(again.data.message.fr, 'Aucun serveur Hyperion ne demande de jeton : rien à faire.');
});

test('a denied token request is reported', async (t) => {
  const { server, gladys } = await setup(t, { server: { tokenRequired: true } });
  const action = gladys.fake.action('request_token', {});
  await until(() => server.tokenRequests.length === 1, { message: 'the token request' });
  server.denyToken();
  const ack = await action;
  assert.equal(
    ack.data.message.en,
    `127.0.0.1:${server.port}: request denied or not accepted in time.`,
  );
  assert.equal(gladys.fake.discoveredDevices.length, 0);
});

test('the token of the configuration opens a server that asks for one', async (t) => {
  const { gladys } = await setup(t, {
    server: { tokenRequired: true },
    config: { token: VALID_TOKEN },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.deepEqual(gladys.fake.connectionStatuses.at(-1), { connected: true });
});

test('a server that goes away is followed again when it comes back', async (t) => {
  const { server, world, gladys } = await setup(t);
  await createAll(world);
  await server.stop();
  await until(() => !world.hub.isConnected(world.hub.servers.get(SERVER_ID)), {
    message: 'the links to close',
  });
  await world.hub.refresh();
  assert.deepEqual(gladys.fake.connectionStatuses.at(-1), {
    connected: false,
    message: CONNECTION_TEXT.unreachable,
  });
  const setWhileDown = await setValue(world, server, 0, 'power', 0);
  assert.equal(setWhileDown.success, false);
  assert.match(setWhileDown.error, /TV ne répond pas/);

  server.mutate(0, (info) => {
    info.adjustment[0].brightness = 55;
  });
  await server.restart();
  await world.hub.refresh();
  assert.ok(world.hub.isConnected(world.hub.servers.get(SERVER_ID)));
  assert.deepEqual(gladys.fake.connectionStatuses.at(-1), { connected: true });
  assert.equal(state(world, server, 0, 'brightness'), 55, 'read again once back');
});

test('a server at a new address keeps its devices', async (t) => {
  const first = await createFakeHyperion();
  const world = await createWorld({ servers: [first] });
  const created = world.gladys.fake.discoveredDevices.map((device) => device.external_id);
  await world.app.stop();
  await first.stop();

  // Same server id, another port (a new address after a DHCP lease).
  const moved = await createFakeHyperion();
  t.after(() => moved.stop());
  const again = await createWorld({ servers: [moved], dataDir: world.dataDir });
  t.after(() => again.app.stop());
  const devices = again.gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.external_id),
    created,
  );
  assert.equal(
    devices[0].params.find((param) => param.name === 'HYPERION_PORT').value,
    String(moved.port),
  );
});

test('instances added, renamed, stopped and started follow in Gladys', async (t) => {
  const { server, world, gladys } = await setup(t);
  await createAll(world);

  server.setInstances([
    { instance: 1, name: 'Desk lamp', running: false },
    { instance: 2, name: 'Kitchen', running: true, info: instanceInfo() },
  ]);
  await until(() => gladys.fake.discoveredDevices.length === 3, { message: 'the new instance' });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['TV', 'Desk lamp', 'Kitchen'],
  );
  await until(() => state(world, server, 1, 'power') === 0, { message: 'the stopped instance' });
  assert.equal(state(world, server, 1, 'source'), 'Éteint');

  // Turning a stopped instance on starts it.
  assert.deepEqual(await setValue(world, server, 1, 'power', 1), { success: true });
  assert.deepEqual(
    requestsOf(server, 'instance')
      .filter((request) => request.subcommand === 'startInstance')
      .map((request) => request.instance),
    [1],
  );
  await until(() => state(world, server, 1, 'power') === 1, { message: 'the started instance' });
});

test('a device added in Gladys gets all its values at once', async (t) => {
  const { server, world, gladys } = await setup(t);
  await createAll(world);
  const before = gladys.fake.states.length;
  // Added again (deleted then re-created): the SDK forgot what it sent.
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await settle();
  const sent = gladys.fake.states.slice(before);
  assert.equal(sent.length, 10);
  assert.ok(
    sent.every((entry) =>
      entry.device_feature_external_id.startsWith(instanceId(gladys, server, 0)),
    ),
  );
});

test('the core poll is only a fallback', async (t) => {
  const { server, world, gladys } = await setup(t);
  await createAll(world);
  const reads = () => requestsOf(server, 'serverinfo').length;
  const before = reads();
  // Just read: the poll does not read again.
  assert.deepEqual(await gladys.fake.poll(gladys.fake.discoveredDevices[0]), { success: true });
  assert.equal(reads(), before);
});

test('a configuration change re-publishes the devices in the new language', async (t) => {
  const { server, world, gladys } = await setup(t);
  await createAll(world);
  await gladys.fake.configUpdated({ language: 'es' });
  assert.equal(gladys.fake.discoveredDevices[0].features[0].name, 'Luz');
  assert.equal(state(world, server, 0, 'source'), 'Ambilight (captura USB)');
});
