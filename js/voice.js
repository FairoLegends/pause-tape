// Voice note (prd.md > Core Additions): an optional spoken message of at most 40 seconds, kept in
// this browser's IndexedDB, because localStorage only holds a few MB of text. IndexedDB is the
// browser's built-in database; like a save file next to PlayerPrefs, it stores the audio as a
// Blob under the tape's id. Nothing leaves the device.
// The tape itself only records that it has a note (voiceMs); the sound is loaded when it plays.

export const VOICE_MAX_MS = 40_000;

const DB_NAME = 'pausetape';
const STORE = 'voice';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const saveVoice = (id, blob) => run('readwrite', (s) => s.put(blob, id));
export const loadVoice = (id) => run('readonly', (s) => s.get(id)).catch(() => undefined);
export const deleteVoice = (id) => run('readwrite', (s) => s.delete(id)).catch(() => undefined);

// Can this browser record? (A microphone API, a recorder, and a page served over https or localhost.)
export function canRecord() {
  return Boolean(globalThis.MediaRecorder && navigator.mediaDevices?.getUserMedia && globalThis.isSecureContext);
}

// One recording at a time. start() asks for the microphone (the browser shows its own prompt the first
// time), records until stop() or 40 s, and resolves with { blob, ms }.
export function startRecording({ onTick } = {}) {
  let recorder;
  let stream;
  let timer;
  let ticker;
  let startedAt;
  const done = new Promise((resolve, reject) => {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
      stream = s;
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t));
      recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        clearTimeout(timer);
        clearInterval(ticker);
        for (const track of stream.getTracks()) track.stop(); // the browser's "recording" light goes off
        const ms = Math.min(VOICE_MAX_MS, Math.round(performance.now() - startedAt));
        resolve({ blob: new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }), ms });
      };
      recorder.start(250);
      startedAt = performance.now();
      onTick?.(0);
      ticker = setInterval(() => onTick?.(performance.now() - startedAt), 200);
      timer = setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), VOICE_MAX_MS);
    }, reject);
  });
  return {
    done,
    stop() { if (recorder && recorder.state !== 'inactive') recorder.stop(); },
  };
}

// "0:07 / 0:40"
export function voiceClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
