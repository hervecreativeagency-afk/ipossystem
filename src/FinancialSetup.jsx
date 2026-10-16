import { toast } from './Toast';
import React, { useMemo, useRef, useState } from 'react';
import { X, Search, ClipboardPaste, Wand2 } from 'lucide-react';
import { rpc, today } from './operations';
import { parsePastedNumbers } from './grid-utils';

const money = (n, c) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c }).format(Number(n || 0));

/**
 * Spreadsheet-style grid of number cells. Enter / ↓ moves down, ↑ moves up.
 * Pasting several lines (e.g. a column copied from Excel) fills this cell and the ones below it.
 */
function CostGrid({ rows, columns, values, onChange, currency, label }) {
  const refs = useRef([]);
  const move = (i, d) => { const el = refs.current[i + d]; if (el) { el.focus(); el.select(); } };
  function paste(e, i) {
    const nums = parsePastedNumbers(e.clipboardData.getData('text'));
    if (nums.length <= 1) return;
    e.preventDefault();
    const next = { ...values };
    nums.forEach((v, k) => { const r = rows[i + k]; if (r && v !== undefined) next[r.id] = v; });
    onChange(next);
    toast(`Pasted ${Math.min(nums.length, rows.length - i)} values.`, 'info');
  }
  return (
    <div className="grid-scroll" role="region" aria-label={label} tabIndex={-1}>
      <table className="grid-table">
        <thead><tr>{columns.map(c => <th key={c.key} className={c.num ? 'num' : ''}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={values[r.id] === '' || values[r.id] == null ? 'blank' : ''}>
              {columns.map(c => c.input ? (
                <td key={c.key} className="cell-input">
                  <input ref={el => { refs.current[i] = el; }} inputMode="decimal" aria-label={`${c.header} for ${r.label}`} placeholder="—"
                    value={values[r.id] ?? ''} onChange={e => onChange({ ...values, [r.id]: e.target.value.replace(/[^\d.]/g, '') })}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); } if (e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); } }}
                    onPaste={e => paste(e, i)} />
                </td>
              ) : <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r, values[r.id], currency) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted pad">Nothing to show.</p>}
    </div>
  );
}

