import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { PackageX, RefreshCw, LoaderCircle, AlertCircle, ShoppingBag, MessageCircle, CheckCircle2, Truck } from 'lucide-react';
import * as api from './api';
import { list, rpc } from './operations';
import { toast } from './Toast';
import { buildReorderList, groupBySupplier, purchaseItems, poNumber, purchaseOrderText } from './reorder-utils';
import { normalizePhone, whatsappUrl } from './receipt-share';
import { ALL, branchName } from './branches';
import { ChooseBranch } from './BranchPages';

const money = (n, c) => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c || 'ZMW' }).format(Number(n || 0));
const msg = e => e?.message || 'Something went wrong. Please try again.';
const round1 = n => Math.round(n * 10) / 10;
const rate = perDay => perDay >= 1 ? `${round1(perDay)} a day` : `${round1(perDay * 7)} a week`;
const COVER = [[7, '1 week'], [14, '2 weeks'], [30, '1 month']];
const REASON = { out: ['Out of stock', 'red'], low: ['Low stock', 'amber'], soon: ['Running out soon', 'amber'] };

export function Reorder({ auth }) {
  if (!['director', 'supervisor'].includes(auth.membership.role)) return <Navigate to="/pos" replace />;
  if (auth.branchId === ALL) return <ChooseBranch auth={auth} title="Reorder list" text="Stock is counted per branch. Choose the branch to reorder for." />;
  return <ReorderContent key={auth.branchId || 'none'} auth={auth} />;
}

