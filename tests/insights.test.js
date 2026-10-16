import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySeries, topProducts, paymentMix, lowStock, changeVsPrevious } from '../src/insights.js';

test('daily series groups by Lusaka day and fills empty days', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  const s = dailySeries([
    { created_at: '2026-10-14T08:00:00Z', total: 10.1 },
    { created_at: '2026-10-14T21:30:00Z', total: 5 },      // 23:30 Lusaka, still the 14th
    { created_at: '2026-10-13T22:30:00Z', total: 2.2 },   // 00:30 Lusaka on the 14th
    { created_at: '2026-10-12T09:00:00Z', total: 7 },
    { created_at: '2026-09-01T09:00:00Z', total: 99 },
  ], 7, now);
  assert.equal(s.length, 7);
  assert.equal(s[6].day, '2026-10-14');
  assert.equal(s[6].total, 17.3);
  assert.equal(s[6].count, 3);
  assert.equal(s[4].total, 7);
  assert.equal(s[0].day, '2026-10-08');
});

test('top products rank by revenue', () => {
  const t = topProducts([
    { product_id: 'a', product_name: 'Bread', quantity: 10, unit_price: 1 },
    { product_id: 'b', product_name: 'Oil', quantity: 1, unit_price: 50 },
    { product_id: 'a', product_name: 'Bread', quantity: 5, unit_price: 1 },
  ]);
  assert.deepEqual(t.map(x => [x.name, x.quantity, x.revenue]), [['Oil', 1, 50], ['Bread', 15, 15]]);
});

test('payment mix totals and shares', () => {
  const m = paymentMix([{ method: 'Cash', amount: 30 }, { method: 'MTN Money', amount: 10 }]);
  assert.equal(m.find(x => x.method === 'Cash').share, 0.75);
  assert.equal(m.find(x => x.method === 'Airtel Money').amount, 0);
});

test('low stock sorts the emptiest first', () => {
  const l = lowStock([{ id: 1, stock_quantity: 3, low_stock_threshold: 5 }, { id: 2, stock_quantity: 0, low_stock_threshold: 2 }, { id: 3, stock_quantity: 9, low_stock_threshold: 2 }]);
  assert.deepEqual(l.map(p => p.id), [2, 1]);
});

test('change vs previous daily average', () => {
  assert.equal(changeVsPrevious([{ total: 10 }, { total: 10 }, { total: 10 }, { total: 15 }]), 0.5);
  assert.equal(changeVsPrevious([{ total: 0 }, { total: 0 }, { total: 10 }, { total: 60 }]), null);
  assert.equal(changeVsPrevious([{ total: 0 }, { total: 5 }]), null);
});

test('payment mix counts cash kept after change, not cash handed over', () => {
  const m = paymentMix(
    [{ method: 'Cash', amount: 100000 }, { method: 'Cash', amount: 10 }, { method: 'MTN Money', amount: 20 }],
    [{ total: 52500, change: 47500 }, { total: 30, change: 0 }],
  );
  assert.equal(m.find(x => x.method === 'Cash').amount, 52510);
  assert.equal(m.find(x => x.method === 'MTN Money').amount, 20);
  assert.equal(m.reduce((n, x) => n + x.amount, 0), 52530);
});
