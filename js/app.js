// Entry script: the screen switcher. It shows exactly one screen at a time (the web's
// SetActive) and sets the VHS strength for each screen, the way VHSDriver sets a float
// on the fullscreen material (spec.md > Screen Switcher).

import { loadTapes, saveTapes, keepTapes, visibleTapes, eraseSample, buildBackup, parseBackup, mergeTapes } from './store.js';
import { todayLocal, formatVcrDate, backOnItStats } from './tapes.js';
import { renderShelf } from './shelf.js';
import { initRecord } from './record.js';
import { initPlayback, PACE } from './playback.js';
import { startCrt } from './crt.js';
import { switchGlitch } from './motion.js';
import { downloadIcs } from './ics.js';
import { tapeLink, tapeFromHash } from './tapelink.js';
import { reducedMotion, highContrast, musicOn, onPrefsChange } from './prefs.js';
import { setMusic, resumeOnFirstClick, screenChange, blip, tapeIn, vcrClick } from './sound.js';
import { saveVoice, deleteVoice } from './voice.js';

// --vhs per screen: css/vhs.css and the js/crt.js shader both read it, like VHSDriver's float.
const VHS = { shelf: 0.5, record: 0.3, saved: 0.5, early: 0.5, erase: 0.5, blue: 1, playback: 1, backonit: 0.5 };

const screens = Object.fromEntries(
  [...document.querySelectorAll('[data-screen]')].map((section) => [section.dataset.screen, section]),
);

let tapes = loadTapes();
let current = null;
let earlyTape = null;
let eraseTape = null;
let lastPlayed = null; // the tape just finished, for PAUSE AGAIN
let backOnItTimer = null;
let savedTape = null;
let room = null; // the 3D room's controls, once it has started (see startRoomIfPossible)

const record = initRecord(screens.record, {
  onSave(tape, voiceBlob) {
    tapes = [...tapes, tape];
    saveTapes(tapes);
    keepTapes(); // ask the browser to keep the tapes for good (store.js)
    // The voice note goes into IndexedDB; if that fails (storage full or blocked), the tape keeps
    // its written answers and simply has no note.
    if (voiceBlob) {
      saveVoice(tape.id, voiceBlob).catch(() => {
        tapes = tapes.map((t) => (t.id === tape.id ? (({ voiceMs, ...rest }) => rest)(t) : t));
        saveTapes(tapes);
      });
    }
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
    // The sample tape is never saved, so it stays READY for the next visitor.
    if (!tape.sample) {
      tapes = tapes.map((t) => (t.id === tape.id && t.backOnItMinutes == null
        ? { ...t, backOnItMinutes: minutes, completedAt: new Date().toISOString() }
        : t));
      saveTapes(tapes);
    }
    lastPlayed = tape;
    screens.backonit.querySelector('[data-backonit-text]').textContent = `BACK ON IT · ${minutes} MIN`;
    screens.backonit.querySelector('[data-backonit-label]').textContent = tape.project;
    show('backonit');
    backOnItTimer = setTimeout(() => show('shelf'), PACE.backOnItMs);
  },
  onStop: () => show('shelf'),
});

// enter()/leave() hooks, like OnEnable/OnDisable.
const hooks = { record };

const TAPE_SCREENS = new Set(['blue', 'playback', 'backonit']);
function show(name, { force = false } = {}) {
  // The tape's part is over (STOP, or on from BACK ON IT): in the room the VCR ejects it.
  if (room && TAPE_SCREENS.has(current) && !TAPE_SCREENS.has(name)) room.tapeDone();
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
  else hideNote(); // the note line belongs to the shelf
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
  renderShelf(screens.shelf.querySelector('[data-shelf]'), visibleTapes(tapes, today), today, {
    onRecord: () => show('record'),
    onSelect: selectTape,
    onErase: askErase,
  });
  // Above the shelf: how fast the player has got going again, on average.
  const stats = backOnItStats(tapes);
  const line = screens.shelf.querySelector('[data-shelf-stats]');
  line.hidden = !stats;
  if (stats) line.textContent = `AVERAGE BACK ON IT · ${stats.avg} MIN · ${stats.count} ${stats.count === 1 ? 'TAPE' : 'TAPES'}`;
}

