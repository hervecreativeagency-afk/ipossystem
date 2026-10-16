import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonPeriod, profitAndLoss, balanceSheet, compare, cashbookSheet, dailyTotals } from '../src/statements.js';

const at = (day, h = 10) => `${day}T${String(h - 2).padStart(2, '0')}:00:00Z`;
const line = (st, key) => (st.lines || st).find(l => l.key === key);

test('comparison periods', () => {
  assert.deepEqual(comparisonPeriod('2026-10-01', '2026-10-16'), { from: '2026-09-15', to: '2026-09-30', label: 'Previous period' });
  assert.deepEqual(comparisonPeriod('2026-02-01', '2026-02-28', 'lastYear'), { from: '2025-02-01', to: '2025-02-28', label: 'Same period last year' });
  assert.deepEqual(comparisonPeriod('2028-02-29', '2028-02-29', 'lastYear'), { from: '2027-02-28', to: '2027-02-28', label: 'Same period last year' });
  assert.equal(comparisonPeriod('2026-10-01', '2026-10-16', 'none'), null);
});

const data = {
  sales: [
    { id: 's1', status: 'completed', created_at: at('2026-10-02'), subtotal: 1000, discount: 50, total: 1100, change: 0 },
    { id: 's2', status: 'completed', created_at: at('2026-10-10'), subtotal: 500, discount: 0, total: 550, change: 0 },
    { id: 's0', status: 'completed', created_at: at('2026-09-20'), subtotal: 400, discount: 0, total: 440, change: 0 },
  ],
  sale_items: [{ id: 'i1', sale_id: 's1', quantity: 10, unit_price: 100 }, { id: 'i2', sale_id: 's2', quantity: 5, unit_price: 100 }, { id: 'i0', sale_id: 's0', quantity: 4, unit_price: 100 }],
  financial_sale_costs: [{ sale_item_id: 'i1', unit_cost: 60 }, { sale_item_id: 'i2', unit_cost: 60 }, { sale_item_id: 'i0', unit_cost: 60 }],
  sale_refunds: [{ id: 'r1', sale_id: 's2', created_at: at('2026-10-11'), net: 100, total: 110 }],
  refund_items: [{ refund_id: 'r1', sale_item_id: 'i2', quantity: 1, restocked: true }],
  payments: [{ sale_id: 's1', method: 'Cash', amount: 1100 }, { sale_id: 's2', method: 'MTN Money', amount: 550 }, { sale_id: 's0', method: 'Cash', amount: 440 }],
  cashbook_entries: [
    { id: 'c1', entry_date: '2026-10-05', type: 'expense', category: 'Rent', amount: 200 },
    { id: 'c2', entry_date: '2026-10-06', type: 'expense', category: 'Transport', amount: 30 },
    { id: 'c3', entry_date: '2026-10-07', type: 'expense', category: 'Supplier Settlement', amount: 300, purchase_id: 'po1' },
    { id: 'c4', entry_date: '2026-10-08', type: 'income', category: 'Miscellaneous', amount: 25 },
    { id: 'c5', entry_date: '2026-10-09', type: 'income', category: 'Customer repayment', amount: 80 },
    { id: 'c6', entry_date: '2026-09-25', type: 'expense', category: 'Rent', amount: 200 },
  ],
  products: [{ id: 'p1', stock_quantity: 20 }, { id: 'p2', stock_quantity: 0 }],
  financial_product_costs: [{ product_id: 'p1', unit_cost: 60 }],
  financial_balances: [{ opening_date: '2026-09-01', opening_cash: 1000, other_assets: 50, other_liabilities: 120 }],
  customers: [{ balance: 300 }, { balance: 0 }],
  purchase_orders: [
    { id: 'po1', status: 'received', received_at: at('2026-10-03'), paid: true, total: 300 },
    { id: 'po2', status: 'received', received_at: at('2026-10-12'), paid: false, total: 450 },
    { id: 'po3', status: 'ordered', paid: false, total: 999 },
  ],
};

test('profit and loss for a period', () => {
  const pl = profitAndLoss(data, '2026-10-01', '2026-10-16');
  assert.equal(line(pl, 'sales').value, 1500);
  assert.equal(line(pl, 'discounts').value, -50);
  assert.equal(line(pl, 'refunds').value, -100);
  assert.equal(line(pl, 'revenue').value, 1350);
  assert.equal(line(pl, 'cogs').value, -(900 - 60));           // 15 sold, 1 restocked
  assert.equal(line(pl, 'gross').value, 510);
  assert.deepEqual(pl.lines.filter(l => l.key.startsWith('exp:')).map(l => [l.label, l.value]), [['Rent', -200], ['Transport', -30]]);
  assert.equal(line(pl, 'expenses').value, -230);
  assert.equal(line(pl, 'other-income').value, 25);             // repayments aren't income
  assert.equal(line(pl, 'net').value, 305);
  assert.ok(Math.abs(line(pl, 'net-margin').value - 305 / 1350) < 1e-9);
  const noCosts = profitAndLoss({ ...data, financial_sale_costs: [] }, '2026-10-01', '2026-10-16');
  assert.deepEqual([line(noCosts, 'cogs').value, line(noCosts, 'net').value, noCosts.missingSaleCosts], [null, null, 3]);
});

