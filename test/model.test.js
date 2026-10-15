// -----------------------------------------------------------------------------
// Reading the state of an instance, on the real serverinfo of Hyperion.ng.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustmentIds,
  apiPriorities,
  applyUpdate,
  brightness,
  captureComponents,
  captureVisible,
  effectNames,
  findEffect,
  intToRgb,
  isOn,
  parseColor,
  parseInstances,
  rgbToHex,
  rgbToInt,
  visibleColor,
  visibleEffect,
  visiblePriority,
} from '../src/hyperion/model.js';
import { SERVERINFO } from './helpers/fakeHyperion.js';

test('the stock serverinfo: on, USB capture shown, 39 effects', () => {
  assert.equal(isOn(SERVERINFO), true);
  assert.equal(brightness(SERVERINFO), 83);
  assert.deepEqual(adjustmentIds(SERVERINFO), ['default']);
  // The visible source is not the first one listed (hyperion.ng#964).
  assert.equal(visiblePriority(SERVERINFO).priority, 240);
  assert.equal(captureVisible(SERVERINFO), true);
  assert.deepEqual(captureComponents(SERVERINFO), {
    present: ['GRABBER', 'V4L'],
    enabled: ['V4L'],
  });
  assert.equal(effectNames(SERVERINFO).length, 39);
  assert.equal(findEffect(SERVERINFO, ' rainbow SWIRL '), 'Rainbow swirl');
  assert.equal(findEffect(SERVERINFO, 'Disco'), null);
  assert.deepEqual(parseInstances(SERVERINFO), [
    { instance: 0, name: 'wled-tv-lights', running: true },
    { instance: 1, name: 'test-instance', running: true },
  ]);
});

test('updates: components, adjustment, priorities, effects, instances', () => {
  let info = structuredClone(SERVERINFO);
  ({ info } = applyUpdate(info, {
    command: 'components-update',
    data: { name: 'LEDDEVICE', enabled: false },
  }));
  assert.equal(isOn(info), false);
  ({ info } = applyUpdate(info, { command: 'adjustment-update', data: [{ brightness: 25 }] }));
  assert.equal(brightness(info), 25);
  assert.deepEqual(adjustmentIds(info), [null]);

  const priorities = [
    {
      active: true,
      componentId: 'GRABBER',
      origin: 'System',
      owner: 'X11',
      priority: 250,
      visible: false,
    },
    {
      active: true,
      componentId: 'EFFECT',
      origin: 'System',
      owner: 'Warm mood blobs',
      priority: 254,
      visible: false,
    },
    {
      active: true,
      componentId: 'COLOR',
      origin: 'Web',
      owner: 'System',
      priority: 40,
      value: { RGB: [0, 0, 255] },
      visible: true,
    },
  ];
  const update = applyUpdate(info, {
    command: 'priorities-update',
    data: { priorities, priorities_autoselect: false },
  });
  assert.equal(update.kind, 'state');
  assert.deepEqual(visibleColor(update.info), [0, 0, 255]);
  assert.equal(visibleEffect(update.info), null);
  assert.equal(captureVisible(update.info), false);
  // The background effect (254) is not set through the API.
  assert.deepEqual(apiPriorities(update.info), [40]);

  assert.equal(
    applyUpdate(info, { command: 'effects-update', data: [{ name: 'A' }] }).kind,
    'effects',
  );
  const instances = applyUpdate(info, {
    command: 'instance-update',
    data: [
      { instance: 1, running: false, friendly_name: ' Desk ' },
      { instance: 0, running: true },
    ],
  });
  assert.equal(instances.kind, 'instances');
  assert.deepEqual(parseInstances(instances.info), [
    { instance: 0, name: 'Hyperion 0', running: true },
    { instance: 1, name: 'Desk', running: false },
  ]);
  assert.equal(applyUpdate(info, { command: 'leds-update', data: {} }).kind, null);
  assert.equal(applyUpdate(info, { command: 'components-update', data: 'x' }).kind, null);
});

test('a capture whose component is off is not the Ambilight', () => {
  const info = structuredClone(SERVERINFO);
  info.components.find((component) => component.name === 'V4L').enabled = false;
  assert.equal(captureVisible(info), false);
});

test('colours: Gladys integers, hexadecimal, typed by a user', () => {
  assert.equal(rgbToInt([255, 136, 0]), 0xff8800);
  assert.deepEqual(intToRgb(0xff8800), [255, 136, 0]);
  assert.deepEqual(intToRgb(-5), [0, 0, 0]);
  assert.equal(rgbToHex([255, 136, 0]), '#FF8800');
  assert.deepEqual(parseColor('#ff8800'), [255, 136, 0]);
  assert.deepEqual(parseColor('FF8800'), [255, 136, 0]);
  assert.deepEqual(parseColor('#f80'), [255, 136, 0]);
  assert.deepEqual(parseColor('255, 136, 0'), [255, 136, 0]);
  assert.deepEqual(parseColor('255 136 0'), [255, 136, 0]);
  for (const bad of ['orange', '#GG0000', '256,0,0', '1,2', '', null]) {
    assert.equal(parseColor(bad), null, String(bad));
  }
});
