import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PHRASES, LANGUAGES, t, setLanguage, getLanguage } from '../src/i18n.js';

const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('every phrase has Bemba and Nyanja with the same placeholders', () => {
  for (const [en, tr] of Object.entries(PHRASES)) {
    assert.equal(tr.length, 2, en);
    for (const x of tr) { assert.ok(x && x.trim(), en); assert.equal(holes(x), holes(en), `${en} → ${x}`); }
  }
});

test('every text the screens ask to translate has a translation', () => {
  const missing = [];
  for (const f of readdirSync('src').filter(f => /\.(jsx?|mjs)$/.test(f))) {
    const src = readFileSync('src/' + f, 'utf8');
    for (const m of src.matchAll(/(?<![\w.])(?:t|tr)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      const key = m[2].replace(/\\(['"])/g, '$1');
      if (!(key in PHRASES)) missing.push(`${f}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('menu items a cashier sees are translated', () => {
  for (const k of ['Point of Sale', 'Cashier Checkout', 'Sales History', 'Receipts', 'Cashier Shifts', 'Customers', 'Product Catalog', 'My Profile', 'Getting Started & Help']) assert.ok(PHRASES[k], k);
});

test('switching language and filling in values', () => {
  assert.equal(getLanguage(), 'en');
  assert.equal(t('Complete sale'), 'Complete sale');
  setLanguage('nya');
  assert.equal(t('Complete sale'), 'Malizani kugulitsa');
  assert.equal(t('{n} in stock', { n: 4 }), '4 zilipo');
  setLanguage('bem');
  assert.equal(t('Sale completed.'), 'Ukushitisha kwapwa.');
  assert.equal(t('Something not in the list'), 'Something not in the list');
  setLanguage('xx');
  assert.equal(getLanguage(), 'en');
  assert.deepEqual(LANGUAGES.map(l => l.code), ['en', 'bem', 'nya']);
});
