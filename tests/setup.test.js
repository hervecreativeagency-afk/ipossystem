import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSteps, progress } from '../src/setup-utils.js';

const empty = { address: '', phone: '', products: 0, suppliers: 0, staff: 1, invites: 0, branches: 1, shifts: 0, sales: 0, installed: false };

test('each role sees its own steps', () => {
  assert.deepEqual(buildSteps('director', empty).map(s => s.id), ['details', 'products', 'suppliers', 'staff', 'branches', 'shift', 'sale', 'install']);
  assert.deepEqual(buildSteps('supervisor', empty).map(s => s.id), ['products', 'suppliers', 'shift', 'sale', 'install']);
  assert.deepEqual(buildSteps('cashier', empty).map(s => s.id), ['shift', 'sale', 'install']);
});

test('a new shop starts at shop details', () => {
  const p = progress(buildSteps('director', empty));
  assert.deepEqual([p.finished, p.total, p.percent, p.complete, p.next.id], [0, 8, 0, false, 'details']);
  assert.equal(buildSteps('director', empty)[0].hint, 'Address and phone missing');
  assert.equal(buildSteps('director', { ...empty, phone: '0977' })[0].hint, 'Address missing');
});

test('steps tick themselves off from real data', () => {
  const f = { ...empty, address: 'Cairo Rd', phone: '0977', products: 12, staff: 3, branches: 2, shifts: 1, sales: 4 };
  const s = buildSteps('director', f);
  assert.deepEqual(s.filter(x => x.status === 'done').map(x => x.id), ['details', 'products', 'staff', 'branches', 'shift', 'sale']);
  assert.equal(s.find(x => x.id === 'products').hint, '12 products added');
  assert.equal(s.find(x => x.id === 'staff').hint, '2 staff members');
  assert.equal(progress(s).next.id, 'suppliers');
  assert.equal(progress(buildSteps('director', { ...f, sales: 0 })).next.id, 'sale');
});

test('an invitation counts as inviting staff', () => {
  const s = buildSteps('director', { ...empty, invites: 1 }).find(x => x.id === 'staff');
  assert.deepEqual([s.status, s.hint], ['done', '1 invitation sent']);
});

test('optional steps can be skipped, required ones cannot', () => {
  const s = buildSteps('director', { ...empty, address: 'a', phone: 'b', products: 1, shifts: 1, sales: 1 }, { skipped: ['staff', 'branches', 'suppliers', 'install', 'sale'] });
  assert.equal(s.find(x => x.id === 'sale').status, 'done');
  const p = progress(s);
  assert.deepEqual([p.complete, p.percent], [true, 100]);
  const t = buildSteps('director', empty, { skipped: ['details'] });
  assert.equal(t[0].status, 'todo');
});

test('no data yet means nothing is ticked', () => {
  assert.ok(buildSteps('director', null).every(s => s.status === 'todo'));
});
