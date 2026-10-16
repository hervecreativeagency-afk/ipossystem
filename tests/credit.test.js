import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentRows, CREDIT } from '../src/totals.js';
import { cashbookLedger } from '../src/operation-utils.js';
import { financialModel, reportModel } from '../src/report-utils.js';

test('credit is only accepted when allowed', () => {
  assert.throws(() => paymentRows(CREDIT, 0, {}, 52500), /valid payment method/);
  assert.deepEqual(paymentRows(CREDIT, 0, {}, 52500, { credit: true }), [{ method: CREDIT, amount: 52500 }]);
  assert.throws(() => paymentRows('Mixed payment', 0, { [CREDIT]: 52500 }, 52500), /Enter the amount paid/);
});

test('mixed cash and credit; change only from cash', () => {
  const rows = paymentRows('Mixed payment', 0, { Cash: 45000, [CREDIT]: 7500 }, 52500, { credit: true });
  assert.deepEqual(rows.map(r => [r.method, r.amount]), [['Cash', 45000], [CREDIT, 7500]]);
  assert.throws(() => paymentRows('Mixed payment', 0, { 'MTN Money': 10, [CREDIT]: 60000 }, 52500, { credit: true }), /Change can only be returned from cash/);
});

test('cashbook ignores credit: it is not money received', () => {
  const sales = [{ id: 's1', status: 'completed', created_at: '2026-10-16T08:00:00Z', change: 0, cashier_id: 'u', cashier_name: 'A', receipt_number: 'R1' }];
  const payments = [{ sale_id: 's1', method: 'Cash', amount: 45000 }, { sale_id: 's1', method: CREDIT, amount: 7500 }];
  const rows = cashbookLedger(sales, payments, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payment_method, 'Cash');
  assert.equal(rows[0].amount, 45000);
});

const base = {
  sales: [], sale_items: [], products: [], purchase_orders: [], payments: [], financial_product_costs: [], financial_sale_costs: [],
  sale_refunds: [], refund_items: [],
  financial_balances: [{ opening_date: '2026-01-01', opening_cash: 1000, other_assets: 0, other_liabilities: 0 }],
};

test('balance sheet counts what customers owe as an asset', () => {
  const f = financialModel({ ...base, cashbook_entries: [], customers: [{ balance: 7500 }, { balance: 0 }, { balance: 2500 }] }, '2026-10-16');
  assert.equal(f.receivables, 10000);
  assert.equal(f.assets, 1000 + 10000);
  const none = financialModel({ ...base, cashbook_entries: [] }, '2026-10-16');
  assert.equal(none.receivables, 0);
});

test('repayments add to cash but are not counted as other income', () => {
  const entries = [{ entry_date: '2026-10-16', type: 'income', category: 'Customer repayment', amount: 5000, payment_method: 'Cash' }];
  const f = financialModel({ ...base, cashbook_entries: entries, customers: [] }, '2026-10-16');
  assert.equal(f.cash, 6000);
  const r = reportModel({ ...base, cashbook_entries: entries }, '2026-10-16', '2026-10-01', '2026-10-16');
  assert.equal(r.manualIncome.length, 0);
});
