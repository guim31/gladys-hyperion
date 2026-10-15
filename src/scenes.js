// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// On, brightness and colour are already Gladys scene actions on the light
// features. These three reach what only Hyperion does: an effect or a colour
// for a given time (the server removes it by itself, and the picture comes
// back), and the return to the Ambilight, whatever another application set.
// No scene trigger is fired as a consequence of these actions.
// -----------------------------------------------------------------------------

import { parseColor } from './hyperion/model.js';
import { userError } from './i18n.js';

export const SCENE_ACTIONS = {
  async start_effect(hub, { fields }) {
    const custom = typeof fields.custom_effect === 'string' ? fields.custom_effect.trim() : '';
    const effect = custom || (typeof fields.effect === 'string' ? fields.effect.trim() : '');
    if (!effect) {
      throw userError(hub.config.language, 'noEffect');
    }
    const name = await hub.startEffect(fields.device, {
      effect,
      durationMinutes: fields.duration,
    });
    return { effect_name: name };
  },

  async show_color(hub, { fields }) {
    const rgb = parseColor(fields.color);
    if (!rgb) {
      throw userError(hub.config.language, 'badColor', String(fields.color ?? '').slice(0, 40));
    }
    const color = await hub.showColorFor(fields.device, { rgb, durationMinutes: fields.duration });
    return { color };
  },

  async restore_ambilight(hub, { fields }) {
    await hub.backToAmbilight(fields.device);
    return undefined;
  },
};
