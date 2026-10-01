# Third-party notices

Pause Tape's own code is MIT licensed (see `LICENSE`). These bundled files keep their own licenses:

| File | Project | License |
|---|---|---|
| `assets/fonts/VT323-Regular.ttf` | VT323 by Peter Hull | SIL Open Font License 1.1 (`assets/fonts/OFL.txt`) |
| `assets/vendor/three.module.min.js`, `assets/vendor/three.core.min.js` | three.js r186 | MIT (`assets/vendor/three.LICENSE.txt`) |
| `assets/vendor/gsap.min.js`, `assets/vendor/ScrambleTextPlugin.min.js` | GSAP 3.15 by GreenSock / Webflow | GSAP standard "no charge" license, https://gsap.com/standard-license (notices kept in the files) |

`three.module.min.js` has one change from the published build: its import path points to `three.core.min.js` instead of `three.core.js`, so the minified files load each other.
