import test from 'node:test';
import assert from 'node:assert/strict';
import { forecast, runOutSentence, adviceLine, runningOut, addDays } from '../src/forecast-utils.js';

const today = '2026-10-16';
const at = day => day + 'T08:00:00Z';
function history(perDayByProduct, days = 30, recentBoost = {}) {
  const sales = [], items = []; let n = 0;
  for (let d = days - 1; d >= 0; d--) {
    const day = addDays(today, -d), id = 's' + (++n);
    sales.push({ id, created_at: at(day) });
    for (const [pid, q] of Object.entries(perDayByProduct)) items.push({ sale_id: id, product_id: pid, quantity: d < 7 && recentBoost[pid] ? recentBoost[pid] : q });
  }
  return { sales, items };
}
const products = [
  { id: 'sugar', name: 'Sugar 2kg', stock_quantity: 20, low_stock_threshold: 5 },
  { id: 'bread', name: 'White bread', stock_quantity: 0, low_stock_threshold: 5 },
  { id: 'rice', name: 'Rice 5kg', stock_quantity: 300, low_stock_threshold: 3 },
  { id: 'soap', name: 'Soap', stock_quantity: 10, low_stock_threshold: 2 },
];

test('steady seller: days left, run-out day, order-by day, suggested quantity', () => {
  const { sales, items } = history({ sugar: 5, bread: 10, rice: 2 });
  const rows = forecast({ products, sales, items, today });
  const sugar = rows.find(r => r.product_id === 'sugar');
  assert.equal(sugar.perDay, 5);
  assert.equal(sugar.daysLeft, 4);
  assert.equal(sugar.runOut, '2026-10-20');
  assert.equal(sugar.orderBy, '2026-10-18');
  assert.equal(sugar.suggested, 5 * 14 + 5 - 20);
  assert.equal(sugar.status, 'soon');
  assert.equal(runOutSentence(sugar), "You'll run out of Sugar 2kg in about 4 days (Tue 20 Oct).");
  assert.equal(adviceLine(sugar, today), 'Order 55 by Sun 18 Oct · sells ~5/day');
  assert.deepEqual(rows.map(r => r.product_id), ['bread', 'sugar', 'rice']); // soap never sold: no forecast
  assert.equal(runOutSentence(rows[0]), 'White bread is out of stock — it sells about 10 a day.');
  assert.deepEqual(runningOut(rows).map(r => r.product_id), ['bread', 'sugar']);
});

test('recent days count more, and a speed-up is called out', () => {
  const { sales, items } = history({ sugar: 2 }, 30, { sugar: 6 });
  const s = forecast({ products, sales, items, today })[0];
  // long = (23*2 + 7*6)/30 = 2.933…, short = 6 → 0.6*6 + 0.4*2.933 = 4.77
  assert.ok(Math.abs(s.perDay - 4.773) < 0.01, String(s.perDay));
  assert.equal(s.trend, 'faster');
  assert.match(adviceLine(s, today), /selling faster this week/);
});

test('stock already on order lowers the suggestion; order now when it is too late', () => {
  const { sales, items } = history({ sugar: 10 });
  const s = forecast({ products, sales, items, today, onOrder: new Map([['sugar', 50]]) })[0];
  assert.equal(s.daysLeft, 2);
  assert.equal(s.status, 'urgent');
  assert.equal(s.suggested, 10 * 14 + 5 - 20 - 50);
  assert.equal(adviceLine(s, today), '50 already on order · Order 75 now · sells ~10/day');
});

test('a shop with only a few days of sales uses the days it has traded', () => {
  const { sales, items } = history({ sugar: 4 }, 3);
  const s = forecast({ products, sales, items, today, days: 30 })[0];
  assert.equal(s.perDay, 4);
  assert.equal(s.trend, 'steady');
});

test('short wording for today and tomorrow', () => {
  assert.equal(runOutSentence({ name: 'Milk', stock: 2, daysLeft: 0.4, perDay: 5 }), "You'll run out of Milk today at the current pace.");
  assert.equal(runOutSentence({ name: 'Milk', stock: 6, daysLeft: 1.2, perDay: 5 }), "You'll run out of Milk tomorrow.");
});
