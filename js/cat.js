// Simon, the sleeping cat of the Pause Tape living room: a new pose and coat on every visit, built from a seed.
// Pure maths plus three.js geometry (no page, no canvas), so Node can import this file and the checks can try
// thousands of seeds, like books.js. Unity map: pickPose() fills a ScriptableObject from `new System.Random(seed)`;
// makeCat() is the editor script that turns that data into one procedural Mesh under a GameObject.
//
// Coordinates are the cat's own, in metres: it faces +x (-x when mirrored), y is up (y = 0 is the surface it rests on),
// and the belly / legs side faces +z, toward the room camera.
// A station is one body ring: centre p, half-width w, half-height h, and `up` = the direction its back faces.
// Colours are vertex colours (no texture), so the cat builds the same in Node and in the browser.

import * as THREE from '../assets/vendor/three.module.min.js';

export const POSES = ['curled', 'loaf', 'side', 'back', 'sploot', 'croissant', 'sphinx'];
const PICKED = POSES.filter((p) => p !== 'back'); // 'back' (belly up) read as a cat that had fallen, so the seed never picks it; ?pose=back still builds it
export const FURS = ['orange', 'grey', 'cream', 'brown', 'black'];

// ── Small helpers ─────────────────────────────────────────────────────
// mulberry32: numbers that depend only on the seed, so every browser builds the same cat.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TAU = Math.PI * 2;
const UP = Object.freeze([0, 1, 0]);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }; // smoothstep; a > b runs it backwards
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (i, salt) => { let h = Math.imul((i * 374761393 + salt * 668265263) | 0, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// Catmull-Rom spline between b and c (a and d are the neighbours), and its slope.
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
const dcr = (a, b, c, d, t) => 0.5 * ((c - a) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (3 * b - a - 3 * c + d) * t * t);
const polar = (a, r) => [r * Math.cos(a), r * Math.sin(a)];

// How far a ring reaches below its centre when its back faces `up` (rings run along x).
const reach = (w, h, up) => Math.hypot(h * up[1], w * Math.hypot(up[0], up[2]));
// A body ring; unless y is given it sits so its lowest point just touches the floor.
const stn = (x, z, w, h, up = UP, y) => ({ p: [x, y ?? reach(w, h, up), z], w, h, up });
// A limb or tail: points with one radius each.
const limb = (pts, rs) => pts.map((p, i) => ({ p, w: rs[i], h: rs[i] }));
// A paw or haunch: an ellipsoid with radii s turned by yaw; its bottom rests on the floor unless y is given.
const paw = (x, z, s = PAW, yaw = 0, y) => ({ p: [x, y ?? s[1], z], s, yaw });
const PAW = [0.04, 0.025, 0.034]; // paw ellipsoid radii
const ARM = [0.038, 0.03, 0.026]; // front leg radii: shoulder, middle, wrist
const LEG = [0.042, 0.034, 0.027]; // hind leg radii
const TR = [0.029, 0.034, 0.035, 0.033, 0.028]; // tail radii, root to tip: fluffy, with a round tip
const earOf = (u) => ({ splay: u(0.1, 0.4), back: u(0.1, 0.3), droop: u(0.1, 0.45) });
const headOf = (u, o) => ({ s: u(0.98, 1.06), ear: earOf(u), cheek: u(0.9, 1.15), rest: 0, ...o }); // rest: lowest point of the head (null = free)
// A tail lying on the floor through these (x, z) points.
const tailOf = (xz, drift = 0, curl = 0) => ({ pts: xz.map(([x, z], i) => [x, TR[i] ?? TR[TR.length - 1], z]), r: TR, drift, curl });

// ── Pose data: what each sleeping pose is, with the seed's jitter ────────
// Each builder returns plain JSON-safe data: body rings rump to neck, head, legs (3 points + a paw), haunches, tail,
// and `contacts`: the parts whose lowest point must touch y = 0 (the checks assert each one).
const BUILD = {
  // The donut: body on a ring, nose tucked in on the front paws, tail wrapped around the outside toward the face.
  curled(u) {
    const R = u(0.095, 0.1015), fat = u(0.98, 1.06), span = u(3.3, 3.7), gap = u(1.0, 1.2), curl = u(0, 1);
    const ah = Math.PI / 2 + u(-0.9, 0.9), ae = ah - gap, ar = ae - span; // head, chest and rump angles around the ring
    const turn = u(-0.5, 0.35), tilt = u(0.1, 0.5) * (u(0, 1) < 0.5 ? 1 : -1), tspan = u(1.4, 2.0), lean = u(0.35, 0.6); // turn < 0: the nose points a little outward
    const rows = [[.058, .072], [.066, .082], [.064, .082], [.062, .08], [.052, .066]];
    const at = (t) => { const f = t * 4, k = Math.min(Math.floor(f), 3); return rows[k].map((v, c) => lerp(v, rows[k + 1][c], f - k)); };
    const spine = [0, 1, 2, 3, 4, 5, 6].map((i) => { const a = lerp(ar, ae, i / 6), [w, h] = at(i / 6), q = polar(a, R * (1 - 0.06 * i / 6)); return stn(q[0], q[1], w * fat, h * fat, [Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean)]); }); // the back faces up and outward, the belly in and down
    const yaw = -(ah + Math.PI / 2) - turn, fx = Math.cos(yaw), fz = -Math.sin(yaw); // where the nose points
    const hp = polar(ah, R * 0.97);
    const pawAt = (side) => [hp[0] + fx * 0.074 + fz * side * 0.03, hp[1] + fz * 0.074 - fx * side * 0.03];
    const leg = (side) => { const q = pawAt(side), s0 = polar(ae - 0.25, R * 0.75); return limb([[s0[0], 0.065, s0[1]], [lerp(s0[0], q[0], 0.55), 0.04, lerp(s0[1], q[1], 0.55)], [q[0], ARM[2], q[1]]], ARM); };
    const Rt = R + 0.062 * fat + 0.022;
    const tail = TR.map((r, i) => { const a = ar + 0.2 - (i / 4) * tspan, rad = i === 0 ? R * 0.95 : lerp(R + 0.03, Rt, sm(0, 1.5, i)) - (i === 4 ? 0.03 * curl : 0); return polar(a, rad); });
    const th = polar(ar + 0.55, R * 1.02);
    return {
      spine, up: UP,
      head: headOf(u, { p: [hp[0], 0, hp[1]], yaw, pitch: u(-0.2, 0.05), roll: tilt, rest: 2 * PAW[1] - 0.004 }), // the chin rests on the front paws
      legs: [{ id: 'FL', pts: leg(-1), paw: paw(...pawAt(-1), PAW, yaw) }, { id: 'FR', pts: leg(1), paw: paw(...pawAt(1), PAW, yaw) }],
      thighs: [{ id: 'L', ...paw(th[0], th[1], [0.072, 0.074, 0.054], -(ar + 0.55 + Math.PI / 2)) }],
      tail: tailOf(tail, 0, curl),
      contacts: ['torso', 'pawFL', 'pawFR', 'thighL', 'tail'], breath: u(0.010, 0.018),
    };
  },

  // Loaf (and the sphinx): legs folded under, tail along the side. The loaf rests its chin on the tucked paws; the
  // sphinx holds its head up and nodding, chest raised, forearms stretched out in front.
  loaf(u, sphinx = false) {
    const len = u(0.95, 1.06), fat = u(0.95, 1.06), bend = u(-0.03, 0.03), turn = u(-0.75, 0.75), curl = u(0, 1), pz = u(0.046, 0.058);
    const X = [-0.13, -0.065, 0, 0.062, 0.108].map((x) => x * len);
    const rows = sphinx ? [[.064, .09], [.074, .102], [.07, .098], [.066, .104], [.054, .08]] : [[.064, .092], [.074, .106], [.072, .104], [.068, .106], [.056, .081]];
    const lift = sphinx ? [0, 0, 0.004, 0.022, 0.036] : [0, 0, 0, 0, 0];
    const spine = X.map((x, i) => stn(x, bend * Math.sin(Math.PI * i / 4), rows[i][0] * fat, rows[i][1] * fat, UP, rows[i][1] * fat + lift[i]));
    const nx = X[4], px = nx + (sphinx ? 0.078 : 0.05), hx = nx + (sphinx ? 0.078 : 0.084);
    const leg = (s) => limb([[X[3], sphinx ? 0.08 : 0.07, s * pz], [(X[3] + px) / 2, sphinx ? 0.05 : 0.045, s * pz], [px, ARM[2], s * pz]], ARM);
    const tz = 0.104 * fat;
    const tail = [[X[0], 0], [X[0] - 0.05, tz * 0.55], [X[0] + 0.01, tz], [X[2] + 0.02, tz * 1.02], [X[3] + 0.02, tz * (1 - 0.5 * curl)]];
    return {
      spine, up: UP,
      head: headOf(u, sphinx ? { p: [hx, spine[4].p[1] + 0.012, 0], yaw: turn, pitch: u(-0.5, -0.36), roll: u(-0.1, 0.1), rest: null } : { p: [hx, 0, u(-0.02, 0.02)], yaw: turn, pitch: u(-0.3, -0.08), roll: u(-0.1, 0.1), rest: 2 * PAW[1] - 0.004 }),
      legs: [{ id: 'FL', pts: leg(-1), paw: paw(px + 0.004, -pz) }, { id: 'FR', pts: leg(1), paw: paw(px + 0.004, pz) }],
      thighs: [-1, 1].map((s) => ({ id: s < 0 ? 'L' : 'R', ...paw(X[1], s * 0.06 * fat, [0.088, 0.078, 0.05]) })),
      tail: tailOf(tail, 0, curl),
      contacts: ['torso', 'pawFL', 'pawFR', 'thighL', 'thighR', 'tail'], breath: u(0.010, 0.018),
    };
  },

  // On its side, stretched out a little, the belly toward the viewer, the head resting on the floor.
  side(u) {
    const len = u(0.95, 1.05), fat = u(1.04, 1.14), phi = u(1.15, 1.45), bend = u(-0.02, 0.05), turn = u(-0.6, 0.5), curl = u(0, 1);
    const up = [0, Math.cos(phi), -Math.sin(phi)]; // the back faces away and a little up
    const X = [-0.17, -0.09, -0.005, 0.075, 0.12].map((x) => x * len);
    const rows = [[.058, .072], [.068, .084], [.064, .08], [.066, .084], [.052, .062]];
    const spine = rows.map(([w, h], i) => stn(X[i], -bend * Math.sin(Math.PI * i / 4), w * fat, h * fat, up));
    const zf = spine[3].p[2] + spine[3].h * Math.sin(phi), zh = spine[1].p[2] + spine[1].h * Math.sin(phi); // belly edge at the chest and the hips
    const arm = (dz, hi) => limb([[X[3], 0.055 + hi, zf - 0.045], [X[3] + 0.03, 0.042 + hi * 0.6, zf + dz * 0.6], [X[3] + 0.055 - hi, ARM[2], zf + dz]], ARM);
    const leg = (dz, hi) => limb([[X[1], 0.055 + hi, zh - 0.045], [X[1] - 0.03, 0.042 + hi * 0.6, zh + dz * 0.6], [X[1] - 0.055 + hi, LEG[2], zh + dz]], LEG);
    const fl = arm(0.015, 0), fr = arm(0.05, 0.02), hl = leg(0.02, 0), hr = leg(0.055, 0.02);
    const pawOf = (l, yaw) => paw(l[2].p[0] + Math.cos(yaw) * 0.01, l[2].p[2], PAW, yaw);
    return {
      spine, up,
      head: headOf(u, { p: [X[4] + 0.104, 0, spine[4].p[2] + 0.03], yaw: turn, pitch: u(-0.1, 0.15), roll: Math.atan2(up[2], up[1]) }),
      legs: [['FL', fl, 0], ['FR', fr, 0.15], ['HL', hl, Math.PI], ['HR', hr, Math.PI - 0.15]].map(([id, pts, yaw]) => ({ id, pts, paw: pawOf(pts, yaw) })),
      thighs: [{ id: 'L', ...paw(X[1] - 0.005, spine[1].p[2] + 0.04, [0.08, 0.068, 0.058], 0, 0.085) }],
      tail: tailOf([[X[0] - 0.01, spine[0].p[2]], [X[0] - 0.09, spine[0].p[2] - 0.01 * curl], [X[0] - 0.17, spine[0].p[2] + 0.03 + 0.03 * curl], [X[0] - 0.22, spine[0].p[2] + 0.09 + 0.07 * curl], [X[0] - 0.23, spine[0].p[2] + 0.16 + 0.09 * curl]], 0.06, curl),
      contacts: ['torso', 'head', 'pawFL', 'pawFR', 'pawHL', 'pawHR', 'tail'], breath: u(0.010, 0.018),
    };
  },

  // Belly up: forearms folded on the chest, hind legs flopped out to the sides like a frog, the head lolling back.
  back(u) {
    const len = u(0.92, 1.0), fat = u(0.96, 1.05), lean = u(-0.3, 0.3), turn = u(0.4, 1.0), curl = u(0, 1);
    const up = [0, -Math.cos(lean), Math.sin(lean)]; // the back faces the floor
    const X = [-0.13, -0.065, -0.005, 0.055, 0.1].map((x) => x * len);
    const rows = [[.064, .07], [.076, .082], [.072, .078], [.074, .08], [.058, .062]];
    const spine = rows.map(([w, h], i) => stn(X[i], 0, w * fat, h * fat, up));
    const top = (i) => spine[i].p[1] + reach(spine[i].w, spine[i].h, up); // the belly's top
    const sp = [u(0.14, 0.185), u(0.14, 0.185)], bk = [u(0.02, 0.08), u(0.02, 0.08)], flop = [u(0, 1) < 0.4, u(0, 1) < 0.4], knee = [u(0.03, 0.07), u(0.03, 0.07)];
    // each hind leg either flops to the floor, or is raised open: the knee above the belly and the paw hanging in the air
    const hind = (s, k) => (flop[k]
      ? limb([[X[1], 0.09, s * 0.065], [X[1] + 0.025, 0.06, s * (sp[k] * 0.62)], [X[1] - bk[k], LEG[2], s * sp[k]]], LEG)
      : limb([[X[1], top(1) - 0.05, s * 0.05], [X[1] + 0.03, top(1) + knee[k], s * (sp[k] * 0.7)], [X[1] - 0.03, top(1) + knee[k] * 0.4, s * (sp[k] + 0.05)]], LEG));
    const fore = (s) => limb([[X[3] - 0.01, top(3) - 0.05, s * 0.045], [X[3] - 0.005, top(3) - 0.006, s * 0.06], [X[3] + 0.04, top(3) + 0.004, s * 0.036]], [0.036, 0.031, 0.028]);
    const hl = hind(-1, 0), hr = hind(1, 1);
    const pf = (s) => paw(X[3] + 0.05, s * 0.036, PAW, 0, top(3) + 0.012);
    const ph = (l, k) => paw(l[2].p[0] - 0.012, l[2].p[2], PAW, Math.PI, flop[k] ? undefined : l[2].p[1]);
    return {
      spine, up,
      head: headOf(u, { p: [X[4] + 0.102, 0, 0], yaw: -turn, pitch: u(-0.1, 0.2), roll: u(1.2, 2.0) }),
      legs: [{ id: 'FL', pts: fore(-1), paw: pf(-1) }, { id: 'FR', pts: fore(1), paw: pf(1) }, { id: 'HL', pts: hl, paw: ph(hl, 0) }, { id: 'HR', pts: hr, paw: ph(hr, 1) }],
      thighs: [],
      tail: tailOf([[X[0] - 0.01, 0], [X[0] - 0.07, 0.03], [X[0] - 0.1, 0.07 + 0.03 * curl], [X[0] - 0.1, 0.12 + 0.05 * curl], [X[0] - 0.07, 0.17 + 0.06 * curl]], 0.06, curl),
      contacts: ['torso', 'head', 'tail'].concat(flop[0] ? ['pawHL'] : [], flop[1] ? ['pawHR'] : []), breath: u(0.010, 0.018),
    };
  },

  // Sploot: belly down, hind legs stretched out behind like a frog, chin on the floor between the front paws.
  sploot(u) {
    const len = u(0.95, 1.03), fat = u(0.96, 1.05), turn = u(-0.6, 0.6), curl = u(0, 1), spread = u(0.8, 1.2), asym = u(0.85, 1.15);
    const X = [-0.1, -0.035, 0.02, 0.08, 0.125].map((x) => x * len);
    const rows = [[.082, .058], [.092, .066], [.084, .062], [.08, .064], [.056, .05]];
    const spine = rows.map(([w, h], i) => stn(X[i], 0, w * fat, h * fat));
    const hz = 0.1 * spread;
    const hind = (s) => { const k = s < 0 ? 1 : asym; return limb([[X[1] - 0.03, 0.045, s * 0.09], [X[1] - 0.11 * k, LEG[2] + 0.004, s * (hz + 0.025)], [X[1] - 0.185 * k, LEG[2], s * (hz - 0.005)]], LEG); };
    const fore = (s) => limb([[X[3], 0.05, s * 0.055], [X[3] + 0.06, 0.036, s * 0.07], [X[3] + 0.12, ARM[2], s * 0.076]], ARM);
    return {
      spine, up: UP,
      head: headOf(u, { p: [X[4] + 0.1, 0, u(-0.02, 0.02)], yaw: turn, pitch: u(0, 0.25), roll: u(-0.15, 0.15) }),
      legs: [-1, 1].flatMap((s) => [{ id: s < 0 ? 'HL' : 'HR', pts: hind(s), paw: paw(X[1] - 0.2 * (s < 0 ? 1 : asym), s * (hz - 0.006), [0.042, 0.025, 0.034], Math.PI + 0.25 * s) }, { id: s < 0 ? 'FL' : 'FR', pts: fore(s), paw: paw(X[3] + 0.132, s * 0.076) }]),
      thighs: [-1, 1].map((s) => ({ id: s < 0 ? 'L' : 'R', ...paw(X[1] - 0.025, s * 0.088, [0.078, 0.046, 0.062]) })),
      tail: tailOf([[X[0] - 0.01, 0], [X[0] - 0.09, 0.015 * curl], [X[0] - 0.16, 0.045 * curl], [X[0] - 0.22, 0.07 * curl], [X[0] - 0.26, 0.055 * curl]], 0.06, curl),
      contacts: ['torso', 'head', 'pawFL', 'pawFR', 'pawHL', 'pawHR', 'thighL', 'thighR', 'tail'], breath: u(0.010, 0.018),
    };
  },

  // Croissant: a loose C-curl lying a little on its side, head on the front paws, tail along the belly inside the C.
  croissant(u) {
    const R = u(0.13, 0.145), fat = u(0.96, 1.05), span = u(2.7, 3.1), gap = u(0.62, 0.78), ah = u(-0.4, 0.4), phi = u(0.2, 0.45);
    const ae = ah - gap, ar = ae - span, turn = u(0.2, 0.6);
    const rows = [[.066, .074], [.076, .084], [.072, .08], [.07, .08], [.054, .062]];
    const spine = [0, 1, 2, 3, 4].map((i) => { const a = lerp(ar, ae, i / 4), [w, h] = rows[i], q = polar(a, R * (1 - 0.05 * i / 4)); return stn(q[0], q[1], w * fat, h * fat, [Math.cos(a) * Math.sin(phi), Math.cos(phi), Math.sin(a) * Math.sin(phi)]); });
    const yaw = -(ah + Math.PI / 2) - turn, hp = polar(ah, R * 0.9);
    const pa = (side) => polar(ah + 0.1, R * 0.9 + side * 0.03);
    const leg = (side) => { const q = pa(side), s0 = polar(ae - 0.15, R * 0.9); return limb([[s0[0], 0.065, s0[1]], [lerp(s0[0], q[0], 0.5), 0.04, lerp(s0[1], q[1], 0.5)], [q[0], ARM[2], q[1]]], ARM); };
    const Rin = R - 0.075 * fat - 0.034; // the tail lies just inside the C
    const tail = TR.map((r, i) => polar(ar + 0.05 + i * 0.3, i === 0 ? R * 0.95 : Rin));
    const th = polar(ar + 0.5, R * 0.95);
    return {
      spine, up: UP,
      head: headOf(u, { p: [hp[0], 0, hp[1]], yaw, pitch: u(-0.2, 0.05), roll: u(-0.3, 0.3), rest: 2 * PAW[1] - 0.004 }),
      legs: [{ id: 'FL', pts: leg(-1), paw: paw(...pa(-1), PAW, yaw) }, { id: 'FR', pts: leg(1), paw: paw(...pa(1), PAW, yaw) }],
      thighs: [{ id: 'L', ...paw(th[0], th[1], [0.072, 0.074, 0.054], -(ar + 0.5 + Math.PI / 2)) }],
      tail: tailOf(tail, 0, 0.5),
      contacts: ['torso', 'tail', 'thighL', 'pawFL', 'pawFR'], breath: u(0.010, 0.018),
    };
  },
};
BUILD.sphinx = (u) => BUILD.loaf(u, true);

const WEIGHTS = [['orange', 0.44], ['grey', 0.62], ['cream', 0.74], ['brown', 0.9], ['black', 1]]; // cumulative: orange is the common coat

// The pose for a seed. `wanted` is a pose name or an index into POSES; without it the seed picks the pose.
// The first three random numbers are drawn either way, so one seed keeps its coat and mirror when `wanted` changes.
export function pickPose(seed, wanted) {
  const s = seed >>> 0, r = mulberry32(s);
  const a = r(), b = r(), c = r(), n = POSES.length;
  const name = typeof wanted === 'string' && POSES.includes(wanted) ? wanted : Number.isInteger(wanted) ? POSES[((wanted % n) + n) % n] : PICKED[Math.floor(a * PICKED.length)];
  const u = (lo, hi) => lo + (hi - lo) * r();
  const data = BUILD[name](u);
  return { name, seed: s, mirror: c < 0.5, fur: WEIGHTS.find(([, t]) => b < t)[0], ...data, coat: { phase: u(0, 1), pitch: u(0.038, 0.058), bold: u(0.8, 1.1) } };
}

// ── Coat colours (sRGB hex); `contrast` scales the stripes ────────────
const COATS = {
  orange: { base: 0xe0903f, stripe: 0xa9561f, light: 0xf8dfb0, line: 0x5e2f16, contrast: 1 },
  grey: { base: 0xa4a9ae, stripe: 0x5a616a, light: 0xe6e6e3, line: 0x33373d, contrast: 1 },
  cream: { base: 0xe6bf88, stripe: 0xc08c4e, light: 0xf8e3bd, line: 0x7f5f40, contrast: 0.85 },
  brown: { base: 0x8a6240, stripe: 0x45301f, light: 0xd0b088, line: 0x24160d, contrast: 1 },
  black: { base: 0x34333a, stripe: 0x27262b, light: 0x5a5660, line: 0x8b8793, contrast: 0.3 },
};
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }; // vertex colours are linear
const palette = (name) => { const c = COATS[name] ?? COATS.orange; return { base: hex(c.base), stripe: hex(c.stripe), light: hex(c.light), line: hex(c.line), nose: hex(0xea8f98), inner: hex(0xf0a0a0), contrast: c.contrast }; };
const mix = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
const stripeBar = (ph) => { const f = ph - Math.floor(ph); return sm(0.26, 0.42, f) * (1 - sm(0.62, 0.78, f)); }; // one soft bar per unit of phase
const flat = (rgb) => (c) => { c[0] = rgb[0]; c[1] = rgb[1]; c[2] = rgb[2]; };

