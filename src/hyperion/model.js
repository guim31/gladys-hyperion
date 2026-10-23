// -----------------------------------------------------------------------------
// Reading the state of a Hyperion instance: the `info` object of a
// `serverinfo` reply, kept up to date by the `*-update` messages of the
// subscriptions. Pure functions, no I/O.
// -----------------------------------------------------------------------------

/** The updates the hub subscribes to, on every instance link. */
export const SUBSCRIPTIONS = [
  'adjustment-update',
  'components-update',
  'effects-update',
  'instance-update',
  'priorities-update',
];

// The video captures: what makes the LEDs follow the picture ("Ambilight").
// Hyperion.ng names them GRABBER (screen) and V4L (USB); HyperHDR names them
// SYSTEMGRABBER and VIDEOGRABBER (read on a real HyperHDR 22).
export const CAPTURE_COMPONENTS = ['GRABBER', 'V4L', 'SYSTEMGRABBER', 'VIDEOGRABBER'];

// The components offered as switches, in this order, when the instance has
// them. ALL is the power of the light; FORWARDER and BOBLIGHTSERVER are
// network plumbing a home automation has no business toggling. The HyperHDR
// components come last: a Hyperion.ng device keeps its features in its order.
export const SWITCHABLE_COMPONENTS = [
  'LEDDEVICE',
  'GRABBER',
  'V4L',
  'AUDIO',
  'SMOOTHING',
  'BLACKBORDER',
  'SYSTEMGRABBER',
  'VIDEOGRABBER',
  'HDR',
];

// The JSON API accepts priorities 1 to 253 for colours and effects (0 is the
// boot effect, 254 the background effect, 255 "off").
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 253;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value.filter(isObject) : []);

/**
 * Which software answers, from its `sysinfo`: Hyperion.ng fills `hyperion`,
 * HyperHDR (a fork with the same JSON API) fills `hyperhdr` instead.
 * @returns {{ product: string, id: string, version: string|null }}
 */
export function serverIdentity(sysinfo) {
  const hdr = isObject(sysinfo?.hyperhdr) && !isObject(sysinfo?.hyperion);
  const block = (hdr ? sysinfo.hyperhdr : sysinfo?.hyperion) ?? {};
  return {
    product: hdr ? 'HyperHDR' : 'Hyperion',
    id: typeof block.id === 'string' ? block.id.toLowerCase() : '',
    version: typeof block.version === 'string' && block.version ? block.version : null,
  };
}

/**
 * Apply a pushed update to the state of an instance.
 * @param {object} info the current state (not modified)
 * @param {object} message a `*-update` message
 * @returns {{ info: object, kind: string|null }} the new state, and what
 *   changed: 'instances', 'effects', 'state', or null when not understood
 */
export function applyUpdate(info, message) {
  const data = message?.data;
  switch (message?.command) {
    case 'components-update': {
      if (!isObject(data) || typeof data.name !== 'string') {
        return { info, kind: null };
      }
      const components = list(info.components);
      const index = components.findIndex((component) => component.name === data.name);
      const next =
        index === -1
          ? [...components, { ...data }]
          : components.map((component, i) => (i === index ? { ...data } : component));
      return { info: { ...info, components: next }, kind: 'state' };
    }
    case 'adjustment-update':
      return Array.isArray(data)
        ? { info: { ...info, adjustment: list(data) }, kind: 'state' }
        : { info, kind: null };
    case 'effects-update':
      return Array.isArray(data)
        ? { info: { ...info, effects: list(data) }, kind: 'effects' }
        : { info, kind: null };
    case 'priorities-update': {
      if (!isObject(data)) {
        return { info, kind: null };
      }
      const next = { ...info };
      if (Array.isArray(data.priorities)) {
        next.priorities = list(data.priorities);
      }
      if (typeof data.priorities_autoselect === 'boolean') {
        next.priorities_autoselect = data.priorities_autoselect;
      }
      return { info: next, kind: 'state' };
    }
    case 'instance-update':
      return Array.isArray(data)
        ? { info: { ...info, instance: list(data) }, kind: 'instances' }
        : { info, kind: null };
    default:
      return { info, kind: null };
  }
}

/**
 * The instances of the server, as listed by any of its instances.
 * @returns {Array<{ instance: number, name: string, running: boolean }>}
 */
export function parseInstances(info) {
  const seen = new Set();
  const instances = [];
  for (const entry of list(info?.instance)) {
    const number = entry.instance;
    if (!Number.isInteger(number) || number < 0 || seen.has(number)) {
      continue;
    }
    seen.add(number);
    const name =
      typeof entry.friendly_name === 'string' && entry.friendly_name.trim()
        ? entry.friendly_name.trim()
        : `Hyperion ${number}`;
    instances.push({ instance: number, name, running: entry.running === true });
  }
  return instances.sort((a, b) => a.instance - b.instance);
}

/** Enabled state of a component: true, false, or null when the instance has none. */
export function componentEnabled(info, name) {
  const component = list(info?.components).find((entry) => entry.name === name);
  return typeof component?.enabled === 'boolean' ? component.enabled : null;
}

/**
 * True for the state of a HyperHDR instance: its serverinfo has the HDR
 * component and a `videomodehdr`, which Hyperion.ng has not.
 */
export function isHyperHDR(info) {
  return componentEnabled(info, 'HDR') !== null || typeof info?.videomodehdr === 'number';
}

/**
 * The switchable components the instance has, in display order. HyperHDR
 * drives LEDDEVICE itself (off when no source is left, on again with the next
 * one, even after the user turned it off): no switch for it there.
 */
