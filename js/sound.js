// Sound (prd.md > The room around the TV): every sound is made in code with the Web Audio API, so the
// app ships no audio files and no third-party recordings. Like an AudioMixer in Unity: one master gain
// (the SOUND switch), an ambience bus (the view outside the window, the clock, a quiet lo-fi loop) and an effects bus (VCR
// click, tape going in, TV static). Nothing plays until the player turns SOUND on, which is also the
// click browsers require before any audio can start. Off by default.

import { soundOn, musicOn, setPref, reducedMotion } from './prefs.js';
import { createAmbience, SEASONS, PERIODS } from './ambience.js';

// Rain is a separate switch (learner choice: only when picked), saved in this browser.
const RAIN_KEY = 'pausetape.rain.v1';
export function rainOn() { try { return localStorage.getItem(RAIN_KEY) === 'on'; } catch { return false; } }

let ctx = null;
let master;
let ambience;
let effects;
let noiseBuffer;
let started = false;
let lofiTimer = null;
let musicBus = null;
let amb = null; // the view outside the window (js/ambience.js): birds, insects, wind, rain on clay tiles
let season = 'spring';
let period = null; // null = follow the clock until the room says which time of day it shows
let curtainOpen = true;
let periodTimer = null;
const played = {}; // how many times each effect has played (for the checks)
let tickTimer = null;

function makeNoise(seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function setup() {
  if (ctx) return;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  ambience = ctx.createGain();
  ambience.gain.value = 0.55;
  ambience.connect(master);
  effects = ctx.createGain();
  effects.gain.value = 0.8;
  effects.connect(master);
  musicBus = ctx.createGain(); // the lo-fi loop: the MUSIC switch
  musicBus.gain.value = musicOn() ? 1 : 0;
  musicBus.connect(ambience);
  noiseBuffer = makeNoise(2);
}

// ── Ambience ─────────────────────────────────────────────────────────

// The view through the window: birds, insects, wind and rain on clay roof tiles. All of it is made by
// js/ambience.js (one scene per season x time of day, plus the rain) on this same AudioContext, like
// one AudioMixer group in Unity. OUTDOOR_GAIN keeps it under the clock's tick: measured on offline
// renders, the outdoors sit 3 to 48 dB below the tick in the tick's own bands (1.9 and 2.6 kHz).
const OUTDOOR_GAIN = 0.28;
const periodFor = (hour) => (hour >= 5 && hour < 10 ? 'morning' : hour >= 10 && hour < 15 ? 'day' : hour >= 15 && hour < 18 ? 'afternoon' : 'night');
const scenePeriod = () => period ?? periodFor(new Date().getHours()); // the same hours as the room's clock
const sceneNow = () => ({ season, period: scenePeriod(), rain: rainOn(), curtainOpen });
// The rain is a real recording (DonRain, "Rain (on the window)", Pixabay Content License), cut into a 60 s loop.
// It is fetched and decoded once; if that fails, the code-made rain plays instead.
let rainBuffer = null;
let rainLoading = null;
function loadRainRecording() {
  rainLoading ??= fetch(new URL('../assets/audio/rain-window.mp3', import.meta.url))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => ctx.decodeAudioData(b))
    .then((buf) => { rainBuffer = buf; })
    .catch((err) => { console.warn('rain recording not loaded, using the synthesised rain', err); });
  return rainLoading;
}
function startAmbience() {
  if (amb || !ctx) return;
  try {
    const outdoor = ctx.createGain();
    outdoor.gain.value = OUTDOOR_GAIN;
    outdoor.connect(ambience);
    const lite = Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches); // phones: fewer voices
    amb = createAmbience(ctx, outdoor, { lite, rainBuffer });
    amb.setScene(sceneNow());
    amb.start();
    // Until the room names a period, follow the clock: look again every minute.
    periodTimer = setInterval(() => { if (period === null) amb?.setScene(sceneNow()); }, 60000);
  } catch (err) {
    amb = null; // the clock, the music and the effects still work without the window sound
    console.warn('ambience could not start', err);
  }
}