// How each kind of part is painted. g carries the vertex's place: th (angle around a ring, 0 = back), s (metres along), u (0..1 along).
function coatPaint(P, kind, C, salt) {
  return (c, g) => {
    const dors = 0.5 + 0.5 * Math.cos(g.th); // 1 on the back, 0 on the belly
    let st = 0, lit = 0;
    if (kind === 'torso') {
      const ph = g.s / C.pitch + C.phase + 0.3 * Math.sin(2 * g.th + 1.3) + 0.12 * Math.sin(5 * g.th);
      st = Math.max(stripeBar(ph) * (0.55 + 0.45 * hash(Math.floor(ph), salt)) * sm(0.05, 0.35, dors), 0.85 * sm(0.93, 0.99, Math.cos(g.th)));
      lit = sm(0.2, 0.05, dors);
    } else if (kind === 'tail') {
      st = Math.max(stripeBar(g.s / 0.03 + C.phase) * 0.9, sm(0.84, 0.95, g.u));
      lit = 0.35 * sm(0.3, 0, dors);
    } else { // leg: faint bars above, a pale sock at the paw
      st = stripeBar(g.s / 0.026 + C.phase + 0.4 * Math.sin(g.th)) * (1 - sm(0.45, 0.7, g.u)) * 0.85;
      lit = 0.6 * sm(0.8, 0.97, g.u);
    }
    mix(c, P.base, P.stripe, clamp(st * P.contrast * C.bold, 0, 1));
    mix(c, c, P.light, lit);
  };
}

