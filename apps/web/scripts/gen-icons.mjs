import { readFileSync, writeFileSync } from 'node:fs';

// Our icon names → the official Material Symbols glyph that means the same
// thing. Where classic drew two variants of one idea (gear/settings are both
// cogs), both map to the same symbol.
const MAP = {
  'arrow-left': 'arrow_back', 'chevron-left': 'chevron_left',
  'chevron-right': 'chevron_right', 'chevron-down': 'keyboard_arrow_down',
  plus: 'add', minus: 'remove', download: 'download', close: 'close',
  gear: 'settings', plane: 'flight', car: 'directions_car', train: 'train',
  bus: 'directions_bus', boat: 'directions_boat', walk: 'directions_walk',
  pencil: 'edit', compass: 'explore', distance: 'straighten', globe: 'public',
  check: 'check', dots: 'more_horiz', pin: 'location_on', trash: 'delete',
  archive: 'archive', camera: 'photo_camera', lock: 'lock', play: 'play_arrow',
  stop: 'stop', external: 'open_in_new', share: 'share', people: 'group',
  person: 'person', bell: 'notifications', shield: 'shield', help: 'help',
  question: 'question_mark', search: 'search', bolt: 'bolt', sun: 'light_mode',
  moon: 'dark_mode', monitor: 'computer', settings: 'settings',
  hourglass: 'hourglass_empty', 'cloud-off': 'cloud_off',
};

const DIR = 'node_modules/@material-symbols/svg-400/rounded';
const out = [];
const missing = [];
for (const [name, symbol] of Object.entries(MAP)) {
  let svg;
  try { svg = readFileSync(`${DIR}/${symbol}.svg`, 'utf8'); }
  catch { missing.push(`${name} -> ${symbol}`); continue; }
  const ds = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) { missing.push(`${name}: no path`); continue; }
  const key = /^[a-z]+$/.test(name) ? name : `'${name}'`;
  const body = ds.length === 1
    ? `<path d="${ds[0]}" />`
    : `<>\n${ds.map((d) => `      <path d="${d}" />`).join('\n')}\n    </>`;
  out.push(`  ${key}: ${body},`);
}
if (missing.length) { console.error('MISSING:', missing); process.exit(1); }
writeFileSync('/tmp/material-paths.txt', out.join('\n'));
console.log(`ok: ${out.length} icons`);
