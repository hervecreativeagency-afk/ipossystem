// Fallback decoder for phones without a built-in barcode detector (iPhone,
// Firefox, older Android). Loaded only when the scanner opens.
import { MultiFormatReader, DecodeHintType, BarcodeFormat, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } from '@zxing/library';

const FORMAT = {
  ean_13: BarcodeFormat.EAN_13, ean_8: BarcodeFormat.EAN_8, upc_a: BarcodeFormat.UPC_A, upc_e: BarcodeFormat.UPC_E,
  code_128: BarcodeFormat.CODE_128, code_39: BarcodeFormat.CODE_39, code_93: BarcodeFormat.CODE_93, itf: BarcodeFormat.ITF,
  codabar: BarcodeFormat.CODABAR, qr_code: BarcodeFormat.QR_CODE, data_matrix: BarcodeFormat.DATA_MATRIX,
};

export function createLuminanceDecoder(formats) {
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats.map(f => FORMAT[f]).filter(f => f !== undefined));
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  // Returns the decoded text, or null when no barcode is found in this frame.
  return (luminance, width, height) => {
    try {
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, width, height)));
      return reader.decodeWithState(bitmap).getText();
    } catch {
      return null;
    } finally {
      reader.reset();
    }
  };
}
