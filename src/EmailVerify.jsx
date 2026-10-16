import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MailCheck, LoaderCircle, ShieldCheck, ArrowLeft, CheckCircle2, ArrowRight, Send } from 'lucide-react';
import { supabase } from './supabase';
import Brand from './Brand';
import { readVerifyLink, verifyErrorMessage } from './verify-utils';

const SITE = 'https://ipossystem.vercel.app';
const TITLES = {
  signup: ['Confirm your email', 'Confirm this email address to finish creating your iPOS account.', 'Confirm my email'],
  email: ['Confirm your email', 'Confirm this email address to finish creating your iPOS account.', 'Confirm my email'],
  invite: ['Join your store on iPOS', 'Accept the invitation, then choose your password.', 'Accept invitation'],
  recovery: ['Reset your password', 'Confirm it is you, then choose a new password.', 'Continue'],
  email_change: ['Confirm your new email', 'Confirm this address to update your iPOS sign-in email.', 'Confirm new email'],
  magiclink: ['Sign in to iPOS', 'Confirm to sign in to your store workspace.', 'Sign in'],
};

// /account/email/verify — the page every iPOS email link opens.
// Confirmation waits for a tap, so email security scanners that open links
// automatically cannot use up the one-time link before the person does.
export function EmailVerify() {
  const navigate = useNavigate();
  const [link] = useState(() => readVerifyLink(window.location.search, window.location.hash));
  const [state, setState] = useState(link.tokenHash || link.code ? 'ready' : link.error ? 'failed' : 'missing');
  const [error, setError] = useState(link.error ? verifyErrorMessage({ message: link.error, code: link.errorCode }) : '');
  const [email, setEmail] = useState(link.username);
  const [resend, setResend] = useState({ busy: false, sent: false, error: '' });
  const [title, text, action] = TITLES[link.type] || TITLES.signup;

  useEffect(() => {
    // Take the secret out of the address bar and browser history once it is read.
    if (link.tokenHash || link.code) window.history.replaceState(null, '', '/account/email/verify' + (link.username ? '?username=' + encodeURIComponent(link.username) : ''));
  }, []);

  async function confirm() {
    if (!supabase) { setState('failed'); setError('iPOS is not connected to its database.'); return; }
    setState('working'); setError('');
    try {
      const { error } = link.code
        ? await supabase.auth.exchangeCodeForSession(link.code)
        : await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
      if (error) throw error;
      setState('done');
      navigate(link.next, { replace: true });
    } catch (e) {
      setState('failed');
      setError(verifyErrorMessage(e));
    }
  }

  async function sendNew(e) {
    e.preventDefault();
    setResend({ busy: true, sent: false, error: '' });
    try {
      const { error } = ['recovery', 'invite'].includes(link.type)
        ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE + '/reset-password' })
        : await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: SITE + '/account/register/success' } });
      if (error) throw error;
      setResend({ busy: false, sent: true, error: '' });
    } catch (err) {
      setResend({ busy: false, sent: false, error: /rate limit|too many|seconds/i.test(err?.message || '') ? 'Too many attempts. Please wait a minute and try again.' : 'Could not send a new link. Check the email address and try again.' });
    }
  }

  return (
    <div className="reset-page verify-page">
      <section className="reset-card">
        <Brand className="verify-brand" />
        <span className="small-icon"><MailCheck size={26} /></span>
        <h1>{state === 'failed' ? 'Link not confirmed' : state === 'missing' ? 'Open the link from your email' : title}</h1>
        <p>{state === 'missing' ? 'This page confirms iPOS email links. Open the newest email from iPOS and tap the button inside it.' : state === 'failed' ? 'Email links work once and expire after a while.' : text}</p>
        {link.username && ['ready', 'working', 'done'].includes(state) && <div className="verify-email"><span>Email</span><strong>{link.username}</strong></div>}
        {error && <div className="notice" role="alert">{error}</div>}
        {(state === 'ready' || state === 'working' || state === 'done') && (
          <button className="primary verify-button" onClick={confirm} disabled={state !== 'ready'} autoFocus>
            {state === 'ready' ? <>{action} <ArrowRight size={17} /></> : <><LoaderCircle size={17} className="spin" /> Confirming…</>}
          </button>
        )}
        {(state === 'failed' || state === 'missing') && link.type !== 'magiclink' && (
          resend.sent ? (
            <div className="setup-note" role="status"><CheckCircle2 size={18} /><span>A new link is on its way to <strong>{email}</strong>. Open the newest email; older links stop working.</span></div>
          ) : (
            <form className="verify-resend" onSubmit={sendNew}>
              <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
              {resend.error && <div className="notice" role="alert">{resend.error}</div>}
              <button className="primary" disabled={resend.busy || !supabase}>{resend.busy ? <><LoaderCircle size={17} className="spin" /> Sending…</> : <><Send size={16} /> Send a new link</>}</button>
            </form>
          )
        )}
        <Link className="reset-back" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
        <div className="security-note"><ShieldCheck size={17} />Links work once, and only open pages inside iPOS.</div>
      </section>
    </div>
  );
}

// /account/register/success — where a confirmed sign-up lands.
export function RegisterSuccess({ auth }) {
  const ready = auth.session && auth.membership;
  const working = auth.loading || (auth.session && !auth.membership && !auth.error);
  return (
    <div className="reset-page verify-page">
      <section className="reset-card">
        <Brand className="verify-brand" />
        <span className="small-icon verify-success-icon"><CheckCircle2 size={26} /></span>
        <h1>Email confirmed</h1>
        <p>{ready ? `Your workspace for ${auth.membership.companies.name} is ready.` : working ? 'Setting up your store workspace…' : auth.session ? 'Your email is confirmed.' : 'Your email is confirmed. Sign in to open your store workspace.'}</p>
        {auth.error && auth.session && !auth.membership && <div className="notice" role="alert">{auth.error}</div>}
        {ready ? (
          <>
            <ul className="verify-next">
              <li>Add your products, or scan their barcodes with your phone</li>
              <li>Invite your staff from Staff Accounts</li>
              <li>Open a shift and make your first sale</li>
            </ul>
            <Link className="primary verify-button" to="/dashboard">Open my store <ArrowRight size={17} /></Link>
          </>
        ) : working ? (
          <div className="loading"><LoaderCircle className="spin" /> Creating your company workspace…</div>
        ) : auth.session ? (
          <button className="primary verify-button" onClick={auth.refresh}>Try again</button>
        ) : (
          <Link className="primary verify-button" to="/login">Sign in <ArrowRight size={17} /></Link>
        )}
        <div className="security-note"><ShieldCheck size={17} />Your account is protected by email verification.</div>
      </section>
    </div>
  );
}