export default function FinancialSetup({ data, cid, currency, onClose, onSaved }) {
  const costs = Object.fromEntries(data.financial_product_costs.map(c => [c.product_id, String(c.unit_cost)]));
  const historical = Object.fromEntries(data.financial_sale_costs.map(c => [c.sale_item_id, String(c.unit_cost)]));
  const [products, setProducts] = useState(costs), [saleCosts, setSaleCosts] = useState(historical);
  const [balance, setBalance] = useState(() => { const b = data.financial_balances[0]; return b ? { opening_date: b.opening_date, opening_cash: String(b.opening_cash), other_assets: String(b.other_assets), other_liabilities: String(b.other_liabilities) } : { opening_date: today().slice(0, 4) + '-01-01', opening_cash: '', other_assets: '0', other_liabilities: '0' }; });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [tab, setTab] = useState('products'), [q, setQ] = useState(''), [onlyBlank, setOnlyBlank] = useState(false);
  const salesById = useMemo(() => Object.fromEntries(data.sales.map(s => [s.id, s])), [data.sales]);
  const match = s => !q || s.toLowerCase().includes(q.toLowerCase());

  const productRows = data.products.map(p => ({ id: p.id, label: p.name, name: p.name, sku: p.sku, stock: Number(p.stock_quantity), price: Number(p.selling_price) }))
    .filter(r => match(`${r.name} ${r.sku}`) && (!onlyBlank || !products[r.id])).sort((a, b) => a.name.localeCompare(b.name));
  const saleRows = data.sale_items.map(i => ({ id: i.id, label: `${i.product_name} on ${salesById[i.sale_id]?.receipt_number || 'sale'}`, receipt: salesById[i.sale_id]?.receipt_number || '—', date: salesById[i.sale_id]?.created_at, name: i.product_name, qty: Number(i.quantity), price: Number(i.unit_price), product_id: i.product_id }))
    .filter(r => match(`${r.name} ${r.receipt}`) && (!onlyBlank || !saleCosts[r.id])).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const blankProducts = data.products.filter(p => Number(p.stock_quantity) > 0 && !products[p.id]).length;
  const blankSales = data.sale_items.filter(i => !saleCosts[i.id]).length;
  const stockValue = data.products.reduce((n, p) => n + (products[p.id] ? Number(products[p.id]) * Math.max(0, Number(p.stock_quantity)) : 0), 0);

  function fillSalesFromCurrent() {
    let n = 0; const next = { ...saleCosts };
    for (const i of data.sale_items) if (!next[i.id] && products[i.product_id]) { next[i.id] = products[i.product_id]; n++; }
    setSaleCosts(next);
    toast(n ? `Filled ${n} past sale cost${n === 1 ? '' : 's'} from current product costs. Check them, then save.` : 'No blanks could be filled — add product costs first.', n ? 'success' : 'info');
  }

  async function save(e) {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      const convert = obj => Object.entries(obj).filter(([, v]) => v !== '' && v != null).map(([id, v]) => ({ id, unit_cost: Math.round(Number(v) * 100) / 100 }));
      const includeBalance = balance.opening_cash !== '';
      if (includeBalance && (balance.other_assets === '' || balance.other_liabilities === '')) throw Error('Enter other assets and liabilities, including zero if none.');
      await rpc('save_financial_data', { p_company_id: cid, p_products: convert(products), p_sale_items: convert(saleCosts), p_balance: includeBalance ? { opening_date: balance.opening_date, opening_cash: Number(balance.opening_cash), other_assets: Number(balance.other_assets), other_liabilities: Number(balance.other_liabilities) } : null });
      toast('Costs and opening balances saved.'); onSaved(); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const margin = (r, v) => { if (!v || !r.price) return '—'; const m = (r.price - Number(v)) / r.price; return <span className={m < 0 ? 'neg' : ''}>{(m * 100).toFixed(0)}%</span>; };
  return (
    <div className="modal-backdrop">
      <div className="modal operation-modal grid-modal" role="dialog" aria-label="Costs and opening balances">
        <div className="modal-head"><h2>Costs & opening balances</h2><button disabled={busy} aria-label="Close" onClick={onClose}><X /></button></div>
        <p className="muted">Owner only. Enter what you paid, not selling prices. Type like a spreadsheet: <b>Enter</b> or <b>↓</b> moves down, and you can <b>paste a column of numbers from Excel</b> into the first cell.</p>
        {error && <div className="notice" role="alert">{error}</div>}
        <div className="operation-tabs" role="tablist">
          {[['products', `Product costs${blankProducts ? ` · ${blankProducts} missing` : ''}`], ['sales', `Past sales${blankSales ? ` · ${blankSales} missing` : ''}`], ['opening', 'Opening balances']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            {tab !== 'opening' && (
              <div className="grid-tools">
                <div className="search-box"><Search size={16} /><input placeholder={tab === 'products' ? 'Search product or SKU…' : 'Search product or receipt…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" /></div>
                <label className="check"><input type="checkbox" checked={onlyBlank} onChange={e => setOnlyBlank(e.target.checked)} /> Only missing</label>
                {tab === 'sales' && <button type="button" className="secondary" onClick={fillSalesFromCurrent}><Wand2 size={15} /> Fill blanks from product costs</button>}
                <span className="muted grid-hint"><ClipboardPaste size={14} /> Paste works</span>
              </div>
            )}
            {tab === 'products' && <>
              <CostGrid label="Product costs" currency={currency} rows={productRows} values={products} onChange={setProducts} columns={[
                { key: 'name', header: 'Product' }, { key: 'sku', header: 'SKU' }, { key: 'stock', header: 'In stock', num: true },
                { key: 'price', header: 'Selling price', num: true, render: r => money(r.price, currency) },
                { key: 'cost', header: `Unit cost (${currency})`, input: true },
                { key: 'margin', header: 'Margin', num: true, render: (r, v) => margin(r, v) },
                { key: 'value', header: 'Stock value', num: true, render: (r, v) => v ? money(Number(v) * Math.max(0, r.stock), currency) : '—' },
              ]} />
              <p className="grid-foot"><span>Stock value at cost: <strong>{money(stockValue, currency)}</strong></span>{blankProducts > 0 && <span className="neg">{blankProducts} product(s) in stock still need a cost</span>}</p>
            </>}
            {tab === 'sales' && <>
              <CostGrid label="Past sale costs" currency={currency} rows={saleRows.slice(0, 500)} values={saleCosts} onChange={setSaleCosts} columns={[
                { key: 'receipt', header: 'Receipt' }, { key: 'date', header: 'Date', render: r => r.date ? new Date(r.date).toLocaleDateString('en-GB', { timeZone: 'Africa/Lusaka' }) : '—' },
                { key: 'name', header: 'Product' }, { key: 'qty', header: 'Qty', num: true }, { key: 'price', header: 'Sold at', num: true, render: r => money(r.price, currency) },
                { key: 'cost', header: `Unit cost (${currency})`, input: true },
                { key: 'margin', header: 'Margin', num: true, render: (r, v) => margin(r, v) },
              ]} />
              <p className="grid-foot"><span>Changing a product's cost doesn't change past sales — they keep the cost they were sold at.{saleRows.length > 500 ? ` Showing the newest 500 of ${saleRows.length}; search to find others.` : ''}</span></p>
            </>}
            {tab === 'opening' && <>
              <p className="muted">Opening cash is what you had in cash, mobile money and bank at the start of the opening date. Other assets and liabilities are current amounts not tracked elsewhere (e.g. equipment, loans, tax owed). Leave cash blank to keep the balance sheet unconfigured.</p>
              <div className="company-form">
                {[['opening_date', 'Opening balance date', 'date'], ['opening_cash', `Opening cash, mobile money & bank (${currency})`, 'number'], ['other_assets', `Other assets (${currency})`, 'number'], ['other_liabilities', `Other liabilities (${currency})`, 'number']].map(([key, label, type]) => (
                  <label key={key}>{label}<input type={type} step={type === 'number' ? '0.01' : undefined} min={['other_assets', 'other_liabilities'].includes(key) ? 0 : undefined} max={type === 'date' ? today() : undefined} value={balance[key]} onChange={e => setBalance({ ...balance, [key]: e.target.value })} /></label>
                ))}
              </div>
            </>}
            <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save all'}</button></div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
