// Receives iPOS background reports (visits, crashes, "I'm online") and adds the approximate
// location Vercel works out from the connection (country, region, city — never GPS).
// It passes the signed-in person's own token to Supabase, so the database decides what is allowed.
// The URL and key are the same public values the app itself uses (.env.production).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qnwkrmhyyagywbnphmxa.supabase.co';
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1lAKyMOmX0ai90lwfeG2Gg_7H8Sk86S';

const text = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const num = v => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const decode = v => { try { return v ? decodeURIComponent(v) : null; } catch { return v || null; } };
const uuid = v => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b !== 'object') { res.status(400).end(); return; }
  const h = req.headers;
  const geo = {
    p_country: text(h['x-vercel-ip-country'], 2), p_region: text(decode(h['x-vercel-ip-country-region']), 80),
    p_city: text(decode(h['x-vercel-ip-city']), 80), p_lat: num(h['x-vercel-ip-latitude']), p_lon: num(h['x-vercel-ip-longitude']),
  };
  const device = { p_page: text(b.page, 200), p_device: text(b.device, 40), p_browser: text(b.browser, 60), p_os: text(b.os, 60), p_version: text(b.version, 40) };
  let fn, args;
  if (b.kind === 'heartbeat') {
    fn = 'app_heartbeat';
    args = { p_company_id: uuid(b.company_id), ...device, p_connection: b.connection === 'offline' ? 'offline' : 'online', p_pending: Math.max(0, Math.min(100000, Math.floor(num(b.pending) || 0))), ...geo };
  } else if (b.kind === 'visit' || b.kind === 'error') {
    fn = 'record_app_event';
    args = { p_kind: b.kind, p_company_id: uuid(b.company_id), ...device, p_message: text(b.message, 500), p_detail: text(b.detail, 4000), ...geo };
  } else { res.status(400).end(); return; }
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  if (/^Bearer [\w.-]+$/.test(h.authorization || '')) headers.Authorization = h.authorization;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    res.status(r.ok ? 204 : 202).end();
  } catch {
    res.status(202).end();
  }
}
