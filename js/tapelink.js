// Tape link: the whole tape packed into a web address, so the calendar reminder can bring the tape
// back to any browser (prd.md > Calendar Reminder (.ics), spec.md > Tape Link). It works like
// JsonUtility.ToJson into a string you could paste anywhere, and FromJson on the other side.
// The tape rides after "#", the part of an address a browser never sends to the server, so the
// answers stay out of the site's request logs. They are packed, not encrypted: whoever has the
// link can read them. No screen code here, so Node can check it.

import { isDate } from './tapes.js';

const PREFIX = '#tape=';
const VERSION = 'pt1';
const MAX_HASH = 200000; // far longer than any real tape; stops a huge pasted address early
// A fixed field order (an array, not an object) keeps the link short.
const FIELDS = ['id', 'project', 'returnDate', 'recordedAt', 'stopped', 'firstStep', 'unsure', 'why'];

// Text -> UTF-8 bytes -> base64url: letters, digits, - and _ only, safe in an address and in a
// calendar note.
function toBase64Url(text) {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The way back. fatal: true turns damaged bytes into an error instead of replacement characters.
function fromBase64Url(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// base: the app's own address, e.g. https://fairolegends.github.io/pause-tape/
export function tapeLink(tape, base) {
  const packed = [VERSION, ...FIELDS.map((f) => String(tape[f] ?? ''))];
  return `${base}${PREFIX}${toBase64Url(JSON.stringify(packed))}`;
}

// Reads location.hash. Returns { tape } for a good link, { broken: true } for a damaged one, and
// null when the address carries no tape. A good tape comes back fresh: not played yet, no minutes,
// and no voice note (that stays in the browser that recorded it).
export function tapeFromHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(PREFIX)) return null;
  try {
    if (hash.length > MAX_HASH) throw new Error('too long');
    const packed = JSON.parse(fromBase64Url(hash.slice(PREFIX.length)));
    if (!Array.isArray(packed) || packed[0] !== VERSION || packed.length !== FIELDS.length + 1) throw new Error('shape');
    const tape = Object.fromEntries(FIELDS.map((f, i) => [f, packed[i + 1]]));
    if (!FIELDS.every((f) => typeof tape[f] === 'string')) throw new Error('types');
    const goodId = /^[\w-]{1,64}$/.test(tape.id) && tape.id !== 'sample';
    if (!goodId || !tape.project || !isDate(tape.returnDate) || Number.isNaN(Date.parse(tape.recordedAt))) throw new Error('values');
    return { tape: { ...tape, backOnItMinutes: null, completedAt: null } };
  } catch {
    return { broken: true };
  }
}
