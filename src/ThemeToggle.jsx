import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { THEMES, getThemeChoice, setThemeChoice, resolveTheme, subscribeTheme } from './theme';
import { t } from './i18n';

function useTheme() {
  const [, render] = useState(0);
  useEffect(() => subscribeTheme(() => render(n => n + 1)), []);
  return { choice: getThemeChoice(), theme: resolveTheme() };
}

/** Sidebar button: switch between light and dark. */
export function ThemeButton() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return (
    <button type="button" className="theme-button" aria-label={dark ? t('Light mode') : t('Dark mode')} title={dark ? t('Light mode') : t('Dark mode')} onClick={() => setThemeChoice(dark ? 'light' : 'dark')}>
      {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? t('Light') : t('Dark')}
    </button>
  );
}

/** My Profile: light, dark or match the device. */
export function ThemeField() {
  const { choice } = useTheme();
  return (
    <label className="language-field">{t('Appearance')}
      <select value={choice} onChange={e => setThemeChoice(e.target.value)}>
        {THEMES.map(([v, label]) => <option key={v} value={v}>{t(label)}</option>)}
      </select>
      <small>{t('Saved on this device. Receipts always print on white.')}</small>
    </label>
  );
}
