// -----------------------------------------------------------------------------
// The scene actions, as a scene reaches them (resolved fields, outputs).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHyperion } from './helpers/fakeHyperion.js';
import { createAll, createWorld, featureId, instanceId } from './helpers/world.js';

async function setup(t, config = {}) {
  const server = await createFakeHyperion();
  const world = await createWorld({ servers: [server], config });
  t.after(async () => {
    await world.app.stop();
    await server.stop();
  });
  await createAll(world);
  const device = instanceId(world.gladys, server, 0);
  const state = (key) => world.gladys.fake.lastState(featureId(world.gladys, server, 0, key));
  return { server, world, device, state, gladys: world.gladys };
}

test('start_effect: a listed effect, for a while', async (t) => {
  const { server, gladys, device, state } = await setup(t);
  const ack = await gladys.fake.sceneAction('start_effect', {
    device,
    effect: 'Warm mood blobs',
    duration: 30,
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { effect_name: 'Warm mood blobs' } } });
  const request = server.requests.findLast((entry) => entry.command === 'effect');
  assert.deepEqual(
    { name: request.effect.name, duration: request.duration, priority: request.priority },
    { name: 'Warm mood blobs', duration: 30 * 60_000, priority: 128 },
  );
  assert.equal(state('effect'), 'Warm mood blobs');
});

test('start_effect: an effect typed by name wins over the list, case ignored', async (t) => {
  const { server, gladys, device } = await setup(t);
  const ack = await gladys.fake.sceneAction('start_effect', {
    device,
    effect: 'Candle',
    custom_effect: '  knight RIDER ',
  });
  assert.equal(ack.data.outputs.effect_name, 'Knight rider');
  const request = server.requests.findLast((entry) => entry.command === 'effect');
  assert.equal(request.effect.name, 'Knight rider');
  assert.equal(request.duration, undefined, 'no duration: until replaced');
});

test('start_effect: an unknown or missing effect fails the action, in the language of the configuration', async (t) => {
  const { gladys, device } = await setup(t, { language: 'de' });
  const unknown = await gladys.fake.sceneAction('start_effect', { device, custom_effect: 'Disco' });
  assert.equal(unknown.success, false);
  assert.equal(unknown.error, 'Unbekannter Effekt „Disco“.');
  const missing = await gladys.fake.sceneAction('start_effect', { device });
  assert.equal(missing.error, 'Wähle einen Effekt oder gib den Namen eines Effekts ein.');
  const noDevice = await gladys.fake.sceneAction('start_effect', {
    device: 'ext:test-integration:instance:gone-0',
    effect: 'Candle',
  });
  assert.match(noDevice.error, /nicht mehr\) bekannt/);
});

test('show_color: a colour for a while, written in hexadecimal or in RGB', async (t) => {
  const { server, gladys, device, state } = await setup(t);
  const ack = await gladys.fake.sceneAction('show_color', {
    device,
    color: '255, 136, 0',
    duration: 1,
  });
  assert.deepEqual(ack.data.outputs, { color: '#FF8800' });
  const request = server.requests.findLast((entry) => entry.command === 'color');
  assert.deepEqual([request.color, request.duration], [[255, 136, 0], 60_000]);
  assert.equal(state('color'), 0xff8800);

  await gladys.fake.sceneAction('show_color', { device, color: '#0f0' });
  assert.equal(state('color'), 0x00ff00);

  const bad = await gladys.fake.sceneAction('show_color', { device, color: 'orange' });
  assert.equal(bad.success, false);
  assert.equal(bad.error, "« orange » n'est pas une couleur : écrivez-la comme #FF8800.");
});

test('restore_ambilight: back to the picture', async (t) => {
  const { gladys, device, state } = await setup(t);
  await gladys.fake.sceneAction('show_color', { device, color: '#FF0000' });
  assert.equal(state('ambilight'), 0);
  const ack = await gladys.fake.sceneAction('restore_ambilight', { device });
  assert.deepEqual(ack, { success: true });
  assert.equal(state('ambilight'), 1);
  assert.equal(state('source'), 'Ambilight (capture USB)');
});
