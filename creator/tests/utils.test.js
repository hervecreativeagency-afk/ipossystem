import test from 'node:test';
import assert from 'node:assert/strict';
import { presenceStatus, ago, groupCrashes, visitsByDay, signupsByDay, places, flag } from '../src/utils.js';

const now = Date.parse('2026-10-16T16:00:00Z');
const iso = ms => new Date(ms).toISOString();

test('online, away and offline', () => {
  assert.equal(presenceStatus({ last_seen: iso(now - 60000) }, now), 'online');
  assert.equal(presenceStatus({ last_seen: iso(now - 10 * 60000) }, now), 'away');
  assert.equal(presenceStatus({ last_seen: iso(now - 3600000) }, now), 'offline');
  assert.equal(ago(iso(now - 5 * 60000), now), '5 min ago');
  assert.equal(ago(iso(now - 3 * 86400000), now), '3 days ago');
});

test('crashes grouped by message', () => {
  const g = groupCrashes([
    { kind: 'error', message: 'TypeError: a', user_id: 'u1', shop: 'A', page: '/pos', device: 'phone', browser: 'Chrome 141', created_at: iso(now - 3000) },
    { kind: 'error', message: 'TypeError: a', user_id: 'u2', shop: 'B', page: '/pos', device: 'tablet', browser: 'Chrome 140', created_at: iso(now - 1000), detail: 'latest' },
    { kind: 'error', message: 'RangeError: b', user_id: 'u1', shop: 'A', page: '/reports', created_at: iso(now - 9000) },
    { kind: 'visit', created_at: iso(now) },
  ]);
  assert.deepEqual(g.map(x => [x.message, x.count, x.users, x.shops.length]), [['TypeError: a', 2, 2, 2], ['RangeError: b', 1, 1, 1]]);
  assert.equal(g[0].latest.detail, 'latest');
  assert.equal(g[0].devices.length, 2);
});

test('visits and sign-ups per day', () => {
  const ev = [{ kind: 'visit', user_id: 'u1', created_at: '2026-10-16T08:00:00Z' }, { kind: 'visit', user_id: 'u1', created_at: '2026-10-16T09:00:00Z' }, { kind: 'visit', created_at: '2026-10-15T09:00:00Z', city: 'Lusaka' }, { kind: 'error', created_at: '2026-10-16T09:00:00Z' }];
  assert.deepEqual(visitsByDay(ev, 3, new Date(now)), [{ day: '2026-10-14', visits: 0, people: 0 }, { day: '2026-10-15', visits: 1, people: 1 }, { day: '2026-10-16', visits: 2, people: 1 }]);
  assert.deepEqual(signupsByDay([{ created_at: '2026-10-16T01:00:00Z' }, { created_at: '2026-01-01T00:00:00Z' }], 2, new Date(now)), [{ day: '2026-10-15', count: 0 }, { day: '2026-10-16', count: 1 }]);
});

test('places for the map', () => {
  const p = places([
    { kind: 'visit', country: 'ZM', city: 'Lusaka', lat: -15.41, lon: 28.28 }, { kind: 'visit', country: 'ZM', city: 'Lusaka', lat: -15.42, lon: 28.29 },
    { kind: 'error', country: 'ZM', city: 'Kitwe', lat: -12.8, lon: 28.2 }, { kind: 'visit', country: 'ZA', city: 'Johannesburg', lat: -26.2, lon: 28.04 },
  ]);
  assert.deepEqual(p.countries.map(c => [c.code, c.visits, c.errors]), [['ZM', 2, 1], ['ZA', 1, 0]]);
  assert.equal(p.cities.length, 3);
  assert.equal(p.cities.find(c => c.city === 'Lusaka').visits, 2);
  assert.equal(flag('ZM'), '🇿🇲');
  assert.equal(flag(null), '🌐');
});
