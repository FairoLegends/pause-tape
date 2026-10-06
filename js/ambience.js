// Outdoor ambience: the view through the room's window, made entirely in code (Web Audio API).
// No audio files, no samples, no recordings. Like an AudioMixer group in Unity: every outdoor sound
// (birds, insects, wind, rain on clay roof tiles) goes into one "outdoor bus" that models the window
// (a low-pass that closes with the curtain, a short room reverb) and then into the destination.
//
// It works on ANY BaseAudioContext, so an OfflineAudioContext can render a scene to numbers for
// checks and listening previews (renderScene at the bottom). It imports nothing and touches no DOM.
//
//   const amb = createAmbience(ctx, ctx.destination, { seed: 7, lite: false });
//   amb.setScene({ season: 'summer', period: 'night', rain: false, curtainOpen: true });
//   amb.start();        // builds the layers and starts the scheduler timer (realtime contexts only)
//   amb.setWind(0.6);   // 0..1, optional: the room feeds its tree sway here
//   amb.tick(from, to); // one scheduler step (the timer calls it; offline renders call it by hand)
//
// Rules that keep it pleasant: beds are pink or brown noise, never white; nothing harsh (no raw saw or
// square above 1.5 kHz, almost nothing above 7 kHz); every event is randomised in pitch, level, timing
// and stereo position from a seeded generator (mulberry32), so a render is reproducible; noise buffers
// are long and loop seamlessly; slow changes are random walks, not clockwork LFOs, so nothing repeats
// on a beat.

export const SEASONS = ['snow', 'spring', 'summer', 'dry'];
export const PERIODS = ['morning', 'day', 'afternoon', 'night'];

const TAU = Math.PI * 2;
const LOOKAHEAD = 1.5; // seconds of events scheduled ahead of the clock
const TIMER_MS = 500; // how often the scheduler runs
const FADE_TC = 0.5; // scene crossfade time constant: 95 % after 1.5 s, 98 % after 2 s
const dbToGain = (db) => 10 ** (db / 20);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const Q_SOFT = -3; // low-pass / high-pass Q is in dB in Web Audio: -3 dB is the smooth Butterworth shape
const OUT_LEVEL = dbToGain(5); // overall level of the outdoor bus (renders land near -31 dBFS RMS); sound.js sets the mix

// ── Seeded random numbers ───────────────────────────────────────────────────────────────────────
export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const f = mulberry32(seed);
  return {
    f,
    range: (a, b) => a + (b - a) * f(),
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    pick: (list) => list[Math.floor(f() * list.length)],
    chance: (p) => f() < p,
    exp: (mean) => -Math.log(1 - f()) * mean,
    gauss: () => Math.sqrt(-2 * Math.log(1 - f())) * Math.cos(TAU * f()),
    logRange(a, b) { return a * (b / a) ** f(); },
  };
}

// ── Sample makers (plain JS maths that fill AudioBuffers once; no recordings anywhere) ──────────
function rbj(type, fs, f0, q) { // biquad coefficients (RBJ cookbook), divided by a0; only what is needed here
  const w = (TAU * f0) / fs;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  if (type === 'bp') return [al / a0, 0, -al / a0, (-2 * cs) / a0, (1 - al) / a0];
  return [((1 - cs) / 2) / a0, (1 - cs) / a0, ((1 - cs) / 2) / a0, (-2 * cs) / a0, (1 - al) / a0];
}
function runBiquad(c, x) {
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
}
function scaleTo(d, rms, peak) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const k = rms / Math.sqrt(s / d.length || 1);
  let m = 0;
  for (let i = 0; i < d.length; i++) { d[i] *= k; m = Math.max(m, Math.abs(d[i])); }
  if (m > peak) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}
function peakTo(d, peak = 1) {
  let m = 1e-9;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}
function pinkSamples(n, r) { // Paul Kellet's filter: white noise bent to a -3 dB/octave slope
  const d = new Float32Array(n);
  let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r.f() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return d;
}
function brownSamples(n, r) { // a leaky integral of white noise: -6 dB/octave, no slow drift
  const d = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) { y = 0.995 * y + 0.05 * (r.f() * 2 - 1); d[i] = y; }
  return d;
}
// A noise AudioBuffer that loops without a seam: the tail is faded into the head (equal power).
// 'pink' = -3 dB/oct; 'deep' = mostly brown with a little pink on top (a small speaker still has
// something to play).
function makeNoiseBuffer(ctx, kind, seconds, r) {
  const sr = ctx.sampleRate;
  const n = Math.round(seconds * sr);
  const fade = Math.round(0.4 * sr);
  const total = n + fade;
  let raw;
  if (kind === 'pink') raw = pinkSamples(total, r);
  else {
    const a = brownSamples(total, r);
    const b = pinkSamples(total, r);
    scaleTo(a, 1, 1e9); scaleTo(b, 1, 1e9);
    raw = new Float32Array(total);
    for (let i = 0; i < total; i++) raw[i] = 0.75 * a[i] + 0.45 * b[i];
  }
  const d = raw.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const w = (i / fade) * (Math.PI / 2);
    d[i] = raw[i] * Math.sin(w) + raw[n + i] * Math.cos(w);
  }
  scaleTo(d, 0.2, 0.9);
  const buf = ctx.createBuffer(1, n, sr);
  buf.copyToChannel(d, 0);
  return buf;
}
function toBuffer(ctx, samples) {
  const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.copyToChannel(samples, 0);
  return buf;
}

// Water running off the eaves. Each is a tiny grain made by maths.
function synthBubble(sr, r, big) { // a rising "plip" / "plop": a bubble's pitch climbs as it rings out
  const n = Math.round(0.16 * sr);
  const y = new Float32Array(n);
  const f0 = big ? r.logRange(300, 800) : r.logRange(520, 1700);
  const rise = r.range(0.3, 0.9);
  const tr = r.range(0.015, 0.04);
  const ta = r.range(0.014, 0.034);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * f0 * (1 + rise * (1 - Math.exp(-t / tr)))) / sr;
    y[i] = Math.exp(-t / ta) * Math.sin(ph) * Math.min(1, t / 0.0015) * Math.min(1, (n - i) / (0.004 * sr));
  }
  peakTo(y);
  return y;
}
function synthDrip(sr, r) { // a drop off the roof edge landing in water: a small, quick "plink"
  const n = Math.round(0.14 * sr);
  const y = new Float32Array(n);
  const f0 = r.logRange(900, 2300);
  const rise = r.range(0.4, 1.1);
  const tr = r.range(0.006, 0.016);
  const ta = r.range(0.022, 0.06);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * f0 * (1 + rise * (1 - Math.exp(-t / tr)))) / sr;
    y[i] = Math.exp(-t / ta) * Math.sin(ph) * Math.min(1, t / 0.001) * Math.min(1, (n - i) / (0.004 * sr));
  }
  const nn = Math.round(0.0015 * sr);
  for (let i = 0; i < nn; i++) y[i] += 0.25 * (r.f() * 2 - 1) * (1 - i / nn);
  peakTo(y);
  return y;
}
// A raindrop on a fired-clay tile: a damped "tok" (a few inharmonic ceramic modes), a hollow body
// resonance from the air under the tile, and a tiny noise burst for the contact. 'sleet' is duller.
function synthTile(sr, r, kind) {
  const sleet = kind === 'sleet';
  const n = Math.round((sleet ? 0.04 : 0.07) * sr);
  const y = new Float32Array(n);
  const f0 = sleet ? r.logRange(650, 1500) : r.logRange(900, 2800);
  const modes = sleet
    ? [[1, 0.9, 0.0035], [1.6, 0.3, 0.0024]]
    : [[1, 1, 0.0075], [1.59, 0.55, 0.0055], [2.2, 0.32, 0.004], [2.9, 0.16, 0.003]];
  const scale = r.range(0.75, 1.4);
  const phases = modes.map(() => r.f() * TAU);
  const fb = r.range(300, 560);
  const ab = sleet ? 0.12 : r.range(0.25, 0.6);
  const tb = r.range(0.012, 0.024);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = (r.f() * 2 - 1) * Math.exp(-i / sr / (sleet ? 0.004 : 0.0016));
  runBiquad(rbj('bp', sr, Math.min(sr * 0.3, f0 * 1.3), 1.4), noise);
  const na = sleet ? r.range(1, 1.8) : r.range(0.35, 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = ab * Math.exp(-t / tb) * Math.sin(TAU * fb * t) + na * noise[i];
    for (let k = 0; k < modes.length; k++) v += modes[k][1] * Math.exp(-t / (modes[k][2] * scale)) * Math.sin(TAU * f0 * modes[k][0] * t + phases[k]);
    y[i] = v * Math.min(1, t / 0.0004) * Math.min(1, (n - i) / (0.002 * sr));
  }
  peakTo(y);
  return y;
}
function synthLeaf(sr, r, dry) { // a tiny leaf rustle: a few soft crinkles of band-passed noise
  const n = Math.round((dry ? 0.07 : 0.14) * sr);
  const y = new Float32Array(n);
  const bursts = dry ? r.int(2, 5) : r.int(1, 3);
  for (let b = 0; b < bursts; b++) {
    const t0 = Math.round(r.range(0, dry ? 0.04 : 0.07) * sr);
    const amp = r.range(0.3, 1);
    const tau = dry ? r.range(0.003, 0.008) : r.range(0.012, 0.03);
    const atk = dry ? 0.0025 : 0.006; // soft start: a leaf, not a click
    for (let i = t0; i < n; i++) {
      const t = (i - t0) / sr;
      y[i] += amp * (r.f() * 2 - 1) * Math.exp(-t / tau) * Math.min(1, t / atk);
    }
  }
  runBiquad(rbj('bp', sr, dry ? 2600 : 1500, dry ? 1.1 : 0.9), y);
  runBiquad(rbj('lp', sr, dry ? 4200 : 3000, 0.7), y);
  for (let i = 0; i < n; i++) y[i] *= Math.min(1, (n - i) / (0.012 * sr));
  peakTo(y);
  return y;
}
// The room's reverb: a short, dark, generated impulse response (a few early taps + a decaying tail
// that gets darker), scaled to unit energy so a send of 0.2 means "-14 dB of wet".
function makeImpulse(ctx, r, seconds) {
  const sr = ctx.sampleRate;
  const n = Math.round(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const chans = [];
  let energy = 0;
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const a = 0.62 * Math.exp(-t * 2.2) + 0.1; // the tail gets darker as it dies away
      lp += a * ((r.f() * 2 - 1) - lp);
      d[i] = lp * Math.exp((-6.9 * t) / seconds) * Math.min(1, t / 0.012);
    }
    for (let k = 0; k < 6; k++) d[Math.round(r.range(0.008, 0.07) * sr)] += (r.f() < 0.5 ? -1 : 1) * r.range(0.3, 0.8) * (1 - k / 8);
    chans.push(d);
    for (let i = 0; i < n; i++) energy += d[i] * d[i];
  }
  const k = 1 / Math.sqrt(energy / 2);
  chans.forEach((d, c) => { for (let i = 0; i < n; i++) d[i] *= k; buf.copyToChannel(d, c); });
  return buf;
}
// A safety limiter: a straight line up to 0.25, then a smooth bend that never passes 0.47 (-6.6 dBFS).
const LIMIT_CURVE = (() => {
  const c = new Float32Array(4097);
  for (let i = 0; i < c.length; i++) {
    const x = i / 2048 - 1;
    const a = Math.abs(x);
    c[i] = a < 0.25 ? x : Math.sign(x) * (0.25 + 0.22 * Math.tanh((a - 0.25) / 0.22));
  }
  return c;
})();

