// Light / dark appearance. The choice is per device: 'light', 'dark' or 'system' (match the device setting).
const KEY = 'ipos.theme';
const listeners = new Set();
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match this device']];
export const getThemeChoice = () => (['light', 'dark', 'system'].includes(read()) ? read() : 'light');
export const resolveTheme = (choice = getThemeChoice(), prefersDark = Boolean(media?.matches)) => choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;

export function applyTheme() {
  if (typeof document === 'undefined') return;
  const theme = resolveTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121a16' : '#113e32');
  listeners.forEach(fn => fn(theme));
}

export function setThemeChoice(choice) {
  try { localStorage.setItem(KEY, choice); } catch { /* storage unavailable: applies for this visit only */ }
  applyTheme();
}

export function subscribeTheme(fn) { listeners.add(fn); return () => listeners.delete(fn); }

media?.addEventListener?.('change', () => { if (getThemeChoice() === 'system') applyTheme(); });
applyTheme();
