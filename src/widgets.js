// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `hyperion`.
//
// The Gladys device box already has the switches, the brightness, the colour
// and the effect list. What the widget adds: what the TV light shows right
// now, and one-tap buttons for what people do from the sofa — back to the
// Ambilight, the two effects chosen in the widget settings, on/off.
//
// No button opens a form (forms on widget buttons need Gladys 5.2.0; the
// manifest asks 5.1.0). The active choice is marked by its icon
// (`check-circle`), never by the button style: `primary` is invisible in dark
// mode. Budget: 8 components, 2 texts, 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { FEATURE_KEYS } from './devices.js';
import { WIDGET_TEXT, pick, userError } from './i18n.js';

const ACTIVE_ICON = 'check-circle';
const MAX_EFFECT_BUTTONS = 2;
const EFFECT_ACTION_PREFIX = 'effect_';

const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The device the widget follows: its setting, else the first added device. */
function deviceOf(hub, settings) {
  const chosen = typeof settings?.device === 'string' && settings.device ? settings.device : null;
  return chosen ?? hub.firstCreatedDevice();
}

/** The effects chosen in the settings, as the widget shows them. */
function chosenEffects(settings) {
  const list = Array.isArray(settings?.effects) ? settings.effects : [];
  return [...new Set(list.filter((name) => typeof name === 'string' && name.trim()))].slice(
    0,
    MAX_EFFECT_BUTTONS,
  );
}

/** The widget content, in the language of the dashboard. */
export function widgetContent(hub, { settings, language }) {
  const text = pick(WIDGET_TEXT, language);
  const deviceId = deviceOf(hub, settings);
  const snapshot = deviceId ? hub.snapshot(deviceId, language) : null;
  if (!snapshot) {
    return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text: text.pick }] };
  }
  const components = [{ type: 'text', variant: 'heading', text: short(snapshot.name, 40) }];
  if (hub.isCreated(deviceId)) {
    // A live tile: Gladys follows the published brightness by itself.
    components.push({
      type: 'value',
      label: text.brightness,
      icon: 'sun',
      device_feature: snapshot.featureId(FEATURE_KEYS.BRIGHTNESS),
    });
  }
  components.push({
    type: 'status',
    items: [
      snapshot.reachable
        ? {
            label: text.showing,
            value: short(snapshot.source, 40),
            color: snapshot.on ? 'success' : 'neutral',
          }
        : { label: text.showing, value: short(text.unreachable, 40), color: 'danger' },
    ],
  });
  if (snapshot.reachable) {
    components.push({
      type: 'button',
      label: text.ambilight,
      icon: snapshot.ambilight ? ACTIVE_ICON : 'tv',
      style: 'secondary',
      action: { key: 'ambilight' },
    });
    chosenEffects(settings).forEach((effect, index) => {
      components.push({
        type: 'button',
        label: short(effect, 24),
        icon: snapshot.on && snapshot.effect === effect ? ACTIVE_ICON : 'play',
        style: 'secondary',
        action: { key: `${EFFECT_ACTION_PREFIX}${index + 1}`, params: { effect } },
      });
    });
    components.push({
      type: 'button',
      label: snapshot.on ? text.turnOff : text.turnOn,
      icon: 'power',
      style: 'secondary',
      action: { key: 'power', params: { on: !snapshot.on } },
    });
  }
  return { ttl_seconds: snapshot.reachable ? 60 : 30, components };
}

export const WIDGETS = {
  hyperion: {
    async get(hub, request) {
      return widgetContent(hub, request);
    },

    /** A tap on a button: no toast, Gladys reloads the widget once it resolves. */
    async action(hub, { actionKey, params = {}, settings }) {
      const deviceId = deviceOf(hub, settings);
      if (!deviceId) {
        throw userError(hub.config.language, 'unknownDevice');
      }
      if (actionKey === 'ambilight') {
        await hub.backToAmbilight(deviceId);
      } else if (actionKey === 'power') {
        await hub.setPower(deviceId, params.on === true);
      } else if (actionKey.startsWith(EFFECT_ACTION_PREFIX) && typeof params.effect === 'string') {
        await hub.startEffect(deviceId, { effect: params.effect });
      } else {
        throw userError(hub.config.language, 'refused', `unknown action ${actionKey}`);
      }
      return undefined;
    },
  },
};
