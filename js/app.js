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
import { reducedMotion, highContrast, soundOn, onPrefsChange } from './prefs.js';
import { setSound, resumeOnFirstClick, screenChange, blip, tapeIn, vcrClick } from './sound.js';

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

function show(name, { force = false } = {}) {
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
  switchGlitch(from, screens[name], { force });
  if (from && from !== screens[name]) {
    screenChange();
    if (name === 'saved' || name === 'backonit' || name === 'early') setTimeout(() => blip(name === 'early' ? 'answer' : 'first'), 120);
  }
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
  if (room) { room.playTape(tape.project, start); return; }
  // The flat TV has no VCR to look at, so the tape's sound goes in quickly under the blue screen.
  vcrClick();
  tapeIn({ delay: 0, scale: 0.45 });
  start();
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

startCrt(document.querySelector('.tv__screen'), {
  getVhs: () => (highContrast() ? 0.1 : VHS[current] ?? 0.5), // high contrast calms the picture
  reducedMotion,
});

show('shelf');

// Sound on / off: one button in the top-left corner, in the room and on the flat TV. Sound is off
// until the player turns it on (that click is also what browsers need before any audio can play).
const soundBtn = document.querySelector('[data-sound-quick]');
function syncSoundButton() {
  soundBtn.setAttribute('aria-pressed', String(soundOn()));
  soundBtn.setAttribute('aria-label', soundOn() ? 'Mute sound' : 'Turn sound on');
  soundBtn.querySelector('[data-sound-text]').textContent = soundOn() ? 'SOUND ON' : 'SOUND OFF';
  soundBtn.classList.toggle('is-on', soundOn());
}
soundBtn.addEventListener('click', () => { setSound(!soundOn()).then(syncSoundButton); });
onPrefsChange(syncSoundButton);
syncSoundButton();
resumeOnFirstClick();

// The room around the TV (prd.md > The room around the TV): a laptop or desktop window with WebGL.
// On a phone, or if anything fails, the app stays the flat TV above, which works on its own.
// While the room loads, a VCR-style loading screen shows how far along it is and roughly how long
// is left (from the speed so far), so a slow connection never looks frozen.
const loading = document.querySelector('[data-room-loading]');
function showLoading(fraction, startedAt) {
  loading.hidden = false;
  const pct = Math.round(fraction * 100);
  loading.querySelector('[data-room-loading-pct]').textContent = `${pct}%`;
  const cells = loading.querySelectorAll('.room-loading__cell');
  cells.forEach((c, i) => c.classList.toggle('is-on', i < Math.round(fraction * cells.length)));
  const secs = (performance.now() - startedAt) / 1000;
  const left = fraction > 0.05 ? Math.max(0, Math.ceil((secs / fraction) * (1 - fraction))) : null;
  loading.querySelector('[data-room-loading-eta]').textContent = left == null ? 'ESTIMATING…' : left <= 1 ? 'ALMOST THERE' : `ABOUT ${left} S LEFT`;
}
async function startRoomIfPossible() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  const asked = new URLSearchParams(location.search).has('flat');
  if (!gl && !asked && window.innerWidth >= 700 && window.matchMedia('(pointer: fine)').matches) {
    // No WebGL: the app works as the flat TV; say so once, quietly.
    const note = document.querySelector('[data-no-webgl]');
    note.hidden = false;
    setTimeout(() => { note.hidden = true; }, 6000);
  }
  // The room is for laptops and desktops: a mouse (or trackpad) and a window of at least 700 x 500.
  // A phone, even on its side, keeps the flat TV, which fits a small screen and works by touch.
  const desktop = window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 700 && window.innerHeight >= 500;
  if (!gl || !desktop || asked) return;
  const startedAt = performance.now();
  // Two thirds of the wait is the room's code (three.js and the scene), the rest its pictures.
  showLoading(0.02, startedAt);
  const tick = setInterval(() => { const f = Math.min(0.6, (performance.now() - startedAt) / 4000); showLoading(f, startedAt); }, 120);
  try {
    const mod = await import('./room.js');
    clearInterval(tick);
    await mod.roomReady((done, total) => showLoading(0.65 + 0.35 * (total ? done / total : 0), startedAt));
    showLoading(1, startedAt);
    // In the room, the blue loading screen runs about 3 s and the camera eases in when it ends
    // (learner request for the VHS mode); the flat TV keeps its shorter 1.2 s.
    PACE.blueMs = 3000;
    // BACK TO THE ROOM: the same freeze + glitch as any screen change, even from the shelf itself.
    room = mod.startRoom({ onLeave: () => show('shelf', { force: true }) });
    mod.setupCrtBend();
    document.documentElement.classList.add('has-room');
    loading.classList.add('is-done'); // fades out (0.5 s) and lets clicks through right away
    setTimeout(() => { loading.hidden = true; loading.classList.remove('is-done'); }, 600);
  } catch (err) {
    clearInterval(tick);
    loading.hidden = true;
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
