// Pure helpers for camera barcode scanning (no browser APIs, unit tested).

// Formats a retail shop meets: product barcodes, shelf/stock codes and QR codes.
export const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix'];

export const cleanCode = code => String(code ?? '').replace(/[\s\u0000-\u001f]/g, '');

// The same printed product code can be read as UPC-A (12 digits) or EAN-13
// (13 digits starting with 0) depending on the phone. Treat them as one.
export function codeVariants(code) {
  const c = cleanCode(code);
  const out = new Set([c, c.toLowerCase()]);
  if (/^\d{13}$/.test(c) && c[0] === '0') out.add(c.slice(1));
  if (/^\d{12}$/.test(c)) out.add('0' + c);
  return out;
}

export function findProductByCode(products, code) {
  const wanted = codeVariants(code);
  if (!cleanCode(code)) return null;
  return products.find(p => {
    const b = cleanCode(p.barcode), s = cleanCode(p.sku).toLowerCase();
    return (b && [...codeVariants(b)].some(v => wanted.has(v))) || (s && wanted.has(s));
  }) || null;
}

// RGBA pixels -> one brightness byte per pixel (what the decoder reads).
export function toLuminance(rgba, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return out;
}

// Stops the same barcode being added many times while it stays in view.
export function makeRepeatGuard(ms = 1500) {
  let last = '', at = -Infinity;
  return (code, now = Date.now()) => {
    if (code === last && now - at < ms) { at = now; return false; }
    last = code; at = now; return true;
  };
}

// Plain-language reasons the camera could not start.
export function cameraErrorMessage(e) {
  const name = e?.name || '';
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'The camera only works on a secure (https) page.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is being used by another app. Close it and try again.';
  if (name === 'NoCameraApi' || name === 'NotSupportedError' || name === 'TypeError') return 'This browser cannot use the camera. Open iPOS in Chrome or Safari, or type the barcode in the search box.';
  return 'The camera could not start. Please try again, or type the barcode in the search box.';
}