// ── Mesh builder ──────────────────────────────────────────────────────
// Everything goes into one growing list of vertices (position + colour) and triangles. `parts` remembers which
// vertices belong to which body part, so the checks can find them again.
const newB = () => ({ pos: [], col: [], idx: [], parts: {}, cur: '', at: 0 });
const open = (B, name) => { B.cur = name; B.at = B.pos.length / 3; };
const shut = (B) => { B.parts[B.cur] = [B.at, B.pos.length / 3]; };
const ID = (x, y, z, o) => { o[0] = x; o[1] = y; o[2] = z; return o; };
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const away = (a, t) => { const d = a[0] * t[0] + a[1] * t[1] + a[2] * t[2]; return [a[0] - t[0] * d, a[1] - t[1] * d, a[2] - t[2] * d]; }; // a without its part along t

// A local-to-cat map: roll about the nose (x), pitch (nose up), then turn by yaw about y, then move to c.
function frame(c, yaw = 0, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cl = Math.cos(roll), sl = Math.sin(roll);
  return (x, y, z, o) => {
    const y1 = y * cl - z * sl, z1 = y * sl + z * cl, x2 = x * cp - y1 * sp, y2 = x * sp + y1 * cp;
    o[0] = c[0] + x2 * cy + z1 * sy; o[1] = c[1] + y2; o[2] = c[2] - x2 * sy + z1 * cy;
    return o;
  };
}