// The grandfather clock: a wooden tick every second, the tock a little lower.
function tick(high) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = high ? 2600 : 1900;
  bp.Q.value = 9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  src.connect(bp).connect(g).connect(ambience);
  src.start(t, Math.random(), 0.08);
}
function startClock() {
  let high = true;
  tickTimer = setInterval(() => { tick(high); high = !high; }, 1000);
}

// A quiet lo-fi loop: four soft electric-piano chords (Fmaj7, Em7, Dm7, Cmaj7), slightly detuned and
// low-passed, with a muffled kick and a brushed snare. About 72 BPM.
const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
function chord(notes, t, len) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.02, t + len * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  lp.connect(g).connect(musicBus);
  for (const n of notes) {
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz(n);
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  }
}
function kick(t) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  o.connect(g).connect(musicBus);
  o.start(t);
  o.stop(t + 0.3);
}
function snare(t) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  src.connect(hp).connect(g).connect(musicBus);
  src.start(t, Math.random(), 0.2);
}
function startLofi() {
  const beat = 60 / 72;
  const bar = beat * 4;
  let next = ctx.currentTime + 0.2;
  let i = 0;
  const schedule = () => { // schedule a bar ahead, like a sequencer
    while (next < ctx.currentTime + bar * 1.5) {
      chord(CHORDS[i % CHORDS.length], next, bar * 0.95);
      kick(next);
      kick(next + beat * 2.5);
      snare(next + beat);
      snare(next + beat * 3);
      next += bar;
      i++;
    }
  };
  schedule();
  lofiTimer = setInterval(schedule, 500);
}

// ── Scene: season, time of day, rain, curtain ────────────────────────
// The room calls setScene whenever something it shows changes (partial updates are fine); the ambience
// crossfades to the new scene over about two seconds. Season is snow | spring | summer | dry, period is
// morning | day | afternoon | night.
export function setScene(next = {}) {
  if (SEASONS.includes(next.season)) season = next.season;
  if (PERIODS.includes(next.period)) period = next.period;
  if (typeof next.curtainOpen === 'boolean') curtainOpen = next.curtainOpen;
  amb?.setScene(sceneNow());
}
// The older call, season only.
export function setSeasonSound(name) { setScene({ season: name }); }
// The breeze (0..1), about ten times a second, so the sound swells with the swaying trees.
export function setWind(level) { amb?.setWind(Number(level) || 0); }
export function setRain(on) {
  try { localStorage.setItem(RAIN_KEY, on ? 'on' : 'off'); } catch { /* this visit only */ }
  amb?.setScene(sceneNow());
}

// ── Effects ──────────────────────────────────────────────────────────

// The VCR's button: a short mechanical clack.
export function vcrClick() {
  if (!live()) return;
  played.vcrClick = (played.vcrClick ?? 0) + 1;
  const t = ctx.currentTime;
  for (const [f, at, v] of [[1400, 0, 0.5], [700, 0.035, 0.3]]) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(v, t + at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.05);
    src.connect(bp).connect(g).connect(effects);
    src.start(t + at, Math.random(), 0.07);
  }
}

