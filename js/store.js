// Tape store: the only file that touches localStorage, the web's PlayerPrefs.
// Like PlayerPrefs it only holds strings, so the tape list travels as JSON text
// (JSON.stringify is the web's JsonUtility.ToJson). See spec.md > Data Model.

import { isDate, todayLocal } from './tapes.js';

const KEY = 'pausetape.tapes.v1';

// Missing or broken data gives an empty shelf instead of a crash
// (spec.md > Important Failure Modes).
export function loadTapes() {
  let list;
  try {
    list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
  return Array.isArray(list) ? list.filter(isTape) : [];
}

export function saveTapes(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

// Ask the browser to keep the tapes until the player deletes them (persistent storage), like asking
// the OS not to clean up a save folder. Without it a browser may clear the site's data to free space,
// and Safari can clear it after 7 days of use without a visit, shorter than most pauses. Chrome and
// Edge decide silently, Firefox asks the player once, and Safari mostly says no outside a Home Screen
// web app; the calendar's tape link (js/tapelink.js) is the copy that outlives all of that.
export function keepTapes() {
  try {
    const storage = globalThis.navigator?.storage;
    if (!storage?.persist) return;
    Promise.resolve(storage.persisted?.() ?? false)
      .then((already) => already || storage.persist())
      .catch(() => {});
  } catch { /* not available here: the tapes are still saved as before */ }
}

// ── The sample tape (for a first visit, and for judges) ──────────────
// Shown only while the shelf has none of the player's own tapes, until the player erases it. It's
// always READY and never saved: playing it and pressing "I'm back on it" leaves it as it was.
const SAMPLE_KEY = 'pausetape.sample.v1';
export const SAMPLE_ID = 'sample';

export function sampleTape(today = todayLocal()) {
  const [y, m, d] = today.split('-').map(Number);
  const recorded = new Date(y, m - 1, d - 14, 20, 30); // two weeks ago, in the evening
  return {
    id: SAMPLE_ID,
    sample: true,
    project: 'Pause Tape',
    returnDate: today,
    stopped: 'The shelf, the Record Screen and this playback all work. The 3D room around the TV is in, with sound.',
    unsure: 'Whether ten minutes is the right size for a first step, or whether it should be five.',
    why: 'Coming back to a paused side project is the hardest part. A short note from past me makes it easy to start again.',
    firstStep: 'Press REC and record a tape for one of your own paused projects.',
    recordedAt: recorded.toISOString(),
    backOnItMinutes: null,
    completedAt: null,
  };
}

export function sampleErased() {
  try { return localStorage.getItem(SAMPLE_KEY) === 'erased'; } catch { return false; }
}

export function eraseSample() {
  try { localStorage.setItem(SAMPLE_KEY, 'erased'); } catch { /* storage blocked: gone for this visit */ }
}

// What the shelf shows: the player's tapes, or the sample tape while there are none.
export function visibleTapes(list, today = todayLocal()) {
  return list.length > 0 || sampleErased() ? list : [sampleTape(today)];
}

// ── Backup: the tapes as a JSON file (the player's photo and voice notes are not included) ──
export function buildBackup(list, now = new Date()) {
  // Voice notes stay in this browser (they're audio, too big for a text file), so the copy drops voiceMs.
  const tapes = list.map(({ voiceMs, ...t }) => t);
  return JSON.stringify({ app: 'pause-tape', version: 1, exportedAt: now.toISOString(), tapes }, null, 2);
}

// Reads a backup file's text. Returns the valid tapes in it, or null if it isn't a Pause Tape backup.
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || data.app !== 'pause-tape' || !Array.isArray(data.tapes)) return null;
  return data.tapes.filter(isTape).filter((t) => t.id !== SAMPLE_ID);
}

// Restoring adds the backup's tapes that aren't on the shelf yet (matched by id); nothing is overwritten.
export function mergeTapes(list, incoming) {
  const have = new Set(list.map((t) => t.id));
  const added = incoming.filter((t) => !have.has(t.id));
  return { list: [...list, ...added], added: added.length };
}

export function isTape(t) {
  return t !== null && typeof t === 'object'
    && typeof t.id === 'string'
    && typeof t.project === 'string'
    && typeof t.recordedAt === 'string'
    && typeof t.returnDate === 'string' && isDate(t.returnDate);
}
