// Pure helpers for the Creator console (unit tested).

export const CREATOR_EMAIL = 'dafredmukunah@gmail.com';
const MIN = 60000;

/** online (heartbeat within 2.5 min) · away (within 15 min) · offline */
export function presenceStatus(p, now = Date.now()) {
  const age = now - Date.parse(p.last_seen);
  return age < 2.5 * MIN ? 'online' : age < 15 * MIN ? 'away' : 'offline';
}

export function ago(iso, now = Date.now()) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Crashes grouped by message: how often, how many people and shops, last seen, pages and devices. */
export function groupCrashes(events) {
  const m = new Map();
  for (const e of events) {
    if (e.kind !== 'error') continue;
    const key = e.message || 'Unknown error';
    let g = m.get(key);
    if (!g) { g = { message: key, count: 0, users: new Set(), shops: new Set(), pages: new Set(), devices: new Set(), first: e.created_at, last: e.created_at, latest: e }; m.set(key, g); }
    g.count += 1;
    if (e.user_id) g.users.add(e.user_id);
    if (e.shop) g.shops.add(e.shop);
    if (e.page) g.pages.add(e.page);
    if (e.device || e.browser) g.devices.add([e.device, e.browser, e.os].filter(Boolean).join(' · '));
    if (e.created_at > g.last) { g.last = e.created_at; g.latest = e; }
    if (e.created_at < g.first) g.first = e.created_at;
  }
  return [...m.values()].map(g => ({ ...g, users: g.users.size, shops: [...g.shops], pages: [...g.pages], devices: [...g.devices] }))
    .sort((a, b) => b.last.localeCompare(a.last));
}

/** Visits per day for the last `days` days (oldest first), counting distinct people per day too. */
export function visitsByDay(events, days, now = new Date()) {
  const day = d => new Date(d).toISOString().slice(0, 10);
  const out = new Map();
  for (let i = days - 1; i >= 0; i--) out.set(day(now.getTime() - i * 86400000), { day: day(now.getTime() - i * 86400000), visits: 0, people: new Set() });
  for (const e of events) {
    if (e.kind !== 'visit') continue;
    const r = out.get(day(e.created_at));
    if (r) { r.visits += 1; r.people.add(e.user_id || `anon:${e.city || ''}:${e.device || ''}:${e.browser || ''}`); }
  }
  return [...out.values()].map(r => ({ day: r.day, visits: r.visits, people: r.people.size }));
}

export function signupsByDay(users, days, now = new Date()) {
  const day = d => new Date(d).toISOString().slice(0, 10);
  const out = new Map();
  for (let i = days - 1; i >= 0; i--) out.set(day(now.getTime() - i * 86400000), 0);
  for (const u of users) { const d = day(u.created_at); if (out.has(d)) out.set(d, out.get(d) + 1); }
  return [...out].map(([d, n]) => ({ day: d, count: n }));
}

/** Visit counts per country (ISO alpha-2) and per city point for the map. */
export function places(events) {
  const countries = new Map(), cities = new Map();
  for (const e of events) {
    if (e.country) {
      const c = countries.get(e.country) || { code: e.country, visits: 0, errors: 0 };
      c[e.kind === 'error' ? 'errors' : 'visits'] += 1; countries.set(e.country, c);
    }
    if (e.lat != null && e.lon != null) {
      const k = `${Number(e.lat).toFixed(1)},${Number(e.lon).toFixed(1)}`;
      const c = cities.get(k) || { key: k, lat: Number(e.lat), lon: Number(e.lon), city: e.city, country: e.country, visits: 0, errors: 0 };
      c[e.kind === 'error' ? 'errors' : 'visits'] += 1; cities.set(k, c);
    }
  }
  return { countries: [...countries.values()].sort((a, b) => (b.visits + b.errors) - (a.visits + a.errors)), cities: [...cities.values()] };
}

export const flag = code => code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0))) : '🌐';
