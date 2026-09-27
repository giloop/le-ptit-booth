/**
 * PocketPrinter5890 — drive the Lidl Tronic/SILVERCREST 5890 thermal pocket
 * printer over Bluetooth, from a browser or from Capacitor.
 *
 * Protocol documented in `docs/PROTOCOL_SPEC.md`.
 */
// Main entry point
export { PocketPrinter } from './printer.js';
// Documents
export { PrintDocument, PaperMode } from './protocol/document.js';
export { buildJob, buildSegments, defaultOptions, } from './protocol/job.js';
// Protocol
export * as commands from './protocol/commands.js';
export { Density, PrinterStatus } from './protocol/commands.js';
export * as escpos from './protocol/escpos.js';
export { Alignment, transliterate } from './protocol/escpos.js';
export { CreditFlowController } from './protocol/flow-control.js';
export { decode, toHex } from './protocol/responses.js';
export { MonochromeBitmap, PrinterWidth, encodeBlackPixels, rasterCommand, bandedRasterCommands, threshold, orderedDither, floydSteinberg, } from './protocol/raster.js';
export { columnsFor, wrap, columns } from './protocol/text-layout.js';
// Demonstration documents
export { weatherAndHoroscope, typographySampler, testPattern, codePageProbe } from './demos.js';
// Rendering
export { renderQR, renderBarcode, Symbology, } from './render/codes.js';
export { barcodePattern, eanCheckDigit } from './render/barcode.js';
export { drawReceipt, renderReceipt, receiptTotal, sampleReceipt, } from './render/receipt.js';
// Composition d'un ticket en texte natif: l'alternative au rendu image,
// sans dependance au DOM.
export { ReceiptPrintMode, receiptPrintModeTitle, receiptPrintModeDetail, buildReceiptDocument, previewReceiptText, } from './protocol/receipt-document.js';
export { bitmapFromCanvas, bitmapFromImage, bitmapToCanvas, DitherMode, } from './render/canvas.js';
export { WebBluetoothTransport } from './transport/web-bluetooth.js';
export { CapacitorTransport } from './transport/capacitor.js';
