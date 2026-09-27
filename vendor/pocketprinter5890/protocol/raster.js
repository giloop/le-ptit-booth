/**
 * Raster encoding: `GS v 0`.
 *
 * See `docs/PROTOCOL_SPEC.md` section 5.
 */
/** Supported print widths, in dots. */
export var PrinterWidth;
(function (PrinterWidth) {
    /** 58 mm paper, 48 mm printable. Default for the 5890 family. */
    PrinterWidth[PrinterWidth["MM58"] = 384] = "MM58";
    /** 80 mm paper. */
    PrinterWidth[PrinterWidth["MM80"] = 576] = "MM80";
    /** 14 mm labels. Compatibility only — a different printer family. */
    PrinterWidth[PrinterWidth["Label14mm"] = 96] = "Label14mm";
})(PrinterWidth || (PrinterWidth = {}));
/** Lines per raster band. */
export const DEFAULT_BAND_HEIGHT = 24;
/** A 1-bit-per-pixel monochrome image, MSB first, set bit = black dot. */
export class MonochromeBitmap {
    width;
    height;
    bytes;
    widthBytes;
    constructor(width, height, bytes) {
        this.width = width;
        this.height = height;
        this.bytes = bytes;
        if (width <= 0 || height <= 0)
            throw new Error('Invalid bitmap dimensions');
        if (width % 8 !== 0)
            throw new Error(`Width ${width} is not a multiple of 8`);
        this.widthBytes = width / 8;
        const expected = this.widthBytes * height;
        if (bytes.length !== expected) {
            throw new Error(`Expected ${expected} bytes, got ${bytes.length}`);
        }
    }
    /** Extracts a horizontal band, used for banded transmission. */
    slice(fromLine, lineCount) {
        if (fromLine < 0 || lineCount <= 0 || fromLine + lineCount > this.height) {
            throw new Error('Slice out of bounds');
        }
        const start = fromLine * this.widthBytes;
        const end = (fromLine + lineCount) * this.widthBytes;
        return new MonochromeBitmap(this.width, lineCount, this.bytes.slice(start, end));
    }
}
/** Packs a boolean pixel array into a monochrome bitmap. */
export function encodeBlackPixels(pixels, width, height) {
    if (width % 8 !== 0)
        throw new Error(`Width ${width} is not a multiple of 8`);
    if (pixels.length !== width * height) {
        throw new Error(`Expected ${width * height} pixels, got ${pixels.length}`);
    }
    const widthBytes = width / 8;
    const bytes = new Uint8Array(widthBytes * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (pixels[y * width + x]) {
                bytes[y * widthBytes + (x >> 3)] |= 0x80 >> (x % 8);
            }
        }
    }
    return new MonochromeBitmap(width, height, bytes);
}
/** Single `GS v 0` command. Prefer {@link bandedRasterCommands}. */
export function rasterCommand(bitmap) {
    const x = bitmap.widthBytes;
    const y = bitmap.height;
    return [
        0x1d, 0x76, 0x30, 0x00,
        x & 0xff, (x >> 8) & 0xff,
        y & 0xff, (y >> 8) & 0xff,
        ...bitmap.bytes,
    ];
}
/**
 * Splits a bitmap into bands, each a complete raster command.
 *
 * A raster sent as one large command is dropped by the firmware.
 */
export function bandedRasterCommands(bitmap, bandHeight = DEFAULT_BAND_HEIGHT) {
    const height = Math.max(1, bandHeight);
    const commands = [];
    for (let line = 0; line < bitmap.height; line += height) {
        const count = Math.min(height, bitmap.height - line);
        commands.push(rasterCommand(bitmap.slice(line, count)));
    }
    return commands;
}
// --- Grayscale to monochrome ---
/** Hard threshold. Use this for barcodes and QR codes. */
export function threshold(gray, width, height, level = 128) {
    const pixels = new Array(width * height);
    for (let i = 0; i < gray.length; i += 1)
        pixels[i] = gray[i] < level;
    return encodeBlackPixels(pixels, width, height);
}
/** Ordered 4x4 dithering. */
export function orderedDither(gray, width, height) {
    const matrix = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5],
    ];
    const pixels = new Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const limit = matrix[y % 4][x % 4] * 16 + 8;
            pixels[y * width + x] = gray[y * width + x] < limit;
        }
    }
    return encodeBlackPixels(pixels, width, height);
}
/** Floyd-Steinberg error diffusion. Best for photographs. */
export function floydSteinberg(gray, width, height) {
    const buffer = Int16Array.from(gray);
    const pixels = new Array(width * height);
    const spread = (x, y, error, factor) => {
        if (x < 0 || x >= width || y < 0 || y >= height)
            return;
        buffer[y * width + x] = buffer[y * width + x] + ((error * factor) / 16);
    };
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const old = buffer[index];
            const next = old < 128 ? 0 : 255;
            pixels[index] = next === 0;
            const error = old - next;
            spread(x + 1, y, error, 7);
            spread(x - 1, y + 1, error, 3);
            spread(x, y + 1, error, 5);
            spread(x + 1, y + 1, error, 1);
        }
    }
    return encodeBlackPixels(pixels, width, height);
}
