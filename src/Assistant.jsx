import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Sparkles, Send, RefreshCw, AlertCircle, ArrowRight, X } from 'lucide-react';
import { supabase } from './supabase';
import * as api from './api';
import { Skeleton } from './Loading';
import { ALL, branchName } from './branches';
import { lusakaDay, addDays, dailyBrief, availableQuestions, matchQuestion, answer } from './assistant-utils';

const msg = e => e?.message || 'Something went wrong. Please try again.';
const fmtFor = c => n => `${c === 'ZMW' ? 'K' : c + ' '}${Number(n || 0).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const check = ({ data, error }) => { if (error) throw error; return data; };

async function pages(query) {
  const rows = [];
  for (let n = 0; ; n += 1000) {
    const data = check(await query().range(n, n + 999));
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const cache = new Map();
async function loadAssistantData(m, branchId, fresh) {
  const cid = m.company_id, key = [cid, m.role, branchId].join(':'), hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.data;
  const today = lusakaDay(new Date().toISOString()), since = new Date(addDays(today, -34) + 'T00:00:00+02:00').toISOString();
  const one = branchId && branchId !== ALL ? branchId : null;
  const at = q => one ? q.eq('branch_id', one) : q;
  const [sales, products, costs, customers, batches] = await Promise.all([
    pages(() => at(supabase.from('sales').select('id,created_at,total,cashier_id,cashier_name,branch_id').eq('company_id', cid).gte('created_at', since)).order('created_at').order('id')),
    api.loadProducts(cid, m.role, branchId),
    m.role === 'director' ? pages(() => supabase.from('financial_product_costs').select('product_id,unit_cost').eq('company_id', cid).order('product_id')).catch(() => []) : [],
    pages(() => supabase.from('customers').select('name,phone,balance,credit_limit').eq('company_id', cid).gt('balance', 0).order('balance', { ascending: false })).catch(() => []),
    pages(() => at(supabase.from('stock_batches').select('expiry_date,quantity,branch_id').eq('company_id', cid).gt('quantity', 0).lte('expiry_date', addDays(today, 7))).order('expiry_date')).catch(() => []),
  ]);
  const items = [], payments = [], ids = sales.map(s => s.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [it, pay] = await Promise.all([
      supabase.from('sale_items').select('sale_id,product_id,product_name,quantity,unit_price').eq('company_id', cid).in('sale_id', chunk),
      supabase.from('payments').select('sale_id,method,amount').eq('company_id', cid).in('sale_id', chunk),
    ]);
    items.push(...check(it)); payments.push(...check(pay));
  }
  const data = { sales, items, payments, products, costs: new Map(costs.map(c => [c.product_id, Number(c.unit_cost)])), customers, batches };
  cache.set(key, { at: Date.now(), data });
  return data;
}

function useAssistant(auth, enabled = true) {
  const m = auth.membership;
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  async function load(fresh) {
    setLoading(true); setError('');
    try { setData(await loadAssistantData(m, auth.branchId, fresh)); } catch (e) { setError(msg(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (enabled && auth.branchesLoaded !== false) load(false); }, [m.company_id, m.role, auth.branchId, auth.branchesLoaded, enabled]);
  const ctx = useMemo(() => data && {
    ...data, today: lusakaDay(new Date().toISOString()), fmt: fmtFor(m.companies.currency),
    branches: auth.branches || [], multiBranch: Boolean(auth.multiBranch) && (!auth.branchId || auth.branchId === ALL),
  }, [data, m.companies.currency, auth.branches, auth.multiBranch, auth.branchId]);
  return { ctx, error, loading, reload: () => load(true) };
}

function Bars({ bars }) {
  const max = Math.max(1, ...bars.map(b => b.value));
  return (
    <div className="assist-bars">
      {bars.map(b => (
        <div key={b.label} className="assist-bar"><span className="assist-bar-label">{b.label}</span><span className="assist-bar-track"><i style={{ width: Math.max(2, b.value / max * 100) + '%' }} /></span><span className="assist-bar-value">{b.text}</span></div>
      ))}
    </div>
  );
}

function Answer({ a }) {
  return (
    <>
      {a.lines.map((l, i) => <p key={i}>{l}</p>)}
      {a.bars?.length > 0 && <Bars bars={a.bars} />}
      {a.table && (
        <div className="table-scroll"><table className="assist-table"><thead><tr>{a.table.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{a.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
      )}
      {a.link && <Link className="assist-link" to={a.link.to}>{a.link.label} <ArrowRight size={15} /></Link>}
    </>
  );
}

/** Dashboard card: the daily summary in a few sentences. */
export function AssistantBrief({ auth }) {
  const allowed = ['director', 'supervisor'].includes(auth.membership.role);
  const { ctx } = useAssistant(auth, allowed);
  if (!allowed || !ctx) return null;
  const brief = dailyBrief(ctx);
  return (
    <section className="assist-brief" aria-label="Daily summary">
      <div className="assist-brief-head"><h2><Sparkles size={18} /> {brief.title}</h2><Link to="/assistant">Ask a question <ArrowRight size={15} /></Link></div>
      <ul>{brief.lines.slice(0, 5).map((l, i) => <li key={i}>{l}</li>)}</ul>
    </section>
  );
}

export function Assistant({ auth }) {
  if (!['director', 'supervisor'].includes(auth.membership.role)) return <Navigate to="/pos" replace />;
  return <AssistantContent auth={auth} />;
}

function AssistantContent({ auth }) {
  const { ctx, error, loading, reload } = useAssistant(auth);
  const [text, setText] = useState(''), [asked, setAsked] = useState([]), [miss, setMiss] = useState('');
  const questions = ctx ? availableQuestions(ctx, auth.membership.role) : [];
  function ask(q) {
    setMiss('');
    setAsked(list => [{ id: q.id + ':' + Date.now(), q: q.q, a: answer(q.id, ctx) }, ...list.filter(x => !x.id.startsWith(q.id + ':'))].slice(0, 6));
  }
  function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const q = matchQuestion(t, questions);
    if (q) { ask(q); setText(''); } else setMiss(t);
  }
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">STORE WORKSPACE</span><h1>Business assistant</h1><p>{auth.multiBranch ? `${branchName(auth.branches, auth.branchId)}. ` : ''}Plain answers worked out from your own sales, stock and customers.</p></div>
        <div className="heading-actions"><button className="icon-button" aria-label="Refresh" onClick={reload}><RefreshCw size={18} /></button></div>
      </div>
      {error && <div className="notice" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {!ctx ? (loading && <Skeleton kind="list" rows={5} label="Reading your sales and stock…" />) : (
        <>
          <section className="assist-brief large">
            <div className="assist-brief-head"><h2><Sparkles size={19} /> {dailyBrief(ctx).title}</h2></div>
            <ul>{dailyBrief(ctx).lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </section>
          <form className="assist-ask" onSubmit={submit}>
            <input value={text} maxLength={200} aria-label="Ask a question" placeholder="Ask about sales, stock, profit, customers… e.g. “what should I reorder?”" onChange={e => setText(e.target.value)} />
            <button className="primary" aria-label="Ask"><Send size={17} /> Ask</button>
          </form>
          {miss && (
            <div className="assist-miss" role="status"><span>I can't answer “{miss}” yet. I can answer the questions below — tap one.</span><button type="button" aria-label="Dismiss" onClick={() => setMiss('')}><X size={15} /></button></div>
          )}
          <div className="assist-chips">{questions.map(q => <button key={q.id} type="button" onClick={() => ask(q)}>{q.q}</button>)}</div>
          <div className="assist-answers">
            {asked.map(x => (
              <article key={x.id} className="assist-answer">
                <h3>{x.q}</h3>
                <Answer a={x.a} />
              </article>
            ))}
          </div>
          <p className="muted assist-note">Answers use the last 30 days unless they say otherwise, and amounts are before refunds. Nothing is sent outside iPOS.</p>
        </>
      )}
    </>
  );
}
