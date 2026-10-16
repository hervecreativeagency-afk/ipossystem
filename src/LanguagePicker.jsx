import React, { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { supabase } from './supabase';
import { LANGUAGES, t, getLanguage, setLanguage, subscribeLanguage, rememberLanguage } from './i18n';

const readLocal = key => { try { return localStorage.getItem(key); } catch { return null; } };

/** Applies the signed-in person's language and re-renders when it changes. */
export function useLanguage(session) {
  const [lang, setLang] = useState(getLanguage());
  useEffect(() => subscribeLanguage(setLang), []);
  const uid = session?.user?.id;
  useEffect(() => {
    if (!uid) return;
    // This device's choice first (works offline), then the choice saved on their account, then this device's last choice.
    setLanguage(readLocal('ipos.lang.' + uid) || session.user.user_metadata?.language || readLocal('ipos.lang.device') || 'en');
  }, [uid]);
  return lang;
}

export function LanguagePicker({ session, compact = false }) {
  const [lang, setLang] = useState(getLanguage());
  useEffect(() => subscribeLanguage(setLang), []);
  function choose(code) {
    setLanguage(code);
    rememberLanguage(session?.user?.id, code);
    if (session?.user && navigator.onLine !== false) supabase.auth.updateUser({ data: { language: code } }).catch(() => {});
  }
  const select = (
    <select value={lang} aria-label={t('Language')} onChange={e => choose(e.target.value)}>
      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  );
  if (compact) return <label className="language-chip" title={t('Language')}><Languages size={14} />{select}</label>;
  return <label className="language-field">{t('Language')}{select}<small>{t('Language for these screens. Receipts stay in English.')}</small></label>;
}
