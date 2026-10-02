// Motion: GSAP does the "signal tuning in" moments — text scrambling into place and the blue
// screen's loading bar; the screen change is a CSS freeze-and-glitch (switchGlitch). GSAP is loaded as a plain script
// (window.gsap). If it's missing, every function here does nothing and the app still works,
// the same way a missing Animator leaves a GameObject usable.
// Motion personality: tape mechanics — short, decisive, no bounce (motion-design: "Corporate"
// timing with a stepped, mechanical ease for the scramble).

import { reducedMotion } from './prefs.js';

const gsap = globalThis.gsap;
const Scramble = globalThis.ScrambleTextPlugin;
if (gsap && Scramble) gsap.registerPlugin(Scramble);

const reduced = () => reducedMotion(); // the player's choice in the room controls, or the system setting
const enabled = () => Boolean(gsap) && !reduced();

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>';

// The learner's words arrive like a signal locking on: scrambled characters resolve
// left to right. The real text is set first, so it's correct even if the animation stops.
export function tuneIn(textEl, { duration } = {}) {
  if (!enabled() || !Scramble) return null;
  const text = textEl.textContent;
  const time = duration ?? Math.min(1.1, 0.35 + text.length * 0.012);
  return gsap.fromTo(textEl, { opacity: 0.35 }, {
    opacity: 1,
    duration: time,
    ease: 'none',
    scrambleText: { text, chars: CHARS, speed: 0.6, revealDelay: 0.08, tweenLength: false },
  });
}

// A whole block (label + answer) drops in a few pixels and lands, like a line of picture
// settling after the tape catches.
export function settleIn(node) {
  if (!enabled()) return null;
  return gsap.from(node, { y: 6, opacity: 0, duration: 0.32, ease: 'power2.out', clearProps: 'transform,opacity' });
}

// Blue VCR screen: 20 equal cells light up one at a time across the screen's duration,
// like a VCR reading the tape. Cells never change size, only switch on.
const CELLS = 20;
export function loadBar(barEl, seconds) {
  if (!barEl) return null;
  if (barEl.children.length !== CELLS) {
    barEl.replaceChildren(...Array.from({ length: CELLS }, () => Object.assign(document.createElement('span'), { className: 'blue__cell' })));
  }
  const cells = [...barEl.children];
  if (gsap) gsap.killTweensOf(cells);
  cells.forEach((c) => c.classList.remove('is-on'));
  if (!enabled()) {
    cells.forEach((c) => c.classList.add('is-on'));
    return null;
  }
  // The last cell lights just before the screen changes, so the bar reads as full.
  const step = (seconds * 0.9) / CELLS;
  const tl = gsap.timeline();
  cells.forEach((c, i) => tl.call(() => c.classList.add('is-on'), null, (i + 1) * step));
  return tl;
}

// Screen change, the way a tape player cuts (learner request: "glitch and a short freeze, not a
// squeeze"): the old picture holds still for a moment, then tears into shifted bands with a red/blue
// split while the new screen shows through, and the new screen jitters once as it locks on.
// The frozen picture is a copy of the old screen that takes no clicks, so the new screen's buttons
// work right away. Styled in css/vhs.css. With reduced motion the screen just cuts.
const FREEZE_MS = 340;
export function switchGlitch(fromSection, toSection, { force = false } = {}) {
  if (reduced() || !fromSection || (fromSection === toSection && !force)) return null;
  const host = fromSection.parentElement;
  host.querySelector(':scope > .freeze')?.remove();
  const still = fromSection.cloneNode(true);
  // Typed text isn't part of the HTML, so copy it, or the frozen form would look empty.
  const live = fromSection.querySelectorAll('input, textarea');
  still.querySelectorAll('input, textarea').forEach((el, i) => { el.value = live[i].value; });
  still.removeAttribute('data-screen');
  still.removeAttribute('aria-label');
  still.hidden = false;
  const frame = document.createElement('div');
  frame.className = `freeze${fromSection.classList.contains('screen--blue') ? ' freeze--blue' : ''}`;
  frame.setAttribute('aria-hidden', 'true');
  frame.inert = true;
  frame.append(still);
  host.append(frame);
  toSection.classList.remove('lock-on');
  void toSection.offsetWidth; // restart the animation if the same screen comes back quickly
  toSection.classList.add('lock-on');
  // Cleared when the animation ends (a timer as a backstop, in case it never runs).
  const done = () => { frame.remove(); toSection.classList.remove('lock-on'); };
  frame.addEventListener('animationend', done, { once: true });
  setTimeout(done, FREEZE_MS + 1500);
  return frame;
}

// The timer gets a small pulse when it tips into overtime, then stays still.
export function nudge(el) {
  if (!enabled()) return null;
  return gsap.fromTo(el, { scale: 1.12 }, { scale: 1, duration: 0.4, ease: 'power2.out', clearProps: 'transform' });
}

export function killMotion(target) {
  if (gsap) gsap.killTweensOf(target);
}
