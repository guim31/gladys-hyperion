// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory Gladys, which checks the payloads like the host API), fake
// Hyperion servers on the loopback interface, a temporary /data, and the
// integration wired on top through registerHandlers.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

// The integration logs every discovery; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

/** Let the pushes and the publications in flight land. */
export async function settle(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until `condition()` is true (pushes travel over real sockets). */
export async function until(condition, { timeoutMs = 2000, message = 'condition' } = {}) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * @param {object} [options]
 * @param {Array} [options.servers] fake Hyperion servers (createFakeHyperion)
 * @param {object} [options.config] raw integration config
 * @param {'ssdp'|'mdns'|'both'|'none'} [options.scan] what the core's scans find
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.timers] run the hub's refresh timer
 * @param {object} [options.timings]
 * @param {string} [options.dataDir]
 */
export async function createWorld({
  servers = [],
  config = {},
  scan = 'ssdp',
  devices = [],
  timers = false,
  timings = {},
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-hyperion-')),
  connect = true,
} = {}) {
  const scanResults = {
    ssdp: ['ssdp', 'both'].includes(scan) ? servers.map((server) => server.ssdpAnswer()) : [],
    mdns: ['mdns', 'both'].includes(scan) ? servers.map((server) => server.mdnsAnswer()) : [],
  };
  const gladys = createFakeGladys({ config, devices, scanResults });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    timers,
    timings: { connectTimeoutMs: 1000, scanSeconds: 1, ...timings },
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, app, hub: app.hub, dataDir };
}

/** External id of the device of an instance. */
export const instanceId = (gladys, server, instance) =>
  gladys.externalIds('instance', `${server.id}-${instance}`).device;

/** A feature external id of an instance device. */
export const featureId = (gladys, server, instance, key) =>
  gladys.externalIds('instance', `${server.id}-${instance}`).feature(key);

/** Add every discovered device to Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.gladys.fake.discoveredDevices) {
    await world.gladys.fake.deviceCreated(device);
  }
  await settle();
}

/** The device and feature objects Gladys passes to onSetValue. */
export function target(world, server, instance, key) {
  const device = world.gladys.fake.discoveredDevices.find(
    (entry) => entry.external_id === instanceId(world.gladys, server, instance),
  );
  const feature = device.features.find(
    (entry) => entry.external_id === featureId(world.gladys, server, instance, key),
  );
  return { device, feature };
}