function ReorderContent({ auth }) {
  const m = auth.membership, currency = m.companies.currency;
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [cover, setCover] = useState(14);
  const [lines, setLines] = useState({});        // product_id -> { selected, quantity, unit_cost, supplier_id }
  const [busy, setBusy] = useState('');          // supplier id being ordered
  const [created, setCreated] = useState([]);    // purchase orders made on this visit
  const requests = useRef({});

  async function load() {
    setLoading(true); setError('');
    try {
      const [products, suppliers, orders, activity] = await Promise.all([
        api.loadProducts(m.company_id, m.role, auth.branchId),
        list('suppliers', m.company_id),
        list('purchase_orders', m.company_id),
        api.loadRecentActivity(m.company_id, auth.session.user.id, m.role, 30, auth.branchId),
      ]);
      // Orders still open for another branch don't count as "on order" here, but still tell us the usual supplier.
      const here = orders.map(o => o.branch_id && auth.branchId && o.branch_id !== auth.branchId && o.status === 'ordered' ? { ...o, status: 'elsewhere' } : o);
      setData({ products, suppliers: suppliers.filter(s => s.active), orders: here, saleItems: activity.items });
    } catch (e) { setError(msg(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [m.company_id]);

  const rows = useMemo(() => data ? buildReorderList({ products: data.products, saleItems: data.saleItems, orders: data.orders, coverDays: cover }) : [], [data, cover]);

  // Fresh suggestions whenever the list or cover period changes; keeps edits the user made to other fields.
  useEffect(() => {
    setLines(prev => Object.fromEntries(rows.map(r => {
      const p = prev[r.product_id];
      return [r.product_id, {
        selected: p ? p.selected && r.suggested > 0 : r.suggested > 0,
        quantity: String(r.suggested || ''),
        unit_cost: p?.unit_cost ?? (r.unit_cost == null ? '' : String(r.unit_cost)),
        supplier_id: p?.supplier_id ?? r.supplier_id,
      }];
    })));
  }, [rows]);

  const supplierById = useMemo(() => new Map((data?.suppliers || []).map(s => [s.id, s])), [data]);
  const chosen = rows.filter(r => lines[r.product_id]?.selected).map(r => ({ ...r, ...lines[r.product_id] }));
  const groups = groupBySupplier(chosen);
  const set = (id, patch) => setLines(l => ({ ...l, [id]: { ...l[id], ...patch } }));

  async function order(group) {
    if (busy) return;
    const supplier = supplierById.get(group.supplier_id);
    if (!supplier) { toast('Choose a supplier for these products first.', 'error'); return; }
    let items;
    try { items = purchaseItems(group.items); } catch (e) { toast(e.message, 'error'); return; }
    const key = group.supplier_id + ':' + items.map(i => i.product_id + 'x' + i.quantity + '@' + i.unit_cost).join(',');
    requests.current[key] ||= crypto.randomUUID();  // a retry after a dropped connection never makes two orders
    setBusy(group.supplier_id);
    try {
      const id = await rpc(auth.branchId ? 'create_purchase_at' : 'create_purchase', { p_company_id: m.company_id, ...(auth.branchId ? { p_branch_id: auth.branchId } : {}), p_supplier_id: supplier.id, p_items: items, p_notes: 'Created from the reorder list', p_request_id: requests.current[key] });
      delete requests.current[key];
      const lineCopy = group.items.map(l => ({ name: l.name, sku: l.sku, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) }));
      setCreated(c => [{ id, number: poNumber(id), supplier, lines: lineCopy, total: items.reduce((n, i) => n + i.quantity * i.unit_cost, 0), at: new Date() }, ...c]);
      toast(`Purchase order ${poNumber(id).slice(0, 11)}… created for ${supplier.name}.`);
      await load();
    } catch (e) { toast(msg(e), 'error'); }
    finally { setBusy(''); }
  }

  function sendToSupplier(po) {
    const digits = normalizePhone(po.supplier.phone);
    if (!digits) { toast(`Add a phone number for ${po.supplier.name} in Suppliers first.`, 'error'); return; }
    const text = purchaseOrderText({ number: po.number, company: m.companies, supplier: po.supplier, lines: po.lines, money, currency, date: po.at });
    window.open(whatsappUrl(digits, text), '_blank', 'noopener');
  }

  const counts = { out: rows.filter(r => r.reason === 'out').length, low: rows.filter(r => r.reason === 'low').length, soon: rows.filter(r => r.reason === 'soon').length };
  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">STORE WORKSPACE</span><h1>Reorder list</h1><p>{auth.multiBranch ? `For ${branchName(auth.branches, auth.branchId)}. ` : ''}What to restock, how much, and from whom. One tap makes the purchase order.</p></div>
        <div className="heading-actions">
          <label className="reorder-cover">Order enough for
            <select value={cover} onChange={e => setCover(Number(e.target.value))}>{COVER.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select>
          </label>
          <button className="icon-button" aria-label="Refresh" onClick={load}><RefreshCw size={18} /></button>
        </div>
      </div>
      {error && <div className="notice" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}

      {created.map(po => (
        <div key={po.id} className="reorder-created" role="status">
          <CheckCircle2 size={20} />
          <div><strong>{po.number}</strong><small>{po.supplier.name} · {po.lines.length} {po.lines.length === 1 ? 'product' : 'products'} · {money(po.total, currency)}</small></div>
          <div className="reorder-created-actions">
            <button className="share-wa" onClick={() => sendToSupplier(po)} disabled={!po.supplier.phone} title={po.supplier.phone ? 'Opens WhatsApp with the order' : 'Supplier has no phone number'}><MessageCircle size={16} /> Send to supplier</button>
            <Link className="secondary" to="/suppliers?tab=purchases">Receive later</Link>
          </div>
        </div>
      ))}

      {loading && !data ? <div className="insights-loading"><LoaderCircle size={18} className="spin" /> Checking your stock and recent sales…</div> : !rows.length ? (
        <div className="empty"><CheckCircle2 size={33} /><h3>Nothing to reorder</h3><p>Every product is above its low-stock level and has more than a week of stock at current sales.</p></div>
      ) : (
        <>
          <div className="stat-grid customer-stats">
            <div className="stat-card warn"><div>Out of stock<PackageX size={19} /></div><strong>{counts.out}</strong><small>Customers can’t buy these now</small></div>
            <div className="stat-card"><div>Low stock<AlertCircle size={19} /></div><strong>{counts.low}</strong><small>At or below their low-stock level</small></div>
            <div className="stat-card"><div>Running out soon<Truck size={19} /></div><strong>{counts.soon}</strong><small>Less than a week left at current sales</small></div>
          </div>

          <div className="table-panel">
            <div className="table-scroll">
              <table className="reorder-table">
                <thead><tr><th><span className="sr-only">Order</span></th><th>Product</th><th>In stock</th><th>Sells</th><th>Order qty</th><th>Unit cost</th><th>Supplier</th></tr></thead>
                <tbody>
                  {rows.map(r => {
                    const l = lines[r.product_id] || {};
                    const [label, tone] = REASON[r.reason];
                    return (
                      <tr key={r.product_id} className={l.selected ? '' : 'is-off'}>
                        <td><input type="checkbox" aria-label={'Order ' + r.name} checked={Boolean(l.selected)} onChange={e => set(r.product_id, { selected: e.target.checked })} /></td>
                        <td><strong>{r.name}</strong><small>{r.sku}</small><span className={'badge ' + tone}>{label}</span></td>
                        <td><strong>{r.stock}</strong><small>Low at {r.threshold}{r.onOrder ? ` · ${r.onOrder} on order` : ''}</small></td>
                        <td>{r.perDay ? <><strong>{rate(r.perDay)}</strong><small>{r.daysLeft < 1 ? 'Less than a day left' : `About ${Math.floor(r.daysLeft)} ${Math.floor(r.daysLeft) === 1 ? 'day' : 'days'} left`}</small></> : <small>No sales in 30 days</small>}</td>
                        <td data-label="Order qty"><input className="reorder-qty" type="number" min="1" step="1" inputMode="numeric" aria-label={'Quantity of ' + r.name} value={l.quantity ?? ''} onChange={e => set(r.product_id, { quantity: e.target.value, selected: true })} /></td>
                        <td data-label="Unit cost"><input className="reorder-cost" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" aria-label={'Unit cost of ' + r.name} value={l.unit_cost ?? ''} onChange={e => set(r.product_id, { unit_cost: e.target.value })} /></td>
                        <td data-label="Supplier">
                          <select aria-label={'Supplier for ' + r.name} value={l.supplier_id || ''} onChange={e => set(r.product_id, { supplier_id: e.target.value })}>
                            <option value="">Choose supplier…</option>
                            {data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {!data.suppliers.length && <div className="integration-note">Add your suppliers first in <Link to="/suppliers">Suppliers &amp; Purchases</Link>, then come back to order.</div>}

          <div className="reorder-groups">
            {groups.map(g => {
              const s = supplierById.get(g.supplier_id);
              const total = g.items.reduce((n, l) => n + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
              return (
                <section key={g.supplier_id || 'none'} className={'reorder-group' + (s ? '' : ' is-missing')}>
                  <div>
                    <strong>{s ? s.name : 'No supplier chosen'}</strong>
                    <small>{g.items.length} {g.items.length === 1 ? 'product' : 'products'}{s ? ' · ' + money(total, currency) : ' · choose a supplier in the list above'}</small>
                  </div>
                  <button className="primary" disabled={!s || Boolean(busy)} onClick={() => order(g)}>
                    {busy && busy === g.supplier_id ? <><LoaderCircle size={17} className="spin" /> Creating…</> : <><ShoppingBag size={17} /> Create purchase order</>}
                  </button>
                </section>
              );
            })}
          </div>
          <p className="muted">Quantities cover {COVER.find(c => c[0] === cover)[1]} of sales (last 30 days) plus each product’s low-stock level, minus stock already on order. Receive deliveries in <Link to="/suppliers?tab=purchases">Suppliers &amp; Purchases</Link> to update stock.</p>
        </>
      )}
    </>
  );
}
