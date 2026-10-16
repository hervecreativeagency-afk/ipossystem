// Financial statements in accounting layout, for any period, with a comparison column (unit tested).
//
// Every statement is a list of lines: { key, label, value, kind, indent, note }
//   kind: 'header' | 'item' | 'subtotal' | 'total' | 'percent' | 'note'
//   value: number, or null when it can't be worked out yet (e.g. missing costs) — shown as "Not recorded".
// Past balances are rebuilt from today's figures by undoing everything recorded after the date.
import { cashbookLedger } from './operation-utils.js';

export const localDay = v => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lusaka' }).format(new Date(v));
const num = v => Number(v) || 0;
const sumOf = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
const round2 = n => Math.round(n * 100) / 100;
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const days = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000) + 1;

/** The period to compare with: the same number of days just before, or the same dates a year earlier. */
export function comparisonPeriod(from, to, mode = 'previous') {
  if (mode === 'none') return null;
  if (mode === 'lastYear') {
    const shift = d => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y - 1, m - 1, dd)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
    return { from: shift(from), to: shift(to), label: 'Same period last year' };
  }
  const n = days(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1), label: 'Previous period' };
}

// Money that moves but isn't profit or loss: paying suppliers for stock (counted in cost of goods),
// refunds (counted in revenue), customer repayments, owner money and loans.
export const NOT_EXPENSES = new Set(['Supplier Settlement', 'Stock purchases', 'Customer refund', 'Owner drawings', 'Loan repayment']);
export const NOT_INCOME = new Set(['Customer repayment', 'Owner capital', 'Loan received']);
export const INCOME_CATEGORIES = ['Other income', 'Owner capital', 'Loan received', 'Miscellaneous'];
export const EXPENSE_CATEGORIES = ['Rent', 'Utility', 'Salaries & wages', 'Transport', 'Stationery', 'Staff Meal', 'Repairs', 'Supplier Settlement', 'Owner drawings', 'Loan repayment', 'Wastage Adjustment', 'Miscellaneous'];
// A correction is recorded as an opposite entry whose description starts with "Reversal of".
export const isReversal = e => /^Reversal of /i.test(String(e.description || ''));

/** Profit & loss for [from, to] (Lusaka dates, inclusive). */
export function profitAndLoss(data, from, to) {
  const inside = d => d >= from && d <= to;
  const sales = data.sales.filter(s => s.status === 'completed' && inside(localDay(s.created_at)));
  const ids = new Set(sales.map(s => s.id));
  const items = data.sale_items.filter(i => ids.has(i.sale_id));
  const refunds = (data.sale_refunds || []).filter(r => inside(localDay(r.created_at)));
  const refundIds = new Set(refunds.map(r => r.id));
  const restored = (data.refund_items || []).filter(r => refundIds.has(r.refund_id) && r.restocked);
  const itemCost = Object.fromEntries((data.financial_sale_costs || []).map(r => [r.sale_item_id, num(r.unit_cost)]));
  const missing = items.filter(i => itemCost[i.id] === undefined).length + restored.filter(r => itemCost[r.sale_item_id] === undefined).length;

  const gross = sumOf(sales, s => num(s.subtotal)), discounts = sumOf(sales, s => num(s.discount)), refunded = sumOf(refunds, r => num(r.net));
  const revenue = gross - discounts - refunded;
  const cogs = missing ? null : sumOf(items, i => itemCost[i.id] * num(i.quantity)) - sumOf(restored, r => itemCost[r.sale_item_id] * num(r.quantity));
  const grossProfit = cogs === null ? null : revenue - cogs;

  const entries = (data.cashbook_entries || []).filter(e => inside(e.entry_date));
  // Expenses by category; a reversal (income entry "Reversal of …") takes the amount back off its category.
  const byCategory = new Map();
  for (const e of entries) {
    if (e.purchase_id || NOT_EXPENSES.has(e.category) || NOT_INCOME.has(e.category)) continue;
    const cat = e.category || 'Other';
    if (e.type === 'expense' && !isReversal(e)) byCategory.set(cat, num(byCategory.get(cat)) + num(e.amount));
    if (e.type === 'income' && isReversal(e)) byCategory.set(cat, num(byCategory.get(cat)) - num(e.amount));
  }
  for (const [k, v] of byCategory) if (Math.abs(v) < 0.005) byCategory.delete(k);
  const totalExpenses = [...byCategory.values()].reduce((a, b) => a + b, 0);
  const otherIncome = sumOf(entries.filter(e => !NOT_INCOME.has(e.category) && !NOT_EXPENSES.has(e.category) && ((e.type === 'income' && !isReversal(e)) || (e.type === 'expense' && isReversal(e)))), e => (e.type === 'income' ? 1 : -1) * num(e.amount));
  const net = grossProfit === null ? null : grossProfit - totalExpenses + otherIncome;
  const pct = (a, b) => a === null || !b ? null : a / b;

  const lines = [
    { key: 'h-rev', label: 'Revenue', kind: 'header' },
    { key: 'sales', label: 'Sales (before tax)', value: gross, kind: 'item', indent: 1 },
    { key: 'discounts', label: 'Less: discounts given', value: -discounts, kind: 'item', indent: 1 },
    { key: 'refunds', label: 'Less: refunds to customers', value: -refunded, kind: 'item', indent: 1 },
    { key: 'revenue', label: 'Net revenue', value: revenue, kind: 'subtotal' },
    { key: 'cogs', label: 'Cost of goods sold', value: cogs === null ? null : -cogs, kind: 'item', indent: 1 },
    { key: 'gross', label: 'Gross profit', value: grossProfit, kind: 'subtotal' },
    { key: 'gross-margin', label: 'Gross margin', value: pct(grossProfit, revenue), kind: 'percent', indent: 1 },
    { key: 'h-exp', label: 'Operating expenses', kind: 'header' },
    ...[...byCategory].sort((a, b) => b[1] - a[1]).map(([cat, v]) => ({ key: 'exp:' + cat, label: cat, value: -v, kind: 'item', indent: 1 })),
    { key: 'expenses', label: 'Total operating expenses', value: -totalExpenses, kind: 'subtotal' },
    { key: 'other-income', label: 'Other income', value: otherIncome, kind: 'item', indent: 1 },
    { key: 'net', label: 'Net profit', value: net, kind: 'total' },
    { key: 'net-margin', label: 'Net margin', value: pct(net, revenue), kind: 'percent', indent: 1 },
  ];
  return { from, to, lines, missingSaleCosts: missing, revenue, net, grossProfit };
}

