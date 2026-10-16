import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePastedNumbers } from '../src/grid-utils.js';

test('numbers pasted from a spreadsheet column', () => {
  assert.deepEqual(parsePastedNumbers('12.5\nK 1,200.50\n\n7\tignored\n'), ['12.5', '1200.5', undefined, '7']);
  assert.deepEqual(parsePastedNumbers('abc\n-5\n3,75'), [undefined, undefined, '3.75']);
  assert.deepEqual(parsePastedNumbers('42'), ['42']);
});
