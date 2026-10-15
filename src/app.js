// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys) and returns the hub, so index.js stays a few lines and the tests
// drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { HyperionHub } from './hub.js';
import { CONNECTION_TEXT, SEARCH_TEXT, TOKEN_TEXT, allLanguages, pick } from './i18n.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'hyperion-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, connect, timers, timings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new HyperionHub({
    gladys,
    store: options.store ?? new Store(),
    connect: options.connect,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first scan is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, CONNECTION_TEXT.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The devices are published with should_poll: false (pushed by the server,
  // refreshed by the hub's timer); this only serves a Gladys polling anyway.
  gladys.onPoll(whenReady((device) => hub.poll(device)));

  // The SDK forgets what it published for a device the user adds or updates:
  // everything is sent again at once.
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'search',
    whenReady(async () => {
      logger.info('Search for Hyperion servers requested');
      await hub.rediscover();
      return searchMessage(hub.summary());
    }),
  );

  gladys.onAction(
    'request_token',
    whenReady(async () => tokenMessage(await hub.requestTokens())),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}

/** The report shown under the "Search" button, in every language. */
export function searchMessage(summary) {
  return allLanguages((language) => searchReport(summary, pick(SEARCH_TEXT, language)));
}

function searchReport(summary, text) {
  const lines = [];
  const { servers } = summary;
  if (servers.length === 0 && summary.tokenHosts.length === 0) {
    lines.push(text.none);
  } else if (servers.length > 0) {
    const reachable = servers.filter((server) => server.reachable).length;
    lines.push(text.count(servers.length, reachable));
    const list = servers.map((server) => {
      const label = text.server(server.name, server.address, server.version, server.instances);
      return server.reachable ? label : `${label} – ${text.unreachable}`;
    });
    lines.push(`${list.join(', ')}.`);
  }
  for (const host of summary.tokenHosts) {
    lines.push(text.tokenNeeded(host));
  }
  if (summary.discoveryUnavailable) {
    lines.push(text.noDiscovery);
  }
  if (summary.unreachableHosts.length > 0) {
    lines.push(text.noAnswer(summary.unreachableHosts.slice(0, 3).join(', ')));
  }
  if (summary.invalidHosts.length > 0) {
    lines.push(text.ignored(summary.invalidHosts.slice(0, 3).join(', ')));
  }
  return lines.join(' ');
}

/** The report shown under the "Request a token" button, in every language. */
export function tokenMessage(results) {
  return allLanguages((language) => {
    const text = pick(TOKEN_TEXT, language);
    if (results.length === 0) {
      return text.notNeeded;
    }
    return results.map((result) => text[result.outcome](result.address)).join(' ');
  });
}
