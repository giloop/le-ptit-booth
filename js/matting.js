// Background removal with MODNet, running fully in the browser from local files.

import { env, pipeline, RawImage } from '../vendor/transformers/transformers.min.js';

const MODEL_ID = 'Xenova/modnet';

env.allowRemoteModels = false;
env.allowLocalModels = true;
// A path, not a full URL: transformers.js 4.x skips its local-file existence
// check for http(s) URLs, and then silently drops the image processor.
env.localModelPath = new URL('../models/', import.meta.url).pathname;
// The service worker already caches the model; no need for a second copy.
env.useBrowserCache = false;

const ortBase = new URL('../vendor/ort/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = {
  mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm`,
};
// Multi-threading needs cross-origin isolation, which a plain static host lacks.
env.backends.onnx.wasm.numThreads = 1;

let segmenter = null;

/**
 * Loads the model. `onProgress(fraction)` receives the download progress, 0 to 1.
 *
 * WASM only: with onnxruntime-web 1.31 the WebGPU backend runs without error
 * but returns a badly broken matte for MODNet (holes in faces, background left
 * over), so it is not worth the speed.
 */
export async function loadModel(onProgress = () => {}) {
  segmenter = await pipeline('background-removal', MODEL_ID, {
    device: 'wasm',
    dtype: 'fp32',
    progress_callback: (event) => {
      if (event.status === 'progress' && event.file?.endsWith('.onnx') && event.total) {
        onProgress(event.loaded / event.total);
      }
    },
  });
  // Warm-up: the first run allocates and compiles kernels. Doing it now
  // keeps the first real photo fast.
  const blank = new RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(128), 64, 64, 3);
  await segmenter(blank);
  return 'wasm';
}

/**
 * Returns a canvas of the same size as `canvas`, where the background has
 * been made transparent.
 */
export async function removeBackground(canvas) {
  if (!segmenter) throw new Error('Modèle non chargé');
  const image = RawImage.fromCanvas(canvas);
  const result = await segmenter(image);
  return (Array.isArray(result) ? result[0] : result).toCanvas();
}
