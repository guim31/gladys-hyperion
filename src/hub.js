// -----------------------------------------------------------------------------
// The Hyperion hub: finds the servers, keeps one live connection per running
// instance, publishes one device per instance and its states, and runs the
// commands.
//
// Real time: each connection subscribes to the changes of its instance
// (`serverinfo` + `subscribe`), which the server pushes as they happen. On top
// of that, the hub's own timer (every minute) reads every instance again,
// reconnects what dropped, and re-sends unchanged values every 12 hours (the
// heartbeat that keeps "no recent value" away). Gladys never polls these
// devices (should_poll: false); `onPoll` stays as a fallback only.
//
// Logs: the info level only tells what changes (a server found, lost or back,
// a command of the user). Pushes, refreshes and retries are debug lines; a
// failure that repeats is logged once when it starts and once when it ends
// (src/issues.js). Tokens never reach a log line.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  NO_EFFECT,
  buildDevice,
  componentOfKey,
  deviceIds,
  featureValues,
  sourceText,
  toStates,
} from './devices.js';
import { CONNECTION_TEXT, userError } from './i18n.js';
import { createIssueLog } from './issues.js';
import { HyperionConnection, HyperionError } from './hyperion/client.js';
import {
  MDNS_SERVICE,
  SSDP_ST,
  mdnsCandidates,
  mergeCandidates,
  ssdpCandidates,
} from './hyperion/discovery.js';
import {
  SUBSCRIPTIONS,
  adjustmentIds,
  apiPriorities,
  applyUpdate,
  captureComponents,
  componentEnabled,
  findEffect,
  intToRgb,
  isOn,
  parseInstances,
  rgbToHex,
} from './hyperion/model.js';

const logger = createLogger({ name: 'hyperion' });

export const WIDGET_KEY = 'hyperion';

// Unchanged values are sent again this often: Gladys shows "no recent value"
// after 48 hours without one.
export const STATE_HEARTBEAT_MS = 12 * 60 * 60 * 1000;

export const DEFAULT_TIMINGS = {
  // The hub's own refresh: reconnects, reads every instance, heartbeat.
  refreshMs: 60_000,
  // While a known server does not answer, search the network again this often
  // (it may have a new address).
  rescanMs: 30 * 60_000,
  connectTimeoutMs: 5_000,
  scanSeconds: 5,
  // How long "Request a token" waits for the user to accept it in Hyperion
  // (the manifest action allows 120 s).
  tokenRequestMs: 100_000,
  // Gladys accepts one widget refresh every 10 s.
  widgetRefreshMs: 10_000,
};

// Shown in the Hyperion interface next to the token request.
export const TOKEN_COMMENT = 'Gladys Assistant';

const address = ({ host, port }) => `${host}:${port}`;

