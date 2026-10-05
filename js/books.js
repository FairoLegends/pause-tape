// The books on the bookshelf, placed by a small generator (learner request, 5 Oct 2026: a leaning book
// must never float on nothing, and the shelf should look different every time the page opens).
// Pure maths: no three.js and no page, so Node can import this file and the checks can try thousands of seeds.
// Unity map: a script that fills a shelf prefab from `new System.Random(seed)`. The same seed gives the same shelf.
//
// Rules every arrangement follows (the generator checks them itself and rebuilds a row if one fails):
//   1. Books never pass into each other, into the board above, or into a side panel.
//   2. A standing book stands on its board. A leaning book rests its lower corner on the board.
//   3. A leaning book tips TOWARD a standing book that touches it, and that book has a neighbour on its far
//      side, so the pair cannot topple. A book never leans on empty air.
//   4. A leaning book is tilted far enough that its weight pushes into its support instead of back to upright.
//
// Coordinates are the shelf's own, in metres: x to the right, y up, the shelf's centre at x = 0.
// A tilt is a turn about z, as in three.js: a positive `lean` tips the top of the book to the LEFT.

const PITCH = 0.004; // gap between two neighbours that stand
const TOUCH = 0.0006; // air left where a leaning book touches: it reads as contact and never puts one book inside another
const BACKED = 0.006; // a support counts as backed when another standing book is at most this close behind it
const MAX_LEANS_PER_ROW = 2;
const MAX_LEANS_PER_SHELF = 4; // over all five rows: a few leaning books look lived in, seven look messy

// ── Seeds ─────────────────────────────────────────────────────────────

// FNV-1a: any text to a whole number, so ?books=anything works.
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// The seed asked for in the address (?books=123), or null when there is none. A whole number is used as it is.
export function seedFromParam(text) {
  if (text === null || text === undefined) return null;
  const t = String(text).trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : hashText(t);
}

// A new seed for every page load: the browser's own random source when it has one.
export function randomSeed() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296);
}

// mulberry32: a tiny random generator whose numbers depend only on the seed, so every browser builds the same shelf.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The shelf's measurements ──────────────────────────────────────────

// Rows and ranges from the shelf's own numbers (room.js passes them in, so the two cannot drift apart).
// boards: the height of each board's middle; a board is 3 cm thick. front: where the books' front faces sit.
export function shelfSpec({ width, side, boards, front, margin = 0.015 }) {
  const rows = boards.slice(0, -1).map((y, i) => {
    const floorY = y + 0.015; // the top of the board the row stands on
    const free = boards[i + 1] - 0.015 - floorY; // clear height up to the next board
    return { floorY, free, maxH: free - 0.02 };
  });
  return {
    xMin: -width / 2 + side + margin, // books keep a small margin from the side panels
    xMax: width / 2 - side - margin,
    panelL: -width / 2 + side,
    panelR: width / 2 - side,
    front,
    rows,
  };
}

// ── Shapes: the checks the generator runs on itself ───────────────────

// The four corners of a book seen from the front (a rectangle turned by `lean`).
export function corners(b) {
  const c = Math.cos(b.lean);
  const s = Math.sin(b.lean);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
    b.x + ((u * b.w) / 2) * c - ((v * b.h) / 2) * s,
    b.y + ((u * b.w) / 2) * s + ((v * b.h) / 2) * c,
  ]);
}

function segmentDistance(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(p[0] - a[0] - t * abx, p[1] - a[1] - t * aby);
}

// The exact distance between two shapes that do not overlap.
function distance(A, B) {
  let d = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (const p of P) for (let i = 0; i < Q.length; i++) d = Math.min(d, segmentDistance(p, Q[i], Q[(i + 1) % Q.length]));
  }
  return d;
}

// Separating-axis test: how far apart the shapes are along their best edge direction. 0 or less means touching or inside.
function separation(A, B) {
  let best = -Infinity;
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i];
      const [x2, y2] = P[(i + 1) % P.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const nx = (y2 - y1) / len;
      const ny = (x1 - x2) / len;
      const pa = A.map(([x, y]) => x * nx + y * ny);
      const pb = B.map(([x, y]) => x * nx + y * ny);
      best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    }
  }
  return best;
}

