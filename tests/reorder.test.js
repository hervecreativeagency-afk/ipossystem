import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReorderList, groupBySupplier, purchaseItems, poNumber, purchaseOrderText } from '../src/reorder-utils.js';

const products = [
  { id: 'milk', name: 'Milk', sku: 'MLK', stock_quantity: 2, low_stock_threshold: 5, unit_cost: 9 },
  { id: 'bread', name: 'Bread', sku: 'BRD', stock_quantity: 0, low_stock_threshold: 3, unit_cost: '' },
  { id: 'sugar', name: 'Sugar', sku: 'SUG', stock_quantity: 20, low_stock_threshold: 4, unit_cost: 30 },   // sells fast
  { id: 'salt', name: 'Salt', sku: 'SLT', stock_quantity: 50, low_stock_threshold: 5, unit_cost: 5 },     // fine
  { id: 'oil', name: 'Oil', sku: 'OIL', stock_quantity: 1, low_stock_threshold: 2, unit_cost: 50 },      // already on order
];
const saleItems = [
  { product_id: 'milk', quantity: 60 },   // 2 a day
  { product_id: 'sugar', quantity: 90 },  // 3 a day -> ~6.7 days left
  { product_id: 'salt', quantity: 30 },
];
const orders = [
  { id: 'o1', supplier_id: 'sup-a', status: 'received', created_at: '2026-09-01T10:00:00Z', items: [{ product_id: 'milk', quantity: 50, unit_price: 8.5 }] },
  { id: 'o2', supplier_id: 'sup-b', status: 'received', created_at: '2026-10-01T10:00:00Z', items: [{ product_id: 'milk', quantity: 50, unit_price: 9.25 }] },
  { id: 'o3', supplier_id: 'sup-a', status: 'ordered', created_at: '2026-10-10T10:00:00Z', items: [{ product_id: 'oil', quantity: 10, unit_price: 48 }] },
  { id: 'o4', supplier_id: 'sup-c', status: 'cancelled', created_at: '2026-10-12T10:00:00Z', items: [{ product_id: 'bread', quantity: 10, unit_price: 7 }] },
];

test('lists low, out-of-stock and running-out-soon products, emptiest first', () => {
  const rows = buildReorderList({ products, saleItems, orders });
  assert.deepEqual(rows.map(r => [r.product_id, r.reason]), [['bread', 'out'], ['milk', 'low'], ['oil', 'low'], ['sugar', 'soon']]);
});

test('suggests enough for two weeks of sales plus the low-stock level', () => {
  const r = Object.fromEntries(buildReorderList({ products, saleItems, orders }).map(x => [x.product_id, x]));
  assert.equal(r.milk.suggested, 28 + 5 - 2);       // 2/day * 14 + 5 - 2
  assert.equal(r.sugar.suggested, 42 + 4 - 20);     // 3/day * 14 + 4 - 20
  assert.equal(r.bread.suggested, 6);               // no sales: double the low-stock level
  assert.equal(Math.round(r.sugar.daysLeft * 10) / 10, 6.7);
});

test('subtracts what is already on order and ignores cancelled orders', () => {
  const r = Object.fromEntries(buildReorderList({ products, saleItems, orders }).map(x => [x.product_id, x]));
  assert.equal(r.oil.onOrder, 10);
  assert.equal(r.oil.suggested, 0);
  assert.equal(r.bread.supplier_id, '', 'cancelled order does not set a supplier');
});

test('uses the supplier and cost from the latest purchase, else the product cost', () => {
  const r = Object.fromEntries(buildReorderList({ products, saleItems, orders }).map(x => [x.product_id, x]));
  assert.equal(r.milk.supplier_id, 'sup-b');
  assert.equal(r.milk.unit_cost, 9.25);
  assert.equal(r.sugar.unit_cost, 30);
  assert.equal(r.bread.unit_cost, null);
});

test('longer cover period suggests more', () => {
  const r = buildReorderList({ products, saleItems, orders, coverDays: 30 }).find(x => x.product_id === 'milk');
  assert.equal(r.suggested, 60 + 5 - 2);
});

test('groups by supplier with unassigned last, and validates lines', () => {
  const g = groupBySupplier([{ supplier_id: '' }, { supplier_id: 'a' }, { supplier_id: 'a' }]);
  assert.deepEqual(g.map(x => [x.supplier_id, x.items.length]), [['a', 2], ['', 1]]);
  assert.deepEqual(purchaseItems([{ product_id: 'p', name: 'P', quantity: '3', unit_cost: '9.999' }]), [{ product_id: 'p', quantity: 3, unit_cost: 10 }]);
  assert.throws(() => purchaseItems([{ product_id: 'p', name: 'P', quantity: 0, unit_cost: 1 }]), /whole quantity/);
  assert.throws(() => purchaseItems([{ product_id: 'p', name: 'P', quantity: 2, unit_cost: '' }]), /unit cost/);
  assert.throws(() => purchaseItems([]), /Tick at least one/);
});

test('purchase order number and supplier message', () => {
  assert.equal(poNumber('ab12-cd34'), 'PO-AB12CD34');
  const money = (n, c) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c }).format(n);
  const t = purchaseOrderText({ number: 'PO-AB12', company: { name: 'Kabwe Mini Mart', phone: '0977 000 111' }, supplier: { name: 'Zambeef', contact_name: 'Mr Banda' }, lines: [{ name: 'Milk', sku: 'MLK', quantity: 31, unit_cost: 9.25 }], money, currency: 'ZMW', date: new Date('2026-10-16T09:00:00Z') });
  for (const part of ['*Purchase order PO-AB12*', 'From: Kabwe Mini Mart (0977 000 111)', 'To: Mr Banda', '16 Oct 2026', '• 31 x Milk (MLK) @ ', '*Total: ']) assert.ok(t.includes(part), part + '\n' + t);
  assert.ok(t.includes('286.75'));
});
