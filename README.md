# Le P'tit Booth

A photobooth that runs in the browser: take a photo, remove the background
with the [MediaPipe selfie segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter), and print it with a
banner on a Lidl Tronic / SILVERCREST **5890** pocket printer via
[PocketPrinter5890](https://github.com/dimer47/PocketPrinter5890).

Plain HTML/CSS/JS, no build step. Everything is bundled locally: model,
MediaPipe runtime and printer library. After the first visit the page works
offline.

## Requirements

- **Chrome on Android**, or **Safari on iPhone/iPad with the
  [beacio](https://beacio.com/) extension** enabled for the site. beacio adds
  the standard `navigator.bluetooth` API to Safari, so the app detects it like
  Chrome. Without beacio, Web Bluetooth doesn't exist in Safari or Firefox.
- The page must be served over **HTTPS** or from `localhost`. This is
  required for both camera access and Bluetooth.
- On the phone: Bluetooth on, and Chrome allowed to use "Nearby devices".

## Running it

### On a PC (for development)

```bash
npx serve .
```

Then open http://localhost:3000 in Chrome.

### On the phone

The easiest way is to host the folder on any static HTTPS host, such as
GitHub Pages, Netlify or Cloudflare Pages. Open the URL once **with network
access** and wait for the loading screen to finish. The service worker then
caches everything (about 12 MB), and the booth works offline from then on.

To test from your PC without deploying: connect the phone over USB, open
`chrome://inspect` on the PC, enable **Port forwarding** `3000 → localhost:3000`,
then open `http://localhost:3000` on the phone.

## Using it

1. Tap **Connecter** and select *Mini Pocket Printer_BLE*. Chrome requires a
   tap to pair, so it can't reconnect automatically. If you skip this step,
   the first "Imprimer" opens the device chooser instead.
2. ⚙ **Réglages**: set the banner title and subtitle, date, countdown,
   brightness and contrast, dithering and print density. Settings are saved
   on the phone.
3. Shutter button (or Enter / a Bluetooth selfie remote) → countdown →
   background removal → ticket preview → **Imprimer** or **Reprendre**.

## How it works

| File | Role |
|---|---|
| [js/app.js](js/app.js) | Screens and flow: camera → processing → preview → printing |
| [js/camera.js](js/camera.js) | Camera stream, 3:4 capture (mirrored for the front camera) |
| [js/matting.js](js/matting.js) | MediaPipe selfie segmenters (fast or multiclass), loaded from `models/` |
| [js/ticket.js](js/ticket.js) | Ticket layout: auto-levels on the people only, sharpening, Atkinson/Floyd-Steinberg dithering, crisp banner text, 384-dot 1-bit bitmap |
| [js/printer.js](js/printer.js) | Wrapper around `PocketPrinter` (Web Bluetooth) |
| [sw.js](sw.js) | Offline cache |

Vendored dependencies:

- `vendor/mediapipe/`: `@mediapipe/tasks-vision` 1.0.1 (Apache-2.0):
  `vision_bundle.mjs` (renamed `vision_bundle.esm.js`, since some servers
  send `.mjs` without a JavaScript MIME type) and the SIMD WASM files from `wasm/`.
- `vendor/pocketprinter5890/`: compiled from the repository's `web/` folder
  (MIT). The library isn't published on npm.
- `models/mediapipe/`, from `storage.googleapis.com/mediapipe-models/image_segmenter/`:
  - `selfie_segmenter.tflite` (float16, 250 KB), the default.
  - `selfie_multiclass_256x256.tflite` (float32, 16 MB): six classes
    including hair, so hair is cut out more precisely. Chosen in the settings
    (*Modèle de détourage*). It is cached for offline use the first time it
    is selected, not at install.

### Notes

- The segmenter runs on the **GPU** (WebGL) when available, CPU otherwise.
  Both models work at 256×256, so they are much faster than MODNet. The fast
  one has softer, less precise edges (hair especially). `EDGE_LOW`/`EDGE_HIGH` in
  [js/matting.js](js/matting.js) tighten the mask edges.
- The printer only accepts ASCII text, so the banner is drawn on a canvas
  and sent as an image. That way accents print correctly.
- When you change the code, bump `VERSION` in `sw.js` so phones pick up the
  new version.