export function availableComponents(info) {
  const hdr = isHyperHDR(info);
  return SWITCHABLE_COMPONENTS.filter(
    (name) => componentEnabled(info, name) !== null && !(hdr && name === 'LEDDEVICE'),
  );
}

/**
 * The light is on when the instance processes (ALL) and drives its LEDs
 * (LEDDEVICE), as hyperion-py and the Hyperion interface read it. On HyperHDR,
 * whose LEDDEVICE follows the sources, ALL alone tells it.
 */
export function isOn(info) {
  return (
    componentEnabled(info, 'ALL') === true &&
    (isHyperHDR(info) || componentEnabled(info, 'LEDDEVICE') === true)
  );
}

/**
 * Brightness of the first adjustment, 0-100, or null. Hyperion.ng has a
 * `brightness` (0-100); HyperHDR has none, its interface calls `luminanceGain`
 * (0-10, 1 by default) "Brightness/luminance": read as 100 % from 1 up.
 */
export function brightness(info) {
  const adjustment = list(info?.adjustment)[0];
  const value = adjustment?.brightness;
  if (Number.isFinite(value) && value >= 0 && value <= 100) {
    return Math.round(value);
  }
  const gain = adjustment?.luminanceGain;
  return Number.isFinite(gain) && gain >= 0 ? Math.round(Math.min(1, gain) * 100) : null;
}

/** The adjustment that sets a brightness (1-100) on this server. */
export function brightnessAdjustment(info, level) {
  const adjustment = list(info?.adjustment)[0];
  return adjustment && !('brightness' in adjustment) && 'luminanceGain' in adjustment
    ? { luminanceGain: level / 100 }
    : { brightness: level };
}

/** The adjustment ids to change for a new brightness ([null] when none has an id). */
export function adjustmentIds(info) {
  const ids = list(info?.adjustment)
    .map((entry) => entry.id)
    .filter((id) => typeof id === 'string' && id !== '');
  return ids.length > 0 ? ids : [null];
}

/**
 * The source the LEDs show. The server is supposed to list it first, but some
 * versions do not (hyperion.ng#964): search for the `visible` flag.
 */
export function visiblePriority(info) {
  return list(info?.priorities).find((entry) => entry.visible === true) ?? null;
}

/** The effect names of the server, in its order, without duplicates. */
export function effectNames(info) {
  const names = [];
  for (const effect of list(info?.effects)) {
    const name = typeof effect.name === 'string' ? effect.name.trim() : '';
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/** An effect of the server by name, case and spaces ignored; null if unknown. */
export function findEffect(info, wanted) {
  const key = String(wanted ?? '')
    .trim()
    .toLowerCase();
  if (!key) {
    return null;
  }
  return effectNames(info).find((name) => name.toLowerCase() === key) ?? null;
}

/** RGB of a visible colour priority, or null. */
export function visibleColor(info) {
  const visible = visiblePriority(info);
  const rgb = visible?.componentId === 'COLOR' ? visible.value?.RGB : null;
  return Array.isArray(rgb) && rgb.length >= 3 && rgb.slice(0, 3).every(Number.isFinite)
    ? rgb.slice(0, 3).map((channel) => Math.max(0, Math.min(255, Math.round(channel))))
    : null;
}

/** Name of the visible effect, or null. */
export function visibleEffect(info) {
  const visible = visiblePriority(info);
  return visible?.componentId === 'EFFECT' && typeof visible.owner === 'string' && visible.owner
    ? visible.owner
    : null;
}

/**
 * True when a video capture is what the LEDs show. A capture turned off may
 * linger in the priority list for a moment: its component must be on too.
 */
export function captureVisible(info) {
  const component = visiblePriority(info)?.componentId;
  return CAPTURE_COMPONENTS.includes(component) && componentEnabled(info, component) !== false;
}

/** The video capture components the instance has, and those enabled. */
export function captureComponents(info) {
  const present = CAPTURE_COMPONENTS.filter((name) => componentEnabled(info, name) !== null);
  return {
    present,
    enabled: present.filter((name) => componentEnabled(info, name) === true),
  };
}

/**
 * The colours and effects set through the API (by Gladys, the Hyperion
 * interface, another home automation...): what hides the capture.
 */
export function apiPriorities(info) {
  return list(info?.priorities)
    .filter(
      (entry) =>
        ['COLOR', 'EFFECT'].includes(entry.componentId) &&
        Number.isInteger(entry.priority) &&
        entry.priority >= MIN_PRIORITY &&
        entry.priority <= MAX_PRIORITY,
    )
    .map((entry) => entry.priority);
}

export const rgbToInt = ([r, g, b]) => (r << 16) + (g << 8) + b;

export const intToRgb = (value) => {
  const number = Math.max(0, Math.min(0xffffff, Math.round(Number(value) || 0)));
  return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
};

export const rgbToHex = (rgb) =>
  `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/**
 * Read a colour typed by a user: `#FF8800`, `FF8800`, `#F80` or `255, 136, 0`.
 * @returns {number[]|null} [r, g, b]
 */
export function parseColor(raw) {
  const text = String(raw ?? '').trim();
  const hex = text.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? [...hex[1]].map((digit) => digit + digit).join('')
        : hex[1].toLowerCase();
    return [0, 2, 4].map((start) => parseInt(digits.slice(start, start + 2), 16));
  }
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 3 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const rgb = parts.map(Number);
    return rgb.every((channel) => channel <= 255) ? rgb : null;
  }
  return null;
}
