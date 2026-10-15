import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    servers: [],
    invalidHosts: [],
    token: '',
    priority: 128,
    language: 'fr',
  });
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('server addresses: ports, pasted URLs, mistakes', () => {
  assert.deepEqual(
    parseHosts(
      '192.0.2.20, 192.0.2.21:19445;http://192.0.2.22:8090/#remote\nhyperion.lan 192.0.2.20 300.1.1.1 192.0.2 x:99999',
    ),
    {
      servers: [
        { host: '192.0.2.20', port: 19444 },
        { host: '192.0.2.21', port: 19445 },
        // The address of the web interface: the JSON API is on its default port.
        { host: '192.0.2.22', port: 19444 },
        { host: 'hyperion.lan', port: 19444 },
      ],
      invalid: ['300.1.1.1', '192.0.2', 'x:99999'],
    },
  );
  assert.deepEqual(parseHosts(undefined), { servers: [], invalid: [] });
});

test('priority, token and language', () => {
  const config = normalizeConfig({ priority: '50', token: '  abc  ', language: 'de' });
  assert.equal(config.priority, 50);
  assert.equal(config.token, 'abc');
  assert.equal(config.language, 'de');
  for (const priority of [0, 254, 12.5, 'x', null]) {
    assert.equal(normalizeConfig({ priority }).priority, 128, String(priority));
  }
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});
