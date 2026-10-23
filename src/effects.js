// -----------------------------------------------------------------------------
// The effects Hyperion.ng ships with, by their exact names, plus "Rainbow
// waves", HyperHDR's own (HyperHDR 22 lacks 14 of the others, and adds music
// effects that need its audio capture). They fill the
// static lists of the manifest (the scene action and the widget settings
// cannot read the server): a scene can still name any other effect, its own
// included, in the free text field. Names as listed by the `serverinfo` of a
// stock server (test/fixtures/hyperion/serverinfo-2.0.0-alpha.8.json); the
// test suite checks the manifest against this list.
// -----------------------------------------------------------------------------

export const BUILTIN_EFFECTS = [
  'Atomic swirl',
  'Blue mood blobs',
  'Breath',
  'Candle',
  'Cinema brighten lights',
  'Cinema dim lights',
  'Cold mood blobs',
  'Collision',
  'Color traces',
  'Double swirl',
  'Fire',
  'Flags Germany/Sweden',
  'Full color mood blobs',
  'Green mood blobs',
  'Knight rider',
  'Led Test',
  'Light clock',
  'Lights',
  'Notify blue',
  'Pac-Man',
  'Plasma',
  'Police Lights Single',
  'Police Lights Solid',
  'Rainbow mood',
  'Rainbow swirl',
  'Rainbow swirl fast',
  'Rainbow waves',
  'Random',
  'Red mood blobs',
  'Sea waves',
  'Snake',
  'Sparks',
  'Strobe red',
  'Strobe white',
  'System Shutdown',
  'Trails',
  'Trails color',
  'Warm mood blobs',
  'Waves with Color',
  'X-Mas',
];
