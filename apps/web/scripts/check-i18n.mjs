// Every language has the same keys, and each text has the same {placeholders}
// and <tags> as its Dutch original. Runs before the build, so a sentence that
// was only written in Dutch stops the release instead of reaching a phone.
//
//   node scripts/check-i18n.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../src/i18n/locales');
const BASE = 'nl';

function load(lang) {
  const out = new Map();
  for (const file of readdirSync(join(root, lang)).filter((f) => f.endsWith('.json')).sort()) {
    const area = file.replace(/\.json$/, '');
    const data = JSON.parse(readFileSync(join(root, lang, file), 'utf8'));
    for (const [key, text] of Object.entries(data)) {
      out.set(key, { text, file: `${lang}/${file}`, area });
    }
  }
  return out;
}

const marks = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1]).sort().join(',');
const placeholders = (text) => marks(text, /\{(\w+)\}/g);
const tags = (text) => marks(text, /<(\w+)>/g);

const problems = [];
const languages = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const base = load(BASE);

for (const [key, { text, file, area }] of base) {
  if (typeof text !== 'string' || text.trim() === '') problems.push(`${file}: "${key}" is empty`);
  if (!key.startsWith(`${area}.`)) problems.push(`${file}: "${key}" belongs in ${key.split('.')[0]}.json`);
  if (key.endsWith('_one') && !base.has(key.replace(/_one$/, '_other'))) {
    problems.push(`${file}: "${key}" has no _other form`);
  }
}

for (const lang of languages.filter((l) => l !== BASE)) {
  const other = load(lang);
  for (const [key, { text }] of base) {
    const found = other.get(key);
    if (!found) {
      problems.push(`${lang}: missing "${key}"`);
      continue;
    }
    if (typeof found.text !== 'string' || found.text.trim() === '') {
      problems.push(`${found.file}: "${key}" is empty`);
      continue;
    }
    if (placeholders(found.text) !== placeholders(text)) {
      problems.push(`${found.file}: "${key}" has {${placeholders(found.text)}}, Dutch has {${placeholders(text)}}`);
    }
    if (tags(found.text) !== tags(text)) {
      problems.push(`${found.file}: "${key}" has <${tags(found.text)}>, Dutch has <${tags(text)}>`);
    }
  }
  for (const [key, { file }] of other) {
    if (!base.has(key)) problems.push(`${file}: "${key}" is not in ${BASE}`);
  }
}

if (problems.length) {
  console.error(`i18n: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n: ${base.size} texts, ${languages.length} languages, all in step`);