// Joins R rings of m vertices (placed from `base`) into triangles that face outward, and closes both ends with the
// two pole vertices that follow the rings.
function stitch(B, base, R, m) {
  const A = base + R * m, Z = A + 1, last = base + (R - 1) * m;
  for (let i = 0; i < R - 1; i++) {
    for (let k = 0; k < m; k++) {
      const a = base + i * m + k, b = base + i * m + ((k + 1) % m);
      B.idx.push(a, b, a + m, b, b + m, a + m);
    }
  }
  for (let k = 0; k < m; k++) {
    const k1 = (k + 1) % m;
    B.idx.push(A, base + k1, base + k, Z, last + k, last + k1);
  }
}

// Catmull-Rom through the values v, at t in 0..1 (d: the slope instead). The ends are extended by mirroring.
function spl(v, t, d) {
  const K = v.length - 1, f = Math.min(t * K, K - 1e-9), i = Math.floor(f);
  const q = (j) => (j < 0 ? 2 * v[0] - v[1] : j > K ? 2 * v[K] - v[K - 1] : v[j]);
  return (d ? dcr : cr)(q(i - 1), q(i), q(i + 1), q(i + 2), f - i);
}

// A smooth tube through the stations (centre p, half-width w across, half-height h along `up`), rings `ds` apart
// along its length, with rounded ends. paint(colour, { th, s, u }) colours each vertex: th the angle round the ring
// (0 = the back), s the metres along, u 0..1 along.
function tube(B, st, o) {
  const { m, ds, paint, xf = ID } = o, K = st.length - 1, col = [0, 0, 0], g = { th: 0, s: 0, u: 0 }, out = [0, 0, 0];
  const ch = (f) => st.map(f), X = ch((s) => s.p[0]), Y = ch((s) => s.p[1]), Z = ch((s) => s.p[2]), W = ch((s) => s.w), H = ch((s) => s.h);
  const U = [0, 1, 2].map((k) => ch((s) => (s.up ?? UP)[k]));
  const N = K * 20, tab = [0];
  let px = X[0], py = Y[0], pz = Z[0];
  for (let k = 1; k <= N; k++) { // a length table, so the rings can be spaced evenly
    const t = k / N, x = spl(X, t), y = spl(Y, t), z = spl(Z, t);
    tab.push(tab[k - 1] + Math.hypot(x - px, y - py, z - pz));
    px = x; py = y; pz = z;
  }
  const L = tab[N], n = Math.max(4, Math.round(L / ds) + 1), fr = [];
  let k = 0, keep = [0, 1, 0];
  for (let i = 0; i < n; i++) {
    const s = (L * i) / (n - 1);
    while (k < N - 1 && tab[k + 1] < s) k++;
    const t = (k + (s - tab[k]) / Math.max(tab[k + 1] - tab[k], 1e-9)) / N;
    const T = unit([spl(X, t, 1), spl(Y, t, 1), spl(Z, t, 1)]);
    let Nn = away([spl(U[0], t), spl(U[1], t), spl(U[2], t)], T);
    if (len3(Nn) < 0.25) Nn = away(keep, T); // the back runs along the curve: carry on with the last frame
    if (len3(Nn) < 1e-6) Nn = away([1, 0, 0], T);
    Nn = unit(Nn);
    keep = Nn;
    fr.push({ P: [spl(X, t), spl(Y, t), spl(Z, t)], T, N: Nn, B: cross(T, Nn), w: Math.max(spl(W, t), 0.002), h: Math.max(spl(H, t), 0.002), s });
  }
  const base = B.pos.length / 3, cs = [], sn = [];
  for (let j = 0; j < m; j++) { cs.push(Math.cos((TAU * j) / m)); sn.push(Math.sin((TAU * j) / m)); }
  const put = (f, scale, shift, u) => {
    for (let j = 0; j < m; j++) {
      const a = cs[j] * f.h * scale, b = sn[j] * f.w * scale;
      g.th = (TAU * j) / m; g.s = f.s; g.u = u;
      paint(col, g);
      const p = xf(f.P[0] + f.T[0] * shift + f.N[0] * a + f.B[0] * b, f.P[1] + f.T[1] * shift + f.N[1] * a + f.B[1] * b, f.P[2] + f.T[2] * shift + f.N[2] * a + f.B[2] * b, out);
      B.pos.push(p[0], p[1], p[2]);
      B.col.push(col[0], col[1], col[2]);
    }
  };
  const f0 = fr[0], f1 = fr[n - 1], d0 = 0.85 * (f0.w + f0.h) / 2, d1 = 0.85 * (f1.w + f1.h) / 2;
  put(f0, 0.34, -0.94 * d0, 0); put(f0, 0.82, -0.57 * d0, 0); // the rounded end, as rings closing in on a pole
  for (let i = 0; i < n; i++) put(fr[i], 1, 0, i / (n - 1));
  put(f1, 0.82, 0.57 * d1, 1); put(f1, 0.34, 0.94 * d1, 1);
  for (const [f, d, u] of [[f0, -d0, 0], [f1, d1, 1]]) {
    g.th = 0; g.s = f.s; g.u = u;
    paint(col, g);
    const p = xf(f.P[0] + f.T[0] * d, f.P[1] + f.T[1] * d, f.P[2] + f.T[2] * d, out);
    B.pos.push(p[0], p[1], p[2]);
    B.col.push(col[0], col[1], col[2]);
  }
  stitch(B, base, n + 4, m);
}

