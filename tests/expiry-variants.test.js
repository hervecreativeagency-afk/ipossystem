import test from 'node:test';
import assert from 'node:assert/strict';
import { daysLeft, expiryStatus, expiryText, groupBatches, undatedStock } from '../src/expiry-utils.js';
import { splitValues, combinations, variantName, variantSku, groupForGrid } from '../src/variant-utils.js';

const today = '2026-10-16';

test('days left and status bands', () => {
  assert.equal(daysLeft('2026-10-16', today), 0);
  assert.equal(daysLeft('2026-10-15', today), -1);
  assert.equal(expiryStatus('2026-10-10', today), 'expired');
  assert.equal(expiryStatus('2026-10-23', today), 'week');
  assert.equal(expiryStatus('2026-11-15', today), 'month');
  assert.equal(expiryStatus('2027-01-01', today), 'later');
});

test('plain-language expiry text', () => {
  assert.equal(expiryText('2026-10-16', today), 'Expires today');
  assert.equal(expiryText('2026-10-17', today), 'Expires tomorrow');
  assert.equal(expiryText('2026-10-15', today), 'Expired yesterday');
  assert.equal(expiryText('2026-10-06', today), 'Expired 10 days ago');
  assert.equal(expiryText('2026-10-26', today), '10 days left');
});

test('batches grouped soonest first, empty batches ignored', () => {
  const g = groupBatches([
    { id: 1, expiry_date: '2026-10-20', quantity: 3 }, { id: 2, expiry_date: '2026-10-18', quantity: 1 },
    { id: 3, expiry_date: '2026-10-01', quantity: 2 }, { id: 4, expiry_date: '2026-10-02', quantity: 0 }, { id: 5, expiry_date: '2027-05-01', quantity: 9 },
  ], today);
  assert.deepEqual(g.expired.map(b => b.id), [3]);
  assert.deepEqual(g.week.map(b => b.id), [2, 1]);
  assert.deepEqual(g.later.map(b => b.id), [5]);
});

test('stock without a date', () => {
  assert.equal(undatedStock(10, [{ quantity: 3 }, { quantity: 2 }]), 5);
  assert.equal(undatedStock(2, [{ quantity: 3 }]), 0);
});

test('option values become every combination', () => {
  assert.deepEqual(splitValues(' Red, Blue ,Red,\nBlack '), ['Red', 'Blue', 'Black']);
  assert.deepEqual(combinations([['Red', 'Blue'], ['S', 'M']]), ['Red / S', 'Red / M', 'Blue / S', 'Blue / M']);
  assert.deepEqual(combinations([[], ['S', 'M']]), ['S', 'M']);
  assert.deepEqual(combinations([[], []]), []);
});

test('variant names and SKUs', () => {
  assert.equal(variantName(' Polo shirt ', 'Red / L'), 'Polo shirt – Red / L');
  assert.equal(variantSku('polo', 'Red / Extra large'), 'POLO-RED-EXTRA-LARGE');
  assert.equal(variantSku('', '500 ml'), '500-ML');
});

test('checkout grid shows one card per product with variants', () => {
  const items = groupForGrid([
    { id: 'a', name: 'Bread', stock_quantity: 4, selling_price: 25 },
    { id: 'b', name: 'Polo – Red / M', variant_group_id: 'g', variant_base: 'Polo', variant_label: 'Red / M', stock_quantity: 3, selling_price: 120 },
    { id: 'c', name: 'Polo – Red / L', variant_group_id: 'g', variant_base: 'Polo', variant_label: 'Red / L', stock_quantity: 0, selling_price: 130, image_url: 'x.png' },
  ]);
  assert.equal(items.length, 2);
  const g = items[1];
  assert.deepEqual([g.type, g.name, g.variants.map(v => v.id), g.minPrice, g.maxPrice, g.stock, g.image], ['group', 'Polo', ['c', 'b'], 120, 130, 3, 'x.png']);
});