// One short filtered-noise hit: the building block of clicks, ticks and rattles.
function hit(at, { f, q = 5, v, dur = 0.05, type = 'bandpass', bus = effects }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = f;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(v, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(bus);
  src.start(at, Math.random() * 1.5, dur + 0.03);
}

// One short tone with a quick fall-off.
function tone(at, { f, to = f, v, dur, type = 'sine', bus = effects }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  if (to !== f) o.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(v, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// A cassette going in: a plastic slide, then the motor's whirr and a thunk as it seats.
// In the room it waits 0.5 s for the camera to reach the VCR; on the flat TV it plays at once, quicker.
export function tapeIn({ delay = 0.5, scale = 1 } = {}) {
  if (!live()) return;
  played.tapeIn = (played.tapeIn ?? 0) + 1;
  const T = (x) => ctx.currentTime + delay + (x - 0.5) * scale; // the original timings, moved and scaled
  // The flap of the cassette door clicks open first.
  hit(T(0.5), { f: 2400, q: 6, v: 0.35, dur: 0.04 });
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(900, T(0.52));
  bp.frequency.linearRampToValueAtTime(2200, T(1.3));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, T(0.52));
  g.gain.linearRampToValueAtTime(0.2, T(0.62));
  g.gain.linearRampToValueAtTime(0.0001, T(1.35));
  src.connect(bp).connect(g).connect(effects);
  src.start(T(0.52), 0, 0.9 * scale + 0.05);
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.setValueAtTime(70, T(1.2));
  motor.frequency.linearRampToValueAtTime(110, T(1.9));
  const mlp = ctx.createBiquadFilter();
  mlp.type = 'lowpass';
  mlp.frequency.value = 400;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(0.0001, T(1.2));
  mg.gain.linearRampToValueAtTime(0.06, T(1.35));
  mg.gain.linearRampToValueAtTime(0.0001, T(2.4));
  motor.connect(mlp).connect(mg).connect(effects);
  motor.start(T(1.2));
  motor.stop(T(2.5));
  // The thunk as it seats, and the tray locking down with two small clicks.
  tone(T(1.35), { f: 160, to: 60, v: 0.3, dur: 0.2 });
  hit(T(1.36), { f: 900, q: 3, v: 0.25, dur: 0.06 });
  hit(T(1.62), { f: 1700, q: 7, v: 0.18, dur: 0.035 });
  hit(T(1.7), { f: 1300, q: 7, v: 0.14, dur: 0.035 });
}

// Eject: the motor whirrs the tray up, a clunk, then the cassette slides out with a plastic scrape.
export function tapeOut() {
  if (!live()) return;
  played.tapeOut = (played.tapeOut ?? 0) + 1;
  const t = ctx.currentTime;
  hit(t, { f: 1500, q: 7, v: 0.3, dur: 0.04 }); // the EJECT button
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.setValueAtTime(110, t + 0.05);
  motor.frequency.linearRampToValueAtTime(70, t + 0.55);
  const mlp = ctx.createBiquadFilter();
  mlp.type = 'lowpass';
  mlp.frequency.value = 400;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(0.0001, t + 0.05);
  mg.gain.linearRampToValueAtTime(0.06, t + 0.15);
  mg.gain.linearRampToValueAtTime(0.0001, t + 0.6);
  motor.connect(mlp).connect(mg).connect(effects);
  motor.start(t + 0.05);
  motor.stop(t + 0.65);
  tone(t + 0.6, { f: 140, to: 70, v: 0.25, dur: 0.16 }); // the tray unlocks
  hit(t + 0.61, { f: 800, q: 3, v: 0.2, dur: 0.06 });
  const src = ctx.createBufferSource(); // the cassette sliding out
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2200, t + 0.7);
  bp.frequency.linearRampToValueAtTime(900, t + 1.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t + 0.7);
  g.gain.linearRampToValueAtTime(0.16, t + 0.78);
  g.gain.linearRampToValueAtTime(0.0001, t + 1.3);
  src.connect(bp).connect(g).connect(effects);
  src.start(t + 0.7, 0, 0.7);
}

// The blue loading screen: the VCR's motor and spinning head hum while the tape is read, a soft tick
// as each of the 20 blocks lights (the same timing as motion.js loadBar), and a clunk at the end.
export function loadingWhirr(seconds) {
  if (!live()) return;
  played.loadingWhirr = (played.loadingWhirr ?? 0) + 1;
  const t = ctx.currentTime;
  const end = t + seconds;
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.setValueAtTime(48, t);
  motor.frequency.linearRampToValueAtTime(60, t + Math.min(0.6, seconds * 0.3));
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(0.0001, t);
  mg.gain.linearRampToValueAtTime(0.05, t + 0.2);
  mg.gain.setValueAtTime(0.05, end - 0.15);
  mg.gain.linearRampToValueAtTime(0.0001, end);
  motor.connect(lp).connect(mg).connect(effects);
  motor.start(t);
  motor.stop(end + 0.05);
  const head = ctx.createOscillator(); // the video head drum: a faint, rising whine
  head.frequency.setValueAtTime(420, t);
  head.frequency.linearRampToValueAtTime(600, t + seconds * 0.5);
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.0001, t);
  hg.gain.linearRampToValueAtTime(0.012, t + 0.4);
  hg.gain.setValueAtTime(0.012, end - 0.15);
  hg.gain.linearRampToValueAtTime(0.0001, end);
  head.connect(hg).connect(effects);
  head.start(t);
  head.stop(end + 0.05);
  const hiss = ctx.createBufferSource(); // tape hiss under it
  hiss.buffer = noiseBuffer;
  hiss.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.linearRampToValueAtTime(0.025, t + 0.3);
  sg.gain.setValueAtTime(0.025, end - 0.15);
  sg.gain.linearRampToValueAtTime(0.0001, end);
  hiss.connect(hp).connect(sg).connect(effects);
  hiss.start(t);
  hiss.stop(end + 0.05);
  const step = (seconds * 0.9) / 20;
  for (let i = 1; i <= 20; i++) hit(t + i * step, { f: 2900, q: 10, v: 0.07, dur: 0.025 });
  hit(end - 0.02, { f: 700, q: 3, v: 0.2, dur: 0.08 });
}