// An ellipsoid with radii r; xf maps its own space to the cat. paint gets the unit direction (nx, ny, nz).
function blob(B, r, xf, nu, nv, paint) {
  const base = B.pos.length / 3, col = [0, 0, 0], g = { nx: 0, ny: 0, nz: 0 }, out = [0, 0, 0];
  const put = (nx, ny, nz) => {
    g.nx = nx; g.ny = ny; g.nz = nz;
    paint(col, g);
    const p = xf(r[0] * nx, r[1] * ny, r[2] * nz, out);
    B.pos.push(p[0], p[1], p[2]);
    B.col.push(col[0], col[1], col[2]);
  };
  for (let j = 1; j < nv; j++) {
    const ph = -Math.PI / 2 + (Math.PI * j) / nv, cp = Math.cos(ph), sp = Math.sin(ph);
    for (let k = 0; k < nu; k++) { const th = (TAU * k) / nu; put(cp * Math.sin(th), sp, cp * Math.cos(th)); }
  }
  put(0, -1, 0);
  put(0, 1, 0);
  stitch(B, base, nv - 1, nu);
}

// ── The head: skull, cheeks, muzzle, nose, ears, closed eyes and the forehead 'M' ────────────────────
const RH = 0.067; // head radius: a big round head, about 0.13 m across
const skull = (az, el, k = 1) => [k * 0.98 * Math.cos(el) * Math.cos(az), k * 0.86 * Math.sin(el), k * Math.cos(el) * Math.sin(az)]; // a point on the skull, in head radii
function addHead(B, H, P, Q) {
  const rh = RH * H.s, F = frame(H.p, H.yaw, H.pitch, H.roll);
  const at = (c) => (x, y, z, o) => F(x + c[0] * rh, y + c[1] * rh, z + c[2] * rh, o);
  const S = (v) => v.map((a) => a * rh);
  open(B, 'head');
  B.skull = [B.pos.length / 3, B.pos.length / 3 + Q.nu * (Q.nv - 1) + 2]; // the skull's vertices come first (the checks read them)
  blob(B, S([0.98, 0.86, 1]), at([0, 0, 0]), Q.nu, Q.nv, (c, g) => { // skull: pale muzzle and chin, a darker cap on top
    mix(c, P.base, P.light, clamp(sm(0.5, 0.95, g.nx) * sm(0.05, -0.5, g.ny) + sm(-0.72, -0.95, g.ny), 0, 1));
    mix(c, c, P.stripe, 0.35 * P.contrast * sm(0.55, 0.95, g.ny));
  });
  const pale = (c, g) => mix(c, P.base, P.light, 0.3 - 0.25 * g.ny);
  const line = (pts, r, color, m = 4) => tube(B, pts.map((p) => ({ p: S(p), w: r * rh, h: r * rh })), { m, ds: 0.006, paint: flat(color), xf: F });
  blob(B, S([0.1, 0.08, 0.13]), at([1.03, -0.1, 0]), 8, 5, flat(P.nose)); // nose
  for (const s of [-1, 1]) {
    blob(B, S([0.6 * H.cheek, 0.5 * H.cheek, 0.42 * H.cheek]), at([0.02, -0.3, s * 0.6]), Q.nb, Q.nc, pale); // cheek fluff
    blob(B, S([0.3, 0.26, 0.27]), at([0.78, -0.26, s * 0.2]), Q.nb, Q.nc, flat(P.light)); // the two halves of the muzzle
    // ear: a flat tube up and out from the skull; its front face is pink
    const e = H.ear, sp = 1 + e.splay;
    const ep = [[-0.08, 0.68, 0.5], [-0.12 - e.back * 0.3, 0.98 - e.droop * 0.08, 0.64 * sp], [-0.17 - e.back * 0.5, 1.22 - e.droop * 0.4, (0.74 + e.droop * 0.3) * sp], [-0.2 - e.back * 0.6, 1.34 - e.droop * 0.5, (0.78 + e.droop * 0.36) * sp]];
    tube(B, ep.map(([x, y, z], i) => ({ p: S([x, y, s * z]), w: [0.68, 0.62, 0.44, 0.14][i] * rh, h: [0.2, 0.17, 0.12, 0.05][i] * rh, up: unit([0.8, 0, s * 0.6]) })), {
      m: Q.me, ds: 0.014, xf: F, paint: (c, g) => { mix(c, P.base, P.inner, sm(0.2, 0.7, Math.cos(g.th)) * sm(0.05, 0.3, g.u) * (1 - sm(0.75, 0.95, g.u))); },
    });
    line([[0.36, 0.09], [0.52, 0.02], [0.68, 0.09]].map(([az, el]) => { const p = skull(az, el, 1.012); return [p[0], p[1], p[2] * s]; }), 0.085, P.line); // closed eye: a sleepy curve
  }
  for (const pts of [[[0, 0.7], [0, 0.95], [0, 1.2]], [[0.3, 0.68], [0.38, 0.9], [0.5, 1.1]], [[-0.3, 0.68], [-0.38, 0.9], [-0.5, 1.1]]]) line(pts.map(([az, el]) => skull(az, el, 1.01)), 0.055, P.stripe); // forehead 'M'
  shut(B);
}

