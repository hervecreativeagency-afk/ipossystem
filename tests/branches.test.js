import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBranchStock, stockByBranch, chooseBranch, branchName, transferTotals, ALL } from '../src/branch-utils.js';

const branches = [{ id: 'main', name: 'Main shop', is_main: true }, { id: 'town', name: 'Town branch' }];

test('products show the stock at the chosen branch, keeping the company total', () => {
  const out = mergeBranchStock([{ id: 'a', stock_quantity: 30 }, { id: 'b', stock_quantity: 5 }], [{ product_id: 'a', quantity: 12 }]);
  assert.deepEqual(out.map(p => [p.id, p.stock_quantity, p.total_stock]), [['a', 12, 30], ['b', 0, 5]]);
});

test('stock per product per branch', () => {
  assert.deepEqual(stockByBranch([{ product_id: 'a', branch_id: 'main', quantity: 8 }, { product_id: 'a', branch_id: 'town', quantity: '2' }]), { a: { main: 8, town: 2 } });
});

test('staff stay at their home branch; owners choose, defaulting to all branches', () => {
  assert.equal(chooseBranch({ home: 'town', branches, stored: 'main' }), 'town');
  assert.equal(chooseBranch({ home: null, branches, stored: null }), ALL);
  assert.equal(chooseBranch({ home: null, branches, stored: 'town' }), 'town');
  assert.equal(chooseBranch({ home: null, branches, stored: 'closed-branch' }), ALL);
  assert.equal(chooseBranch({ home: null, branches: [branches[0]], stored: ALL }), 'main', 'one branch: no choice needed');
  assert.equal(chooseBranch({ home: null, branches: [], stored: null }), null);
});

test('branch names', () => {
  assert.equal(branchName(branches, 'town'), 'Town branch');
  assert.equal(branchName(branches, ALL), 'All branches');
  assert.equal(branchName(branches, 'gone'), '');
});

test('transfer totals show what went missing', () => {
  const t = { status: 'received', items: [{ quantity: 5, received: 4 }, { quantity: 2, received: 2 }] };
  assert.deepEqual(transferTotals(t), { sent: 7, received: 6, missing: 1 });
  assert.deepEqual(transferTotals({ status: 'sent', items: [{ quantity: 3 }] }), { sent: 3, received: null, missing: 0 });
});
