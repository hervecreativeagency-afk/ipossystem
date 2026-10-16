import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Store, MapPin, Plus, X, LoaderCircle, AlertCircle, ArrowRight, Truck, PackageCheck, Ban, Pencil, Users, RefreshCw, Search, Trash2 } from 'lucide-react';
import * as api from './api';
import { toast } from './Toast';
import { ALL, branchName, branchSummary, saveBranch, listStaffBranches, setStaffBranch, loadTransfers, sendTransfer, receiveTransfer, cancelTransfer, transferTotals } from './branches';
import { supabase } from './supabase';

const money = (n, c) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c || 'ZMW' }).format(Number(n || 0));
const msg = e => e?.message || 'Something went wrong. Please try again.';
const when = d => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const canUse = (auth, id) => !auth.homeBranch || auth.homeBranch === id;
const ErrorBox = ({ text }) => text ? <div className="notice" role="alert"><AlertCircle size={18} /><span>{text}</span></div> : null;

// ---------------------------------------------------------------- top bar switcher
export function BranchSwitcher({ auth }) {
  if (!auth.multiBranch) return null;
  if (!auth.canSwitchBranch) return <span className="branch-chip" title="Your branch"><MapPin size={14} />{branchName(auth.branches, auth.branchId)}</span>;
  return (
    <label className="branch-switch">
      <MapPin size={15} />
      <span className="sr-only">Branch</span>
      <select value={auth.branchId || ALL} onChange={e => auth.setBranchId(e.target.value)} aria-label="Branch">
        <option value={ALL}>All branches</option>
        {auth.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------- pick a branch (pages that work on one branch)
export function ChooseBranch({ auth, title, text }) {
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">STORE WORKSPACE</span><h1>{title}</h1><p>{text}</p></div></div>
      <div className="choose-branch">
        {auth.branches.map(b => (
          <button key={b.id} onClick={() => auth.setBranchId(b.id)}>
            <Store size={20} /><span><strong>{b.name}</strong>{b.address && <small>{b.address}</small>}</span>{b.is_main && <span className="badge green">Main</span>}<ArrowRight size={16} />
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Branches page: combined view for the owner
export function Branches({ auth }) {
  const m = auth.membership;
  if (!['director', 'supervisor'].includes(m.role)) return <Navigate to="/pos" replace />;
  return <BranchesContent auth={auth} />;
}

function BranchesContent({ auth }) {
  const m = auth.membership, currency = m.companies.currency, director = m.role === 'director';
  const navigate = useNavigate();
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [editing, setEditing] = useState(null);
  async function load() {
    setError('');
    try { setRows(await branchSummary(m.company_id)); } catch (e) { setError(msg(e)); }
  }
  useEffect(() => { load(); }, [m.company_id, auth.branches.length]);
  const total = useMemo(() => (rows || []).reduce((t, r) => ({
    today: t.today + Number(r.sales_today), count: t.count + Number(r.sales_today_count), week: t.week + Number(r.sales_week),
    value: t.value + Number(r.stock_value), transit: t.transit + Number(r.transfers_in),
  }), { today: 0, count: 0, week: 0, value: 0, transit: 0 }), [rows]);
  const maxWeek = Math.max(1, ...(rows || []).map(r => Number(r.sales_week)));

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">STORE WORKSPACE</span><h1>Branches</h1><p>Every shop at a glance: sales, stock and what’s on the way between them.</p></div>
        <div className="heading-actions">
          <button className="icon-button" aria-label="Refresh" onClick={load}><RefreshCw size={18} /></button>
          {director && <button className="primary" onClick={() => setEditing({ name: '', address: '', phone: '' })}><Plus size={18} /> Add branch</button>}
        </div>
      </div>
      <ErrorBox text={error} />
      {!rows ? <div className="insights-loading"><LoaderCircle size={18} className="spin" /> Loading branches…</div> : (
        <>
          {rows.length > 1 && (
            <div className="stat-grid branch-stats">
              <div className="stat-card"><div>Today, all branches<Store size={19} /></div><strong>{money(total.today, currency)}</strong><small>{total.count} sales · net of refunds</small></div>
              <div className="stat-card"><div>Last 7 days<Store size={19} /></div><strong>{money(total.week, currency)}</strong><small>All branches, before refunds</small></div>
              <div className="stat-card"><div>Stock value<PackageCheck size={19} /></div><strong>{money(total.value, currency)}</strong><small>At selling price, on shelves</small></div>
              <div className="stat-card"><div>In transit<Truck size={19} /></div><strong>{total.transit}</strong><small>Transfers waiting to be received</small></div>
            </div>
          )}
          {rows.length === 1 && director && (
            <div className="integration-note">You have one branch. Add another shop to give it its own stock, staff and sales — your current stock stays in {rows[0].name}.</div>
          )}
          <div className="branch-grid">
            {rows.map(r => {
              const b = auth.branches.find(x => x.id === r.branch_id) || { id: r.branch_id, name: r.name };
              return (
                <section key={r.branch_id} className="branch-card">
                  <div className="branch-card-head">
                    <div><strong>{r.name}</strong>{r.is_main && <span className="badge green">Main</span>}{b.address && <small>{b.address}</small>}</div>
                    {director && <button className="icon-button" aria-label={'Edit ' + r.name} onClick={() => setEditing(b)}><Pencil size={16} /></button>}
                  </div>
                  <div className="branch-figures">
                    <div><small>Today</small><strong>{money(r.sales_today, currency)}</strong><small>{r.sales_today_count} sales</small></div>
                    <div><small>7 days</small><strong>{money(r.sales_week, currency)}</strong><div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(r.sales_week) / maxWeek) * 100}%` }} /></div></div>
                    <div><small>Stock</small><strong>{Number(r.stock_units).toLocaleString()}</strong><small>{money(r.stock_value, currency)}</small></div>
                  </div>
                  <div className="branch-tags">
                    {Number(r.out_of_stock) > 0 && <span className="badge red">{r.out_of_stock} out of stock</span>}
                    {Number(r.low_stock) > 0 && <span className="badge amber">{r.low_stock} low</span>}
                    {Number(r.transfers_in) > 0 && <span className="badge amber">{r.transfers_in} arriving</span>}
                    {Number(r.transfers_out) > 0 && <span className="badge">{r.transfers_out} sent</span>}
                    <span className="badge">{r.open_shifts} open {Number(r.open_shifts) === 1 ? 'shift' : 'shifts'}</span>
                    <span className="badge">{r.staff} staff</span>
                  </div>
                  {auth.canSwitchBranch && <button className="secondary branch-open" onClick={() => { auth.setBranchId(r.branch_id); navigate('/dashboard'); }}>Work in {r.name} <ArrowRight size={16} /></button>}
                </section>
              );
            })}
          </div>
          {rows.length > 1 && <p className="muted"><Link to="/transfers">Move stock between branches</Link> · Use the branch picker at the top to see one branch’s dashboard, products and sales.</p>}
          {director && auth.branches.length > 1 && <StaffBranches auth={auth} />}
        </>
      )}
      {editing && <BranchForm auth={auth} branch={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await auth.reloadBranches(); load(); }} />}
    </>
  );
}

function BranchForm({ auth, branch, onClose, onSaved }) {
  const [form, setForm] = useState({ id: branch.id, name: branch.name || '', address: branch.address || '', phone: branch.phone || '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(e, active = true) {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      await saveBranch(auth.membership.company_id, { ...form, active });
      toast(active ? (form.id ? 'Branch updated.' : `${form.name} added.`) : `${form.name} closed.`);
      onSaved();
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal" onSubmit={save} aria-label={form.id ? 'Edit branch' : 'Add branch'}>
        <div className="modal-head"><h2>{form.id ? 'Edit branch' : 'Add branch'}</h2><button type="button" aria-label="Close" onClick={onClose}><X /></button></div>
        <ErrorBox text={error} />
        <div className="customer-form">
          <label>Branch name<input required maxLength={80} autoFocus placeholder="e.g. Town branch" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label>Address (optional)<input maxLength={300} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></label>
          <label>Phone (optional)<input maxLength={40} inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
        </div>
        {!form.id && <p className="muted">The new branch starts with no stock. Send stock to it from Stock Transfers, or receive a purchase order there.</p>}
        <div className="modal-actions">
          {form.id && !branch.is_main && <button type="button" className="secondary danger-text" disabled={busy} onClick={() => { if (window.confirm(`Close ${form.name}? It must have no stock, staff, open shifts or transfers in transit.`)) save(null, false); }}>Close branch</button>}
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" /> Saving…</> : 'Save branch'}</button>
        </div>
      </form>
    </div>
  );
}

function StaffBranches({ auth }) {
  const cid = auth.membership.company_id;
  const [staff, setStaff] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  async function load() {
    try {
      const [{ data, error }, homes] = await Promise.all([supabase.rpc('list_store_staff', { p_company_id: cid }), listStaffBranches(cid)]);
      if (error) throw error;
      const home = new Map(homes.map(h => [h.user_id, h.branch_id]));
      setStaff(data.filter(s => s.active).map(s => ({ ...s, branch_id: home.get(s.user_id) || '' })));
    } catch (e) { setError(msg(e)); }
  }
  useEffect(() => { load(); }, [cid]);
  async function change(person, branchId) {
    setBusy(person.user_id);
    try { await setStaffBranch(cid, person.user_id, branchId); toast(`${person.full_name} now works at ${branchId ? branchName(auth.branches, branchId) : 'all branches'}.`); await load(); }
    catch (e) { toast(msg(e), 'error'); } finally { setBusy(''); }
  }
  return (
    <section className="table-panel staff-branches">
      <div className="table-toolbar"><h2><Users size={18} /> Who works where</h2></div>
      <ErrorBox text={error} />
      {!staff ? <div className="insights-loading"><LoaderCircle size={18} className="spin" /> Loading staff…</div> : (
        <div className="table-scroll">
          <table className="customer-table">
            <thead><tr><th>Name</th><th>Role</th><th>Branch</th></tr></thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.user_id}>
                  <td><strong>{s.full_name}</strong><small>{s.email}</small></td>
                  <td><span className="badge">{s.role}</span></td>
                  <td>
                    <select value={s.branch_id} disabled={busy === s.user_id} onChange={e => change(s, e.target.value)} aria-label={'Branch for ' + s.full_name}>
                      {s.role !== 'cashier' && <option value="">All branches</option>}
                      {auth.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">Cashiers work at one branch. Directors and supervisors can be given one branch or all of them.</p>
    </section>
  );
}

// ---------------------------------------------------------------- Stock transfers
export function Transfers({ auth }) {
  if (!['director', 'supervisor'].includes(auth.membership.role)) return <Navigate to="/pos" replace />;
  return <TransfersContent auth={auth} />;
}

function TransfersContent({ auth }) {
  const m = auth.membership, cid = m.company_id;
  const [list, setList] = useState(null), [error, setError] = useState(''), [tab, setTab] = useState('transit');
  const [creating, setCreating] = useState(false), [receiving, setReceiving] = useState(null), [busy, setBusy] = useState('');
  async function load() { setError(''); try { setList(await loadTransfers(cid)); } catch (e) { setError(msg(e)); } }
  useEffect(() => { load(); }, [cid]);
  const name = id => branchName(auth.branches, id) || 'Closed branch';
  const shown = (list || []).filter(t => tab === 'transit' ? t.status === 'sent' : t.status !== 'sent')
    .filter(t => auth.branchId === ALL || !auth.branchId || [t.from_branch_id, t.to_branch_id].includes(auth.branchId));
  async function cancel(t) {
    if (!window.confirm(`Cancel ${t.number}? The stock goes back to ${name(t.from_branch_id)}.`)) return;
    setBusy(t.id);
    try { await cancelTransfer(cid, t.id); toast(`${t.number} cancelled. Stock is back at ${name(t.from_branch_id)}.`); await load(); }
    catch (e) { toast(msg(e), 'error'); } finally { setBusy(''); }
  }
  if (!auth.multiBranch) return (
    <>
      <div className="page-heading"><div><span className="eyebrow">STORE WORKSPACE</span><h1>Stock transfers</h1><p>Move stock between your shops.</p></div></div>
      <div className="empty"><Store size={33} /><h3>You have one branch</h3><p>Add a second branch in <Link to="/branches">Branches</Link> to move stock between them.</p></div>
    </>
  );
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">STORE WORKSPACE</span><h1>Stock transfers</h1><p>Send stock to another branch. It counts as “in transit” until that branch confirms it arrived.</p></div>
        <div className="heading-actions">
          <button className="icon-button" aria-label="Refresh" onClick={load}><RefreshCw size={18} /></button>
          <button className="primary" onClick={() => setCreating(true)}><Truck size={18} /> New transfer</button>
        </div>
      </div>
      <ErrorBox text={error} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'transit'} className={tab === 'transit' ? 'active' : ''} onClick={() => setTab('transit')}>In transit{list ? ` (${list.filter(t => t.status === 'sent').length})` : ''}</button>
        <button role="tab" aria-selected={tab === 'done'} className={tab === 'done' ? 'active' : ''} onClick={() => setTab('done')}>History</button>
      </div>
      {!list ? <div className="insights-loading"><LoaderCircle size={18} className="spin" /> Loading transfers…</div> : !shown.length ? (
        <div className="empty"><Truck size={33} /><h3>{tab === 'transit' ? 'Nothing in transit' : 'No transfers yet'}</h3><p>{tab === 'transit' ? 'Stock you send to another branch shows here until it is received.' : 'Received and cancelled transfers show here.'}</p></div>
      ) : (
        <div className="transfer-list">
          {shown.map(t => {
            const tot = transferTotals(t);
            return (
              <section key={t.id} className={'transfer-card status-' + t.status}>
                <div className="transfer-head">
                  <div><strong>{name(t.from_branch_id)} <ArrowRight size={14} /> {name(t.to_branch_id)}</strong><small>{t.number} · sent {when(t.sent_at)} by {t.sent_by_name || 'staff'}</small></div>
                  <span className={'badge ' + (t.status === 'sent' ? 'amber' : t.status === 'received' ? (tot.missing ? 'red' : 'green') : '')}>
                    {t.status === 'sent' ? 'In transit' : t.status === 'cancelled' ? 'Cancelled' : tot.missing ? `${tot.missing} missing` : 'Received'}
                  </span>
                </div>
                <ul className="transfer-items">
                  {t.items.map(i => <li key={i.product_id}><span>{i.name}</span><strong>{t.status === 'received' && Number(i.received) !== Number(i.quantity) ? `${i.received} of ${i.quantity}` : i.quantity}</strong></li>)}
                </ul>
                {(t.notes || t.receive_notes) && <p className="transfer-notes">{t.notes}{t.notes && t.receive_notes ? ' · ' : ''}{t.receive_notes && <>On arrival: {t.receive_notes}</>}</p>}
                {t.status === 'received' && <small>Received {when(t.received_at)} by {t.received_by_name || 'staff'}</small>}
                {t.status === 'sent' && (
                  <div className="transfer-actions">
                    {canUse(auth, t.to_branch_id) && <button className="primary" disabled={busy === t.id} onClick={() => setReceiving(t)}><PackageCheck size={16} /> Receive</button>}
                    {canUse(auth, t.from_branch_id) && <button className="secondary" disabled={busy === t.id} onClick={() => cancel(t)}><Ban size={16} /> Cancel</button>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {creating && <TransferForm auth={auth} onClose={() => setCreating(false)} onSent={async () => { setCreating(false); setTab('transit'); await load(); }} />}
      {receiving && <ReceiveForm auth={auth} transfer={receiving} name={name} onClose={() => setReceiving(null)} onDone={async () => { setReceiving(null); await load(); }} />}
    </>
  );
}

function TransferForm({ auth, onClose, onSent }) {
  const cid = auth.membership.company_id;
  const usable = auth.branches.filter(b => canUse(auth, b.id));
  const [from, setFrom] = useState(auth.branchId && auth.branchId !== ALL ? auth.branchId : usable[0]?.id || '');
  const [to, setTo] = useState('');
  const [products, setProducts] = useState(null), [search, setSearch] = useState(''), [lines, setLines] = useState([]);
  const [notes, setNotes] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!from) return;
    let live = true; setProducts(null); setLines([]);
    api.loadProducts(cid, auth.membership.role, from).then(p => { if (live) setProducts(p); }).catch(e => { if (live) setError(msg(e)); });
    return () => { live = false; };
  }, [from]);
  const q = search.trim().toLowerCase();
  const matches = (products || []).filter(p => p.stock_quantity > 0 && !lines.some(l => l.id === p.id) && (!q || [p.name, p.sku, p.barcode].some(v => v?.toLowerCase().includes(q)))).slice(0, 8);
  async function send(e) {
    e.preventDefault(); setError('');
    if (!to) { setError('Choose the branch to send to.'); return; }
    if (!lines.length) { setError('Add at least one product.'); return; }
    for (const l of lines) {
      const n = Number(l.quantity);
      if (!Number.isInteger(n) || n < 1) { setError(`Enter a whole quantity for ${l.name}.`); return; }
      if (n > l.stock_quantity) { setError(`Only ${l.stock_quantity} ${l.name} at ${branchName(auth.branches, from)}.`); return; }
    }
    setBusy(true);
    try {
      await sendTransfer({ cid, from, to, items: lines.map(l => ({ product_id: l.id, quantity: Number(l.quantity) })), notes, requestId: request.current });
      toast(`Sent to ${branchName(auth.branches, to)}. It shows as in transit until they receive it.`);
      onSent();
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal transfer-modal" onSubmit={send} aria-label="New stock transfer">
        <div className="modal-head"><h2>Send stock</h2><button type="button" aria-label="Close" onClick={onClose}><X /></button></div>
        <ErrorBox text={error} />
        <div className="transfer-route">
          <label>From<select value={from} onChange={e => setFrom(e.target.value)} disabled={usable.length < 2 || busy}>{usable.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <ArrowRight size={18} />
          <label>To<select value={to} onChange={e => setTo(e.target.value)} disabled={busy} required><option value="">Choose branch…</option>{auth.branches.filter(b => b.id !== from).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        </div>
        <div className="search-box transfer-search"><Search size={18} /><input placeholder="Add a product: name, SKU or barcode…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Find product" /></div>
        {!products ? <div className="insights-loading"><LoaderCircle size={16} className="spin" /> Loading stock…</div> : (q || !lines.length) && (
          <ul className="transfer-picker">
            {matches.map(p => <li key={p.id}><button type="button" onClick={() => { setLines(l => [...l, { ...p, quantity: '' }]); setSearch(''); }}><span>{p.name}<small>{p.sku}</small></span><span>{p.stock_quantity} here <Plus size={14} /></span></button></li>)}
            {!matches.length && <li className="muted">{q ? 'No product with stock matches.' : 'No stock at this branch yet.'}</li>}
          </ul>
        )}
        {lines.length > 0 && (
          <ul className="transfer-lines">
            {lines.map(l => (
              <li key={l.id}>
                <span><strong>{l.name}</strong><small>{l.stock_quantity} at {branchName(auth.branches, from)}</small></span>
                <input type="number" min="1" max={l.stock_quantity} step="1" inputMode="numeric" required aria-label={'Quantity of ' + l.name} value={l.quantity} onChange={e => setLines(ls => ls.map(x => x.id === l.id ? { ...x, quantity: e.target.value } : x))} />
                <button type="button" className="icon-danger" aria-label={'Remove ' + l.name} onClick={() => setLines(ls => ls.filter(x => x.id !== l.id))}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
        <label>Notes (optional)<input maxLength={300} placeholder="e.g. sent with Joseph by bus" value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy || !lines.length}>{busy ? <><LoaderCircle size={16} className="spin" /> Sending…</> : <><Truck size={16} /> Send stock</>}</button>
        </div>
      </form>
    </div>
  );
}

function ReceiveForm({ auth, transfer: t, name, onClose, onDone }) {
  const [got, setGot] = useState(Object.fromEntries(t.items.map(i => [i.product_id, String(i.quantity)])));
  const [notes, setNotes] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const short = t.items.reduce((n, i) => n + Math.max(0, Number(i.quantity) - (Number(got[i.product_id]) || 0)), 0);
  async function save(e) {
    e.preventDefault(); setError('');
    for (const i of t.items) { const n = Number(got[i.product_id]); if (!Number.isInteger(n) || n < 0 || n > i.quantity) { setError(`Received ${i.name} must be between 0 and ${i.quantity}.`); return; } }
    if (short && !notes.trim()) { setError(`${short} ${short === 1 ? 'item is' : 'items are'} missing. Add a note saying what happened.`); return; }
    setBusy(true);
    try {
      await receiveTransfer(auth.membership.company_id, t.id, t.items.map(i => ({ product_id: i.product_id, quantity: Number(got[i.product_id]) })), notes);
      toast(short ? `Received with ${short} missing. Recorded on ${t.number}.` : `All stock received at ${name(t.to_branch_id)}.`);
      onDone();
    } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal" onSubmit={save} aria-label={'Receive ' + t.number}>
        <div className="modal-head"><h2>Receive stock</h2><button type="button" aria-label="Close" onClick={onClose}><X /></button></div>
        <p className="muted">{t.number} from {name(t.from_branch_id)}. Count what arrived; change a number if something is missing or damaged.</p>
        <ErrorBox text={error} />
        <ul className="transfer-lines">
          {t.items.map(i => (
            <li key={i.product_id}>
              <span><strong>{i.name}</strong><small>Sent {i.quantity}</small></span>
              <input type="number" min="0" max={i.quantity} step="1" inputMode="numeric" aria-label={'Received ' + i.name} value={got[i.product_id]} onChange={e => setGot(g => ({ ...g, [i.product_id]: e.target.value }))} />
            </li>
          ))}
        </ul>
        {short > 0 && <div className="integration-note">{short} {short === 1 ? 'item' : 'items'} short. They will be recorded as missing and won’t be added to stock.</div>}
        <label>Notes {short ? '(required)' : '(optional)'}<input maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} placeholder={short ? 'e.g. 2 bottles broken on the way' : ''} /></label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" /> Saving…</> : <><PackageCheck size={16} /> Confirm received</>}</button>
        </div>
      </form>
    </div>
  );
}
