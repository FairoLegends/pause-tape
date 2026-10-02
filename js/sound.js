// Sound (prd.md > The room around the TV): every sound is made in code with the Web Audio API, so the
// app ships no audio files and no third-party recordings. Like an AudioMixer in Unity: one master gain
// (the SOUND switch), an ambience bus (rain, the clock, a quiet lo-fi loop) and an effects bus (VCR
// click, tape going in, TV static). Nothing plays until the player turns SOUND on, which is also the
// click browsers require before any audio can start. Off by default.

import { soundOn, setPref, reducedMotion } from './prefs.js';

let ctx = null;
let master;
let ambience;
let effects;
let noiseBuffer;
let started = false;
let lofiTimer = null;
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
  const bed = ctx.createGain();
  bed.gain.value = 0.16;
  src.connect(low).connect(bed).connect(ambience);
  const high = ctx.createBiquadFilter();
  high.type = 'bandpass';
  high.frequency.value = 3200;
  high.Q.value = 0.7;
  const patter = ctx.createGain();
  patter.gain.value = 0.05;
  src.connect(high).connect(patter).connect(ambience);
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

// ── Effects ──────────────────────────────────────────────────────────

// The VCR's button: a short mechanical clack.
export function vcrClick() {
  if (!live()) return;
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

// A cassette going in: a plastic slide, then the motor's whirr and a thunk as it seats.
export function tapeIn() {
  if (!live()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(900, t + 0.5);
  bp.frequency.linearRampToValueAtTime(2200, t + 1.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t + 0.5);
  g.gain.linearRampToValueAtTime(0.18, t + 0.6);
  g.gain.linearRampToValueAtTime(0.0001, t + 1.35);
  src.connect(bp).connect(g).connect(effects);
  src.start(t + 0.5, 0, 0.9);
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.setValueAtTime(70, t + 1.2);
  motor.frequency.linearRampToValueAtTime(110, t + 1.9);
  const mlp = ctx.createBiquadFilter();
  mlp.type = 'lowpass';
  mlp.frequency.value = 400;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(0.0001, t + 1.2);
  mg.gain.linearRampToValueAtTime(0.05, t + 1.35);
  mg.gain.linearRampToValueAtTime(0.0001, t + 2.4);
  motor.connect(mlp).connect(mg).connect(effects);
  motor.start(t + 1.2);
  motor.stop(t + 2.5);
  const thunk = ctx.createOscillator();
  thunk.frequency.setValueAtTime(160, t + 1.35);
  thunk.frequency.exponentialRampToValueAtTime(60, t + 1.5);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.25, t + 1.35);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
  thunk.connect(tg).connect(effects);
  thunk.start(t + 1.35);
  thunk.stop(t + 1.6);
}

// TV static: a hiss burst, like the picture cutting between inputs.
export function staticBurst(seconds = 0.35) {
  if (!live()) return;
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

export const soundState = () => ({ on: soundOn(), ctx: ctx?.state ?? 'none', started, gain: master?.gain.value ?? 0 });
export { lofiTimer, tickTimer };