// ── What plays in which scene ──────────────────────────────────────────────────────────────────
// Levels are in dB relative to each layer's standard loudness (REF_DB below brings every layer to a
// comparable level when measured alone, so these numbers can be read as a mixing desk).
const RAIN = { // per season: tile hits per second, overall trim and wash/flow levels (dB), water events per second
  summer: { rec: 0, hits: 130, trim: -3, wash: -2, flow: -2, bubbles: 14, drips: 1.6, duckBirds: -16, duckInsects: -11, thunder: true, tile: 'tile' },
  spring: { rec: -3, hits: 75, trim: -2, wash: -6, flow: -6, bubbles: 8, drips: 1.1, duckBirds: -9, duckInsects: -6, thunder: false, tile: 'tile' },
  dry: { rec: -6, hits: 48, trim: 0, wash: -10, flow: -10, bubbles: 5, drips: 0.8, duckBirds: -6, duckInsects: -4, thunder: false, tile: 'tile' },
  snow: { rec: -9, hits: 40, trim: 0, wash: -10, flow: -12, bubbles: 2.5, drips: 0.5, duckBirds: 0, duckInsects: 0, thunder: false, tile: 'sleet' },
};

const TRIM = { 'summer:day': 3, 'summer:night': 3.5, 'spring:day': -1, 'dry:day': -1, 'snow:night': 4.5, 'snow:day': 2, 'snow:morning': 2, 'snow:afternoon': 2 };

function plan(scene, lite, recorded = false) {
  const { season, period, rain } = scene;
  const night = period === 'night';
  const morning = period === 'morning';
  const afternoon = period === 'afternoon';
  const list = [];
  // Per-scene trim in dB (measured: it brings every scene's render into the same loudness range).
  const trim = TRIM[`${season}:${period}`] ?? 0;
  const add = (kind, p, db) => list.push({ kind, p, db: db + (kind.startsWith('rain') || kind === 'thunder' ? 0 : trim), key: `${kind}:${JSON.stringify(p)}` });
  const R = RAIN[season];
  const dBird = rain ? R.duckBirds : 0;
  const dIns = rain ? R.duckInsects : 0;
  const cic = (n) => (lite ? Math.max(2, Math.round(n * 0.5)) : n);
  const cri = (n) => (lite ? Math.max(2, Math.round(n * 0.65)) : n);
  const bouts = (n) => Math.round(n * (lite ? 0.6 : 1));

  if (season === 'snow') {
    // No birds or insects in the snow: the periods differ in how bright and how loud the hush is.
    const tone = { morning: 1.1, day: 1, afternoon: 0.9, night: 0.8 }[period];
    add('wind', { kind: 'snow', tone }, rain ? -8 : night ? -11 : morning ? -6 : afternoon ? -5 : -4.5); // sleet drowns most of the hush
    if (night && !rain) add('owl', { lo: 60, hi: 150 }, -8);
  } else if (season === 'spring') {
    add('wind', { kind: 'leaf' }, night ? -10 : -5);
    add('leaves', { kind: 'green' }, night ? -14 : -9);
    if (morning) add('birds', { mix: 'spring', bouts: bouts(46) }, -1 + dBird);
    else if (period === 'day') add('birds', { mix: 'spring', bouts: bouts(20) }, -3 + dBird);
    else if (afternoon) add('birds', { mix: 'spring', bouts: bouts(8) }, -5 + dBird);
    if (period === 'day' || afternoon) add('bee', { lo: 14, hi: 40 }, (afternoon ? -15 : -13) + (rain ? -30 : 0));
    if (night) add('cricket', { voices: cri(3), lo: 2900, hi: 3600, pLo: 0.6, pHi: 0.85, bLo: 5, bHi: 14, restMean: 7, restMin: 3 }, -4 + dIns);
    if (afternoon) add('cricket', { voices: cri(2), lo: 3000, hi: 3700, pLo: 0.6, pHi: 0.85, bLo: 4, bHi: 10, restMean: 9, restMin: 4, rise: true }, -14 + dIns);
    if (night && !rain) add('owl', { lo: 70, hi: 170 }, -7);
  } else if (season === 'summer') {
    add('wind', { kind: 'leaf' }, night ? -11 : -7);
    add('leaves', { kind: 'green' }, night ? -16 : -10);
    if (morning) {
      add('birds', { mix: 'summer', bouts: bouts(46) }, -2 + dBird);
      add('dove', { lo: 9, hi: 24 }, -4 + dBird);
      add('cicada', { voices: cic(2), gapLo: 4, gapHi: 14 }, -8 + dIns);
    } else if (period === 'day') {
      add('cicada', { voices: cic(6), gapLo: 1.5, gapHi: 7 }, -1 + dIns);
      add('dove', { lo: 12, hi: 34 }, -5 + dBird);
      add('birds', { mix: 'summer', bouts: bouts(5) }, -10 + dBird);
    } else if (afternoon) {
      add('cicada', { voices: cic(4), gapLo: 2.5, gapHi: 10, rise: true }, -4 + dIns);
      add('dove', { lo: 20, hi: 55 }, -7 + dBird);
      add('birds', { mix: 'summer', bouts: bouts(5) }, -9 + dBird);
      add('cricket', { voices: cri(3), lo: 3100, hi: 3900, pLo: 0.5, pHi: 0.65, bLo: 8, bHi: 22, restMean: 5, restMin: 2, rise: true }, -13 + dIns);
    } else {
      add('cricket', { voices: cri(6), lo: 3100, hi: 4300, pLo: 0.44, pHi: 0.6, bLo: 14, bHi: 40, restMean: 3, restMin: 1, pairs: true }, -1 + dIns);
      add('gecko', { lo: 20, hi: 60 }, -7);
      add('frog', {}, -8 + (rain ? 4 : 0));
    }
  } else { // dry season (kemarau)
    add('wind', { kind: 'dry' }, night ? -9 : -4);
    add('leaves', { kind: 'dry' }, night ? -12 : -5);
    if (morning) {
      add('birds', { mix: 'dry', bouts: bouts(30) }, -4 + dBird);
      add('crow', { lo: 25, hi: 70 }, -6 + dBird);
    } else if (period === 'day') {
      add('cicada', { voices: cic(2), gapLo: 3, gapHi: 10, far: true }, -7 + dIns);
      add('crow', { lo: 25, hi: 75 }, -5 + dBird);
    } else if (afternoon) {
      add('cicada', { voices: cic(3), gapLo: 3, gapHi: 10, far: true, rise: true }, -7 + dIns);
      add('birds', { mix: 'dry', bouts: bouts(6) }, -9 + dBird);
      add('crow', { lo: 30, hi: 90 }, -8 + dBird);
    } else {
      add('cricket', { voices: cri(4), lo: 2600, hi: 3300, pLo: 0.75, pHi: 1.0, bLo: 8, bHi: 24, restMean: 5, restMin: 2 }, -5 + dIns);
    }
  }
  if (rain) {
    if (recorded) {
      // The real recording (DonRain, Pixabay): one looping layer, lighter in the quieter seasons.
      add('rainRec', { season }, R.rec);
    } else {
      add('rainWash', { season }, R.wash + R.trim);
      add('rainHits', { season, rate: Math.round(R.hits * (lite ? 0.55 : 1)), tile: R.tile }, R.trim);
      add('rainFlow', { season, bubbles: R.bubbles * (lite ? 0.6 : 1), drips: R.drips }, R.flow + R.trim);
    }
    if (R.thunder) add('thunder', { lo: 45, hi: 130 }, -13);
  }
  return list;
}
export function describeScene(scene, lite = false) {
  return plan({ season: 'spring', period: 'day', rain: false, ...scene }, lite).map(({ kind, p, db }) => ({ kind, p, db }));
}

