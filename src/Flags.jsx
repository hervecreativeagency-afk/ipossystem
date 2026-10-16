import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ShieldAlert, RefreshCw, AlertCircle, Check, Search, RotateCcw, ChevronDown } from 'lucide-react';
import { supabase } from './supabase';
import { toast } from './Toast';
import { Skeleton } from './Loading';
import { ALL, branchName } from './branches';
import { computeFlags, summarize, RULES, GROUPED } from './flag-utils';

const msg = e => e?.message || 'Something went wrong. Please try again.';
const money = (n, c) => `${c === 'ZMW' ? 'K' : c + ' '}${Number(n || 0).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtWhen = iso => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lusaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const SEVERITY = { high: ['Serious', 'red'], medium: ['Check', 'amber'], low: ['Minor', 'grey'] };

async function all(query) {
  const rows = [];
  for (let n = 0; ; n += 1000) {
    const { data, error } = await query().range(n, n + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// Everything the checks need for the last `days` days. Cached briefly so the dashboard and the page share one load.
const cache = new Map();
export async function loadFlagData(cid, days, fresh = false) {
  const key = cid + ':' + days, hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.data;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [sales, refunds, shifts, cashEvents, adjustments, products, staff, reviews] = await Promise.all([
    all(() => supabase.from('sales').select('id,cashier_id,cashier_name,receipt_number,created_at,subtotal,tax,discount,total,shift_id,branch_id').eq('company_id', cid).gte('created_at', since).order('created_at')),
    all(() => supabase.from('sale_refunds').select('id,sale_id,created_at,total,reason,approved_name').eq('company_id', cid).gte('created_at', since).order('created_at')),
    all(() => supabase.from('cashier_shifts').select('id,cashier_id,cashier_name,closed_at,counted_cash,expected_cash,variance,status,branch_id').eq('company_id', cid).eq('status', 'closed').gte('closed_at', since).order('closed_at')),
    all(() => supabase.from('shift_cash_events').select('id,shift_id,created_by,created_at,type,amount,reason').eq('company_id', cid).gte('created_at', since).order('created_at')),
    all(() => supabase.from('stock_adjustments').select('id,product_id,created_by,created_at,quantity,reason,notes,branch_id').eq('company_id', cid).gte('created_at', since).order('created_at')),
    all(() => supabase.from('products').select('id,name,selling_price').eq('company_id', cid).order('id')),
    supabase.rpc('list_store_staff', { p_company_id: cid }).then(r => r.data || [], () => []),
    all(() => supabase.from('flag_reviews').select('*').eq('company_id', cid).order('flag_key')),
  ]);
  // Sales older than the period that had refunds in it (for "refund long after the sale").
  const known = new Set(sales.map(s => s.id)), missing = [...new Set(refunds.map(r => r.sale_id).filter(id => !known.has(id)))];
  const older = [];
  for (let i = 0; i < missing.length; i += 150) {
    const { data, error } = await supabase.from('sales').select('id,cashier_id,cashier_name,receipt_number,created_at,subtotal,tax,discount,total,shift_id,branch_id').eq('company_id', cid).in('id', missing.slice(i, i + 150));
    if (error) throw error;
    older.push(...data);
  }
  const items = [];
  const ids = sales.map(s => s.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('sale_items').select('sale_id,product_id,product_name,quantity,unit_price').eq('company_id', cid).in('sale_id', ids.slice(i, i + 150));
    if (error) throw error;
    items.push(...data);
  }
  const data = { sales, olderSales: older, items, refunds, shifts, cashEvents, adjustments, products, staff, reviews: Object.fromEntries(reviews.map(r => [r.flag_key, r])) };
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Limit to one branch: sales, shifts and adjustments carry a branch; refunds and cash events follow their sale or shift.
export function forBranch(d, branchId) {
  if (!branchId || branchId === ALL) return { ...d, refundSales: d.olderSales };
  const sales = d.sales.filter(s => s.branch_id === branchId), older = d.olderSales.filter(s => s.branch_id === branchId);
  const saleIds = new Set([...sales, ...older].map(s => s.id)), shifts = d.shifts.filter(s => s.branch_id === branchId), shiftIds = new Set(shifts.map(s => s.id));
  return { ...d, sales, refundSales: older, items: d.items.filter(i => saleIds.has(i.sale_id)), refunds: d.refunds.filter(r => saleIds.has(r.sale_id)), shifts,
    cashEvents: d.cashEvents.filter(e => shiftIds.has(e.shift_id)), adjustments: d.adjustments.filter(a => a.branch_id === branchId) };
}

function buildFlags(d, branchId, currency) {
  return computeFlags(forBranch(d, branchId), n => money(n, currency));
}

export function FlagsNotice({ auth }) {
  const m = auth.membership;
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    if (m.role !== 'director' || !auth.branchesLoaded) return;
    let live = true;
    loadFlagData(m.company_id, 30).then(d => { if (live) { const s = summarize(buildFlags(d, auth.branchId, m.companies.currency), d.reviews); setCounts({ open: s.open.length, high: s.high }); } }).catch(() => {});
    return () => { live = false; };
  }, [m.company_id, auth.branchId, auth.branchesLoaded]);
  if (!counts?.open) return null;
  return (
    <div className={'flags-alert' + (counts.high ? ' serious' : '')} role="status">
      <ShieldAlert size={18} />
      <span><strong>{counts.open} {counts.open === 1 ? 'thing needs' : 'things need'} a second look</strong>{counts.high ? ` · ${counts.high} serious` : ''} — drawer shortages, unusual refunds, discounts or missing stock.</span>
      <Link to="/flags">Review checks</Link>
    </div>
  );
}

export function Flags({ auth }) {
  if (auth.membership.role !== 'director') return <Navigate to="/dashboard" replace />;
  return <FlagsContent auth={auth} />;
}

function FlagsContent({ auth }) {
  const m = auth.membership, cid = m.company_id, currency = m.companies.currency;
  const [days, setDays] = useState(30), [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('open'), [search, setSearch] = useState(''), [busy, setBusy] = useState(''), [noting, setNoting] = useState(null), [note, setNote] = useState(''), [rulesOpen, setRulesOpen] = useState(false);
  async function load(fresh) {
    setLoading(true); setError('');
    try { setData(await loadFlagData(cid, days, fresh)); } catch (e) { setError(msg(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(false); }, [cid, days]);
  const flags = useMemo(() => data ? buildFlags(data, auth.branchId, currency) : [], [data, auth.branchId, currency]);
  const s = summarize(flags, data?.reviews || {});
  const list = (tab === 'open' ? s.open : tab === 'looking' ? s.looking : s.fine)
    .filter(f => !search || [f.title, f.detail, f.who, f.ref].join(' ').toLowerCase().includes(search.toLowerCase()));
  const atStake = s.open.filter(f => !GROUPED.has(f.type)).reduce((n, f) => n + (f.amount || 0), 0);

  async function review(f, status, text = null) {
    setBusy(f.key);
    try {
      const { error } = await supabase.rpc('review_flag', { p_company_id: cid, p_flag_key: f.key, p_status: status, p_note: text });
      if (error) throw error;
      setData(d => ({ ...d, reviews: { ...d.reviews, [f.key]: { flag_key: f.key, status, note: text, reviewed_name: auth.profileName || 'You', reviewed_at: new Date().toISOString() } } }));
      cache.clear();
      toast(status === 'ok' ? 'Marked as checked.' : status === 'investigating' ? 'Moved to “Looking into it”.' : 'Moved back to “To check”.');
      setNoting(null); setNote('');
    } catch (e) { toast(msg(e), 'error'); } finally { setBusy(''); }
  }

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">MANAGEMENT</span><h1>Checks</h1><p>{auth.multiBranch ? `${branchName(auth.branches, auth.branchId)}. ` : ''}Things worth a second look. A flag is a reason to look, not proof that anyone did something wrong.</p></div>
        <div className="heading-actions">
          <select aria-label="Period" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
          <button className="icon-button" aria-label="Refresh" onClick={() => load(true)}><RefreshCw size={18} /></button>
        </div>
      </div>
      {error && <div className="notice" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {loading && !data ? <Skeleton kind="dashboard" rows={4} label="Checking sales, refunds, shifts and stock…" /> : data && (
        <>
          <div className="stat-grid branch-stats">
            <div className={'stat-card' + (s.open.length ? ' warn' : '')}><div>To check<ShieldAlert size={19} /></div><strong>{s.open.length}</strong><small>{s.high ? `${s.high} serious` : 'Nothing serious'}</small></div>
            <div className="stat-card"><div>Looking into it<Search size={19} /></div><strong>{s.looking.length}</strong><small>Still open</small></div>
            <div className="stat-card"><div>Checked<Check size={19} /></div><strong>{s.fine.length}</strong><small>Marked as fine</small></div>
            <div className="stat-card"><div>Money involved<AlertCircle size={19} /></div><strong>{money(atStake, currency)}</strong><small>In the checks still to do</small></div>
          </div>
          <div className="flags-toolbar">
            <div className="tabs" role="tablist">
              {[['open', 'To check', s.open.length], ['looking', 'Looking into it', s.looking.length], ['fine', 'Checked', s.fine.length]].map(([k, label, n]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label} <span>{n}</span></button>
              ))}
            </div>
            <div className="search-box"><Search size={16} /><input aria-label="Search checks" placeholder="Search name, receipt or product…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          </div>
          {list.length ? (
            <ul className="flag-list">
              {list.map(f => {
                const r = data.reviews[f.key], [sevLabel, tone] = SEVERITY[f.severity];
                return (
                  <li key={f.key} className={'flag-card ' + f.severity}>
                    <div className="flag-main">
                      <div className="flag-title"><span className={'badge ' + tone}>{sevLabel}</span><strong>{f.title}</strong></div>
                      <p>{f.detail}</p>
                      <small>{[f.who, fmtWhen(f.at)].filter(Boolean).join(' · ')}</small>
                      {r && r.status !== 'open' && <small className="flag-review">{r.status === 'ok' ? 'Checked' : 'Being looked into'} by {r.reviewed_name || 'a director'} on {fmtWhen(r.reviewed_at)}{r.note ? ` — “${r.note}”` : ''}</small>}
                      {noting === f.key && (
                        <form className="flag-note" onSubmit={e => { e.preventDefault(); review(f, 'ok', note); }}>
                          <input autoFocus maxLength={500} placeholder="What did you find? (optional)" value={note} onChange={e => setNote(e.target.value)} aria-label="Note" />
                          <button className="primary" disabled={busy === f.key}>Save</button>
                          <button type="button" className="secondary" onClick={() => { setNoting(null); setNote(''); }}>Cancel</button>
                        </form>
                      )}
                    </div>
                    <div className="flag-actions">
                      {tab !== 'fine' && noting !== f.key && <button className="secondary" disabled={busy === f.key} onClick={() => { setNoting(f.key); setNote(r?.note || ''); }}><Check size={15} /> Looks fine</button>}
                      {tab === 'open' && <button className="secondary" disabled={busy === f.key} onClick={() => review(f, 'investigating')}><Search size={15} /> Looking into it</button>}
                      {tab !== 'open' && <button className="link-button" disabled={busy === f.key} onClick={() => review(f, 'open')}><RotateCcw size={13} /> Reopen</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="empty"><ShieldAlert size={33} /><h3>{search ? 'No checks match your search' : tab === 'open' ? 'Nothing needs a second look' : tab === 'looking' ? 'Nothing being looked into' : 'Nothing marked as checked yet'}</h3><p>{tab === 'open' && !search ? `No drawer shortages, unusual refunds, big discounts or missing stock in the last ${days} days.` : ''}</p></div>
          )}
          <section className="flag-rules">
            <button type="button" aria-expanded={rulesOpen} onClick={() => setRulesOpen(o => !o)}>What iPOS checks <ChevronDown size={16} /></button>
            {rulesOpen && (
              <ul>
                <li>A drawer that is short by {money(RULES.shortMin, currency)} or more when the shift closes (serious from {money(RULES.shortHigh, currency)}), or over by {money(RULES.overMin, currency)} or more.</li>
                <li>The same cashier's drawer being short {RULES.repeatShort} or more times.</li>
                <li>A refund within {RULES.quickRefundMins} minutes of the sale, or more than {RULES.lateRefundDays} days after it.</li>
                <li>{RULES.heavyRefundCount} or more refunds on one cashier's sales, adding up to {Math.round(RULES.heavyRefundShare * 100)}% or more of what they sold.</li>
                <li>A discount of {Math.round(RULES.discountShare * 100)}% or more of the sale (serious from {Math.round(RULES.discountHigh * 100)}%).</li>
                <li>An item sold below {Math.round(RULES.lowPriceShare * 100)}% of its current price.</li>
                <li>Sales between {RULES.nightStart}:00 and {String(RULES.nightEnd).padStart(2, '0')}:00.</li>
                <li>One product adjusted out of stock as missing, damaged or wasted {RULES.lossCount} or more times, or {RULES.lossUnits}+ units removed at once.</li>
                <li>{money(RULES.cashOutMin, currency)} or more taken out of a drawer at once.</li>
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
