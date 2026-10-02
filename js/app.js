// Entry script: the screen switcher. It shows exactly one screen at a time (the web's
// SetActive) and sets the VHS strength for each screen, the way VHSDriver sets a float
// on the fullscreen material (spec.md > Screen Switcher).

import { loadTapes, saveTapes } from './store.js';
import { todayLocal, formatVcrDate } from './tapes.js';
import { renderShelf } from './shelf.js';
import { initRecord } from './record.js';
import { initPlayback, PACE } from './playback.js';
import { startCrt } from './crt.js';
import { switchGlitch } from './motion.js';
import { downloadIcs } from './ics.js';

// --vhs per screen: css/vhs.css and the js/crt.js shader both read it, like VHSDriver's float.
const VHS = { shelf: 0.5, record: 0.3, saved: 0.5, early: 0.5, blue: 1, playback: 1, backonit: 0.5 };

const screens = Object.fromEntries(
  [...document.querySelectorAll('[data-screen]')].map((section) => [section.dataset.screen, section]),
);

let tapes = loadTapes();
let current = null;
let earlyTape = null;
let backOnItTimer = null;
let savedTape = null;
let room = null; // the 3D room's controls, once it has started (see startRoomIfPossible)

const record = initRecord(screens.record, {
  onSave(tape) {
    tapes = [...tapes, tape];
    saveTapes(tapes);
    savedTape = tape;
    screens.saved.querySelector('[data-saved-label]').textContent =
      `${tape.project} · ${formatVcrDate(tape.returnDate)}`;
    screens.saved.querySelector('[data-ics-note]').hidden = true;
    show('saved');
  },
  onBack: () => show('shelf'),
});

const playback = initPlayback(screens, {
  show,
  // The only place minutes are written, and only once (spec.md > Data Model).
  onBackOnIt(tape, minutes) {
    tapes = tapes.map((t) => (t.id === tape.id && t.backOnItMinutes == null
      ? { ...t, backOnItMinutes: minutes, completedAt: new Date().toISOString() }
      : t));
    saveTapes(tapes);
    screens.backonit.querySelector('[data-backonit-text]').textContent = `BACK ON IT · ${minutes} MIN`;
    screens.backonit.querySelector('[data-backonit-label]').textContent = tape.project;
    show('backonit');
    backOnItTimer = setTimeout(() => show('shelf'), PACE.backOnItMs);
  },
  onStop: () => show('shelf'),
});

// enter()/leave() hooks, like OnEnable/OnDisable.
const hooks = { record };

function show(name) {
  // In the room: the blue screen is up and the replay begins, so the camera eases into the TV.
  if (room && name === 'playback') room.loadingDone();
  hooks[current]?.leave();
  const from = screens[current];
  clearTimeout(backOnItTimer);
  if (name !== 'blue' && name !== 'playback') playback.stop();
  for (const [key, section] of Object.entries(screens)) section.hidden = key !== name;
  document.documentElement.style.setProperty('--vhs', String(VHS[name] ?? 0.5));
  // data-current, not data-screen, so a [data-screen="…"] selector only ever matches a section.
  document.body.dataset.current = name;
  current = name;
  if (name === 'shelf') drawShelf();
  hooks[name]?.enter();
  switchGlitch(from, screens[name]);
}

// Tape states are worked out from today's date on every draw, so a locked tape
// turns READY on its date without any background job.
function drawShelf() {
  const today = todayLocal();
  screens.shelf.querySelector('[data-shelf-stamp]').textContent = formatVcrDate(today);
  renderShelf(screens.shelf.querySelector('[data-shelf]'), tapes, today, {
    onRecord: () => show('record'),
    onSelect: selectTape,
  });
}

// In the room a tape goes into the VCR first; the app's playback starts once it is in.
function play(tape, mode) {
  const start = () => playback.startPlayback(tape, mode);
  if (room) room.playTape(tape.project, start); else start();
}

// READY plays, locked asks first, completed replays (spec.md > Tape Shelf).
function selectTape(tape, state) {
  if (state === 'ready') {
    play(tape, 'return');
  } else if (state === 'completed') {
    play(tape, 'replay');
  } else {
    earlyTape = tape;
    // Two fixed lines, so the date never breaks in the middle.
    const line = (text) => Object.assign(document.createElement('span'), { className: 'early__line', textContent: text });
    screens.early.querySelector('[data-early-text]')
      .replaceChildren(line(`TAPE DUE ${formatVcrDate(tape.returnDate)}.`), ' ', line('PLAY EARLY?'));
    show('early');
  }
}

document.querySelector('[data-action="rec"]').addEventListener('click', () => show('record'));
document.querySelector('[data-action="to-shelf"]').addEventListener('click', () => show('shelf'));
// The calendar file is optional: the tape is already saved whether or not it's downloaded.
document.querySelector('[data-action="add-calendar"]').addEventListener('click', () => {
  if (!savedTape) return;
  const name = downloadIcs(savedTape);
  const note = screens.saved.querySelector('[data-ics-note]');
  note.textContent = `SAVED ${name.toUpperCase()}`;
  note.hidden = false;
});
document.querySelector('[data-action="early-play"]').addEventListener('click', () => play(earlyTape, 'return'));
document.querySelector('[data-action="early-cancel"]').addEventListener('click', () => show('shelf'));
// BACK ON IT returns by itself after a few seconds, or right away when tapped.
screens.backonit.addEventListener('click', () => show('shelf'));

// The shader layer starts once; if WebGL isn't available the CSS layer keeps working.
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
startCrt(document.querySelector('.tv__screen'), {
  getVhs: () => VHS[current] ?? 0.5,
  reducedMotion: () => reducedQuery.matches,
});

show('shelf');

// The room around the TV (prd.md > The room around the TV): a laptop or desktop window with WebGL.
// On a phone, or if anything fails, the app stays the flat TV above, which works on its own.
async function startRoomIfPossible() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl || window.innerWidth < 700 || new URLSearchParams(location.search).has('flat')) return;
  try {
    const mod = await import('./room.js');
    // In the room, the blue loading screen runs about 3 s and the camera eases in when it ends
    // (learner request for the VHS mode); the flat TV keeps its shorter 1.2 s.
    PACE.blueMs = 3000;
    room = mod.startRoom({ onLeave: () => show('shelf') });
    mod.setupCrtBend();
    document.documentElement.classList.add('has-room');
  } catch (err) {
    // Put the screen back in the flat TV if the room had already taken it.
    const tvEl = document.querySelector('main.tv');
    const screenEl = document.querySelector('.tv__screen');
    if (screenEl && !tvEl.contains(screenEl)) tvEl.append(screenEl);
    document.documentElement.classList.remove('has-room');
    document.querySelector('[data-room-stage]').hidden = true;
    document.querySelector('[data-room-ui]').hidden = true;
    room = null;
    console.warn('Room not started, keeping the flat TV:', err);
  }
}
startRoomIfPossible();
