import { t as tr } from './i18n';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, X, RefreshCw, LoaderCircle, AlertCircle, Users, Wallet, Phone, Pencil, Receipt, Megaphone, Download } from 'lucide-react';
import * as api from './api';
import { paymentMethods } from './totals';
import { toast } from './Toast';
import { downloadCSV } from './operation-utils';
import * as offline from './offline';
import { contactsCsv } from './receipt-share';

const money = (n, c) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c || 'ZMW' }).format(Number(n || 0));
const msg = e => e?.message || 'Something went wrong. Please try again.';
const when = d => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ENTRY = { credit_sale: 'Credit sale', repayment: 'Payment received', refund: 'Refund to account', adjustment: 'Adjustment' };

function ErrorBox({ text }) { return text ? <div className="notice" role="alert"><AlertCircle size={18} /><span>{text}</span></div> : null; }

export function useCustomers(auth) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const seq = useRef(0);
  async function reload() {
    const n = ++seq.current; setLoading(true); setError('');
    const key = offline.cacheKey(auth.session.user.id, auth.membership.company_id, 'customers');
    try { const r = await api.loadCustomers(auth.membership.company_id); offline.saveCache(key, r); if (n === seq.current) setRows(r); }
    catch (e) {
      if (n !== seq.current) return;
      const cached = offline.isNetworkError(e) && offline.readCache(key);
      if (cached) setRows(cached.data); else setError(msg(e));
    }
    finally { if (n === seq.current) setLoading(false); }
  }
  useEffect(() => { reload(); return () => { seq.current++; }; }, [auth.membership.company_id]);
  return { rows, loading, error, reload, setRows };
}

export function CustomerForm({ auth, customer, onClose, onSaved }) {
  const isDirector = auth.membership.role === 'director';
  const [form, setForm] = useState({
    name: customer?.name || '', phone: customer?.phone || '', email: customer?.email || '', notes: customer?.notes || '',
    credit_limit: customer?.credit_limit == null ? '' : String(customer.credit_limit),
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { name: form.name, phone: form.phone, email: form.email, notes: form.notes };
      if (customer?.id) body.id = customer.id;
      if (isDirector) body.credit_limit = form.credit_limit;
      const id = await api.saveCustomer(auth.membership.company_id, body);
      toast(customer?.id ? 'Customer updated.' : 'Customer added.');
      onSaved?.(id);
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal" onSubmit={save} aria-label={customer ? 'Edit customer' : 'Add customer'}>
        <div className="modal-head"><h2>{customer ? 'Edit customer' : 'Add customer'}</h2><button type="button" aria-label="Close" onClick={onClose}><X /></button></div>
        <ErrorBox text={error} />
        <div className="customer-form">
          <label>Full name<input required maxLength={150} autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label>Phone<input maxLength={40} inputMode="tel" placeholder="e.g. 0977 123456" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Email (optional)<input type="email" maxLength={200} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          {isDirector && (
            <label>Credit limit
              <input type="number" min="0" step="0.01" placeholder="No limit" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} />
              <small>The most this customer may owe at once. Leave empty for no limit.</small>
            </label>
          )}
          <label className="full-width">Notes (optional)<textarea maxLength={1000} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" /> Saving…</> : 'Save customer'}</button>
        </div>
      </form>
    </div>
  );
}

