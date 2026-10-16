// Mistake & fraud checks (unit tested). Each flag is a reason to look, not proof of wrongdoing.
// Input rows come straight from the database tables; everything here is pure.

export const RULES = {
  shortMin: 5,          // drawer short by at least this much is flagged
  shortHigh: 100,       // …and is serious from this amount
  overMin: 50,          // drawer over by this much (sales may not have been rung up)
  repeatShort: 2,       // short shifts by the same cashier in the period
  quickRefundMins: 15,  // refund within this many minutes of the sale
  lateRefundDays: 30,   // refund this long after the sale
  heavyRefundCount: 3,  // refunds on one cashier's sales…
  heavyRefundShare: 0.1, // …worth at least this share of their sales
  discountShare: 0.2,   // discount of 20% or more of the sale
  discountHigh: 0.5,
  lowPriceShare: 0.7,   // sold below 70% of the current price
  nightStart: 22, nightEnd: 5, // sales between 22:00 and 05:00
  lossCount: 3,         // 3+ missing/damaged adjustments of one product
  lossUnits: 20,        // or one adjustment removing 20+ units
  cashOutMin: 500,      // a single cash withdrawal from the drawer of this size
};

const LOSS = /missing|damage|wast|theft|stolen|lost|expired/i;
const minutes = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;
const lusakaHour = iso => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
const num = v => Number(v) || 0;
const round = n => Math.round(n * 100) / 100;

/**
 * @param data { sales, refundSales, items, refunds, shifts, cashEvents, adjustments, products, staff }
 * @param fmt  money formatter (n => 'K 12.00')
 * @returns flags sorted newest first: { key, type, severity: 'high'|'medium'|'low', title, detail, at, who, amount, ref }
 */
