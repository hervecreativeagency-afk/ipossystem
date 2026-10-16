// Pure helpers for background reports (unit tested).

/** Rough device, browser and system from the browser's user-agent text — no fingerprinting, just what the console shows. */
export function describeDevice(ua = '', touchPoints = 0) {
  const tablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/i.test(ua) && touchPoints > 1);
  const phone = !tablet && /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const device = tablet ? 'tablet' : phone ? 'phone' : 'desktop';
  const pick = (re, name) => { const m = ua.match(re); return m ? `${name} ${m[1].split('.')[0]}` : null; };
  const browser = pick(/EdgA?\/([\d.]+)/, 'Edge') || pick(/OPR\/([\d.]+)/, 'Opera') || pick(/SamsungBrowser\/([\d.]+)/, 'Samsung Internet')
    || pick(/(?:Chrome|CriOS)\/([\d.]+)/, 'Chrome') || pick(/(?:Firefox|FxiOS)\/([\d.]+)/, 'Firefox') || (/Safari/i.test(ua) && pick(/Version\/([\d.]+)/, 'Safari')) || 'Other';
  const os = pick(/Android ([\d.]+)/, 'Android') || (/(iPhone|iPad|iPod)/.test(ua) && (pick(/OS (\d+)[_\d]* like Mac/, 'iOS') || 'iOS'))
    || (/Windows NT 10/.test(ua) ? 'Windows 10/11' : /Windows/.test(ua) ? 'Windows' : null)
    || (/CrOS/.test(ua) ? 'ChromeOS' : null) || (/Mac OS X/.test(ua) ? (touchPoints > 1 ? 'iPadOS' : 'macOS') : null) || (/Linux/.test(ua) ? 'Linux' : 'Other');
  return { device, browser, os };
}

/** Page path without ids or query strings, e.g. /receipts/5f3e…  →  /receipts/:id */
export const cleanPage = path => String(path || '/').split(/[?#]/)[0].replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/\d{3,}/g, '/:n').slice(0, 200) || '/';

/** A short, stable description of an error. */
export function describeError(err, extra = '') {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : (() => { try { return JSON.stringify(err); } catch { return String(err); } })());
  const message = `${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message || 'Unknown error'}`.slice(0, 500);
  const detail = [String(e.stack || '').split('\n').slice(0, 12).join('\n'), extra].filter(Boolean).join('\n--\n').slice(0, 4000);
  return { message, detail };
}

/** Errors that are noise, not app crashes (browser extensions, aborted fetches, ResizeObserver chatter). */
export const ignoredError = message => /ResizeObserver loop|Script error\.?$|AbortError|chrome-extension:|moz-extension:|Load failed$|NetworkError when attempting to fetch|Failed to fetch$/i.test(String(message || ''));
