// -----------------------------------------------------------------------------
// A fake Hyperion.ng server: a real TCP server on the loopback interface that
// speaks the JSON API (one JSON object per line), so the integration's own
// client is exercised end to end.
//
// It starts from the real `serverinfo` and `sysinfo` replies of
// test/fixtures/hyperion/ and implements what the integration uses:
// authorization (tokenRequired, login, requestToken), instances (switchTo,
// startInstance), serverinfo with subscriptions, color, effect, clear,
// componentstate, adjustment. Every change is pushed to the subscribed
// connections of the instance, like the server does (`*-update`).
//
// Test controls: `requests` (every request received), `mutate(instance, fn)`
// (change the state without pushing: a missed update), `pushes = false` (the
// server stops pushing), `approveToken()` / `denyToken()`, `stop()` and
// `restart()` (the server goes away and comes back on the same port).
//
// `product: 'HyperHDR'` plays a HyperHDR 22 instead, from the replies recorded
// on a real one: `hyperhdr` in sysinfo, its components and adjustment (no
// `brightness`, no `id`: other keys are refused, as its schema does), and its
// LED device that follows the sources (off when none is left, on with the next
// one). `staleSnapshots = true` makes the serverinfo that follows a switch of
// ALL describe the state before LEDDEVICE followed, as a real HyperHDR did.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import net from 'node:net';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/hyperion/${name}`, import.meta.url), 'utf8'));

export const SERVERINFO = fixture('serverinfo-2.0.0-alpha.8.json').info;
export const SYSINFO = fixture('sysinfo-2.0.0-alpha.8.json').info;
export const SERVER_ID = SYSINFO.hyperion.id;
export const SERVERINFO_2_2_1 = fixture('serverinfo-2.2.1.json').info;
export const HYPERHDR_SERVERINFO = fixture('serverinfo-hyperhdr-22.0.0.json').info;
export const HYPERHDR_SYSINFO = fixture('sysinfo-hyperhdr-22.0.0.json').info;
export const HYPERHDR_ID = HYPERHDR_SYSINFO.hyperhdr.id;
const HYPERHDR_ADJUSTMENT_KEYS = new Set(Object.keys(HYPERHDR_SERVERINFO.adjustment[0]));
export const VALID_TOKEN = 'a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d';

const clone = (value) => structuredClone(value);

/** The state of one instance, from the fixture. */
export function instanceInfo(overrides = {}, product = 'Hyperion') {
  const info = clone(product === 'HyperHDR' ? HYPERHDR_SERVERINFO : SERVERINFO);
  delete info.instance; // the server-wide list is added on each reply
  return { ...info, ...overrides };
}

/**
 * @param {object} [options]
 * @param {string} [options.id] server id (sysinfo)
 * @param {string} [options.version]
 * @param {Array<{ instance: number, name: string, running?: boolean, info?: object }>} [options.instances]
 * @param {boolean} [options.tokenRequired]
 * @param {string[]} [options.tokens] the tokens login accepts
 */
