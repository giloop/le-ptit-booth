// Offline support: everything is cached on first visit, so the booth keeps
// working at a venue without network.
//
// App files: network first (updates show up on reload), cache as fallback.
// Heavy files (model, wasm, vendored libraries): cache first.

const VERSION = 'v4';
const CACHE = `pocketbooth-${VERSION}`;

const APP_FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/camera.js',
  'js/matting.js',
  'js/printer.js',
  'js/settings.js',
  'js/ticket.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

const HEAVY_FILES = [
  'vendor/transformers/transformers.min.js',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.mjs',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm',
  'models/Xenova/modnet/config.json',
  'models/Xenova/modnet/preprocessor_config.json',
  'models/Xenova/modnet/onnx/model.onnx',
  'vendor/pocketprinter5890/index.js',
  'vendor/pocketprinter5890/printer.js',
  'vendor/pocketprinter5890/demos.js',
  'vendor/pocketprinter5890/protocol/commands.js',
  'vendor/pocketprinter5890/protocol/document.js',
  'vendor/pocketprinter5890/protocol/escpos.js',
  'vendor/pocketprinter5890/protocol/flow-control.js',
  'vendor/pocketprinter5890/protocol/job.js',
  'vendor/pocketprinter5890/protocol/raster.js',
  'vendor/pocketprinter5890/protocol/receipt-document.js',
  'vendor/pocketprinter5890/protocol/responses.js',
  'vendor/pocketprinter5890/protocol/text-layout.js',
  'vendor/pocketprinter5890/render/barcode.js',
  'vendor/pocketprinter5890/render/canvas.js',
  'vendor/pocketprinter5890/render/codes.js',
  'vendor/pocketprinter5890/render/receipt.js',
  'vendor/pocketprinter5890/transport/capacitor.js',
  'vendor/pocketprinter5890/transport/types.js',
  'vendor/pocketprinter5890/transport/web-bluetooth.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([...APP_FILES, ...HEAVY_FILES]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pocketbooth-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isHeavy = (url) => url.pathname.includes('/vendor/') || url.pathname.includes('/models/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isHeavy(url)) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? fetchAndCache(request)),
    );
  } else {
    event.respondWith(
      fetchAndCache(request).catch(() => caches.match(request, { ignoreSearch: true })
        .then((cached) => cached ?? caches.match('index.html'))),
    );
  }
});

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}
