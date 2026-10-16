// Pure branch helpers (no browser or database imports; unit tested).
export const ALL = 'all';

// Shows each product's stock at one branch; keeps the company total alongside.
export function mergeBranchStock(products, rows) {
  const qty = new Map(rows.map(r => [r.product_id, Number(r.quantity)]));
  return products.map(p => ({ ...p, total_stock: p.stock_quantity, stock_quantity: qty.get(p.id) ?? 0 }));
}

// stock per product per branch: { [product_id]: { [branch_id]: qty } }
export function stockByBranch(rows) {
  const out = {};
  for (const r of rows) (out[r.product_id] ||= {})[r.branch_id] = Number(r.quantity);
  return out;
}

// Picks the branch to work at: staff are fixed to their home branch; owners
// choose, defaulting to "all branches" when there is more than one.
export function chooseBranch({ home, branches, stored }) {
  if (home) return home;
  if (!branches.length) return null;
  if (branches.length === 1) return branches[0].id;
  if (stored === ALL || branches.some(b => b.id === stored)) return stored;
  return ALL;
}

export const branchName = (branches, id) => (id === ALL ? 'All branches' : branches.find(b => b.id === id)?.name || '');

export function transferTotals(transfer) {
  const sent = transfer.items.reduce((n, i) => n + Number(i.quantity), 0);
  const received = transfer.status === 'received' ? transfer.items.reduce((n, i) => n + Number(i.received ?? i.quantity), 0) : null;
  return { sent, received, missing: received == null ? 0 : sent - received };
}

