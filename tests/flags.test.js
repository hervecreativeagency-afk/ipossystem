import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFlags, summarize } from '../src/flag-utils.js';

const fmt = n => 'K' + n.toFixed(2);
const at = (d, h = 10, m = 0) => `2026-10-${String(d).padStart(2, '0')}T${String(h - 2).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`; // Lusaka time → UTC
const sale = (id, extra = {}) => ({ id, cashier_id: 'u1', cashier_name: 'Mary', receipt_number: 'R-' + id, created_at: at(10), subtotal: 100, tax: 0, discount: 0, total: 100, ...extra });
const types = flags => flags.map(f => f.type).sort();

test('drawer short, serious short, over, and repeated shortages', () => {
  const shifts = [
    { id: 'a', cashier_id: 'u1', cashier_name: 'Mary', status: 'closed', closed_at: at(10, 18), counted_cash: 480, expected_cash: 500, variance: -20 },
    { id: 'b', cashier_id: 'u1', cashier_name: 'Mary', status: 'closed', closed_at: at(11, 18), counted_cash: 350, expected_cash: 500, variance: -150 },
    { id: 'c', cashier_id: 'u2', cashier_name: 'John', status: 'closed', closed_at: at(11, 18), counted_cash: 560, expected_cash: 500, variance: 60 },
    { id: 'd', cashier_id: 'u2', cashier_name: 'John', status: 'closed', closed_at: at(12, 18), counted_cash: 498, expected_cash: 500, variance: -2 },
    { id: 'e', cashier_id: 'u3', status: 'open', variance: null },
  ];
  const f = computeFlags({ shifts }, fmt);
  assert.deepEqual(types(f), ['over', 'repeat-short', 'short', 'short']);
  assert.equal(f.find(x => x.key === 'short:b').severity, 'high');
  assert.equal(f.find(x => x.key === 'short:a').title, 'Drawer short by K20.00');
  assert.match(f.find(x => x.type === 'repeat-short').detail, /short on 2 shifts, K170.00 in total/);
});

test('refunds soon after, long after, and many on one cashier', () => {
  const sales = [sale('s1', { created_at: at(10, 9) }), sale('s2'), sale('s3'), sale('s4')];
  const refundSales = [sale('old', { created_at: '2026-08-01T08:00:00Z' })];
  const refunds = [
    { id: 'r1', sale_id: 's1', created_at: at(10, 9, 6), total: 40, reason: 'Wrong item', approved_name: 'Sup' },
    { id: 'r2', sale_id: 's2', created_at: at(12), total: 30 },
    { id: 'r3', sale_id: 's3', created_at: at(12), total: 30 },
    { id: 'r4', sale_id: 'old', created_at: at(13), total: 50 },
  ];
  const f = computeFlags({ sales, refundSales, refunds }, fmt);
  assert.equal(f.find(x => x.type === 'quick-refund').title, 'Refund 6 min after the sale');
  assert.match(f.find(x => x.type === 'late-refund').title, /days after the sale/);
  const many = f.find(x => x.type === 'many-refunds');
  assert.ok(many, 'many refunds flagged');
  assert.match(many.detail, /K150.00 refunded — 38% of Mary's sales/); // older sale not counted as this period's sales (150/400)
});

test('discounts, low prices and late-night sales', () => {
  const products = [{ id: 'p1', name: 'Rice 5kg', selling_price: 100 }];
  const sales = [
    sale('d1', { subtotal: 200, discount: 50, total: 150 }),
    sale('d2', { subtotal: 200, discount: 120, total: 80 }),
    sale('d3', { subtotal: 200, discount: 10, total: 190 }),
    sale('lp', { subtotal: 60, total: 60 }),
    sale('nt', { created_at: at(10, 23, 30) }),
  ];
  const items = [{ sale_id: 'lp', product_id: 'p1', product_name: 'Rice 5kg', quantity: 1, unit_price: 60 }, { sale_id: 'd3', product_id: 'p1', quantity: 2, unit_price: 95 }];
  const f = computeFlags({ sales, items, products }, fmt);
  assert.deepEqual(types(f), ['discount', 'discount', 'low-price', 'night']);
  assert.equal(f.find(x => x.key === 'discount:d1').severity, 'medium');
  assert.equal(f.find(x => x.key === 'discount:d2').severity, 'high');
  assert.equal(f.find(x => x.type === 'low-price').amount, 40);
  assert.match(f.find(x => x.type === 'night').detail, /between 23:00 and 00:00/);
});

test('stock going missing and big cash withdrawals', () => {
  const products = [{ id: 'p1', name: 'Cooking oil', selling_price: 50 }];
  const adjustments = [
    { id: 'a1', product_id: 'p1', created_by: 'u1', created_at: at(10), quantity: -2, reason: 'Missing stock' },
    { id: 'a2', product_id: 'p1', created_by: 'u1', created_at: at(11), quantity: -1, reason: 'Damaged goods' },
    { id: 'a3', product_id: 'p1', created_by: 'u2', created_at: at(12), quantity: -25, reason: 'Stock count correction' },
    { id: 'a4', product_id: 'p1', created_by: 'u2', created_at: at(12), quantity: 30, reason: 'Missing stock' },
    { id: 'a5', product_id: 'p1', created_by: 'u1', created_at: at(13), quantity: -1, reason: 'Wastage' },
  ];
  const cashEvents = [{ id: 'c1', shift_id: 'x', type: 'out', amount: 800, created_at: at(10), created_by: 'u1' }, { id: 'c2', type: 'out', amount: 100, created_at: at(10) }, { id: 'c3', type: 'in', amount: 900, created_at: at(10) }];
  const staff = [{ user_id: 'u1', full_name: 'Mary Banda' }];
  const f = computeFlags({ adjustments, products, cashEvents, staff }, fmt);
  assert.deepEqual(types(f), ['big-loss', 'cash-out', 'repeat-loss']);
  assert.match(f.find(x => x.type === 'repeat-loss').detail, /3 adjustments .* removed 4 units/);
  assert.equal(f.find(x => x.type === 'cash-out').who, 'Mary Banda');
});

test('flag keys are stable and reviews sort them into groups', () => {
  const shifts = [{ id: 'a', cashier_id: 'u1', status: 'closed', closed_at: at(10), variance: -20 }, { id: 'b', cashier_id: 'u2', status: 'closed', closed_at: at(11), variance: -200 }, { id: 'c', cashier_id: 'u3', status: 'closed', closed_at: at(12), variance: -9 }];
  const f1 = computeFlags({ shifts }, fmt), f2 = computeFlags({ shifts }, fmt);
  assert.deepEqual(f1.map(f => f.key), f2.map(f => f.key));
  const s = summarize(f1, { 'short:a': { status: 'ok' }, 'short:c': { status: 'investigating' } });
  assert.deepEqual([s.open.map(f => f.key), s.looking.map(f => f.key), s.fine.map(f => f.key), s.high], [['short:b'], ['short:c'], ['short:a'], 1]);
  assert.equal(summarize(f1, { 'short:a': { status: 'open' } }).open.length, 3);
});

test('a clean period has no flags', () => {
  assert.deepEqual(computeFlags({ sales: [sale('x')], shifts: [{ id: 'z', status: 'closed', variance: 0, closed_at: at(10) }] }, fmt), []);
});
