// Offline support: local caches, the offline sales queue and background sync.
// Pure logic with an injectable storage so it can be unit tested in Node.
import { totals } from './totals.js';

const PREFIX = 'ipos:v1:';
const memory = new Map();
const fallbackStorage = {
  getItem: k => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: k => memory.delete(k),
};
let store = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PREFIX + 'probe', '1');
      localStorage.removeItem(PREFIX + 'probe');
      return localStorage;
    }
  } catch { /* private mode or blocked storage */ }
  return fallbackStorage;
})();
export function useStorage(s) { store = s; }

function read(key, fallback = null) {
  try { const raw = store.getItem(PREFIX + key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; }
}
function write(key, value) {
  try { store.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}

// ---- connectivity -------------------------------------------------------
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(event) { for (const fn of [...listeners]) { try { fn(event); } catch { /* listener errors never break sync */ } } }

let lastNetworkFailure = false;
const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
export function isOffline() { return browserOffline() || lastNetworkFailure; }
export function markOnline() { if (lastNetworkFailure) { lastNetworkFailure = false; emit({ type: 'connectivity' }); } }
export function markOffline() { if (!lastNetworkFailure) { lastNetworkFailure = true; emit({ type: 'connectivity' }); } }

export function isNetworkError(e) {
  if (browserOffline()) return true;
  const text = String(e?.message || e || '') + ' ' + String(e?.details || '') + ' ' + String(e?.name || '');
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|timed? ?out|AuthRetryableFetchError/i.test(text);
}

// ---- caches ---------------------------------------------------------------
export const cacheKey = (uid, companyId, kind) => `${uid}:${companyId}:${kind}`;
export function saveCache(key, data) { return write('cache:' + key, { savedAt: new Date().toISOString(), data }); }
export function readCache(key) { return read('cache:' + key, null); }

// ---- offline sales queue ------------------------------------------------
const queueKey = uid => 'queue:' + uid;
export function loadQueue(uid) { const q = read(queueKey(uid), []); return Array.isArray(q) ? q : []; }
function saveQueue(uid, queue) { write(queueKey(uid), queue); emit({ type: 'queue' }); }
export function pendingFor(uid, companyId) { return loadQueue(uid).filter(e => !companyId || e.companyId === companyId); }

// Builds the queued record and a provisional receipt shown to the customer.
export function buildOfflineSale({ uid, companyId, currency, cashierName, cart, discount, payments, customer, requestId, now = new Date() }) {
  const t = totals(cart, discount);
  const paid = payments.reduce((n, p) => n + Math.round(Number(p.amount) * 100), 0) / 100;
  const entry = {
    requestId, companyId, uid, currency, cashierName,
    createdAt: now.toISOString(),
    cart: cart.map(i => ({ id: i.id, name: i.name, sku: i.sku, selling_price: Number(i.selling_price), tax_rate: Number(i.tax_rate || 0), quantity: i.quantity })),
    discount: Number(discount || 0), payments, customer: customer || null,
    totals: { ...t, paid, change: Math.round((paid - t.total) * 100) / 100 },
    status: 'pending', error: '', attempts: 0,
  };
  return entry;
}
export function enqueue(entry) { const q = loadQueue(entry.uid).filter(e => e.requestId !== entry.requestId); q.push(entry); saveQueue(entry.uid, q); return entry; }
export function removeQueued(uid, requestId) { saveQueue(uid, loadQueue(uid).filter(e => e.requestId !== requestId)); }
export function retryQueued(uid, requestId) { saveQueue(uid, loadQueue(uid).map(e => (requestId == null || e.requestId === requestId) && e.status === 'failed' ? { ...e, status: 'pending', error: '' } : e)); }

export function provisionalReceipt(entry) {
  return {
    offline: true,
    id: entry.requestId,
    receipt_number: 'OFFLINE-' + entry.requestId.replace(/-/g, '').slice(0, 8).toUpperCase(),
    created_at: entry.createdAt,
    cashier_name: entry.cashierName,
    customer_name: entry.customer?.name || '',
    customer_phone: entry.customer?.phone || '',
    currency: entry.currency,
    subtotal: entry.totals.subtotal, tax: entry.totals.tax, discount: entry.totals.discount, total: entry.totals.total,
    amount_paid: entry.totals.paid, change: entry.totals.change,
    items: entry.cart.map((i, n) => ({ id: n, product_name: i.name, quantity: i.quantity, unit_price: i.selling_price })),
    payments: entry.payments.map((p, n) => ({ id: n, method: p.method, amount: p.amount })),
  };
}

// Stock shown on this device subtracts sales that are still waiting to sync.
export function applyPendingStock(products, queue, companyId) {
  const held = new Map();
  for (const e of queue) if (e.companyId === companyId) for (const i of e.cart) held.set(i.id, (held.get(i.id) || 0) + i.quantity);
  if (!held.size) return products;
  return products.map(p => (held.has(p.id) ? { ...p, stock_quantity: Math.max(0, Number(p.stock_quantity) - held.get(p.id)) } : p));
}

// Sends queued sales one at a time. Retrying is safe: the server returns the
// existing sale for a request ID it has already recorded.
let syncing = null;
export function isSyncing() { return Boolean(syncing); }
export function syncQueue(uid, checkout) {
  if (!uid) return Promise.resolve({ synced: 0, failed: 0 });
  if (syncing) return syncing;
  syncing = (async () => {
    let synced = 0, failed = 0;
    emit({ type: 'sync-start' });
    try {
      for (const entry of loadQueue(uid)) {
        if (entry.status !== 'pending') continue;
        try {
          await checkout({ companyId: entry.companyId, cart: entry.cart, discount: entry.discount, payments: entry.payments, requestId: entry.requestId, customer: entry.customer });
          removeQueued(uid, entry.requestId);
          synced++;
          markOnline();
        } catch (e) {
          if (isNetworkError(e)) { markOffline(); break; }
          saveQueue(uid, loadQueue(uid).map(x => x.requestId === entry.requestId ? { ...x, status: 'failed', error: e?.message || 'The server rejected this sale.', attempts: (x.attempts || 0) + 1 } : x));
          failed++;
        }
      }
    } finally {
      syncing = null;
      emit({ type: 'sync-end', synced, failed });
    }
    return { synced, failed };
  })();
  return syncing;
}
