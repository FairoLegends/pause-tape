// Tape Shelf: draws every tape as a cassette, or the blank first tape when the shelf is empty
// (prd.md > Tape Shelf, spec.md > Tape Shelf).

import { sortTapes, tapeState, daysUntil, formatVcrDate, formatDays } from './tapes.js';

export function renderShelf(el, tapes, today, { onRecord, onSelect, onErase }) {
  el.replaceChildren();
  if (tapes.length === 0) {
    el.append(blankTape(onRecord));
    return;
  }
  for (const tape of sortTapes(tapes, today)) {
    el.append(slot(cassette(tape, today, onSelect), tape, onErase));
  }
  // Beside the sample tape, the blank one still invites the player to record their own.
  if (tapes.every((t) => t.sample)) el.append(blankTape(onRecord));
}

function stateLine(tape, state, today) {
  if (state === 'completed') return `BACK ON IT · ${tape.backOnItMinutes} MIN`;
  if (state === 'ready') return 'READY';
  return formatDays(daysUntil(tape.returnDate, today));
}

function cassette(tape, today, onSelect) {
  const state = tapeState(tape, today);
  const line = stateLine(tape, state, today);
  const date = formatVcrDate(tape.returnDate);

  const button = el('button', `tape tape--${state}`);
  button.type = 'button';
  button.dataset.tapeId = tape.id;
  button.dataset.state = state;
  button.setAttribute('aria-label', `${tape.project}, return date ${date}, ${line}`);

  const label = el('span', 'tape__label');
  if (tape.sample) {
    button.classList.add('tape--sample');
    label.append(el('span', 'tape__sample', 'SAMPLE'));
  }
  label.append(
    el('span', 'tape__project', tape.project),
    el('span', 'tape__date', date),
    el('span', 'tape__state', line),
  );
  button.append(label, reels());
  button.addEventListener('click', () => onSelect(tape, state));
  return button;
}

// A tape and its eject (erase) button side by side in one slot: a button can't sit inside a button.
function slot(button, tape, onErase) {
  const wrap = el('div', 'tape-slot');
  const eject = el('button', 'tape__eject');
  eject.type = 'button';
  eject.dataset.action = 'erase';
  eject.setAttribute('aria-label', `Erase ${tape.project}`);
  eject.title = 'Erase this tape';
  eject.append(el('span', 'ico ico--eject'));
  eject.addEventListener('click', () => onErase(tape));
  wrap.append(button, eject);
  return wrap;
}

function blankTape(onRecord) {
  const button = el('button', 'tape tape--blank');
  button.type = 'button';
  button.dataset.state = 'blank';
  const text = el('span', 'tape__blank-text');
  text.append(el('span', 'ico ico--rec'), 'Record your first tape');
  button.append(text);
  button.addEventListener('click', onRecord);
  return button;
}

function reels() {
  const win = el('span', 'tape__window');
  win.setAttribute('aria-hidden', 'true');
  win.append(el('span', 'tape__reel'), el('span', 'tape__reel'));
  return win;
}

// Text always goes in through textContent, so whatever someone types stays plain text.
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
