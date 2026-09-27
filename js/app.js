import { Camera } from './camera.js';
import { loadModel, removeBackground } from './matting.js';
import { composeTicket } from './ticket.js';
import { BoothPrinter } from './printer.js';
import { loadSettings, saveSettings, bindSettingsForm } from './settings.js';

const $ = (id) => document.getElementById(id);

const app = $('app');
const settings = loadSettings();
const camera = new Camera($('video'));

let modelReady = false;
let cameraReady = false;
let counting = false;
let lastCutout = null;
let lastTicket = null;

// ---------- UI helpers

function setState(state) {
  app.dataset.state = state;
  $('status-line').textContent = '';
}

let toastTimer;
function toast(message, { error = false, duration = 3000 } = {}) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function refreshShutter() {
  const matteReady = modelReady || !settings.removeBackground;
  $('shutter').disabled = !(matteReady && cameraReady) || counting;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Shows the reprint question; resolves to true when the guest says yes. */
function askReprint() {
  const dialog = $('reprint');
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
  });
}

/** Saves the ticket preview to the device's Downloads folder. */
function downloadTicket(canvas) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ticket-ptit-booth-${stamp}.jpg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, 'image/jpeg', 0.92);
}

// ---------- Printer

const printer = new BoothPrinter({
  onStatus: renderPrinterStatus,
  onProgress: (fraction) => {
    $('print-progress').firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
  },
});

function renderPrinterStatus({ connected, battery }) {
  const chip = $('printer-chip');
  chip.dataset.connected = String(connected);
  $('printer-label').textContent = connected
    ? battery !== undefined ? `Imprimante · ${battery}%` : 'Imprimante'
    : 'Connecter';
}

async function connectPrinter() {
  if (!BoothPrinter.isSupported) {
    toast('Bluetooth indisponible : ouvrez la page dans Chrome sur Android.', { error: true, duration: 5000 });
    return false;
  }
  const chip = $('printer-chip');
  chip.dataset.connected = 'busy';
  $('printer-label').textContent = 'Connexion…';
  try {
    await printer.connect();
    toast('Imprimante connectée');
    return true;
  } catch (error) {
    renderPrinterStatus(printer.status);
    // The user closed the device chooser: not an error worth shouting about.
    if (error?.name !== 'NotFoundError') {
      console.error(error);
      toast(`Connexion impossible : ${error.message ?? error}`, { error: true, duration: 5000 });
    }
    return false;
  }
}

$('printer-chip').addEventListener('click', () => {
  if (printer.isConnected) {
    const { name, battery } = printer.status;
    toast(`${name ?? 'Imprimante'} connectée${battery !== undefined ? ` · batterie ${battery}%` : ''}`);
  } else {
    connectPrinter();
  }
});

$('disconnect-btn').addEventListener('click', async () => {
  await printer.disconnect();
  toast('Imprimante déconnectée');
});

// ---------- Camera

async function startCamera(facingMode) {
  $('camera-message').hidden = true;
  cameraReady = false;
  refreshShutter();
  try {
    await camera.start(facingMode);
    cameraReady = true;
    // Laptops usually have a single webcam: nothing to flip to.
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    $('flip-btn').style.visibility = devices.filter((d) => d.kind === 'videoinput').length > 1 ? '' : 'hidden';
  } catch (error) {
    console.error(error);
    $('camera-message-text').textContent = cameraErrorMessage(error);
    $('camera-message').hidden = false;
  }
  refreshShutter();
}

function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'InsecureContextError':
      return `Le navigateur bloque la caméra sur cette adresse (${location.origin || location.href}). `
        + 'Ouvrez la page via http://localhost ou en https, pas en double-cliquant sur le fichier ni via une adresse IP.';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Accès à la caméra refusé. Cliquez sur l’icône à gauche de l’adresse pour l’autoriser, '
        + 'et vérifiez les paramètres de confidentialité du système (Windows : Paramètres › Confidentialité › Caméra).';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Aucune caméra détectée sur cet appareil.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'La caméra est déjà utilisée par une autre application (Teams, Zoom…) ou désactivée. Fermez-la puis réessayez.';
    default:
      return `Caméra indisponible : ${error?.message ?? error}`;
  }
}

$('camera-retry').addEventListener('click', () => startCamera());

$('flip-btn').addEventListener('click', async () => {
  settings.facingMode = camera.facingMode === 'user' ? 'environment' : 'user';
  saveSettings(settings);
  await startCamera(settings.facingMode);
});

// ---------- Capture flow

async function countdown(seconds) {
  const el = $('countdown');
  for (let n = seconds; n > 0; n -= 1) {
    el.textContent = String(n);
    el.classList.remove('tick');
    void el.offsetWidth; // restart the animation
    el.classList.add('tick');
    await sleep(1000);
  }
  el.textContent = '';
  el.classList.remove('tick');
}