// Text appearing on the TV, letter by letter: a very soft, slightly varied tick (at most ~30 a second).
let lastTick = 0;
export function textTick() {
  if (!live()) return;
  played.textTick = (played.textTick ?? 0) + 1;
  const t = ctx.currentTime;
  if (t - lastTick < 0.032) return;
  lastTick = t;
  hit(t, { f: 3200 + Math.random() * 1400, q: 9, v: 0.035, dur: 0.018 });
}

// A new answer or line arriving: a short two-step CRT blip. The first step gets a brighter one.
export function blip(kind = 'answer') {
  if (!live()) return;
  played.blip = (played.blip ?? 0) + 1;
  const t = ctx.currentTime;
  const [a, b] = kind === 'first' ? [990, 1480] : [740, 990];
  tone(t, { f: a, v: 0.05, dur: 0.07, type: 'square', bus: effects });
  tone(t + 0.075, { f: b, v: 0.04, dur: 0.09, type: 'square', bus: effects });
}

// The TV changing picture (any screen change): a soft low thump with a breath of static.
export function screenChange() {
  if (!live()) return;
  played.screenChange = (played.screenChange ?? 0) + 1;
  const t = ctx.currentTime;
  tone(t, { f: 110, to: 48, v: 0.12, dur: 0.14 });
  hit(t, { f: 5000, q: 0.7, v: 0.05, dur: 0.12, type: 'highpass' });
}

// The lamp's pull switch: click down and up; turning on adds the faint ping of the bulb warming.
export function lampSwitch(on) {
  if (!live()) return;
  played.lampSwitch = (played.lampSwitch ?? 0) + 1;
  const t = ctx.currentTime;
  hit(t, { f: on ? 2600 : 2200, q: 8, v: 0.4, dur: 0.035 });
  hit(t + 0.07, { f: on ? 1900 : 1600, q: 8, v: 0.28, dur: 0.03 });
  if (on) tone(t + 0.08, { f: 120, v: 0.025, dur: 0.35 }); // a short mains hum as the bulb lights
}

// The curtain: a fabric swish along the rod and the rings rattling as they slide. Opening rises in
// pitch, closing falls.
export function curtainSlide(opening) {
  setScene({ curtainOpen: Boolean(opening) }); // the window sound closes and opens with the curtain
  if (!live()) return;
  played.curtainSlide = (played.curtainSlide ?? 0) + 1;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(opening ? 700 : 1500, t);
  bp.frequency.linearRampToValueAtTime(opening ? 1500 : 700, t + 1.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16, t + 0.25);
  g.gain.linearRampToValueAtTime(0.06, t + 0.8);
  g.gain.linearRampToValueAtTime(0.0001, t + 1.3);
  src.connect(bp).connect(g).connect(effects);
  src.start(t, Math.random(), 1.4);
  for (let i = 0; i < 9; i++) { // the rings: small metallic clicks, bunched early like a real pull
    const at = t + 0.05 + (i / 9) ** 1.4 * 0.95 + Math.random() * 0.04;
    hit(at, { f: 4600 + Math.random() * 1800, q: 14, v: 0.06 + Math.random() * 0.04, dur: 0.03 });
  }
}

