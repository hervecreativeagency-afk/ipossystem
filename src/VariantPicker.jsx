import { t as tr } from './i18n';
import React, { useEffect } from 'react';
import { X, Plus } from 'lucide-react';

// Checkout: choose which size/colour of a product to add. Stays open so several can be added.
export default function VariantPicker({ group, cart, money, currency, expired, onAdd, onClose }) {
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const inCart = id => cart.find(i => i.id === id)?.quantity || 0;
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal variant-picker" role="dialog" aria-label={'Choose ' + group.name}>
        <div className="modal-head"><h2>{group.name}</h2><button aria-label="Close" onClick={onClose}><X /></button></div>
        <ul>
          {group.variants.map(v => {
            const n = inCart(v.id), left = Number(v.stock_quantity) - n;
            return (
              <li key={v.id}>
                <button disabled={left <= 0} onClick={() => onAdd(v)}>
                  <span><strong>{v.variant_label || v.name}</strong><small>{v.sku}{expired.has(v.id) ? ' · ' + tr('has expired stock') : ''}</small></span>
                  <span className="variant-price">{money(v.selling_price, currency)}<small>{left <= 0 ? tr(n ? 'all in cart' : 'out of stock') : tr('{n} left', { n: left })}</small></span>
                  {n > 0 ? <span className="variant-count">{n}</span> : <span className="add-circle"><Plus size={16} /></span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="modal-actions"><button className="primary" onClick={onClose}>{tr('Done')}</button></div>
      </div>
    </div>
  );
}