async function takePhoto() {
  if ($('shutter').disabled || app.dataset.state !== 'camera') return;
  counting = true;
  app.classList.add('counting');
  refreshShutter();

  try {
    await countdown(settings.countdown);
    const flash = $('flash');
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    const frame = camera.capture();

    setState('processing');
    $('busy-text').textContent = settings.removeBackground ? 'Détourage en cours…' : 'Préparation…';
    $('print-progress').hidden = true;
    await sleep(50); // let the spinner paint before the heavy work

    lastCutout = settings.removeBackground ? await removeBackground(frame) : frame;
    renderTicket();
    setState('preview');
    if (settings.removeBackground && lastTicket.foreground < 0.02) {
      toast('Aucune personne détectée… on reprend ?', { error: true, duration: 4000 });
    }
  } catch (error) {
    console.error(error);
    toast(`Oups : ${error.message ?? error}`, { error: true, duration: 5000 });
    setState('camera');
  } finally {
    counting = false;
    app.classList.remove('counting');
    refreshShutter();
  }
}

function renderTicket() {
  if (!lastCutout) return;
  lastTicket = composeTicket(lastCutout, settings);
  const canvas = $('ticket-canvas');
  canvas.width = lastTicket.preview.width;
  canvas.height = lastTicket.preview.height;
  canvas.getContext('2d').drawImage(lastTicket.preview, 0, 0);
}

$('shutter').addEventListener('click', takePhoto);

// Bluetooth selfie remotes usually send Enter or Volume Up.
document.addEventListener('keydown', (event) => {
  if ($('settings').open || $('reprint').open) return;
  if (['Space', 'Enter', 'NumpadEnter', 'AudioVolumeUp'].includes(event.code) || event.key === 'AudioVolumeUp') {
    if (app.dataset.state === 'camera') {
      event.preventDefault();
      takePhoto();
    }
  }
});

$('retake-btn').addEventListener('click', () => {
  lastCutout = null;
  lastTicket = null;
  setState('camera');
});

/** Prints the current ticket once. On failure, goes back to the preview and returns false. */
async function printTicket() {
  // Connecting needs a click's user gesture, so do it first.
  if (!printer.isConnected && !(await connectPrinter())) {
    setState('preview');
    return false;
  }

  setState('printing');
  $('busy-text').textContent = 'Impression…';
  $('print-progress').hidden = false;
  $('print-progress').firstElementChild.style.width = '0%';

  try {
    await printer.print(lastTicket.bitmap, settings.density);
    $('busy-text').textContent = 'Et voilà !';
    return true;
  } catch (error) {
    console.error(error);
    toast(`Échec de l'impression : ${error.message ?? error}`, { error: true, duration: 5000 });
    setState('preview');
    return false;
  }
}

$('print-btn').addEventListener('click', async () => {
  if (!lastTicket || app.dataset.state !== 'preview') return;
  downloadTicket(lastTicket.preview);

  while (await printTicket()) {
    await sleep(800);
    if (!(await askReprint())) {
      lastCutout = null;
      lastTicket = null;
      setState('camera');
      return;
    }
  }
});

// ---------- Settings

bindSettingsForm($('settings-form'), settings, (name) => {
  if (name === 'removeBackground') {
    if (settings.removeBackground) ensureModel();
    refreshShutter();
    return;
  }
  // Re-render the preview live when a print-related setting changes.
  if (app.dataset.state === 'preview' && name !== 'countdown' && name !== 'density') renderTicket();
});

$('settings-btn').addEventListener('click', () => $('settings').showModal());
$('settings').addEventListener('click', (event) => {
  // Tap on the backdrop closes the sheet.
  if (event.target === event.currentTarget) event.currentTarget.close();
});

// ---------- Keep the screen awake during the event

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {
    // Not critical.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  keepAwake();
  // Android may kill the camera track while the app is in the background.
  const track = camera.stream?.getVideoTracks()[0];
  if (!track || track.readyState === 'ended') startCamera();
});

// ---------- Matting model, loaded only when background removal is on

let modelLoading = null;

function ensureModel() {
  modelLoading ??= loadMattingModel();
  return modelLoading;
}

async function loadMattingModel() {
  const loader = $('loader');
  const bar = $('loader-bar');
  loader.classList.remove('done', 'error');
  $('loader-text').textContent = 'Chargement du modèle de détourage…';
  try {
    const backend = await loadModel((fraction) => {
      bar.style.width = `${Math.round(fraction * 100)}%`;
    });
    bar.style.width = '100%';
    modelReady = true;
    console.info(`MODNet ready on ${backend}`);
    loader.classList.add('done');
  } catch (error) {
    console.error(error);
    modelLoading = null;
    loader.classList.add('error');
    $('loader-text').textContent = `Impossible de charger le modèle : ${error.message ?? error}. `
      + 'Touchez pour continuer sans détourage.';
  }
  refreshShutter();
}

// After a load failure, a tap on the loader carries on without matting.
$('loader').addEventListener('click', () => {
  if (!$('loader').classList.contains('error')) return;
  settings.removeBackground = false;
  saveSettings(settings);
  $('settings-form').elements.removeBackground.checked = false;
  $('loader').classList.replace('error', 'done');
  refreshShutter();
});

// ---------- Boot

async function boot() {
  renderPrinterStatus(printer.status);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('SW registration failed', error));
  }
  keepAwake();

  const cameraStarted = startCamera(settings.facingMode);

  if (settings.removeBackground) await ensureModel();
  else $('loader').classList.add('done');

  await cameraStarted;
  refreshShutter();
  if (!printer.isConnected) $('status-line').textContent = 'Astuce : touchez « Connecter » pour appairer l’imprimante.';
}

boot();
