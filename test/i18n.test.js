// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the documentation. German says "du", never the polite "Sie".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchMessage, tokenMessage } from '../src/app.js';
import { LANGUAGES } from '../src/config.js';
import {
  CONNECTION_TEXT,
  ERRORS,
  NAMES,
  SEARCH_TEXT,
  SOURCE_TEXT,
  TOKEN_TEXT,
  WIDGET_TEXT,
} from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 400,
  message: 200,
  short: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
// A function is rendered with sample arguments.
function tableProblems(table, name, max) {
  const render = (value) =>
    typeof value === 'function' ? value('Sample', 'x', '2.0.16', 2) : value;
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  const language = manifest.config_schema.find((field) => field.key === 'language');
  assert.deepEqual(
    language.options.map((option) => option.value),
    LANGS,
  );
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 60, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every message table of the code has the four languages', () => {
  const found = [
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...tableProblems(NAMES, 'NAMES', MAX.featureName),
    ...tableProblems(SOURCE_TEXT, 'SOURCE_TEXT', MAX.short),
    ...tableProblems(ERRORS, 'ERRORS', MAX.message),
    ...tableProblems(SEARCH_TEXT, 'SEARCH_TEXT', MAX.message),
    ...tableProblems(TOKEN_TEXT, 'TOKEN_TEXT', MAX.message),
    ...tableProblems(WIDGET_TEXT, 'WIDGET_TEXT', MAX.message),
  ];
  assert.deepEqual(found, []);
});

test('the reports under the buttons exist in every language', () => {
  const search = searchMessage({
    servers: [
      { name: 'TV', address: '192.0.2.20:19444', version: '2.0.16', instances: 2, reachable: true },
      {
        name: 'Desk',
        address: '192.0.2.21:19444',
        version: '2.1.1',
        instances: 1,
        reachable: false,
      },
    ],
    tokenHosts: ['192.0.2.22:19444'],
    unreachableHosts: ['192.0.2.23:19444'],
    discoveryUnavailable: true,
    invalidHosts: ['300.1.1.1'],
  });
  assert.deepEqual(problems(search, 'searchMessage', 600), []);
  assert.match(search.de, /2 Server, davon 1 erreichbar: TV .* antwortet nicht/);
  assert.match(search.es, /introduzca la dirección IP del servidor/);

  const token = tokenMessage([
    { address: '192.0.2.20:19444', outcome: 'granted' },
    { address: '192.0.2.21:19444', outcome: 'denied' },
    { address: '192.0.2.22:19444', outcome: 'failed' },
  ]);
  assert.deepEqual(problems(token, 'tokenMessage', 400), []);
  assert.deepEqual(problems(tokenMessage([]), 'tokenMessage', 200), []);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihren', 'Ihrer']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[1].fields[1].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[1].fields[1].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

/** The outline of a document: the level of each heading, in order. */
const outline = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,4} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentations have the same sections', () => {
  const reference = outline(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 8, 'the documentation sections');
  for (const lang of LANGS) {
    assert.deepEqual(outline(docs[lang]), reference, `docs/${lang}.md`);
    assert.ok(docs[lang].length >= 3000, `docs/${lang}.md is too short`);
  }
});

test('the documentation says how it was tested (no LEDs), and is not affiliated', () => {
  const said = {
    en: [
      /Tested against real servers, without LEDs: feedback welcome/,
      /not affiliated with the Hyperion or HyperHDR projects/,
    ],
    fr: [
      /Testée sur de vrais serveurs, sans LED : vos retours sont les\s+> bienvenus/,
      /n'est affiliée ni au projet Hyperion ni au projet HyperHDR/,
    ],
    de: [
      /Mit echten Servern getestet, ohne LEDs: Rückmeldungen sind\s+> willkommen/,
      /steht in keiner Verbindung zu den Projekten Hyperion und\s+HyperHDR/,
    ],
    es: [
      /Probada con servidores reales, sin LED: sus comentarios son\s+> bienvenidos/,
      /no está afiliada a los proyectos Hyperion ni HyperHDR/,
    ],
  };
  for (const lang of LANGS) {
    for (const pattern of said[lang]) {
      assert.match(docs[lang], pattern, `docs/${lang}.md`);
    }
  }
});

test('the German documentation says "du"', () => {
  const lines = docs.de.split('\n').filter((line) => POLITE_GERMAN.test(line));
  assert.deepEqual(lines, []);
});
