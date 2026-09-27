/**
 * Assembles a document into the byte sequence sent to the printer.
 *
 * The activation sequence and the paper-mode distinction come from the
 * vendor SDK: see `docs/PROTOCOL_SPEC.md` sections 3 and 4.
 */
import * as cmd from './commands.js';
import * as escpos from './escpos.js';
import { Alignment } from './escpos.js';
import { PaperMode } from './document.js';
import { PrinterWidth, DEFAULT_BAND_HEIGHT, bandedRasterCommands } from './raster.js';
import { columnsFor, wrap } from './text-layout.js';
export const defaultOptions = {
    width: PrinterWidth.MM58,
    density: cmd.Density.Medium,
    paperMode: PaperMode.Continuous,
    labelLength: 32,
    bandHeight: DEFAULT_BAND_HEIGHT,
    trailingFeedDots: 80,
    sendInitialize: true,
    transliterate: true,
};
/** Builds the full job as named segments. */
export function buildSegments(document, options = {}) {
    const opts = { ...defaultOptions, ...options };
    const segments = [];
    const columns = columnsFor(opts.width, 1);
    // --- Activation. Without this nothing executes.
    segments.push({ name: 'enable', bytes: cmd.enablePrinter() });
    segments.push({ name: 'wake-up', bytes: cmd.WAKEUP });
    // `1F 80` declares a fixed length: on a roll it just wastes paper.
    if (opts.paperMode === PaperMode.Label) {
        segments.push({
            name: 'label length',
            bytes: cmd.setPaperType(1, opts.labelLength),
        });
    }
    if (opts.sendInitialize) {
        segments.push({ name: 'init', bytes: escpos.INIT });
    }
    segments.push({ name: 'density', bytes: cmd.setDensity(opts.density) });
    // --- Content
    for (const [index, element] of document.elements.entries()) {
        const bytes = elementBytes(element, columns, opts);
        if (bytes.length > 0) {
            segments.push({ name: `${element.type} ${index + 1}`, bytes });
        }
    }
    // --- Epilogue
    if (opts.trailingFeedDots > 0) {
        segments.push({
            name: `clearance ${opts.trailingFeedDots} dots`,
            bytes: escpos.feed(opts.trailingFeedDots),
        });
    }
    if (opts.paperMode === PaperMode.Label) {
        segments.push({ name: 'position', bytes: cmd.POSITION });
    }
    segments.push({ name: 'stop job', bytes: cmd.STOP_PRINT_JOB });
    return segments;
}
/** Builds the full job as a flat byte array. */
export function buildJob(document, options = {}) {
    return buildSegments(document, options).flatMap((segment) => segment.bytes);
}
function elementBytes(element, columns, opts) {
    switch (element.type) {
        case 'text': {
            const size = element.size ?? 1;
            const alignment = element.alignment ?? Alignment.Left;
            const output = [];
            output.push(...escpos.align(alignment));
            if (size !== 1)
                output.push(...escpos.textSize(size, size));
            if (element.bold)
                output.push(...escpos.bold(true));
            if (element.underline)
                output.push(...escpos.underline(1));
            if (element.inverted)
                output.push(...escpos.inverted(true));
            const value = opts.transliterate ? escpos.transliterate(element.value) : element.value;
            // A larger font fits proportionally fewer columns.
            for (const wrapped of wrap(value, Math.max(1, Math.floor(columns / size)))) {
                output.push(...escpos.line(wrapped));
            }
            // Reset every mode so the next element does not inherit formatting.
            if (element.inverted)
                output.push(...escpos.inverted(false));
            if (element.underline)
                output.push(...escpos.underline(0));
            if (element.bold)
                output.push(...escpos.bold(false));
            if (size !== 1)
                output.push(...escpos.textSize(1, 1));
            if (alignment !== Alignment.Left)
                output.push(...escpos.align(Alignment.Left));
            return output;
        }
        case 'image':
            return bandedRasterCommands(element.bitmap, opts.bandHeight).flat();
        case 'separator':
            return escpos.line((element.character ?? '-').repeat(columns));
        case 'feed':
            return escpos.feedLines(element.lines);
        case 'raw':
            return element.bytes;
    }
}