// ── Putting one cat together ──────────────────────────────────────────
const FULL = { mt: 14, dt: 0.01, ml: 8, dl: 0.011, mk: 8, dk: 0.012, nu: 16, nv: 10, nb: 9, nc: 6, me: 5, np: 9, nq: 6 };
const LITE = { mt: 10, dt: 0.018, ml: 6, dl: 0.02, mk: 6, dk: 0.022, nu: 10, nv: 7, nb: 6, nc: 4, me: 4, np: 7, nq: 5 }; // ring counts are even: a vertex sits at the lowest point of a ring

const lowest = (B, part) => { const [a, b] = B.parts[part]; let y = Infinity; for (let i = a; i < b; i++) y = Math.min(y, B.pos[i * 3 + 1]); return y; };
const shiftY = (B, part, dy) => { const [a, b] = B.parts[part]; for (let i = a; i < b; i++) B.pos[i * 3 + 1] += dy; };

// Everything the pose needs, as vertex lists: `B` (torso, limbs, head) and `T` (the tail, its own mesh so it can sway).
function build(pose, lite) {
  const Q = lite ? LITE : FULL, P = palette(pose.fur), salt = pose.seed & 0xffff, B = newB(), T = newB();
  open(B, 'torso');
  tube(B, pose.spine, { m: Q.mt, ds: Q.dt, paint: coatPaint(P, 'torso', pose.coat, salt) });
  shut(B);
  shiftY(B, 'torso', -lowest(B, 'torso')); // a low-poly ring has no vertex at the exact bottom of a tilted ellipse: rest on the lowest real vertex
  for (const th of pose.thighs) { // haunches: a plump ellipsoid for each hind thigh
    open(B, 'thigh' + th.id);
    blob(B, th.s, frame(th.p, th.yaw), Q.nu, Q.nv, (c, g) => { mix(c, P.base, P.stripe, 0.5 * P.contrast * stripeBar(g.nx * 1.3 + 0.2 * g.nz)); mix(c, c, P.light, 0.5 * sm(-0.3, -0.9, g.ny)); });
    shut(B);
  }
  for (const L of pose.legs) {
    open(B, 'leg' + L.id);
    tube(B, L.pts, { m: Q.ml, ds: Q.dl, paint: coatPaint(P, 'leg', pose.coat, salt) });
    shut(B);
    open(B, 'paw' + L.id);
    blob(B, L.paw.s, frame(L.paw.p, L.paw.yaw), Q.np, Q.nq, (c, g) => mix(c, P.light, P.base, 0.3 * sm(0.3, 0.9, g.ny)));
    shut(B);
  }
  addHead(B, pose.head, P, Q);
  let headDy = 0;
  if (pose.head.rest !== null && pose.head.rest !== undefined) { headDy = pose.head.rest - lowest(B, 'head'); shiftY(B, 'head', headDy); } // the head rests its lowest point on the floor or on the paws
  const t = pose.tail;
  open(T, 'tail');
  tube(T, t.pts.map((p, i) => ({ p, w: t.r[i], h: t.r[i] })), { m: Q.mk, ds: Q.dk, paint: coatPaint(P, 'tail', pose.coat, salt) });
  shut(T);
  return { B, T, headDy };
}