export async function createFakeHyperion({
  product = 'Hyperion',
  id = product === 'HyperHDR' ? HYPERHDR_ID : SERVER_ID,
  version = product === 'HyperHDR' ? HYPERHDR_SYSINFO.hyperhdr.version : SYSINFO.hyperion.version,
  instances = [
    { instance: 0, name: 'TV', running: true },
    { instance: 1, name: 'Desk', running: true },
  ],
  tokenRequired = false,
  tokens = [VALID_TOKEN],
} = {}) {
  const fake = {
    host: '127.0.0.1',
    port: 0,
    id,
    version,
    tokenRequired,
    tokens: [...tokens],
    instances: instances.map((entry) => ({
      instance: entry.instance,
      name: entry.name,
      running: entry.running !== false,
      info: entry.info ? clone(entry.info) : instanceInfo({}, product),
    })),
    product,
    staleSnapshots: false,
    coalesce: false,
    requests: [],
    sessions: new Set(),
    tokenRequests: [],
    pushes: true,
    server: null,
  };

  const instanceList = () =>
    fake.instances.map(({ instance, name, running }) => ({
      friendly_name: name,
      instance,
      running,
    }));
  const findInstance = (number) => fake.instances.find((entry) => entry.instance === number);

  // `coalesce = true`: a reply and the pushes it causes leave in one TCP
  // write, so the client emits the pushes before the reply resolves.
  const send = (session, message) => {
    if (session.socket.destroyed) {
      return;
    }
    if (!fake.coalesce) {
      session.socket.write(`${JSON.stringify(message)}\n`);
      return;
    }
    if (!session.out) {
      session.out = '';
      setImmediate(() => {
        const out = session.out;
        session.out = null;
        if (!session.socket.destroyed) {
          session.socket.write(out);
        }
      });
    }
    session.out += `${JSON.stringify(message)}\n`;
  };

  /** Push an update to every subscribed session of an instance (or all). */
  const push = (number, command, data) => {
    if (!fake.pushes) {
      return;
    }
    for (const session of fake.sessions) {
      if (session.subscribed && (number === null || session.instance === number)) {
        send(session, { command, data, success: true, tan: 0 });
      }
    }
  };

  const recomputeVisible = (info) => {
    const active = info.priorities.filter((entry) => entry.active !== false);
    const lowest = active.reduce(
      (best, entry) => (best === null || entry.priority < best.priority ? entry : best),
      null,
    );
    for (const entry of info.priorities) {
      entry.visible = entry === lowest;
    }
    info.priorities.sort((a, b) => a.priority - b.priority);
  };

  /** HyperHDR: the LED device follows the sources (pushed after the change). */
  const followSources = (number, info) => {
    const led = info.components.find((entry) => entry.name === 'LEDDEVICE');
    const all = info.components.find((entry) => entry.name === 'ALL');
    const wanted = all?.enabled === true && info.priorities.some((entry) => entry.active);
    if (fake.product === 'HyperHDR' && led && led.enabled !== wanted) {
      led.enabled = wanted;
      push(number, 'components-update', { name: 'LEDDEVICE', enabled: wanted });
    }
  };

  const pushPriorities = (number, info) =>
    push(number, 'priorities-update', {
      priorities: info.priorities,
      priorities_autoselect: info.priorities_autoselect,
    });

  const reply = (session, request, extra = {}) =>
    send(session, {
      command: request.subcommand ? `${request.command}-${request.subcommand}` : request.command,
      success: true,
      tan: request.tan ?? 0,
      ...extra,
    });

  const error = (session, request, message) =>
    send(session, {
      command: request.subcommand ? `${request.command}-${request.subcommand}` : request.command,
      success: false,
      error: message,
      tan: request.tan ?? 0,
    });

  function handle(session, request) {
    fake.requests.push({ instance: session.instance, ...request });
    const { command, subcommand } = request;

    if (command === 'authorize') {
      if (subcommand === 'tokenRequired') {
        return reply(session, request, { info: { required: fake.tokenRequired } });
      }
      if (subcommand === 'login') {
        if (fake.tokens.includes(request.token)) {
          session.authorized = true;
          return reply(session, request);
        }
        return error(session, request, 'No Authorization');
      }
      if (subcommand === 'requestToken') {
        if (request.accept === false) {
          fake.tokenRequests = fake.tokenRequests.filter((entry) => entry.id !== request.id);
          return undefined;
        }
        fake.tokenRequests.push({ id: request.id, comment: request.comment, session, request });
        return undefined; // answered once the user decides
      }
      return error(session, request, 'unknown subcommand');
    }

    if (fake.tokenRequired && !session.authorized) {
      return error(session, request, 'No Authorization');
    }

    const current = findInstance(session.instance);
    switch (command) {
      case 'sysinfo':
        if (fake.product === 'HyperHDR') {
          return reply(session, request, {
            info: {
              ...clone(HYPERHDR_SYSINFO),
              hyperhdr: { ...HYPERHDR_SYSINFO.hyperhdr, id: fake.id, version },
            },
          });
        }
        return reply(session, request, {
          info: { ...clone(SYSINFO), hyperion: { ...SYSINFO.hyperion, id: fake.id, version } },
        });
      case 'instance': {
        const target = findInstance(request.instance);
        if (subcommand === 'switchTo') {
          if (!target?.running) {
            return error(session, request, 'Instance not running');
          }
          session.instance = request.instance;
          return reply(session, request, { info: { instance: request.instance } });
        }
        if (subcommand === 'startInstance') {
          if (!target) {
            return error(session, request, 'Unknown instance');
          }
          target.running = true;
          reply(session, request);
          return push(null, 'instance-update', instanceList());
        }
        return error(session, request, 'unknown subcommand');
      }
      case 'serverinfo': {
        if (!current?.running) {
          return error(session, request, 'Instance not running');
        }
        if (Array.isArray(request.subscribe)) {
          session.subscribed = true;
        }
        const snapshot = session.stale ?? current.info;
        session.stale = null;
        return reply(session, request, {
          info: { ...clone(snapshot), instance: instanceList() },
        });
      }
      case 'color': {
        const info = current.info;
        info.priorities = info.priorities.filter((entry) => entry.priority !== request.priority);
        info.priorities.push({
          active: true,
          componentId: 'COLOR',
          origin: request.origin ?? 'System',
          owner: 'System',
          priority: request.priority,
          value: { RGB: request.color.slice(0, 3), HSL: [0, 0, 0] },
          ...(request.duration ? { duration_ms: request.duration } : {}),
        });
        recomputeVisible(info);
        reply(session, request);
        pushPriorities(session.instance, info);
        return followSources(session.instance, info);
      }
      case 'effect': {
        const info = current.info;
        if (!info.effects.some((effect) => effect.name === request.effect?.name)) {
          return error(session, request, 'Effect not found');
        }
        info.priorities = info.priorities.filter((entry) => entry.priority !== request.priority);
        info.priorities.push({
          active: true,
          componentId: 'EFFECT',
          origin: request.origin ?? 'System',
          owner: request.effect.name,
          priority: request.priority,
          ...(request.duration ? { duration_ms: request.duration } : {}),
        });
        recomputeVisible(info);
        reply(session, request);
        pushPriorities(session.instance, info);
        return followSources(session.instance, info);
      }
      case 'clear': {
        const info = current.info;
        info.priorities = info.priorities.filter((entry) => entry.priority !== request.priority);
        recomputeVisible(info);
        reply(session, request);
        pushPriorities(session.instance, info);
        return followSources(session.instance, info);
      }
      case 'componentstate': {
        const { component, state } = request.componentstate ?? {};
        const entry = current.info.components.find((item) => item.name === component);
        if (!entry) {
          return error(session, request, 'Unknown component');
        }
        entry.enabled = state;
        // A capture turned off leaves the priority list, as on the server.
        for (const priority of current.info.priorities) {
          if (priority.componentId === component) {
            priority.active = state;
          }
        }
        recomputeVisible(current.info);
        reply(session, request);
        pushPriorities(session.instance, current.info);
        push(session.instance, 'components-update', { name: component, enabled: state });
        if (component === 'ALL' && fake.product === 'HyperHDR') {
          if (fake.staleSnapshots) {
            session.stale = clone(current.info);
          }
          followSources(session.instance, current.info);
        }
        return undefined;
      }
      case 'adjustment': {
        if (
          fake.product === 'HyperHDR' &&
          Object.keys(request.adjustment ?? {}).some((key) => !HYPERHDR_ADJUSTMENT_KEYS.has(key))
        ) {
          return error(session, request, 'Invalid params');
        }
        const { id: adjustmentId, ...changes } = request.adjustment ?? {};
        for (const adjustment of current.info.adjustment) {
          if (!adjustmentId || adjustment.id === adjustmentId) {
            Object.assign(adjustment, changes);
          }
        }
        reply(session, request);
        return push(session.instance, 'adjustment-update', current.info.adjustment);
      }
      default:
        return error(session, request, 'Unknown command');
    }
  }

  const onConnection = (socket) => {
    const session = { socket, instance: 0, subscribed: false, authorized: false, buffer: '' };
    fake.sessions.add(session);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      session.buffer += chunk;
      let newline = session.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = session.buffer.slice(0, newline);
        session.buffer = session.buffer.slice(newline + 1);
        if (line.trim()) {
          handle(session, JSON.parse(line));
        }
        newline = session.buffer.indexOf('\n');
      }
    });
    socket.on('close', () => fake.sessions.delete(session));
    socket.on('error', () => {});
  };

  const listen = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer(onConnection);
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        fake.server = server;
        fake.port = server.address().port;
        resolve();
      });
    });

  Object.assign(fake, {
    /** Change the state of an instance without telling anyone (a missed push). */
    mutate(number, fn) {
      fn(findInstance(number).info);
      recomputeVisible(findInstance(number).info);
    },
    /** Push a raw message to the subscribed sessions of an instance. */
    push(number, command, data) {
      push(number, command, data);
    },
    /** Rename, add, start or stop instances, as the user would in Hyperion. */
    setInstances(list) {
      for (const entry of list) {
        const known = findInstance(entry.instance);
        if (known) {
          Object.assign(known, entry);
        } else {
          fake.instances.push({ running: true, info: instanceInfo(), ...entry });
        }
      }
      push(null, 'instance-update', instanceList());
    },
    approveToken(token = VALID_TOKEN) {
      const pending = fake.tokenRequests.shift();
      if (!pending) {
        throw new Error('no token request');
      }
      if (!fake.tokens.includes(token)) {
        fake.tokens.push(token);
      }
      send(pending.session, {
        command: 'authorize-requestToken',
        success: true,
        info: { token, comment: pending.comment, id: pending.id },
        tan: pending.request.tan,
      });
    },
    denyToken() {
      const pending = fake.tokenRequests.shift();
      send(pending.session, {
        command: 'authorize-requestToken',
        success: false,
        error: 'Token request timeout or denied',
        tan: pending.request.tan,
      });
    },
    /** The server goes away (connections dropped, port closed). */
    async stop() {
      for (const session of fake.sessions) {
        session.socket.destroy();
      }
      fake.sessions.clear();
      await new Promise((resolve) => fake.server.close(() => resolve()));
    },
    /** The server is back, on the same port. */
    async restart() {
      await listen(fake.port);
    },
    /** The raw SSDP answer Hyperion.ng sends to an M-SEARCH. */
    ssdpAnswer() {
      return {
        source_ip: fake.host,
        source_port: 1900,
        headers: [
          'HTTP/1.1 200 OK',
          'CACHE-CONTROL: max-age = 1800',
          'DATE: Thu, 15 Oct 2026 10:00:00 GMT',
          'EXT: ',
          `LOCATION: http://${fake.host}:8090/description.xml`,
          `SERVER: Raspbian GNU/Linux 10 (buster)/10 UPnP/1.0 Hyperion/${version}`,
          'ST: urn:hyperion-project.org:device:basic:1',
          `USN: uuid:${fake.id}`,
          'HYPERION-NAME: My Hyperion Config',
          `HYPERION-JSS-PORT: ${fake.port}`,
          'HYPERION-FBS-PORT: 19400',
          '',
          '',
        ].join('\r\n'),
      };
    },
    /** The mDNS record of `_hyperiond-json._tcp`. */
    mdnsAnswer() {
      return {
        name: `hyperion-tv._hyperiond-json._tcp.local`,
        host: 'hyperion-tv.local',
        addresses: [fake.host],
        port: fake.port,
        txt: [`id=${fake.id}`, `version=${version}`],
      };
    },
  });

  await listen(0);
  return fake;
}