// ⏏ on a tape: erase it for good, after a confirmation screen.
function askErase(tape) {
  eraseTape = tape;
  const line = (text) => Object.assign(document.createElement('span'), { className: 'early__line', textContent: text });
  screens.erase.querySelector('[data-erase-text]').replaceChildren(line(`ERASE ${tape.project.toUpperCase()}?`));
  show('erase');
}
function eraseNow() {
  if (!eraseTape) return;
  if (eraseTape.sample) eraseSample();
  else {
    tapes = tapes.filter((t) => t.id !== eraseTape.id);
    saveTapes(tapes);
    deleteVoice(eraseTape.id);
  }
  eraseTape = null;
  show('shelf');
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
  const name = downloadIcs(savedTape, tapeLink(savedTape, appAddress()));
  const note = screens.saved.querySelector('[data-ics-note]');
  note.textContent = `SAVED ${name.toUpperCase()}`;
  note.hidden = false;
});
document.querySelector('[data-action="early-play"]').addEventListener('click', () => play(earlyTape, 'return'));
document.querySelector('[data-action="early-cancel"]').addEventListener('click', () => show('shelf'));
// BACK ON IT returns by itself after a few seconds, or right away when tapped. Pointing at or
// focusing its buttons holds it there, so PAUSE AGAIN can be pressed without a rush.
screens.backonit.addEventListener('click', (e) => { if (!e.target.closest('button')) show('shelf'); });
const holdBackOnIt = () => clearTimeout(backOnItTimer);
screens.backonit.querySelector('.saved__actions').addEventListener('pointerenter', holdBackOnIt);
screens.backonit.querySelector('.saved__actions').addEventListener('focusin', holdBackOnIt);
document.querySelector('[data-action="backonit-shelf"]').addEventListener('click', () => show('shelf'));
// PAUSE AGAIN: record a new tape for the same project, its name filled in.
document.querySelector('[data-action="pause-again"]').addEventListener('click', () => {
  record.prefill({ project: lastPlayed?.project ?? '' });
  show('record', { keep: true });
});
document.querySelector('[data-action="erase-confirm"]').addEventListener('click', eraseNow);
document.querySelector('[data-action="erase-cancel"]').addEventListener('click', () => { eraseTape = null; show('shelf'); });