// Flip left and right as the room camera sees them (x -> -x): a true mirror also turns every triangle around so it
// still faces outward. The belly side keeps facing +z, so a mirrored cat shows the same side, head pointing the other way.
function mirrorX(B) {
  for (let i = 0; i < B.pos.length; i += 3) B.pos[i] = -B.pos[i] || 0;
  for (let i = 0; i < B.idx.length; i += 3) { const t = B.idx[i + 1]; B.idx[i + 1] = B.idx[i + 2]; B.idx[i + 2] = t; }
}

// Smooth normals: each triangle's (area-weighted) normal is added to its three corners, then every sum is made 1 long.
// Faster than geometry.computeVertexNormals(), which builds a Vector3 per corner.
function normalsOf(B) {
  const P = B.pos, I = B.idx, N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return N;
}

const geometryOf = (B) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(B.pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(B.col), 3));
  g.setIndex(new THREE.BufferAttribute(B.pos.length / 3 > 65535 ? new Uint32Array(B.idx) : new Uint16Array(B.idx), 1));
  g.setAttribute('normal', new THREE.BufferAttribute(normalsOf(B), 3));
  g.computeBoundingSphere();
  return g;
};

// The warm hover tint: 0x3a2a14 at half strength, scaled by the glow amount (a linear colour, made once).
const GLOW = new THREE.Color(0x3a2a14);

