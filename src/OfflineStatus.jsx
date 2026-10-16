import React, { useEffect, useRef, useState } from 'react';
import { CloudOff, Cloud, RefreshCw, AlertTriangle, X, Trash2 } from 'lucide-react';
import * as offline from './offline';
import { toast } from './Toast';

// Keeps track of connectivity and the offline sales queue, and syncs it
// automatically whenever the connection comes back.
export function useOfflineState(uid) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(n => n + 1);
    const unsub = offline.subscribe(bump);
    window.addEventListener('online', bump);
    window.addEventListener('offline', bump);
    return () => { unsub(); window.removeEventListener('online', bump); window.removeEventListener('offline', bump); };
  }, []);
  const queue = uid ? offline.loadQueue(uid) : [];
  return {
    offline: offline.isOffline(),
    queue,
    pending: queue.filter(e => e.status === 'pending').length,
    failed: queue.filter(e => e.status === 'failed').length,
    syncing: offline.isSyncing(),
  };
}

export default function OfflineStatus({ uid, companyId, checkout, money, onSynced }) {
  const state = useOfflineState(uid);
  const [open, setOpen] = useState(false);
  const panel = useRef(null);
  const queue = state.queue.filter(e => e.companyId === companyId);
  const pending = queue.filter(e => e.status === 'pending').length;
  const failed = queue.filter(e => e.status === 'failed');

  async function sync(manual = false) {
    if (!offline.loadQueue(uid).some(e => e.status === 'pending')) { if (manual) toast('Nothing waiting to sync.', 'info'); return; }
    const r = await offline.syncQueue(uid, checkout);
    if (r.synced) { toast(r.synced === 1 ? '1 offline sale synced.' : r.synced + ' offline sales synced.'); onSynced?.(); }
    if (r.failed) toast(r.failed === 1 ? '1 offline sale needs attention.' : r.failed + ' offline sales need attention.', 'error', 6000);
    if (manual && !r.synced && !r.failed && offline.isOffline()) toast('Still offline. Sales will sync when the connection returns.', 'info');
  }

  useEffect(() => {
    if (!uid) return;
    const goOnline = () => { offline.markOnline(); sync(); };
    window.addEventListener('online', goOnline);
    sync();
    const timer = setInterval(() => { if (navigator.onLine !== false) sync(); }, 30000);
    return () => { window.removeEventListener('online', goOnline); clearInterval(timer); };
  }, [uid]);

  useEffect(() => {
    if (!open) return;
    const close = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  const label = state.offline
    ? 'Offline'
    : state.syncing ? 'Syncing…' : failed.length ? 'Needs attention' : pending ? 'Waiting to sync' : 'Online';
  const tone = state.offline ? 'offline' : failed.length ? 'failed' : pending || state.syncing ? 'pending' : 'online';
  const Icon = state.offline ? CloudOff : failed.length ? AlertTriangle : state.syncing ? RefreshCw : Cloud;

  return (
    <div className="net-status">
      <button className={'net-chip net-' + tone} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" title="Connection and offline sales">
        <Icon size={15} className={state.syncing ? 'spin' : ''} />
        <span>{label}</span>
        {queue.length > 0 && <b>{queue.length}</b>}
      </button>
      {open && (
        <div className="net-panel" role="dialog" aria-label="Offline sales" ref={panel}>
          <div className="net-panel-head">
            <strong>{state.offline ? 'You are offline' : 'Connected'}</strong>
            <button aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
          <p className="muted">
            {state.offline
              ? 'Keep selling. Sales are saved on this device and sent automatically when the internet is back.'
              : queue.length ? 'Sales saved on this device are sent automatically.' : 'All sales are saved to your store. Nothing is waiting on this device.'}
          </p>
          {queue.length > 0 && (
            <ul className="net-list">
              {queue.map(e => (
                <li key={e.requestId} className={e.status === 'failed' ? 'is-failed' : ''}>
                  <div>
                    <strong>{money(e.totals.total, e.currency)}</strong>
                    <small>{new Date(e.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {e.cart.reduce((n, i) => n + i.quantity, 0)} items</small>
                    {e.status === 'failed' && <small className="net-error">{e.error}</small>}
                  </div>
                  {e.status === 'failed' ? (
                    <div className="net-actions">
                      <button className="secondary" onClick={() => { offline.retryQueued(uid, e.requestId); sync(true); }}>Retry</button>
                      <button aria-label="Remove from this device" className="icon-danger" onClick={() => {
                        if (window.confirm('Remove this sale from this device? It was NOT recorded in your store. Only remove it if you have recorded it another way.')) { offline.removeQueued(uid, e.requestId); toast('Offline sale removed from this device.', 'info'); }
                      }}><Trash2 size={15} /></button>
                    </div>
                  ) : <span className="badge amber">Waiting</span>}
                </li>
              ))}
            </ul>
          )}
          {failed.length > 0 && <p className="net-help">A sale is rejected when stock ran out or your shift was closed before it synced. Open your shift or adjust stock, then retry.</p>}
          {queue.length > 0 && (
            <button className="primary net-sync" disabled={state.syncing} onClick={() => { offline.retryQueued(uid); sync(true); }}>
              <RefreshCw size={15} className={state.syncing ? 'spin' : ''} /> {state.syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
