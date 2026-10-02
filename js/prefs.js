// Player preferences (spec.md > Accessibility): reduce motion and high contrast, chosen in the room
// controls or taken from the system setting, plus the sound switch. Every module asks here instead of
// reading the media query itself, like one settings ScriptableObject that the other scripts read.
// Stored in this browser only.

const KEY = 'pausetape.prefs.v1';
const systemReduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const systemContrast = globalThis.matchMedia?.('(prefers-contrast: more)');

function load() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}
let prefs = load();
const listeners = new Set();

// null = follow the system setting; true / false = the player's choice.
export function reducedMotion() {
  return prefs.motion ?? Boolean(systemReduced?.matches);
}
export function highContrast() {
  return prefs.contrast ?? Boolean(systemContrast?.matches);
}
export function soundOn() {
  return prefs.sound === true; // off until the player turns it on (browsers block sound before a click anyway)
}

export function setPref(name, value) {
  prefs = { ...prefs, [name]: value };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage blocked: it still applies for this visit */ }
  apply();
}

export function onPrefsChange(fn) {
  listeners.add(fn);
}

// The page reads these as classes on <html>, so CSS can switch animations off and raise contrast.
function apply() {
  const root = document.documentElement;
  root.classList.toggle('reduce-motion', reducedMotion());
  root.classList.toggle('high-contrast', highContrast());
  for (const fn of listeners) fn();
}
systemReduced?.addEventListener?.('change', apply);
systemContrast?.addEventListener?.('change', apply);
apply();
