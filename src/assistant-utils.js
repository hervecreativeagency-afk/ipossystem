// Business assistant: plain-language answers from the shop's own numbers (unit tested).
// No AI service — every answer is worked out here from sales, items, payments, stock and customers.
//
// ctx = { today: 'YYYY-MM-DD' (Lusaka), fmt: n => 'K 1.00', sales, items, payments, products, costs: Map(product_id → unit cost),
//         customers, batches, branches, multiBranch }
// sales: { id, created_at, total, cashier_id, cashier_name, branch_id }   items: { sale_id, product_id, product_name, quantity, unit_price }

const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const lusakaDay = iso => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lusaka' }).format(new Date(iso));
const lusakaHour = iso => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekday = day => WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()];
const num = v => Number(v) || 0;
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const names = (list, max = 3) => list.length <= max ? joinAnd(list) : `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
const joinAnd = list => list.length < 2 ? (list[0] || '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
const change = (now, before, fmt) => {
  const p = pct(now, before);
  if (p === null) return before === 0 && now > 0 ? 'and there were no sales in the period before' : '';
  if (p === 0) return 'the same as before';
  return `${p > 0 ? 'up' : 'down'} ${Math.abs(p)}% on ${fmt ? fmt(before) : before}`;
};

function salesBetween(ctx, from, to) { return ctx.sales.filter(s => { const d = lusakaDay(s.created_at); return d >= from && d <= to; }); }
function itemsFor(ctx, sales) { const ids = new Set(sales.map(s => s.id)); return ctx.items.filter(i => ids.has(i.sale_id)); }
function byProduct(items) {
  const m = new Map();
  for (const i of items) {
    const r = m.get(i.product_id) || { product_id: i.product_id, name: i.product_name, quantity: 0, revenue: 0 };
    r.quantity += num(i.quantity); r.revenue += num(i.quantity) * num(i.unit_price); m.set(i.product_id, r);
  }
  return [...m.values()];
}
const last30 = ctx => salesBetween(ctx, addDays(ctx.today, -29), ctx.today);

// ---------------------------------------------------------------- daily summary
export function dailyBrief(ctx) {
  const { today, fmt } = ctx, yesterday = addDays(today, -1), lastWeek = addDays(today, -8);
  const ySales = salesBetween(ctx, yesterday, yesterday), lwSales = salesBetween(ctx, lastWeek, lastWeek), tSales = salesBetween(ctx, today, today);
  const yTotal = sum(ySales, s => num(s.total)), lwTotal = sum(lwSales, s => num(s.total));
  const lines = [];
  if (ySales.length) {
    const c = change(yTotal, lwTotal, fmt);
    lines.push(`Yesterday (${weekday(yesterday)}) you sold ${fmt(yTotal)} in ${plural(ySales.length, 'sale')}${c ? `, ${c} last ${weekday(yesterday)}` : ''}.`);
    const top = byProduct(itemsFor(ctx, ySales)).sort((a, b) => b.revenue - a.revenue)[0];
    if (top) lines.push(`Your best seller was ${top.name} (${top.quantity} sold, ${fmt(top.revenue)}).`);
  } else lines.push(`There were no sales yesterday (${weekday(yesterday)}).`);
  if (tSales.length) lines.push(`Today so far: ${fmt(sum(tSales, s => num(s.total)))} from ${plural(tSales.length, 'sale')}.`);

  const soldRecently = new Set(itemsFor(ctx, salesBetween(ctx, addDays(today, -6), today)).map(i => i.product_id));
  const empty = ctx.products.filter(p => num(p.stock_quantity) <= 0 && soldRecently.has(p.id)).map(p => p.name);
  if (empty.length) lines.push(`${plural(empty.length, 'product')} that sold this week ${empty.length === 1 ? 'is' : 'are'} now out of stock: ${names(empty)}.`);
  const low = ctx.products.filter(p => num(p.stock_quantity) > 0 && num(p.stock_quantity) <= num(p.low_stock_threshold));
  if (low.length) lines.push(`${plural(low.length, 'product')} ${low.length === 1 ? 'is' : 'are'} running low.`);
  const soon = (ctx.batches || []).filter(b => num(b.quantity) > 0 && b.expiry_date <= addDays(today, 7));
  const expired = soon.filter(b => b.expiry_date < today);
  if (expired.length) lines.push(`${plural(expired.length, 'batch', 'batches')} of stock ${expired.length === 1 ? 'has' : 'have'} expired — remove ${expired.length === 1 ? 'it' : 'them'} from the shelf.`);
  else if (soon.length) lines.push(`${plural(soon.length, 'batch', 'batches')} of stock expire${soon.length === 1 ? 's' : ''} within 7 days — sell ${soon.length === 1 ? 'it' : 'them'} first.`);
  const owed = (ctx.customers || []).filter(c => num(c.balance) > 0);
  if (owed.length) lines.push(`Customers owe you ${fmt(sum(owed, c => num(c.balance)))} on credit.`);
  return { title: 'Your daily summary', lines };
}

// ---------------------------------------------------------------- questions
export const QUESTIONS = [
  { id: 'week', q: 'How did we do this week?', words: ['week', 'weekly', 'how did', 'doing', 'perform', 'compare', 'last week', 'sales'] },
  { id: 'best', q: 'What sells best?', words: ['best', 'top', 'popular', 'sells', 'selling', 'most sold', 'fast'] },
  { id: 'profit', q: 'What makes me the most profit?', words: ['profit', 'margin', 'make money', 'earn', 'gain'] },
  { id: 'slow', q: "What isn't selling?", words: ['not selling', "isn't selling", 'slow', 'dead', 'stuck', 'no sales', 'tied up'] },
  { id: 'reorder', q: 'What should I reorder?', words: ['reorder', 'order', 'restock', 'buy', 'running out', 'low stock', 'finish'] },
  { id: 'busy', q: 'When are we busiest?', words: ['busy', 'busiest', 'time', 'hour', 'day', 'quiet', 'peak', 'when'] },
  { id: 'pay', q: 'How do customers pay?', words: ['pay', 'payment', 'cash', 'mobile money', 'airtel', 'mtn', 'card', 'method'] },
  { id: 'credit', q: 'Who owes me money?', words: ['owe', 'owes', 'credit', 'debt', 'balance', 'debtors', 'account'] },
  { id: 'cashiers', q: 'Which cashier sells the most?', words: ['cashier', 'staff', 'employee', 'worker', 'who sells'] },
  { id: 'branches', q: 'How are my branches doing?', words: ['branch', 'branches', 'shop', 'shops', 'location', 'store'], multiBranchOnly: true },
];

export function availableQuestions(ctx, role) {
  return QUESTIONS.filter(q => (!q.multiBranchOnly || ctx.multiBranch) && !(role !== 'director' && ['profit', 'cashiers'].includes(q.id)));
}

// Pick the ready-made question closest to what the person typed (null if nothing fits).
export function matchQuestion(text, list = QUESTIONS) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  let best = null, score = 0;
  for (const q of list) {
    const s = q.words.reduce((n, w) => n + (t.includes(' ' + w) ? w.split(' ').length + 1 : 0), 0);
    if (s > score) { score = s; best = q; }
  }
  return best;
}

export function answer(id, ctx) {
  const fn = ANSWERS[id];
  return fn ? fn(ctx) : null;
}

const ANSWERS = {
  week(ctx) {
    const { today, fmt } = ctx;
    const now = salesBetween(ctx, addDays(today, -6), today), before = salesBetween(ctx, addDays(today, -13), addDays(today, -7));
    const a = sum(now, s => num(s.total)), b = sum(before, s => num(s.total));
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map(d => ({ day: d, total: sum(now.filter(s => lusakaDay(s.created_at) === d), s => num(s.total)) }));
    const best = [...days].sort((x, y) => y.total - x.total)[0], worst = [...days].sort((x, y) => x.total - y.total)[0];
    const lines = [`In the last 7 days you sold ${fmt(a)} from ${plural(now.length, 'sale')}${b || a ? `, ${change(a, b, fmt) || 'no change'} the 7 days before` : ''}.`];
    if (now.length) lines.push(`The average sale was ${fmt(a / now.length)}${before.length ? ` (before: ${fmt(b / before.length)})` : ''}.`, `Best day: ${weekday(best.day)} with ${fmt(best.total)}. Slowest: ${weekday(worst.day)} with ${fmt(worst.total)}.`);
    return { lines, bars: days.map(d => ({ label: weekday(d.day).slice(0, 3), value: d.total, text: fmt(d.total) })) };
  },
  best(ctx) {
    const rows = byProduct(itemsFor(ctx, last30(ctx))).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    if (!rows.length) return { lines: ['No sales in the last 30 days yet.'] };
    return { lines: [`Over the last 30 days, ${rows[0].name} brought in the most money: ${ctx.fmt(rows[0].revenue)} from ${rows[0].quantity} sold.`],
      table: { columns: ['Product', 'Sold', 'Money in'], rows: rows.map(r => [r.name, r.quantity, ctx.fmt(r.revenue)]) } };
  },
  profit(ctx) {
    const sold = byProduct(itemsFor(ctx, last30(ctx)));
    const withCost = sold.filter(r => ctx.costs.has(r.product_id)).map(r => ({ ...r, profit: r.revenue - r.quantity * num(ctx.costs.get(r.product_id)) })).sort((a, b) => b.profit - a.profit);
    const missing = sold.length - withCost.length;
    const note = missing ? `${plural(missing, 'product')} that sold ${missing === 1 ? 'has' : 'have'} no purchase cost yet, so ${missing === 1 ? 'it is' : 'they are'} left out. Add costs on the Products page for a full picture.` : null;
    if (!withCost.length) return { lines: ['Add purchase costs to your products to see profit. Open a product and fill in “Purchase cost”.'], link: { to: '/products', label: 'Add purchase costs' } };
    const top = withCost[0], total = sum(withCost, r => r.profit);
    return { lines: [`In the last 30 days you made about ${ctx.fmt(total)} profit on products with a purchase cost (money in minus what you paid).`, `${top.name} made the most: ${ctx.fmt(top.profit)}.`, ...(note ? [note] : [])],
      table: { columns: ['Product', 'Sold', 'Profit', 'Margin'], rows: withCost.slice(0, 5).map(r => [r.name, r.quantity, ctx.fmt(r.profit), r.revenue ? Math.round(r.profit / r.revenue * 100) + '%' : '—']) } };
  },
  slow(ctx) {
    const sold = new Set(itemsFor(ctx, last30(ctx)).map(i => i.product_id));
    const rows = ctx.products.filter(p => num(p.stock_quantity) > 0 && !sold.has(p.id)).map(p => ({ name: p.name, stock: num(p.stock_quantity), value: num(p.stock_quantity) * num(ctx.costs.get(p.id) ?? p.selling_price) })).sort((a, b) => b.value - a.value);
    if (!rows.length) return { lines: ['Everything you have in stock sold at least once in the last 30 days.'] };
    return { lines: [`${plural(rows.length, 'product')} in stock didn't sell at all in the last 30 days, holding about ${ctx.fmt(sum(rows, r => r.value))} of stock.`, 'Consider a discount, moving them to the front, or not reordering them.'],
      table: { columns: ['Product', 'In stock', 'Stock value'], rows: rows.slice(0, 8).map(r => [r.name, r.stock, ctx.fmt(r.value)]) } };
  },
  reorder(ctx) {
    const items = itemsFor(ctx, last30(ctx)), perDay = new Map();
    for (const i of items) perDay.set(i.product_id, num(perDay.get(i.product_id)) + num(i.quantity) / 30);
    const rows = ctx.products.filter(p => num(p.stock_quantity) <= num(p.low_stock_threshold) || (perDay.get(p.id) && num(p.stock_quantity) / perDay.get(p.id) < 7))
      .map(p => ({ name: p.name, stock: num(p.stock_quantity), rate: perDay.get(p.id) || 0 })).map(r => ({ ...r, days: r.rate ? r.stock / r.rate : null }))
      .sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
    if (!rows.length) return { lines: ['Nothing is running low. Every product has more than a week of stock at the current pace.'] };
    const urgent = rows.filter(r => r.days !== null && r.days < 3);
    return { lines: [`${plural(rows.length, 'product')} ${rows.length === 1 ? 'needs' : 'need'} reordering soon${urgent.length ? `; ${urgent.length} will run out within 3 days` : ''}.`],
      table: { columns: ['Product', 'In stock', 'Sells per day', 'Lasts'], rows: rows.slice(0, 8).map(r => [r.name, r.stock, r.rate ? r.rate.toFixed(1) : '—', r.days === null ? '—' : r.stock <= 0 ? 'Out now' : r.days < 1 ? 'Under a day' : `${Math.floor(r.days)} days`]) },
      link: { to: '/reorder', label: 'Open the reorder list' } };
  },
  busy(ctx) {
    const list = salesBetween(ctx, addDays(ctx.today, -27), ctx.today);
    if (!list.length) return { lines: ['No sales in the last 4 weeks yet.'] };
    const hours = new Array(24).fill(0), days = new Array(7).fill(0);
    for (const s of list) { hours[lusakaHour(s.created_at)] += 1; days[new Date(lusakaDay(s.created_at) + 'T12:00:00Z').getUTCDay()] += 1; }
    const peak = hours.indexOf(Math.max(...hours)), open = hours.map((n, h) => [n, h]).filter(([n]) => n > 0).map(([, h]) => h);
    const order = [1, 2, 3, 4, 5, 6, 0], busiest = order.reduce((a, b) => days[b] > days[a] ? b : a, 1), quietest = order.reduce((a, b) => days[b] < days[a] ? b : a, 1);
    const h = n => `${String(n).padStart(2, '0')}:00`;
    return { lines: [`Your busiest hour is ${h(peak)}–${h((peak + 1) % 24)}, and your busiest day is ${WEEKDAYS[busiest]} (${plural(days[busiest], 'sale')} over 4 weeks).`,
      `${WEEKDAYS[quietest]} is the quietest day. Sales happen between ${h(Math.min(...open))} and ${h(Math.max(...open) + 1)}.`, 'Make sure your best cashiers work the busy hours, and do stock counts in the quiet ones.'],
      bars: open.length ? Array.from({ length: Math.max(...open) - Math.min(...open) + 1 }, (_, i) => Math.min(...open) + i).map(x => ({ label: h(x).slice(0, 2), value: hours[x], text: String(hours[x]) })) : [] };
  },
  pay(ctx) {
    const ids = new Set(last30(ctx).map(s => s.id)), m = new Map();
    for (const p of ctx.payments.filter(p => ids.has(p.sale_id))) m.set(p.method, num(m.get(p.method)) + num(p.amount));
    const rows = [...m].sort((a, b) => b[1] - a[1]), total = sum(rows, r => r[1]);
    if (!total) return { lines: ['No payments recorded in the last 30 days yet.'] };
    return { lines: [`${rows[0][0]} is the most used: ${Math.round(rows[0][1] / total * 100)}% of the money taken in the last 30 days.`],
      bars: rows.map(([k, v]) => ({ label: k, value: v, text: `${ctx.fmt(v)} · ${Math.round(v / total * 100)}%` })) };
  },
  credit(ctx) {
    const owed = (ctx.customers || []).filter(c => num(c.balance) > 0).sort((a, b) => num(b.balance) - num(a.balance));
    if (!owed.length) return { lines: ['Nobody owes you money right now.'] };
    const over = owed.filter(c => num(c.credit_limit) > 0 && num(c.balance) > num(c.credit_limit));
    return { lines: [`${plural(owed.length, 'customer')} owe${owed.length === 1 ? 's' : ''} you ${ctx.fmt(sum(owed, c => num(c.balance)))} in total.`, ...(over.length ? [`${names(over.map(c => c.name))} ${over.length === 1 ? 'is' : 'are'} over their credit limit.`] : [])],
      table: { columns: ['Customer', 'Phone', 'Owes'], rows: owed.slice(0, 8).map(c => [c.name, c.phone || '—', ctx.fmt(num(c.balance))]) }, link: { to: '/customers', label: 'Open customers' } };
  },
  cashiers(ctx) {
    const m = new Map();
    for (const s of last30(ctx)) { const r = m.get(s.cashier_id) || { name: s.cashier_name || 'Staff member', total: 0, count: 0 }; r.total += num(s.total); r.count += 1; m.set(s.cashier_id, r); }
    const rows = [...m.values()].sort((a, b) => b.total - a.total);
    if (!rows.length) return { lines: ['No sales in the last 30 days yet.'] };
    return { lines: [`${rows[0].name} sold the most in the last 30 days: ${ctx.fmt(rows[0].total)} from ${plural(rows[0].count, 'sale')}.`],
      table: { columns: ['Cashier', 'Sales', 'Money in', 'Average sale'], rows: rows.map(r => [r.name, r.count, ctx.fmt(r.total), ctx.fmt(r.total / r.count)]) } };
  },
  branches(ctx) {
    const now = last30(ctx), m = new Map();
    for (const s of now) m.set(s.branch_id, num(m.get(s.branch_id)) + num(s.total));
    const rows = (ctx.branches || []).map(b => ({ name: b.name, total: num(m.get(b.id)) })).sort((a, b) => b.total - a.total);
    if (!rows.length || !sum(rows, r => r.total)) return { lines: ['No branch sales in the last 30 days yet.'] };
    const all = sum(rows, r => r.total);
    return { lines: [`${rows[0].name} brought in the most in the last 30 days: ${ctx.fmt(rows[0].total)} (${Math.round(rows[0].total / all * 100)}% of all sales).`],
      bars: rows.map(r => ({ label: r.name, value: r.total, text: ctx.fmt(r.total) })) };
  },
};
