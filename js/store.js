// Tape store: the only file that touches localStorage, the web's PlayerPrefs.
// Like PlayerPrefs it only holds strings, so the tape list travels as JSON text
// (JSON.stringify is the web's JsonUtility.ToJson). See spec.md > Data Model.

import { isDate } from './tapes.js';

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

function isTape(t) {
  return t !== null && typeof t === 'object'
    && typeof t.id === 'string'
    && typeof t.project === 'string'
    && typeof t.recordedAt === 'string'
    && typeof t.returnDate === 'string' && isDate(t.returnDate);
}
