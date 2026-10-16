import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyBrief, answer, matchQuestion, availableQuestions, addDays, QUESTIONS } from '../src/assistant-utils.js';

const today = '2026-10-16'; // Friday
const fmt = n => 'K' + Number(n).toFixed(2);
const iso = (day, h = 10) => `${day}T${String(h - 2).padStart(2, '0')}:15:00Z`; // Lusaka hour → UTC
let n = 0;
const sale = (day, total, extra = {}) => ({ id: 's' + (++n), created_at: iso(day, extra.h || 10), total, cashier_id: extra.c || 'u1', cashier_name: extra.c === 'u2' ? 'John' : 'Mary', branch_id: extra.b || 'b1' });

function ctx(over = {}) {
  n = 0;
  const sales = [
    sale(addDays(today, -1), 300), sale(addDays(today, -1), 200, { c: 'u2', h: 17 }), // yesterday (Thu) 500
    sale(addDays(today, -8), 400),                                                    // last Thu 400
    sale(today, 120, { h: 9 }),
    sale(addDays(today, -3), 600, { b: 'b2', h: 17 }),
    sale(addDays(today, -10), 100),
  ];
  const items = [
    { sale_id: 's1', product_id: 'p1', product_name: 'Bread', quantity: 10, unit_price: 25 },
    { sale_id: 's1', product_id: 'p2', product_name: 'Milk', quantity: 2, unit_price: 25 },
    { sale_id: 's2', product_id: 'p2', product_name: 'Milk', quantity: 8, unit_price: 25 },
    { sale_id: 's5', product_id: 'p3', product_name: 'Rice', quantity: 4, unit_price: 150 },
  ];
  return {
    today, fmt, sales, items,
    payments: [{ sale_id: 's1', method: 'Cash', amount: 300 }, { sale_id: 's2', method: 'MTN Money', amount: 200 }, { sale_id: 's5', method: 'Cash', amount: 600 }],
    products: [
      { id: 'p1', name: 'Bread', stock_quantity: 0, low_stock_threshold: 5, selling_price: 25 },
      { id: 'p2', name: 'Milk', stock_quantity: 3, low_stock_threshold: 5, selling_price: 25 },
      { id: 'p3', name: 'Rice', stock_quantity: 40, low_stock_threshold: 5, selling_price: 150 },
      { id: 'p4', name: 'Soap', stock_quantity: 12, low_stock_threshold: 2, selling_price: 10 },
    ],
    costs: new Map([['p1', 18], ['p3', 120]]),
    customers: [{ name: 'Mrs Tembo', phone: '0977', balance: 250, credit_limit: 200 }, { name: 'Mr Zulu', balance: 0 }],
    batches: [{ expiry_date: addDays(today, 3), quantity: 5 }],
    branches: [{ id: 'b1', name: 'Cairo Road' }, { id: 'b2', name: 'Kabwe' }], multiBranch: true,
    ...over,
  };
}

test('daily summary in plain words', () => {
  const b = dailyBrief(ctx());
  assert.equal(b.lines[0], 'Yesterday (Thursday) you sold K500.00 in 2 sales, up 25% on K400.00 last Thursday.');
  assert.equal(b.lines[1], 'Your best seller was Bread (10 sold, K250.00).');
  assert.equal(b.lines[2], 'Today so far: K120.00 from 1 sale.');
  assert.ok(b.lines.includes('1 product that sold this week is now out of stock: Bread.'));
  assert.ok(b.lines.includes('1 product is running low.'));
  assert.ok(b.lines.includes('1 batch of stock expires within 7 days — sell it first.'));
  assert.ok(b.lines.includes('Customers owe you K250.00 on credit.'));
  assert.equal(dailyBrief(ctx({ sales: [] })).lines[0], 'There were no sales yesterday (Thursday).');
});

test('this week compared with last week', () => {
  const a = answer('week', ctx());
  assert.equal(a.lines[0], 'In the last 7 days you sold K1220.00 from 4 sales, up 144% on K500.00 the 7 days before.');
  assert.equal(a.bars.length, 7);
  assert.match(a.lines[2], /^Best day: Tuesday with K600.00/);
});

test('best sellers, profit and slow movers', () => {
  const best = answer('best', ctx());
  assert.deepEqual(best.table.rows[0], ['Rice', 4, 'K600.00']);
  const profit = answer('profit', ctx());
  assert.deepEqual(profit.table.rows.map(r => r.slice(0, 3)), [['Rice', 4, 'K120.00'], ['Bread', 10, 'K70.00']]); // 600-480, 250-180
  assert.match(profit.lines.at(-1), /1 product that sold has no purchase cost/);
  const slow = answer('slow', ctx());
  assert.deepEqual(slow.table.rows, [['Soap', 12, 'K120.00']]);
  assert.match(answer('profit', ctx({ costs: new Map() })).lines[0], /Add purchase costs/);
});

test('reorder, busy times, payments, credit, cashiers, branches', () => {
  const r = answer('reorder', ctx());
  assert.deepEqual(r.table.rows.map(x => x[0]), ['Bread', 'Milk']);
  assert.equal(r.table.rows[0][3], 'Out now');
  const busy = answer('busy', ctx());
  assert.match(busy.lines[0], /busiest hour is (10|17):00/);
  const pay = answer('pay', ctx());
  assert.match(pay.lines[0], /^Cash is the most used: 82%/);
  const credit = answer('credit', ctx());
  assert.deepEqual(credit.table.rows, [['Mrs Tembo', '0977', 'K250.00']]);
  assert.match(credit.lines[1], /Mrs Tembo is over their credit limit/);
  assert.match(answer('cashiers', ctx()).lines[0], /^Mary sold the most/);
  assert.match(answer('branches', ctx()).lines[0], /^Cairo Road brought in the most/);
});

test('typed questions find the closest ready-made one', () => {
  const id = t => matchQuestion(t)?.id;
  assert.equal(id('which items are not selling'), 'slow');
  assert.equal(id('what should i restock?'), 'reorder');
  assert.equal(id('who owes me'), 'credit');
  assert.equal(id('best selling products'), 'best');
  assert.equal(id('what time are we busiest'), 'busy');
  assert.equal(id('how much profit did I make'), 'profit');
  assert.equal(id('mtn or airtel'), 'pay');
  assert.equal(id('tell me a joke'), undefined);
});

test('supervisors do not see profit or cashier comparisons; single shops have no branch question', () => {
  assert.ok(!availableQuestions(ctx(), 'supervisor').some(q => ['profit', 'cashiers'].includes(q.id)));
  assert.equal(availableQuestions(ctx({ multiBranch: false }), 'director').length, QUESTIONS.length - 1);
});