// Wind beds: which noise, which filter, and how the filter and loudness follow the wind level.
const WIND = {
  leaf: { noise: 'pink', hp: 180, type: 'bandpass', f0: 650, f1: 1500, q: 0.55, lp2: 3800, lo: 0.3, curve: 1.3 },
  dry: { noise: 'pink', hp: 220, type: 'bandpass', f0: 700, f1: 1500, q: 0.65, lp2: 3300, lo: 0.25, curve: 1.5 },
  snow: { noise: 'deep', hp: 85, type: 'lowpass', f0: 320, f1: 720, q: -2, lp2: null, lo: 0.3, curve: 1.2 },
};
// Each layer's standard-loudness offset in dB, set from isolated-layer renders (tools in the checks
// folder) so that a plan level of 0 dB means "about as loud as the other layers at 0 dB".
// Beds are matched on A-weighted RMS (-38 dBFS(A) at 0 dB), events on the A-weighted peak of their
// 100 ms envelope (-30 dBFS(A) at 0 dB); the numbers below come from those isolated renders.
const REF_DB = {
  wind: -7.8, leaves: -16, cicada: 2, cricket: -17, birds: -15, dove: -18, bee: -16, owl: -17, crow: -8,
  gecko: -11, frog: -12, thunder: -6, rainWash: -19.8, rainHits: -17, rainFlow: -21.8, rainRec: 0,
};