/** A 5-character id for a token request, as the API asks. */
const requestId = () =>
  [...randomBytes(5)]
    .map((byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[byte % 57])
    .join('');

// The part of an instance state worth keeping across restarts: enough to
// publish the same features while the server is off.
const persistedInfo = (info) => ({
  components: (info.components ?? []).map(({ name, enabled }) => ({ name, enabled })),
  effects: (info.effects ?? []).map(({ name }) => ({ name })),
});

export class HyperionHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store src/store.js
   * @param {Function} [options.connect] net.connect (test seam)
   * @param {boolean} [options.timers] run the refresh timer
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, connect, timers = true, timings = {}, now = () => Date.now() }) {
    this.gladys = gladys;
    this.store = store;
    this.connectFn = connect;
    this.timers = timers;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.issues = createIssueLog(logger);
    this.config = null;
    /** server id -> server record */
    this.servers = new Map();
    /** 'host:port' -> { host, port, id, status: 'token' | 'unreachable' } */
    this.pendingHosts = new Map();
    /** 'host:port' -> Promise of the connection attempt in progress */
    this.probing = new Map();
    this.saved = { servers: {}, tokens: {}, captureOff: {} };
    this.discovery = { ssdp: 'unknown', mdns: 'unknown' };
    this.lastScanAt = -Infinity;
    this.lastDevices = null;
    this.lastStatus = null;
    this.lastSources = new Map();
    this.lastWidgetRefreshAt = -Infinity;
    this.widgetTimer = null;
    this.refreshTimer = null;
    this.refreshing = null;
    this.stopped = false;
  }

  // --- Lifecycle ------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    this.saved = {
      servers: saved.servers && typeof saved.servers === 'object' ? saved.servers : {},
      tokens: saved.tokens && typeof saved.tokens === 'object' ? saved.tokens : {},
      captureOff: saved.captureOff && typeof saved.captureOff === 'object' ? saved.captureOff : {},
    };
    for (const [id, entry] of Object.entries(this.saved.servers)) {
      if (typeof entry?.host === 'string' && Number.isInteger(entry.port)) {
        const server = this.serverRecord({ id, ...entry, instances: entry.instances ?? [] });
        for (const [instance, info] of Object.entries(entry.infos ?? {})) {
          server.infos.set(Number(instance), info);
        }
      }
    }
    await this.discover({ scan: true });
    this.schedule();
  }

  /** Gladys came back after a disconnection: publish everything again. */
  async resync(config) {
    this.config = config;
    this.lastDevices = null;
    this.lastStatus = null;
    await this.discover({ scan: false });
    await this.publishAllStates();
  }

  async reconfigure(config) {
    const tokenChanged = this.config?.token !== config.token;
    this.config = config;
    if (tokenChanged) {
      // A new token may open the servers that refused us.
      for (const server of this.servers.values()) {
        if (server.tokenNeeded) {
          this.closeLinks(server);
        }
      }
    }
    await this.discover({ scan: false });
    await this.publishAllStates();
    this.refreshWidget();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.widgetTimer);
    for (const server of this.servers.values()) {
      this.closeLinks(server);
    }
    await this.store.flush();
  }

  schedule() {
    clearTimeout(this.refreshTimer);
    if (!this.timers || this.stopped) {
      return;
    }
    this.refreshTimer = setTimeout(async () => {
      try {
        await this.refresh();
      } catch (err) {
        logger.error(`Refresh failed (${err.message})`);
      } finally {
        this.schedule();
      }
    }, this.timings.refreshMs);
  }

  // --- Discovery ------------------------------------------------------------

  /** The "Search" button and the Discovery tab: scan, then publish. */
  async rediscover() {
    await this.discover({ scan: true });
  }

  async discover({ scan }) {
    const found = scan ? await this.scan() : [];
    const manual = this.config.servers.map(({ host, port }) => ({
      id: null,
      host,
      port,
      via: 'manual',
    }));
    const known = [...this.servers.values()].map(({ id, host, port }) => ({ id, host, port }));
    const pending = [...this.pendingHosts.values()].map(({ id, host, port }) => ({
      id,
      host,
      port,
    }));
    // A manual address that no longer is in the configuration is forgotten.
    for (const [key, entry] of this.pendingHosts) {
      if (entry.via === 'manual' && !manual.some((candidate) => address(candidate) === key)) {
        this.pendingHosts.delete(key);
      }
    }
    const candidates = mergeCandidates(found, manual, known, pending);
    await Promise.all(candidates.map((candidate) => this.connectCandidate(candidate)));
    await this.publishDevices();
    await this.updateConnectionStatus();
  }

  /** SSDP then mDNS through the core (one scan at a time per integration). */
  async scan() {
    this.lastScanAt = this.now();
    const results = [];
    for (const [type, parse] of [
      ['ssdp', ssdpCandidates],
      ['mdns', mdnsCandidates],
    ]) {
      try {
        const raw = await this.gladys.scanNetwork(type, {
          timeoutSeconds: this.timings.scanSeconds,
        });
        results.push(...parse(raw));
        this.discovery[type] = 'ok';
        this.issues.ok(`scan:${type}`, `${type.toUpperCase()} discovery works again`);
      } catch (err) {
        this.discovery[type] = 'unavailable';
        this.issues.fail(
          `scan:${type}`,
          `${type.toUpperCase()} discovery through Gladys failed (${err.message}): ` +
            'enter the address of the server in the configuration',
        );
      }
    }
    logger.debug(`Scan: ${results.length} answer(s) (${SSDP_ST}, ${MDNS_SERVICE})`);
    return results;
  }

  /**
   * Connect to a candidate address: identify the server (sysinfo), read its
   * instances, then open one link per running instance.
   */
  async connectCandidate(candidate) {
    const key = address(candidate);
    if (this.probing.has(key)) {
      return this.probing.get(key);
    }
    const known = candidate.id ? this.servers.get(candidate.id) : null;
    if (known && this.isConnected(known) && address(known) === key) {
      await this.ensureLinks(known);
      return undefined;
    }
    const attempt = this.probe(candidate).finally(() => this.probing.delete(key));
    this.probing.set(key, attempt);
    return attempt;
  }

  async probe(candidate) {
    const key = address(candidate);
    const known =
      (candidate.id && this.servers.get(candidate.id)) ||
      [...this.servers.values()].find((server) => address(server) === key) ||
      null;
    let connection;
    try {
      connection = await this.open(candidate);
      await this.authenticate(connection, { id: candidate.id ?? known?.id, address: key });
      const sysinfo = await connection.sysinfo();
      const id = String(sysinfo.hyperion?.id ?? candidate.id ?? '').toLowerCase();
      if (!id) {
        throw new HyperionError('the server has no id', { code: 'refused' });
      }
      const existing = this.servers.get(id);
      if (existing && this.isConnected(existing) && address(existing) !== key) {
        // The same server under another address (a name and its IP): keep
        // the link that works.
        this.pendingHosts.delete(key);
        return;
      }
      const info = await connection.serverinfo();
      const server = this.serverRecord({
        id,
        host: candidate.host,
        port: candidate.port,
        name: candidate.name ?? known?.name ?? sysinfo.system?.hostName ?? null,
        version: sysinfo.hyperion?.version ?? candidate.version ?? null,
        instances: parseInstances(info),
      });
      this.pendingHosts.delete(key);
      this.issues.ok(`host:${key}`, `Hyperion answers at ${key}`);
      server.tokenNeeded = false;
      await this.ensureLinks(server);
      this.save();
    } catch (err) {
      this.onProbeFailure(candidate, known, err);
    } finally {
      connection?.close();
    }
  }

  onProbeFailure(candidate, known, err) {
    const key = address(candidate);
    const needsToken = err.code === 'token' || err.code === 'auth';
    if (known && address(known) === key) {
      known.tokenNeeded = needsToken;
      if (!needsToken) {
        this.markUnreachable(known, err);
      }
    }
    if (needsToken) {
      this.pendingHosts.set(key, { ...this.pendingHosts.get(key), ...candidate, status: 'token' });
      this.issues.fail(
        `token:${key}`,
        `Hyperion at ${key} asks for a token: use "Request a token" or paste one in the configuration`,
      );
    } else if (!known && candidate.via === 'manual') {
      this.pendingHosts.set(key, { ...candidate, status: 'unreachable' });
      this.issues.fail(`host:${key}`, `No Hyperion server answers at ${key} (${err.message})`);
    } else if (!known) {
      logger.debug(`Discovered ${key} does not answer (${err.message})`);
    }
  }

  /** Create or update the record of a server identified by its id. */
  serverRecord({ id, host, port, name, version, instances }) {
    let server = this.servers.get(id);
    if (!server) {
      server = {
        id,
        host,
        port,
        name: name ?? host,
        version: version ?? null,
        instances: [],
        infos: new Map(),
        links: new Map(),
        opening: new Map(),
        reachable: false,
        tokenNeeded: false,
        announced: false,
      };
      this.servers.set(id, server);
    }
    if (server.host !== host || server.port !== port) {
      if (server.announced) {
        logger.info(`Hyperion ${server.name} moved to ${host}:${port}`);
      }
      this.closeLinks(server);
      server.host = host;
      server.port = port;
    }
    server.name = name ?? server.name;
    server.version = version ?? server.version;
    if (instances.length > 0) {
      server.instances = instances;
    }
    return server;
  }

  isConnected(server) {
    return [...server.links.values()].some((link) => link.connection.connected);
  }

  async open({ host, port }) {
    const connection = new HyperionConnection({
      host,
      port,
      timeoutMs: this.timings.connectTimeoutMs,
      ...(this.connectFn ? { connect: this.connectFn } : {}),
    });
    await connection.open();
    return connection;
  }

  /**
   * Log in when the server asks for it: the token obtained for this server,
   * for this address, then the one of the configuration.
   */
  async authenticate(connection, { id, address: key }) {
    let required;
    try {
      required = await connection.tokenRequired();
    } catch (err) {
      if (err.code === 'closed' || err.code === 'timeout') {
        throw err;
      }
      required = false; // a server without authorization at all
    }
    if (!required) {
      return;
    }
    const tokens = [
      ...new Set([this.saved.tokens[id], this.saved.tokens[key], this.config.token]),
    ].filter((token) => typeof token === 'string' && token !== '');
    for (const token of tokens) {
      try {
        await connection.login(token);
        this.issues.ok(`token:${key}`, `Hyperion at ${key} accepts the token`);
        return;
      } catch (err) {
        if (err.code !== 'auth' && err.code !== 'refused') {
          throw err;
        }
      }
    }
    throw new HyperionError(tokens.length ? 'token refused' : 'token required', { code: 'token' });
  }

  // --- Instance links -------------------------------------------------------

  /** One link per running instance; close those of stopped instances. */
  async ensureLinks(server) {
    const running = server.instances.filter((instance) => instance.running);
    for (const [number, link] of server.links) {
      if (!running.some((instance) => instance.instance === number)) {
        server.links.delete(number);
        link.connection.close();
      }
    }
    await Promise.all(running.map((instance) => this.openLink(server, instance.instance)));
    this.updateReachability(server);
  }

  async openLink(server, number) {
    const current = server.links.get(number);
    if (current?.connection.connected) {
      return current;
    }
    if (server.opening.has(number)) {
      return server.opening.get(number);
    }
    const opening = (async () => {
      let connection;
      try {
        connection = await this.open(server);
        await this.authenticate(connection, { id: server.id, address: address(server) });
        if (number !== 0) {
          await connection.switchTo(number);
        }
        const info = await connection.serverinfo(SUBSCRIPTIONS);
        const link = { instance: number, connection, refreshedAt: this.now() };
        server.links.set(number, link);
        server.infos.set(number, info);
        connection.on('update', (message) => this.onUpdate(server, link, message));
        connection.on('close', () => this.onLinkClosed(server, link));
        logger.debug(`${server.name}: instance ${number} linked`);
        this.updateInstances(server, parseInstances(info));
        // An instance seen running for the first time brings its effects
        // and components (published only when the list changed).
        await this.publishDevices();
        await this.publishInstanceStates(server, number);
        return link;
      } catch (err) {
        connection?.close();
        if (err.code === 'token' || err.code === 'auth') {
          server.tokenNeeded = true;
        }
        this.issues.fail(
          `link:${server.id}:${number}`,
          `${server.name}: instance ${number} unavailable (${err.message})`,
        );
        return null;
      } finally {
        server.opening.delete(number);
      }
    })();
    server.opening.set(number, opening);
    const link = await opening;
    if (link) {
      this.issues.ok(`link:${server.id}:${number}`, `${server.name}: instance ${number} back`);
    }
    return link;
  }

  closeLinks(server) {
    const links = [...server.links.values()];
    server.links.clear();
    for (const link of links) {
      link.connection.close();
    }
  }

  onLinkClosed(server, link) {
    if (server.links.get(link.instance) === link) {
      server.links.delete(link.instance);
    }
    if (this.stopped) {
      return;
    }
    logger.debug(`${server.name}: link of instance ${link.instance} closed`);
    this.updateReachability(server);
  }

  /** One line when a server stops answering, one when it is back. */
  updateReachability(server) {
    const reachable = this.isConnected(server);
    if (reachable && !server.announced) {
      server.announced = true;
      const running = server.instances.filter((instance) => instance.running).length;
      logger.info(
        `Hyperion ${server.name} found at ${address(server)} ` +
          `(${server.version ?? 'unknown version'}, ${running} running instance(s))`,
      );
    }
    if (reachable) {
      this.issues.ok(`server:${server.id}`, `Hyperion ${server.name} answers again`);
    } else if (server.reachable) {
      this.issues.fail(`server:${server.id}`, `Hyperion ${server.name} lost (${address(server)})`);
    }
    if (reachable !== server.reachable) {
      server.reachable = reachable;
      this.updateConnectionStatus().catch(() => {});
      this.refreshWidget();
    }
  }

  markUnreachable(server, err) {
    logger.debug(`${server.name} unreachable: ${err.message}`);
    this.closeLinks(server);
    this.updateReachability(server);
  }

  onUpdate(server, link, message) {
    const { info, kind } = applyUpdate(server.infos.get(link.instance) ?? {}, message);
    if (!kind) {
      return;
    }
    server.infos.set(link.instance, info);
    logger.debug(`${server.name}: ${message.command} (instance ${link.instance})`);
    if (kind === 'instances') {
      this.updateInstances(server, parseInstances(info));
    } else if (kind === 'effects') {
      this.publishDevices().catch(() => {});
    }
    this.publishInstanceStates(server, link.instance).catch(() => {});
  }

  /** A new list of instances (one added, renamed, started or stopped). */
  updateInstances(server, instances) {
    if (instances.length === 0 || JSON.stringify(instances) === JSON.stringify(server.instances)) {
      return;
    }
    server.instances = instances;
    this.save();
    (async () => {
      await this.ensureLinks(server);
      await this.publishDevices();
      for (const instance of instances.filter((entry) => !entry.running)) {
        await this.publishInstanceStates(server, instance.instance);
      }
    })().catch((err) => logger.debug(`Instance update failed: ${err.message}`));
  }

  // --- The hub's own refresh (no Gladys poll needed) -------------------------

  async refresh() {
    if (this.refreshing) {
      return this.refreshing;
    }
    this.refreshing = (async () => {
      if (this.gladys.connected === false) {
        logger.debug('Gladys unreachable: refresh skipped');
        return;
      }
      const lost = [...this.servers.values()].some((server) => !this.isConnected(server));
      if (lost && this.now() - this.lastScanAt >= this.timings.rescanMs) {
        await this.discover({ scan: true });
      }
      await Promise.all(
        [...this.servers.values()].map(async (server) => {
          if (!this.isConnected(server)) {
            await this.connectCandidate(server);
            return;
          }
          await this.ensureLinks(server);
          await Promise.all(
            [...server.links.values()].map((link) => this.refreshLink(server, link)),
          );
        }),
      );
      await Promise.all(
        [...this.pendingHosts.values()].map((candidate) => this.connectCandidate(candidate)),
      );
      await this.publishDevices();
      await this.updateConnectionStatus();
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Read an instance again (a missed push, a silent connection). */
  async refreshLink(server, link) {
    try {
      const info = await link.connection.serverinfo();
      link.refreshedAt = this.now();
      server.infos.set(link.instance, info);
      this.updateInstances(server, parseInstances(info));
      await this.publishInstanceStates(server, link.instance);
    } catch (err) {
      logger.debug(`${server.name}: refresh of instance ${link.instance} failed (${err.message})`);
      link.connection.close();
    }
  }

  // --- Publication ----------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  instanceRecord(server, number) {
    return server.instances.find((instance) => instance.instance === number) ?? null;
  }

  buildDevices() {
    const devices = [];
    for (const server of this.servers.values()) {
      for (const instance of server.instances) {
        devices.push(
          buildDevice(
            this.gladys,
            server,
            instance,
            server.infos.get(instance.instance) ?? {},
            this.config.language,
          ),
        );
      }
    }
    return devices;
  }

  /** Publish the device list when it changed (Gladys upserts by external id). */
  async publishDevices() {
    if (this.gladys.connected === false) {
      return;
    }
    const devices = this.buildDevices();
    const json = JSON.stringify(devices);
    if (json === this.lastDevices) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.lastDevices = json;
      this.issues.ok('devices', 'Gladys accepts the devices again');
    } catch (err) {
      this.issues.fail('devices', `Gladys refused the devices (${err.message})`);
    }
  }

  /** Publish the values of an instance that changed (or are due for the heartbeat). */
  async publishInstanceStates(server, number) {
    const instance = this.instanceRecord(server, number);
    if (!instance || this.gladys.connected === false) {
      return;
    }
    const ids = deviceIds(this.gladys, server.id, number);
    if (!this.isCreated(ids.device)) {
      return;
    }
    const info = server.infos.get(number) ?? {};
    const values = featureValues(info, instance.running, this.config.language);
    try {
      await this.gladys.publishChangedStates(toStates(ids, values), {
        heartbeat: STATE_HEARTBEAT_MS,
      });
      this.issues.ok('states', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('states', `Gladys refused the states (${err.message})`);
    }
    const source = values[FEATURE_KEYS.SOURCE].text;
    if (this.lastSources.get(ids.device) !== source) {
      const first = !this.lastSources.has(ids.device);
      this.lastSources.set(ids.device, source);
      if (!first) {
        this.refreshWidget();
      }
    }
  }

  async publishAllStates() {
    for (const server of this.servers.values()) {
      for (const instance of server.instances) {
        await this.publishInstanceStates(server, instance.instance);
      }
    }
  }

  /** The user added (or updated) a device: send all its values now. */
  async onDeviceCreated(device) {
    const target = this.resolve(device.external_id);
    if (!target) {
      return;
    }
    await this.publishInstanceStates(target.server, target.instance);
    this.refreshWidget();
  }

  /** Fallback for a Gladys that would poll anyway: read the instance if stale. */
  async poll(device) {
    const target = this.resolve(device.external_id);
    if (!target) {
      return;
    }
    const link = target.server.links.get(target.instance);
    if (link?.connection.connected) {
      if (this.now() - link.refreshedAt >= this.timings.refreshMs / 2) {
        await this.refreshLink(target.server, link);
      }
      return;
    }
    await this.connectCandidate(target.server);
  }

  /** Gladys asks the dashboard widget again, at most once every 10 s. */
  refreshWidget() {
    if (this.stopped || this.widgetTimer) {
      return;
    }
    const wait = this.lastWidgetRefreshAt + this.timings.widgetRefreshMs - this.now();
    const run = () => {
      this.widgetTimer = null;
      this.lastWidgetRefreshAt = this.now();
      try {
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      } catch (err) {
        logger.debug(`Widget refresh failed (${err.message})`);
      }
    };
    if (wait <= 0 || !this.timers) {
      run();
    } else {
      this.widgetTimer = setTimeout(run, wait);
    }
  }

  /** Connection status shown by Gladys, sent when it changes. */
  async updateConnectionStatus() {
    const servers = [...this.servers.values()];
    const tokenNeeded =
      servers.some((server) => server.tokenNeeded) ||
      [...this.pendingHosts.values()].some((entry) => entry.status === 'token');
    let status;
    if (servers.some((server) => this.isConnected(server)) && !tokenNeeded) {
      status = { connected: true };
    } else if (tokenNeeded) {
      status = { connected: false, message: CONNECTION_TEXT.tokenNeeded };
    } else if (servers.length > 0) {
      status = { connected: false, message: CONNECTION_TEXT.unreachable };
    } else {
      status = { connected: false, message: CONNECTION_TEXT.noServer };
    }
    const json = JSON.stringify(status);
    if (json === this.lastStatus || this.gladys.connected === false) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.lastStatus = json;
    } catch (err) {
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  save() {
    const servers = {};
    for (const server of this.servers.values()) {
      servers[server.id] = {
        host: server.host,
        port: server.port,
        name: server.name,
        version: server.version,
        instances: server.instances,
        infos: Object.fromEntries(
          [...server.infos].map(([number, info]) => [number, persistedInfo(info)]),
        ),
      };
    }
    this.saved.servers = servers;
    return this.store.save(this.saved);
  }

  // --- Commands -------------------------------------------------------------

  /** The server and instance of a device external id, or null. */
  resolve(externalId) {
    for (const server of this.servers.values()) {
      for (const instance of server.instances) {
        if (deviceIds(this.gladys, server.id, instance.instance).device === externalId) {
          return { server, instance: instance.instance };
        }
      }
    }
    return null;
  }

  resolveOrThrow(externalId) {
    const target = this.resolve(externalId);
    if (!target) {
      throw userError(this.config.language, 'unknownDevice');
    }
    return target;
  }

  instanceName(target) {
    return this.instanceRecord(target.server, target.instance)?.name ?? target.server.name;
  }

  /** The connection of an instance, (re)opened when needed. */
  async link(target) {
    const link =
      target.server.links.get(target.instance) ??
      (this.instanceRecord(target.server, target.instance)?.running
        ? await this.openLink(target.server, target.instance)
        : null);
    if (!link?.connection.connected) {
      throw userError(this.config.language, 'unreachable', this.instanceName(target));
    }
    return link;
  }

  /** Run a call on the server, turning its refusals into a readable error. */
  async run(target, fn) {
    try {
      return await fn();
    } catch (err) {
      if (err.userFacing) {
        throw err;
      }
      if (err.code === 'closed' || err.code === 'timeout') {
        throw userError(this.config.language, 'unreachable', this.instanceName(target));
      }
      throw userError(this.config.language, 'refused', err.message);
    }
  }

  info(target) {
    return target.server.infos.get(target.instance) ?? {};
  }

  /** A Gladys command on a feature of an instance device. */
  async setValue(device, feature, value) {
    const target = this.resolveOrThrow(device.external_id);
    const key = feature.external_id.slice(device.external_id.length + 1);
    logger.info(`${this.instanceName(target)}: ${key} set to ${value}`);
    await this.run(target, () => this.command(target, key, value));
    await this.afterCommand(target);
  }

  async command(target, key, value) {
    const number = Number(value);
    switch (key) {
      case FEATURE_KEYS.POWER:
        return number > 0 ? this.turnOn(target) : this.turnOff(target);
      case FEATURE_KEYS.BRIGHTNESS:
        return number > 0 ? this.setBrightness(target, number) : this.turnOff(target);
      case FEATURE_KEYS.COLOR:
        return this.showColor(target, intToRgb(number));
      case FEATURE_KEYS.EFFECT:
        if (value === NO_EFFECT) {
          const link = await this.link(target);
          return link.connection.clear(this.config.priority);
        }
        return this.showEffect(target, value);
      case FEATURE_KEYS.AMBILIGHT:
        return number > 0 ? this.restoreAmbilight(target) : this.stopAmbilight(target);
      default: {
        const component = componentOfKey(key);
        if (!component || componentEnabled(this.info(target), component) === null) {
          throw userError(this.config.language, 'refused', `unknown feature ${key}`);
        }
        const link = await this.link(target);
        return link.connection.setComponent(component, number > 0);
      }
    }
  }

  /** Read the instance right away: Gladys gets the result without waiting for a push. */
  async afterCommand(target) {
    const link = target.server.links.get(target.instance);
    if (link?.connection.connected) {
      await this.refreshLink(target.server, link);
    }
  }

  async turnOn(target) {
    if (!this.instanceRecord(target.server, target.instance)?.running) {
      await this.startInstance(target);
    }
    const link = await this.link(target);
    const info = this.info(target);
    if (componentEnabled(info, 'ALL') === false) {
      await link.connection.setComponent('ALL', true);
    }
    if (componentEnabled(info, 'LEDDEVICE') === false) {
      await link.connection.setComponent('LEDDEVICE', true);
    }
  }

  async turnOff(target) {
    const link = await this.link(target);
    await link.connection.setComponent('ALL', false);
  }

  /** A stopped instance is started through any connection to its server. */
  async startInstance(target) {
    const { server } = target;
    const other = [...server.links.values()].find((link) => link.connection.connected);
    let connection = other?.connection;
    let temporary = null;
    if (!connection) {
      temporary = await this.open(server);
      await this.authenticate(temporary, { id: server.id, address: address(server) });
      connection = temporary;
    }
    try {
      await connection.startInstance(target.instance);
    } finally {
      temporary?.close();
    }
    const record = this.instanceRecord(server, target.instance);
    if (record) {
      record.running = true;
    }
    await this.openLink(server, target.instance);
  }

  async ensureOn(target) {
    if (!this.instanceRecord(target.server, target.instance)?.running || !isOn(this.info(target))) {
      await this.turnOn(target);
    }
  }

  async setBrightness(target, percent) {
    const level = Math.max(1, Math.min(100, Math.round(percent)));
    const link = await this.link(target);
    for (const id of adjustmentIds(this.info(target))) {
      await link.connection.setAdjustment(
        id === null ? { brightness: level } : { id, brightness: level },
      );
    }
    await this.ensureOn(target);
  }

  async showColor(target, rgb, durationMs = 0) {
    await this.ensureOn(target);
    const link = await this.link(target);
    await link.connection.setColor({ priority: this.config.priority, rgb, durationMs });
  }

  /** @returns {Promise<string>} the effect name, as the server writes it */
  async showEffect(target, wanted, durationMs = 0) {
    const name = findEffect(this.info(target), wanted);
    if (!name) {
      throw userError(this.config.language, 'unknownEffect', String(wanted ?? '').slice(0, 60));
    }
    await this.ensureOn(target);
    const link = await this.link(target);
    await link.connection.setEffect({ priority: this.config.priority, name, durationMs });
    return name;
  }

  captureKey(target) {
    return `${target.server.id}-${target.instance}`;
  }

  /**
   * Back to the picture: remove the colours and effects set through the API
   * (by Gladys or another application), and turn the video capture on again
   * if the Ambilight switch turned it off.
   */
  async restoreAmbilight(target) {
    await this.ensureOn(target);
    const link = await this.link(target);
    const info = this.info(target);
    for (const priority of new Set(apiPriorities(info))) {
      await link.connection.clear(priority);
    }
    const { present, enabled } = captureComponents(info);
    if (enabled.length === 0 && present.length > 0) {
      const remembered = (this.saved.captureOff[this.captureKey(target)] ?? []).filter((name) =>
        present.includes(name),
      );
      for (const component of remembered.length > 0 ? remembered : present) {
        await link.connection.setComponent(component, true);
      }
    }
    delete this.saved.captureOff[this.captureKey(target)];
    this.save();
  }

  /** Stop following the picture: turn the enabled video captures off. */
  async stopAmbilight(target) {
    const link = await this.link(target);
    const { enabled } = captureComponents(this.info(target));
    for (const component of enabled) {
      await link.connection.setComponent(component, false);
    }
    if (enabled.length > 0) {
      this.saved.captureOff[this.captureKey(target)] = enabled;
      this.save();
    }
  }

  // --- Scene actions and widget buttons -------------------------------------

  async startEffect(externalId, { effect, durationMinutes }) {
    const target = this.resolveOrThrow(externalId);
    logger.info(`${this.instanceName(target)}: effect "${effect}" started by a scene`);
    const name = await this.run(target, () =>
      this.showEffect(target, effect, minutesToMs(durationMinutes)),
    );
    await this.afterCommand(target);
    return name;
  }

  async showColorFor(externalId, { rgb, durationMinutes }) {
    const target = this.resolveOrThrow(externalId);
    logger.info(`${this.instanceName(target)}: color ${rgbToHex(rgb)} set by a scene`);
    await this.run(target, () => this.showColor(target, rgb, minutesToMs(durationMinutes)));
    await this.afterCommand(target);
    return rgbToHex(rgb);
  }

  async backToAmbilight(externalId) {
    const target = this.resolveOrThrow(externalId);
    logger.info(`${this.instanceName(target)}: back to the Ambilight`);
    await this.run(target, () => this.restoreAmbilight(target));
    await this.afterCommand(target);
  }

  async setPower(externalId, on) {
    const target = this.resolveOrThrow(externalId);
    logger.info(`${this.instanceName(target)}: turned ${on ? 'on' : 'off'} from the widget`);
    await this.run(target, () => (on ? this.turnOn(target) : this.turnOff(target)));
    await this.afterCommand(target);
  }

  /** What the widget shows for a device. */
  snapshot(externalId, language) {
    const target = this.resolve(externalId);
    if (!target) {
      return null;
    }
    const info = this.info(target);
    const running = this.instanceRecord(target.server, target.instance)?.running === true;
    const ids = deviceIds(this.gladys, target.server.id, target.instance);
    return {
      name: this.instanceName(target),
      reachable: target.server.links.get(target.instance)?.connection.connected === true,
      on: running && isOn(info),
      source: sourceText(info, running, language),
      featureId: ids.feature,
      effect: featureValues(info, running, language)[FEATURE_KEYS.EFFECT]?.text ?? NO_EFFECT,
      ambilight: featureValues(info, running, language)[FEATURE_KEYS.AMBILIGHT] === 1,
    };
  }

  /** The first instance device the user added, for a widget without setting. */
  firstCreatedDevice() {
    for (const server of this.servers.values()) {
      for (const instance of server.instances) {
        const id = deviceIds(this.gladys, server.id, instance.instance).device;
        if (this.isCreated(id)) {
          return id;
        }
      }
    }
    return null;
  }

  // --- Token request (manifest action) --------------------------------------

  /**
   * Ask every server that wants a token for a new one. Hyperion shows the
   * request in its web interface; the user accepts it there.
   * @returns {Promise<Array<{ address: string, outcome: 'granted'|'denied'|'failed' }>>}
   */
  async requestTokens() {
    const targets = new Map();
    for (const entry of this.pendingHosts.values()) {
      if (entry.status === 'token') {
        targets.set(address(entry), { host: entry.host, port: entry.port, id: entry.id ?? null });
      }
    }
    for (const server of this.servers.values()) {
      if (server.tokenNeeded) {
        targets.set(address(server), { host: server.host, port: server.port, id: server.id });
      }
    }
    const results = await Promise.all(
      [...targets.values()].map(async (target) => {
        const key = address(target);
        let connection;
        const request = { id: requestId(), comment: TOKEN_COMMENT };
        try {
          connection = await this.open(target);
          logger.info(`Token requested from Hyperion at ${key}, waiting for its approval`);
          const token = await connection.requestToken({
            ...request,
            timeoutMs: this.timings.tokenRequestMs,
          });
          this.saved.tokens[target.id ?? key] = token;
          this.save();
          logger.info(`Hyperion at ${key} granted a token`);
          return { address: key, outcome: 'granted' };
        } catch (err) {
          connection?.cancelTokenRequest(request);
          logger.warn(`Token request to ${key} failed (${err.message})`);
          return { address: key, outcome: err.code === 'closed' ? 'failed' : 'denied' };
        } finally {
          connection?.close();
        }
      }),
    );
    if (results.some((result) => result.outcome === 'granted')) {
      for (const server of this.servers.values()) {
        if (server.tokenNeeded) {
          this.closeLinks(server);
        }
      }
      await this.discover({ scan: false });
    }
    return results;
  }

  /** What the "Search" report shows. */
  summary() {
    return {
      servers: [...this.servers.values()].map((server) => ({
        name: server.name,
        address: address(server),
        version: server.version ?? '?',
        instances: server.instances.length,
        reachable: this.isConnected(server),
        tokenNeeded: server.tokenNeeded,
      })),
      tokenHosts: [...this.pendingHosts.values()]
        .filter((entry) => entry.status === 'token')
        .map(address),
      unreachableHosts: [...this.pendingHosts.values()]
        .filter((entry) => entry.status === 'unreachable')
        .map(address),
      discoveryUnavailable:
        this.discovery.ssdp === 'unavailable' && this.discovery.mdns === 'unavailable',
      invalidHosts: this.config.invalidHosts,
    };
  }
}

const minutesToMs = (minutes) => {
  const value = Number(minutes);
  return Number.isFinite(value) && value > 0 ? Math.round(Math.min(value, 1440) * 60_000) : 0;
};
