import test from 'node:test';
import assert from 'node:assert/strict';
import {csvText,dateBounds,cashbookLedger} from '../src/operation-utils.js';
test('CSV quotes values and neutralizes spreadsheet formulas',()=>{assert.equal(csvText([['=1+1','a"b','x,y']]),'"\'=1+1","a""b","x,y"');});
test('date range includes the full Zambia end date',()=>assert.deepEqual(dateBounds('2026-10-01','2026-10-11'),{p_from:'2026-10-01T00:00:00+02:00',p_to:'2026-10-11T22:00:00.000Z'}));
test('reject reversed and invalid date ranges',()=>{assert.throws(()=>dateBounds('2026-10-12','2026-10-11'));assert.throws(()=>dateBounds('bad','2026-10-11'));});
test('cashbook merges payments and subtracts cash change once',()=>{const rows=cashbookLedger([{id:'s',receipt_number:'R1',created_at:'2026-10-11T23:30:00Z',status:'completed',change:5}],[{sale_id:'s',method:'Cash',amount:10},{sale_id:'s',method:'Cash',amount:5},{sale_id:'s',method:'MTN Money',amount:20}],[]);assert.equal(rows.length,2);assert.equal(rows.find(r=>r.payment_method==='Cash').amount,10);assert.equal(rows.reduce((n,r)=>n+r.amount,0),30);assert.equal(rows[0].entry_date,'2026-10-12');});
test('cashbook excludes noncompleted sales and includes purchase expense once',()=>{const rows=cashbookLedger([{id:'s',status:'cancelled'}],[{sale_id:'s',method:'Cash',amount:10}],[{id:'m',entry_date:'2026-10-11',type:'expense',amount:17,purchase_id:'p'}]);assert.equal(rows.length,1);assert.equal(rows[0].source,'Purchase');});

test('cashbook preset ranges use Monday weeks and calendar month/year starts',async()=>{const{cashbookPeriod}=await import('../src/operation-utils.js');assert.deepEqual(cashbookPeriod('daily','2026-10-11'),{from:'2026-10-11',to:'2026-10-11'});assert.equal(cashbookPeriod('weekly','2026-10-11').from,'2026-10-05');assert.equal(cashbookPeriod('weekly','2026-10-12').from,'2026-10-12');assert.equal(cashbookPeriod('monthly','2026-10-11').from,'2026-10-01');assert.equal(cashbookPeriod('annual','2026-10-11').from,'2026-01-01')});
