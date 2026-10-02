// Player preferences (spec.md > Accessibility): reduce motion and high contrast, chosen in the room
// controls or taken from the system setting, plus the sound switch. Every module asks here instead of
// reading the media query itself, like one settings ScriptableObject that the other scripts read.
// Stored in this browser only.

const KEY = 'pausetape.prefs.v1';
const systemReduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const systemContrast = globalThis.matchMedia?.('(prefers-contrast: more)');

function load() {
  try {
    const p = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}');
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
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage blocked: it still applies for this visit */ }
  apply();
}

export function onPrefsChange(fn) {
  listeners.add(fn);
}

// The page reads these as classes on <html>, so CSS can switch animations off and raise contrast.
function apply() {
  const root = globalThis.document?.documentElement;
  if (!root) return; // outside a page (the Node checks of the pure modules): nothing to style
  root.classList.toggle('reduce-motion', reducedMotion());
  root.classList.toggle('high-contrast', highContrast());
  for (const fn of listeners) fn();
}
systemReduced?.addEventListener?.('change', apply);
systemContrast?.addEventListener?.('change', apply);
// Some browsers don't send "change" for every switch of the system setting, so look again now and
// then too (cheap: two media queries), and whenever the window comes back into focus.
let last = '';
function recheck() {
  const now = `${reducedMotion()}|${highContrast()}`;
  if (now !== last) { last = now; apply(); }
}
if (globalThis.document) setInterval(recheck, 500);
globalThis.addEventListener?.('focus', recheck);
apply();
last = `${reducedMotion()}|${highContrast()}`;