function PaymentForm({ auth, customer, onDone }) {
  const [amount, setAmount] = useState(''), [method, setMethod] = useState('Cash'), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(null);
  const currency = auth.membership.companies.currency;
  async function submit(e) {
    e.preventDefault(); setError('');
    const n = Number(amount);
    if (!(n > 0) || Math.round(n * 100) !== n * 100) return setError('Enter a valid amount.');
    if (n > Number(customer.balance)) return setError(`That is more than the ${money(customer.balance, currency)} owed.`);
    setBusy(true);
    request.current ||= crypto.randomUUID();
    try {
      await api.recordCustomerPayment({ companyId: auth.membership.company_id, customerId: customer.id, amount: n, method, note, requestId: request.current });
      request.current = null; setAmount(''); setNote('');
      toast(`${money(n, currency)} received from ${customer.name}.`);
      onDone();
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  }
  return (
    <form className="pay-form" onSubmit={submit}>
      <h3>Record a payment</h3>
      <ErrorBox text={error} />
      <div className="pay-form-row">
        <label>Amount<input type="number" min="0.01" step="0.01" required value={amount} onChange={e => { setAmount(e.target.value); request.current = null; }} /></label>
        <label>Paid by<select value={method} onChange={e => { setMethod(e.target.value); request.current = null; }}>{paymentMethods.map(m => <option key={m}>{m}</option>)}</select></label>
      </div>
      <button type="button" className="link-button" onClick={() => { setAmount(String(customer.balance)); request.current = null; }}>Pay full balance ({money(customer.balance, currency)})</button>
      <label>Note (optional)<input maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Paid at the counter" /></label>
      <button className="primary" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" /> Saving…</> : <><Wallet size={16} /> Record payment</>}</button>
      <small>Recorded in the Cashbook as a customer repayment. It does not change the cashier's shift cash.</small>
    </form>
  );
}

function CustomerDetail({ auth, customerId, onClose, onChanged }) {
  const m = auth.membership, currency = m.companies.currency;
  const canCredit = ['director', 'supervisor'].includes(m.role);
  const [data, setData] = useState(null), [error, setError] = useState(''), [tab, setTab] = useState(canCredit ? 'account' : 'purchases'), [editing, setEditing] = useState(false);
  async function load() {
    setError('');
    try { setData(await api.loadCustomerDetail(m.company_id, customerId, m.role)); } catch (e) { setError(msg(e)); }
  }
  useEffect(() => { load(); }, [customerId]);
  useEffect(() => { const k = e => { if (e.key === 'Escape' && !editing) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [editing]);
  const c = data?.customer;
  const spent = (data?.sales || []).reduce((n, s) => n + Number(s.total) - Number(s.refunded_total || 0), 0);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal customer-detail" role="dialog" aria-label="Customer details">
        <div className="modal-head">
          <h2>{c?.name || 'Customer'}</h2>
          <div className="modal-head-actions">
            {c && <button className="secondary small" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
            <button aria-label="Close" onClick={onClose}><X /></button>
          </div>
        </div>
        <ErrorBox text={error} />
        {!c ? (!error && <div className="insights-loading"><LoaderCircle size={18} className="spin" /> Loading customer…</div>) : (
          <>
            <div className="customer-summary">
              <div className={'owed-card' + (Number(c.balance) > 0 ? ' owing' : '')}>
                <span>Owes</span><strong>{money(c.balance, currency)}</strong>
                <small>{c.credit_limit == null ? 'No credit limit' : `Limit ${money(c.credit_limit, currency)} · ${money(Math.max(0, c.credit_limit - c.balance), currency)} available`}</small>
              </div>
              <div className="customer-facts">
                {c.phone && <div><Phone size={14} /> <a href={'tel:' + c.phone}>{c.phone}</a></div>}
                {c.email && <div>✉ {c.email}</div>}
                <div><Receipt size={14} /> {data.sales.length} {data.sales.length === 1 ? 'purchase' : 'purchases'} · {money(spent, currency)} spent</div>
                {c.notes && <p className="customer-notes">{c.notes}</p>}
              </div>
            </div>
            {canCredit && (Number(c.balance) > 0 ? <PaymentForm auth={auth} customer={c} onDone={() => { load(); onChanged(); }} /> : <p className="credit-hint">{c.name} owes nothing right now. To give credit, pick them at checkout and tap <strong>Sell on credit</strong>. Once they owe money, you can record their payments here.</p>)}
            <div className="tabs" role="tablist">
              {canCredit && <button role="tab" aria-selected={tab === 'account'} className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>Account history</button>}
              <button role="tab" aria-selected={tab === 'purchases'} className={tab === 'purchases' ? 'active' : ''} onClick={() => setTab('purchases')}>Purchases</button>
            </div>
            {tab === 'account' ? (
              data.ledger.length ? (
                <ul className="ledger-list">
                  {data.ledger.map(l => (
                    <li key={l.id}>
                      <div><strong>{ENTRY[l.entry_type]}</strong><small>{when(l.created_at)} · {l.created_by_name}{l.payment_method ? ' · ' + l.payment_method : ''}{l.note ? ' · ' + l.note : ''}</small></div>
                      <div className="ledger-amounts"><strong className={Number(l.amount) > 0 ? 'debit' : 'credit'}>{Number(l.amount) > 0 ? '+' : '−'}{money(Math.abs(l.amount), currency)}</strong><small>Balance {money(l.balance_after, currency)}</small></div>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No credit sales or payments yet.</p>
            ) : (
              data.sales.length ? (
                <ul className="ledger-list">
                  {data.sales.map(s => (
                    <li key={s.id}>
                      <div><strong>{s.receipt_number}</strong><small>{when(s.created_at)} · {s.item_count} items · {s.payment_method}</small></div>
                      <div className="ledger-amounts"><strong>{money(s.total, currency)}</strong>{Number(s.refunded_total) > 0 && <small>Refunded {money(s.refunded_total, currency)}</small>}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">{m.role === 'cashier' ? 'You have no sales to this customer yet.' : 'No purchases yet.'}</p>
            )}
          </>
        )}
      </div>
      {editing && c && <CustomerForm auth={auth} customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); onChanged(); }} />}
    </div>
  );
}

export function Customers({ auth }) {
  const m = auth.membership, currency = m.companies.currency;
  const customers = useCustomers(auth);
  const [search, setSearch] = useState(''), [owingOnly, setOwingOnly] = useState(false), [offersOnly, setOffersOnly] = useState(false), [adding, setAdding] = useState(false), [open, setOpen] = useState(null);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase(), digits = q.replace(/\D/g, '');
    return customers.rows.filter(c => (!owingOnly || Number(c.balance) > 0) && (!offersOnly || c.marketing_opt_in) &&
      (!q || c.name.toLowerCase().includes(q) || (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits))));
  }, [customers.rows, search, owingOnly, offersOnly]);
  const offers = customers.rows.filter(c => c.marketing_opt_in);
  async function toggleOffers(c) {
    const on = !c.marketing_opt_in;
    if (on && !window.confirm(`Has ${c.name} agreed to receive offers and news from ${m.companies.name}?`)) return;
    try {
      await api.setCustomerMarketing(m.company_id, c.id, on);
      customers.setRows(rows => rows.map(x => x.id === c.id ? { ...x, marketing_opt_in: on, marketing_opt_in_at: on ? new Date().toISOString() : null } : x));
      toast(on ? `${c.name} will receive offers.` : `${c.name} will no longer receive offers.`);
    } catch (e) { toast(msg(e), 'error'); }
  }
  function exportOffers() {
    if (!offers.length) { toast('No customers have agreed to receive offers yet. Tick the box when sending a receipt.', 'info'); return; }
    const blob = new Blob(['\ufeff' + contactsCsv(customers.rows)], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'ipos-offers-contacts.csv' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${offers.length} ${offers.length === 1 ? 'contact' : 'contacts'} exported.`);
  }
  const owing = customers.rows.filter(c => Number(c.balance) > 0);
  const totalOwed = owing.reduce((n, c) => n + Number(c.balance), 0);
  const over = customers.rows.filter(c => c.credit_limit != null && Number(c.balance) > Number(c.credit_limit));
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">STORE WORKSPACE</span><h1>Customers</h1><p>Your regular customers, what they buy and what they owe.</p></div>
        <div className="heading-actions">
          {m.role !== 'cashier' && <button className="secondary" onClick={() => downloadCSV('ipos-customers.csv', [['Name', 'Phone', 'Email', 'Owes', 'Credit limit'], ...customers.rows.map(c => [c.name, c.phone || '', c.email || '', c.balance, c.credit_limit ?? ''])])}>Export</button>}
          {m.role !== 'cashier' && <button className="secondary" onClick={exportOffers} title="Customers who agreed to receive offers"><Download size={16} /> Offers list</button>}
          <button className="primary" onClick={() => setAdding(true)}><Plus size={18} /> Add customer</button>
        </div>
      </div>
      <ErrorBox text={customers.error} />
      <div className="stat-grid customer-stats">
        <div className="stat-card"><div>Customers<Users size={19} /></div><strong>{customers.rows.length}</strong><small>Saved in your store</small></div>
        <div className="stat-card"><div>Customers owe you<Wallet size={19} /></div><strong>{money(totalOwed, currency)}</strong><small>{owing.length} {owing.length === 1 ? 'customer' : 'customers'} with a balance</small></div>
        {over.length > 0 && <div className="stat-card warn"><div>Over their limit<AlertCircle size={19} /></div><strong>{over.length}</strong><small>Check before giving more credit</small></div>}
        <div className="stat-card"><div>Get offers<Megaphone size={19} /></div><strong>{offers.length}</strong><small>Agreed to offers and news</small></div>
      </div>
      <div className="table-panel">
        <div className="table-toolbar">
          <div className="search-box"><Search size={18} /><input placeholder="Search by name or phone…" aria-label="Search customers" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="toolbar-right">
            <label className="checkbox-label inline"><input type="checkbox" checked={owingOnly} onChange={e => setOwingOnly(e.target.checked)} /> Owing only</label>
            <label className="checkbox-label inline"><input type="checkbox" checked={offersOnly} onChange={e => setOffersOnly(e.target.checked)} /> Gets offers</label>
            <button className="icon-button" aria-label="Refresh customers" onClick={customers.reload}><RefreshCw size={18} /></button>
          </div>
        </div>
        {customers.loading ? <div className="insights-loading"><LoaderCircle size={18} className="spin" /> Loading customers…</div> : list.length ? (
          <div className="table-scroll">
            <table className="customer-table">
              <thead><tr><th>Name</th><th>Phone</th><th>Owes</th><th>Credit limit</th><th>Offers</th><th></th></tr></thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id} onClick={() => setOpen(c.id)} className="clickable">
                    <td><strong>{c.name}</strong></td>
                    <td>{c.phone || '—'}</td>
                    <td>{Number(c.balance) > 0 ? <span className={'badge ' + (c.credit_limit != null && Number(c.balance) > Number(c.credit_limit) ? 'red' : 'amber')}>{money(c.balance, currency)}</span> : <span className="muted-inline">—</span>}</td>
                    <td>{c.credit_limit == null ? <span className="muted-inline">No limit</span> : money(c.credit_limit, currency)}</td>
                    <td><button className={'offer-toggle' + (c.marketing_opt_in ? ' is-on' : '')} aria-pressed={Boolean(c.marketing_opt_in)} disabled={!c.phone && !c.marketing_opt_in} title={c.phone ? (c.marketing_opt_in ? 'Stop sending offers' : 'Customer agreed to offers') : 'Add a phone number first'} onClick={e => { e.stopPropagation(); toggleOffers(c); }}><Megaphone size={14} />{c.marketing_opt_in ? 'Yes' : 'No'}</button></td>
                    <td><button className="link-button" onClick={e => { e.stopPropagation(); setOpen(c.id); }}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty"><Users size={33} /><h3>{search || owingOnly || offersOnly ? 'No customers match' : 'No customers yet'}</h3><p>{search || owingOnly || offersOnly ? 'Try a different name or phone number.' : 'Add customers here or while making a sale.'}</p></div>
        )}
      </div>
      <p className="muted">Credit sales are made at <Link to="/pos">checkout</Link> by a director or supervisor. Customer payments are recorded here and appear in the Cashbook.</p>
      {adding && <CustomerForm auth={auth} onClose={() => setAdding(false)} onSaved={id => { setAdding(false); customers.reload(); setOpen(id); }} />}
      {open && <CustomerDetail auth={auth} customerId={open} onClose={() => setOpen(null)} onChanged={customers.reload} />}
    </>
  );
}

// Checkout customer field: search saved customers by name or phone, or save a new one.
export function CustomerPicker({ auth, customers, value, onChange, disabled, creditSelected, onPayLater, payLaterActive }) {
  const currency = auth.membership.companies.currency;
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const box = useRef(null);
  useEffect(() => { const close = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, []);
  const linked = value.id ? customers.rows.find(c => c.id === value.id) || value : null;
  const q = value.name.trim().toLowerCase(), digits = value.name.replace(/\D/g, '');
  const matches = !linked && q.length >= 2 ? customers.rows.filter(c => c.name.toLowerCase().includes(q) || (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits))).slice(0, 6) : [];
  const exact = matches.some(c => c.name.toLowerCase() === q);
  function pick(c) { onChange({ id: c.id, name: c.name, phone: c.phone || '' }); setOpen(false); setError(''); }
  async function create() {
    setSaving(true); setError('');
    try {
      const looksLikePhone = /^[+\d][\d\s-]{5,}$/.test(value.name.trim());
      const body = looksLikePhone ? { name: value.phone || value.name, phone: value.name } : { name: value.name, phone: value.phone };
      if (looksLikePhone && !value.phone) throw Error(tr("Type the customer's name, then their phone below."));
      const id = await api.saveCustomer(auth.membership.company_id, body);
      await customers.reload();
      onChange({ id, name: body.name.trim(), phone: (body.phone || '').trim() });
      toast(tr('Customer saved.'));
    } catch (e) { setError(msg(e)); }
    finally { setSaving(false); }
  }
  if (linked) {
    const over = linked.credit_limit != null && Number(linked.balance) >= Number(linked.credit_limit);
    return (
      <div className="picked-customer">
        <div>
          <strong>{linked.name}</strong>
          <small>{linked.phone || tr('No phone')}{Number(linked.balance) > 0 ? ' · ' + tr('owes {amount}', { amount: money(linked.balance, currency) }) : ''}{linked.credit_limit != null ? ' · ' + tr('limit {amount}', { amount: money(linked.credit_limit, currency) }) : ''}</small>
          {creditSelected && over && <small className="net-error">{tr('At or over their credit limit')}</small>}
        </div>
        <button type="button" aria-label="Remove customer from sale" disabled={disabled} onClick={() => onChange({ name: '', phone: '' })}><X size={16} /></button>
        {onPayLater && <button type="button" className={'pay-later' + (payLaterActive ? ' active' : '')} disabled={disabled} onClick={onPayLater} aria-pressed={payLaterActive}><Wallet size={15} /> {tr(payLaterActive ? 'Selling on credit' : 'Sell on credit (pay later)')}</button>}
      </div>
    );
  }
  return (
    <div className="customer-picker" ref={box}>
      <label>{tr('Customer (optional)')}
        <input maxLength={150} value={value.name} disabled={disabled} autoComplete="off" placeholder={tr('Search name or phone, or type a new name')}
          onFocus={() => setOpen(true)} onChange={e => { onChange({ ...value, name: e.target.value }); setOpen(true); }}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && matches.length === 1) { e.preventDefault(); pick(matches[0]); } }} />
      </label>
      {open && (matches.length > 0 || (q.length >= 2 && !exact)) && (
        <ul className="picker-list" role="listbox">
          {matches.map(c => (
            <li key={c.id}><button type="button" role="option" aria-selected="false" onClick={() => pick(c)}>
              <span>{c.name}<small>{c.phone || tr('No phone')}</small></span>
              {Number(c.balance) > 0 && <span className="badge amber">{tr('owes {amount}', { amount: money(c.balance, currency) })}</span>}
            </button></li>
          ))}
          {q.length >= 2 && !exact && (
            <li><button type="button" className="picker-new" disabled={saving} onClick={create}><Plus size={14} /> {saving ? tr('Saving…') : tr('Save "{name}" as a new customer', { name: value.name.trim() })}</button></li>
          )}
        </ul>
      )}
      <label>{tr('Phone (optional)')}<input maxLength={40} inputMode="tel" value={value.phone} disabled={disabled} onChange={e => onChange({ ...value, phone: e.target.value })} /></label>
      {error && <small className="net-error">{error}</small>}
      {creditSelected && <small className="net-error">{tr('Choose or save a customer to sell on credit.')}</small>}
    </div>
  );
}