// ── The engine ─────────────────────────────────────────────────────────────────────────────────
export function createAmbience(ctx, destination, options = {}) {
  const lite = Boolean(options.lite);
  const seed = (options.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
  const rng = makeRng(seed); // events: timing, pitch, level, position
  const dsp = makeRng((seed ^ 0x9e3779b9) >>> 0); // the buffers made at start-up
  const offline = typeof ctx.startRendering === 'function';
  const sr = ctx.sampleRate;
  const voiceCap = options.voiceCap ?? (lite ? 12 : 24);
  const noiseSeconds = lite ? 12 : 16; // the shortest variant is still 8.5 s
  const recBuffer = options.rainBuffer ?? null;
  const planOf = options.plan ?? ((s) => plan(s, lite, Boolean(recBuffer)));
  const refDb = { ...REF_DB, ...(options.refDb ?? {}) };
  const rareScale = options.rareScale ?? 1; // previews only: < 1 makes rare sounds (owl, crow...) more frequent

  const stats = { events: {}, dropped: 0, maxLoad: 0 };
  const count = (name) => { stats.events[name] = (stats.events[name] ?? 0) + 1; };
  let alive = 0; // nodes created minus nodes released: must come back down after scene changes
  let sink = null; // while a layer or an event is being built, new nodes are collected here

  // ── node helpers ──
  const track = (n) => { alive++; if (sink) sink.push(n); return n; };
  const G = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return track(n); };
  const OSC = (type, f) => { const n = ctx.createOscillator(); n.type = type; n.frequency.value = f; return track(n); };
  const BQ = (type, f, q = 1) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return track(n); };
  const PAN = (p) => {
    if (!ctx.createStereoPanner) return G(1); // very old browsers: no panning
    const n = ctx.createStereoPanner(); n.pan.value = p; return track(n);
  };
  const BUF = (buffer, loop) => { const n = ctx.createBufferSource(); n.buffer = buffer; n.loop = loop; return track(n); };
  const free = (nodes) => {
    for (const n of nodes) { try { n.disconnect(); } catch { /* already disconnected */ } alive--; }
  };

  // ── buffers, made on first use ──
  // Each noise kind comes in three variants of different lengths (x1, x0.71, x0.87), so beds that mix
  // variants never repeat together: an envelope autocorrelation sees no clean 16 s loop.
  const noises = {};
  const NOISE_LEN = [1, 0.71, 0.87];
  const noise = (kind, variant = 0) => (noises[`${kind}:${variant}`] ??= makeNoiseBuffer(ctx, kind, noiseSeconds * NOISE_LEN[variant], dsp));
  const banks = {};
  const bank = (name, make, n) => (banks[name] ??= Array.from({ length: lite ? Math.ceil(n * 0.6) : n }, () => toBuffer(ctx, make())));
  const tileBank = (kind) => bank(`tile-${kind}`, () => synthTile(sr, dsp, kind), 30);
  const bubbleBank = () => bank('bubble', () => synthBubble(sr, dsp, dsp.chance(0.35)), 24);
  const dripBank = () => bank('drip', () => synthDrip(sr, dsp), 14);
  const leafBank = (dry) => bank(dry ? 'leaf-dry' : 'leaf-green', () => synthLeaf(sr, dsp, dry), 16);
  let pulse = null; // a smooth pulse shape for insect buzz: (1 + cos)^2 / 4 as a PeriodicWave
  const pulseWave = () => (pulse ??= ctx.createPeriodicWave(new Float32Array([0, 0.5, 0.125]), new Float32Array(3), { disableNormalization: true }));

  // ── the outdoor bus: window, reverb, limiter ──
  const out = G(0);
  const limiter = ctx.createWaveShaper();
  limiter.curve = LIMIT_CURVE;
  track(limiter);
  out.connect(limiter);
  limiter.connect(destination);
  const reverb = ctx.createConvolver();
  reverb.normalize = false;
  reverb.buffer = makeImpulse(ctx, dsp, lite ? 0.7 : 0.95);
  track(reverb);
  const reverbIn = G(1);
  reverbIn.connect(reverb);
  reverb.connect(out);
  const makePath = (far) => {
    const inp = G(1);
    let head = inp;
    if (far) { const dark = BQ('lowpass', 2300, Q_SOFT); inp.connect(dark); head = dark; } // distance: duller
    const win = BQ('lowpass', 5000, Q_SOFT); // the window: 5 kHz open, 1.5 kHz with the curtain closed
    const roof = BQ('lowpass', 7000, Q_SOFT); // always: almost nothing above 7 kHz
    // A wide dip around 2.2 kHz leaves room for the clock's tick (1.9-2.6 kHz): the outdoors never
    // sit on top of it, which also sounds like "heard through glass".
    const carve = BQ('peaking', 2200, 0.7);
    carve.gain.value = -6;
    const level = G(1);
    const dry = G(far ? 0.8 : 1);
    const send = G(far ? 0.45 : 0.2);
    head.connect(win); win.connect(roof); roof.connect(carve); carve.connect(level);
    level.connect(dry); dry.connect(out);
    level.connect(send); send.connect(reverbIn);
    return { inp, win, level };
  };
  const nearPath = makePath(false);
  const farPath = makePath(true);
  function applyCurtain(open, t, tc = 0.2) { // tc 0.2 s: 95 % of the way after 0.6 s
    for (const p of [nearPath, farPath]) {
      p.win.frequency.cancelScheduledValues(t);
      p.win.frequency.setTargetAtTime(open ? 5000 : 1500, t, tc);
      p.level.gain.cancelScheduledValues(t);
      p.level.gain.setTargetAtTime(open ? 1 : 0.5, t, tc);
    }
  }

  // ── state ──
  const scene = { season: 'spring', period: 'day', rain: false, curtainOpen: true };
  const layers = new Map(); // key -> layer
  let voices = []; // event voices in flight: { s, e, w }
  let running = false;
  let timer = null;
  let disposeTimer = null;
  let clockNow = 0; // the time of the latest tick
  const wind = { level: 0.4, target: 0.4, externalUntil: -1, next: 0 };

  const persistentLoad = () => { let n = 0; for (const l of layers.values()) if (!l.rushed) n += l.persistent; return n; };
  // The cap is on a weighted count of sounds playing at the same moment: a bird or a dove is 1, a tiny
  // rain or leaf grain a fraction, and the always-on beds (wind, chorus voices) count while they run.
  // An event is only allowed if the load stays under the cap at its start AND at the start of every
  // other scheduled event it overlaps.
  const loadAt = (t) => { let load = persistentLoad(); for (const v of voices) if (v.s <= t && v.e > t) load += v.w; return load; };
  const room = (start, end, w) => {
    const points = [start];
    for (const v of voices) if (v.s > start && v.s < end) points.push(v.s);
    for (const t of points) {
      const load = loadAt(t) + w;
      if (load > voiceCap) return false;
      if (load > stats.maxLoad) stats.maxLoad = load;
    }
    return true;
  };
  // Builds one short event; its nodes are released when its sources end. `build` returns the sources it
  // started. Returns false when the voice cap says no.
  function voiceOf(start, end, weight, build) {
    if (!room(start, end, weight)) { stats.dropped++; return false; }
    const nodes = [];
    const prev = sink;
    sink = nodes;
    let sources;
    try { sources = build(); } finally { sink = prev; }
    voices.push({ s: start, e: end, w: weight });
    let left = sources.length;
    for (const s of sources) s.onended = () => { s.onended = null; if (--left === 0) free(nodes); };
    return true;
  }
  const panOf = (g) => g.pans[rng.int(0, g.pans.length - 1)];
  // A gain shape with soft edges: linear attack, optional hold, then an exponential release.
  function shape(param, t, { atk, hold = 0, rel, peak }) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + atk);
    if (hold > 0) param.setValueAtTime(peak, t + atk + hold);
    param.setTargetAtTime(0, t + atk + hold, rel / 4);
    return t + atk + hold + rel * 1.6 + 0.02; // by then it is 55 dB down: stopping the source makes no click
  }

  // ── layers ──
  function newGroup(far, hp = 0, lp = 0) {
    const trim = G(0);
    const fade = G(0);
    trim.connect(fade);
    fade.connect((far ? farPath : nearPath).inp);
    let head = trim;
    if (lp) { head = BQ('lowpass', lp, Q_SOFT); head.connect(trim); } // tames the FM side-bands of bird calls
    if (hp) { const h = BQ('highpass', hp, Q_SOFT); h.connect(head); head = h; } // nothing below the voice
    const pans = [-0.55, -0.3, -0.1, 0.1, 0.3, 0.55].map((p) => { const n = PAN(p); n.connect(head); return n; });
    return { trim, fade, pans };
  }
  const groupsOf = (layer) => (layer.far ? [layer.near, layer.far] : [layer.near]);
  const GROUP_HP = { birds: 450, leaves: 250 };
  const GROUP_LP = { birds: 6200 };

  function createLayer(spec, t) {
    const layer = {
      key: spec.key, kind: spec.kind, db: spec.db, state: 'in', removeAt: Infinity, nodes: [],
      sources: [], gens: [], onWind: null, persistent: 0, near: null, far: null,
    };
    sink = layer.nodes;
    try {
      const hp = GROUP_HP[spec.kind] ?? 0;
      const lp = GROUP_LP[spec.kind] ?? 0;
      layer.near = newGroup(false, hp, lp);
      layer.farGroup = () => { layer.far ??= newGroup(true, hp, lp); return layer.far; };
      BUILD[spec.kind](layer, spec.p, t);
    } finally { sink = null; }
    return layer;
  }
  function setLevel(layer, db, t, tc) {
    layer.db = db;
    const g = dbToGain(db + (refDb[layer.kind] ?? 0));
    for (const grp of groupsOf(layer)) {
      grp.trim.gain.cancelScheduledValues(t);
      if (tc) grp.trim.gain.setTargetAtTime(g, t, tc); else grp.trim.gain.setValueAtTime(g, t);
    }
  }
  function fadeLayer(layer, to, t, tc = FADE_TC) {
    for (const grp of groupsOf(layer)) {
      grp.fade.gain.cancelScheduledValues(t);
      grp.fade.gain.setValueAtTime(grp.fade.gain.value, t);
      grp.fade.gain.setTargetAtTime(to, t, tc);
    }
  }
  function retire(layer, t) {
    layer.state = 'out';
    // Normally a 2 s crossfade. If many layers are already playing (scenes switched in quick succession),
    // this one goes out faster so the number of simultaneous sounds and nodes stays bounded.
    const crowded = persistentLoad() > voiceCap * 0.7;
    const tc = crowded ? 0.12 : FADE_TC;
    layer.removeAt = t + 6 * tc + 0.2; // by then it is 52 dB down
    fadeLayer(layer, 0, t, tc);
    for (const s of layer.sources) { try { s.stop(layer.removeAt); } catch { /* not started */ } }
  }
  function dispose(layer) { // realtime only: the sources have stopped, so release every node
    layers.delete(layer.key);
    free(layer.nodes);
    layer.nodes = [];
  }
  // If scenes are switched faster than they can crossfade, the oldest fading beds are let go quickly
  // (about 0.4 s) once the voice cap is reached, so the number of beds and nodes stays bounded.
  function enforceCap(t) {
    for (const l of layers.values()) {
      if (persistentLoad() <= voiceCap) break;
      if (l.state !== 'out' || l.rushed) continue;
      l.rushed = true;
      l.removeAt = Math.min(l.removeAt, t + 0.4);
      fadeLayer(l, 0, t, 0.06);
      for (const s of l.sources) { try { s.stop(l.removeAt); } catch { /* not started */ } }
    }
  }
  function applyWind(level, t, tc) {
    wind.level = level;
    for (const l of layers.values()) if (l.onWind && l.state !== 'out') l.onWind(level, t, tc);
  }
  function applyScene(t) {
    const wanted = planOf(scene);
    const keys = new Set(wanted.map((s) => s.key));
    for (const spec of wanted) {
      let layer = layers.get(spec.key);
      if (!layer) {
        layer = createLayer(spec, t);
        layers.set(spec.key, layer);
        setLevel(layer, spec.db, t, 0);
        const first = clockNow + rng.range(0.05, 0.6);
        for (const g of layer.gens) g.next = first + rng.range(0, g.spread ?? 1.5);
        layer.onWind?.(wind.level, t, 0.05);
        fadeLayer(layer, 1, t);
      } else {
        setLevel(layer, spec.db, t, 0.6);
        if (layer.state === 'out') { layer.state = 'in'; layer.rushed = false; layer.removeAt = Infinity; fadeLayer(layer, 1, t); }
      }
    }
    for (const layer of layers.values()) if (!keys.has(layer.key) && layer.state !== 'out') retire(layer, t);
    enforceCap(t);
  }

  // ── bird voices ──
  // One syllable: a frequency-modulated whistle (the sidebands make it a voice, not a beep), with an
  // optional breath of band-passed noise following the pitch, and an optional vibrato.
  function note(t, pan, s) {
    const { f, contour, dur, amp, ratio, i0, i1 = 0.1, atk = 0.008, vib = 0, breath = 0 } = s;
    const end = t + dur * 1.5 + 0.06;
    voiceOf(t, end + 0.05, 1, () => {
      const car = OSC('sine', f * contour[0][1]);
      const mod = OSC('sine', f * contour[0][1] * ratio);
      const depth = G(0);
      const env = G(0);
      car.frequency.setValueAtTime(f * contour[0][1], t);
      mod.frequency.setValueAtTime(f * contour[0][1] * ratio, t);
      for (let k = 1; k < contour.length; k++) {
        car.frequency.exponentialRampToValueAtTime(f * contour[k][1], t + dur * contour[k][0]);
        mod.frequency.exponentialRampToValueAtTime(f * contour[k][1] * ratio, t + dur * contour[k][0]);
      }
      depth.gain.setValueAtTime(i0 * f * ratio, t);
      depth.gain.exponentialRampToValueAtTime(Math.max(0.01, i1) * f * ratio, t + dur);
      mod.connect(depth); depth.connect(car.frequency);
      const srcs = [car, mod];
      if (vib > 0) {
        const lfo = OSC('sine', rng.range(5, 7.5));
        const lg = G(vib * f);
        lfo.connect(lg); lg.connect(car.frequency);
        lfo.start(t); lfo.stop(end);
        srcs.push(lfo);
      }
      car.connect(env);
      if (breath > 0) {
        const nz = BUF(noise('pink'), true);
        const bp = BQ('bandpass', f * 1.05, 2.5);
        const ng = G(breath);
        bp.frequency.setValueAtTime(f * contour[0][1] * 1.05, t);
        for (let k = 1; k < contour.length; k++) bp.frequency.exponentialRampToValueAtTime(f * contour[k][1] * 1.05, t + dur * contour[k][0]);
        nz.connect(bp); bp.connect(ng); ng.connect(env);
        nz.start(t, rng.f() * (nz.buffer.duration - 1)); nz.stop(end);
        srcs.push(nz);
      }
      env.connect(pan);
      const fin = shape(env.gain, t, { atk, hold: dur * 0.15, rel: dur * 0.85, peak: amp });
      car.start(t); mod.start(t);
      car.stop(fin); mod.stop(fin);
      return srcs;
    });
  }
  const SPECIES = {
    sparrow(t, pan) { // "cheep-cheep, chi-chirrup": short rough chirps that rise and fall
      const n = rng.int(3, 7);
      const base = rng.range(2700, 3700);
      const pa = rng.range(0.55, 1);
      let tt = t;
      for (let k = 0; k < n; k++) {
        const dur = rng.range(0.04, 0.095);
        note(tt, pan, {
          f: base * rng.range(0.92, 1.08), dur, amp: pa * rng.range(0.5, 1), ratio: rng.pick([0.63, 0.71, 1.41, 1.73]),
          contour: [[0, 0.82], [0.35, 1.08], [1, 0.78]], i0: rng.range(0.7, 1.3), i1: 0.2, atk: 0.006, breath: 0.25,
        });
        tt += dur + rng.range(0.05, 0.15) * (k === n - 2 ? 1.7 : 1);
      }
      return tt - t;
    },
    bulbul(t, pan) { // a little whistled phrase: glides, vibrato, a touch of reediness
      const n = rng.int(3, 6);
      const base = rng.range(1900, 2600);
      const pa = rng.range(0.55, 1);
      let semi = rng.pick([0, 2, 4, 7, 9, 12, -3, -5]);
      let tt = t;
      for (let k = 0; k < n; k++) {
        const last = k === n - 1;
        const dur = last ? rng.range(0.18, 0.3) : rng.range(0.08, 0.2);
        const glide = last ? -0.16 : rng.pick([-0.1, -0.05, 0, 0.08, 0.14]);
        note(tt, pan, {
          f: base * 2 ** (semi / 12), dur, amp: pa * rng.range(0.65, 1), ratio: 2, i0: rng.range(0.25, 0.5), i1: 0.08,
          contour: [[0, 1], [1, 1 + glide]], atk: 0.016, vib: 0.008, breath: 0.06,
        });
        tt += dur + rng.range(0.035, 0.11);
        semi = clamp(semi + rng.pick([-4, -2, 0, 2, 3, 5]), -5, 14);
      }
      return tt - t;
    },
    prinia(t, pan) { // a quick little trill of ticks
      const n = rng.int(7, 14);
      const base = rng.range(3200, 3900);
      const pa = rng.range(0.5, 0.9);
      const gap = rng.range(0.07, 0.095);
      let tt = t;
      for (let k = 0; k < n; k++) {
        note(tt, pan, {
          f: base * (1 - k * 0.006), dur: 0.03, amp: pa * (1 - (k / n) * 0.5), ratio: 0.71,
          contour: [[0, 1.08], [1, 0.9]], i0: 0.8, i1: 0.2, atk: 0.004, breath: 0.2,
        });
        tt += gap * rng.range(0.9, 1.1);
      }
      return tt - t;
    },
  };
  const MIX = {
    spring: [['sparrow', 0.35], ['bulbul', 0.4], ['prinia', 0.25]],
    summer: [['sparrow', 0.4], ['bulbul', 0.3], ['prinia', 0.3]],
    dry: [['sparrow', 0.5], ['bulbul', 0.2], ['prinia', 0.3]],
  };
  function pickSpecies(mix) {
    let x = rng.f();
    for (const [name, w] of MIX[mix]) { x -= w; if (x <= 0) return name; }
    return MIX[mix][0][0];
  }

  // ── layer builders: each sets up its nodes and the generators (events) the scheduler will call ──
  const BUILD = {
    // A steady breeze: two decorrelated noise channels; filter and loudness follow the wind level.
    wind(layer, p, t) {
      const P = WIND[p.kind];
      const tone = p.tone ?? 1; // scales the filter range: a brighter or duller breeze
      const gust = G(1);
      gust.connect(layer.near.trim);
      const filters = [];
      layer.persistent += 1;
      for (const [side, variant] of [[-1, 0], [1, 1], [0, 2]]) { // three independent noises of different lengths
        const buf = noise(P.noise, variant);
        const s = BUF(buf, true);
        layer.sources.push(s);
        let head = s;
        if (P.hp) { const hp = BQ('highpass', P.hp, Q_SOFT); head.connect(hp); head = hp; }
        const f = BQ(P.type, P.f0 * tone, P.q);
        head.connect(f); head = f; filters.push(f);
        if (P.lp2) { const lp = BQ('lowpass', P.lp2, Q_SOFT); head.connect(lp); head = lp; }
        const pn = PAN(0.6 * side);
        head.connect(pn); pn.connect(gust);
        s.start(t, rng.f() * (buf.duration - 1));
      }
      layer.onWind = (lvl, tt, tc) => {
        gust.gain.cancelScheduledValues(tt);
        gust.gain.setTargetAtTime(P.lo + (1 - P.lo) * lvl ** P.curve, tt, tc);
        for (const f of filters) {
          f.frequency.cancelScheduledValues(tt);
          f.frequency.setTargetAtTime((P.f0 + (P.f1 - P.f0) * lvl) * tone, tt, tc);
        }
      };
    },

    // Leaves rustling: tiny grains whose busyness follows the wind level.
    leaves(layer, p) {
      const dry = p.kind === 'dry';
      const grains = leafBank(dry);
      const g = layer.near;
      layer.gens.push({
        name: 'leaf', next: 0,
        fire(t) {
          const w = wind.level;
          const rate = (dry ? 15 : 20) * (0.04 + 2.2 * w * w);
          voiceOf(t, t + 0.2, 0.15, () => {
            const s = BUF(grains[rng.int(0, grains.length - 1)], false);
            s.playbackRate.value = rng.range(0.85, 1.25);
            const a = G(dbToGain(-rng.range(0, 14)) * (0.35 + 0.65 * w));
            s.connect(a); a.connect(panOf(g));
            s.start(t);
            return [s];
          });
          count('leaf');
          return clamp(rng.exp(1 / rate), 0.004, 4);
        },
      });
    },

    // Tonggeret / cicada chorus: narrow bands of noise pulsed 35-55 times a second. Each voice swells
    // in and out on its own schedule, so the chorus breathes without a pattern.
    cicada(layer, p, t0) {
      const g = p.far ? layer.farGroup() : layer.near;
      const n = p.voices;
      const buf = noise('pink');
      const norm = 1.6 / Math.sqrt(n);
      layer.persistent += n;
      for (let i = 0; i < n; i++) {
        const fc = 2800 + (1500 * (i + rng.f() * 0.8)) / n;
        const s = BUF(buf, true);
        const bp = BQ('bandpass', fc, rng.range(5, 8));
        const am = OSC('sine', 40);
        am.setPeriodicWave(pulseWave());
        am.frequency.value = rng.range(34, 56);
        const depth = G(0.9);
        const amp = G(0.1 + 0.375 * 0.9); // with the pulse this swings between 0.1 and 1.0
        const env = G(0);
        const pn = PAN(rng.range(-0.6, 0.6));
        s.connect(bp); bp.connect(amp); amp.connect(env); env.connect(pn); pn.connect(g.trim);
        am.connect(depth); depth.connect(amp.gain);
        s.start(t0, rng.f() * (buf.duration - 1)); am.start(t0);
        layer.sources.push(s, am);
        const phase = rng.f() * TAU;
        layer.gens.push({
          name: 'cicada', next: 0, spread: 4,
          fire(t) { // "rise" = the evening chorus builds and ebbs over a couple of minutes
            const rise = p.rise ? 0.72 + 0.28 * Math.sin(TAU * (t / 110) + phase) : 1;
            const peak = norm * dbToGain(-rng.range(0, 7)) * rise;
            const up = rng.range(1.4, 3.2);
            const hold = rng.range(2.5, 9);
            const down = rng.range(1.5, 4);
            env.gain.setTargetAtTime(peak, t, up / 3);
            env.gain.setTargetAtTime(peak * rng.range(0.55, 0.95), t + up + hold * 0.4, 0.8);
            env.gain.setTargetAtTime(0, t + up + hold, down / 3);
            bp.frequency.setTargetAtTime(fc * rng.range(0.93, 1.07), t, 1.5);
            am.frequency.setTargetAtTime(rng.range(30, 38), t, 0.3); // the pulses speed up as the call swells
            am.frequency.setTargetAtTime(rng.range(46, 60), t + up * 0.6, up * 0.4);
            count('cicada');
            return up + hold + down + rng.range(p.gapLo, p.gapHi);
          },
        });
      }
    },

    // Jangkrik: each cricket is one steady sine; a chirp is 3-5 quick soft pulses on its gain. Each has
    // its own chirp period, so they drift in and out of step; some pairs sit 1-3 Hz apart and beat.
    cricket(layer, p, t0) {
      const g = layer.near;
      const norm = 1.8 / Math.sqrt(p.voices);
      layer.persistent += p.voices;
      let prevFc = 0;
      for (let i = 0; i < p.voices; i++) {
        let fc = p.lo + ((p.hi - p.lo) * (i + rng.f() * 0.7)) / p.voices;
        if (p.pairs && i % 2 === 1) fc = prevFc * (1 + rng.range(0.0004, 0.001)); // a near-twin: slow beating
        prevFc = fc;
        const o = OSC('sine', fc);
        const env = G(0);
        const pn = PAN(rng.range(-0.6, 0.6));
        o.connect(env); env.connect(pn); pn.connect(g.trim);
        o.start(t0);
        layer.sources.push(o);
        const period = rng.range(p.pLo, p.pHi);
        const pulses = rng.int(3, 4);
        let left = rng.int(p.bLo, p.bHi);
        const phase = rng.f() * TAU;
        layer.gens.push({
          name: 'cricket', next: 0, spread: period * 2,
          fire(t) {
            const pp = rng.range(0.026, 0.036);
            const n = pulses + (rng.chance(0.2) ? 1 : 0);
            const rise = p.rise ? 0.72 + 0.28 * Math.sin(TAU * (t / 110) + phase) : 1;
            const peak = norm * dbToGain(-rng.range(0, 5)) * rise;
            for (let k = 0; k < n; k++) {
              const tk = t + k * pp;
              const a = peak * (0.6 + 0.4 * Math.sin((Math.PI * (k + 0.5)) / n));
              env.gain.setValueAtTime(0, tk);
              env.gain.linearRampToValueAtTime(a, tk + 0.004);
              env.gain.setTargetAtTime(0, tk + 0.004, 0.0045);
            }
            count('cricket');
            if (--left <= 0) {
              left = rng.int(p.bLo, p.bHi);
              return (rng.exp(p.restMean) + p.restMin) * 1;
            }
            return period * rng.range(0.9, 1.1);
          },
        });
      }
    },

    // Songbirds: bouts of sparrow chirps, bulbul whistles and prinia trills, some near, some far.
    birds(layer, p) {
      const near = layer.near;
      const far = layer.farGroup();
      layer.gens.push({
        name: 'birds', next: 0, spread: 2,
        fire(t) {
          const g = rng.chance(0.4) ? far : near;
          SPECIES[pickSpecies(p.mix)](t, panOf(g));
          count('bird');
          return clamp(rng.exp(60 / p.bouts), 0.15, 60);
        },
      });
    },

    // Tekukur, the spotted dove: "ku-kuk-kuuur", low and warm, far away.
    dove(layer, p) {
      const g = layer.farGroup();
      const coo = (t, pan, f, dur, amp, glide, vib) => {
        voiceOf(t, t + dur + 0.3, 1, () => {
          const a = OSC('sine', f);
          const b = OSC('sine', f * 2);
          const bg = G(0.22);
          const lfo = OSC('sine', rng.range(5, 6.5));
          const lg = G(f * vib);
          const env = G(0);
          a.frequency.setValueAtTime(f * 0.93, t);
          a.frequency.exponentialRampToValueAtTime(f, t + 0.05);
          a.frequency.setTargetAtTime(f * (1 + glide), t + dur * 0.4, dur * 0.3);
          b.frequency.setValueAtTime(f * 1.86, t);
          b.frequency.exponentialRampToValueAtTime(f * 2, t + 0.05);
          b.frequency.setTargetAtTime(f * 2 * (1 + glide), t + dur * 0.4, dur * 0.3);
          lfo.connect(lg); lg.connect(a.frequency);
          a.connect(env); b.connect(bg); bg.connect(env); env.connect(pan);
          const end = shape(env.gain, t, { atk: 0.05, hold: dur * 0.3, rel: dur * 0.7, peak: amp });
          for (const s of [a, b, lfo]) { s.start(t); s.stop(end); }
          return [a, b, lfo];
        });
        return t + dur;
      };
      layer.gens.push({
        name: 'dove', next: 0, spread: 8,
        fire(t) {
          const pan = panOf(g);
          const f = rng.range(430, 540);
          const reps = rng.int(2, 3);
          let tt = t;
          for (let r = 0; r < reps; r++) {
            const amp = 1 - r * 0.18;
            tt = coo(tt, pan, f, rng.range(0.17, 0.23), amp, -0.02, 0.004) + rng.range(0.08, 0.13);
            tt = coo(tt, pan, f * 1.07, rng.range(0.15, 0.21), amp * 0.9, -0.02, 0.004) + rng.range(0.07, 0.12);
            tt = coo(tt, pan, f * 1.1, rng.range(0.7, 0.95), amp, -0.19, 0.01) + rng.range(0.55, 0.85);
          }
          count('dove');
          return rng.range(p.lo, p.hi) * rareScale;
        },
      });
    },

    // A faint bee passing by: two detuned low saws under a low-pass, swelling and fading.
    bee(layer, p) {
      const g = layer.near;
      layer.gens.push({
        name: 'bee', next: 0, spread: 10,
        fire(t) {
          const dur = rng.range(4.5, 8);
          const f = rng.range(165, 235);
          const pan = panOf(g);
          voiceOf(t, t + dur + 1, 1, () => {
            const o1 = OSC('sawtooth', f * 0.94);
            const o2 = OSC('sawtooth', f * 0.97);
            const lp = BQ('lowpass', 650, Q_SOFT);
            const env = G(0);
            const vib = OSC('sine', rng.range(4, 7));
            const vg = G(f * 0.02);
            vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
            o1.frequency.setValueAtTime(f * 0.94, t); o1.frequency.linearRampToValueAtTime(f * 1.03, t + dur);
            o2.frequency.setValueAtTime(f * 0.97, t); o2.frequency.linearRampToValueAtTime(f * 1.05, t + dur);
            o1.connect(lp); o2.connect(lp);
            lp.connect(env); env.connect(pan);
            env.gain.setTargetAtTime(1, t, dur * 0.18);
            env.gain.setTargetAtTime(0, t + dur * 0.5, dur * 0.16);
            const end = t + dur + 1;
            for (const s of [o1, o2, vib]) { s.start(t); s.stop(end); }
            return [o1, o2, vib];
          });
          count('bee');
          return rng.range(p.lo, p.hi) * rareScale;
        },
      });
    },

    // A distant owl: a soft, breathy "hoo ... hoo-hoo".
    owl(layer, p) {
      const g = layer.farGroup();
      const hoo = (t, pan, f, dur, amp) => {
        voiceOf(t, t + dur + 0.4, 1, () => {
          const a = OSC('sine', f);
          const b = OSC('sine', f * 2.01);
          const bg = G(0.18);
          const nz = BUF(noise('pink'), true);
          const nb = BQ('bandpass', f * 1.6, 3);
          const ng = G(0.035);
          const env = G(0);
          a.frequency.setValueAtTime(f * 1.06, t);
          a.frequency.setTargetAtTime(f * 0.95, t + 0.03, dur * 0.35);
          b.frequency.setValueAtTime(f * 2.12, t);
          b.frequency.setTargetAtTime(f * 1.9, t + 0.03, dur * 0.35);
          a.connect(env); b.connect(bg); bg.connect(env);
          nz.connect(nb); nb.connect(ng); ng.connect(env);
          env.connect(pan);
          const end = shape(env.gain, t, { atk: 0.07, hold: dur * 0.35, rel: dur * 0.65, peak: amp });
          a.start(t); b.start(t); nz.start(t, rng.f() * (nz.buffer.duration - 1));
          for (const s of [a, b, nz]) s.stop(end);
          return [a, b, nz];
        });
        return t + dur;
      };
      layer.gens.push({
        name: 'owl', next: 0, spread: 15,
        fire(t) {
          const pan = panOf(g);
          const f = rng.range(360, 460);
          const n = rng.pick([2, 3, 3, 4]);
          let tt = t;
          for (let k = 0; k < n; k++) {
            const dur = k === 0 ? rng.range(0.42, 0.55) : rng.range(0.28, 0.38);
            tt = hoo(tt, pan, f * (1 - k * 0.012), dur, 1 - k * 0.1) + (k === 0 ? rng.range(0.4, 0.6) : rng.range(0.2, 0.3));
          }
          count('owl');
          return rng.range(p.lo, p.hi) * rareScale;
        },
      });
    },

    // A far crow: "kaa, kaa", a low saw through vowel-like filters, dark and distant.
    crow(layer, p) {
      const g = layer.farGroup();
      layer.gens.push({
        name: 'crow', next: 0, spread: 15,
        fire(t) {
          const pan = panOf(g);
          const n = rng.int(2, 4);
          const f = rng.range(300, 380);
          let tt = t;
          for (let k = 0; k < n; k++) {
            const dur = rng.range(0.2, 0.32);
            const at = tt;
            voiceOf(at, at + dur + 0.2, 1, () => {
              const o = OSC('sawtooth', f);
              const f1 = BQ('bandpass', 650, 3);
              const f2 = BQ('bandpass', 1250, 4);
              const g2 = G(0.5);
              const lp = BQ('lowpass', 1500, Q_SOFT);
              const am = OSC('sine', rng.range(55, 85));
              const ag = G(0.25);
              const env = G(0);
              o.frequency.setValueAtTime(f * 1.12, at);
              o.frequency.exponentialRampToValueAtTime(f * 0.86, at + dur);
              o.connect(f1); o.connect(f2); f2.connect(g2);
              f1.connect(lp); g2.connect(lp); lp.connect(env); env.connect(pan);
              am.connect(ag); ag.connect(env.gain);
              const end = shape(env.gain, at, { atk: 0.025, hold: dur * 0.5, rel: dur * 0.5, peak: 0.75 });
              for (const s of [o, am]) { s.start(at); s.stop(end); }
              return [o, am];
            });
            tt += dur + rng.range(0.3, 0.55);
          }
          count('crow');
          return rng.range(p.lo, p.hi) * rareScale;
        },
      });
    },

    // Cicak, the house gecko: "cek-cek-cek-cek", slowing down.
    gecko(layer, p) {
      const g = layer.farGroup();
      layer.gens.push({
        name: 'gecko', next: 0, spread: 15,
        fire(t) {
          const pan = panOf(g);
          const n = rng.int(4, 8);
          const f = rng.range(2500, 3300);
          let tt = t;
          let gap = rng.range(0.11, 0.16);
          for (let k = 0; k < n; k++) {
            const at = tt;
            const amp = (k >= n - 2 ? 0.65 : 1) * rng.range(0.75, 1);
            const ff = f * rng.range(0.96, 1.04);
            voiceOf(at, at + 0.1, 1, () => {
              const s = BUF(noise('pink'), true);
              const bp = BQ('bandpass', ff, 2.2);
              const o = OSC('sine', ff * 0.55);
              const env = G(0);
              o.frequency.setValueAtTime(ff * 0.55, at);
              o.frequency.setTargetAtTime(ff * 0.4, at, 0.02);
              s.connect(bp); bp.connect(env); o.connect(env); env.connect(pan);
              const end = shape(env.gain, at, { atk: 0.002, rel: 0.03, peak: amp });
              s.start(at, rng.f() * (s.buffer.duration - 1)); o.start(at);
              s.stop(end); o.stop(end);
              return [s, o];
            });
            tt += gap;
            gap *= rng.range(1.06, 1.16);
          }
          count('gecko');
          return rng.range(p.lo, p.hi) * rareScale;
        },
      });
    },

    // Distant frogs: a few individuals, each calling in a slow train of soft low pulses.
    frog(layer) {
      const g = layer.farGroup();
      const frogs = Array.from({ length: 3 }, () => ({ f: rng.range(420, 760), pan: panOf(g), rate: rng.range(6.5, 9.5) }));
      layer.gens.push({
        name: 'frog', next: 0, spread: 6,
        fire(t) {
          const fr = rng.pick(frogs);
          const n = rng.int(3, 9);
          voiceOf(t, t + n / fr.rate + 0.4, 1, () => {
            const o = OSC('triangle', fr.f);
            const lp = BQ('lowpass', 1100, Q_SOFT);
            const env = G(0);
            o.connect(lp); lp.connect(env); env.connect(fr.pan);
            let end = t;
            for (let k = 0; k < n; k++) {
              const tk = t + (k / fr.rate) * rng.range(0.95, 1.05);
              o.frequency.setValueAtTime(fr.f * rng.range(0.98, 1.03), tk);
              o.frequency.exponentialRampToValueAtTime(fr.f * 0.88, tk + 0.07);
              end = shape(env.gain, tk, { atk: 0.012, rel: 0.07, peak: 0.8 * (1 - k * 0.03) });
            }
            o.start(t); o.stop(end);
            return [o];
          });
          count('frog');
          return (rng.exp(3.2) + 1.2) * rareScale;
        },
      });
    },

    // Very rare distant thunder in summer rain: low-passed brown noise with an irregular swell.
    thunder(layer, p) {
      const g = layer.farGroup();
      layer.gens.push({
        name: 'thunder', next: 0, spread: 40,
        fire(t) {
          const dur = rng.range(5, 8);
          voiceOf(t, t + dur + 1, 1, () => {
            const s = BUF(noise('deep'), true);
            const lp = BQ('lowpass', rng.range(110, 190), Q_SOFT);
            const env = G(0);
            s.connect(lp); lp.connect(env); env.connect(panOf(g));
            env.gain.setValueAtTime(0, t);
            env.gain.setTargetAtTime(1, t, 0.9);
            for (let k = 0; k < 3; k++) env.gain.setTargetAtTime(rng.range(0.35, 1), t + 1.2 + k * dur * 0.2, 0.5);
            env.gain.setTargetAtTime(0, t + dur * 0.55, dur * 0.17);
            s.start(t, rng.f() * (s.buffer.duration - 1)); s.stop(t + dur + 1);
            return [s];
          });
          count('thunder');
          return rng.range(p.lo, p.hi) * rareScale;
        },
      });
    },

    // Rain, the recording: a 60 s loop (DonRain, "Rain (on the window)", Pixabay Content License) decoded once by
    // sound.js and handed in as options.rainBuffer. Each visit starts it at a different point of the loop.
    rainRec(layer, p, t) {
      const buf = recBuffer;
      if (!buf) return;
      layer.persistent += 1;
      const src = BUF(buf, true);
      const lp = BQ('lowpass', p.season === 'snow' ? 2600 : 6500, Q_SOFT);
      src.connect(lp); lp.connect(layer.near.trim);
      src.start(t, rng.f() * (buf.duration - 1));
      layer.sources.push(src);
    },

    // Rain, part 1: the soft wash of many small drops (pink noise, low-passed near 3.5 kHz).
    rainWash(layer, p, t) {
      const wob = G(1);
      wob.connect(layer.near.trim);
      layer.persistent += 1;
      for (const [side, variant] of [[-1, 0], [1, 1], [0, 2]]) {
        const buf = noise('pink', variant);
        const s = BUF(buf, true);
        const hp = BQ('highpass', 180, Q_SOFT);
        const lp = BQ('lowpass', 3500, Q_SOFT);
        const pn = PAN(0.5 * side);
        s.connect(hp); hp.connect(lp); lp.connect(pn); pn.connect(wob);
        s.start(t, rng.f() * (buf.duration - 1));
        layer.sources.push(s);
      }
      layer.gens.push({
        name: 'wash', next: 0,
        fire(tt) {
          wob.gain.setTargetAtTime(dbToGain(rng.range(-2.5, 1.5)), tt, 1.5);
          return rng.range(2, 5);
        },
      });
    },

    // Rain, part 2: drops hitting clay tiles, each a different "tok" or "tik".
    rainHits(layer, p) {
      const hits = tileBank(p.tile);
      const g = layer.near;
      let k = 1;
      layer.gens.push({
        name: 'hits', next: 0,
        fire(t) {
          k = clamp(k + rng.gauss() * 0.04 + (1 - k) * 0.02, 0.7, 1.3); // the rain comes in slow waves
          voiceOf(t, t + 0.14, 0.2, () => {
            const s = BUF(hits[rng.int(0, hits.length - 1)], false);
            s.playbackRate.value = rng.range(0.86, 1.2);
            const a = G(dbToGain(-2 - 22 * rng.f() ** 1.5));
            s.connect(a); a.connect(panOf(g));
            s.start(t);
            return [s];
          });
          count('rainHit');
          return clamp(rng.exp(1 / (p.rate * k)), 0.003, 1);
        },
      });
    },

    // Rain, part 3: the trickle and gurgle of water running off the eaves (band-passed noise that
    // wanders, plip-plop bubbles that rise in pitch, and a few drips from the roof edge).
    rainFlow(layer, p, t) {
      const bubbles = bubbleBank();
      const drips = dripBank();
      const g = layer.near;
      const bed = G(0.4);
      bed.connect(g.trim);
      layer.persistent += 1;
      const bps = [];
      for (const [side, variant] of [[-1, 1], [1, 2], [0, 0]]) {
        const buf = noise('pink', variant);
        const s = BUF(buf, true);
        const bp = BQ('bandpass', 1000, 2.2);
        const pn = PAN(0.5 * side);
        s.connect(bp); bp.connect(pn); pn.connect(bed);
        s.start(t, rng.f() * (buf.duration - 1));
        layer.sources.push(s);
        bps.push(bp);
      }
      layer.gens.push(
        {
          name: 'swept', next: 0,
          fire(tt) { // the band of the running water wanders, like a stream over stones
            for (const bp of bps) bp.frequency.setTargetAtTime(rng.range(650, 1800), tt, 0.6);
            return rng.range(0.7, 1.8);
          },
        },
        {
          name: 'bubble', next: 0,
          fire(tt) {
            voiceOf(tt, tt + 0.2, 0.2, () => {
              const s = BUF(bubbles[rng.int(0, bubbles.length - 1)], false);
              s.playbackRate.value = rng.range(0.85, 1.3);
              const a = G(dbToGain(-3 - 14 * rng.f()));
              s.connect(a); a.connect(panOf(g));
              s.start(tt);
              return [s];
            });
            count('bubble');
            return clamp(rng.exp(1 / p.bubbles), 0.02, 3);
          },
        },
        {
          name: 'drip', next: 0,
          fire(tt) {
            voiceOf(tt, tt + 0.2, 0.3, () => {
              const s = BUF(drips[rng.int(0, drips.length - 1)], false);
              s.playbackRate.value = rng.range(0.85, 1.2);
              const a = G(dbToGain(-2 - 9 * rng.f()));
              s.connect(a); a.connect(panOf(g));
              s.start(tt);
              return [s];
            });
            count('drip');
            return clamp(rng.exp(1 / p.drips), 0.2, 12);
          },
        },
      );
    },
  };

  // ── the scheduler ──
  function tick(from = ctx.currentTime, to = from + LOOKAHEAD) {
    if (!running) return;
    clockNow = from;
    voices = voices.filter((v) => v.e > from - 1);
    if (!offline) for (const l of [...layers.values()]) if (l.state === 'out' && from > l.removeAt) dispose(l);
    // the breeze: slow random gusts, unless the room is feeding real tree sway
    const snow = scene.season === 'snow';
    while (wind.next < to) {
      const tg = Math.max(wind.next, from);
      if (tg >= wind.externalUntil) {
        wind.target = clamp(wind.target + rng.gauss() * (snow ? 0.18 : 0.28) + (0.42 - wind.target) * 0.25, 0.05, 1);
        applyWind(wind.target, tg, snow ? 1.6 : rng.range(0.5, 1.2));
      }
      wind.next = tg + (snow ? rng.range(3, 7) : rng.range(1.2, 3.6));
    }
    for (const layer of layers.values()) {
      if (layer.state === 'out') continue;
      for (const g of layer.gens) {
        let guard = 0;
        while (g.next < to && guard++ < 800) {
          if (g.next < from - 0.05) { g.next = from + rng.range(0, 0.3); continue; } // fell behind: no burst
          g.next += Math.max(0.003, g.fire(g.next));
        }
      }
    }
  }

  // ── public controls ──
  function setScene(next = {}) {
    let changed = false;
    if (SEASONS.includes(next.season) && next.season !== scene.season) { scene.season = next.season; changed = true; }
    if (PERIODS.includes(next.period) && next.period !== scene.period) { scene.period = next.period; changed = true; }
    if (typeof next.rain === 'boolean' && next.rain !== scene.rain) { scene.rain = next.rain; changed = true; }
    if (typeof next.curtainOpen === 'boolean' && next.curtainOpen !== scene.curtainOpen) {
      scene.curtainOpen = next.curtainOpen;
      if (running) applyCurtain(scene.curtainOpen, ctx.currentTime + 0.01);
    }
    if (running && changed) applyScene(ctx.currentTime + 0.02);
    return { ...scene };
  }
  const setRain = (on) => setScene({ rain: Boolean(on) });
  function setWind(level) {
    const l = clamp(Number(level) || 0, 0, 1);
    const t = ctx.currentTime;
    wind.externalUntil = t + 2;
    applyWind(l, t, 0.25);
  }
  function start({ timer: useTimer = true } = {}) {
    if (running) return;
    clearTimeout(disposeTimer);
    running = true;
    const t = ctx.currentTime;
    clockNow = t;
    out.gain.cancelScheduledValues(t);
    out.gain.setTargetAtTime(OUT_LEVEL, t, 0.25);
    applyCurtain(scene.curtainOpen, t, 0.01);
    applyScene(t + 0.02);
    tick(t, t + LOOKAHEAD);
    if (!offline && useTimer) timer = setInterval(() => { if (ctx.state === 'running') tick(); }, TIMER_MS);
  }
  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    timer = null;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setTargetAtTime(0, t, 0.15);
    if (!offline) {
      disposeTimer = setTimeout(() => { // once it has faded out, take everything down
        for (const l of [...layers.values()]) {
          for (const s of l.sources) { try { s.stop(); } catch { /* stopped already */ } }
          dispose(l);
        }
        voices = [];
      }, 1200);
    }
  }
  function state() {
    const live = [...layers.values()].filter((l) => l.state !== 'out');
    const rainLayers = live.filter((l) => l.kind.startsWith('rain'));
    return {
      running,
      lite,
      scene: { ...scene },
      layers: [...layers.values()].map((l) => ({ key: l.key, kind: l.kind, state: l.state })),
      seasonNodes: live.filter((l) => !l.kind.startsWith('rain') && l.kind !== 'thunder').reduce((n, l) => n + l.sources.length, 0),
      rainGain: rainLayers.length ? Math.max(...rainLayers.map((l) => l.near.fade.gain.value)) : 0,
      voices: Math.round(loadAt(ctx.currentTime) * 10) / 10, // weighted sounds playing right now (the cap applies to this)
      voiceCap,
      eventsInFlight: voices.filter((v) => v.s <= ctx.currentTime && v.e > ctx.currentTime).length,
      scheduled: voices.length, // including events waiting in the 1.5 s lookahead and ones that just ended
      nodes: alive, // every node still connected, including the fixed bus and short events in flight
      layerNodes: [...layers.values()].reduce((n, l) => n + l.nodes.length, 0), // only what the layers own
      window: { cutoff: nearPath.win.frequency.value, level: nearPath.level.gain.value }, // follows the curtain
      wind: wind.level,
    };
  }

  return { setScene, setRain, setWind, start, stop, tick, state, stats: () => ({ dropped: stats.dropped, maxLoad: Math.round(stats.maxLoad * 10) / 10, events: { ...stats.events } }), seed, lite };
}