/**
 * Balance sheet at the end of `date`.
 * extra.movements: stock_movements recorded after `date` (or all), extra.ledger: customer_ledger rows.
 */
export function balanceSheet(data, date, extra = {}) {
  const after = d => localDay(d) > date;
  const balance = (data.financial_balances || [])[0];
  const productCost = Object.fromEntries((data.financial_product_costs || []).map(r => [r.product_id, num(r.unit_cost)]));

  // Cash: opening cash + every receipt and payment from the opening date to `date`.
  let cash = null;
  if (balance && date >= balance.opening_date) {
    const ledger = cashbookLedger(data.sales, data.payments || [], data.cashbook_entries || []);
    cash = num(balance.opening_cash) + sumOf(ledger.filter(e => e.entry_date >= balance.opening_date && e.entry_date <= date), e => (e.type === 'income' ? 1 : -1) * num(e.amount));
  }

  // Stock: today's quantities with later movements undone, valued at current unit cost.
  const later = new Map();
  for (const mv of extra.movements || []) if (after(mv.created_at)) later.set(mv.product_id, num(later.get(mv.product_id)) + num(mv.quantity));
  let missingCosts = 0, inventory = 0;
  for (const p of data.products) {
    const qty = num(p.stock_quantity) - num(later.get(p.id));
    if (qty <= 0) continue;
    if (productCost[p.id] === undefined) missingCosts++;
    else inventory += qty * productCost[p.id];
  }
  const inventoryValue = missingCosts ? null : inventory;

  // Money customers owe: today's balances with later credit sales and repayments undone.
  const laterCredit = sumOf((extra.ledger || []).filter(l => after(l.created_at)), l => num(l.amount));
  const receivables = Math.max(0, sumOf((data.customers || []).filter(c => num(c.balance) > 0), c => num(c.balance)) - laterCredit);

  // Money owed to suppliers: deliveries received by `date` and not yet paid on that date.
  const paidOn = new Map();
  for (const e of data.cashbook_entries || []) if (e.purchase_id) paidOn.set(e.purchase_id, e.entry_date);
  const payables = sumOf((data.purchase_orders || []).filter(p => {
    if (p.status !== 'received' || !p.received_at || localDay(p.received_at) > date) return false;
    if (!p.paid) return true;
    const on = paidOn.get(p.id);
    return Boolean(on && on > date);
  }), p => num(p.total));

  const otherAssets = balance ? num(balance.other_assets) : null;
  const otherLiabilities = balance ? num(balance.other_liabilities) : null;
  const totalAssets = cash === null || inventoryValue === null || otherAssets === null ? null : cash + inventoryValue + receivables + otherAssets;
  const totalLiabilities = otherLiabilities === null ? null : payables + otherLiabilities;
  const equity = totalAssets === null || totalLiabilities === null ? null : totalAssets - totalLiabilities;

  const lines = [
    { key: 'h-assets', label: 'Assets', kind: 'header' },
    { key: 'cash', label: 'Cash and mobile money', value: cash, kind: 'item', indent: 1 },
    { key: 'inventory', label: 'Stock on hand (at cost)', value: inventoryValue, kind: 'item', indent: 1 },
    { key: 'receivables', label: 'Owed by customers (credit sales)', value: receivables, kind: 'item', indent: 1 },
    { key: 'other-assets', label: 'Other assets', value: otherAssets, kind: 'item', indent: 1 },
    { key: 'assets', label: 'Total assets', value: totalAssets, kind: 'subtotal' },
    { key: 'h-liab', label: 'Liabilities', kind: 'header' },
    { key: 'payables', label: 'Owed to suppliers', value: payables, kind: 'item', indent: 1 },
    { key: 'other-liabilities', label: 'Other liabilities (taxes, loans…)', value: otherLiabilities, kind: 'item', indent: 1 },
    { key: 'liabilities', label: 'Total liabilities', value: totalLiabilities, kind: 'subtotal' },
    { key: 'equity', label: "Owner's equity (assets − liabilities)", value: equity, kind: 'total' },
  ];
  return { date, lines, cash, inventory: inventoryValue, receivables, payables, totalAssets, totalLiabilities, equity, missingCosts, needsOpening: !balance || date < balance.opening_date, openingDate: balance?.opening_date || null };
}

