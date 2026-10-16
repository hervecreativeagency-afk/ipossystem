// Pure helpers for expiry dates (unit tested).

export const lusakaToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lusaka' }).format(now);

export function daysLeft(expiry, today = lusakaToday()) {
  return Math.round((Date.parse(expiry + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}

// expired | week (≤7 days) | month (≤30 days) | later
export function expiryStatus(expiry, today = lusakaToday()) {
  const d = daysLeft(expiry, today);
  return d < 0 ? 'expired' : d <= 7 ? 'week' : d <= 30 ? 'month' : 'later';
}

export function expiryText(expiry, today = lusakaToday()) {
  const d = daysLeft(expiry, today);
  if (d < -1) return `Expired ${-d} days ago`;
  if (d === -1) return 'Expired yesterday';
  if (d === 0) return 'Expires today';
  if (d === 1) return 'Expires tomorrow';
  return `${d} days left`;
}

export function groupBatches(batches, today = lusakaToday()) {
  const groups = { expired: [], week: [], month: [], later: [] };
  for (const b of batches) if (Number(b.quantity) > 0) groups[expiryStatus(b.expiry_date, today)].push(b);
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  return groups;
}

// Stock at a branch that has no expiry date recorded yet.
export const undatedStock = (onHand, batches) => Math.max(0, Number(onHand || 0) - batches.reduce((n, b) => n + Number(b.quantity || 0), 0));
