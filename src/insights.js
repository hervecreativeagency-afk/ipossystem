// Pure helpers that turn raw sales rows into dashboard figures.
const lusakaDay = d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lusaka' }).format(new Date(d));
const cents = n => Math.round(Number(n || 0) * 100);

export function dailySeries(sales, days = 7, now = new Date()) {
  const out = [];
  const end = new Date(lusakaDay(now) + 'T12:00:00+02:00');
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end); d.setUTCDate(d.getUTCDate() - i);
    out.push({ day: lusakaDay(d), total: 0, count: 0 });
  }
  const byDay = new Map(out.map(o => [o.day, o]));
  for (const s of sales) {
    const o = byDay.get(lusakaDay(s.created_at));
    if (o) { o.total += cents(s.total); o.count += 1; }
  }
  return out.map(o => ({ ...o, total: o.total / 100 }));
}

export function topProducts(items, limit = 5) {
  const map = new Map();
  for (const i of items) {
    const key = i.product_id || i.product_name;
    const row = map.get(key) || { name: i.product_name, quantity: 0, revenue: 0 };
    row.quantity += Number(i.quantity || 0);
    row.revenue += cents(i.unit_price) * Number(i.quantity || 0);
    map.set(key, row);
  }
  return [...map.values()].map(r => ({ ...r, revenue: r.revenue / 100 }))
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity).slice(0, limit);
}

export const METHODS = ['Cash', 'Airtel Money', 'MTN Money', 'Bank/Card'];
// Payments store the amount handed over; change is always returned in cash,
// so cash kept by the store = cash received - change given.
export function paymentMix(payments, sales = []) {
  const sums = new Map(METHODS.map(m => [m, 0]));
  for (const p of payments) sums.set(p.method, (sums.get(p.method) || 0) + cents(p.amount));
  const change = sales.reduce((n, s) => n + cents(s.change), 0);
  sums.set('Cash', Math.max(0, (sums.get('Cash') || 0) - change));
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()].map(([method, c]) => ({ method, amount: c / 100, share: total ? c / total : 0 }));
}

export function lowStock(products, limit = 6) {
  return products.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold))
    .sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity)).slice(0, limit);
}

export function changeVsPrevious(series) {
  if (series.length < 2) return null;
  const today = series[series.length - 1].total;
  const prior = series.slice(0, -1);
  // Too few trading days makes the comparison meaningless (e.g. +500%).
  if (prior.filter(d => d.total > 0).length < 3) return null;
  const avg = prior.reduce((n, d) => n + d.total, 0) / prior.length;
  if (!avg) return null;
  return (today - avg) / avg;
}
