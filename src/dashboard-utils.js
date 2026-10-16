// Small chart helpers for the home dashboard (unit tested).

const lusakaDay = iso => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lusaka' }).format(new Date(iso));
const lusakaHour = iso => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));

/** Percentage change as a fraction (0.25 = +25%); null when there is nothing to compare with. */
export const pctChange = (now, before) => before > 0 ? (now - before) / before : null;

/**
 * Sales by hour for `today`, next to a usual day (average of the other days in the data that had sales).
 * Returns only the hours the shop trades in: [{ hour, today, usual }].
 */
export function hourly(sales, today, days = 14) {
  const todayH = new Array(24).fill(0), otherH = new Array(24).fill(0), otherDays = new Set();
  for (const s of sales) {
    const d = lusakaDay(s.created_at), h = lusakaHour(s.created_at), v = Number(s.total) || 0;
    if (d === today) todayH[h] += v;
    else { otherH[h] += v; otherDays.add(d); }
  }
  const n = Math.max(1, Math.min(days - 1, otherDays.size));
  const active = todayH.map((v, h) => v > 0 || otherH[h] > 0 ? h : null).filter(h => h !== null);
  if (!active.length) return [];
  const from = Math.min(...active), to = Math.max(...active);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i).map(h => ({ hour: h, today: Math.round(todayH[h] * 100) / 100, usual: Math.round(otherH[h] / n * 100) / 100 }));
}

/** SVG paths for a sparkline: { line, area, last: [x, y] }; null with fewer than two points. */
export function sparkPath(values, w, h, pad = 2) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(0, ...values), span = max - min || 1;
  const pts = values.map((v, i) => [pad + (i * (w - pad * 2)) / (values.length - 1), pad + (h - pad * 2) * (1 - (v - min) / span)]);
  const f = n => Math.round(n * 10) / 10;
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join(' ');
  const area = `${line} L${f(pts.at(-1)[0])},${h} L${f(pts[0][0])},${h} Z`;
  return { line, area, last: pts.at(-1).map(f) };
}
