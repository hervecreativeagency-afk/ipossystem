import { Skeleton } from './Loading';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CalendarClock, AlertTriangle, LoaderCircle, AlertCircle, X, Trash2, Plus, RefreshCw } from 'lucide-react';
import { supabase } from './supabase';
import * as api from './api';
import { toast } from './Toast';
import { ALL, branchName } from './branches';
import { groupBatches, expiryText, lusakaToday, undatedStock } from './expiry-utils';

const money = (n, c) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c || 'ZMW' }).format(Number(n || 0));
const msg = e => e?.message || 'Something went wrong. Please try again.';
const fmtDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

async function loadBatches(cid, branchId) {
  let q = supabase.from('stock_batches').select('id,branch_id,product_id,expiry_date,quantity,received_quantity,source,created_at').eq('company_id', cid).gt('quantity', 0).order('expiry_date').limit(2000);
  if (branchId && branchId !== ALL) q = q.eq('branch_id', branchId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// Products at this branch that have expired stock (checkout badge).
export function useExpiredProducts(auth) {
  const [set, setSet] = useState(() => new Set());
  const cid = auth.membership.company_id, b = auth.branchId;
  useEffect(() => {
    if (!b || b === ALL) { setSet(new Set()); return; }
    let live = true;
    supabase.from('stock_batches').select('product_id').eq('company_id', cid).eq('branch_id', b).gt('quantity', 0).lt('expiry_date', lusakaToday())
      .then(({ data }) => { if (live && data) setSet(new Set(data.map(r => r.product_id))); });
    return () => { live = false; };
  }, [cid, b]);
  return set;
}

// Dashboard: expired and soon-to-expire stock.
export function ExpiryNotice({ auth }) {
  const [counts, setCounts] = useState(null);
  const m = auth.membership;
  useEffect(() => {
    if (m.role === 'cashier' || !auth.branchesLoaded) return;
    let live = true;
    loadBatches(m.company_id, auth.branchId).then(rows => { if (live) { const g = groupBatches(rows); setCounts({ expired: g.expired.length, week: g.week.length }); } }).catch(() => {});
    return () => { live = false; };
  }, [m.company_id, auth.branchId, auth.branchesLoaded]);
  if (!counts || (!counts.expired && !counts.week)) return null;
  return (
    <div className="expiry-alert" role="status">
      <AlertTriangle size={18} />
      <span><strong>{counts.expired ? `${counts.expired} expired ${counts.expired === 1 ? 'batch' : 'batches'}` : ''}{counts.expired && counts.week ? ' · ' : ''}{counts.week ? `${counts.week} expiring within 7 days` : ''}</strong> Sell or remove them before customers buy expired stock.</span>
      <Link to="/expiry">See expiry dates</Link>
    </div>
  );
}

const SECTIONS = [['expired', 'Expired', 'red'], ['week', 'Within 7 days', 'amber'], ['month', 'Within 30 days', 'amber'], ['later', 'Later', 'green']];

export function Expiry({ auth }) {
  if (!['director', 'supervisor'].includes(auth.membership.role)) return <Navigate to="/pos" replace />;
  return <ExpiryContent auth={auth} />;
}

function ExpiryContent({ auth }) {
  const m = auth.membership, cid = m.company_id, currency = m.companies.currency;
  const [batches, setBatches] = useState(null), [products, setProducts] = useState([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(''), [tagging, setTagging] = useState(false);
  async function load() {
    setError('');
    try {
      const [b, p] = await Promise.all([loadBatches(cid, auth.branchId), api.loadProducts(cid, m.role, auth.branchId)]);
      setBatches(b); setProducts(p);
    } catch (e) { setError(msg(e)); }
  }
  useEffect(() => { load(); }, [cid, auth.branchId]);
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const groups = groupBatches(batches || []);
  const expiredValue = groups.expired.reduce((n, b) => n + b.quantity * Number(byId.get(b.product_id)?.selling_price || 0), 0);
  const showBranch = auth.multiBranch && auth.branchId === ALL;

  async function writeOff(b) {
    const p = byId.get(b.product_id);
    if (!window.confirm(`Remove ${b.quantity} × ${p?.name || 'this product'} (expiry ${fmtDate(b.expiry_date)}) from stock?`)) return;
    setBusy(b.id);
    try {
      const { error } = await supabase.rpc('write_off_batch', { p_company_id: cid, p_batch_id: b.id, p_notes: null, p_request_id: crypto.randomUUID() });
      if (error) throw error;
      toast(`${b.quantity} × ${p?.name || 'item'} written off.`);
      await load();
    } catch (e) { toast(msg(e), 'error'); } finally { setBusy(''); }
  }

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">STORE WORKSPACE</span><h1>Expiry dates</h1><p>{auth.multiBranch ? `${branchName(auth.branches, auth.branchId)}. ` : ''}What has expired and what expires soon. Stock that expires first is sold first.</p></div>
        <div className="heading-actions">
          <button className="icon-button" aria-label="Refresh" onClick={load}><RefreshCw size={18} /></button>
          <button className="primary" onClick={() => setTagging(true)}><Plus size={18} /> Add dates to shelf stock</button>
        </div>
      </div>
      {error && <div className="notice" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {!batches ? <Skeleton kind="dashboard" rows={4} label="Loading expiry dates…" /> : !batches.length ? (
        <div className="empty"><CalendarClock size={33} /><h3>No expiry dates yet</h3><p>Add expiry dates when you receive a delivery, add stock, or create a product — or record them for stock already on the shelf.</p></div>
      ) : (
        <>
          <div className="stat-grid branch-stats">
            <div className="stat-card warn"><div>Expired<AlertTriangle size={19} /></div><strong>{groups.expired.reduce((n, b) => n + b.quantity, 0)}</strong><small>{money(expiredValue, currency)} at selling price</small></div>
            <div className="stat-card"><div>Within 7 days<CalendarClock size={19} /></div><strong>{groups.week.reduce((n, b) => n + b.quantity, 0)}</strong><small>Sell these first</small></div>
            <div className="stat-card"><div>Within 30 days<CalendarClock size={19} /></div><strong>{groups.month.reduce((n, b) => n + b.quantity, 0)}</strong><small>Plan a promotion?</small></div>
            <div className="stat-card"><div>Later<CalendarClock size={19} /></div><strong>{groups.later.reduce((n, b) => n + b.quantity, 0)}</strong><small>Dated stock in good time</small></div>
          </div>
          {SECTIONS.filter(([k]) => groups[k].length).map(([k, title, tone]) => (
            <section key={k} className="table-panel expiry-section">
              <div className="table-toolbar"><h2><span className={'badge ' + tone}>{title}</span> {groups[k].length} {groups[k].length === 1 ? 'batch' : 'batches'}</h2></div>
              <div className="table-scroll">
                <table className="customer-table">
                  <thead><tr><th>Product</th>{showBranch && <th>Branch</th>}<th>Expiry</th><th>Quantity</th><th>Value</th><th></th></tr></thead>
                  <tbody>
                    {groups[k].map(b => {
                      const p = byId.get(b.product_id);
                      return (
                        <tr key={b.id}>
                          <td><strong>{p?.name || 'Product'}</strong><small>{p?.sku}{b.source ? ' · ' + b.source : ''}</small></td>
                          {showBranch && <td>{branchName(auth.branches, b.branch_id)}</td>}
                          <td><strong>{fmtDate(b.expiry_date)}</strong><small>{expiryText(b.expiry_date)}</small></td>
                          <td>{b.quantity}</td>
                          <td>{money(b.quantity * Number(p?.selling_price || 0), currency)}</td>
                          <td>{(k === 'expired' || k === 'week') && <button className="secondary danger-text" disabled={busy === b.id} onClick={() => writeOff(b)}><Trash2 size={15} /> Write off</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
      <p className="muted">Stock without an expiry date is counted as sold first; after that, the batch that expires soonest is sold first. Expiry dates travel with stock transfers.</p>
      {tagging && <TagForm auth={auth} products={products} batches={batches || []} onClose={() => setTagging(false)} onDone={async () => { setTagging(false); await load(); }} />}
    </>
  );
}

function TagForm({ auth, products, batches, onClose, onDone }) {
  const cid = auth.membership.company_id;
  const [branch, setBranch] = useState(auth.branchId && auth.branchId !== ALL ? auth.branchId : auth.branches[0]?.id || '');
  const [stock, setStock] = useState(products);
  const [search, setSearch] = useState(''), [productId, setProductId] = useState(''), [qty, setQty] = useState(''), [date, setDate] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (branch === auth.branchId || !branch) { setStock(products); return; }
    api.loadProducts(cid, auth.membership.role, branch).then(setStock).catch(e => setError(msg(e)));
  }, [branch]);
  const undated = p => undatedStock(p.stock_quantity, batches.filter(b => b.product_id === p.id && b.branch_id === branch));
  const q = search.trim().toLowerCase();
  const options = stock.filter(p => undated(p) > 0 && (!q || [p.name, p.sku, p.barcode].some(v => v?.toLowerCase().includes(q)))).slice(0, 50);
  const chosen = stock.find(p => p.id === productId);
  async function save(e) {
    e.preventDefault(); setError('');
    if (!chosen) { setError('Choose a product.'); return; }
    if (!date) { setError('Enter the expiry date.'); return; }
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1 || n > undated(chosen)) { setError(`Enter a number from 1 to ${undated(chosen)}.`); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('tag_stock_expiry', { p_company_id: cid, p_branch_id: branch, p_product_id: chosen.id, p_quantity: n, p_expiry: date });
      if (error) throw error;
      toast(`Expiry ${fmtDate(date)} recorded for ${n} × ${chosen.name}.`);
      onDone();
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal" onSubmit={save} aria-label="Add expiry dates to stock on the shelf">
        <div className="modal-head"><h2>Add dates to shelf stock</h2><button type="button" aria-label="Close" onClick={onClose}><X /></button></div>
        <p className="muted">Check the packs on the shelf and record their expiry date. Stock isn’t changed.</p>
        {error && <div className="notice" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
        <div className="customer-form">
          {auth.multiBranch && <label>Branch<select value={branch} disabled={Boolean(auth.homeBranch)} onChange={e => { setBranch(e.target.value); setProductId(''); }}>{auth.branches.filter(b => !auth.homeBranch || b.id === auth.homeBranch).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          <label>Find product<input value={search} placeholder="Name, SKU or barcode" onChange={e => setSearch(e.target.value)} /></label>
          <label>Product<select required value={productId} onChange={e => setProductId(e.target.value)}><option value="">Choose…</option>{options.map(p => <option key={p.id} value={p.id}>{p.name} — {undated(p)} without a date</option>)}</select></label>
          <label>How many have this date{chosen ? ` (up to ${undated(chosen)})` : ''}<input type="number" min="1" step="1" required value={qty} onChange={e => setQty(e.target.value)} /></label>
          <label>Expiry date<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" /> Saving…</> : 'Save expiry date'}</button>
        </div>
      </form>
    </div>
  );
}
