import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw, FileSpreadsheet, Undo2, Search, Plus, Wallet, ArrowDownLeft, ArrowUpRight, Scale, AlertCircle } from 'lucide-react';
import { supabase } from './supabase';
import { toast } from './Toast';
import { Skeleton } from './Loading';
import { list, rpc, unwrap, today, monthStart, downloadCSV, cashbookLedger } from './operations';
import { cashbookPeriod } from './operation-utils';
import { paymentMethods } from './totals';
import { cashbookSheet, dailyTotals, INCOME_CATEGORIES, EXPENSE_CATEGORIES, isReversal } from './statements';
import { downloadWorkbook } from './xlsx-export';

const money = (n, c) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c }).format(Number(n || 0));
const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const blank = () => ({ date: today(), type: 'expense', category: 'Miscellaneous', description: '', amount: '', method: 'Cash' });

/**
 * Cashbook laid out like a cash book in a spreadsheet: opening balance, one row per movement with
 * money in / money out / running balance, daily subtotals if wanted, totals and the closing balance.
 * New entries are typed straight into the last row; mistakes are corrected with a reversing entry.
 */
export default function CashbookSheet({ auth }) {
  const m = auth.membership, cid = m.company_id, c = m.companies.currency;
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [staff, setStaff] = useState([]);
  const [range, setRange] = useState({ from: monthStart(), to: today() }), [period, setPeriod] = useState('monthly');
  const [method, setMethod] = useState('All'), [q, setQ] = useState(''), [daily, setDaily] = useState(false);
  const [form, setForm] = useState(blank), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false);
  const request = useRef(crypto.randomUUID()), amountRef = useRef(null), descRef = useRef(null);

  useEffect(() => {
    let active = true; setLoading(true); setError('');
    Promise.all([list('cashbook_entries', cid), list('sales', cid), list('payments', cid), supabase.from('financial_balances').select('*').eq('company_id', cid).then(unwrap), rpc('list_store_staff', { p_company_id: cid }).catch(() => [])])
      .then(([entries, sales, payments, balances, people]) => { if (active) { setData({ entries, sales, payments, opening: balances[0] || null }); setStaff(people || []); } })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cid, revision]);

  const ledger = useMemo(() => data ? cashbookLedger(data.sales, data.payments, data.entries) : [], [data]);
  const filtered = useMemo(() => ledger.filter(e => method === 'All' || e.payment_method === method), [ledger, method]);
  // Opening balance only makes sense for all payment methods together.
  const sheet = useMemo(() => cashbookSheet(filtered, range.from, range.to, method === 'All' ? data?.opening : null), [filtered, range, method, data]);
  const who = r => r.recorded_by || staff.find(s => s.user_id === r.created_by)?.full_name || '—';
  const visible = sheet.rows.filter(r => !q || [r.description, r.category, r.payment_method, who(r)].join(' ').toLowerCase().includes(q.toLowerCase()));
  const days = daily ? new Map(dailyTotals(sheet).map(d => [d.day, d])) : null;
  const reversed = useMemo(() => new Set((data?.entries || []).filter(isReversal).map(e => e.description.replace(/^Reversal of /i, '').trim())), [data]);

  function choosePeriod(p) { const r = cashbookPeriod(p); setRange({ from: r.from, to: r.to }); setPeriod(p); }

  async function save(e) {
    e?.preventDefault();
    if (busy) return;
    const amount = Number(form.amount);
    if (!form.description.trim()) { descRef.current?.focus(); toast('Add a short description.', 'info'); return; }
    if (!(amount > 0)) { amountRef.current?.focus(); toast('Enter an amount above zero.', 'info'); return; }
    setBusy(true);
    try {
      await rpc('record_cashbook', { p_company_id: cid, p_date: form.date, p_type: form.type, p_category: form.category, p_description: form.description.trim(), p_amount: Math.round(amount * 100) / 100, p_method: form.method, p_request_id: request.current });
      request.current = crypto.randomUUID();
      toast(`${form.type === 'income' ? 'Money in' : 'Money out'} of ${money(amount, c)} recorded.`);
      setForm(f => ({ ...blank(), date: f.date, type: f.type, method: f.method, category: f.type === 'income' ? 'Other income' : 'Miscellaneous' }));
      if (form.date < range.from || form.date > range.to) setPeriod('custom');
      setRevision(n => n + 1);
      setTimeout(() => descRef.current?.focus(), 50);
    } catch (err) { toast(err.message || 'Could not save the entry.', 'error'); } finally { setBusy(false); }
  }

  function reverse(r) {
    request.current = crypto.randomUUID();
    setForm({ date: today(), type: r.type === 'income' ? 'expense' : 'income', category: r.category, description: `Reversal of ${r.description}`, amount: String(r.amount), method: r.payment_method });
    toast('A reversing entry is ready in the last row. Check it and press Enter to save.', 'info');
    setTimeout(() => amountRef.current?.focus(), 50);
  }

  const columns = [
    { header: 'Date', key: 'entry_date', type: 'date', width: 13 }, { header: 'Description', key: 'description', type: 'text', width: 34 }, { header: 'Category', key: 'category', type: 'text', width: 20 },
    { header: 'Method', key: 'payment_method', type: 'text', width: 14 }, { header: 'Source', key: 'source', type: 'text', width: 10 }, { header: 'Recorded by', key: 'who', type: 'text', width: 18 },
    { header: 'Money in', key: 'in', type: 'money' }, { header: 'Money out', key: 'out', type: 'money' }, { header: 'Balance', key: 'balance', type: 'money' },
  ];
  const exportRows = () => [
    { entry_date: range.from, description: sheet.hasOpening ? 'Opening balance' : 'Opening balance not set — balance starts at 0', balance: sheet.openingBalance ?? 0, _style: 'opening' },
    ...visible.map(r => ({ ...r, who: who(r), in: r.in || null, out: r.out || null })),
  ];
  async function exportExcel() {
    setExporting(true);
    try {
      await downloadWorkbook(`ipos-cashbook-${range.from}-to-${range.to}`, { store: m.companies.name, currency: c, sheets: [
        { name: 'Cashbook', title: 'Cashbook', subtitle: `${nice(range.from)} – ${nice(range.to)}${method !== 'All' ? ` · ${method} only` : ''}`, columns, rows: exportRows(),
          totals: { description: `Totals · closing balance ${money(sheet.closingBalance, c)}`, in: 'sum', out: 'sum', balance: sheet.closingBalance },
          notes: ['POS sales are included automatically (cash change deducted). Paid purchases appear once as expenses.', 'Corrections are recorded as reversing entries ("Reversal of …").'] },
        { name: 'Daily totals', title: 'Daily totals', subtitle: `${nice(range.from)} – ${nice(range.to)}`, columns: [{ header: 'Date', key: 'day', type: 'date' }, { header: 'Money in', key: 'in', type: 'money' }, { header: 'Money out', key: 'out', type: 'money' }, { header: 'Closing balance', key: 'balance', type: 'money' }], rows: dailyTotals(sheet), totals: { day: 'Total', in: 'sum', out: 'sum' } },
      ] });
      toast('Cashbook downloaded as Excel.');
    } catch (err) { toast(err.message || 'Could not create the Excel file.', 'error'); } finally { setExporting(false); }
  }
  function exportCSV() {
    downloadCSV(`ipos-cashbook-${range.from}-${range.to}.csv`, [columns.map(col => col.header), ...exportRows().map(r => columns.map(col => r[col.key] ?? ''))]);
  }

  const cats = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">ACCOUNTING</span><h1>Cashbook</h1><p>Every shilling in and out, with a running balance — like a cash book in Excel. POS sales are added automatically.</p></div>
        <div className="heading-actions">
          <button className="secondary" onClick={() => setRevision(n => n + 1)}><RefreshCw size={17} /> Refresh</button>
          <button className="secondary" onClick={exportCSV} disabled={!data}><Download size={17} /> CSV</button>
          <button className="primary" onClick={exportExcel} disabled={!data || exporting}><FileSpreadsheet size={17} /> {exporting ? 'Preparing…' : 'Download Excel'}</button>
        </div>
      </div>
      {error && <div className="notice" role="alert"><AlertCircle size={18} />{error}</div>}
      <div className="operation-tabs">{['daily', 'weekly', 'monthly', 'annual'].map(p => <button key={p} className={period === p ? 'active' : ''} onClick={() => choosePeriod(p)}>{p === 'daily' ? 'Today' : p === 'weekly' ? 'This week' : p === 'monthly' ? 'This month' : 'This year'}</button>)}</div>
      <div className="date-filter">
        <label>From<input type="date" value={range.from} onChange={e => { setRange(r => ({ ...r, from: e.target.value })); setPeriod('custom'); }} /></label>
        <label>To<input type="date" min={range.from} value={range.to} onChange={e => { setRange(r => ({ ...r, to: e.target.value })); setPeriod('custom'); }} /></label>
        <label>Payment method<select value={method} onChange={e => setMethod(e.target.value)}>{['All', ...paymentMethods].map(x => <option key={x}>{x}</option>)}</select></label>
        <div className="search-box"><Search size={16} /><input placeholder="Search description, category…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search cashbook" /></div>
        <label className="check"><input type="checkbox" checked={daily} onChange={e => setDaily(e.target.checked)} /> Daily totals</label>
      </div>
      {loading && !data ? <Skeleton label="Loading cashbook…" /> : data && <>
        <div className="stat-grid operation-stats cash-stats">
          {[['Opening balance', sheet.openingBalance, Wallet, sheet.hasOpening ? nice(range.from) : 'Not set'], ['Money in', sheet.totalIn, ArrowDownLeft, `${visible.filter(r => r.in).length} entries`], ['Money out', sheet.totalOut, ArrowUpRight, `${visible.filter(r => r.out).length} entries`], ['Closing balance', sheet.closingBalance, Scale, nice(range.to)]].map(([l, v, Icon, note]) => (
            <div className="stat-card" key={l}><div>{l}<Icon size={18} /></div><strong>{v === null ? '—' : money(v, c)}</strong><small>{note}</small></div>
          ))}
        </div>
        {!sheet.hasOpening && method === 'All' && <div className="integration-note">No opening cash is set{data.opening ? ` before ${nice(data.opening.opening_date)}` : ''}, so the balance starts at zero. Set it in <Link to="/reports">Reports → Costs & opening balances</Link>.</div>}
        {method !== 'All' && <div className="integration-note">Showing {method} only. The balance column counts only {method} movements in this period.</div>}
        <form className="table-panel table-scroll sheet-wrap" onSubmit={save}>
          <table className="sheet-table cashbook-sheet">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Method</th><th>Recorded by</th><th className="num">Money in</th><th className="num">Money out</th><th className="num">Balance</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              <tr className="sheet-opening"><td>{nice(range.from)}</td><td colSpan={6}><strong>Opening balance</strong>{!sheet.hasOpening && <small> — not set, starting at 0</small>}</td><td className="num"><strong>{money(sheet.openingBalance ?? 0, c)}</strong></td><td /></tr>
              {visible.map((r, i) => {
                const next = visible[i + 1], dayTotal = days && (!next || next.entry_date !== r.entry_date) ? days.get(r.entry_date) : null;
                const canReverse = r.source === 'Manual' && !isReversal(r) && !reversed.has(r.description);
                return (
                  <React.Fragment key={r.id}>
                    <tr className={isReversal(r) ? 'reversal' : ''}>
                      <td>{nice(r.entry_date)}</td>
                      <td>{r.description}<small>{r.source}</small></td>
                      <td>{r.category}</td><td>{r.payment_method}</td><td>{who(r)}</td>
                      <td className="num in">{r.in ? money(r.in, c) : ''}</td><td className="num out">{r.out ? money(r.out, c) : ''}</td>
                      <td className={'num' + (r.balance < 0 ? ' neg' : '')}>{money(r.balance, c)}</td>
                      <td>{canReverse && <button type="button" className="icon-reverse" title="Reverse — record an opposite entry to cancel this one" aria-label={`Reverse ${r.description}`} onClick={() => reverse(r)}><Undo2 size={14} /></button>}{r.source === 'Manual' && !canReverse && !isReversal(r) && <small className="muted" title="Already reversed">↩︎</small>}</td>
                    </tr>
                    {dayTotal && <tr className="sheet-subtotal"><td colSpan={5}>Total for {nice(r.entry_date)}</td><td className="num">{money(dayTotal.in, c)}</td><td className="num">{money(dayTotal.out, c)}</td><td className="num">{money(dayTotal.balance, c)}</td><td /></tr>}
                  </React.Fragment>
                );
              })}
              {!visible.length && <tr><td colSpan={9} className="muted center">No money in or out {q ? 'matches your search' : 'in this period'}.</td></tr>}
              <tr className="sheet-entry" aria-label="New entry">
                <td><input type="date" required max={today()} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} aria-label="Date" /></td>
                <td><input ref={descRef} placeholder="New entry: what was it for?" maxLength={200} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} aria-label="Description" /></td>
                <td><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} aria-label="Category">{(cats.includes(form.category) ? cats : [form.category, ...cats]).map(x => <option key={x}>{x}</option>)}</select></td>
                <td><select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} aria-label="Payment method">{paymentMethods.map(x => <option key={x}>{x}</option>)}</select></td>
                <td><select value={form.type} onChange={e => { const type = e.target.value; setForm({ ...form, type, category: type === 'income' ? 'Other income' : 'Miscellaneous' }); }} aria-label="Money in or out"><option value="income">Money in</option><option value="expense">Money out</option></select></td>
                <td className="num" colSpan={2}><input ref={amountRef} inputMode="decimal" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Amount" className={form.type === 'income' ? 'in' : 'out'} /></td>
                <td colSpan={2}><button className="primary" disabled={busy}><Plus size={15} /> {busy ? 'Saving…' : 'Add'}</button></td>
              </tr>
            </tbody>
            <tfoot>
              <tr><td colSpan={5}>Totals</td><td className="num">{money(sheet.totalIn, c)}</td><td className="num">{money(sheet.totalOut, c)}</td><td className="num">{money(sheet.net, c)} <small>net</small></td><td /></tr>
              <tr className="sheet-closing"><td colSpan={7}>Closing balance on {nice(range.to)}</td><td className="num">{money(sheet.closingBalance, c)}</td><td /></tr>
            </tfoot>
          </table>
        </form>
        <p className="muted accounting-note">Type a new entry in the last row and press <b>Enter</b>. Entries can't be edited or deleted — use <b>Reverse</b> to cancel a mistake, which records the opposite entry so your history stays complete. Owner capital, loans and drawings appear here but are not counted as profit or expenses in the Profit & Loss.</p>
      </>}
    </>
  );
}
