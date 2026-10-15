// -----------------------------------------------------------------------------
// Reading the raw results of the mediated network discovery (the core sends
// the SSDP M-SEARCH and browses mDNS for us: the integration container sits
// on a bridge network that multicast never reaches).
//
// Hyperion.ng answers the M-SEARCH of `urn:hyperion-project.org:device:basic:1`
// with its id in USN (`uuid:<id>`, the same id as `sysinfo`) and, since 2.0,
// with `HYPERION-NAME` and `HYPERION-JSS-PORT` headers (the JSON API port).
// It publishes `_hyperiond-json._tcp` in mDNS with `id` and `version` in TXT.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { DEFAULT_PORT } from './client.js';

export const SSDP_ST = 'urn:hyperion-project.org:device:basic:1';
export const MDNS_SERVICE = '_hyperiond-json._tcp';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isIpv4 = (address) =>
  typeof address === 'string' &&
  IPV4.test(address) &&
  address.split('.').every((part) => Number(part) <= 255);

const validPort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
};

/** Lower-cased header map of a raw SSDP response. */
export function parseSsdpHeaders(raw) {
  const headers = {};
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      const name = line.slice(0, colon).trim().toLowerCase();
      if (name && !(name in headers)) {
        headers[name] = line.slice(colon + 1).trim();
      }
    }
  }
  return headers;
}

/**
 * One candidate server per Hyperion SSDP response.
 * @param {Array<{ source_ip: string, headers: string }>} results
 * @returns {Array<{ id: string|null, host: string, port: number, name: string|null, version: string|null, via: 'ssdp' }>}
 */
export function ssdpCandidates(results) {
  const candidates = [];
  for (const result of Array.isArray(results) ? results : []) {
    const headers = parseSsdpHeaders(result?.headers);
    const server = headers.server ?? '';
    const isHyperion =
      'hyperion-jss-port' in headers ||
      String(headers.st ?? '').startsWith('urn:hyperion-project.org:') ||
      /hyperion/i.test(server);
    if (!isHyperion) {
      continue;
    }
    let host = isIpv4(result?.source_ip) ? result.source_ip : null;
    if (!host) {
      try {
        host = new URL(headers.location).hostname;
      } catch {
        host = null;
      }
    }
    if (!isIpv4(host)) {
      continue;
    }
    const id = headers.usn?.match(/uuid:([0-9a-z-]+)/i)?.[1]?.toLowerCase() ?? null;
    candidates.push({
      id,
      host,
      port: validPort(headers['hyperion-jss-port']) ?? DEFAULT_PORT,
      name: headers['hyperion-name'] || null,
      version: server.match(/Hyperion\/([^\s]+)/i)?.[1] ?? null,
      via: 'ssdp',
    });
  }
  return candidates;
}

/**
 * One candidate server per `_hyperiond-json._tcp` service.
 * @param {Array<{ name: string, addresses: string[], port: number, txt: string[] }>} results
 */
export function mdnsCandidates(results) {
  const candidates = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!String(result?.name ?? '').includes('_hyperiond-json')) {
      continue;
    }
    const host = (Array.isArray(result.addresses) ? result.addresses : []).find(isIpv4);
    if (!host) {
      continue;
    }
    const txt = parseMdnsTxt(Array.isArray(result.txt) ? result.txt : []);
    candidates.push({
      id: typeof txt.id === 'string' && txt.id ? txt.id.toLowerCase() : null,
      host,
      port: validPort(result.port) ?? DEFAULT_PORT,
      name: null,
      version: typeof txt.version === 'string' ? txt.version : null,
      via: 'mdns',
    });
  }
  return candidates;
}

/**
 * Merge candidates found several ways: one per server id, else per address.
 * The first one wins (pass the most trusted source first).
 */
export function mergeCandidates(...lists) {
  const merged = [];
  for (const candidate of lists.flat()) {
    const same = merged.find(
      (known) =>
        (candidate.id && known.id === candidate.id) ||
        (known.host === candidate.host && known.port === candidate.port),
    );
    if (!same) {
      merged.push({ ...candidate });
    } else {
      for (const key of ['id', 'name', 'version']) {
        if (same[key] == null && candidate[key] != null) {
          same[key] = candidate[key];
        }
      }
    }
  }
  return merged;
}
