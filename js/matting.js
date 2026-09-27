// Background removal with MediaPipe's selfie segmenters, running fully in the
// browser from local files.

import { ImageSegmenter } from '../vendor/mediapipe/vision_bundle.esm.js';

const WASM_FILES = {
  wasmLoaderPath: new URL('../vendor/mediapipe/wasm/vision_wasm_internal.js', import.meta.url).href,
  wasmBinaryPath: new URL('../vendor/mediapipe/wasm/vision_wasm_internal.wasm', import.meta.url).href,
};

// `mask` is the index of the confidence mask to use; `isPerson` tells whether
// it holds the person (true) or the background (false).
export const MODELS = {
  // 250 KB, one mask: person confidence.
  selfie: {
    url: new URL('../models/mediapipe/selfie_segmenter.tflite', import.meta.url).href,
    mask: 0,
    isPerson: true,
  },
  // 16 MB, six masks: background, hair, body skin, face skin, clothes, others.
  // Everything but the background is kept, so hair is kept with its own class.
  multiclass: {
    url: new URL('../models/mediapipe/selfie_multiclass_256x256.tflite', import.meta.url).href,
    mask: 0,
    isPerson: false,
  },
};

// The model's confidence is soft around the edges; this range is remapped to
// 0..1 so the halo around people shrinks without hard jagged edges.
const EDGE_LOW = 0.3;
const EDGE_HIGH = 0.7;

let segmenter = null;
let loaded = null; // { name, backend, model }
// Once the GPU has failed on this device, don't try it again: a failed
// attempt costs time and memory, which phones are short of.
let gpuFailed = false;

/**
 * Loads the model `name` (a key of MODELS), replacing the current one.
 * `onProgress(fraction)` receives the model download progress, 0 to 1.
 *
 * Tries the GPU (WebGL) delegate first, then falls back to CPU.
 */
export async function loadModel(name, onProgress = () => {}) {
  if (!(name in MODELS)) name = 'selfie';
  if (loaded?.name === name) return loaded.backend;

  // Free the current model first, so that two never share the phone's memory.
  closeSegmenter();
  const model = await fetchWithProgress(MODELS[name].url, onProgress);
  const { mask } = MODELS[name];
  let backend = 'CPU';
  if (!gpuFailed) {
    try {
      segmenter = await createSegmenter(model, 'GPU', mask);
      backend = 'GPU';
    } catch (error) {
      // Some phone GPUs create the graph fine but fail on the first run
      // (TensorsToSegmentationCalculator RET_CHECK), hence the warm-up inside.
      console.warn(`MediaPipe GPU failed for ${name}, falling back to CPU`, error);
      gpuFailed = true;
    }
  }
  if (!segmenter) {
    try {
      segmenter = await createSegmenter(model, 'CPU', mask);
    } catch (error) {
      console.error(`MediaPipe CPU failed for ${name}`, error);
      throw error;
    }
  }
  loaded = { name, backend, model };
  return backend;
}

function closeSegmenter() {
  try {
    segmenter?.close();
  } catch (error) {
    console.warn('MediaPipe close failed', error);
  }
  segmenter = null;
  loaded = null;
}

async function createSegmenter(model, delegate, maskIndex) {
  const created = await ImageSegmenter.createFromOptions(WASM_FILES, {
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: 'IMAGE',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  // Warm-up, reading the mask back like a real photo does: the first run
  // compiles shaders, and a GPU that can't run the model fails here.
  try {
    const blank = document.createElement('canvas');
    blank.width = blank.height = 64;
    const result = created.segment(blank);
    try {
      result.confidenceMasks[maskIndex].getAsFloat32Array();
    } finally {
      result.close();
    }
  } catch (error) {
    // After a WASM abort, close() can throw too; keep the original error.
    try {
      created.close();
    } catch {
      // Nothing more to free.
    }
    throw error;
  }
  return created;
}

async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(received / total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function segment(canvas, index) {
  const result = segmenter.segment(canvas);
  try {
    const mask = result.confidenceMasks[index];
    return { width: mask.width, height: mask.height, confidence: mask.getAsFloat32Array() };
  } finally {
    result.close();
  }
}

/**
 * Returns a canvas of the same size as `canvas`, where the background has
 * been made transparent.
 */
export async function removeBackground(canvas) {
  if (!segmenter) throw new Error('Modèle non chargé');
  const { mask: index, isPerson } = MODELS[loaded.name];
  let width, height, confidence;
  try {
    ({ width, height, confidence } = segment(canvas, index));
  } catch (error) {
    if (loaded.backend !== 'GPU') throw error;
    // The warm-up passed but a full-size photo failed: carry on with the CPU.
    console.warn('MediaPipe GPU run failed, switching to CPU', error);
    gpuFailed = true;
    const current = loaded;
    closeSegmenter();
    segmenter = await createSegmenter(current.model, 'CPU', index);
    loaded = { ...current, backend: 'CPU' };
    ({ width, height, confidence } = segment(canvas, index));
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d');
  const pixels = maskCtx.createImageData(width, height);
  for (let i = 0; i < confidence.length; i++) {
    const person = isPerson ? confidence[i] : 1 - confidence[i];
    const t = Math.min(1, Math.max(0, (person - EDGE_LOW) / (EDGE_HIGH - EDGE_LOW)));
    pixels.data[i * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
  }
  maskCtx.putImageData(pixels, 0, 0);

  // Scale the mask to the photo (if needed), then keep the photo only where
  // the mask is opaque.
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(maskCanvas, 0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(canvas, 0, 0);
  return out;
}
