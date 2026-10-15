// -----------------------------------------------------------------------------
// The dashboard widget: content valid for the core (vocabulary and budget),
// live tile bound to a feature that exists, buttons that do what they say.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeHyperion } from './helpers/fakeHyperion.js';
import { createAll, createWorld, instanceId, settle } from './helpers/world.js';

async function setup(t, { create = true } = {}) {
  const server = await createFakeHyperion();
  const world = await createWorld({ servers: [server] });
  t.after(async () => {
    await world.app.stop();
    await server.stop().catch(() => {});
  });
  if (create) {
    await createAll(world);
  }
  return { server, world, gladys: world.gladys };
}

const content = async (gladys, settings, language = 'en') => {
  const ack = await gladys.fake.widgetGet('hyperion', { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

const buttons = (widget) => widget.components.filter((component) => component.type === 'button');

test('the widget shows the instance and offers its buttons', async (t) => {
  const { gladys, server } = await setup(t);
  const device = instanceId(gladys, server, 1);
  const widget = await content(gladys, { device, effects: ['Candle', 'Fire', 'Sparks'] });
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components[0].text, 'Desk');

  // The live tile is bound to a feature the device really has.
  const tile = widget.components.find((component) => component.type === 'value');
  const features = gladys.fake.discoveredDevices
    .find((entry) => entry.external_id === device)
    .features.map((feature) => feature.external_id);
  assert.ok(features.includes(tile.device_feature));

  const status = widget.components.find((component) => component.type === 'status');
  assert.deepEqual(status.items, [
    { label: 'Showing', value: 'Ambilight (USB capture)', color: 'success' },
  ]);
  assert.deepEqual(
    buttons(widget).map((button) => [button.label, button.icon, button.action.key]),
    [
      ['Ambilight', 'check-circle', 'ambilight'],
      ['Candle', 'play', 'effect_1'],
      ['Fire', 'play', 'effect_2'],
      ['Turn off', 'power', 'power'],
    ],
  );
  // Never the `primary` style: invisible in dark mode (Gladys#3153).
  assert.ok(buttons(widget).every((button) => button.style !== 'primary'));
});

test('the buttons start an effect, go back to the Ambilight, turn off and on', async (t) => {
  const { gladys, server } = await setup(t);
  const device = instanceId(gladys, server, 0);
  const settings = { device, effects: ['Candle'] };
  const tap = (actionKey, params) =>
    gladys.fake.widgetAction('hyperion', actionKey, params, { settings });

  assert.deepEqual(await tap('effect_1', { effect: 'Candle' }), { success: true });
  let widget = await content(gladys, settings, 'fr');
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components.find((c) => c.type === 'status').items[0].value, 'Effet : Candle');
  assert.deepEqual(
    buttons(widget).map((button) => [button.label, button.icon]),
    [
      ['Ambilight', 'tv'],
      ['Candle', 'check-circle'],
      ['Éteindre', 'power'],
    ],
  );

  await tap('ambilight', {});
  widget = await content(gladys, settings);
  assert.equal(buttons(widget)[0].icon, 'check-circle');

  await tap('power', { on: false });
  widget = await content(gladys, settings, 'de');
  assert.deepEqual(widget.components.find((c) => c.type === 'status').items[0], {
    label: 'Anzeige',
    value: 'Aus',
    color: 'neutral',
  });
  assert.equal(buttons(widget).at(-1).label, 'Einschalten');
  await tap('power', { on: true });
  widget = await content(gladys, settings, 'es');
  assert.equal(buttons(widget).at(-1).label, 'Apagar');
});

test('without a setting, the widget follows the first device added', async (t) => {
  const { gladys } = await setup(t);
  const widget = await content(gladys, {});
  assert.equal(widget.components[0].text, 'TV');
  assert.equal(buttons(widget).length, 2, 'Ambilight and power, no effect chosen');
});

test('nothing added yet, or the server gone: the widget says so', async (t) => {
  const { gladys, server, world } = await setup(t, { create: false });
  let widget = await content(gladys, {});
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.match(widget.components[0].text, /^Choose a Hyperion device/);

  await createAll(world);
  await server.stop();
  await settle(50);
  widget = await content(gladys, {}, 'fr');
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.deepEqual(widget.components.find((c) => c.type === 'status').items[0], {
    label: 'Affichage',
    value: 'Le serveur Hyperion ne répond pas.',
    color: 'danger',
  });
  assert.equal(buttons(widget).length, 0);
});

test('the widget is refreshed when what the light shows changes', async (t) => {
  const { gladys, server, world } = await setup(t);
  const before = gladys.fake.widgetRefreshes.length;
  world.hub.lastWidgetRefreshAt = -Infinity;
  await gladys.fake.sceneAction('show_color', {
    device: instanceId(gladys, server, 0),
    color: '#123456',
  });
  assert.ok(gladys.fake.widgetRefreshes.length > before);
});
