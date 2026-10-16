import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildWorkbook, moneyFormat } from '../src/xlsx-export.js';

test('table and statement sheets survive a round trip through Excel', async () => {
  const wb = await buildWorkbook({
    store: 'Mwila Groceries', currency: 'ZMW',
    sheets: [
      { name: 'Cashbook', subtitle: '1 Oct – 16 Oct 2026', columns: [{ header: 'Date', key: 'date', type: 'date' }, { header: 'Description', key: 'd', type: 'text' }, { header: 'Money in', key: 'in', type: 'money' }, { header: 'Money out', key: 'out', type: 'money' }],
        rows: [{ date: '2026-10-02', d: 'Sale R-1', in: 100, out: null }, { date: '2026-10-03', d: 'Rent', in: null, out: 40 }], totals: { d: 'Total', in: 'sum', out: 'sum' } },
      { name: 'Profit & Loss', valueColumns: [{ header: 'This period', key: 'value' }, { header: 'Previous', key: 'prev' }, { header: 'Change', key: 'change', type: 'percent' }],
        lines: [{ label: 'Revenue', kind: 'header' }, { label: 'Sales', value: 1500, prev: 400, change: 2.75, kind: 'item', indent: 1 }, { label: 'Cost of goods sold', value: null, prev: -240, kind: 'item' }, { label: 'Net profit', value: 305, prev: -40, kind: 'total' }] },
    ],
  }, ExcelJS);
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook(); await back.xlsx.load(buf);
  const cb = back.getWorksheet('Cashbook');
  assert.equal(cb.getCell('A1').value, 'Cashbook');
  assert.equal(cb.getCell('A5').value, 'Date');
  assert.equal(cb.getCell('C6').value, 100);
  assert.equal(cb.getCell('C6').numFmt, moneyFormat('ZMW'));
  assert.equal(cb.getCell('B8').value, 'Total');
  assert.match(cb.getCell('C8').value.formula, /SUBTOTAL\(9,C6:C7\)/);
  assert.equal(cb.getCell('C8').value.result, 100);
  assert.ok(cb.getCell('A6').value instanceof Date);
  const pl = back.getWorksheet('Profit & Loss');
  assert.equal(pl.getCell('B5').value, 'This period');
  assert.equal(pl.getCell('A7').value, 'Sales');
  assert.equal(pl.getCell('B7').value, 1500);
  assert.equal(pl.getCell('D7').numFmt, '0.0%;[Red]-0.0%');
  assert.equal(pl.getCell('B8').value, 'Not recorded');
  assert.equal(pl.getCell('A9').font.bold, true);
});
