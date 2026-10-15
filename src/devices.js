// -----------------------------------------------------------------------------
// From a Hyperion instance to a Gladys device: discovery payload and feature
// values. One device per instance (an instance drives one LED strip, or a
// WLED, a Hue bridge... that Hyperion feeds).
//
// Device and feature external ids are built from the server id (the `id` of
// `sysinfo`, also the SSDP USN and the mDNS TXT `id`) and the instance number:
// they survive a new IP address, a renamed instance and a reinstallation.
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { NAMES, SOURCE_TEXT, pick } from './i18n.js';
import {
  availableComponents,
  brightness,
  captureVisible,
  componentEnabled,
  effectNames,
  isOn,
  rgbToHex,
  rgbToInt,
  visibleColor,
  visibleEffect,
  visiblePriority,
} from './hyperion/model.js';

export const DEVICE_TYPE = 'instance';

export const FEATURE_KEYS = {
  POWER: 'power',
  BRIGHTNESS: 'brightness',
  COLOR: 'color',
  EFFECT: 'effect',
  AMBILIGHT: 'ambilight',
  SOURCE: 'source',
};

/** Feature key of a component switch: `component-v4l`... */
export const componentKey = (component) => `component-${component.toLowerCase()}`;

/** The component of a feature key, or null. */
export const componentOfKey = (key) =>
  typeof key === 'string' && key.startsWith('component-')
    ? key.slice('component-'.length).toUpperCase()
    : null;

// Value of the effect select when no effect runs: Gladys ignores an empty text.
export const NO_EFFECT = 'none';

export const namesFor = (language) => pick(NAMES, language);

/** External ids of an instance device. */
export const deviceIds = (gladys, serverId, instance) =>
  gladys.externalIds(DEVICE_TYPE, `${serverId}-${instance}`);

const binary = (key, name, category, type) => ({
  key,
  name,
  category,
  type,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: true,
});

/** The effect list: "None" first, then the effects of the server. */
export function effectOptions(info, language) {
  return [
    { value: NO_EFFECT, label: namesFor(language).noEffect },
    ...effectNames(info)
      .filter((name) => name !== NO_EFFECT)
      .map((name) => ({ value: name, label: name })),
  ].map((option, index) => ({ ...option, sort_order: index }));
}

/** Feature specs of an instance, from its state. */
export function featureSpecs(info, language) {
  const names = namesFor(language);
  const specs = [
    binary(FEATURE_KEYS.POWER, names.power, CATEGORIES.LIGHT, TYPES.LIGHT.BINARY),
    {
      key: FEATURE_KEYS.BRIGHTNESS,
      name: names.brightness,
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.BRIGHTNESS,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: true,
    },
    {
      key: FEATURE_KEYS.COLOR,
      name: names.color,
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.COLOR,
      min: 0,
      max: 0xffffff,
      read_only: false,
      has_feedback: true,
    },
    {
      key: FEATURE_KEYS.EFFECT,
      name: names.effect,
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      supported_options: effectOptions(info, language),
    },
    binary(FEATURE_KEYS.AMBILIGHT, names.ambilight, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY),
    {
      key: FEATURE_KEYS.SOURCE,
      name: names.source,
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.TEXT,
      min: 0,
      max: 0,
      read_only: true,
      has_feedback: false,
    },
  ];
  for (const component of availableComponents(info)) {
    const key = componentKey(component);
    specs.push(binary(key, names[key], CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
  }
  return specs;
}

/**
 * Discovery payload of an instance device.
 * @param {object} gladys
 * @param {object} server { id, host, port, version }
 * @param {{ instance: number, name: string }} instance
 * @param {object} info the state of the instance ({} for a stopped instance)
 * @param {string} language
 */
export function buildDevice(gladys, server, instance, info, language) {
  const ids = deviceIds(gladys, server.id, instance.instance);
  return {
    name: instance.name,
    external_id: ids.device,
    model: server.version ? `Hyperion ${server.version}` : 'Hyperion',
    // The states are pushed by the server (subscriptions) and refreshed by
    // the integration's own timer: Gladys does not poll these devices.
    should_poll: false,
    params: [
      { name: 'IP_ADDRESS', value: server.host },
      { name: 'HYPERION_PORT', value: String(server.port) },
      { name: 'HYPERION_ID', value: server.id },
      { name: 'HYPERION_INSTANCE', value: String(instance.instance) },
    ],
    features: featureSpecs(info, language).map((spec) => {
      const feature = {
        name: spec.name,
        external_id: ids.feature(spec.key),
        category: spec.category,
        type: spec.type,
        min: spec.min,
        max: spec.max,
        read_only: spec.read_only,
        has_feedback: spec.has_feedback,
        // On/off, brightness and the Ambilight have a useful history.
        keep_history: [
          FEATURE_KEYS.POWER,
          FEATURE_KEYS.BRIGHTNESS,
          FEATURE_KEYS.AMBILIGHT,
        ].includes(spec.key),
      };
      if (spec.unit) {
        feature.unit = spec.unit;
      }
      if (spec.supported_options) {
        feature.supported_options = spec.supported_options;
      }
      return feature;
    }),
  };
}

/** What the LEDs show, in words. */
export function sourceText(info, running, language) {
  const text = pick(SOURCE_TEXT, language);
  if (!running || !isOn(info)) {
    return text.off;
  }
  const visible = visiblePriority(info);
  if (!visible) {
    return text.nothing;
  }
  if (captureVisible(info)) {
    return text.ambilight(text[visible.componentId]);
  }
  const effect = visibleEffect(info);
  if (effect) {
    return text.effect(effect);
  }
  const color = visibleColor(info);
  if (color) {
    return text.color(rgbToHex(color));
  }
  const source =
    typeof visible.origin === 'string' && visible.origin && visible.origin !== 'System'
      ? visible.origin
      : String(visible.componentId ?? visible.owner ?? '?');
  return text.other(source.slice(0, 40));
}

/**
 * Feature values of an instance, by feature key: numbers, or `{ text }`.
 * A value the state does not tell (the colour while an effect runs) is left
 * out: Gladys keeps the last one.
 */
export function featureValues(info, running, language) {
  const on = running && isOn(info);
  const values = {
    [FEATURE_KEYS.POWER]: on ? 1 : 0,
    [FEATURE_KEYS.AMBILIGHT]: on && captureVisible(info) ? 1 : 0,
    [FEATURE_KEYS.SOURCE]: { text: sourceText(info, running, language) },
  };
  if (!running) {
    return values;
  }
  const level = brightness(info);
  if (level !== null) {
    values[FEATURE_KEYS.BRIGHTNESS] = level;
  }
  const color = visibleColor(info);
  if (color) {
    values[FEATURE_KEYS.COLOR] = rgbToInt(color);
  }
  const effect = visibleEffect(info);
  values[FEATURE_KEYS.EFFECT] = {
    text: effect && effectNames(info).includes(effect) ? effect : NO_EFFECT,
  };
  for (const component of availableComponents(info)) {
    values[componentKey(component)] = componentEnabled(info, component) ? 1 : 0;
  }
  return values;
}

/** The values as Gladys states of a device. */
export function toStates(ids, values) {
  return Object.entries(values).map(([key, value]) =>
    typeof value === 'number'
      ? { device_feature_external_id: ids.feature(key), state: value }
      : { device_feature_external_id: ids.feature(key), text: value.text },
  );
}
