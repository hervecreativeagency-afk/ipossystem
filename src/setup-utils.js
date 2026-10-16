// Pure logic for the new-owner setup guide (unit tested).

// facts: { address, phone, products, costs, suppliers, staff, invites, branches, shifts, sales, installed }
// prefs: { skipped: [ids], hidden: bool }
export const STEPS = [
  {
    id: 'details', roles: ['director'], to: '/settings', action: 'Open store settings',
    title: 'Add your shop details',
    why: 'Your shop name, address, phone and TPIN are printed on every receipt and invoice.',
    done: f => Boolean(f.address && f.phone),
    hint: f => !f.address && !f.phone ? 'Address and phone missing' : !f.address ? 'Address missing' : !f.phone ? 'Phone missing' : '',
  },
  {
    id: 'products', roles: ['director', 'supervisor'], to: '/products', action: 'Add products',
    title: 'Add the products you sell',
    why: 'Add a name and price for each item. You can scan barcodes, add sizes or colours, and enter purchase costs so your profit reports are right.',
    done: f => f.products > 0,
    hint: f => f.products > 0 ? `${f.products} ${f.products === 1 ? 'product' : 'products'} added` : '',
  },
  {
    id: 'suppliers', roles: ['director', 'supervisor'], to: '/suppliers', action: 'Add a supplier', optional: true,
    title: 'Add your suppliers',
    why: 'Keep supplier phone numbers in one place and send purchase orders from the reorder list in one tap.',
    done: f => f.suppliers > 0,
    hint: f => f.suppliers > 0 ? `${f.suppliers} added` : '',
  },
  {
    id: 'staff', roles: ['director'], to: '/staff', action: 'Invite staff', optional: true,
    title: 'Invite your staff',
    why: 'Give each cashier their own login so every sale and cash drawer is tracked to the right person.',
    done: f => f.staff > 1 || f.invites > 0,
    hint: f => f.staff > 1 ? `${f.staff - 1} staff ${f.staff === 2 ? 'member' : 'members'}` : f.invites > 0 ? `${f.invites} invitation${f.invites === 1 ? '' : 's'} sent` : '',
  },
  {
    id: 'branches', roles: ['director'], to: '/branches', action: 'Set up branches', optional: true,
    title: 'Add your other shops',
    why: 'Only if you have more than one shop: each branch keeps its own stock, and you can move stock between them.',
    done: f => f.branches > 1,
    hint: f => f.branches > 1 ? `${f.branches} branches` : '',
  },
  {
    id: 'shift', roles: ['director', 'supervisor', 'cashier'], to: '/shifts', action: 'Open a shift',
    title: 'Open your first cashier shift',
    why: 'Count the cash in the drawer at the start of the day so iPOS can tell you if anything is short when you close.',
    done: f => f.shifts > 0,
  },
  {
    id: 'sale', roles: ['director', 'supervisor', 'cashier'], to: '/pos', action: 'Make a sale',
    title: 'Make a test sale',
    why: 'Sell one item, take payment and print or share the receipt. You can refund it afterwards from Returns.',
    done: f => f.sales > 0,
  },
  {
    id: 'install', roles: ['director', 'supervisor', 'cashier'], action: 'install', optional: true,
    title: 'Install iPOS on the shop device',
    why: 'It opens like an app, full-screen, and keeps selling when the internet drops.',
    done: f => Boolean(f.installed),
  },
];

export function buildSteps(role, facts, prefs = {}) {
  const skipped = new Set(prefs.skipped || []);
  return STEPS.filter(s => s.roles.includes(role)).map(s => {
    const done = facts ? s.done(facts) : false;
    return {
      id: s.id, title: s.title, why: s.why, to: s.to, action: s.action, optional: Boolean(s.optional),
      status: done ? 'done' : s.optional && skipped.has(s.id) ? 'skipped' : 'todo',
      hint: facts && s.hint ? s.hint(facts) : '',
    };
  });
}

export function progress(steps) {
  const finished = steps.filter(s => s.status !== 'todo').length;
  const next = steps.find(s => s.status === 'todo' && !s.optional) || steps.find(s => s.status === 'todo') || null;
  return { finished, total: steps.length, percent: steps.length ? Math.round(finished / steps.length * 100) : 100, complete: !next, next };
}
