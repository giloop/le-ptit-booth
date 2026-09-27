// Lays out the printed ticket: the cut-out photo, then the banner.
//
// The photo is dithered (it is continuous tone), the banner is thresholded
// (text must stay crisp). Both are merged into one 1-bit bitmap, 384 dots wide.

import { encodeBlackPixels } from '../vendor/pocketprinter5890/protocol/raster.js';

export const PRINT_WIDTH = 384;
const PHOTO_HEIGHT = 512;
const SIDE_MARGIN = 12;
const SIGNATURE = 'by Giloop';
const SERIF = 'Georgia, "Noto Serif", "Times New Roman", serif';
const SANS = 'Roboto, "Helvetica Neue", Arial, sans-serif';

const INK = [28, 26, 24];
const PAPER = [251, 250, 246];

/**
 * @param {HTMLCanvasElement} cutout  RGBA photo, transparent background, 3:4.
 * @param {object} settings
 * @returns {{ bitmap: import('../vendor/pocketprinter5890/protocol/raster.js').MonochromeBitmap, preview: HTMLCanvasElement, foreground: number }}
 *   `foreground` is the share of the photo detected as people, 0 to 1.
 */
export function composeTicket(cutout, settings, date = new Date()) {
  const gray = photoGray(cutout, settings);
  const photo = ditherPhoto(gray, settings.dither);
  const banner = renderBanner(settings, date);

  const height = photo.height + banner.height;
  const pixels = new Array(PRINT_WIDTH * height);
  photo.pixels.forEach((v, i) => { pixels[i] = v; });
  const offset = photo.pixels.length;
  banner.pixels.forEach((v, i) => { pixels[offset + i] = v; });

  return {
    bitmap: encodeBlackPixels(pixels, PRINT_WIDTH, height),
    preview: renderPreview(pixels, height),
    foreground: gray.foreground,
  };
}

// --- Photo

function photoGray(cutout, { brightness, contrast }) {
  const canvas = document.createElement('canvas');
  canvas.width = PRINT_WIDTH;
  canvas.height = PHOTO_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cutout, 0, 0, PRINT_WIDTH, PHOTO_HEIGHT);
  const { data } = ctx.getImageData(0, 0, PRINT_WIDTH, PHOTO_HEIGHT);

  const count = PRINT_WIDTH * PHOTO_HEIGHT;
  const luma = new Float32Array(count);
  const alpha = new Float32Array(count);
  const histogram = new Uint32Array(256);
  let foreground = 0;

  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const l = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    luma[i] = l;
    alpha[i] = data[o + 3] / 255;
    if (data[o + 3] > 200) {
      histogram[Math.round(l)] += 1;
      foreground += 1;
    }
  }

  // Auto-levels on the people only: the white background must not skew it.
  let lo = 0;
  let hi = 255;
  if (foreground > count * 0.02) {
    lo = percentile(histogram, foreground, 0.01);
    hi = percentile(histogram, foreground, 0.99);
    if (hi - lo < 40) { lo = 0; hi = 255; }
  }

  const c = contrast / 100;
  const b = brightness / 100;
  const gray = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    let v = (luma[i] - lo) / (hi - lo);
    v = (v - 0.5) * (1 + c) + 0.5 + b * 0.5;
    v = Math.min(1, Math.max(0, v));
    // Thermal dots spread: lift the mid-tones so faces don't turn to mud.
    v = Math.pow(v, 0.8);
    gray[i] = 255 * (v * alpha[i] + (1 - alpha[i]));
  }

  return {
    gray: sharpen(gray, PRINT_WIDTH, PHOTO_HEIGHT, 0.7),
    width: PRINT_WIDTH,
    height: PHOTO_HEIGHT,
    foreground: foreground / count,
  };
}

function percentile(histogram, total, fraction) {
  const target = total * fraction;
  let sum = 0;
  for (let v = 0; v < 256; v += 1) {
    sum += histogram[v];
    if (sum >= target) return v;
  }
  return 255;
}

/** Unsharp mask with a 3x3 box blur: dithering loves a bit of edge. */
function sharpen(gray, width, height, amount) {
  const out = new Float32Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += gray[yy * width + xx];
          n += 1;
        }
      }
      const i = y * width + x;
      out[i] = gray[i] + amount * (gray[i] - sum / n);
    }
  }
  return out;
}

