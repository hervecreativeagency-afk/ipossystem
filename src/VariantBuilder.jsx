import React, { useMemo, useState } from 'react';
import { X, LoaderCircle, AlertCircle, Layers } from 'lucide-react';
import * as api from './api';
import { supabase } from './supabase';
import { toast } from './Toast';
import { ALL, branchName } from './branches';
import { splitValues, combinations, variantName, variantSku } from './variant-utils';

const msg = e => e?.message || 'Something went wrong. Please try again.';
const commonPrefix = list => list.length ? list.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); }) : '';
const linkVariant = async (cid, productId, groupId, base, label) => {
  const { error } = await supabase.rpc('link_variant', { p_company_id: cid, p_product_id: productId, p_group_id: groupId, p_base: base, p_label: label });
  if (error) throw error;
};

/**
 * Add a product that comes in sizes/colours, or add variants to an existing product.
 * product: null (new), or an existing product (adds to its group, or turns it into variants).
 */
export default function VariantBuilder({ auth, product, products, onClose, onSaved }) {
  const m = auth.membership, cid = m.company_id;
  const existingGroup = product?.variant_group_id ? products.filter(p => p.variant_group_id === product.variant_group_id) : [];
  const [base, setBase] = useState(product ? (product.variant_base || product.name) : '');
  const [baseSku, setBaseSku] = useState(() => !product ? '' : !product.variant_group_id ? String(product.sku || '') : commonPrefix(existingGroup.map(p => String(p.sku || ''))).replace(/-+$/, ''));
  const [firstLabel, setFirstLabel] = useState('');               // when turning a single product into variants
  const [opt1, setOpt1] = useState({ name: 'Colour', values: '' });
  const [opt2, setOpt2] = useState({ name: 'Size', values: '' });
  const [shared, setShared] = useState({
    selling_price: product ? String(product.selling_price ?? '') : '', unit_cost: product ? String(product.unit_cost ?? '') : '',
    tax_rate: product ? String(product.tax_rate ?? 0) : '0', low_stock_threshold: product ? String(product.low_stock_threshold ?? 5) : '5', expiry_date: '',
  });
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const target = auth.branchId === ALL ? auth.branches.find(b => b.is_main)?.id : auth.branchId;
  const taken = new Set([...existingGroup.map(p => p.variant_label), firstLabel.trim()].filter(Boolean).map(s => s.toLowerCase()));

  const labels = useMemo(() => combinations([splitValues(opt1.values), splitValues(opt2.values)]).filter(l => !taken.has(l.toLowerCase())), [opt1.values, opt2.values, firstLabel, existingGroup.length]);
  const rows = labels.map(label => ({
    label, sku: variantSku(baseSku, label), barcode: '', selling_price: shared.selling_price, stock_quantity: '0', ...(edits[label] || {}),
  }));
  const setRow = (label, patch) => setEdits(e => ({ ...e, [label]: { ...(e[label] || {}), ...patch } }));

  async function save(e) {
    e.preventDefault(); setError('');
    const name = base.trim();
    if (!name) { setError('Enter the product name, e.g. "Polo shirt".'); return; }
    if (product && !product.variant_group_id && !firstLabel.trim()) { setError(`Say which variant "${product.name}" is, e.g. "White / M".`); return; }
    if (!rows.length) { setError('Enter at least one option value, e.g. "Red, Blue".'); return; }
    const skus = new Set(products.map(p => String(p.sku).toLowerCase()));
    for (const r of rows) {
      if (!r.sku.trim()) { setError(`Enter a SKU for ${r.label}.`); return; }
      if (skus.has(r.sku.toLowerCase())) { setError(`SKU ${r.sku} is already used. Change it for ${r.label}.`); return; }
      skus.add(r.sku.toLowerCase());
      if (!(Number(r.selling_price) >= 0) || r.selling_price === '') { setError(`Enter a price for ${r.label}.`); return; }
      if (!Number.isInteger(Number(r.stock_quantity)) || Number(r.stock_quantity) < 0) { setError(`Starting stock for ${r.label} must be a whole number.`); return; }
    }
    setBusy(true);
    const saved = [];
    try {
      const group = product?.variant_group_id || crypto.randomUUID();
      if (product && !product.variant_group_id) {
        const label = firstLabel.trim();
        await api.saveProduct(cid, { ...Object.fromEntries(['id', 'sku', 'barcode', 'selling_price', 'stock_quantity', 'tax_rate', 'low_stock_threshold', 'image_url', 'unit_cost'].map(k => [k, product[k] ?? ''])), name: variantName(name, label), stock_reason: '' }, auth.branchId === ALL ? null : auth.branchId);
        await linkVariant(cid, product.id, group, name, label);
      }
      for (const r of rows) {
        const id = await api.saveProduct(cid, {
          name: variantName(name, r.label), sku: r.sku.trim(), barcode: r.barcode.trim(), selling_price: Number(r.selling_price),
          stock_quantity: Number(r.stock_quantity), tax_rate: Number(shared.tax_rate), low_stock_threshold: Number(shared.low_stock_threshold),
          image_url: product?.image_url || '', unit_cost: shared.unit_cost, stock_reason: 'Starting stock', expiry_date: Number(r.stock_quantity) > 0 ? shared.expiry_date : '',
        }, target);
        await linkVariant(cid, id, group, name, r.label);
        saved.push(r.label);
      }
      toast(`${saved.length} ${saved.length === 1 ? 'variant' : 'variants'} of ${name} saved.`);
      onSaved();
    } catch (err) {
      setError((saved.length ? `Saved ${saved.join(', ')}. ` : '') + msg(err));
      if (saved.length) onSaved(true);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal variant-modal" onSubmit={save} aria-label="Product variants">
        <div className="modal-head"><h2><Layers size={20} /> {product ? (product.variant_group_id ? `Add variants to ${base}` : 'Add sizes or colours') : 'New product with variants'}</h2><button type="button" aria-label="Close" onClick={onClose}><X /></button></div>
        {error && <div className="notice" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
        <div className="variant-grid">
          <label>Product name<input required maxLength={120} value={base} disabled={Boolean(product?.variant_group_id)} placeholder="e.g. Polo shirt" onChange={e => setBase(e.target.value)} /></label>
          <label>Base SKU<input maxLength={40} value={baseSku} placeholder="e.g. POLO" onChange={e => setBaseSku(e.target.value)} /></label>
          {product && !product.variant_group_id && (
            <label className="span-2">“{product.name}” is the variant…<input required maxLength={100} value={firstLabel} placeholder="e.g. White / M" onChange={e => setFirstLabel(e.target.value)} /></label>
          )}
          {existingGroup.length > 0 && <p className="span-2 muted">Already has: {existingGroup.map(p => p.variant_label).join(', ')}</p>}
          <label>Option 1<input maxLength={30} value={opt1.name} onChange={e => setOpt1({ ...opt1, name: e.target.value })} /></label>
          <label>{opt1.name || 'Option 1'} values<input value={opt1.values} placeholder="Red, Blue, Black" onChange={e => setOpt1({ ...opt1, values: e.target.value })} /></label>
          <label>Option 2 (optional)<input maxLength={30} value={opt2.name} onChange={e => setOpt2({ ...opt2, name: e.target.value })} /></label>
          <label>{opt2.name || 'Option 2'} values<input value={opt2.values} placeholder="S, M, L, XL" onChange={e => setOpt2({ ...opt2, values: e.target.value })} /></label>
          <label>Price (each)<input type="number" min="0" step="any" required value={shared.selling_price} onChange={e => setShared({ ...shared, selling_price: e.target.value })} /></label>
          <label>Purchase cost (optional)<input type="number" min="0" step="any" value={shared.unit_cost} onChange={e => setShared({ ...shared, unit_cost: e.target.value })} /></label>
          <label>Tax (%)<input type="number" min="0" max="100" step="any" value={shared.tax_rate} onChange={e => setShared({ ...shared, tax_rate: e.target.value })} /></label>
          <label>Low-stock level<input type="number" min="0" step="1" value={shared.low_stock_threshold} onChange={e => setShared({ ...shared, low_stock_threshold: e.target.value })} /></label>
          <label className="span-2">Expiry date of the starting stock (optional)<input type="date" value={shared.expiry_date} onChange={e => setShared({ ...shared, expiry_date: e.target.value })} /></label>
        </div>
        {rows.length > 0 ? (
          <div className="table-scroll">
            <table className="variant-table">
              <thead><tr><th>Variant</th><th>SKU</th><th>Barcode</th><th>Price</th><th>Starting stock</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label}>
                    <td><strong>{r.label}</strong></td>
                    <td><input value={r.sku} maxLength={60} aria-label={'SKU for ' + r.label} onChange={e => setRow(r.label, { sku: e.target.value })} /></td>
                    <td><input value={r.barcode} maxLength={60} aria-label={'Barcode for ' + r.label} placeholder="optional" onChange={e => setRow(r.label, { barcode: e.target.value })} /></td>
                    <td><input type="number" min="0" step="any" value={r.selling_price} aria-label={'Price for ' + r.label} onChange={e => setRow(r.label, { selling_price: e.target.value })} /></td>
                    <td><input type="number" min="0" step="1" value={r.stock_quantity} aria-label={'Starting stock for ' + r.label} onChange={e => setRow(r.label, { stock_quantity: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Type the option values above (separated by commas) to list the variants.</p>}
        {auth.multiBranch && <p className="muted">Starting stock goes to {branchName(auth.branches, target)}.</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy || !rows.length}>{busy ? <><LoaderCircle size={16} className="spin" /> Saving…</> : `Save ${rows.length || ''} ${rows.length === 1 ? 'variant' : 'variants'}`}</button>
        </div>
      </form>
    </div>
  );
}