function rowIsValid(items, S, row) {
  if (items.length < 4) return false;
  const shapes = items.map(corners);
  const top = row.floorY + row.free - 0.006;
  for (let i = 0; i < items.length; i++) {
    for (const [x, y] of shapes[i]) {
      if (x < S.xMin - 1e-6 || x > S.xMax + 1e-6) return false; // inside the row's range, clear of the side panels
      if (y < row.floorY - 1e-6 || y > top) return false; // on the board, clear of the board above
    }
    for (let j = i + 1; j < items.length; j++) if (separation(shapes[i], shapes[j]) < 0.0003) return false; // nothing inside anything else
  }
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (!b.lean) continue;
    const dir = b.lean > 0 ? -1 : 1; // which way its top tips
    const sup = items[b.on];
    if (!sup || sup.lean || (dir < 0 ? sup.x >= b.x : sup.x <= b.x)) return false; // it leans on a standing book on the side it tips to
    if (distance(shapes[i], shapes[b.on]) > 0.002) return false; // and really touches it
    const pivot = shapes[i].reduce((p, q) => (q[1] < p[1] ? q : p)); // the corner it rests on
    if ((b.x - pivot[0]) * dir < 0.0005) return false; // its weight pushes into the support, not back to upright
    const held = items.some((o, k) => k !== i && k !== b.on && !o.lean && (dir < 0 ? o.x < sup.x : o.x > sup.x) && distance(shapes[b.on], shapes[k]) <= BACKED);
    if (!held) return false; // the support has a book behind it
  }
  return true;
}

// ── Building a row ────────────────────────────────────────────────────

// Never the same colour twice in a row.
function colorPicker(r, palette) {
  let last = -1;
  return () => {
    let c = Math.floor(r() * palette);
    if (c === last) c = (c + 1 + Math.floor(r() * (palette - 1))) % palette;
    last = c;
    return c;
  };
}

// A standing book's size (the same ranges as the first version of the shelf).
function newBook(r, row, colorOf) {
  const w = 0.028 + r() * 0.03;
  const h = Math.min(row.maxH, 0.2 + r() * 0.14);
  const d = 0.15 + r() * 0.05;
  return { w, h, d, color: colorOf() };
}

// A leaning book, sized by what it leans on: never far taller than its support, so it rests on its shoulder.
// `a` is the tilt. It is at least enough for the weight to push into the support (tan a > width / height), and
// `ch` is how high up the support it touches: on the support's face, or on its top corner when the support is shorter.
function newLeaner(r, row, support, colorOf) {
  const w = 0.028 + r() * 0.022;
  const h = Math.max(0.19, Math.min(row.maxH, 0.2 + r() * 0.14, support.h * 1.3));
  const d = 0.15 + r() * 0.05;
  const a = Math.min(0.34, Math.max(0.12 + r() * 0.18, Math.atan((1.3 * w) / h)));
  const ch = Math.min(support.h, h * Math.cos(a));
  const run = ch * Math.tan(a) + TOUCH; // sideways distance from its lower corner to the support's face
  return { w, h, d, a, ch, run, color: colorOf() };
}

function standing(S, row, ix, b, left) {
  return { x: left + b.w / 2, y: row.floorY + b.h / 2, z: S.front - b.d / 2, w: b.w, h: b.h, d: b.d, lean: 0, color: b.color, row: ix, kind: 'stand', on: -1 };
}

// A leaning book from its lower corner (px) and tilt direction: dir -1 tips its top left, +1 tips it right.
function leaning(S, row, ix, L, px, dir, on) {
  const cx = px - dir * ((L.w / 2) * Math.cos(L.a) - (L.h / 2) * Math.sin(L.a));
  const cy = row.floorY + (L.w / 2) * Math.sin(L.a) + (L.h / 2) * Math.cos(L.a);
  return { x: cx, y: cy, z: S.front - L.d / 2, w: L.w, h: L.h, d: L.d, lean: -dir * L.a, color: L.color, row: ix, kind: 'lean', on };
}

