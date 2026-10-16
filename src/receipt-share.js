// Builds WhatsApp / SMS receipts (pure, unit tested).

// Turns what the cashier types into international digits (no +), defaulting to
// Zambia: 0977 123 456, 977123456, +260 977 123 456 and 00260… all -> 260977123456.
export function normalizePhone(input, countryCode = '260') {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) { /* already international */ }
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith(countryCode) && d.length >= countryCode.length + 9) { /* already international */ }
  else if (d.startsWith('0') && d.length === 10) d = countryCode + d.slice(1);
  else if (d.length === 9) d = countryCode + d;
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

export const displayPhone = digits => (digits ? '+' + digits : '');

const CREDIT = 'Customer credit';
const line = (label, value) => `${label}: ${value}`;

/**
 * Plain-text receipt. WhatsApp shows *text* in bold; SMS gets no formatting.
 * opts: { channel: 'whatsapp' | 'sms', company, money, balanceOwed }
 */
export function receiptText(sale, { channel = 'whatsapp', company = {}, money, balanceOwed = null }) {
  const b = t => (channel === 'whatsapp' ? `*${t}*` : t);
  const m = n => money(n, sale.currency);
  const date = new Date(sale.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lusaka' });
  const out = [];
  out.push(b(company.name || 'Receipt'));
  if (company.phone) out.push(company.phone);
  out.push('');
  out.push(line('Receipt', sale.receipt_number));
  out.push(date);
  if (sale.offline) out.push('(Provisional – saved offline)');
  out.push('');
  const items = sale.items || [];
  const shown = channel === 'sms' && items.length > 15 ? items.slice(0, 15) : items;
  for (const i of shown) out.push(`${i.quantity} x ${i.product_name} – ${m(Number(i.unit_price) * Number(i.quantity))}`);
  if (shown.length < items.length) out.push(`…and ${items.length - shown.length} more items`);
  out.push('');
  if (Number(sale.discount) > 0) out.push(line('Discount', '-' + m(sale.discount)));
  if (Number(sale.tax) > 0) out.push(line('Tax', m(sale.tax)));
  out.push(b(line('Total', m(sale.total))));
  for (const p of sale.payments || []) out.push(line(p.method === CREDIT ? 'On account' : p.method, m(p.amount)));
  if (Number(sale.change) > 0) out.push(line('Change', m(sale.change)));
  if (balanceOwed != null && Number(balanceOwed) > 0) out.push(b(line('Balance owed', m(balanceOwed))));
  if (Number(sale.refunded_total) > 0) out.push(line('Refunded', m(sale.refunded_total)));
  if (company.tpin) { out.push(''); out.push(line('TPIN', company.tpin)); }
  if (company.receipt_return_policy) { out.push(''); out.push(company.receipt_return_policy); }
  out.push('');
  out.push(company.receipt_footer || 'Thank you for shopping with us!');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const whatsappUrl = (digits, text) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
// "?&body=" works on both Android and iPhone.
export const smsUrl = (digits, text) => `sms:+${digits}?&body=${encodeURIComponent(text)}`;

// Contacts export for marketing tools (only customers who agreed).
export function contactsCsv(customers) {
  const esc = v => {
    const s = String(v ?? '');
    // Stop spreadsheet formulas, but leave phone numbers like +260… as they are.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^\+[\d ()-]+$/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  const rows = [['Name', 'Phone', 'International number', 'Agreed on', 'Last receipt']];
  for (const c of customers) {
    if (!c.marketing_opt_in || !c.active) continue;
    const digits = normalizePhone(c.phone);
    rows.push([c.name, c.phone || '', digits || '', c.marketing_opt_in_at ? c.marketing_opt_in_at.slice(0, 10) : '', c.last_receipt_at ? c.last_receipt_at.slice(0, 10) : '']);
  }
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}
