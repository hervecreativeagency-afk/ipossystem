import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ArrowRight, X, Sparkles, Download, LoaderCircle } from 'lucide-react';
import { supabase } from './supabase';
import { buildSteps, progress } from './setup-utils';

// ---- app install (the browser offers this once; keep it for the install step)
let installEvent = null;
const installListeners = new Set();
const readFlag = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeFlag = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage unavailable */ } };
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; installListeners.forEach(f => f()); });
  window.addEventListener('appinstalled', () => { installEvent = null; writeFlag('ipos.installed', '1'); installListeners.forEach(f => f()); });
}
const isInstalled = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true || readFlag('ipos.installed') === '1');
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---- facts from the store's data
async function count(table, cid) {
  const { count: n, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('company_id', cid);
  if (error) throw error;
  return n || 0;
}
const safe = p => p.catch(() => 0);

async function loadFacts(auth) {
  const m = auth.membership, cid = m.company_id, owner = m.role === 'director', manager = owner || m.role === 'supervisor';
  const [products, suppliers, shifts, sales, staff, invites] = await Promise.all([
    manager ? safe(count('products', cid)) : 0,
    manager ? safe(count('suppliers', cid)) : 0,
    safe(count('cashier_shifts', cid)),
    safe(count('sales', cid)),
    owner ? supabase.rpc('list_store_staff', { p_company_id: cid }).then(r => (r.data || []).length, () => 0) : 0,
    owner ? safe(count('staff_invitations', cid)) : 0,
  ]);
  return {
    address: String(m.companies.address || '').trim(), phone: String(m.companies.phone || '').trim(),
    products, suppliers, shifts, sales, staff, invites, branches: (auth.branches || []).length, installed: isInstalled(),
  };
}

const prefsKey = auth => `ipos.setup.${auth.membership.company_id}.${auth.user?.id || ''}`;
function readPrefs(auth) { try { return JSON.parse(readFlag(prefsKey(auth)) || '{}'); } catch { return {}; } }

export function useSetupGuide(auth) {
  const [facts, setFacts] = useState(null);
  const [prefs, setPrefs] = useState(() => readPrefs(auth));
  const [, rerender] = useState(0);
  useEffect(() => {
    let live = true;
    loadFacts(auth).then(f => { if (live) setFacts(f); });
    const onInstall = () => { rerender(n => n + 1); setFacts(f => f && { ...f, installed: isInstalled() }); };
    installListeners.add(onInstall);
    return () => { live = false; installListeners.delete(onInstall); };
  }, [auth.membership.company_id, auth.membership.companies.address, auth.membership.companies.phone, (auth.branches || []).length]);
  const save = next => { setPrefs(next); writeFlag(prefsKey(auth), JSON.stringify(next)); };
  const steps = buildSteps(auth.membership.role, facts, prefs);
  return {
    facts, steps, prefs, ...progress(steps),
    skip: id => save({ ...prefs, skipped: [...new Set([...(prefs.skipped || []), id])] }),
    unskip: id => save({ ...prefs, skipped: (prefs.skipped || []).filter(x => x !== id) }),
    hide: () => save({ ...prefs, hidden: true }),
    show: () => save({ ...prefs, hidden: false }),
  };
}

function InstallAction() {
  const [busy, setBusy] = useState(false), [help, setHelp] = useState('');
  async function install() {
    if (installEvent) {
      setBusy(true);
      try { installEvent.prompt(); const r = await installEvent.userChoice; if (r?.outcome === 'accepted') writeFlag('ipos.installed', '1'); installEvent = null; installListeners.forEach(f => f()); }
      finally { setBusy(false); }
      return;
    }
    setHelp(isIOS()
      ? 'On iPhone or iPad: open iPOS in Safari, tap the Share button, then “Add to Home Screen”.'
      : 'Open your browser menu (⋮) and choose “Install app” or “Add to Home screen”. On a computer, look for the install icon at the right of the address bar.');
  }
  return (
    <>
      <button type="button" className="primary" onClick={install} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />} Install iPOS</button>
      {help && <p className="setup-install-help" role="status">{help}</p>}
    </>
  );
}

/** The setup checklist. place="dashboard" shows a compact card that can be hidden; place="help" always shows. */
export function SetupGuide({ auth, place = 'dashboard' }) {
  const g = useSetupGuide(auth);
  const [open, setOpen] = useState(null);
  const dashboard = place === 'dashboard';
  if (dashboard && (auth.membership.role === 'cashier' || g.prefs.hidden || !g.facts || g.complete)) return null;
  if (!dashboard && !g.facts) return <section className="management-panel setup-guide"><div className="insights-loading"><LoaderCircle size={18} className="spin" /> Checking your setup…</div></section>;
  const expanded = open ?? g.next?.id;
  const fresh = g.finished === 0;
  return (
    <section className={'setup-guide' + (dashboard ? '' : ' management-panel')} aria-label="Setup guide">
      <div className="setup-head">
        <div>
          <h2>{g.complete ? <><Sparkles size={19} /> Your shop is set up</> : fresh ? `Welcome to iPOS, ${auth.membership.companies.name}` : 'Finish setting up your shop'}</h2>
          <p>{g.complete ? 'Everything is in place. You can come back here any time.' : fresh ? 'These steps take about 15 minutes. Each one ticks itself off when it’s done.' : `${g.finished} of ${g.total} done. Next: ${g.next.title[0].toLowerCase() + g.next.title.slice(1)}.`}</p>
        </div>
        {dashboard && <button type="button" className="icon-button" aria-label="Hide setup guide" title="Hide (you can find it again in Help)" onClick={g.hide}><X size={18} /></button>}
      </div>
      <div className="setup-bar" role="progressbar" aria-valuenow={g.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress"><span style={{ width: g.percent + '%' }} /></div>
      <ol className="setup-steps">
        {g.steps.map((s, i) => {
          const isOpen = expanded === s.id && s.status === 'todo';
          return (
            <li key={s.id} className={`setup-item ${s.status}${isOpen ? ' open' : ''}`}>
              <button type="button" className="setup-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : s.id)}>
                <span className="setup-mark">{s.status === 'done' ? <Check size={15} /> : s.status === 'skipped' ? '–' : i + 1}</span>
                <span className="setup-title">{s.title}{s.optional && s.status === 'todo' && <em>Optional</em>}</span>
                <span className="setup-hint">{s.status === 'skipped' ? 'Skipped' : s.hint}</span>
                {s.status === 'todo' && <ChevronDown size={16} className="setup-chevron" />}
              </button>
              {isOpen && (
                <div className="setup-body">
                  <p>{s.why}</p>
                  <div className="setup-actions">
                    {s.action === 'install' ? <InstallAction /> : <Link className="primary" to={s.to}>{s.action} <ArrowRight size={16} /></Link>}
                    {s.optional && <button type="button" className="secondary" onClick={() => { g.skip(s.id); setOpen(null); }}>{s.id === 'branches' ? 'I have one shop' : s.id === 'staff' ? 'I work alone' : 'Skip'}</button>}
                  </div>
                </div>
              )}
              {s.status === 'skipped' && <button type="button" className="setup-undo" onClick={() => g.unskip(s.id)}>Undo</button>}
            </li>
          );
        })}
      </ol>
      {!dashboard && g.prefs.hidden && !g.complete && <p className="muted">This guide is hidden from your dashboard. <button type="button" className="link-button" onClick={g.show}>Show it there again</button></p>}
    </section>
  );
}