// One row, left to right. Books stand in islands; a gap ends an island. An island may end with a leaning book
// on its last book, or start with one that tips onto its first book, so a leaner always rests on a neighbour.
// `allowed` is how many leaning books this row may have (0, 1 or 2).
function buildRow(r, S, row, ix, sparse, palette, allowed) {
  const items = [];
  const colorOf = colorPicker(r, palette);
  const mirror = r() < 0.5; // half the rows are built right to left, so the free space is on either side
  const fill = sparse ? 0.45 + r() * 0.3 : 0.94 + r() * 0.06; // share of the row's width used
  const endLeaner = r() < 0.22 && allowed > 0; // the row's last island ends with a leaning book
  const stop = S.xMin + (S.xMax - S.xMin) * fill - (endLeaner ? 0.12 : 0);
  const pEnd = sparse ? 0.14 : 0.045; // chance an island ends after a book
  const pLeanStart = 0.12; // chance an island starts with a leaning book
  const pLeanEnd = 0.2; // chance an island ends with a leaning book
  let x = S.xMin + (sparse && r() < 0.3 ? 0.03 + r() * 0.15 : 0);
  let run = []; // the standing books of the island being built
  let needed = 1; // how many must stand before the island may end (2 after a leaning start: the first one needs a book behind it)
  let leans = 0;

  const endIsland = (chance) => {
    const s = run[run.length - 1];
    if (s && run.length >= 2 && leans < allowed && r() < chance) {
      const L = newLeaner(r, row, s, colorOf);
      const px = s.x + s.w / 2 + L.run;
      const far = px + L.w * Math.cos(L.a);
      if (far <= S.xMax) {
        items.push(leaning(S, row, ix, L, px, -1, items.indexOf(s)));
        leans++;
        x = far + PITCH;
      }
    }
    run = [];
    needed = 1;
  };

  while (x < stop) {
    if (run.length === 0 && leans < allowed && r() < pLeanStart) {
      const b = newBook(r, row, colorOf);
      const L = newLeaner(r, row, b, colorOf);
      const px = x + L.w * Math.cos(L.a);
      const left = px + L.run; // the first book's left face
      if (left + b.w + PITCH + 0.03 <= S.xMax) { // with room for a second book behind it
        items.push(leaning(S, row, ix, L, px, 1, items.length + 1));
        const first = standing(S, row, ix, b, left);
        items.push(first);
        run.push(first);
        x = left + b.w + PITCH;
        needed = 2;
        leans++;
        continue;
      }
    }
    const b = newBook(r, row, colorOf);
    if (x + b.w > S.xMax) break;
    const s = standing(S, row, ix, b, x);
    items.push(s);
    run.push(s);
    x += b.w + PITCH;
    if (run.length >= needed && r() < pEnd) {
      endIsland(pLeanEnd);
      x += 0.04 + r() * 0.08; // the gap before the next island
    }
  }
  endIsland(endLeaner ? 1 : 0);

  if (mirror) {
    for (const b of items) {
      b.x = S.xMin + S.xMax - b.x;
      b.lean = -b.lean || 0; // (never -0)
    }
  }
  return items;
}

// The row with nothing leaning: always valid. Only used if twelve tries in a row all failed a rule.
function plainRow(r, S, row, ix, palette) {
  const colorOf = colorPicker(r, palette);
  const items = [];
  let x = S.xMin;
  for (;;) {
    const b = newBook(r, row, colorOf);
    if (x + b.w > S.xMax) break;
    items.push(standing(S, row, ix, b, x));
    x += b.w + PITCH;
  }
  return items;
}

// ── The whole shelf ───────────────────────────────────────────────────

// Books for every row of the shelf. `palette` is how many colours there are; a book's `color` is an index into them.
// `stats` (optional, { retries: 0, fallbacks: 0 }) counts how often a row had to be rebuilt, for the checks.
// Each book: { x, y, z, w, h, d, lean, color, row, kind: 'stand' | 'lean', on } where `on` is the index of
// the book it leans on (-1 for a standing book). Row 0 is the bottom shelf.
export function makeBooks(seed, S, palette = 8, stats = null) {
  const r = mulberry32(seed);
  const sparse = new Set(); // one or two shelves are left half empty, like a real one
  const howMany = r() < 0.6 ? 1 : 2;
  while (sparse.size < howMany) sparse.add(Math.floor(r() * S.rows.length));
  // Rows are built in a random order, so the leaning-book allowance isn't always used up by the same rows.
  const order = S.rows.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let budget = MAX_LEANS_PER_SHELF;
  const built = [];
  for (const ix of order) {
    const row = S.rows[ix];
    const allowed = Math.min(MAX_LEANS_PER_ROW, budget);
    let items = null;
    for (let tries = 0; tries < 12 && !items; tries++) {
      const candidate = buildRow(r, S, row, ix, sparse.has(ix), palette, allowed);
      if (rowIsValid(candidate, S, row)) items = candidate;
      else if (stats) stats.retries++;
    }
    if (!items) {
      items = plainRow(r, S, row, ix, palette);
      if (stats) stats.fallbacks++;
    }
    budget -= items.filter((b) => b.lean).length;
    built[ix] = items;
  }
  const out = [];
  for (const items of built) { // bottom shelf first
    const base = out.length;
    for (const b of items) {
      if (b.on >= 0) b.on += base; // from a place in the row to a place in the shelf
      out.push(b);
    }
  }
  return out;
}
