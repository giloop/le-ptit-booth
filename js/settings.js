// Booth settings, remembered on this device only.

const STORAGE_KEY = 'pocketbooth.settings.v1';

export const defaults = {
  title: "Le P'tit Booth",
  subtitle: '',
  showDate: true,
  removeBackground: true,
  matteModel: 'selfie',
  countdown: 3,
  brightness: 10,
  contrast: 15,
  dither: 'atkinson',
  density: 0,
  facingMode: 'user',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    // The old default title was saved along with any other setting change.
    if (stored.title === "Le P'tit Booth") delete stored.title;
    // Settings saved before the matting switch carry the old "medium" density
    // default: move them once to the new, lighter one.
    if (!('removeBackground' in stored)) delete stored.density;
    return { ...defaults, ...stored };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or storage disabled: settings just won't persist.
  }
}

const CHECKBOXES = ['showDate', 'removeBackground'];

/** Fills the settings form and keeps `settings` in sync as it changes. */
export function bindSettingsForm(form, settings, onChange) {
  const fields = form.elements;
  const outputs = { brightness: fields.brightnessOut, contrast: fields.contrastOut };

  const showOutput = (name) => {
    if (!outputs[name]) return;
    const value = Number(fields[name].value);
    outputs[name].value = value > 0 ? `+${value}` : String(value);
  };

  for (const name of ['title', 'subtitle', 'matteModel', 'countdown', 'brightness', 'contrast', 'dither', 'density']) {
    fields[name].value = settings[name];
    showOutput(name);
  }
  for (const name of CHECKBOXES) fields[name].checked = settings[name];

  form.addEventListener('input', (event) => {
    const { name } = event.target;
    if (!(name in settings)) return;
    if (CHECKBOXES.includes(name)) settings[name] = fields[name].checked;
    else if (['countdown', 'brightness', 'contrast', 'density'].includes(name)) settings[name] = Number(fields[name].value);
    else settings[name] = fields[name].value;
    showOutput(name);
    saveSettings(settings);
    onChange?.(name);
  });
}
