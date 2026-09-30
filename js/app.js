// Entry script: the screen switcher. It shows exactly one screen at a time (the web's
// SetActive) and sets the VHS strength for each screen, the way VHSDriver sets a float
// on the fullscreen material (spec.md > Screen Switcher).

import { loadTapes, saveTapes } from './store.js';
import { todayLocal, formatVcrDate } from './tapes.js';
import { renderShelf } from './shelf.js';
import { initRecord } from './record.js';

// --vhs per screen; css/vhs.css reads it once the effect layer lands (slice 3).
const VHS = { shelf: 0.5, record: 0.3, saved: 0.5 };

const screens = Object.fromEntries(
  [...document.querySelectorAll('[data-screen]')].map((section) => [section.dataset.screen, section]),
);

let tapes = loadTapes();
let current = null;

const record = initRecord(screens.record, {
  onSave(tape) {
    tapes = [...tapes, tape];
    saveTapes(tapes);
    screens.saved.querySelector('[data-saved-label]').textContent =
      `${tape.project} · ${formatVcrDate(tape.returnDate)}`;
    show('saved');
  },
  onBack: () => show('shelf'),
});

// enter()/leave() hooks, like OnEnable/OnDisable.
const hooks = { record };

function show(name) {
  hooks[current]?.leave();
  for (const [key, section] of Object.entries(screens)) section.hidden = key !== name;
  document.documentElement.style.setProperty('--vhs', String(VHS[name] ?? 0.5));
  document.body.dataset.screen = name;
  current = name;
  if (name === 'shelf') drawShelf();
  hooks[name]?.enter();
}

// Tape states are worked out from today's date on every draw, so a locked tape
// turns READY on its date without any background job.
function drawShelf() {
  const today = todayLocal();
  screens.shelf.querySelector('[data-shelf-stamp]').textContent = formatVcrDate(today);
  renderShelf(screens.shelf.querySelector('[data-shelf]'), tapes, today, {
    onRecord: () => show('record'),
    onSelect: () => {}, // Playback arrives in slice 2.
  });
}

document.querySelector('[data-action="rec"]').addEventListener('click', () => show('record'));
document.querySelector('[data-action="to-shelf"]').addEventListener('click', () => show('shelf'));

show('shelf');