/** Put two statements side by side: { ...line, prev, change } with change as a fraction where it makes sense. */
export function compare(current, previous) {
  const prev = new Map((previous?.lines || []).map(l => [l.key, l]));
  const keys = new Set(current.lines.map(l => l.key));
  // Expense categories that only appear in the comparison period still get a row.
  const extra = (previous?.lines || []).filter(l => !keys.has(l.key) && l.key.startsWith('exp:')).map(l => ({ ...l, value: 0 }));
  const lines = [...current.lines];
  if (extra.length) lines.splice(lines.findIndex(l => l.key === 'expenses'), 0, ...extra);
  return lines.map(l => {
    const p = prev.get(l.key);
    const pv = p ? p.value : (previous ? 0 : undefined);
    const change = l.kind === 'header' || l.kind === 'percent' || l.value == null || pv == null ? null
      : pv === 0 ? null : (l.value - pv) / Math.abs(pv);
    return { ...l, prev: previous ? (p ? p.value : (l.kind === 'header' ? undefined : 0)) : undefined, change };
  });
}

/**
 * Cashbook as a running-balance ledger for [from, to], oldest first.
 * Opening balance = configured opening cash + movements from the opening date to the day before `from`
 * (null when no opening cash is set, or the period starts before it — then the balance runs from 0).
 */
export function cashbookSheet(ledger, from, to, opening = null) {
  let openingBalance = null;
  if (opening && from >= opening.opening_date) {
    openingBalance = round2(num(opening.opening_cash) + sumOf(ledger.filter(e => e.entry_date >= opening.opening_date && e.entry_date < from), e => (e.type === 'income' ? 1 : -1) * num(e.amount)));
  }
  const rows = ledger.filter(e => e.entry_date >= from && e.entry_date <= to)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
  let running = openingBalance ?? 0;
  const out = rows.map(e => {
    const inn = e.type === 'income' ? num(e.amount) : 0, out_ = e.type === 'expense' ? num(e.amount) : 0;
    running = round2(running + inn - out_);
    return { ...e, in: inn, out: out_, balance: running };
  });
  const totalIn = round2(sumOf(out, r => r.in)), totalOut = round2(sumOf(out, r => r.out));
  return { rows: out, openingBalance, totalIn, totalOut, net: round2(totalIn - totalOut), closingBalance: round2((openingBalance ?? 0) + totalIn - totalOut), hasOpening: openingBalance !== null };
}

/** Daily subtotals of a cashbook sheet: [{ day, in, out, balance }]. */
export function dailyTotals(sheet) {
  const m = new Map();
  for (const r of sheet.rows) { const d = m.get(r.entry_date) || { day: r.entry_date, in: 0, out: 0, balance: 0 }; d.in = round2(d.in + r.in); d.out = round2(d.out + r.out); d.balance = r.balance; m.set(r.entry_date, d); }
  return [...m.values()];
}
