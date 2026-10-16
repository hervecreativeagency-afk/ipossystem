/* global __APP_VERSION__ */
// Background reports for the Creator console: visits, crashes and "I'm online" (every minute while open).
// Sent to /api/track, which adds the approximate location from the connection. Nothing here
// affects selling: every call is fire-and-forget, and nothing is sent while developing locally.
import { supabase } from './supabase';
import * as offline from './offline';
import { describeDevice, cleanPage, describeError, ignoredError } from './telemetry-utils';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const ENABLED = import.meta.env.PROD;
const QUEUE = 'ipos.telemetry.queue';
const ctx = { uid: null, companyId: null };
const recent = new Map();
let started = false, beat = null;

const info = () => ({ ...describeDevice(navigator.userAgent, navigator.maxTouchPoints || 0), version: VERSION, page: cleanPage(location.pathname) });
const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch { return []; } };
const writeQueue = q => { try { localStorage.setItem(QUEUE, JSON.stringify(q.slice(-20))); } catch { /* storage unavailable */ } };

async function send(payload) {
  if (!ENABLED) return false;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    const r = await fetch('/api/track', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ ...info(), company_id: ctx.companyId, ...payload }),
    });
    return r.status < 500;
  } catch { return false; }
}

function flush() {
  const q = readQueue();
  if (!q.length || !navigator.onLine) return;
  writeQueue([]);
  q.forEach(item => send(item).then(ok => { if (!ok) writeQueue([...readQueue(), item]); }));
}

export function reportError(err, extra) {
  const { message, detail } = describeError(err, extra);
  if (ignoredError(message)) return;
  const now = Date.now();
  if (now - (recent.get(message) || 0) < 60000) return;     // the same crash once a minute is enough
  recent.set(message, now);
  const item = { kind: 'error', message, detail, page: cleanPage(location.pathname) };
  if (!navigator.onLine) { writeQueue([...readQueue(), item]); return; }
  send(item).then(ok => { if (!ok) writeQueue([...readQueue(), item]); });
}

function heartbeat() {
  if (!ctx.uid || document.visibilityState !== 'visible' || !navigator.onLine) return;
  send({ kind: 'heartbeat', connection: offline.isOffline() ? 'offline' : 'online', pending: offline.loadQueue(ctx.uid).length });
}

/** Called by the app whenever the signed-in person or shop changes. */
export function setTelemetryContext(uid, companyId) {
  const changed = uid !== ctx.uid || companyId !== ctx.companyId;
  ctx.uid = uid || null; ctx.companyId = companyId || null;
  if (changed && ctx.uid) heartbeat();
}

export function startTelemetry() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('error', e => reportError(e.error || e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : ''));
  window.addEventListener('unhandledrejection', e => reportError(e.reason, 'unhandled promise'));
  window.addEventListener('online', () => { heartbeat(); flush(); });
  document.addEventListener('visibilitychange', heartbeat);
  offline.subscribe(ev => { if (ev.type === 'sync-end') heartbeat(); });
  beat = setInterval(heartbeat, 60000);
  // One visit per app load, after sign-in has had a moment to restore.
  setTimeout(() => { send({ kind: 'visit' }); flush(); }, 4000);
}
