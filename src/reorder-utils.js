// Works out what to reorder (pure, unit tested).
//
// A product needs reordering when it is at/below its low-stock level, or will
// run out within `soonDays` at its recent sales speed. The suggested quantity
// covers `coverDays` of sales plus the low-stock level, minus stock already
// held and already on order (open purchase orders), so nothing is ordered twice.
// Supplier and unit cost come from the product's most recent purchase.

export function buildReorderList({ products = [], saleItems = [], salesDays = 30, orders = [], coverDays = 14, soonDays = 7 }) {
  const sold = new Map(), onOrder = new Map(), last = new Map();
  for (const i of saleItems) sold.set(i.product_id, (sold.get(i.product_id) || 0) + Number(i.quantity || 0));
  const sortedOrders = [...orders].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const o of sortedOrders) {
    if (o.status === 'cancelled') continue;
    for (const it of o.items || []) {
      if (o.status === 'ordered') onOrder.set(it.product_id, (onOrder.get(it.product_id) || 0) + Number(it.quantity || 0));
      if (!last.has(it.product_id)) last.set(it.product_id, { supplier_id: o.supplier_id, unit_cost: Number(it.unit_price), date: o.created_at });
    }
  }
  const rows = [];
  for (const p of products) {
    if (p.active === false) continue;
    const stock = Math.max(0, Number(p.stock_quantity || 0));
    const threshold = Math.max(0, Number(p.low_stock_threshold || 0));
    const perDay = (sold.get(p.id) || 0) / salesDays;
    const daysLeft = perDay > 0 ? stock / perDay : null;
    const low = stock <= threshold;
    const soon = daysLeft != null && daysLeft <= soonDays;
    if (!low && !soon) continue;
    const pending = onOrder.get(p.id) || 0;
    const target = Math.max(threshold * 2, Math.ceil(perDay * coverDays) + threshold, 1);
    const suggested = Math.max(0, Math.ceil(target - stock - pending));
    const prev = last.get(p.id);
    const fallbackCost = p.unit_cost === '' || p.unit_cost == null ? null : Number(p.unit_cost);
    rows.push({
      product_id: p.id, name: p.name, sku: p.sku, stock, threshold, perDay, daysLeft, onOrder: pending,
      reason: stock <= 0 ? 'out' : low ? 'low' : 'soon',
      suggested, supplier_id: prev?.supplier_id || '',
      unit_cost: prev ? prev.unit_cost : fallbackCost,
      lastPurchase: prev?.date || null,
    });
  }
  const rank = { out: 0, low: 1, soon: 2 };
  return rows.sort((a, b) => rank[a.reason] - rank[b.reason] || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.name.localeCompare(b.name));
}

// Groups chosen lines by supplier for one purchase order each.
export function groupBySupplier(lines) {
  const groups = new Map();
  for (const l of lines) {
    const key = l.supplier_id || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  return [...groups.entries()].map(([supplier_id, items]) => ({ supplier_id, items }))
    .sort((a, b) => (a.supplier_id ? 0 : 1) - (b.supplier_id ? 0 : 1));
}

// Validates lines and returns the payload create_purchase expects.
export function purchaseItems(lines) {
  const out = [];
  for (const l of lines) {
    const q = Number(l.quantity), c = Number(l.unit_cost);
    if (!Number.isInteger(q) || q < 1) throw Error(`Enter a whole quantity for ${l.name}.`);
    if (l.unit_cost === '' || l.unit_cost == null || !Number.isFinite(c) || c < 0) throw Error(`Enter the unit cost for ${l.name}.`);
    out.push({ product_id: l.product_id, quantity: q, unit_cost: Math.round(c * 100) / 100 });
  }
  if (!out.length) throw Error('Tick at least one product.');
  return out;
}

export const poNumber = id => 'PO-' + String(id).replace(/-/g, '').toUpperCase();

// WhatsApp message for the supplier.
export function purchaseOrderText({ number, company = {}, supplier = {}, lines, money, currency, date = new Date(), notes = '' }) {
  const out = [`*Purchase order ${number}*`, `From: ${company.name || 'Our store'}${company.phone ? ' (' + company.phone + ')' : ''}`];
  if (supplier.contact_name || supplier.name) out.push(`To: ${supplier.contact_name || supplier.name}`);
  out.push(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lusaka' }), '', 'Please supply:');
  let total = 0;
  for (const l of lines) {
    const q = Number(l.quantity), c = Number(l.unit_cost);
    total += Math.round(q * c * 100);
    out.push(`• ${q} x ${l.name}${l.sku ? ' (' + l.sku + ')' : ''} @ ${money(c, currency)}`);
  }
  out.push('', `*Total: ${money(total / 100, currency)}*`);
  if (notes) out.push('', notes);
  out.push('', 'Please confirm availability and delivery date. Thank you.');
  return out.join('\n');
}
