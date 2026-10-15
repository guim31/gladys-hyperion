// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// servers: the stock serverinfo of Hyperion.ng 2.0 (two instances, USB capture
// shown), a newer layout with audio capture and an effect shown, a stopped
// instance — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeHyperion, instanceInfo } from './helpers/fakeHyperion.js';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** A newer server: audio capture, the platform capture on, an effect shown. */
function newerInfo() {
  const info = instanceInfo();
  info.components.push({ name: 'AUDIO', enabled: false });
  info.components.find((component) => component.name === 'GRABBER').enabled = true;
  info.priorities = [
    {
      active: true,
      componentId: 'EFFECT',
      origin: 'Web',
      owner: 'Rainbow swirl',
      priority: 50,
      visible: true,
    },
    {
      active: true,
      componentId: 'GRABBER',
      origin: 'System',
      owner: 'X11',
      priority: 250,
      visible: false,
    },
  ];
  return info;
}

const servers = async () => [
  await createFakeHyperion(),
  await createFakeHyperion({
    id: '9b1d4e2f-3a5c-4d6e-8f70-1a2b3c4d5e6f',
    version: '2.1.1',
    instances: [
      { instance: 0, name: 'Living room', info: newerInfo() },
      { instance: 1, name: 'Bedroom', running: false },
    ],
  }),
];

for (const language of ['en', 'fr', 'de', 'es']) {
  test(`every discovered device follows the Gladys rules (${language} names)`, async () => {
    const fakes = await servers();
    const { gladys, app } = await createWorld({ servers: fakes, config: { language } });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, 4, 'one device per instance, stopped ones included');

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
      await Promise.all(fakes.map((fake) => fake.stop()));
    }
  });
}
