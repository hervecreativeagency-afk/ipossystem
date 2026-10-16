import { Skeleton } from './Loading';
import FinancialSetup from './FinancialSetup';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertCircle, BarChart3, FileSpreadsheet, ChevronDown, FileText } from 'lucide-react';
import { supabase } from './supabase';
import { toast } from './Toast';
import { today, monthStart, dateBounds, downloadCSV, cashbookLedger } from './operations';
import { reportModel, sum, localDay } from './report-utils';
import { profitAndLoss, balanceSheet, compare, comparisonPeriod } from './statements';
import { StatementTable } from './Statement';
import { downloadWorkbook } from './xlsx-export';

const tabs = ['Sales Breakdown', 'Product Stock Analytics', 'Profit & Loss', 'Cashier Rankings', 'Supplier Debts', 'Balance Sheet', 'Stock & Restock Guide'];
const TABLES = ['sales', 'sale_items', 'products', 'purchase_orders', 'cashbook_entries', 'payments', 'financial_product_costs', 'financial_sale_costs', 'financial_balances', 'sale_refunds', 'refund_items', 'customers', 'customer_ledger'];
const money = (n, c) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c }).format(Number(n || 0));
const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function rows(table, cid, since) {
  const all = [];
  for (let n = 0; ; n += 1000) {
    let q = supabase.from(table).select('*').eq('company_id', cid);
    if (since) q = q.gte('created_at', since);
    const { data, error } = await q.order('id').range(n, n + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

function presets(day) {
  const y = day.slice(0, 4), m = day.slice(0, 7);
  const lastMonthEnd = addDays(m + '-01', -1), q = Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3 + 1;
  return [
    ['This month', m + '-01', day],
    ['Last month', lastMonthEnd.slice(0, 7) + '-01', lastMonthEnd],
    ['This quarter', `${y}-${String(q).padStart(2, '0')}-01`, day],
    ['This year', y + '-01-01', day],
    ['Last 30 days', addDays(day, -29), day],
  ];
}

function DataTable({ view, fmt }) {
  const show = (c, v) => c.render ? c.render(v) : v == null || v === '' ? '—' : c.type === 'money' ? fmt(v) : c.type === 'number' ? Number(v).toLocaleString('en-ZM') : v;
  return (
    <div className="table-panel table-scroll">
      <table className="sheet-table">
        <thead><tr>{view.columns.map(c => <th key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num' : ''}>{c.header}</th>)}</tr></thead>
        <tbody>{view.rows.map((r, i) => <tr key={i}>{view.columns.map(c => <td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num' : ''}>{show(c, r[c.key])}</td>)}</tr>)}</tbody>
        {view.totals && view.rows.length > 0 && <tfoot><tr>{view.columns.map(c => <td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num' : ''}>{view.totals[c.key] === 'sum' ? (c.type === 'money' ? fmt(view.rows.reduce((n, r) => n + Number(r[c.key] || 0), 0)) : view.rows.reduce((n, r) => n + Number(r[c.key] || 0), 0).toLocaleString('en-ZM')) : view.totals[c.key] || ''}</td>)}</tr></tfoot>}
      </table>
      {!view.rows.length && <div className="empty"><h3>No records in this view</h3><p>Recorded store activity will appear here.</p></div>}
    </div>
  );
}

function Facts({ title, rows: records }) {
  return <section className="management-panel"><h2>{title}</h2><dl className="report-facts">{records.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>;
}

export default function DetailedReports({ auth }) {
  const m = auth.membership, c = m.companies.currency, store = m.companies.name;
  const [data, setData] = useState(null), [movements, setMovements] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(tabs[0]), [from, setFrom] = useState(monthStart()), [to, setTo] = useState(today()), [range, setRange] = useState({ from: monthStart(), to: today() });
  const [mode, setMode] = useState('previous'), [revision, setRevision] = useState(0), [financialEditing, setFinancialEditing] = useState(false), [menu, setMenu] = useState(false), [exporting, setExporting] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => { setFinancialEditing(false); }, [m.company_id]);
  useEffect(() => {
    let active = true; setLoading(true); setData(null); setError('');
    Promise.all(TABLES.map(t => rows(t, m.company_id))).then(r => { if (active) setData(Object.fromEntries(TABLES.map((t, i) => [t, r[i]]))); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [m.company_id, revision]);
  useEffect(() => { const close = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, []);

  const prev = comparisonPeriod(range.from, range.to, mode);
  const bsPrevDate = mode === 'none' ? null : mode === 'lastYear' ? prev.to : addDays(range.from, -1);
  // Stock movements after the earliest balance-sheet date, to rebuild stock on that date.
  const earliest = bsPrevDate && bsPrevDate < range.to ? bsPrevDate : range.to;
  useEffect(() => {
    let active = true; setMovements(null);
    rows('stock_movements', m.company_id, new Date(earliest + 'T00:00:00+02:00').toISOString()).then(r => { if (active) setMovements(r); }).catch(() => { if (active) setMovements([]); });
    return () => { active = false; };
  }, [m.company_id, earliest, revision]);

  const fmt = n => money(n, c);
  const model = useMemo(() => data ? reportModel(data, today(), range.from, range.to) : null, [data, range]);
  const pl = useMemo(() => data ? compare(profitAndLoss(data, range.from, range.to), prev ? profitAndLoss(data, prev.from, prev.to) : null) : null, [data, range, mode]);
  const plNow = useMemo(() => data ? profitAndLoss(data, range.from, range.to) : null, [data, range]);
  const bsNow = useMemo(() => data && movements ? balanceSheet(data, range.to, { movements, ledger: data.customer_ledger }) : null, [data, movements, range]);
  const bs = useMemo(() => bsNow ? compare(bsNow, bsPrevDate ? balanceSheet(data, bsPrevDate, { movements, ledger: data.customer_ledger }) : null) : null, [bsNow, bsPrevDate]);
  const plLabels = { current: `${nice(range.from)} – ${nice(range.to)}`, previous: prev ? `${prev.label} (${nice(prev.from)} – ${nice(prev.to)})` : '' };
  const bsLabels = { current: `As of ${nice(range.to)}`, previous: bsPrevDate ? `As of ${nice(bsPrevDate)}` : '' };

  // Raw views (numbers, not formatted text), shared by the screen and the downloads.
  function viewFor(t) {
    if (!model) return null;
    if (t === tabs[0]) return {
      columns: [{ header: 'Receipt', key: 'receipt', type: 'text', render: v => <Link to="/receipts">{v}</Link> }, { header: 'Date & time', key: 'date', type: 'date', render: v => new Date(v).toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' }) }, { header: 'Cashier', key: 'cashier', type: 'text' }, { header: 'Payment', key: 'method', type: 'text' }, { header: 'Tax', key: 'tax', type: 'money' }, { header: 'Total paid', key: 'total', type: 'money' }],
      rows: [...model.selected].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(s => ({ receipt: s.receipt_number, date: s.created_at, cashier: s.cashier_name, method: s.payment_method, tax: Number(s.tax), total: Number(s.total) })),
      totals: { receipt: 'Total', tax: 'sum', total: 'sum' },
    };
    if (t === tabs[1]) return {
      columns: [{ header: 'Product', key: 'name', type: 'text' }, { header: 'SKU', key: 'sku', type: 'text' }, { header: 'Stock', key: 'stock', type: 'number' }, { header: 'Sold in period', key: 'sold', type: 'number' }, { header: 'Selling price', key: 'price', type: 'money' }, { header: 'Retail value', key: 'value', type: 'money' }, { header: 'Status', key: 'status', type: 'text' }],
      rows: model.stock.map(p => ({ name: p.name, sku: p.sku, stock: Number(p.stock_quantity), sold: p.sold, price: Number(p.selling_price), value: Number(p.stock_quantity) * Number(p.selling_price), status: Number(p.stock_quantity) === 0 ? 'Out of stock' : Number(p.stock_quantity) <= Number(p.low_stock_threshold) ? 'Low stock' : 'In stock' })),
      totals: { name: 'Total', stock: 'sum', sold: 'sum', value: 'sum' },
    };
    if (t === tabs[3]) return {
      columns: [{ header: 'Rank', key: 'rank', type: 'number' }, { header: 'Cashier', key: 'name', type: 'text' }, { header: 'Transactions', key: 'tx', type: 'number' }, { header: 'Sales', key: 'total', type: 'money' }, { header: 'Average sale', key: 'avg', type: 'money' }, { header: 'Tax', key: 'tax', type: 'money' }],
      rows: model.ranks.map((r, i) => ({ rank: i + 1, name: r.name, tx: r.transactions, total: r.total, avg: r.transactions ? r.total / r.transactions : 0, tax: r.tax })),
      totals: { name: 'Total', tx: 'sum', total: 'sum', tax: 'sum' },
    };
    if (t === tabs[4]) return {
      columns: [{ header: 'Supplier', key: 'name', type: 'text' }, { header: 'Unpaid received orders', key: 'orders', type: 'number' }, { header: 'Outstanding', key: 'total', type: 'money' }],
      rows: model.debts.map(d => ({ name: d.name, orders: d.orders, total: d.total })), totals: { name: 'Total', orders: 'sum', total: 'sum' },
    };
    if (t === tabs[6]) return {
      columns: [{ header: 'Product', key: 'name', type: 'text' }, { header: 'Sold last 30 days', key: 'month', type: 'number' }, { header: 'Normal max', key: 'max', type: 'number' }, { header: 'Reorder level', key: 'level', type: 'number' }, { header: 'In stock', key: 'qty', type: 'number' }, { header: 'Status', key: 'status', type: 'text' }, { header: 'Advice', key: 'advice', type: 'text' }],
      rows: model.stock.map(p => { const max = Math.max(p.recent, Number(p.low_stock_threshold) + 1), low = Number(p.stock_quantity) <= Number(p.low_stock_threshold); return { name: `${p.sku} / ${p.name}`, month: p.recent, max, level: Number(p.low_stock_threshold), qty: Number(p.stock_quantity), status: Number(p.stock_quantity) === 0 ? 'Out of stock' : low ? 'Please restock' : 'Satisfactory', advice: low ? `Buy ${Math.max(0, max - Number(p.stock_quantity))} units` : '—' }; }),
    };
    return null;
  }

  function sheetFor(t) {
    if (t === tabs[2]) return { name: 'Profit & Loss', title: 'Profit & Loss statement', subtitle: plLabels.current, lines: pl, valueColumns: [{ header: 'This period', key: 'value' }, ...(prev ? [{ header: prev.label, key: 'prev' }, { header: 'Change', key: 'change', type: 'percent' }] : [])], notes: [`Comparison: ${plLabels.previous || 'none'}.`, 'Amounts exclude tax. Cost of goods sold uses the cost recorded when each item was sold.', ...(plNow.missingSaleCosts ? [`${plNow.missingSaleCosts} sold item(s) have no cost yet — add them in Financial data.`] : [])] };
    if (t === tabs[5]) return { name: 'Balance Sheet', title: 'Balance sheet', subtitle: bsLabels.current, lines: bs, valueColumns: [{ header: bsLabels.current, key: 'value' }, ...(bsPrevDate ? [{ header: bsLabels.previous, key: 'prev' }, { header: 'Change', key: 'change', type: 'percent' }] : [])], notes: ['Stock is valued at current unit costs. Earlier dates are rebuilt by undoing later sales, deliveries, adjustments and customer payments.', "Owner's equity is assets minus liabilities."] };
    const v = viewFor(t);
    return v && { name: t, title: t, subtitle: `${nice(range.from)} – ${nice(range.to)}`, columns: v.columns, rows: v.rows, totals: v.totals };
  }

  async function exportExcel(all) {
    setMenu(false); setExporting(true);
    try {
      if (!bs) throw Error('Still loading the balance sheet — try again in a moment.');
      const sheets = (all ? tabs : [tab]).map(sheetFor).filter(Boolean);
      await downloadWorkbook(`ipos-${all ? 'reports' : tab.toLowerCase().replaceAll(' ', '-').replace(/[^a-z-]/g, '')}-${range.from}-to-${range.to}`, { store, currency: c, sheets });
      toast(all ? 'Excel workbook with all reports downloaded.' : `${tab} downloaded as Excel.`);
    } catch (e) { toast(e.message || 'Could not create the Excel file.', 'error'); } finally { setExporting(false); }
  }

  function exportCSV() {
    setMenu(false);
    const s = sheetFor(tab);
    if (!s) return;
    const body = s.lines
      ? [['', ...s.valueColumns.map(v => v.header)], ...s.lines.map(l => [l.label, ...s.valueColumns.map(v => l[v.key] === null ? 'Not recorded' : l[v.key] ?? '')])]
      : [s.columns.map(col => col.header), ...s.rows.map(r => s.columns.map(col => r[col.key] ?? ''))];
    downloadCSV(`ipos-${tab.toLowerCase().replaceAll(' ', '-').replace(/[^a-z-]/g, '')}-${range.from}-${range.to}.csv`, [['Store', store], ['Currency', c], ['From', range.from], ['To', range.to], [], ...body]);
  }

  const view = viewFor(tab);
  const apply = (f, t) => { try { dateBounds(f, t); setFrom(f); setTo(t); setRange({ from: f, to: t }); setError(''); } catch (e) { setError(e.message); } };
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">STORE OPERATIONS</span><h1>Reports & Analytics</h1><p>Statements, sales, stock and supplier balances — download any of them as Excel.</p></div>
        <div className="heading-actions">
          <button className="secondary" disabled={!data || loading} onClick={() => setFinancialEditing(true)}>Costs & opening balances</button>
          <button className="secondary" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={17} />Refresh</button>
          <div className="menu-wrap" ref={menuRef}>
            <button className="primary" disabled={!model || loading || exporting} aria-expanded={menu} onClick={() => setMenu(o => !o)}><FileSpreadsheet size={17} />{exporting ? 'Preparing…' : 'Download'}<ChevronDown size={15} /></button>
            {menu && (
              <div className="menu" role="menu">
                <button role="menuitem" onClick={() => exportExcel(false)}><FileSpreadsheet size={16} /><span><strong>Excel — this report</strong><small>{tab}</small></span></button>
                <button role="menuitem" onClick={() => exportExcel(true)}><FileSpreadsheet size={16} /><span><strong>Excel — all reports</strong><small>One workbook, a sheet per report</small></span></button>
                <button role="menuitem" onClick={exportCSV}><FileText size={16} /><span><strong>CSV — this report</strong><small>Plain text for other programs</small></span></button>
              </div>
            )}
          </div>
        </div>
      </div>
      {error && <div className="notice" role="alert"><AlertCircle size={18} />{error}</div>}
      {loading ? <Skeleton kind="dashboard" label="Loading reports…" /> : model && <>
        <div className="stat-grid">{[["Today's Sales", model.today, 'Today · Zambia time'], ['Annual Sales', model.annual, 'Year to date'], ['Inventory Valuation', model.inventory, 'Current stock × selling price'], ['Outstanding Supplier Payments', model.debt, 'Received orders · unpaid']].map(([label, value, note]) => <div className="stat-card" key={label}><div>{label}<BarChart3 size={18} /></div><strong>{fmt(value)}</strong><small>{note}</small></div>)}</div>
        <div className="operation-tabs analytics-tabs" role="tablist" aria-label="Report sections">{tabs.map(t => <button role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>{t}</button>)}</div>
        <div className="report-controls">
          <div className="preset-row">{presets(today()).map(([label, f, t]) => <button key={label} type="button" className={range.from === f && range.to === t ? 'active' : ''} onClick={() => apply(f, t)}>{label}</button>)}</div>
          <form className="date-filter" onSubmit={e => { e.preventDefault(); apply(from, to); }}>
            <label>From<input type="date" required value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label>To<input type="date" required min={from} value={to} onChange={e => setTo(e.target.value)} /></label>
            <button className="secondary">Apply dates</button>
            {(tab === tabs[2] || tab === tabs[5]) && <label>Compare with<select value={mode} onChange={e => setMode(e.target.value)}><option value="previous">Previous period</option><option value="lastYear">Same period last year</option><option value="none">No comparison</option></select></label>}
          </form>
        </div>

        {tab === tabs[0] && <><div className="section-head"><div><h2>Historic Sales Performance</h2><p className="muted">Revenue cycles ({c})</p></div></div><div className="revenue-cycles">{[['YTD Annual', model.annual], ['Last 30 Days', model.last30], ['Last 7 Days', model.last7], ["Today's Sales", model.today]].map(([l, v]) => <div key={l}><strong>{fmt(v)}</strong><span>{l}</span><div className="sales-bar" style={{ width: Math.max(0, v / Math.max(model.annual, model.last30, 1) * 100) + '%' }} /></div>)}</div><p className="muted report-caption">Revenue cards are net of refunds by payout date; receipt rows keep original totals.</p></>}
        {tab === tabs[6] && <div className="section-head"><div><h2>Stock level & restock guide</h2><p className="muted">What to buy, based on the last 30 days</p></div></div>}

        {tab === tabs[2] ? (
          <section className="management-panel financial-statement">
            <div className="statement-title"><h2>Profit & Loss statement</h2><span className="badge green">{plLabels.current}</span></div>
            <StatementTable rows={pl} fmt={fmt} current="This period" previous={prev?.label} />
            <p className="muted">{plLabels.current}{prev ? ` compared with ${plLabels.previous.toLowerCase()}` : ''}. Amounts exclude tax. Cost of goods sold uses the cost recorded when each item was sold. Supplier payments, refunds, owner money and loans are not counted as expenses or income.</p>
            {plNow.missingSaleCosts > 0 && <div className="notice">{plNow.missingSaleCosts} sold item(s) have no cost yet, so profit can't be worked out. Add them in <button className="link-button" onClick={() => setFinancialEditing(true)}>Costs & opening balances</button>.</div>}
          </section>
        ) : tab === tabs[5] ? (
          <section className="management-panel financial-statement">
            <div className="statement-title"><h2>Balance sheet</h2><span className="badge amber">{bsLabels.current}</span></div>
            {!bs ? <Skeleton kind="list" rows={6} label="Working out balances…" /> : <>
              <StatementTable rows={bs} fmt={fmt} current={bsLabels.current} previous={bsLabels.previous} />
              {bsNow.equity !== null
                ? <div className="success-note">Check: total assets ({fmt(bsNow.totalAssets)}) = liabilities ({fmt(bsNow.totalLiabilities)}) + owner's equity ({fmt(bsNow.equity)}).</div>
                : <div className="integration-note">{bsNow.needsOpening ? <>Set your opening cash and its date in <button className="link-button" onClick={() => setFinancialEditing(true)}>Costs & opening balances</button> to complete the balance sheet{bsNow.openingDate ? ` (dates before ${nice(bsNow.openingDate)} can't be shown)` : ''}.</> : <>{bsNow.missingCosts} product(s) in stock have no unit cost. Add them in <button className="link-button" onClick={() => setFinancialEditing(true)}>Costs & opening balances</button>.</>}</div>}
              <p className="muted">Stock is valued at current unit costs. Earlier dates are rebuilt by undoing later sales, deliveries, adjustments and customer payments. Other assets and liabilities are the amounts you entered.</p>
            </>}
          </section>
        ) : view && <DataTable view={view} fmt={fmt} />}

        {tab === tabs[0] && <><div className="report-detail-grid report-bottom"><Facts title="Original sale totals" rows={[['Transactions', model.selected.length], ['Products sold', sum(model.selected, 'item_count')], ['Subtotal', fmt(sum(model.selected, 'subtotal'))], ['Discounts', fmt(sum(model.selected, 'discount'))], ['Tax', fmt(sum(model.selected, 'tax'))], ['Total', fmt(sum(model.selected, 'total'))]]} /><Facts title="Payment methods (sale receipts)" rows={Object.entries(cashbookLedger(model.selected, data.payments, []).reduce((a, e) => ({ ...a, [e.payment_method]: (a[e.payment_method] || 0) + e.amount }), {})).map(([k, v]) => [k, fmt(v)])} /></div>
          <div className="report-detail-grid report-bottom"><section><div className="section-head"><h2>Daily sales</h2></div><DataTable fmt={fmt} view={{ columns: [{ header: 'Date', key: 'd', type: 'text' }, { header: 'Sales', key: 'total', type: 'money' }, { header: 'Transactions', key: 'count', type: 'number' }], rows: Object.entries(model.selected.reduce((a, s) => { const d = localDay(s.created_at); a[d] ||= { total: 0, count: 0 }; a[d].total += Number(s.total); a[d].count++; return a; }, {})).sort(([a], [b]) => b.localeCompare(a)).map(([d, v]) => ({ d, ...v })), totals: { d: 'Total', total: 'sum', count: 'sum' } }} /></section>
            <section><div className="section-head"><h2>Top-selling products</h2></div><DataTable fmt={fmt} view={{ columns: [{ header: 'Product', key: 'name', type: 'text' }, { header: 'Units', key: 'units', type: 'number' }, { header: 'Before tax / discount', key: 'revenue', type: 'money' }], rows: Object.values(data.sale_items.filter(i => model.selected.some(s => s.id === i.sale_id)).reduce((a, i) => { a[i.product_id] ||= { name: i.product_name, units: 0, revenue: 0 }; a[i.product_id].units += Number(i.quantity); a[i.product_id].revenue += Number(i.quantity) * Number(i.unit_price); return a; }, {})).sort((a, b) => b.units - a.units).slice(0, 10) }} /></section></div></>}
        {tab === tabs[4] && <p className="muted report-caption">Only received, unpaid purchase orders are owed here. <Link to="/suppliers">Record payment in Suppliers & Purchases.</Link></p>}
        {tab === tabs[6] && <p className="muted report-caption">Normal max is the larger of last month's sales and the reorder level plus one. Check supplier delivery times before ordering.</p>}
      </>}
      {financialEditing && data && <FinancialSetup data={data} cid={m.company_id} currency={c} onClose={() => setFinancialEditing(false)} onSaved={() => setRevision(n => n + 1)} />}
    </>
  );
}
