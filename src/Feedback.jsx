import React, { useState } from 'react';
import { MessageSquare, X, LoaderCircle, Send } from 'lucide-react';
import { supabase } from './supabase';
import { toast } from './Toast';
import { describeDevice, cleanPage } from './telemetry-utils';

const FACES = [[3, '😊', 'Happy'], [2, '😐', 'Okay'], [1, '☹️', 'Unhappy']];

/** Sidebar button + small form. Feedback goes to the iPOS creator, not to the shop. */
export function FeedbackButton({ auth }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="theme-button" onClick={() => setOpen(true)}><MessageSquare size={14} /> Feedback</button>
      {open && <FeedbackForm auth={auth} onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackForm({ auth, onClose }) {
  const [rating, setRating] = useState(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function send(e) {
    e.preventDefault(); setError('');
    if (message.trim().length < 2) { setError('Write a short message first.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('submit_feedback', {
        p_company_id: auth.membership?.company_id || null, p_page: cleanPage(location.pathname), p_rating: rating,
        p_message: message.trim(), p_device: describeDevice(navigator.userAgent, navigator.maxTouchPoints || 0).device,
      });
      if (error) throw error;
      toast('Thanks — your feedback was sent to the iPOS team.');
      onClose();
    } catch (err) { setError(err?.message || 'Could not send. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal feedback-modal" onSubmit={send} aria-label="Send feedback">
        <div className="modal-head"><h2><MessageSquare size={19} /> Send feedback</h2><button type="button" aria-label="Close" onClick={onClose}><X /></button></div>
        <p className="muted">Tell the iPOS team what works, what's confusing, or what you'd like added. Your shop owner doesn't see this.</p>
        <div className="feedback-faces" role="radiogroup" aria-label="How is iPOS working for you?">
          {FACES.map(([v, face, label]) => (
            <button key={v} type="button" role="radio" aria-checked={rating === v} className={rating === v ? 'active' : ''} onClick={() => setRating(rating === v ? null : v)}>
              <span aria-hidden="true">{face}</span>{label}
            </button>
          ))}
        </div>
        <label>Your message<textarea required rows={5} maxLength={2000} value={message} placeholder="e.g. It would help if receipts showed…" onChange={e => setMessage(e.target.value)} /></label>
        {error && <div className="notice" role="alert">{error}</div>}
        <small className="muted">We also see which page you were on and your type of device.</small>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" /> Sending…</> : <><Send size={16} /> Send</>}</button>
        </div>
      </form>
    </div>
  );
}