export function computeFlags(data, fmt = n => n.toFixed(2), rules = RULES) {
  const { sales = [], refundSales = [], items = [], refunds = [], shifts = [], cashEvents = [], adjustments = [], products = [], staff = [] } = data;
  const out = [];
  // refundSales: older sales that refunds in this period point at (not counted as this period's sales)
  const saleById = new Map([...refundSales, ...sales].map(s => [s.id, s]));
  const productById = new Map(products.map(p => [p.id, p]));
  const nameOf = id => staff.find(s => s.user_id === id)?.full_name || 'Staff member';

  // 1. Drawer short / over at close
  const shortBy = new Map();
  for (const sh of shifts) {
    if (sh.status !== 'closed' || sh.variance == null) continue;
    const v = num(sh.variance);
    if (v <= -rules.shortMin) {
      shortBy.set(sh.cashier_id, [...(shortBy.get(sh.cashier_id) || []), sh]);
      out.push({ key: 'short:' + sh.id, type: 'short', severity: -v >= rules.shortHigh ? 'high' : 'medium', title: `Drawer short by ${fmt(-v)}`,
        detail: `Counted ${fmt(num(sh.counted_cash))} but expected ${fmt(num(sh.expected_cash))} when the shift closed.`, at: sh.closed_at, who: sh.cashier_name, amount: -v, ref: sh.id });
    } else if (v >= rules.overMin) {
      out.push({ key: 'over:' + sh.id, type: 'over', severity: 'low', title: `Drawer over by ${fmt(v)}`,
        detail: 'More cash than expected can mean a sale was not rung up, or change was not given.', at: sh.closed_at, who: sh.cashier_name, amount: v, ref: sh.id });
    }
  }
  for (const [cashier, list] of shortBy) {
    if (list.length < rules.repeatShort) continue;
    const total = list.reduce((n, s) => n - num(s.variance), 0);
    const last = list.map(s => s.closed_at).sort().at(-1);
    out.push({ key: `repeat-short:${cashier}:${list.length}`, type: 'repeat-short', severity: 'high', title: `${list[0].cashier_name || nameOf(cashier)}: drawer short ${list.length} times`,
      detail: `${list[0].cashier_name || nameOf(cashier)}'s drawer was short on ${list.length} shifts, ${fmt(total)} in total.`, at: last, who: list[0].cashier_name || nameOf(cashier), amount: total, ref: cashier });
  }

  // 2. Refunds: very soon after the sale, long after, and unusually many for one cashier
  const refundsByCashier = new Map();
  for (const r of refunds) {
    const sale = saleById.get(r.sale_id);
    if (sale) {
      const mins = minutes(sale.created_at, r.created_at);
      const who = sale.cashier_name || nameOf(sale.cashier_id);
      if (mins >= 0 && mins <= rules.quickRefundMins) {
        out.push({ key: 'quick-refund:' + r.id, type: 'quick-refund', severity: 'medium', title: `Refund ${Math.max(1, Math.round(mins))} min after the sale`,
          detail: `${fmt(num(r.total))} refunded on receipt ${sale.receipt_number}${r.approved_name ? `, approved by ${r.approved_name}` : ''}. Reason: ${r.reason || 'none given'}.`, at: r.created_at, who, amount: num(r.total), ref: sale.receipt_number });
      } else if (mins > rules.lateRefundDays * 1440) {
        out.push({ key: 'late-refund:' + r.id, type: 'late-refund', severity: 'low', title: `Refund ${Math.round(mins / 1440)} days after the sale`,
          detail: `${fmt(num(r.total))} refunded on receipt ${sale.receipt_number}. Check the customer returned the goods.`, at: r.created_at, who: r.approved_name || who, amount: num(r.total), ref: sale.receipt_number });
      }
      const k = sale.cashier_id;
      refundsByCashier.set(k, [...(refundsByCashier.get(k) || []), r]);
    }
  }
  const salesByCashier = new Map();
  for (const s of sales) salesByCashier.set(s.cashier_id, num(salesByCashier.get(s.cashier_id)) + num(s.total));
  for (const [cashier, list] of refundsByCashier) {
    const value = list.reduce((n, r) => n + num(r.total), 0), sold = num(salesByCashier.get(cashier));
    if (list.length >= rules.heavyRefundCount && sold > 0 && value / sold >= rules.heavyRefundShare) {
      const who = saleById.get(list[0].sale_id)?.cashier_name || nameOf(cashier);
      out.push({ key: `many-refunds:${cashier}:${list.length}`, type: 'many-refunds', severity: 'medium', title: `${list.length} refunds on one cashier's sales`,
        detail: `${fmt(value)} refunded — ${Math.round(value / sold * 100)}% of ${who}'s sales in this period.`, at: list.map(r => r.created_at).sort().at(-1), who, amount: value, ref: cashier });
    }
  }

  // 3. Big discounts, prices well below the product price, and sales late at night
  const itemsBySale = new Map();
  for (const i of items) itemsBySale.set(i.sale_id, [...(itemsBySale.get(i.sale_id) || []), i]);
  for (const s of sales) {
    const who = s.cashier_name || nameOf(s.cashier_id);
    const gross = num(s.subtotal) + num(s.tax);
    const share = gross > 0 ? num(s.discount) / gross : 0;
    if (share >= rules.discountShare) {
      out.push({ key: 'discount:' + s.id, type: 'discount', severity: share >= rules.discountHigh ? 'high' : 'medium', title: `${Math.round(share * 100)}% discount`,
        detail: `${fmt(num(s.discount))} off receipt ${s.receipt_number} (total ${fmt(num(s.total))}).`, at: s.created_at, who, amount: num(s.discount), ref: s.receipt_number });
    }
    const cheap = (itemsBySale.get(s.id) || []).filter(i => {
      const p = productById.get(i.product_id);
      return p && num(p.selling_price) > 0 && num(i.unit_price) < num(p.selling_price) * rules.lowPriceShare;
    });
    if (cheap.length) {
      const lost = cheap.reduce((n, i) => n + (num(productById.get(i.product_id).selling_price) - num(i.unit_price)) * num(i.quantity), 0);
      const first = cheap[0], p = productById.get(first.product_id);
      out.push({ key: 'low-price:' + s.id, type: 'low-price', severity: 'medium', title: 'Sold below the usual price',
        detail: `${first.product_name || p.name} sold at ${fmt(num(first.unit_price))} (price now ${fmt(num(p.selling_price))})${cheap.length > 1 ? ` and ${cheap.length - 1} more` : ''} on receipt ${s.receipt_number}. The price may have changed since.`, at: s.created_at, who, amount: round(lost), ref: s.receipt_number });
    }
    const h = lusakaHour(s.created_at);
    if (h >= rules.nightStart || h < rules.nightEnd) {
      out.push({ key: 'night:' + s.id, type: 'night', severity: 'low', title: 'Sale late at night',
        detail: `Receipt ${s.receipt_number} for ${fmt(num(s.total))} between ${String(h).padStart(2, '0')}:00 and ${String((h + 1) % 24).padStart(2, '0')}:00.`, at: s.created_at, who, amount: num(s.total), ref: s.receipt_number });
    }
  }

  // 4. Stock going missing
  const lossByProduct = new Map();
  for (const a of adjustments) {
    const q = num(a.quantity);
    if (q >= 0) continue;
    const p = productById.get(a.product_id), name = p?.name || 'A product';
    if (LOSS.test(a.reason || '')) lossByProduct.set(a.product_id, [...(lossByProduct.get(a.product_id) || []), a]);
    if (-q >= rules.lossUnits) {
      out.push({ key: 'big-loss:' + a.id, type: 'big-loss', severity: 'medium', title: `${-q} × ${name} removed from stock`,
        detail: `Reason: ${a.reason || 'none'}${a.notes ? ` — “${a.notes}”` : ''}.${p ? ` Worth about ${fmt(-q * num(p.selling_price))} at selling price.` : ''}`, at: a.created_at, who: nameOf(a.created_by), amount: p ? -q * num(p.selling_price) : 0, ref: a.product_id });
    }
  }
  for (const [pid, list] of lossByProduct) {
    if (list.length < rules.lossCount) continue;
    const units = list.reduce((n, a) => n - num(a.quantity), 0), p = productById.get(pid);
    out.push({ key: `repeat-loss:${pid}:${list.length}`, type: 'repeat-loss', severity: 'medium', title: `${p?.name || 'A product'} keeps going missing`,
      detail: `${list.length} adjustments (${[...new Set(list.map(a => a.reason))].join(', ')}) removed ${units} units in this period.`, at: list.map(a => a.created_at).sort().at(-1), who: [...new Set(list.map(a => nameOf(a.created_by)))].join(', '), amount: p ? units * num(p.selling_price) : 0, ref: pid });
  }

  // 5. Large cash taken out of a drawer
  for (const e of cashEvents) {
    if (e.type !== 'out' || num(e.amount) < rules.cashOutMin) continue;
    out.push({ key: 'cash-out:' + e.id, type: 'cash-out', severity: 'low', title: `${fmt(num(e.amount))} taken out of the drawer`,
      detail: `Reason: ${e.reason || 'none given'}. Check it was approved and recorded.`, at: e.created_at, who: nameOf(e.created_by), amount: num(e.amount), ref: e.shift_id });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || order[a.severity] - order[b.severity]);
}

// Summary flags repeat money already counted in the single flags they group.
export const GROUPED = new Set(['repeat-short', 'many-refunds', 'repeat-loss']);

export function summarize(flags, reviews = {}) {
  const open = flags.filter(f => !reviews[f.key] || reviews[f.key].status === 'open');
  const looking = flags.filter(f => reviews[f.key]?.status === 'investigating');
  const fine = flags.filter(f => reviews[f.key]?.status === 'ok');
  return { open, looking, fine, high: open.filter(f => f.severity === 'high').length };
}