// BACKUP saves the tapes as a .json file (not the photo); RESTORE adds the tapes from one.
const backupNote = screens.shelf.querySelector('[data-backup-note]');
// sticky: a note about a tape link stays until the player leaves the shelf. In the room the shelf is
// only seen once the camera is in the TV, which can be long after the page opened.
function note(text, { sticky = false } = {}) {
  backupNote.textContent = text;
  backupNote.hidden = false;
  clearTimeout(note.timer);
  if (!sticky) note.timer = setTimeout(hideNote, 5000);
}
function hideNote() {
  clearTimeout(note.timer);
  backupNote.hidden = true;
}
document.querySelector('[data-action="backup"]').addEventListener('click', () => {
  const blob = new Blob([buildBackup(tapes)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: `pause-tape-backup-${todayLocal()}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  note(`SAVED ${tapes.length} ${tapes.length === 1 ? 'TAPE' : 'TAPES'}`);
});
const restoreFile = document.querySelector('[data-restore-file]');
document.querySelector('[data-action="restore"]').addEventListener('click', () => restoreFile.click());
restoreFile.addEventListener('change', async () => {
  const file = restoreFile.files[0];
  restoreFile.value = '';
  if (!file) return;
  const incoming = parseBackup(await file.text());
  if (!incoming) { note('NOT A PAUSE TAPE BACKUP'); return; }
  const merged = mergeTapes(tapes, incoming);
  tapes = merged.list;
  saveTapes(tapes);
  keepTapes();
  drawShelf();
  note(merged.added ? `RESTORED ${merged.added} ${merged.added === 1 ? 'TAPE' : 'TAPES'}` : 'NOTHING NEW IN THAT BACKUP');
});

// The shader layer starts once; if WebGL isn't available the CSS layer keeps working.

const touchOnly = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;
startCrt(document.querySelector('.tv__screen'), {
  getVhs: () => (highContrast() ? 0.1 : VHS[current] ?? 0.5), // high contrast calms the picture
  reducedMotion,
  // In the room the scanline layer only needs redrawing while the camera is at (or going into) the TV.
  active: () => !room || room.nearTv(),
  maxDpr: touchOnly ? 1.5 : 2, // phones: a lighter layer
});

// ── Tape link (js/tapelink.js): the calendar event's copy of a tape ──
// Opening the link puts its tape on this browser's shelf if it isn't here yet: a phone, another
// browser, or one that cleared its storage. Like RESTORE, nothing on the shelf is overwritten.
function appAddress() {
  return location.origin + location.pathname; // the app itself, without demo pins (?time=…) or a hash
}
function takeTapeFromLink() {
  const found = tapeFromHash(location.hash);
  if (!found) return;
  history.replaceState(null, '', location.pathname + location.search); // a clean address bar
  if (found.broken) { note('THAT TAPE LINK IS BROKEN', { sticky: true }); return; }
  const merged = mergeTapes(tapes, [found.tape]);
  if (!merged.added) return; // already on this shelf
  tapes = merged.list;
  try { saveTapes(tapes); } catch { /* storage blocked: the tape is on the shelf for this visit */ }
  keepTapes();
  if (current === 'shelf') drawShelf();
  note('TAPE RESTORED FROM LINK', { sticky: true });
}
takeTapeFromLink();
window.addEventListener('hashchange', takeTapeFromLink);
// Tapes from earlier visits: ask once per load too (Chrome, Edge and Safari decide without a prompt;
// Firefox asks the player once and remembers the answer).
if (tapes.length) keepTapes();

show('shelf');

// MUSIC on / off: one button in the top-left corner, in the room and on the flat TV (learner request:
// it switches only the lo-fi music; the room's other sounds start at the first click and the full mute
// is SOUND in the room controls).
const soundBtn = document.querySelector('[data-sound-quick]');
function syncSoundButton() {
  soundBtn.setAttribute('aria-pressed', String(musicOn()));
  soundBtn.setAttribute('aria-label', musicOn() ? 'Turn music off' : 'Turn music on');
  soundBtn.querySelector('[data-sound-text]').textContent = musicOn() ? 'MUSIC ON' : 'MUSIC OFF';
  soundBtn.classList.toggle('is-on', musicOn());
}
soundBtn.addEventListener('click', () => { setMusic(!musicOn()).then(syncSoundButton); });
onPrefsChange(syncSoundButton);
syncSoundButton();
resumeOnFirstClick();

// ?sounddebug: a small line at the bottom showing the audio state, so a sound problem on a real phone
// can be read off the screen (there's no developer console on a phone).
if (new URLSearchParams(location.search).has('sounddebug')) {
  const line = document.createElement('div');
  line.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;padding:4px 8px;background:#000c;color:#62ff8f;font:14px monospace;pointer-events:none';
  document.body.append(line);
  let taps = 0;
  window.addEventListener('pointerup', () => { taps++; }, { capture: true });
  import('./sound.js').then((m) => setInterval(() => {
    const s = m.soundState();
    const n = Object.values(s.played).reduce((x, v) => x + v, 0);
    line.textContent = `AUDIO ${s.ctx} · SOUND ${s.on ? 'ON' : 'OFF'} · MUSIC ${s.music ? 'ON' : 'OFF'} · LEVEL ${s.gain.toFixed(2)} · STARTED ${s.started ? 'YES' : 'NO'} · EFFECTS ${n} · TAPS ${taps}`;
  }, 300));
}

// The room around the TV (prd.md > The room around the TV): a laptop or desktop window with WebGL.
// On a phone, or if anything fails, the app stays the flat TV above, which works on its own.
// While the room loads, a VCR-style loading screen shows how far along it is and roughly how long
// is left (from the speed so far), so a slow connection never looks frozen.
const loading = document.querySelector('[data-room-loading]');
let roomLoaded = false;
function showLoading(fraction, startedAt) {
  if (roomLoaded) return; // the room is up: nothing may bring this screen back
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
  if (!gl && !asked) {
    // No WebGL: the app works as the flat TV; say so once, quietly.
    const note = document.querySelector('[data-no-webgl]');
    note.hidden = false;
    setTimeout(() => { note.hidden = true; }, 6000);
  }
  // The room runs on laptops, desktops and (learner request, 4 Oct 2026) phones and tablets too, by
  // touch, in a lighter mode (js/room.js: LITE). Only a tiny window keeps the flat TV.
  const roomFits = Math.max(window.innerWidth, window.innerHeight) >= 560 && Math.min(window.innerWidth, window.innerHeight) >= 300;
  if (!gl || !roomFits || asked) return;
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
    roomLoaded = true;
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
