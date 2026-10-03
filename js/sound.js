// Sound (prd.md > The room around the TV): every sound is made in code with the Web Audio API, so the
// app ships no audio files and no third-party recordings. Like an AudioMixer in Unity: one master gain
// (the SOUND switch), an ambience bus (rain, the clock, a quiet lo-fi loop) and an effects bus (VCR
// click, tape going in, TV static). Nothing plays until the player turns SOUND on, which is also the
// click browsers require before any audio can start. Off by default.

import { soundOn, setPref, reducedMotion } from './prefs.js';

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
let rainBus = null;
let seasonBus = null;
let seasonTimer = null;
let season = 'spring';
let seasonNodes = [];
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
  seasonBus = ctx.createGain();
  seasonBus.gain.value = 1;
  seasonBus.connect(ambience);
  noiseBuffer = makeNoise(2);
}

// ── Ambience ─────────────────────────────────────────────────────────

// Rain on the window: filtered noise, a soft bed plus a brighter patter that swells slowly.
function startRain() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 1100;
  rainBus = ctx.createGain();
  rainBus.gain.value = rainOn() ? 1 : 0;
  rainBus.connect(ambience);
  const bed = ctx.createGain();
  bed.gain.value = 0.16;
  src.connect(low).connect(bed).connect(rainBus);
  const high = ctx.createBiquadFilter();
  high.type = 'bandpass';
  high.frequency.value = 3200;
  high.Q.value = 0.7;
  const patter = ctx.createGain();
  patter.gain.value = 0.05;
  src.connect(high).connect(patter).connect(rainBus);
  const lfo = ctx.createOscillator(); // the rain swells and eases every few seconds
  lfo.frequency.value = 0.09;
  const depth = ctx.createGain();
  depth.gain.value = 0.03;
  lfo.connect(depth).connect(patter.gain);
  src.start();
  lfo.start();
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
  lp.connect(g).connect(ambience);
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
  o.connect(g).connect(ambience);
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
  src.connect(hp).connect(g).connect(ambience);
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

// ── Season ambience (learner choice): snow = a soft cold wind, spring = birds, summer = cicadas
// and crickets, dry season = a dry gusty wind with rustling leaves. All from noise and oscillators.
function windBed(t, { f0, f1, q, v, rate }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f0;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = v;
  src.connect(bp).connect(g).connect(seasonBus);
  const lfo = ctx.createOscillator(); // gusts: the wind's pitch and loudness swell slowly
  lfo.frequency.value = rate;
  const lf = ctx.createGain();
  lf.gain.value = (f1 - f0) / 2;
  lfo.connect(lf).connect(bp.frequency);
  const lg = ctx.createGain();
  lg.gain.value = v * 0.6;
  lfo.connect(lg).connect(g.gain);
  src.start(t);
  lfo.start(t);
  seasonNodes.push(src, lfo);
}
function chirp(at) { // one bird call: two to four quick falling whistles
  const n = 2 + Math.floor(Math.random() * 3);
  const base = 2600 + Math.random() * 1600;
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t0 = at + i * (0.09 + Math.random() * 0.05);
    o.frequency.setValueAtTime(base * 1.25, t0);
    o.frequency.exponentialRampToValueAtTime(base * 0.8, t0 + 0.07);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    o.connect(g).connect(seasonBus);
    o.start(t0);
    o.stop(t0 + 0.1);
  }
}
function cicadas(t) { // a steady buzzing drone that swells, plus slow cricket chirps
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 4200;
  const am = ctx.createOscillator(); // the fast pulsing of the buzz
  am.frequency.value = 38;
  const amg = ctx.createGain();
  amg.gain.value = 0.5;
  const g = ctx.createGain();
  g.gain.value = 0.5;
  am.connect(amg).connect(g.gain);
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 5200;
  hp.Q.value = 3;
  const out = ctx.createGain();
  out.gain.value = 0.012;
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.07;
  const sw = ctx.createGain();
  sw.gain.value = 0.008;
  swell.connect(sw).connect(out.gain);
  o.connect(g).connect(hp).connect(out).connect(seasonBus);
  o.start(t); am.start(t); swell.start(t);
  seasonNodes.push(o, am, swell);
}
function cricket(at) {
  for (let i = 0; i < 3; i++) tone(at + i * 0.06, { f: 4700, v: 0.02, dur: 0.035, type: 'sine', bus: seasonBus });
}
function rustle(at) { // dry leaves skittering
  for (let i = 0; i < 6; i++) hit(at + i * 0.03 + Math.random() * 0.03, { f: 2500 + Math.random() * 2500, q: 2, v: 0.04, dur: 0.04, bus: seasonBus });
}
function startSeasonSound() {
  for (const n of seasonNodes) { try { n.stop(); } catch { /* already stopped */ } }
  seasonNodes = [];
  clearInterval(seasonTimer);
  if (!ctx) return;
  const t = ctx.currentTime + 0.05;
  if (season === 'snow') windBed(t, { f0: 380, f1: 700, q: 0.9, v: 0.05, rate: 0.06 });
  if (season === 'dry') windBed(t, { f0: 900, f1: 1800, q: 0.6, v: 0.04, rate: 0.11 });
  if (season === 'summer') cicadas(t);
  seasonTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (season === 'spring' && Math.random() < 0.45) chirp(now + Math.random() * 0.5);
    if (season === 'summer' && Math.random() < 0.5) cricket(now + Math.random() * 0.5);
    if (season === 'dry' && Math.random() < 0.25) rustle(now + Math.random() * 0.5);
  }, 900);
}
// Called by the room whenever the season changes (and once at start).
export function setSeasonSound(name) {
  season = name;
  if (started) startSeasonSound();
}
export function setRain(on) {
  try { localStorage.setItem(RAIN_KEY, on ? 'on' : 'off'); } catch { /* this visit only */ }
  if (rainBus) rainBus.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.4);
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
    await ctx.resume();
    if (!started) {
      started = true;
      startRain();
      startClock();
      startLofi();
      startSeasonSound();
    }
    master.gain.setTargetAtTime(reducedMotion() ? 0.7 : 0.7, ctx.currentTime, 0.4); // fade in
  } else if (ctx) {
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.15); // fade out
  }
  return on;
}

// A saved "on" waits for the player's first click anywhere, since browsers block sound before it.
export function resumeOnFirstClick() {
  if (!soundOn()) return;
  const go = () => { setSound(true); };
  window.addEventListener('pointerdown', go, { once: true, capture: true });
  window.addEventListener('keydown', go, { once: true, capture: true });
}

export const soundState = () => ({ on: soundOn(), ctx: ctx?.state ?? 'none', started, gain: master?.gain.value ?? 0, played: { ...played }, season, seasonNodes: seasonNodes.length, rain: rainOn(), rainGain: rainBus?.gain.value ?? null });
export { lofiTimer, tickTimer };