function ditherPhoto({ gray, width, height }, mode) {
  const buffer = Float32Array.from(gray);
  const pixels = new Array(width * height);
  // [dx, dy, weight]
  const kernel = mode === 'floyd'
    ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
    // Atkinson spreads only 3/4 of the error: higher contrast, cleaner whites.
    : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const old = buffer[i];
      const black = old < 128;
      pixels[i] = black;
      const error = old - (black ? 0 : 255);
      for (const [dx, dy, w] of kernel) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < width && yy < height) buffer[yy * width + xx] += error * w;
      }
    }
  }

  return trimTop({ pixels, width, height });
}

/** Removes empty paper above the heads, keeping a small margin. */
function trimTop({ pixels, width, height }) {
  const margin = 8;
  let first = 0;
  search: for (; first < height; first += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[first * width + x]) break search;
    }
  }
  const cut = Math.max(0, Math.min(first - margin, height - 1));
  if (cut === 0) return { pixels, width, height };
  return { pixels: pixels.slice(cut * width), width, height: height - cut };
}

// --- Banner

function renderBanner({ title, subtitle, showDate }, date) {
  const width = PRINT_WIDTH;
  const maxText = width - SIDE_MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 400;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  let y = 18;
  const cx = width / 2;

  // Ornament: ——— ◆ ———
  y += 6;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 90, y); ctx.lineTo(cx - 14, y);
  ctx.moveTo(cx + 14, y); ctx.lineTo(cx + 90, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, y - 6); ctx.lineTo(cx + 6, y); ctx.lineTo(cx, y + 6); ctx.lineTo(cx - 6, y);
  ctx.closePath();
  ctx.fill();
  y += 14;

  const cleanTitle = (title || '').trim();
  if (cleanTitle) {
    const { lines, size } = fitText(ctx, cleanTitle, maxText, (s) => `italic 600 ${s}px ${SERIF}`, 44, 26, 2);
    ctx.font = `italic 600 ${size}px ${SERIF}`;
    for (const line of lines) {
      y += size;
      ctx.fillText(line, cx, y);
      y += Math.round(size * 0.15);
    }
    y += 4;
  }

  const cleanSubtitle = (subtitle || '').trim();
  if (cleanSubtitle) {
    const size = 22;
    ctx.font = `500 ${size}px ${SANS}`;
    for (const line of wrap(ctx, cleanSubtitle, maxText).slice(0, 3)) {
      y += size + 4;
      ctx.fillText(line, cx, y);
    }
    y += 6;
  }

  if (showDate) {
    const size = 17;
    ctx.font = `600 ${size}px ${SANS}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    const text = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    y += size + 8;
    ctx.fillText(text, cx, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  // Signature, small and right-aligned.
  const signatureSize = 15;
  ctx.font = `italic 500 ${signatureSize}px ${SERIF}`;
  ctx.textAlign = 'right';
  y += signatureSize + 10;
  ctx.fillText(SIGNATURE, width - SIDE_MARGIN, y);
  ctx.textAlign = 'center';

  y += 10;
  const height = Math.min(canvas.height, y);
  const { data } = ctx.getImageData(0, 0, width, height);
  const pixels = new Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    // Slightly generous threshold: thin serif strokes survive.
    pixels[i] = data[i * 4] < 150;
  }
  return { pixels, width, height };
}

/** Shrinks the font until the text fits, then wraps if it still doesn't. */
function fitText(ctx, text, maxWidth, font, maxSize, minSize, maxLines) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = font(size);
    if (ctx.measureText(text).width <= maxWidth) return { lines: [text], size };
  }
  for (let size = maxSize - 8; size >= 18; size -= 2) {
    ctx.font = font(size);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { lines, size };
    }
  }
  ctx.font = font(18);
  return { lines: wrap(ctx, text, maxWidth).slice(0, maxLines), size: 18 };
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// --- On-screen preview

function renderPreview(pixels, height) {
  const canvas = document.createElement('canvas');
  canvas.width = PRINT_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(PRINT_WIDTH, height);
  for (let i = 0; i < pixels.length; i += 1) {
    const [r, g, b] = pixels[i] ? INK : PAPER;
    const o = i * 4;
    image.data[o] = r;
    image.data[o + 1] = g;
    image.data[o + 2] = b;
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
