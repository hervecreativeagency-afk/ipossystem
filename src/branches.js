// Branches: which branch you are working at, stock per branch, transfers.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import * as offline from './offline';

const check = ({ data, error }) => { if (error) throw error; return data; };
import { ALL, mergeBranchStock } from './branch-utils.js';
export { ALL, mergeBranchStock, stockByBranch, chooseBranch, branchName, transferTotals } from './branch-utils.js';
import { chooseBranch } from './branch-utils.js';

// ---- data ------------------------------------------------------------------
export async function loadBranches(cid) {
  return check(await supabase.from('branches').select('id,name,address,phone,is_main,active').eq('company_id', cid).eq('active', true).order('is_main', { ascending: false }).order('name'));
}
export async function loadBranchStock(cid, branchId) {
  const all = [];
  for (let n = 0; ; n += 1000) {
    let q = supabase.from('branch_stock').select('branch_id,product_id,quantity').eq('company_id', cid).order('product_id').range(n, n + 999);
    if (branchId && branchId !== ALL) q = q.eq('branch_id', branchId);
    const rows = check(await q);
    all.push(...rows);
    if (rows.length < 1000) return all;
  }
}
export async function withBranchStock(products, cid, branchId) {
  if (!branchId || branchId === ALL) return products;
  return mergeBranchStock(products, await loadBranchStock(cid, branchId));
}
export const branchSummary = async cid => check(await supabase.rpc('branch_summary', { p_company_id: cid }));
export const saveBranch = async (cid, branch) => check(await supabase.rpc('save_branch', { p_company_id: cid, p_branch: branch }));
export const listStaffBranches = async cid => check(await supabase.rpc('list_staff_branches', { p_company_id: cid }));
export const setStaffBranch = async (cid, userId, branchId) => check(await supabase.rpc('set_staff_branch', { p_company_id: cid, p_user_id: userId, p_branch_id: branchId || null }));
export async function loadTransfers(cid) {
  return check(await supabase.from('stock_transfers').select('*').eq('company_id', cid).order('sent_at', { ascending: false }).limit(200));
}
export const sendTransfer = async ({ cid, from, to, items, notes, requestId }) => check(await supabase.rpc('send_transfer', { p_company_id: cid, p_from: from, p_to: to, p_items: items, p_notes: notes || null, p_request_id: requestId }));
export const receiveTransfer = async (cid, id, received, notes) => check(await supabase.rpc('receive_transfer', { p_company_id: cid, p_transfer_id: id, p_received: received || null, p_notes: notes || null }));
export const cancelTransfer = async (cid, id) => check(await supabase.rpc('cancel_transfer', { p_company_id: cid, p_transfer_id: id }));

// ---- state for the signed-in user ------------------------------------------
const storeKey = (uid, cid) => `ipos:branch:${uid}:${cid}`;
function readStored(uid, cid) { try { return localStorage.getItem(storeKey(uid, cid)); } catch { return null; } }
function writeStored(uid, cid, v) { try { localStorage.setItem(storeKey(uid, cid), v); } catch { /* storage blocked */ } }

export function useBranchState(session, membership) {
  const uid = session?.user.id, cid = membership?.company_id;
  const [branches, setBranches] = useState([]), [loaded, setLoaded] = useState(false), [choice, setChoice] = useState(null);
  useEffect(() => {
    if (!uid || !cid) { setBranches([]); setLoaded(false); return; }
    let live = true; setLoaded(false); setChoice(readStored(uid, cid));
    const key = offline.cacheKey(uid, cid, 'branches');
    loadBranches(cid).then(rows => { offline.saveCache(key, rows); if (live) setBranches(rows); })
      .catch(e => { const c = offline.isNetworkError(e) && offline.readCache(key); if (live) setBranches(c ? c.data : []); })
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [uid, cid]);
  const home = membership?.branch_id || null;
  const branchId = loaded ? chooseBranch({ home, branches, stored: choice }) : null;
  return {
    branches, branchesLoaded: loaded, branchId, homeBranch: home,
    multiBranch: branches.length > 1, canSwitchBranch: !home && branches.length > 1,
    branch: branches.find(b => b.id === branchId) || null,
    setBranchId: id => { if (home) return; setChoice(id); writeStored(uid, cid, id); },
    reloadBranches: () => loadBranches(cid).then(setBranches).catch(() => {}),
  };
}
