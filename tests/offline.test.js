import test from 'node:test';
import assert from 'node:assert/strict';
import * as offline from '../src/offline.js';

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const milk = { id: 'p1', name: 'Milk', sku: 'M1', selling_price: 12.5, tax_rate: 16, stock_quantity: 5, quantity: 2 };
const sale = (requestId, extra = {}) => offline.buildOfflineSale({ uid: 'u1', companyId: 'c1', currency: 'ZMW', cashierName: 'Ann', cart: [milk], discount: 5, payments: [{ method: 'Cash', amount: 30 }], customer: null, requestId, now: new Date('2026-10-14T10:00:00Z'), ...extra });

test('offline sale keeps exact totals and change', () => {
  offline.useStorage(mem());
  const e = sale('r-1');
  assert.deepEqual(e.totals, { subtotal: 25, discount: 5, tax: 3.2, total: 23.2, paid: 30, change: 6.8 });
  const r = offline.provisionalReceipt(e);
  assert.equal(r.offline, true);
  assert.match(r.receipt_number, /^OFFLINE-/);
  assert.equal(r.items[0].product_name, 'Milk');
});

test('queue is per user and enqueue is idempotent by request ID', () => {
  offline.useStorage(mem());
  offline.enqueue(sale('r-1'));
  offline.enqueue(sale('r-1'));
  offline.enqueue(sale('r-2'));
  assert.equal(offline.loadQueue('u1').length, 2);
  assert.equal(offline.loadQueue('u2').length, 0);
  assert.equal(offline.pendingFor('u1', 'other').length, 0);
});

test('pending sales are subtracted from displayed stock', () => {
  offline.useStorage(mem());
  offline.enqueue(sale('r-1'));
  const shown = offline.applyPendingStock([{ id: 'p1', stock_quantity: 5 }, { id: 'p2', stock_quantity: 3 }], offline.loadQueue('u1'), 'c1');
  assert.equal(shown[0].stock_quantity, 3);
  assert.equal(shown[1].stock_quantity, 3);
  assert.equal(offline.applyPendingStock([{ id: 'p1', stock_quantity: 5 }], offline.loadQueue('u1'), 'c2')[0].stock_quantity, 5);
});

test('sync sends each sale with its original request ID and clears it', async () => {
  offline.useStorage(mem());
  offline.enqueue(sale('r-1')); offline.enqueue(sale('r-2'));
  const sent = [];
  const r = await offline.syncQueue('u1', async args => { sent.push(args.requestId); return 'sale-id'; });
  assert.deepEqual(sent, ['r-1', 'r-2']);
  assert.deepEqual(r, { synced: 2, failed: 0 });
  assert.equal(offline.loadQueue('u1').length, 0);
});

test('network errors stop sync and keep the sale; server rejections mark it failed', async () => {
  offline.useStorage(mem());
  offline.enqueue(sale('r-1')); offline.enqueue(sale('r-2'));
  let r = await offline.syncQueue('u1', async () => { throw new TypeError('Failed to fetch'); });
  assert.deepEqual(r, { synced: 0, failed: 0 });
  assert.equal(offline.loadQueue('u1').filter(e => e.status === 'pending').length, 2);
  offline.markOnline();
  r = await offline.syncQueue('u1', async a => { if (a.requestId === 'r-1') throw new Error('Insufficient stock for Milk'); return 'ok'; });
  assert.deepEqual(r, { synced: 1, failed: 1 });
  const [left] = offline.loadQueue('u1');
  assert.equal(left.status, 'failed');
  assert.equal(left.error, 'Insufficient stock for Milk');
  offline.retryQueued('u1', 'r-1');
  assert.equal(offline.loadQueue('u1')[0].status, 'pending');
});

test('network error detection', () => {
  assert.equal(offline.isNetworkError(new TypeError('Failed to fetch')), true);
  assert.equal(offline.isNetworkError({ message: 'TypeError: Load failed' }), true);
  assert.equal(offline.isNetworkError(new Error('Insufficient stock for Milk')), false);
});

test('caches round-trip with a saved time', () => {
  offline.useStorage(mem());
  offline.saveCache('k', [1, 2]);
  const c = offline.readCache('k');
  assert.deepEqual(c.data, [1, 2]);
  assert.ok(c.savedAt);
});

test('database rejections are not mistaken for lost connection', () => {
  assert.equal(offline.isNetworkError({ message: 'numeric field overflow', code: '22003', details: 'timed out' }), false);
  assert.equal(offline.isNetworkError({ message: 'TypeError: Failed to fetch', code: '' }), true);
  assert.match(offline.friendlyError({ message: 'numeric field overflow' }), /too large/);
});
