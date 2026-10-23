#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only check of a real Hyperion server with the integration's own client:
//
//   node scripts/probe.mjs <ip> [port]          (port 19444 by default)
//   HYPERION_TOKEN=... node scripts/probe.mjs <ip>   (if Hyperion asks for one)
//
// It reads `authorize tokenRequired`, `sysinfo` and the `serverinfo` of every
// running instance, then prints what the integration would publish (devices,
// features, values). It changes nothing on the server: no colour, no effect,
// no component, no token request. The token is never printed.
// -----------------------------------------------------------------------------

import { HyperionConnection } from '../src/hyperion/client.js';
import { featureSpecs, featureValues } from '../src/devices.js';
import {
  availableComponents,
  effectNames,
  parseInstances,
  serverIdentity,
  visiblePriority,
} from '../src/hyperion/model.js';

const [host, portArg] = process.argv.slice(2);
if (!host) {
  console.error('Usage: node scripts/probe.mjs <ip> [port]');
  process.exit(2);
}
const port = portArg ? Number(portArg) : 19444;
const token = process.env.HYPERION_TOKEN?.trim() || null;

const open = async () => {
  const connection = new HyperionConnection({ host, port, timeoutMs: 5000 });
  await connection.open();
  return connection;
};

async function authenticate(connection) {
  const required = await connection.tokenRequired().catch(() => false);
  if (required) {
    if (!token) {
      throw new Error('this server asks for a token: set HYPERION_TOKEN');
    }
    await connection.login(token);
  }
  return required;
}

let main;
try {
  main = await open();
  const required = await authenticate(main);
  console.log(
    `Connected to ${host}:${port} (token ${required ? 'required, accepted' : 'not required'})`,
  );

  const sysinfo = await main.sysinfo();
  const identity = serverIdentity(sysinfo);
  console.log(`${identity.product} ${identity.version ?? '?'}, id ${identity.id || '?'}`);
  console.log(
    `System: ${sysinfo.system?.prettyName ?? '?'} (${sysinfo.system?.architecture ?? '?'})`,
  );

  const first = await main.serverinfo();
  const instances = parseInstances(first);
  console.log(
    `Instances: ${instances.map((i) => `${i.instance} "${i.name}"${i.running ? '' : ' (stopped)'}`).join(', ')}`,
  );
  console.log(
    `Effects: ${effectNames(first).length} (${effectNames(first).slice(0, 8).join(', ')}...)`,
  );

  for (const instance of instances.filter((entry) => entry.running)) {
    const connection = instance.instance === 0 ? main : await open();
    try {
      if (connection !== main) {
        await authenticate(connection);
        await connection.switchTo(instance.instance);
      }
      const info = instance.instance === 0 ? first : await connection.serverinfo();
      console.log(`\n== Instance ${instance.instance} "${instance.name}"`);
      console.log(
        `Components: ${(info.components ?? []).map((c) => `${c.name}=${c.enabled}`).join(' ')}`,
      );
      console.log(`Switches offered: ${availableComponents(info).join(', ') || 'none'}`);
      console.log(
        `Brightness: ${JSON.stringify((info.adjustment ?? []).map((a) => ({ id: a.id, brightness: a.brightness })))}`,
      );
      for (const priority of info.priorities ?? []) {
        console.log(
          `Priority ${priority.priority}: ${priority.componentId} owner="${priority.owner}" origin="${priority.origin}"` +
            `${priority.visible ? ' VISIBLE' : ''}${priority.active === false ? ' inactive' : ''}`,
        );
      }
      console.log(`Visible: ${JSON.stringify(visiblePriority(info)?.componentId ?? null)}`);
      const values = featureValues(info, true, 'en');
      for (const spec of featureSpecs(info, 'en')) {
        const value = values[spec.key];
        console.log(
          `  ${spec.key.padEnd(22)} ${`${spec.category}/${spec.type}`.padEnd(16)} ` +
            `${value === undefined ? '(no value)' : JSON.stringify(value)}`,
        );
      }
    } finally {
      if (connection !== main) {
        connection.close();
      }
    }
  }
  process.exitCode = 0;
} catch (err) {
  console.error(`Probe failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  main?.close();
}
