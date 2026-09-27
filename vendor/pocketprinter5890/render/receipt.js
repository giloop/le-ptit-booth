/**
 * Receipt rendering on a canvas.
 *
 * The web counterpart of the CoreGraphics renderer in the Swift library.
 * Only the raster encoding is shared between the two; the drawing itself is
 * necessarily platform-specific.
 *
 * Going through an image rather than the printer's text mode sidesteps the
 * firmware's ASCII-only font: accents, symbols and any web font print fine.
 */
import { MonochromeBitmap, PrinterWidth } from '../protocol/raster.js';
import { bitmapFromCanvas, DitherMode } from './canvas.js';
/** Sample receipt, matching the one in the Swift library. */
export const sampleReceipt = {
    merchantName: 'LIDL TEST',
    address: 'Ticket 58 mm - 384 px',
    date: new Date(),
    items: [
        { name: 'Cafe', quantity: 1, unitPrice: 2.49 },
        { name: 'Pain', quantity: 2, unitPrice: 1.2 },
        { name: 'Remise', quantity: 1, unitPrice: -0.5 },
    ],
    footer: 'Merci',
};
export function receiptTotal(receipt) {
    return receipt.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}
/** Draws a receipt on a canvas, returning it for preview or printing. */
export function drawReceipt(receipt, options = {}) {
    const width = options.printWidth ?? PrinterWidth.MM58;
    const height = 90 + receipt.items.length * 22 + 80;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context)
        throw new Error('Could not obtain a 2D context');
    const locale = options.locale ?? 'fr-FR';
    const currency = options.currency ?? 'EUR';
    const money = (value) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
    context.fillStyle = 'white';
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'black';
    context.strokeStyle = 'black';
    context.lineWidth = 1;
    context.textBaseline = 'top';
    const margin = 8;
    const right = width - margin;
    let y = 10;
    const centered = (text, size, bold = false) => {
        context.font = `${bold ? 'bold ' : ''}${size}px ui-monospace, Menlo, monospace`;
        const measured = context.measureText(text).width;
        context.fillText(text, (width - measured) / 2, y);
    };
    const left = (text, size, bold = false) => {
        context.font = `${bold ? 'bold ' : ''}${size}px ui-monospace, Menlo, monospace`;
        context.fillText(text, margin, y);
    };
    const rightAligned = (text, size, bold = false) => {
        context.font = `${bold ? 'bold ' : ''}${size}px ui-monospace, Menlo, monospace`;
        const measured = context.measureText(text).width;
        context.fillText(text, right - measured, y);
    };
    const rule = () => {
        context.beginPath();
        context.moveTo(margin, y);
        context.lineTo(right, y);
        context.stroke();
    };
    centered(receipt.merchantName.toUpperCase(), 22, true);
    y += 30;
    centered(receipt.address, 12);
    y += 18;
    centered(receipt.date.toLocaleString(locale), 12);
    y += 22;
    rule();
    y += 10;
    for (const item of receipt.items) {
        left(`${item.quantity}x ${item.name}`, 13);
        rightAligned(money(item.unitPrice * item.quantity), 13);
        y += 20;
    }
    y += 4;
    rule();
    y += 10;
    left('TOTAL', 17, true);
    rightAligned(money(receiptTotal(receipt)), 17, true);
    y += 32;
    centered(receipt.footer, 13);
    return canvas;
}
/** Renders a receipt straight to a printable bitmap. */
export function renderReceipt(receipt, options = {}) {
    const canvas = drawReceipt(receipt, options);
    // A hard threshold keeps text crisp; error diffusion would blur it.
    //
    // The level is raised above the neutral 128: antialiased text has grey
    // edges that a lower threshold drops, which thins every stroke.
    return bitmapFromCanvas(canvas, {
        ...options,
        dither: options.dither ?? DitherMode.Threshold,
        level: options.level ?? 160,
    });
}
