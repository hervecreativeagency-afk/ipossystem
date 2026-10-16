// Smart reordering: when will each product run out, based on how fast it really sells (unit tested).
//
// Speed = a blend of the last 7 days and the whole period (recent days count more), so a product
// that suddenly sells faster is caught early, while one quiet day doesn't hide a steady seller.
// Days left = stock ÷ speed. "Order by" leaves `leadDays` for the delivery to arrive.

const DAY = 86400000;
const lusakaDay = iso => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lusaka' }).format(new Date(iso));
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);
const num = v => Number(v) || 0;

/**
 * @param products  [{ id, name, stock_quantity, low_stock_threshold }]
 * @param sales     [{ id, created_at }]   sales in the period
 * @param items     [{ sale_id, product_id, quantity }]
 * @param today     'YYYY-MM-DD' (Lusaka)
 * @param days      length of the period the sales cover
 * @param onOrder   Map(product_id → quantity already ordered and not yet received)
 * @returns one row per product that sells: { product_id, name, stock, perDay, recentPerDay, daysLeft, runOut, orderBy, suggested, trend, status }
 */
export function forecast({ products = [], sales = [], items = [], today, days = 30, onOrder = new Map(), leadDays = 2, coverDays = 14 }) {
  const dayOf = new Map(sales.map(s => [s.id, lusakaDay(s.created_at)]));
  const first = sales.length ? sales.map(s => dayOf.get(s.id)).sort()[0] : today;
  // A young shop: speed is per day it has been trading, not per day of the whole period.
  const span = Math.max(1, Math.min(days, daysBetween(first, today) + 1));
  const recentSpan = Math.min(7, span), recentFrom = addDays(today, -(recentSpan - 1));
  const total = new Map(), recent = new Map();
  for (const i of items) {
    const d = dayOf.get(i.sale_id);
    if (!d) continue;
    total.set(i.product_id, num(total.get(i.product_id)) + num(i.quantity));
    if (d >= recentFrom) recent.set(i.product_id, num(recent.get(i.product_id)) + num(i.quantity));
  }
  const rows = [];
  for (const p of products) {
    if (p.active === false || !total.get(p.id)) continue;
    const long = total.get(p.id) / span, short = num(recent.get(p.id)) / recentSpan;
    const perDay = span > recentSpan ? 0.6 * short + 0.4 * long : long;
    if (perDay <= 0) continue;
    const stock = Math.max(0, num(p.stock_quantity)), pending = num(onOrder.get(p.id)), threshold = Math.max(0, num(p.low_stock_threshold));
    const daysLeft = stock / perDay;
    const runOut = addDays(today, Math.floor(daysLeft));
    const orderBy = addDays(today, Math.max(0, Math.floor(daysLeft) - leadDays));
    const suggested = Math.max(0, Math.ceil(perDay * coverDays + threshold - stock - pending));
    const trend = span >= 14 && long > 0 ? (short >= long * 1.3 ? 'faster' : short <= long * 0.7 ? 'slower' : 'steady') : 'steady';
    const status = stock <= 0 ? 'out' : daysLeft < 3 ? 'urgent' : daysLeft < 7 ? 'soon' : daysLeft < 14 ? 'watch' : 'ok';
    rows.push({ product_id: p.id, name: p.name, stock, perDay, recentPerDay: short, daysLeft, runOut, orderBy, suggested, onOrder: pending, trend, status });
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft || b.perDay - a.perDay);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = day => { const d = new Date(day + 'T12:00:00Z'); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const rate = n => n >= 10 ? Math.round(n) : n >= 1 ? Math.round(n * 10) / 10 : Math.round(n * 10) / 10 || 0.1;

/** "You'll run out of Sugar 2kg in about 4 days (Tue 20 Oct)." */
export function runOutSentence(r) {
  const d = Math.floor(r.daysLeft);
  if (r.stock <= 0) return `${r.name} is out of stock — it sells about ${rate(r.perDay)} a day.`;
  if (d <= 0) return `You'll run out of ${r.name} today at the current pace.`;
  if (d === 1) return `You'll run out of ${r.name} tomorrow.`;
  return `You'll run out of ${r.name} in about ${d} days (${shortDate(r.runOut)}).`;
}

/** The advice under the sentence: when to order, how many, and whether it is speeding up. */
export function adviceLine(r, today) {
  const parts = [];
  if (r.onOrder > 0) parts.push(`${r.onOrder} already on order`);
  if (r.suggested > 0) parts.push(r.orderBy <= today ? `Order ${r.suggested} now` : `Order ${r.suggested} by ${shortDate(r.orderBy)}`);
  if (r.trend === 'faster') parts.push('selling faster this week');
  if (r.trend === 'slower') parts.push('selling slower this week');
  parts.push(`sells ~${rate(r.perDay)}/day`);
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Products that need attention within `horizon` days (out of stock first). */
export const runningOut = (rows, horizon = 14) => rows.filter(r => r.daysLeft < horizon);
