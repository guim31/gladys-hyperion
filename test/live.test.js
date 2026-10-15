// -----------------------------------------------------------------------------
// The integration keeps its devices up to date by itself (Gladys 5.2 does not
// poll reliably an external device, GladysAssistant/Gladys#3198), resends the
// unchanged values every 12 hours, and its normal cycle writes nothing at the
// info level — and never a token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE_HEARTBEAT_MS } from '../src/hub.js';
import { VALID_TOKEN, createFakeHyperion } from './helpers/fakeHyperion.js';
import { createAll, createWorld, featureId, settle, until } from './helpers/world.js';

/**
 * Capture every log line written while `fn` runs, at the given level (the
 * SDK logger writes through console.log and console.error).
 */
async function captureLogs(t, level, fn) {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  for (const stream of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, stream, (...args) => lines.push(args.map(String).join(' ')));
  }
  try {
    await fn();
  } finally {
    process.env.LOG_LEVEL = previous;
    t.mock.restoreAll();
  }
  return lines;
}

test('the states follow the server without any poll from Gladys', async (t) => {
  const server = await createFakeHyperion();
  const world = await createWorld({ servers: [server], timers: true, timings: { refreshMs: 40 } });
  t.after(async () => {
    await world.app.stop();
    await server.stop();
  });
  const { gladys } = world;
  await createAll(world);
  const polls = () => gladys.fake.wsMessages.filter((message) => message.type === 'poll').length;
  const brightness = featureId(gladys, server, 0, 'brightness');
  assert.equal(gladys.fake.lastState(brightness), 83);

  // Pushed by the server: immediate.
  server.mutate(0, (info) => {
    info.adjustment[0].brightness = 30;
  });
  server.push(0, 'adjustment-update', [{ id: 'default', brightness: 30 }]);
  await until(() => gladys.fake.lastState(brightness) === 30, { message: 'the pushed value' });

  // A change the server never pushed (a lost update): the hub's own timer
  // reads it, no onPoll involved.
  server.pushes = false;
  server.mutate(0, (info) => {
    info.adjustment[0].brightness = 64;
  });
  await until(() => gladys.fake.lastState(brightness) === 64, { message: 'the refreshed value' });
  assert.equal(polls(), 0, 'Gladys never polled');
});

test('only the changes are sent, and every value again after 12 hours', async (t) => {
  const server = await createFakeHyperion();
  let now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now });
  const world = await createWorld({ servers: [server], timings: { refreshMs: 60_000 } });
  t.after(async () => {
    await world.app.stop();
    await server.stop();
  });
  await createAll(world);
  const sent = world.gladys.fake.states.length;
  assert.equal(sent, 20, 'two devices, ten values each');

  now += 60_000;
  t.mock.timers.setTime(now);
  await world.hub.refresh();
  assert.equal(world.gladys.fake.states.length, sent, 'nothing changed, nothing sent');

  now += STATE_HEARTBEAT_MS;
  t.mock.timers.setTime(now);
  await world.hub.refresh();
  assert.equal(world.gladys.fake.states.length, sent * 2, 'everything again after 12 h');
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const server = await createFakeHyperion();
  const world = await createWorld({ servers: [server] });
  await createAll(world);
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.refresh();
    server.push(0, 'adjustment-update', [{ id: 'default', brightness: 20 }]);
    server.push(1, 'components-update', { name: 'SMOOTHING', enabled: false });
    await settle(50);
    await world.hub.refresh();
    await world.gladys.fake.poll(world.gladys.fake.discoveredDevices[0]);
  });
  await world.app.stop();
  await server.stop();
  assert.deepEqual(lines, []);
});

test('a lost server is one line when it goes, one when it is back', async (t) => {
  const server = await createFakeHyperion();
  const world = await createWorld({ servers: [server] });
  const lines = await captureLogs(t, 'info', async () => {
    await server.stop();
    await settle(50);
    for (let i = 0; i < 3; i += 1) {
      await world.hub.refresh();
    }
    await server.restart();
    await world.hub.refresh();
    await world.hub.refresh();
  });
  await world.app.stop();
  await server.stop();
  const lost = lines.filter((line) => /lost/.test(line));
  const back = lines.filter((line) => /answers again/.test(line));
  assert.equal(lost.length, 1, lines.join('\n'));
  assert.equal(back.length, 1, lines.join('\n'));
  assert.ok(lines.length <= 4, `too many lines:\n${lines.join('\n')}`);
});

test('no token ever reaches the logs, even in debug', async (t) => {
  const configToken = 'c0nf1g-t0k3n-0000-0000-000000000000';
  const server = await createFakeHyperion({ tokenRequired: true, tokens: [configToken] });
  let world;
  const lines = await captureLogs(t, 'debug', async () => {
    world = await createWorld({ servers: [server], config: { token: 'wrong-token' } });
    // The configuration token is refused, then a token is requested...
    const action = world.gladys.fake.action('request_token', {});
    await until(() => server.tokenRequests.length === 1, { message: 'the token request' });
    server.approveToken(VALID_TOKEN);
    await action;
    // ... and a new configuration token arrives.
    await world.gladys.fake.configUpdated({ token: configToken });
    await createAll(world);
    await world.hub.refresh();
  });
  await world.app.stop();
  await server.stop();
  assert.ok(lines.length > 5, 'the debug logs were captured');
  for (const secret of [VALID_TOKEN, configToken, 'wrong-token']) {
    assert.ok(!lines.some((line) => line.includes(secret)), `${secret} was logged`);
  }
});