// The 10-minute timer running out: three soft beeps, like a VCR's alarm.
export function timerAlarm() {
  if (!live()) return;
  played.timerAlarm = (played.timerAlarm ?? 0) + 1;
  const t = ctx.currentTime;
  for (let i = 0; i < 3; i++) tone(t + i * 0.32, { f: 1320, v: 0.07, dur: 0.16, type: 'square' });
}

// TV static: a hiss burst, like the picture cutting between inputs.
export function staticBurst(seconds = 0.35) {
  if (!live()) return;
  played.staticBurst = (played.staticBurst ?? 0) + 1;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
  g.gain.setValueAtTime(0.12, t + seconds * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(hp).connect(g).connect(effects);
  src.start(t, Math.random(), seconds + 0.05);
}

// ── The switch ───────────────────────────────────────────────────────

const live = () => Boolean(ctx) && soundOn() && ctx.state === 'running';

// Called from a click (the SOUND button), so the browser lets the audio start.
export async function setSound(on) {
  setPref('sound', on);
  if (on) {
    setup();
    if (!ctx) return false;
    // Inside the tap itself: a silent one-sample sound unlocks audio on mobile browsers, which only
    // count sound that starts in the gesture's own call stack (an await before it is too late).
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch { /* old browser */ }
    // resume() can hang on a phone when the gesture didn't count; don't wait on it forever.
    await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
    if (!started) {
      started = true;
      await Promise.race([loadRainRecording(), new Promise((r) => setTimeout(r, 4000))]); // 0.8 MB; the code-made rain is the fallback
      startAmbience();
      startClock();
      startLofi();
    } else amb?.start(); // after SOUND was switched off, the window sound comes back
    master.gain.setTargetAtTime(reducedMotion() ? 0.7 : 0.7, ctx.currentTime, 0.4); // fade in
  } else if (ctx) {
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.15); // fade out
    amb?.stop(); // the window sound fades with it, then lets go of its nodes
  }
  return on;
}

// MUSIC on / off: only the lo-fi loop (learner request). Turning music on also wakes the sound if the
// master switch was off, since the player clearly wants to hear something.
export async function setMusic(on) {
  setPref('music', on);
  if (on && !soundOn()) await setSound(true);
  else if (!ctx || ctx.state !== 'running') await setSound(soundOn()); // also wakes audio a phone left suspended
  if (musicBus) musicBus.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.3);
  return on;
}

// Sound starts at the first tap, click or key anywhere (browsers block it before one), unless the
// player turned SOUND off.
// Phones (learner report: no sound at all on an Android phone): on a touch screen the browser only
// lets audio start from the END of a tap (pointerup / touchend / click), not from pointerdown, so an
// AudioContext woken on pointerdown stays silently "suspended". Every kind of gesture is listened to
// until the audio really runs. Android and iOS also suspend the audio when the browser goes to the
// background; the next tap after coming back wakes it again.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
let onStarted = () => {};
let firstDone = false;
function wake() {
  if (!soundOn()) return;
  if (ctx && ctx.state === 'running' && started) return;
  setSound(true).then(() => {
    if (ctx?.state === 'running' && !firstDone) { firstDone = true; onStarted(); }
  }).catch(() => {});
}
export function resumeOnFirstClick(onStart = () => {}) {
  onStarted = onStart;
  for (const ev of GESTURES) window.addEventListener(ev, wake, { capture: true, passive: true });
}
// iOS reports 'interrupted' after a call or the lock screen; both come back on the next gesture.
if (globalThis.document) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running' && soundOn()) ctx.resume().catch(() => {});
  });
}
// Checks only: what the browser does when the page goes to the background.
export const __suspendForCheck = () => ctx?.suspend();

export const soundState = () => {
  const a = amb?.state() ?? null;
  return { music: musicOn(), musicGain: musicBus?.gain.value ?? null, on: soundOn(), ctx: ctx?.state ?? 'none', started, gain: master?.gain.value ?? 0, played: { ...played }, season, seasonNodes: a?.seasonNodes ?? 0, rain: rainOn(), rainGain: a ? a.rainGain : null, period: scenePeriod(), curtainOpen, ambience: a };
};
export { lofiTimer, tickTimer };
