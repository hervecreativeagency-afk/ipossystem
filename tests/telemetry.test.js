import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDevice, cleanPage, describeError, ignoredError } from '../src/telemetry-utils.js';

test('devices, browsers and systems', () => {
  assert.deepEqual(describeDevice('Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'), { device: 'phone', browser: 'Chrome 141', os: 'Android 14' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'), { device: 'tablet', browser: 'Chrome 140', os: 'Android 13' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), { device: 'phone', browser: 'Safari 18', os: 'iOS 18' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0'), { device: 'desktop', browser: 'Edge 141', os: 'Windows 10/11' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 5), { device: 'tablet', browser: 'Safari 18', os: 'iPadOS' });
});

test('pages without ids', () => {
  assert.equal(cleanPage('/receipts/5f3e9c2a-1b2c-4d5e-8f90-1234567890ab?print=1'), '/receipts/:id');
  assert.equal(cleanPage('/pos'), '/pos');
  assert.equal(cleanPage(''), '/');
});

test('errors described briefly; noise ignored', () => {
  const e = new TypeError('x is undefined');
  const d = describeError(e, 'in Checkout');
  assert.equal(d.message, 'TypeError: x is undefined');
  assert.match(d.detail, /in Checkout$/);
  assert.equal(describeError('plain text').message, 'plain text');
  assert.equal(describeError({ code: 42 }).message, '{"code":42}');
  assert.ok(ignoredError('ResizeObserver loop completed with undelivered notifications.'));
  assert.ok(ignoredError('TypeError: Failed to fetch'));
  assert.ok(!ignoredError('TypeError: x is undefined'));
});
