// Motion: GSAP does the "signal tuning in" moments — text scrambling into place, the blue
// screen's loading bar, and each screen settling in. GSAP is loaded as a plain script
// (window.gsap). If it's missing, every function here does nothing and the app still works,
// the same way a missing Animator leaves a GameObject usable.
// Motion personality: tape mechanics — short, decisive, no bounce (motion-design: "Corporate"
// timing with a stepped, mechanical ease for the scramble).

const gsap = globalThis.gsap;
const Scramble = globalThis.ScrambleTextPlugin;
if (gsap && Scramble) gsap.registerPlugin(Scramble);

const reduced = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
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

// Blue VCR screen: the loading bar fills across the screen's duration in steps, like
// a tape counter, so the wait reads as "reading the tape".
export function loadBar(barEl, seconds) {
  if (!barEl) return null;
  if (!enabled()) {
    barEl.style.setProperty('--load', '1');
    return null;
  }
  return gsap.fromTo(barEl, { '--load': 0 }, { '--load': 1, duration: seconds, ease: 'steps(12)' });
}

// Screen change: a quick vertical squash and brightness pop, like a CRT switching inputs.
export function switchIn(section) {
  if (!enabled()) return null;
  return gsap.fromTo(section,
    { scaleY: 0.96, filter: 'brightness(1.6)', opacity: 0.6 },
    { scaleY: 1, filter: 'brightness(1)', opacity: 1, duration: 0.22, ease: 'power3.out', clearProps: 'transform,filter,opacity' });
}

// The timer gets a small pulse when it tips into overtime, then stays still.
export function nudge(el) {
  if (!enabled()) return null;
  return gsap.fromTo(el, { scale: 1.12 }, { scale: 1, duration: 0.4, ease: 'power2.out', clearProps: 'transform' });
}

export function killMotion(target) {
  if (gsap) gsap.killTweensOf(target);
}
