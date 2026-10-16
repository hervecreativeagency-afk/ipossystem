// Pure helpers for product variants (unit tested).

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
export const splitValues = text => [...new Set(String(text ?? '').split(/[,\n]/).map(clean).filter(Boolean))];

// Option lists -> labels: [["Red","Blue"],["S","M"]] -> ["Red / S","Red / M","Blue / S","Blue / M"]
export function combinations(optionValues) {
  const lists = optionValues.filter(v => v.length);
  if (!lists.length) return [];
  return lists.reduce((acc, values) => acc.flatMap(a => values.map(v => (a ? a + ' / ' : '') + v)), ['']);
}

export const variantName = (base, label) => `${clean(base)} – ${clean(label)}`;

// "TSHIRT" + "Red / Large" -> "TSHIRT-RED-LARGE"
export function variantSku(baseSku, label) {
  const part = clean(label).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [clean(baseSku).toUpperCase(), part].filter(Boolean).join('-').slice(0, 60);
}

// Groups products for the checkout grid: one entry per variant group, singles as they are.
export function groupForGrid(products) {
  const out = [], groups = new Map();
  for (const p of products) {
    if (!p.variant_group_id) { out.push({ type: 'single', product: p }); continue; }
    let g = groups.get(p.variant_group_id);
    if (!g) { g = { type: 'group', id: p.variant_group_id, name: p.variant_base || p.name, variants: [] }; groups.set(p.variant_group_id, g); out.push(g); }
    g.variants.push(p);
  }
  for (const g of groups.values()) {
    g.variants.sort((a, b) => String(a.variant_label).localeCompare(String(b.variant_label), undefined, { numeric: true }));
    const prices = g.variants.map(v => Number(v.selling_price));
    g.minPrice = Math.min(...prices); g.maxPrice = Math.max(...prices);
    g.stock = g.variants.reduce((n, v) => n + Math.max(0, Number(v.stock_quantity) || 0), 0);
    g.image = g.variants.find(v => v.image_url)?.image_url || '';
  }
  return out;
}
