import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LogOut, RefreshCw, LoaderCircle, Store, Users, Activity, Bug, MessageSquare, Globe2, AlertCircle, ChevronDown, Check, Search, ShieldCheck, WifiOff } from 'lucide-react';
import { supabase } from './supabase';
import { WorldMap, countryName } from './WorldMap';
import { CREATOR_EMAIL, presenceStatus, ago, groupCrashes, visitsByDay, signupsByDay, places, flag } from './utils';
import './style.css';

const fmtDate = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const PERIODS = [[1, '24 hours'], [7, '7 days'], [30, '30 days'], [90, '90 days']];
const err = e => e?.message || 'Something went wrong.';

// ---------------------------------------------------------------- sign in
function SignIn({ notice }) {
  const [mode, setMode] = useState('in'), [email, setEmail] = useState(CREATOR_EMAIL), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState(notice || '');
  async function submit(e) {
    e.preventDefault(); setError(''); setInfo('');
    const addr = email.trim().toLowerCase();
    if (mode !== 'in' && addr !== CREATOR_EMAIL) { setError('Only the iPOS creator account can be set up here.'); return; }
    setBusy(true);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (error) throw error;
      } else if (mode === 'setup') {
        if (password.length < 10) throw Error('Use at least 10 characters for your creator password.');
        const { error } = await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        setInfo(`Check ${addr} for a verification email and open the link. Then come back here and sign in.`); setMode('in'); setPassword('');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: location.origin });
        if (error) throw error;
        setInfo(`If ${addr} has an account, a password reset link is on its way.`); setMode('in');
      }
    } catch (e) { setError(err(e)); } finally { setBusy(false); }
  }
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><img src="/favicon.png" alt="" /><div><strong>iPOS Creator</strong><small>Platform console</small></div></div>
        <h1>{mode === 'in' ? 'Sign in' : mode === 'setup' ? 'Create your creator password' : 'Reset your password'}</h1>
        {info && <div className="note ok" role="status">{info}</div>}
        {error && <div className="note bad" role="alert"><AlertCircle size={16} /> {error}</div>}
        <label>Email<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
        {mode !== 'reset' && <label>Password<input type="password" required minLength={mode === 'setup' ? 10 : 6} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>}
        <button className="btn primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : null}{mode === 'in' ? 'Sign in' : mode === 'setup' ? 'Create password' : 'Send reset link'}</button>
        <div className="auth-links">
          {mode === 'in' ? <>
            <button type="button" onClick={() => { setMode('setup'); setError(''); }}>First time? Create your password</button>
            <button type="button" onClick={() => { setMode('reset'); setError(''); }}>Forgot password?</button>
          </> : <button type="button" onClick={() => { setMode('in'); setError(''); }}>Back to sign in</button>}
        </div>
        <p className="fine">Private console for the iPOS creator. Shops and staff can't open it.</p>
      </form>
    </div>
  );
}

function NewPassword({ onDone }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { if (password.length < 10) throw Error('Use at least 10 characters.'); const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; onDone(); }
    catch (e) { setError(err(e)); } finally { setBusy(false); }
  }
  return (
    <div className="auth-page"><form className="auth-card" onSubmit={submit}>
      <div className="brand"><img src="/favicon.png" alt="" /><div><strong>iPOS Creator</strong><small>Platform console</small></div></div>
      <h1>Choose a new password</h1>
      {error && <div className="note bad" role="alert">{error}</div>}
      <label>New password<input type="password" required minLength={10} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="btn primary" disabled={busy}>Save password</button>
    </form></div>
  );
}

// ---------------------------------------------------------------- console
function useConsoleData(days) {
  const [state, setState] = useState({ loading: true, error: '', data: null, at: null });
  async function load(quiet) {
    if (!quiet) setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const call = async (fn, args) => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data; };
      const [overview, events, presence, feedback] = await Promise.all([call('creator_overview'), call('creator_events', { p_days: days }), call('creator_presence'), call('creator_feedback')]);
      setState({ loading: false, error: '', data: { overview, events, presence, feedback }, at: new Date() });
    } catch (e) { setState(s => ({ ...s, loading: false, error: err(e) })); }
  }
  useEffect(() => { load(false); const t = setInterval(() => load(true), 30000); return () => clearInterval(t); }, [days]);
  return { ...state, reload: () => load(false), setData: fn => setState(s => ({ ...s, data: fn(s.data) })) };
}

function Kpi({ icon: Icon, label, value, sub, tone }) {
  return <div className={'kpi ' + (tone || '')}><div className="kpi-head"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{sub}</small></div>;
}

