// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT } from './hyperion/client.js';
import { MAX_PRIORITY, MIN_PRIORITY } from './hyperion/model.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  hosts: '',
  token: '',
  priority: 128,
  language: 'fr',
};

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const MAX_HOSTS = 16;

function validHost(host) {
  const ipv4 = host.match(IPV4_PATTERN);
  if (ipv4) {
    return ipv4.slice(1, 5).every((part) => Number(part) <= 255);
  }
  // Digits and dots only: a mistyped address, not a name.
  return !/^[\d.]+$/.test(host) && NAME_PATTERN.test(host);
}

/**
 * Parse the manual server list (commas, semicolons, spaces or new lines),
 * each entry an address with an optional JSON API port.
 * @returns {{ servers: Array<{ host: string, port: number }>, invalid: string[] }}
 */
export function parseHosts(raw) {
  const servers = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    // Users paste the address of the web interface: keep the host part.
    const text = entry
      .trim()
      .replace(/^[a-z]+:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (!text) {
      continue;
    }
    const match = text.match(/^([^:]+)(?::(\d{1,5}))?$/);
    const port = match?.[2] === undefined ? DEFAULT_PORT : Number(match[2]);
    if (!match || !validHost(match[1]) || port < 1 || port > 65535) {
      invalid.push(entry.trim());
      continue;
    }
    // The port of the web interface (8090) is not the JSON API: a pasted
    // browser address means the default JSON port.
    const server = { host: match[1], port: port === 8090 || port === 8092 ? DEFAULT_PORT : port };
    const known = servers.some((s) => s.host === server.host && s.port === server.port);
    if (!known && servers.length < MAX_HOSTS) {
      servers.push(server);
    }
  }
  return { servers, invalid };
}

/** An integer priority the JSON API accepts, else the default. */
function normalizePriority(raw) {
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
  return Number.isInteger(value) && value >= MIN_PRIORITY && value <= MAX_PRIORITY
    ? value
    : DEFAULT_CONFIG.priority;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { servers, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  return {
    servers,
    invalidHosts: invalid,
    token: typeof source.token === 'string' ? source.token.trim() : DEFAULT_CONFIG.token,
    priority: normalizePriority(source.priority),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
