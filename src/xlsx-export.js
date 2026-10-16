// Real Excel (.xlsx) downloads with formatting: a title block, bold headers, money formats,
// frozen header row, filters on tables, and statements laid out like an accountant's.
// ExcelJS is loaded only when someone downloads, so it never slows down the app.

const GREEN = 'FF24694F', PALE = 'FFEEF5F0', LINE = 'FFD5DFD8';
export const moneyFormat = currency => {
  const sym = currency === 'ZMW' ? 'K' : (currency || '');
  return `"${sym} "#,##0.00;[Red]-"${sym} "#,##0.00;"${sym} "0.00`;
};
const PERCENT = '0.0%;[Red]-0.0%';

function titleBlock(ws, { title, subtitle, store, width }) {
  ws.mergeCells(1, 1, 1, width);
  Object.assign(ws.getCell(1, 1), { value: title, font: { bold: true, size: 15, color: { argb: GREEN } } });
  ws.mergeCells(2, 1, 2, width);
  Object.assign(ws.getCell(2, 1), { value: [store, subtitle].filter(Boolean).join(' · '), font: { color: { argb: 'FF6D7C74' } } });
  ws.mergeCells(3, 1, 3, width);
  Object.assign(ws.getCell(3, 1), { value: `Downloaded from iPOS on ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lusaka' })}`, font: { italic: true, size: 9, color: { argb: 'FF8A978F' } } });
  return 5;
}

function styleHeader(row) {
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: GREEN } } };
  });
  row.height = 22;
}

/**
 * A table sheet. columns: [{ header, key, width, type: 'text'|'money'|'number'|'percent'|'date' }]
 * rows: objects keyed by column key. totals: optional object for a bold totals row (same keys).
 */
function tableSheet(wb, sheet, currency, store) {
  const ws = wb.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }] });
  const cols = sheet.columns;
  ws.columns = cols.map(c => ({ key: c.key, width: c.width || (c.type === 'money' ? 16 : c.type === 'text' ? 26 : 12) }));
  const start = titleBlock(ws, { title: sheet.title || sheet.name, subtitle: sheet.subtitle, store, width: cols.length });
  const header = ws.getRow(start);
  cols.forEach((c, i) => { header.getCell(i + 1).value = c.header; });
  styleHeader(header);
  sheet.rows.forEach((r, n) => {
    const row = ws.getRow(start + 1 + n);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      let v = r[c.key];
      if (c.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) v = new Date(v.length === 10 ? v + 'T12:00:00Z' : v);
      cell.value = v ?? null;
      if (c.type === 'money') cell.numFmt = moneyFormat(currency);
      if (c.type === 'percent') cell.numFmt = PERCENT;
      if (c.type === 'number') cell.numFmt = '#,##0.##';
      if (c.type === 'date') cell.numFmt = v instanceof Date && v.getUTCHours() === 12 && v.getUTCMinutes() === 0 ? 'dd mmm yyyy' : 'dd mmm yyyy hh:mm';
    });
    if (r._style === 'opening' || r._style === 'closing') row.eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }; });
    if (n % 2 === 1 && !r._style) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAF9' } }; });
  });
  const last = start + sheet.rows.length;
  if (sheet.rows.length) ws.autoFilter = { from: { row: start, column: 1 }, to: { row: last, column: cols.length } };
  if (sheet.totals) {
    const row = ws.getRow(last + 1);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const t = sheet.totals[c.key];
      if (t === 'sum' && sheet.rows.length) {
        const col = ws.getColumn(i + 1).letter;
        cell.value = { formula: `SUBTOTAL(9,${col}${start + 1}:${col}${last})`, result: sheet.rows.reduce((n, r) => n + (Number(r[c.key]) || 0), 0) };
      } else cell.value = t ?? null;
      if (c.type === 'money') cell.numFmt = moneyFormat(currency);
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FF1D2F27' } }, bottom: { style: 'double', color: { argb: 'FF1D2F27' } } };
    });
  }
  if (sheet.notes?.length) sheet.notes.forEach((t, i) => { const c = ws.getCell(last + 3 + i, 1); c.value = t; c.font = { italic: true, size: 9, color: { argb: 'FF6D7C74' } }; });
  return ws;
}

/** A statement sheet (P&L, balance sheet): label column + value columns, headers/subtotals/totals styled. */
function statementSheet(wb, sheet, currency, store) {
  const valueCols = sheet.valueColumns; // [{ header, key, type: 'money'|'percent' }]
  const ws = wb.addWorksheet(sheet.name.slice(0, 31), { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 46 }, ...valueCols.map(c => ({ width: c.type === 'percent' ? 11 : 18 }))];
  const start = titleBlock(ws, { title: sheet.title || sheet.name, subtitle: sheet.subtitle, store, width: valueCols.length + 1 });
  const header = ws.getRow(start);
  header.getCell(1).value = '';
  valueCols.forEach((c, i) => { header.getCell(i + 2).value = c.header; header.getCell(i + 2).alignment = { horizontal: 'right', wrapText: true }; });
  styleHeader(header);
  let r = start + 1;
  for (const l of sheet.lines) {
    const row = ws.getRow(r++);
    const label = row.getCell(1);
    label.value = l.label;
    label.alignment = { indent: l.indent ? 2 : 0 };
    if (l.kind === 'header') { label.font = { bold: true, color: { argb: GREEN } }; row.height = 20; continue; }
    valueCols.forEach((c, i) => {
      const cell = row.getCell(i + 2), v = l[c.key];
      const isPct = c.type === 'percent' || l.kind === 'percent';
      cell.value = v === null ? 'Not recorded' : v === undefined ? null : v;
      cell.numFmt = isPct ? PERCENT : moneyFormat(currency);
      cell.alignment = { horizontal: 'right' };
      if (v === null) cell.font = { italic: true, color: { argb: 'FF9AA69E' } };
    });
    if (l.kind === 'percent') row.eachCell(c => { c.font = { ...(c.font || {}), italic: true, color: { argb: 'FF6D7C74' } }; });
    if (l.kind === 'subtotal') row.eachCell(c => { c.font = { ...(c.font || {}), bold: true }; c.border = { top: { style: 'thin', color: { argb: LINE } } }; });
    if (l.kind === 'total') row.eachCell(c => { c.font = { ...(c.font || {}), bold: true, size: 12 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }; c.border = { top: { style: 'thin', color: { argb: 'FF1D2F27' } }, bottom: { style: 'double', color: { argb: 'FF1D2F27' } } }; });
  }
  (sheet.notes || []).forEach((t, i) => { const c = ws.getCell(r + 1 + i, 1); c.value = t; c.font = { italic: true, size: 9, color: { argb: 'FF6D7C74' } }; });
  return ws;
}

/** Build and download a workbook. sheets: table sheets ({columns, rows}) and/or statement sheets ({lines, valueColumns}). */
export async function downloadWorkbook(fileName, { store, currency, sheets }) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'iPOS'; wb.created = new Date();
  for (const s of sheets) (s.lines ? statementSheet : tableSheet)(wb, s, currency, store);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName.endsWith('.xlsx') ? fileName : fileName + '.xlsx' });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// For tests: build without downloading.
export async function buildWorkbook({ store, currency, sheets }, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) (s.lines ? statementSheet : tableSheet)(wb, s, currency, store);
  return wb;
}
