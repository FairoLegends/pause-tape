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

// A VU meter: an AnalyserNode reads how loud the sound is about 60 times a second and calls
// onLevel(0..1). For a microphone stream it only listens; for an <audio> element the sound is routed
// through it to the speakers, which only works once the audio context is running (after a click),
// so if it isn't, the element is left alone and plays as normal without a meter.
// Returns a function that stops the meter.
export async function levelMeter(source, onLevel) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return () => {};
  const ctx = new AC();
  try { await ctx.resume(); } catch { /* stays suspended */ }
  const isStream = typeof MediaStream !== 'undefined' && source instanceof MediaStream;
  if (!isStream && ctx.state !== 'running') { ctx.close(); return () => {}; }
  const input = isStream ? ctx.createMediaStreamSource(source) : ctx.createMediaElementSource(source);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  input.connect(analyser);
  if (!isStream) analyser.connect(ctx.destination); // the voice must still reach the speakers
  const buf = new Float32Array(analyser.fftSize);
  let level = 0;
  let raf = 0;
  let stopped = false;
  const loop = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    // Speech sits around 0.02 to 0.2 RMS; a log scale spreads that over the meter.
    const target = Math.max(0, Math.min(1, (Math.log10(rms + 1e-4) + 2.6) / 2.1));
    level = target > level ? target : level * 0.9; // jumps up, falls back slowly, like a real needle
    onLevel(level);
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => { stopped = true; cancelAnimationFrame(raf); onLevel(0); if (isStream) ctx.close(); };
}

// One recording at a time. start() asks for the microphone (the browser shows its own prompt the first
// time), records until stop() or 40 s, and resolves with { blob, ms }.
export function startRecording({ onTick, onLevel } = {}) {
  let recorder;
  let stream;
  let timer;
  let ticker;
  let startedAt;
  let stopMeter = () => {};
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
        stopMeter();
        for (const track of stream.getTracks()) track.stop(); // the browser's "recording" light goes off
        const ms = Math.min(VOICE_MAX_MS, Math.round(performance.now() - startedAt));
        resolve({ blob: new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }), ms });
      };
      if (onLevel) levelMeter(stream, onLevel).then((stop) => { stopMeter = stop; if (recorder.state === 'inactive') stop(); });
      recorder.start(250);
      startedAt = performance.now();
      onTick?.(0);
      ticker = setInterval(() => onTick?.(performance.now() - startedAt), 100);
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

// Draws a level 0..1 on a .vu element as 12 cells lit from the left (green, then amber, then red),
// the way a camcorder's audio meter does.
const VU_CELLS = 12;
export function drawMeter(el, level) {
  if (el.children.length !== VU_CELLS) {
    el.replaceChildren(...Array.from({ length: VU_CELLS }, () => document.createElement('span')));
  }
  const lit = Math.round(level * VU_CELLS);
  [...el.children].forEach((c, i) => c.classList.toggle('is-on', i < lit));
  el.dataset.level = String(lit);
}
