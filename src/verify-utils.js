// Reads iPOS email links, modelled on the MongoDB pattern:
//   /account/email/verify?token_hash=…&type=signup&n=%2Faccount%2Fregister%2Fsuccess&username=you%40store.com
// token_hash  one-time secret from the email (proves the link came from the inbox)
// type        what the link confirms: signup, invite, recovery, email_change, magiclink
// n           where to go after confirming (an iPOS page, never another website)
// username    the email address being confirmed (shown on the page)

export const LINK_TYPES = ['signup', 'invite', 'recovery', 'email_change', 'magiclink', 'email'];

const DEFAULT_NEXT = {
  signup: '/account/register/success',
  email: '/account/register/success',
  magiclink: '/dashboard',
  email_change: '/profile',
  invite: '/reset-password',
  recovery: '/reset-password',
};

// Only allow paths inside iPOS, so a tampered link cannot send people elsewhere.
export function safeNext(value, type = 'signup') {
  const fallback = DEFAULT_NEXT[type] || '/dashboard';
  if (typeof value !== 'string' || !value) return fallback;
  let path = value;
  try { path = decodeURIComponent(value); } catch { return fallback; }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\u0000-\u001f]/.test(path)) return fallback;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return fallback;
  return path;
}

export function readVerifyLink(search = '', hash = '') {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(String(hash).replace(/^#/, ''));
  const rawType = (q.get('type') || 'signup').toLowerCase();
  const type = LINK_TYPES.includes(rawType) ? rawType : 'signup';
  // Email addresses with "+" arrive as a space when the email app does not encode them.
  const username = (q.get('username') || q.get('email') || '').trim().replace(/ /g, '+');
  return {
    tokenHash: q.get('token_hash') || '',
    code: q.get('code') || '',
    type,
    next: safeNext(q.get('n') || q.get('next') || '', type),
    username,
    error: q.get('error_description') || h.get('error_description') || '',
    errorCode: q.get('error_code') || h.get('error_code') || '',
  };
}

// Turns Supabase's verification errors into plain words.
export function verifyErrorMessage(e) {
  const text = String(e?.message || e || '').toLowerCase();
  const code = String(e?.code || '').toLowerCase();
  if (code === 'otp_expired' || /expired|invalid|not found|already been used|has expired/.test(text)) return 'This link has expired or was already used. Send yourself a new one below.';
  if (/rate limit|too many/.test(text)) return 'Too many attempts. Please wait a minute and try again.';
  if (/fetch|network/.test(text)) return 'No internet connection. Connect and try again.';
  return 'We could not confirm this link. Send yourself a new one below.';
}

// Builds the link the email template creates, for testing and documentation.
export function buildVerifyLink(origin, { tokenHash, type = 'signup', next, username }) {
  const q = new URLSearchParams({ token_hash: tokenHash, type, n: next || DEFAULT_NEXT[type] || '/dashboard' });
  if (username) q.set('username', username);
  return `${origin}/account/email/verify?${q}`;
}
