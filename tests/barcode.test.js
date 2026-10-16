import test from 'node:test';
import assert from 'node:assert/strict';
import { findProductByCode, codeVariants, toLuminance, makeRepeatGuard, cleanCode, SCAN_FORMATS } from '../src/barcode-utils.js';
import { createLuminanceDecoder } from '../src/zxing-decoder.js';
import { QRCodeWriter, BarcodeFormat } from '@zxing/library';

// ---- Draw an EAN-13 from the official bar patterns (independent of the decoder) ----
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const R = L.map(p => [...p].map(b => (b === '1' ? '0' : '1')).join(''));
const G = R.map(p => [...p].reverse().join(''));
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function ean13(digits12) {
  const d = [...digits12].map(Number);
  const sum = d.reduce((n, x, i) => n + x * (i % 2 ? 3 : 1), 0);
  d.push((10 - (sum % 10)) % 10);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return { code: d.join(''), bits: bits + '101' };
}
// Render like a slightly blurry, noisy phone camera frame.
function frame(bits, { module = 3, W = 480, H = 220 } = {}) {
  const img = new Uint8ClampedArray(W * H).fill(215);
  const x0 = Math.floor((W - bits.length * module) / 2), y0 = 50, h = 120;
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1')
    for (let y = y0; y < y0 + h; y++) for (let x = 0; x < module; x++) img[y * W + x0 + i * module + x] = 35;
  const out = new Uint8ClampedArray(W * H);
  let seed = 7;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) { s += img[y * W + xx]; n++; } }
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[y * W + x] = s / n + ((seed % 31) - 15);
  }
  return { lum: out, W, H };
}

test('decodes an EAN-13 product barcode from a noisy camera-like frame', () => {
  const decode = createLuminanceDecoder(SCAN_FORMATS);
  const { code, bits } = ean13('600988012345');
  const { lum, W, H } = frame(bits);
  assert.equal(decode(lum, W, H), code);
});

test('a UPC-A product (EAN-13 starting with 0) is found whichever way it is read', () => {
  const decode = createLuminanceDecoder(SCAN_FORMATS);
  const { code, bits } = ean13('012345678905');
  const { lum, W, H } = frame(bits);
  const read = decode(lum, W, H);
  assert.ok(read === code || read === code.slice(1), read);
  const products = [{ id: 'a', name: 'Cereal', sku: 'CER-1', barcode: code.slice(1) }];
  assert.equal(findProductByCode(products, read)?.id, 'a');
  assert.equal(findProductByCode([{ ...products[0], barcode: code }], read)?.id, 'a');
});

test('decodes a QR code', () => {
  const matrix = new QRCodeWriter().encode('IPOS-SKU-0042', BarcodeFormat.QR_CODE, 200, 200, new Map());
  const W = matrix.getWidth(), H = matrix.getHeight(), lum = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lum[y * W + x] = matrix.get(x, y) ? 20 : 235;
  assert.equal(createLuminanceDecoder(SCAN_FORMATS)(lum, W, H), 'IPOS-SKU-0042');
});

test('returns null when there is no barcode in view', () => {
  assert.equal(createLuminanceDecoder(SCAN_FORMATS)(new Uint8ClampedArray(320 * 200).fill(128), 320, 200), null);
});

test('finds products by barcode or SKU, ignoring spaces and SKU case', () => {
  const products = [
    { id: 1, name: 'Milk', sku: 'MLK-1', barcode: '6009880123452' },
    { id: 2, name: 'Bread', sku: 'brd-7', barcode: '' },
    { id: 3, name: 'Sugar', sku: 'SUG', barcode: null },
  ];
  assert.equal(findProductByCode(products, ' 6009880123452\n')?.id, 1);
  assert.equal(findProductByCode(products, 'BRD-7')?.id, 2);
  assert.equal(findProductByCode(products, 'mlk-1')?.id, 1);
  assert.equal(findProductByCode(products, '0000000000000'), null);
  assert.equal(findProductByCode(products, ''), null);
});

test('code variants link UPC-A and EAN-13 forms', () => {
  assert.ok(codeVariants('012345678905').has('0012345678905'));
  assert.ok(codeVariants('0123456789050').has('123456789050'));
  assert.equal(cleanCode(' 12 34\t'), '1234');
});

test('luminance conversion matches perceived brightness', () => {
  const lum = toLuminance(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]), 3, 1);
  assert.deepEqual([...lum], [255, 0, 76]);
});

test('repeat guard ignores the same code held in view, but allows a new one', () => {
  const ok = makeRepeatGuard(1500);
  assert.equal(ok('A', 0), true);
  assert.equal(ok('A', 500), false);
  assert.equal(ok('A', 1900), false); // still in view: timer keeps resetting
  assert.equal(ok('B', 2000), true);
  assert.equal(ok('A', 2100), true);
  assert.equal(ok('A', 4000), true);
});

test('camera problems are explained in plain words', async () => {
  const { cameraErrorMessage } = await import('../src/barcode-utils.js');
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /Allow the camera/);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /No camera/);
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /another app/);
  assert.match(cameraErrorMessage({ name: 'NotSupportedError', message: 'Not supported' }), /Chrome or Safari/);
  assert.doesNotMatch(cameraErrorMessage({ name: 'Weird', message: 'internal xyz' }), /xyz/);
});