// Simon. `pose` may be a pose name, an index into POSES, or a whole object from pickPose (then `fur` still wins).
// Returns the group to add to the scene and the little handles the room needs.
export function makeCat({ seed = 1, pose, fur, lite = false } = {}) {
  const data = pose && typeof pose === 'object' ? pose : pickPose(seed, pose);
  const coat = fur && COATS[fur] ? fur : data.fur;
  const d = coat === data.fur ? data : { ...data, fur: coat };
  const { B, T, headDy } = build(d, lite);
  if (d.mirror) { mirrorX(B); mirrorX(T); }
  // Centre the box on x and z and put its lowest point at y = 0: the group's origin is under the middle of the cat.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const L of [B, T]) for (let i = 0; i < L.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], L.pos[i + k]); hi[k] = Math.max(hi[k], L.pos[i + k]); }
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  for (const L of [B, T]) for (let i = 0; i < L.pos.length; i += 3) { L.pos[i] -= cx; L.pos[i + 1] -= lo[1]; L.pos[i + 2] -= cz; }
  // The tail swings about its root, so its vertices are kept relative to that root.
  const r0 = d.tail.pts[0], root = [(d.mirror ? -r0[0] : r0[0]) - cx, r0[1] - lo[1], r0[2] - cz];
  for (let i = 0; i < T.pos.length; i += 3) { T.pos[i] -= root[0]; T.pos[i + 1] -= root[1]; T.pos[i + 2] -= root[2]; }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, emissive: 0x000000 });
  const materials = [mat]; // every material the cat uses; the room tints their `emissive` for the hover glow
  const group = new THREE.Group();
  group.name = 'simon';
  group.userData.catRoot = true;
  const breath = new THREE.Group(); // origin at the floor, so scaling it in y grows the cat upward from the surface
  const body = new THREE.Mesh(geometryOf(B), mat);
  const tail = new THREE.Mesh(geometryOf(T), mat);
  body.name = 'simon-body';
  tail.name = 'simon-tail';
  const swing = new THREE.Group();
  swing.position.set(root[0], root[1], root[2]);
  swing.add(tail);
  for (const m of [body, tail]) { m.castShadow = true; m.receiveShadow = true; }
  breath.add(body, swing);
  group.add(breath);
  group.userData.parts = B.parts; // vertex ranges of the body mesh, by part name (the checks read these)
  group.userData.tailRoot = root;
  const hp = d.head.p;
  group.userData.head = { centre: [(d.mirror ? -hp[0] : hp[0]) - cx, hp[1] + headDy - lo[1], hp[2] - cz], radius: RH * d.head.s, skull: B.skull }; // skull centre and radius, in the group's space, and its vertex range in the body mesh

  const size = { length: hi[0] - lo[0], width: hi[2] - lo[2], height: hi[1] - lo[1] };
  const amp = d.breath, drift = d.tail.drift, ph = ((d.seed % 1000) / 1000) * TAU;
  let still = true;
  function update(time, reduced) {
    if (reduced) { // nothing moves: put it back at rest once
      if (!still) { breath.scale.y = 1; swing.rotation.y = 0; still = true; }
      return;
    }
    still = false;
    breath.scale.y = 1 + amp * (0.5 + 0.5 * Math.sin(TAU * 0.25 * time + ph)); // rises by `amp` (1-1.8 %) of its height and falls back, 0.25 Hz
    swing.rotation.y = drift * Math.sin(TAU * 0.07 * time + ph * 2); // the tail tip drifts slowly (a turn about y keeps it on the floor)
  }
  function setGlow(amount) {
    const k = clamp(amount, 0, 1) * 0.5;
    for (const m of materials) m.emissive.setRGB(GLOW.r * k, GLOW.g * k, GLOW.b * k);
  }
  function dispose() {
    body.geometry.dispose();
    tail.geometry.dispose();
    for (const m of materials) m.dispose();
  }
  const hy = d.head.yaw, hc = Math.cos(d.head.pitch), fd = Math.hypot(hc * Math.cos(hy), hc * Math.sin(hy)) || 1;
  const faceDir = [((d.mirror ? -1 : 1) * hc * Math.cos(hy)) / fd, (-hc * Math.sin(hy)) / fd]; // where the head looks (x, z), so the caller can turn the face toward the camera
  group.userData.faceDir = faceDir;
  return { group, pose: d, fur: coat, size, materials, faceDir, setGlow, update, dispose };
}
