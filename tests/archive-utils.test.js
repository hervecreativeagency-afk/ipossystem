import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveBounds,archiveNet} from '../src/archive-utils.js';
test('archive ranges include the entire Zambia day and use rolling 7/30 days',()=>{assert.equal(archiveBounds('all','2026-10-11'),null);assert.deepEqual(archiveBounds('today','2026-10-11'),{from:'2026-10-11T00:00:00+02:00',to:'2026-10-11T22:00:00.000Z'});assert.equal(archiveBounds('weekly','2026-10-11').from,'2026-10-05T00:00:00+02:00');assert.equal(archiveBounds('monthly','2026-10-11').from,'2026-09-12T00:00:00+02:00')});
test('archive net total excludes VAT and applies discount',()=>{assert.equal(archiveNet({subtotal:100,discount:5,tax:15.2,total:110.2}),95)});