test('this period next to the previous one', () => {
  const now = profitAndLoss(data, '2026-10-01', '2026-10-16'), before = profitAndLoss(data, '2026-09-15', '2026-09-30');
  const rows = compare(now, before);
  const rev = line(rows, 'revenue');
  assert.deepEqual([rev.value, rev.prev], [1350, 400]);
  assert.ok(Math.abs(rev.change - 950 / 400) < 1e-9);
  assert.equal(line(rows, 'exp:Transport').prev, 0);           // only in this period
  assert.equal(line(rows, 'h-rev').change, null);
  assert.equal(line(rows, 'net').prev, 400 - 240 - 200);
});

test('balance sheet today and rebuilt for an earlier date', () => {
  const movements = [{ product_id: 'p1', quantity: -15, created_at: at('2026-10-02') }, { product_id: 'p1', quantity: 1, created_at: at('2026-10-11') }];
  const ledger = [{ amount: 300, created_at: at('2026-10-05') }];
  const today = balanceSheet(data, '2026-10-16', { movements, ledger });
  // cash: 1000 + 440 (Sep sale) - 200 (Sep rent) + 1100 + 550 - 200 - 30 - 300 + 25 + 80 = 2465
  assert.equal(line(today, 'cash').value, 2465);
  assert.equal(line(today, 'inventory').value, 1200);
  assert.equal(line(today, 'receivables').value, 300);
  assert.equal(line(today, 'payables').value, 450);
  assert.equal(line(today, 'assets').value, 2465 + 1200 + 300 + 50);
  assert.equal(line(today, 'liabilities').value, 570);
  assert.equal(line(today, 'equity').value, 4015 - 570);
  const sep30 = balanceSheet(data, '2026-09-30', { movements, ledger });
  assert.equal(line(sep30, 'cash').value, 1240);
  assert.equal(line(sep30, 'inventory').value, (20 + 15 - 1) * 60);  // undo October movements
  assert.equal(line(sep30, 'receivables').value, 0);
  assert.equal(line(sep30, 'payables').value, 0);
  const oct05 = balanceSheet(data, '2026-10-05', { movements, ledger });
  assert.equal(line(oct05, 'payables').value, 300);               // received 3 Oct, paid 7 Oct
  const before = balanceSheet(data, '2026-08-31', { movements, ledger });
  assert.deepEqual([line(before, 'cash').value, before.needsOpening, line(before, 'equity').value], [null, true, null]);
});

test('cashbook with opening balance, running balance and daily totals', () => {
  const ledger = [
    { id: 'a', entry_date: '2026-10-02', type: 'income', amount: 100 },
    { id: 'b', entry_date: '2026-10-02', type: 'expense', amount: 30 },
    { id: 'c', entry_date: '2026-10-03', type: 'expense', amount: 20 },
    { id: 'z', entry_date: '2026-09-20', type: 'income', amount: 500 },
    { id: 'y', entry_date: '2026-08-20', type: 'income', amount: 999 },
  ];
  const s = cashbookSheet(ledger, '2026-10-01', '2026-10-31', { opening_date: '2026-09-01', opening_cash: 1000 });
  assert.deepEqual([s.openingBalance, s.totalIn, s.totalOut, s.net, s.closingBalance], [1500, 100, 50, 50, 1550]);
  assert.deepEqual(s.rows.map(r => r.balance), [1600, 1570, 1550]);
  assert.deepEqual(dailyTotals(s), [{ day: '2026-10-02', in: 100, out: 30, balance: 1570 }, { day: '2026-10-03', in: 0, out: 20, balance: 1550 }]);
  const noOpening = cashbookSheet(ledger, '2026-10-01', '2026-10-31');
  assert.deepEqual([noOpening.hasOpening, noOpening.closingBalance], [false, 50]);
});

test('reversals undo the original entry; owner money and loans are not profit', () => {
  const d = { ...data, cashbook_entries: [
    { id: 'x1', entry_date: '2026-10-05', type: 'expense', category: 'Rent', description: 'October rent', amount: 200 },
    { id: 'x2', entry_date: '2026-10-06', type: 'income', category: 'Rent', description: 'Reversal of October rent', amount: 200 },
    { id: 'x3', entry_date: '2026-10-06', type: 'expense', category: 'Transport', description: 'Taxi', amount: 30 },
    { id: 'x4', entry_date: '2026-10-07', type: 'income', category: 'Other income', description: 'Sold old shelves', amount: 90 },
    { id: 'x5', entry_date: '2026-10-08', type: 'expense', category: 'Other income', description: 'Reversal of Sold old shelves', amount: 90 },
    { id: 'x6', entry_date: '2026-10-08', type: 'income', category: 'Owner capital', description: 'Owner put in', amount: 5000 },
    { id: 'x7', entry_date: '2026-10-09', type: 'expense', category: 'Owner drawings', description: 'Owner took', amount: 700 },
  ] };
  const pl = profitAndLoss(d, '2026-10-01', '2026-10-16');
  assert.deepEqual(pl.lines.filter(l => l.key.startsWith('exp:')).map(l => [l.label, l.value]), [['Transport', -30]]);
  assert.equal(line(pl, 'other-income').value, 0);
  assert.equal(line(pl, 'net').value, 510 - 30);
});