function Bars({ rows, value, label, color }) {
  const max = Math.max(1, ...rows.map(value));
  return (
    <div className="bars" role="img" aria-label={label}>
      {rows.map(r => <div key={r.day} className="bar-col" title={`${r.day}: ${value(r)}`}><i style={{ height: `${Math.max(value(r) ? 3 : 0, value(r) / max * 100)}%`, background: color }} /></div>)}
    </div>
  );
}

function Section({ id, title, icon: Icon, right, children }) {
  return <section className="card" id={id}><div className="card-head"><h2><Icon size={18} /> {title}</h2>{right}</div>{children}</section>;
}

function Console({ session }) {
  const [days, setDays] = useState(7), [q, setQ] = useState(''), [onlyUnverified, setOnlyUnverified] = useState(false), [open, setOpen] = useState(null), [fbTab, setFbTab] = useState('new');
  const { data, loading, error, at, reload, setData } = useConsoleData(days);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 15000); return () => clearInterval(t); }, []);
  const derived = useMemo(() => {
    if (!data) return null;
    const { overview, events, presence, feedback } = data;
    const now = Date.now();
    const live = presence.map(p => ({ ...p, status: presenceStatus(p, now) }));
    const crashes = groupCrashes(events);
    const visits = events.filter(e => e.kind === 'visit');
    return {
      shops: overview.shops, users: overview.users, live, crashes, feedback, map: places(events),
      online: live.filter(p => p.status === 'online'), away: live.filter(p => p.status === 'away'),
      visits, visitors: new Set(visits.map(e => e.user_id || `${e.city}:${e.device}:${e.browser}`)).size,
      errors: events.filter(e => e.kind === 'error'), byDay: visitsByDay(events, Math.max(days, 7)), signups: signupsByDay(overview.users, 30),
      newShops: overview.shops.filter(s => s.created_at && Date.parse(s.created_at) > now - 7 * 86400000).length,
      verified: overview.users.filter(u => u.verified).length,
    };
  }, [data, days]);

  async function setFeedback(f, status) {
    const { error } = await supabase.rpc('creator_set_feedback', { p_id: f.id, p_status: status });
    if (!error) setData(d => ({ ...d, feedback: d.feedback.map(x => x.id === f.id ? { ...x, status } : x) }));
  }

  const d = derived;
  const match = s => !q || JSON.stringify(s).toLowerCase().includes(q.toLowerCase());
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><img src="/favicon.png" alt="" /><div><strong>iPOS Creator</strong><small>{at ? `Updated ${ago(at.toISOString())} · refreshes every 30 s` : 'Loading…'}</small></div></div>
        <nav className="jump">{[['live', 'Live'], ['map', 'Map'], ['crashes', 'Crashes'], ['shops', 'Shops'], ['users', 'Users & emails'], ['feedback', 'Feedback']].map(([id, l]) => <a key={id} href={'#' + id}>{l}</a>)}</nav>
        <div className="top-right">
          <select aria-label="Period" value={days} onChange={e => setDays(Number(e.target.value))}>{PERIODS.map(([v, l]) => <option key={v} value={v}>Last {l}</option>)}</select>
          <button className="icon" aria-label="Refresh" onClick={reload}>{loading ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={17} />}</button>
          <span className="who" title={session.user.email}><ShieldCheck size={15} /> {session.user.email}</span>
          <button className="icon" aria-label="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={17} /></button>
        </div>
      </header>
      <main>
        {error && <div className="note bad" role="alert"><AlertCircle size={16} /> {error}</div>}
        {!d ? <div className="loading"><LoaderCircle className="spin" /> Loading the platform…</div> : <>
          <div className="kpis">
            <Kpi icon={Store} label="Shops" value={d.shops.length} sub={`${d.newShops} new this week`} />
            <Kpi icon={Users} label="Accounts" value={d.users.length} sub={`${d.verified} verified · ${d.users.length - d.verified} not yet`} />
            <Kpi icon={Activity} label="Online now" value={d.online.length} sub={`${d.away.length} away · ${d.live.length - d.online.length - d.away.length} offline`} tone={d.online.length ? 'good' : ''} />
            <Kpi icon={Globe2} label={`Visits · ${PERIODS.find(p => p[0] === days)[1]}`} value={d.visits.length} sub={`${d.visitors} people · ${d.map.countries.length} countries`} />
            <Kpi icon={Bug} label={`Crashes · ${PERIODS.find(p => p[0] === days)[1]}`} value={d.errors.length} sub={`${d.crashes.length} different problems`} tone={d.errors.length ? 'bad' : ''} />
            <Kpi icon={MessageSquare} label="New feedback" value={d.feedback.filter(f => f.status === 'new').length} sub={`${d.feedback.length} in total`} tone={d.feedback.some(f => f.status === 'new') ? 'warn' : ''} />
          </div>

          <div className="grid-2">
            <Section id="map" title="Where iPOS is used" icon={Globe2} right={<small>approximate, from the internet connection</small>}>
              <WorldMap data={d.map} />
              <ul className="countries">{d.map.countries.slice(0, 8).map(c => <li key={c.code}><span>{flag(c.code)} {countryName(c.code)}</span><strong>{c.visits}</strong>{c.errors > 0 && <em>{c.errors} crashes</em>}</li>)}
                {!d.map.countries.length && <li className="muted">No visits recorded yet. They appear as soon as people open iPOS.</li>}</ul>
            </Section>
            <Section id="live" title="Live now" icon={Activity} right={<small>{d.online.length} online</small>}>
              <ul className="live">
                {d.live.slice(0, 40).map(p => (
                  <li key={p.user_id} className={p.status}>
                    <span className="dot" aria-label={p.status} />
                    <div><strong>{p.name || p.email || 'Unknown'}</strong><small>{[p.shop, p.role].filter(Boolean).join(' · ') || 'No shop'}</small>
                      <small>{[p.device, p.browser, p.city && `${flag(p.country)} ${p.city}`].filter(Boolean).join(' · ')}</small>
                      {p.pending_sales > 0 && <small className="offline-tag"><WifiOff size={12} /> {p.pending_sales} offline sale{p.pending_sales === 1 ? '' : 's'} waiting to sync</small>}
                      {p.connection === 'offline' && p.status === 'online' && !p.pending_sales && <small className="offline-tag"><WifiOff size={12} /> can't reach the database</small>}
                    </div>
                    <span className="when">{p.status === 'online' ? <>on <code>{p.page}</code></> : ago(p.last_seen)}</span>
                  </li>
                ))}
                {!d.live.length && <li className="muted">Nobody has opened iPOS since reporting was switched on.</li>}
              </ul>
            </Section>
          </div>

          <div className="grid-2">
            <Section id="traffic" title="Visits per day" icon={Activity} right={<small>{d.byDay.at(-1)?.visits || 0} today</small>}><Bars rows={d.byDay} value={r => r.visits} label="Visits per day" color="#2e7960" /><div className="bar-axis"><span>{d.byDay[0]?.day}</span><span>today</span></div></Section>
            <Section id="signups" title="New accounts per day" icon={Users} right={<small>last 30 days · {d.signups.reduce((n, r) => n + r.count, 0)} in total</small>}><Bars rows={d.signups} value={r => r.count} label="Sign-ups per day" color="#4f86c6" /><div className="bar-axis"><span>{d.signups[0]?.day}</span><span>today</span></div></Section>
          </div>

          <Section id="crashes" title="Crashes" icon={Bug} right={<small>{d.errors.length} in the period, newest first</small>}>
            {d.crashes.length ? <ul className="crashes">{d.crashes.map(c => (
              <li key={c.message} className={open === c.message ? 'open' : ''}>
                <button onClick={() => setOpen(open === c.message ? null : c.message)}>
                  <span className="count">{c.count}×</span>
                  <span className="msg"><strong>{c.message}</strong><small>{c.users} {c.users === 1 ? 'person' : 'people'} · {c.shops.length ? c.shops.join(', ') : 'signed out'} · {c.pages.join(', ')}</small></span>
                  <span className="when">{ago(c.last)}</span><ChevronDown size={16} />
                </button>
                {open === c.message && <div className="crash-detail">
                  <p><b>First seen</b> {fmtDate(c.first)} · <b>Last seen</b> {fmtDate(c.last)} · <b>Version</b> {c.latest.app_version || '—'}</p>
                  <p><b>Devices</b> {c.devices.join('; ') || '—'}</p>
                  <pre>{c.latest.detail || 'No details recorded.'}</pre>
                </div>}
              </li>))}</ul> : <p className="muted pad">No crashes in this period. 🎉</p>}
          </Section>

          <div className="filter"><Search size={16} /><input placeholder="Search shops, emails, cities…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" /></div>

          <Section id="shops" title="Shops" icon={Store} right={<small>{d.shops.length} registered</small>}>
            <div className="table"><table><thead><tr><th>Shop</th><th>Owner</th><th>Joined</th><th>Last sign-in</th><th>Staff</th><th>Branches</th><th>Products</th><th>Sales · 30 days</th><th>Last sale</th></tr></thead>
              <tbody>{d.shops.filter(match).map(s => <tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.owner_email || '—'} {s.owner_verified === false && <span className="badge warn">not verified</span>}</td><td>{fmtDate(s.created_at)}</td><td>{ago(s.last_sign_in)}</td><td>{s.staff}</td><td>{s.branches || 1}</td><td>{s.products}</td><td>{s.sales_30d} · {s.currency === 'ZMW' ? 'K' : s.currency + ' '}{Number(s.revenue_30d).toLocaleString('en-ZM', { maximumFractionDigits: 0 })}</td><td>{ago(s.last_sale)}</td></tr>)}</tbody></table></div>
          </Section>

          <Section id="users" title="Users & emails" icon={Users} right={<label className="check"><input type="checkbox" checked={onlyUnverified} onChange={e => setOnlyUnverified(e.target.checked)} /> Only not verified</label>}>
            <div className="table"><table><thead><tr><th>Email</th><th>Name</th><th>Email verified</th><th>Shops</th><th>Joined</th><th>Last sign-in</th></tr></thead>
              <tbody>{d.users.filter(u => (!onlyUnverified || !u.verified) && match(u)).map(u => <tr key={u.id}><td><a href={`mailto:${u.email}`}>{u.email}</a></td><td>{u.name || '—'}</td><td>{u.verified ? <span className="badge good"><Check size={12} /> verified</span> : <span className="badge warn">waiting</span>}</td><td>{u.shops.map(s => `${s.name} (${s.role}${s.active ? '' : ', off'})`).join(', ') || '—'}</td><td>{fmtDate(u.created_at)}</td><td>{ago(u.last_sign_in)}</td></tr>)}</tbody></table></div>
          </Section>

          <Section id="feedback" title="Feedback" icon={MessageSquare} right={<div className="tabs">{[['new', 'New'], ['read', 'Read'], ['done', 'Done']].map(([k, l]) => <button key={k} className={fbTab === k ? 'active' : ''} onClick={() => setFbTab(k)}>{l} <span>{d.feedback.filter(f => f.status === k).length}</span></button>)}</div>}>
            <ul className="feedback">{d.feedback.filter(f => f.status === fbTab).map(f => (
              <li key={f.id}>
                <div className="face" aria-label={['', 'unhappy', 'okay', 'happy'][f.rating || 0] || 'no rating'}>{['💬', '☹️', '😐', '😊'][f.rating || 0]}</div>
                <div className="fb-body"><p>{f.message}</p><small>{[f.name || f.email, f.shop, f.role, f.page, f.device].filter(Boolean).join(' · ')} · {fmtDate(f.created_at)}</small></div>
                <div className="fb-actions">
                  {f.email && <a className="btn" href={`mailto:${f.email}?subject=${encodeURIComponent('Your iPOS feedback')}`}>Reply</a>}
                  {f.status !== 'read' && <button className="btn" onClick={() => setFeedback(f, 'read')}>Mark read</button>}
                  {f.status !== 'done' && <button className="btn" onClick={() => setFeedback(f, 'done')}>Done</button>}
                  {f.status !== 'new' && <button className="btn link" onClick={() => setFeedback(f, 'new')}>Move to new</button>}
                </div>
              </li>))}
              {!d.feedback.filter(f => f.status === fbTab).length && <li className="muted pad">Nothing here.</li>}</ul>
          </Section>
        </>}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- app
