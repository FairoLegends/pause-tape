// Playback: the blue VCR screen, answers revealed one by one, the ▶ PLAY counter, ▶▶,
// the first-step timer, and "I'm back on it" (spec.md > Playback, spec.md > First Step Timer).
// Nothing is saved until "I'm back on it", so closing the page mid-timer records nothing.

import { formatVcrDate } from './tapes.js';
import { tuneIn, settleIn, loadBar, nudge, killMotion } from './motion.js';

// Pacing (spec.md > Implementation details), kept in one place like tuning values on a
// ScriptableObject.
export const PACE = {
  blueMs: 1200,        // blue VCR screen before the answers
  gapMs: 2500,         // time between answers
  noSignalMs: 1200,    // how long an empty answer shows its blue NO SIGNAL panel
  glitchMs: 300,       // glitch class on each revealed answer (styled in css/vhs.css)
  timerMs: 10 * 60 * 1000,
  backOnItMs: 5000,    // how long BACK ON IT stays before the shelf
};

const ANSWERS = [
  ['stopped', 'WHERE I STOPPED'],
  ['unsure', "WHAT I'M STILL UNSURE ABOUT"],
  ['why', 'WHY THIS PROJECT MATTERS TO ME'],
];

const pad = (n) => String(n).padStart(2, '0');

// Minutes since ▶, rounded to the nearest minute, at least 1 (overtime included).
export function minutesSince(startMs, nowMs) {
  return Math.max(1, Math.round((nowMs - startMs) / 60000));
}

// 10:00 counting down, then +mm:ss counting up in overtime.
export function timerText(elapsedMs, totalMs = PACE.timerMs) {
  const over = elapsedMs >= totalMs;
  const s = over ? Math.floor((elapsedMs - totalMs) / 1000) : Math.ceil((totalMs - elapsedMs) / 1000);
  const text = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  return { text: over ? `+${text}` : text, over };
}

// The ▶ PLAY counter, like a VCR: 0:00:12.
export function counterText(elapsedMs) {
  const s = Math.floor(elapsedMs / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

export function initPlayback(screens, { show, onBackOnIt, onStop }) {
  const play = screens.playback;
  const q = (selector) => play.querySelector(selector);
  const counter = q('[data-play-counter]');
  const title = q('[data-play-title]');
  const list = q('[data-answers]');
  const skip = q('[data-action="skip"]');
  const firstBox = q('[data-first-step]');
  const firstText = q('[data-first-text]');
  const timer = q('[data-timer]');
  const backBtn = q('[data-action="back-on-it"]');

  let session = null;

  skip.addEventListener('click', () => session && revealAll(session));
  backBtn.addEventListener('click', () => session && backOnIt(session));
  // ■ STOP leaves without recording anything, the same as closing the page.
  q('[data-action="play-stop"]').addEventListener('click', () => onStop());

  // ▶ pressed. mode is 'return' for a READY or early-played tape, 'replay' for a completed one.
  function startPlayback(tape, mode) {
    stop();
    const s = { tape, mode, startedAt: Date.now(), pending: [], ticker: null, timerStart: null, step: 0, done: false };
    session = s;
    title.textContent = `${tape.project} · ${formatVcrDate(tape.returnDate)}`;
    list.replaceChildren();
    firstBox.hidden = true;
    timer.hidden = true;
    timer.classList.remove('timer--over');
    backBtn.hidden = true;
    skip.hidden = false;
    counter.textContent = counterText(0);
    show('blue');
    loadBar(screens.blue.querySelector('[data-blue-bar]'), PACE.blueMs / 1000);
    later(s, PACE.blueMs, () => {
      show('playback');
      s.ticker = setInterval(() => tick(s), 250);
      tick(s);
      next(s);
    });
  }

  // Every delayed step belongs to one session, so a stopped session can't touch the screen.
  function later(s, ms, fn) {
    s.pending.push(setTimeout(() => {
      if (session === s) fn();
    }, ms));
  }

  // Reveal the answers in order, earlier ones staying; the first step comes last.
  function next(s) {
    if (s.step >= ANSWERS.length) {
      showFirstStep(s, true);
      return;
    }
    const [key, label] = ANSWERS[s.step];
    s.step += 1;
    if (s.tape[key]) {
      reveal(answer(label, s.tape[key]), true);
      later(s, PACE.gapMs, () => next(s));
    } else {
      const panel = noSignal(label, true);
      reveal(panel, false);
      later(s, PACE.noSignalMs, () => {
        panel.classList.remove('answer--nosignal-flash');
        later(s, Math.max(0, PACE.gapMs - PACE.noSignalMs), () => next(s));
      });
    }
  }

  // ▶▶ cancels what's pending and shows everything at once, including the first step.
  function revealAll(s) {
    for (const id of s.pending) clearTimeout(id);
    s.pending = [];
    killMotion(firstText);
    list.replaceChildren();
    for (const [key, label] of ANSWERS) {
      list.append(s.tape[key] ? answer(label, s.tape[key]) : noSignal(label, false));
    }
    s.step = ANSWERS.length;
    showFirstStep(s, false);
  }

  function showFirstStep(s, glitch) {
    skip.hidden = true;
    firstText.textContent = s.tape.firstStep;
    firstBox.hidden = false;
    if (glitch) {
      flash(firstBox);
      settleIn(firstBox);
      tuneIn(firstText);
    }
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    if (s.mode === 'return') {
      s.timerStart = Date.now();
      timer.hidden = false;
      backBtn.hidden = false;
      tick(s);
    }
  }

  // Everything is worked out from the real clock on each tick, so nothing drifts.
  function tick(s) {
    const now = Date.now();
    counter.textContent = counterText(now - s.startedAt);
    if (s.timerStart !== null) {
      const { text, over } = timerText(now - s.timerStart);
      timer.textContent = text;
      if (over && !timer.classList.contains('timer--over')) nudge(timer);
      timer.classList.toggle('timer--over', over);
    }
  }

  function backOnIt(s) {
    if (s.done) return;
    s.done = true;
    const minutes = minutesSince(s.startedAt, Date.now());
    stop();
    onBackOnIt(s.tape, minutes);
  }

  // Leaving playback by any route cancels its timers, so nothing runs in the background.
  function stop() {
    if (!session) return;
    for (const id of session.pending) clearTimeout(id);
    clearInterval(session.ticker);
    killMotion(list.querySelectorAll('.answer, .answer__text'));
    killMotion([firstBox, firstText]);
    session = null;
  }

  function reveal(node, glitch) {
    list.append(node);
    if (glitch) {
      flash(node);
      settleIn(node);
      tuneIn(node.querySelector('.answer__text'));
    }
    list.scrollTop = list.scrollHeight;
  }

  function answer(label, text) {
    return item('answer', label, text);
  }

  function noSignal(label, flashing) {
    const node = item(`answer answer--nosignal${flashing ? ' answer--nosignal-flash' : ''}`, label, 'NO SIGNAL');
    node.dataset.empty = 'true';
    return node;
  }

  // Text goes in through textContent, so whatever was typed stays plain text.
  function item(className, label, text) {
    const node = document.createElement('li');
    node.className = className;
    const head = document.createElement('span');
    head.className = 'answer__label';
    head.textContent = label;
    const body = document.createElement('p');
    body.className = 'answer__text';
    body.textContent = text;
    body.setAttribute('aria-label', text);
    node.append(head, body);
    return node;
  }

  function flash(node) {
    node.classList.add('glitch');
    setTimeout(() => node.classList.remove('glitch'), PACE.glitchMs);
  }

  return { startPlayback, stop };
}
