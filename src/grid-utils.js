// Helpers for spreadsheet-style input (unit tested).

/** Numbers from text pasted out of Excel/Sheets: one per line (first column), "K 1,200.50" → "1200.50", blanks kept as undefined. */
export function parsePastedNumbers(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map(l => {
    const first = l.split('\t')[0].trim();
    if (!first) return undefined;
    const clean = first.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = Number(clean);
    return clean && Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100) / 100) : undefined;
  });
}