function App() {
  const [session, setSession] = useState(undefined), [allowed, setAllowed] = useState(null), [recovery, setRecovery] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => { if (event === 'PASSWORD_RECOVERY') setRecovery(true); setSession(s); });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    setAllowed(null);
    if (!session) return;
    supabase.rpc('creator_check').then(({ data, error }) => setAllowed(!error && data === true));
  }, [session?.user?.id]);
  if (session === undefined) return <div className="loading full"><LoaderCircle className="spin" /></div>;
  if (recovery && session) return <NewPassword onDone={() => { setRecovery(false); setNotice('Password saved.'); }} />;
  if (!session) return <SignIn notice={notice} />;
  if (allowed === null) return <div className="loading full"><LoaderCircle className="spin" /> Checking access…</div>;
  if (!allowed) return (
    <div className="auth-page"><div className="auth-card">
      <div className="brand"><img src="/favicon.png" alt="" /><div><strong>iPOS Creator</strong><small>Platform console</small></div></div>
      <h1>No creator access</h1>
      <p>{session.user.email} isn't the iPOS creator account{session.user.email?.toLowerCase() === CREATOR_EMAIL && !session.user.email_confirmed_at ? ', or its email isn’t verified yet. Open the verification link sent to it, then sign in again.' : '.'}</p>
      <button className="btn primary" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div></div>
  );
  return <Console session={session} />;
}

createRoot(document.getElementById('root')).render(<App />);