// ── Offline rendering (checks and listening previews) ──────────────────────────────────────────
// Renders `seconds` of a scene in an OfflineAudioContext, driving the scheduler exactly as the timer
// does in the browser (a step every 0.5 s, 1.5 s ahead). `steps` can change the scene part-way:
// [{ at: 10, scene: { period: 'night' } }]. Returns a stereo pair [left, right] of Float32Array; the
// array also carries .sampleRate, .seconds, .seed, .stats and .state.
export async function renderScene(scene, seconds = 20, options = {}) {
  const { seed = 1, sampleRate = 32000, lite = false, steps = [], plan: planOverride, refDb, rareScale } = options;
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.round(seconds * sampleRate), sampleRate);
  const amb = createAmbience(ctx, ctx.destination, { seed, lite, plan: planOverride, refDb, rareScale });
  amb.setScene(scene);
  amb.start({ timer: false });
  const pending = [...steps].sort((a, b) => a.at - b.at);
  for (let t = 0.5; t < seconds; t += 0.5) {
    ctx.suspend(t).then(() => {
      while (pending.length && pending[0].at <= ctx.currentTime + 1e-6) amb.setScene(pending.shift().scene);
      amb.tick(ctx.currentTime, ctx.currentTime + LOOKAHEAD);
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const pair = [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
  return Object.assign(pair, { sampleRate, seconds, seed, stats: amb.stats(), state: amb.state() });
}
