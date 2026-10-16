import test from 'node:test';
import assert from 'node:assert/strict';
import { hourly, sparkPath, pctChange } from '../src/dashboard-utils.js';

const at = (day, h) => `${day}T${String(h - 2).padStart(2, '0')}:30:00Z`; // Lusaka hour → UTC

test('sales by hour today next to a usual day', () => {
  const sales = [
    { created_at: at('2026-10-16', 9), total: 100 }, { created_at: at('2026-10-16', 9), total: 50 }, { created_at: at('2026-10-16', 17), total: 80 },
    { created_at: at('2026-10-15', 9), total: 60 }, { created_at: at('2026-10-14', 9), total: 40 }, { created_at: at('2026-10-14', 12), total: 200 },
  ];
  const rows = hourly(sales, '2026-10-16');
  assert.deepEqual(rows.map(r => r.hour), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(rows[0], { hour: 9, today: 150, usual: 50 });
  assert.deepEqual(rows.find(r => r.hour === 12), { hour: 12, today: 0, usual: 100 });
  assert.deepEqual(hourly([], '2026-10-16'), []);
});

test('sparkline paths and percentage change', () => {
  const p = sparkPath([0, 5, 10], 100, 20, 0);
  assert.equal(p.line, 'M0,20 L50,10 L100,0');
  assert.deepEqual(p.last, [100, 0]);
  assert.equal(sparkPath([4], 100, 20), null);
  assert.equal(pctChange(150, 100), 0.5);
  assert.equal(pctChange(5, 0), null);
});
