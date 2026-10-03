// Room around the TV (spec.md > Decisions): the approved room mockup (devpost/room-mockup.js),
// with the real app screen placed on the TV glass. js/app.js loads this module only when WebGL
// works; without it, or on a phone, the app stays the flat TV it always was.
// Unity map: Scene = scene graph, PerspectiveCamera = Camera, MeshStandardMaterial = URP Lit
// material, Directional/Point light = Light, Raycaster = Physics.Raycast from the mouse,
// setAnimationLoop = Update(). The app screen is a CSS3DObject: a piece of HTML that a second
// renderer moves in 3D with the camera, like a world-space Canvas in Unity.

import * as THREE from '../assets/vendor/three.module.min.js';
import { RoomEnvironment } from '../assets/vendor/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../assets/vendor/addons/geometries/RoundedBoxGeometry.js';
import { CSS3DRenderer, CSS3DObject } from '../assets/vendor/addons/renderers/CSS3DRenderer.js';
import { EffectComposer } from '../assets/vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../assets/vendor/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../assets/vendor/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../assets/vendor/addons/postprocessing/OutputPass.js';
import { reducedMotion, highContrast, soundOn, setPref, onPrefsChange } from './prefs.js';
import { visibleTapes } from './store.js';
import { setSeasonSound, setRain, rainOn } from './sound.js';
import { tapeOut } from './sound.js';
import { setSound, vcrClick, tapeIn, staticBurst, soundState, lampSwitch, curtainSlide } from './sound.js';

const stage = document.querySelector('[data-room-stage]');
const roomUi = document.querySelector('[data-room-ui]');
const hint = document.querySelector('[data-hint]');
const appScreen = document.querySelector('.tv__screen'); // the app's own screen, all its sections inside
const tvHome = appScreen.parentElement; // where it lives in the flat layout (main.tv)
// Asset paths from this file, so they work at the site root and on GitHub Pages' /<repo>/ path.
const asset = (path) => new URL(`../assets/${path}`, import.meta.url).href;
const params = new URLSearchParams(location.search);
const reduced = { get matches() { return reducedMotion(); } }; // the player's choice, or the system setting
document.fonts.load('44px VT323'); // canvas text doesn't make the browser load a font by itself

// ── Renderer, scene, camera ───────────────────────────────────────────

// Phones and tablets (touch, learner request 4 Oct 2026): the same room, lighter, so it stays smooth on
// a phone GPU: pixel ratio capped at 1.5, no antialias (the grade pass hides the edges), a smaller sun
// shadow map, fewer dust specks and drops, and no SVG bend on the app screen (CSS look only).
const TOUCH = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;
const LITE = TOUCH || params.has('lite');

// alpha: the TV glass is drawn as a see-through hole, and the app's HTML shows through it.
const renderer = new THREE.WebGLRenderer({ antialias: !LITE, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LITE ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // redrawn only when something that casts a shadow moves (see the loop)
renderer.domElement.className = 'room-gl';
renderer.domElement.setAttribute('aria-hidden', 'true');
// The HTML layer sits under the WebGL canvas; the canvas takes no clicks, so the app's buttons
// and fields get them directly, and the room's own clicks are picked by a raycast.
const css = new CSS3DRenderer();
css.domElement.className = 'room-css';
stage.append(css.domElement, renderer.domElement);
const cssScene = new THREE.Scene();

const scene = new THREE.Scene();
// Soft bounce light from a generic lit room (three.js's RoomEnvironment): fills the shadows and
// gives metal something to reflect, like URP's ambient probe.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
const raycaster = new THREE.Raycaster();

// Post-processing (learner choice: three.js EffectComposer): like a URP Volume with Vignette, Color
// Adjustments and Film Grain. One extra full-screen pass does all three, after the tone mapping
// (OutputPass), on display colours: grading bright lamp light before it turned the lamp's halo cyan. The TV glass keeps its alpha 0 through it, so the app still shows there.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.022 },
    uVignette: { value: 0.28 },
    uWarm: { value: 0.045 },
    uAmount: { value: 1 }, // 0 = no effect (inside the TV)
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uWarm, uAmount, uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = clamp(c.rgb, 0.0, 1.0);
      // warm grade: a little more red, a little less blue, gentle lift of the shadows
      vec3 g = c.rgb * vec3(1.0 + uWarm, 1.0 + uWarm * 0.35, 1.0 - uWarm * 0.6);
      g = mix(g, g * g * (3.0 - 2.0 * g) * 1.02 + 0.004, 0.25); // soft S-curve
      // vignette: darker corners, wider than tall
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0);
      float vig = smoothstep(0.38, 0.9, length(d) * 1.25);
      g *= 1.0 - uVignette * vig;
      // film grain: fresh every frame, stronger in the dark parts like real film
      float n = hash(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5;
      g += n * uGrain * (0.4 + 0.6 * (1.0 - clamp(dot(g, vec3(0.333)), 0.0, 1.0)));
      g = clamp(g, 0.0, 1.0);
      gl_FragColor = vec4(mix(c.rgb, max(g, 0.0), uAmount), c.a);
    }`,
};
// The composer renders into a target with alpha, so the hole in the TV glass stays see-through.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat }));
const renderPass = new RenderPass(scene, camera);
renderPass.clearAlpha = 0;
composer.addPass(renderPass);
composer.addPass(new OutputPass()); // tone mapping + sRGB first, so the grade works on 0..1 colours
const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);
const _ndc = new THREE.Vector2();

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Layout in metres: x to the right, y up, z toward the viewer. The back wall is at WALL_Z.
// Back wall, left to right: bookshelf, window over the TV cabinet, lamp on a small side table, grandfather
// clock; paintings on the empty walls. Seating around a coffee table on a rug: a small sofa on the left facing
// right, an armchair on the right facing left, and the main sofa at the front facing the TV.
// Room: 5.0 m wide (x -2.5..2.5), 3.6 m deep (z -1.8..1.8), 2.6 m high. The back wall's inner face is at z -1.8.
const ROOM = { w: 5.0, d: 3.6, h: 2.6 };
const WALL_Z = -1.86; // wall centre; it is 0.12 thick, so its inner face sits at -1.8
const BACK = -1.8;
const WIN = { x: 0.1, y: 1.72, w: 1.2, h: 0.95 }; // centred over the TV; the sill (~1.25) clears the TV top (~1.10)
// TV cabinet (1.6 x 0.35, 0.55 high) and what stands on it. The CRT is a bit smaller than before so
// the TV, the VCR and the photo frame all fit on the shorter cabinet without touching.
const CAB = { x: 0.1, z: -1.63, w: 1.6, d: 0.35, h: 0.55 };
const TV_S = 0.88; // TV size
const TV_DS = 0.75; // TV depth squeeze, so the tube's back stays clear of the wall
const TV_Z = BACK + 0.47 * TV_S * TV_DS + 0.01; // TV origin (world z): its back hump just clears the wall
const SCREEN = { x: CAB.x, y: CAB.h + 0.35 * TV_S, z: TV_Z + 0.277 * TV_S * TV_DS, w: 0.64 * TV_S };
const fx = WIN.x;
const fy = WIN.y;

// Camera poses: the whole room, the room on a phone, and close to the TV once the shelf is open.
// The home camera stands just outside the room's open front and looks at the TV wall with a normal
// (not wide-angle) lens: FOV 45. The TV, insert and play poses are set from the screen's position.
const DESKTOP_FOV = 45;
const POSES = {
  desktop: { pos: V(0, 1.5, 2.6), look: V(0, 0.9, -1.6) }, // the learner's layout spec
  portrait: { pos: V(0.1, 1.35, 2.5), look: V(0.1, 0.95, -1.6) },
  tv: { pos: V(SCREEN.x, SCREEN.y, SCREEN.z + 0.82), look: V(SCREEN.x, SCREEN.y - 0.015, SCREEN.z), close: 1 },
  // Pulled back a little, so the VCR shows while the tape goes in and the TV loads.
  insert: { pos: V(SCREEN.x + 0.45, SCREEN.y + 0.12, SCREEN.z + 1.45), look: V(SCREEN.x + 0.28, SCREEN.y - 0.15, SCREEN.z - 0.2), close: 0.7 },
  // Into the TV: the whole glass fills the view (learner choice: full zoom while typing, so the
  // form reads clearly). The distance is worked out in resize() from the window's shape.
  screen: { pos: V(SCREEN.x, SCREEN.y, SCREEN.z + 0.5), look: V(SCREEN.x, SCREEN.y, SCREEN.z), close: 1 },
};
const SCREEN_H = SCREEN.w * 0.75; // the glass is 4:3
// Full zoom keeps a thin band of bezel above the glass and a wider one below it, where the
// BACK TO THE ROOM button sits, so the button never covers the app.
const BAND_TOP = 0.02;
const BAND_BOTTOM = 0.08;
let wide = POSES.desktop;

// ── Small helpers ─────────────────────────────────────────────────────

const std = (color, rough = 0.8, metal = 0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

function box(w, h, d, mat, x, y, z, parent = scene, radius = 0) {
  const geo = radius ? new RoundedBoxGeometry(w, h, d, 3, radius) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// A texture drawn with the 2D canvas API (like generating a Texture2D in a script).
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, canvas: c };
}

function noiseFill(g, w, h, base, spread, alpha = 0.06) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.04; i++) {
    const v = Math.random() * spread;
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

// A small seeded random generator, so the books always stand the same way.
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Glows, light shafts and other overlays must never catch a click.
const NOOP = () => {};
const noPick = (mesh) => { mesh.raycast = NOOP; return mesh; };

// A group with userData.click is a button: the first solid thing under the pointer decides,
// so a TV standing in front of the window blocks clicks on the curtain behind it.
function makeClickable(root, name, onClick) {
  root.userData.name = name;
  root.userData.click = onClick;
}
let lastHit = null; // the raycast hit behind the last answer (its uv says where on the TV screen)
function clickableAt(ndcX, ndcY) {
  raycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  if (!hits.length) return null;
  lastHit = hits[0];
  for (let o = hits[0].object; o; o = o.parent) {
    if (o.userData.click) return !o.userData.when || o.userData.when() ? o : null;
  }
  return null;
}
const hitBox = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));

// ── Room: floor, walls ────────────────────────────────────────────────

const wallTex = canvasTexture(512, 512, (g, w, h) => {
  noiseFill(g, w, h, '#cfc9ba', 255, 0.05);
  for (let x = 0; x < w; x += 32) { // faint wallpaper stripes
    g.fillStyle = 'rgba(0,0,0,0.035)';
    g.fillRect(x, 0, 14, h);
  }
});
wallTex.texture.wrapS = wallTex.texture.wrapT = THREE.RepeatWrapping;
wallTex.texture.repeat.set(3, 2);
const wallMat = std(0xffffff, 0.95, 0, { map: wallTex.texture });

// One wooden floor for the whole room: narrow planks of one wood, staggered joints, only a gentle
// shade change between planks (wide planks with strong shades read as separate floors).
const floorTex = canvasTexture(512, 512, (g, w, h) => {
  const r = rng(3);
  const rows = 8; // a 1 m tile: planks 12.5 cm wide
  for (let i = 0; i < rows; i++) {
    const y = (i * h) / rows;
    let x = -r() * w * 0.5;
    while (x < w) {
      const len = w * (0.45 + r() * 0.35);
      const shade = 104 + Math.round(r() * 12);
      g.fillStyle = `rgb(${shade + 34},${shade + 2},${shade - 34})`;
      g.fillRect(x, y, len, h / rows);
      g.fillStyle = 'rgba(40,20,5,0.35)';
      g.fillRect(x, y, 2, h / rows); // end joint
      x += len;
    }
    g.fillStyle = 'rgba(40,20,5,0.4)';
    g.fillRect(0, y, w, 2); // long joint
  }
  for (let i = 0; i < 260; i++) { // a little grain
    g.fillStyle = `rgba(60,30,10,${0.04 + r() * 0.05})`;
    g.fillRect(r() * w, r() * h, 20 + r() * 50, 1);
  }
});
floorTex.texture.wrapS = floorTex.texture.wrapT = THREE.RepeatWrapping;
const FLOOR_LEN = ROOM.d + 2.0; // reaches past the camera, so the frame never shows the floor's end
floorTex.texture.repeat.set(ROOM.w, FLOOR_LEN);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, FLOOR_LEN), std(0xffffff, 0.7, 0, { map: floorTex.texture }));
floor.rotation.x = -Math.PI / 2;
floor.position.z = BACK + FLOOR_LEN / 2;
floor.receiveShadow = true;
scene.add(floor);

// Back wall with a window opening (four boxes around the hole).
const wallW = ROOM.w;
const wallH = ROOM.h;
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, FLOOR_LEN), std(0xd8d4cc, 1, 0, { emissive: 0xd8d4cc, emissiveIntensity: 0.45 }));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.set(0, wallH, BACK + FLOOR_LEN / 2);
ceiling.castShadow = true; // the sun comes from above and behind: without this it shines through the roof
scene.add(ceiling);
const wt = 0.12;
const leftW = (WIN.x - WIN.w / 2) + wallW / 2;
box(leftW, wallH, wt, wallMat, -wallW / 2 + leftW / 2, wallH / 2, WALL_Z);
const rightW = wallW / 2 - (WIN.x + WIN.w / 2);
box(rightW, wallH, wt, wallMat, wallW / 2 - rightW / 2, wallH / 2, WALL_Z);
box(WIN.w, WIN.y - WIN.h / 2, wt, wallMat, WIN.x, (WIN.y - WIN.h / 2) / 2, WALL_Z);
const topH = wallH - (WIN.y + WIN.h / 2);
box(WIN.w, topH, wt, wallMat, WIN.x, wallH - topH / 2, WALL_Z);
for (const sx of [-1, 1]) { // side walls
  const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_LEN, wallH), wallMat);
  sideWall.position.set(sx * ROOM.w / 2, wallH / 2, BACK + FLOOR_LEN / 2);
  sideWall.rotation.y = -sx * Math.PI / 2;
  sideWall.receiveShadow = true;
  sideWall.castShadow = true; // or the sun shines through the left wall onto the sofa and the floor
  scene.add(sideWall);
}
box(wallW, 0.1, 0.02, std(0xe9e4d8, 0.6), 0, 0.05, BACK + 0.01); // baseboard

// ── Window: frame, glass, and the view outside ────────────────────────

// Everything that belongs to the window is one button: clicking the frame, the glass or the
// curtain opens or closes the curtain.
const windowGroup = new THREE.Group();
windowGroup.name = 'window';
scene.add(windowGroup);
const frameMat = std(0xf0ebdf, 0.55);
box(WIN.w + 0.1, 0.06, 0.16, frameMat, fx, fy + WIN.h / 2 + 0.03, WALL_Z + 0.02, windowGroup);
box(WIN.w + 0.16, 0.05, 0.26, frameMat, fx, fy - WIN.h / 2 - 0.02, WALL_Z + 0.08, windowGroup); // sill
box(0.06, WIN.h + 0.1, 0.16, frameMat, fx - WIN.w / 2 - 0.03, fy, WALL_Z + 0.02, windowGroup);
box(0.06, WIN.h + 0.1, 0.16, frameMat, fx + WIN.w / 2 + 0.03, fy, WALL_Z + 0.02, windowGroup);
box(0.035, WIN.h, 0.06, frameMat, fx, fy, WALL_Z + 0.02, windowGroup); // mullion
box(WIN.w, 0.035, 0.06, frameMat, fx, fy, WALL_Z + 0.02, windowGroup); // transom
const windowHit = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w + 0.1, WIN.h + 0.1), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
windowHit.position.set(fx, fy, WALL_Z + 0.1);
windowGroup.add(windowHit);

// A soft diagonal sheen drawn on the glass (and later on the TV screen).
const sheen = canvasTexture(256, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, h);
  for (const [at, a] of [[0, 0], [0.28, 0], [0.36, 0.22], [0.46, 0], [0.62, 0.08], [0.7, 0], [1, 0]]) {
    grd.addColorStop(at, `rgba(255,255,255,${a})`);
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const glass = noPick(new THREE.Mesh(
  new THREE.PlaneGeometry(WIN.w, WIN.h),
  new THREE.MeshBasicMaterial({ map: sheen.texture, transparent: true, opacity: 0.7, depthWrite: false }),
));
glass.position.set(fx, fy, WALL_Z + 0.03);
scene.add(glass);

// Light spilling from the window onto the wall around it: a soft additive glow, coloured by
// the time of day (the cheap way to show "window light").
const glowTex = canvasTexture(256, 256, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const glowMat = new THREE.MeshBasicMaterial({
  map: glowTex.texture, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
});
const glow = noPick(new THREE.Mesh(new THREE.PlaneGeometry(4.0, 3.4), glowMat));
glow.position.set(fx, fy, WALL_Z + 0.07);
scene.add(glow);

// The view outside: the learner's two AI pictures (semi-cartoon street, seen side-on across
// the road). Until they load, a drawn placeholder stands in.
function drawView(g, w, h, night) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, night ? '#1a2350' : '#7fb8e8');
  sky.addColorStop(1, night ? '#33407a' : '#d8ecf7');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.fillStyle = night ? '#1f2a2a' : '#5b8c4a';
  g.fillRect(0, h * 0.72, w, h * 0.28);
  g.fillStyle = night ? '#232a3a' : '#9aa0a8';
  g.fillRect(0, h * 0.8, w, h * 0.14);
}
const viewDay = canvasTexture(512, 384, (g, w, h) => drawView(g, w, h, false));
const viewNight = canvasTexture(512, 384, (g, w, h) => drawView(g, w, h, true));

// The view sits behind the wall, so it shifts against the frame when the camera moves (real
// parallax). A raw shader draws it as a bright picture; the colour-space line keeps it correct.
const viewMat = new THREE.ShaderMaterial({
  uniforms: { day: { value: viewDay.texture }, night: { value: viewNight.texture }, mixNight: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D day; uniform sampler2D night; uniform float mixNight; uniform vec3 tint; varying vec2 vUv;
    void main() {
      vec3 a = texture2D(day, vUv).rgb * tint;
      vec3 b = texture2D(night, vUv).rgb;
      gl_FragColor = vec4(mix(a, b, mixNight), 1.0);
      #include <colorspace_fragment>
    }`,
});
const VIEW_W = 2.7;
// Heat shimmer for summer: the bottom of the view (the road) wobbles a little (uHeat 0..1).
viewMat.uniforms.uHeat = { value: 0 };
viewMat.uniforms.uGain = { value: 1 }; // per-season exposure, so bright snow and spring don't wash out
viewMat.uniforms.uTime = { value: 0 };
viewMat.fragmentShader = viewMat.fragmentShader
  .replace('uniform vec3 tint; varying vec2 vUv;', 'uniform vec3 tint; uniform float uHeat, uTime, uGain; varying vec2 vUv;')
  .replace('vec3 a = texture2D(day, vUv).rgb * tint;', `float hz = uHeat * smoothstep(0.42, 0.18, vUv.y) * 0.0025;
      vec2 uv = vUv + vec2(sin(vUv.y * 160.0 + uTime * 3.0) * hz, 0.0);
      vec3 a = pow(texture2D(day, uv).rgb, vec3(1.0 + (1.0 - uGain) * 1.4)) * tint * uGain;`)
  .replace('vec3 b = texture2D(night, vUv).rgb;', 'vec3 b = texture2D(night, uv).rgb;');
const view = noPick(new THREE.Mesh(new THREE.PlaneGeometry(VIEW_W, VIEW_W * 0.75), viewMat));
function placeView(aspect) { // centre the picture on the window's line of sight from the home camera
  const home = POSES.desktop.pos;
  const planeZ = WALL_Z - 1.4;
  const kk = (planeZ - home.z) / (WALL_Z - home.z);
  view.scale.set(1, 1 / aspect / 0.75, 1);
  view.position.set(home.x + (fx - home.x) * kk, home.y + (fy - home.y) * kk - 0.03, planeZ);
}
placeView(4 / 3);
scene.add(view);

// The pictures are the room's only downloads (about 0.3 MB of WebP; the JPG originals stay in the
// repository with their content credentials). A LoadingManager reports progress to the app's loading
// screen, like an async scene load with a progress bar.
const load = { done: 0, total: 0, listeners: [] };
const loadingManager = new THREE.LoadingManager();
loadingManager.onStart = () => {};
loadingManager.itemStart = ((start) => (url) => { load.total++; start(url); })(loadingManager.itemStart);
loadingManager.itemEnd = ((end) => (url) => { load.done++; end(url); for (const fn of load.listeners) fn(); })(loadingManager.itemEnd);
loadingManager.itemError = ((err) => (url) => { err(url); })(loadingManager.itemError);
const loader = new THREE.TextureLoader(loadingManager);

// ── Seasons (learner request, 3 Oct 2026): the view outside changes with the season ──
// AUTO follows the month: Dec-Feb snow, Mar-May spring, Jun-Aug summer, Sep-Nov dry season (kemarau).
// Each season has its own AI day picture and a night picture made from it, so day and night match.
// Only the current season's pair is downloaded; another season loads when it's picked.
export const SEASONS = ['snow', 'spring', 'summer', 'dry'];
const SEASON_KEY = 'pausetape.season.v1';
function seasonFor(month) { // 0 = January
  if (month === 11 || month <= 1) return 'snow';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'dry';
}
const askedSeason = (params.get('season') ?? '').toLowerCase();
let seasonMode = SEASONS.includes(askedSeason) ? askedSeason : (() => {
  try { const v = localStorage.getItem(SEASON_KEY); return SEASONS.includes(v) ? v : 'auto'; } catch { return 'auto'; }
})();
const seasonName = () => (seasonMode === 'auto' ? seasonFor(new Date().getMonth()) : seasonMode);
const seasonTex = {}; // season -> { day, night } once loaded
let shownSeason = null;
function loadSeason(name) {
  const apply = () => {
    if (seasonName() !== name || !seasonTex[name]?.day || !seasonTex[name]?.night) return;
    viewMat.uniforms.day.value = seasonTex[name].day;
    viewMat.uniforms.night.value = seasonTex[name].night;
    placeView(seasonTex[name].day.image.width / seasonTex[name].day.image.height);
    shownSeason = name;
  };
  if (seasonTex[name]) { apply(); return; }
  seasonTex[name] = {};
  for (const kind of ['day', 'night']) {
    loader.load(asset(`room/window-${name}-${kind}.webp`), (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      seasonTex[name][kind] = t;
      apply();
    }, undefined, () => {});
  }
}
loadSeason(seasonName());

// ── Curtain: two pleated panels on a rod; a click slides them shut or open ──

const ROD = { x0: fx - WIN.w / 2 - 0.22, x1: fx + WIN.w / 2 + 0.22, y: WIN.y + WIN.h / 2 + 0.12 };
const CURTAIN_Z = WALL_Z + 0.3; // in front of the sill (it reaches WALL_Z + 0.21) even in the pleat troughs (0.3 - 0.045)
const CURTAIN_TOP = ROD.y - 0.03;
const CURTAIN_BOTTOM = fy - WIN.h / 2 - 0.12;
const PANEL_OPEN = 0.17;
const PANEL_CLOSED = (ROD.x1 - ROD.x0) / 2 + 0.03;

const curtainTex = canvasTexture(256, 512, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 10; i++) grd.addColorStop(i / 10, i % 2 ? '#e6d8b8' : '#cdbb94');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(120,90,50,0.35)'; // a hem
  g.fillRect(0, h - 26, w, 26);
});
const curtainMat = std(0xffffff, 0.95, 0, { map: curtainTex.texture, side: THREE.DoubleSide, emissive: 0x000000 });
// The fabric is re-shaped every frame (like a cloth driven by a script): the folds bunch up and
// deepen when it is open and flatten when it is closed, the hem trails behind and swings back
// when it moves, and it breathes a little. The top edge stays on the rod.
const CURTAIN_NU = 64;
const CURTAIN_NV = 16;
function curtainPanel(side) { // side -1 = left panel (anchored at the rod's left end), +1 = right panel
  const geo = new THREE.PlaneGeometry(1, CURTAIN_TOP - CURTAIN_BOTTOM, CURTAIN_NU, CURTAIN_NV);
  const m = new THREE.Mesh(geo, curtainMat);
  m.userData.side = side;
  m.position.set(side < 0 ? ROD.x0 : ROD.x1, (CURTAIN_TOP + CURTAIN_BOTTOM) / 2, CURTAIN_Z);
  m.castShadow = true;
  m.receiveShadow = true;
  windowGroup.add(m);
  return m;
}
const curtainL = curtainPanel(-1);
const curtainR = curtainPanel(1);
const cloth = { lag: 0, lagVel: 0, prevW: PANEL_OPEN, vel: 0 };
function shapeCurtain(m, pw, t, still, hoverAmt) {
  const side = m.userData.side;
  const pos = m.geometry.attributes.position;
  const H = CURTAIN_TOP - CURTAIN_BOTTOM;
  const bunch = THREE.MathUtils.clamp(1 - (pw - PANEL_OPEN) / (PANEL_CLOSED - PANEL_OPEN), 0, 1); // 1 = open
  const amp = 0.02 + 0.042 * bunch;
  let i = 0;
  for (let iv = 0; iv <= CURTAIN_NV; iv++) {
    const v = iv / CURTAIN_NV; // 0 at the rod, 1 at the hem
    for (let iu = 0; iu <= CURTAIN_NU; iu++, i++) {
      const u = iu / CURTAIN_NU; // 0 at the rod end, 1 at the free edge
      const x = u * pw + cloth.lag * u * v * v; // the lower, freer part trails behind
      const fold = Math.sin(u * Math.PI * 2 * 7) * (0.8 + 0.2 * Math.sin(u * 23 + side));
      const flare = 1 + 0.35 * v * v; // the folds open up toward the hem
      const breathe = still ? 0 : (0.006 + 0.008 * hoverAmt) * v * Math.sin(t * 1.3 + u * 6 + v * 2 + side * 2);
      pos.setXYZ(i, side < 0 ? x : -x, H / 2 - v * H, amp * fold * flare * (1 - 0.1 * v) + breathe);
    }
  }
  pos.needsUpdate = true;
  m.geometry.computeVertexNormals();
  m.geometry.computeBoundingSphere();
  m.geometry.boundingBox = null; // recomputed when a check measures it
}
const brass = std(0xb8964a, 0.35, 0.8);
box(ROD.x1 - ROD.x0 + 0.1, 0.025, 0.025, brass, (ROD.x0 + ROD.x1) / 2, ROD.y, CURTAIN_Z, windowGroup);
for (const ex of [ROD.x0 - 0.06, ROD.x1 + 0.06]) {
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), brass);
  finial.position.set(ex, ROD.y, CURTAIN_Z);
  windowGroup.add(finial);
}

let curtainTarget = 1; // 1 = open, 0 = closed
let curtainAmount = 1; // what is on screen (eased)
let curtainOpen = 1; // the same, smoothed again for the look
const toggleCurtain = () => { curtainTarget = curtainTarget > 0.5 ? 0 : 1; curtainSlide(curtainTarget === 1); };
makeClickable(windowGroup, 'window', toggleCurtain);
windowGroup.userData.when = () => tvMode === 'standby';

// ── Furniture: TV cabinet (centre), bookshelf and sofa (left), lamp (right) ──

const woodTex = canvasTexture(256, 256, (g, w, h) => {
  const r = rng(11);
  g.fillStyle = '#7a5637';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(30,15,5,${0.05 + r() * 0.1})`;
    g.beginPath();
    const y = r() * h;
    g.moveTo(0, y);
    g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 3);
    g.stroke();
  }
});
const woodMat = std(0xffffff, 0.6, 0, { map: woodTex.texture });

const CAB_W = CAB.w;
const cab = new THREE.Group();
cab.name = 'cabinet';
cab.position.set(CAB.x, 0, CAB.z);
scene.add(cab);
const cabBody = box(CAB_W, CAB.h - 0.03, CAB.d, woodMat, 0, (CAB.h - 0.03) / 2, 0, cab, 0.012);
box(CAB_W + 0.02, 0.03, CAB.d + 0.02, woodMat, 0, CAB.h - 0.015, 0, cab, 0.012);
{
  const dw = (CAB_W - 0.12) / 3;
  for (const dx of [-dw - 0.02, 0, dw + 0.02]) { // cabinet doors
    box(dw - 0.03, 0.4, 0.012, std(0x684730, 0.6), dx, 0.27, CAB.d / 2 + 0.006, cab);
    box(0.08, 0.018, 0.02, std(0xb8a77a, 0.3, 0.8), dx + (dx <= 0 ? dw / 2 - 0.07 : -dw / 2 + 0.07), 0.27, CAB.d / 2 + 0.02, cab);
  }
}

// CRT TV: a deep body, a bezel, and the screen (the app lives here later). A little bigger
// than life so it stays the hero of the room.
const tv = new THREE.Group();
tv.name = 'tv';
tv.position.set(0, CAB.h, TV_Z - CAB.z);
tv.scale.set(TV_S, TV_S, TV_S * TV_DS);
cab.add(tv);
const tvBody = std(0x24262c, 0.45, 0.1);
box(0.82, 0.62, 0.55, tvBody, 0, 0.31, -0.04, tv, 0.03);
box(0.6, 0.46, 0.18, tvBody, 0, 0.3, -0.38, tv, 0.03); // back hump
box(0.84, 0.64, 0.05, std(0x2d3037, 0.5, 0.1), 0, 0.31, 0.25, tv, 0.02); // front bezel
box(0.68, 0.52, 0.002, std(0x050608, 0.4), 0, 0.35, 0.2755, tv); // dark border around the glass
// The glass is a hole: it writes "nothing here" (alpha 0) into the picture, so the app's own HTML,
// placed behind the canvas at exactly this spot, shows through. Like a stencil mask in Unity.
const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.48), new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending, toneMapped: false,
}));
screen.position.set(0, 0.35, 0.277);
screen.renderOrder = 1;
tv.add(screen);
// The standby picture ("PRESS THE VCR") and the tape going in are drawn on a canvas over the hole.
// It never fades: it cuts like a TV changing input, with the same freeze + glitch as the app's own
// screen changes (learner request), uncovering the real app or covering it again.
const tvTex = canvasTexture(640, 480, () => {});
const standbyMat = new THREE.MeshBasicMaterial({ map: tvTex.texture, transparent: true, opacity: 1, toneMapped: false });
const standby = noPick(new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.48), standbyMat));
standby.position.set(0, 0.35, 0.2772);
standby.renderOrder = 2;
tv.add(standby);
const tvSheen = noPick(new THREE.Mesh(
  new THREE.PlaneGeometry(0.64, 0.48),
  new THREE.MeshBasicMaterial({ map: sheen.texture, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
));
tvSheen.position.set(0, 0.35, 0.2785);
tvSheen.renderOrder = 3;
tv.add(tvSheen);
for (const ky of [0.47, 0.4]) { // two knobs
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 20), std(0x3f434b, 0.4, 0.6));
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.38, ky, 0.285);
  tv.add(knob);
}
for (let i = 0; i < 4; i++) box(0.5, 0.006, 0.006, std(0x111215, 0.8), 0, 0.03 + i * 0.014, 0.278, tv); // speaker grille
box(0.012, 0.012, 0.01, new THREE.MeshBasicMaterial({ color: 0xff3b3b }), 0.37, 0.04, 0.279, tv); // power LED

// CRT curve (learner choice "1 dan 2"): an SVG displacement map bends the live app a little, like the
// tube's glass. Each map pixel says where to sample from (128 = stay); further out toward the corners,
// so the picture bows inward. Drawn once, small, and stretched over the screen by the filter.
const BEND = 0.03; // thin: at the corners the picture moves about 4% of the screen inward
function makeBendMap() {
  const mw = 220;
  const mh = 165;
  const c = document.createElement('canvas');
  c.width = mw;
  c.height = mh;
  const g = c.getContext('2d');
  const im = g.createImageData(mw, mh);
  const maxD = BEND * 2 * 440; // pixels at a corner of the 880 x 660 screen
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const u = ((x + 0.5) / mw) * 2 - 1;
    const v = ((y + 0.5) / mh) * 2 - 1;
    const r2 = u * u + v * v;
    const i = (y * mw + x) * 4;
    im.data[i] = 128 + ((u * BEND * r2 * 440) / (2 * maxD)) * 255;
    im.data[i + 1] = 128 + ((v * BEND * r2 * 330) / (2 * maxD)) * 255;
    im.data[i + 2] = 128;
    im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return { url: c.toDataURL(), scale: 2 * maxD };
}

// The app's own screen, placed on the glass. It keeps one fixed size in CSS pixels (4:3) and the
// CSS3DObject scales it to the glass, like a world-space Canvas with a fixed reference resolution.
// On a phone the zoomed glass is only 300-480 px wide, so the app gets a smaller reference size there:
// its 22 px text then shows at about 16 px instead of 10 (learner: the portrait TV was unreadable).
let APP_W = 880;
let APP_H = 660;
const screenWrap = document.createElement('div');
screenWrap.className = 'room-screen';
screenWrap.append(appScreen);
const screenObj = new CSS3DObject(screenWrap);
screenWrap.style.userSelect = ''; // CSS3DObject turns text selection off; the form needs it
scene.updateMatrixWorld(true);
screen.getWorldPosition(screenObj.position);
function sizeAppScreen(glassPx) { // glassPx: how wide the glass is on screen at full zoom
  APP_W = Math.round(THREE.MathUtils.clamp(glassPx * 1.38, 480, 880) / 4) * 4;
  APP_H = APP_W * 0.75;
  screenWrap.style.width = `${APP_W}px`;
  screenWrap.style.height = `${APP_H}px`;
  screenObj.scale.setScalar(SCREEN.w / APP_W);
  // The app is drawn smaller than 1:1 on the glass, so a 44 px touch target needs to be bigger in the
  // app's own pixels to stay 44 px under a finger (css/room.css uses --tap on touch screens).
  screenWrap.style.setProperty('--tap', `${Math.ceil(44 * APP_W / Math.max(glassPx, 1))}px`);
}
sizeAppScreen(880);
cssScene.add(screenObj);
// Focusing a field can scroll the 3D layer's box; it must stay put.
css.domElement.addEventListener('scroll', () => { css.domElement.scrollTop = 0; css.domElement.scrollLeft = 0; });

// The screen glows onto the room, strongest at night. A point light held in front of the glass,
// so it reaches the VCR, the cabinet top and the floor without a hot spot on the TV's own body.
const tvLight = new THREE.PointLight(0x6f8cff, 0, 5, 2);
tvLight.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.4);
scene.add(tvLight);

// VCR on the cabinet, right of the TV: the clickable object.
const VCR_Y = CAB.h;
const vcr = new THREE.Group();
vcr.name = 'vcr';
vcr.position.set(0.58, VCR_Y, 0.0); // world x 0.68
vcr.scale.setScalar(0.8);
cab.add(vcr);
const vcrShell = box(0.5, 0.1, 0.36, std(0x2b2d33, 0.4, 0.25), 0, 0.05, 0, vcr, 0.012);
box(0.3, 0.025, 0.01, std(0x0c0d10, 0.3), -0.06, 0.06, 0.182, vcr); // tape slot
// The cassette that slides into the slot when a tape is played (hidden until then).
const cassette = new THREE.Group();
cassette.visible = false;
box(0.188, 0.024, 0.104, std(0x141416, 0.55), 0, 0, 0, cassette, 0.004);
box(0.13, 0.002, 0.05, std(0xd3cdbd, 0.8), 0, 0.0125, 0.012, cassette); // label
box(0.11, 0.0025, 0.006, std(0x62ff8f, 0.6), 0, 0.0128, -0.016, cassette); // the READY stripe
cassette.position.set(-0.06, 0.06, 0.42);
vcr.add(cassette);
for (const bx of [-0.2, -0.15, -0.1]) box(0.03, 0.012, 0.012, std(0x3a3c42, 0.4, 0.3), bx, 0.025, 0.183, vcr);
const vcrDisplay = canvasTexture(256, 64, () => {});
const vcrScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.03), new THREE.MeshBasicMaterial({ map: vcrDisplay.texture, toneMapped: false }));
vcrScreen.position.set(0.17, 0.055, 0.181);
vcr.add(vcrScreen);
const vcrLedMat = new THREE.MeshBasicMaterial({ color: 0x62ff8f, toneMapped: false });
box(0.014, 0.014, 0.01, vcrLedMat, 0.225, 0.03, 0.181, vcr);
// An invisible, more generous box so the VCR is easy to click (a Collider in Unity terms).
const vcrHit = hitBox(0.56, 0.18, 0.44);
vcrHit.position.set(0, 0.09, 0.03);
vcr.add(vcrHit);
const vcrGlow = new THREE.PointLight(0x62ff8f, 0, 0.9, 2);
vcrGlow.position.set(CAB.x + 0.58, CAB.h + 0.08, CAB.z + 0.35);
scene.add(vcrGlow);

// Photo frame on the cabinet, just left of the TV. The picture is a slot: "YOUR PHOTO" until
// the player's own photo goes in (a later feature).
const photo = canvasTexture(256, 320, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#2a3a5c');
  grd.addColorStop(1, '#0d1220');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#d9dee8';
  g.font = '36px VT323, monospace';
  g.textAlign = 'center';
  g.fillText('YOUR', w / 2, h / 2 - 10);
  g.fillText('PHOTO', w / 2, h / 2 + 26);
});
const frame = new THREE.Group();
frame.name = 'frame';
frame.position.set(-0.6, CAB.h, 0.02); // world x -0.50, left of the TV
frame.rotation.y = 0.3; // turned a little toward the camera
frame.scale.setScalar(1.12);
cab.add(frame);
box(0.16, 0.2, 0.015, std(0x2b2018, 0.5), 0, 0.1, 0, frame);
const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.17), std(0xffffff, 0.6, 0, { map: photo.texture }));
pic.position.set(0, 0.1, 0.0085);
frame.add(pic);
box(0.02, 0.18, 0.02, std(0x2b2018, 0.5), 0, 0.08, -0.05, frame).rotation.x = -0.35; // easel leg

// Photo slot: "YOUR PHOTO" until the player picks a picture of their own. The picture is shrunk,
// kept only in this browser (localStorage), never uploaded, and the player can zoom and move it
// inside the frame in the PHOTO panel. The frame shows it through a canvas texture (like a
// RenderTexture the script draws into).
const PHOTO_KEY = 'pausetape.photo.v2'; // { src, zoom, x, y }
const OLD_PHOTO_KEY = 'pausetape.photo.v1';
const FW = 384;
const FH = 502; // the picture area is 0.13 x 0.17 m
const photoPanel = document.querySelector('[data-photo-panel]');
const photoInput = document.querySelector('[data-photo-input]');
const photoPreview = document.querySelector('[data-photo-preview]');
const photoZoom = document.querySelector('[data-photo-zoom]');
const photoAdjust = document.querySelector('[data-photo-adjust]');
const emptyPhoto = pic.material.map;
const photoCanvas = document.createElement('canvas');
photoCanvas.width = FW;
photoCanvas.height = FH;
const photoTex = new THREE.CanvasTexture(photoCanvas);
photoTex.colorSpace = THREE.SRGBColorSpace;
photoTex.anisotropy = 4;
let photoImg = null;
let photoSrc = '';
const photoView = { zoom: 1, x: 0, y: 0 }; // x, y from -1 to 1: how far toward each edge the picture is moved
const ZOOM_MAX = 3;

function photoLayout(W, H) { // where the picture lands in a W x H frame ("cover", then zoom and move)
  const iw = photoImg.width;
  const ih = photoImg.height;
  const sc = Math.max(W / iw, H / ih) * photoView.zoom;
  const sw = iw * sc;
  const sh = ih * sc;
  const ox = (sw - W) / 2;
  const oy = (sh - H) / 2;
  return { sw, sh, ox, oy, dx: -ox * (1 + photoView.x), dy: -oy * (1 + photoView.y) };
}
function renderPhoto() {
  if (!photoImg) return;
  const g = photoCanvas.getContext('2d');
  const L = photoLayout(FW, FH);
  g.fillStyle = '#000';
  g.fillRect(0, 0, FW, FH);
  g.drawImage(photoImg, L.dx, L.dy, L.sw, L.sh);
  photoTex.needsUpdate = true;
  const pg = photoPreview.getContext('2d');
  const pw = photoPreview.width;
  const ph = photoPreview.height;
  const P2 = photoLayout(pw, ph);
  pg.fillStyle = '#000';
  pg.fillRect(0, 0, pw, ph);
  pg.drawImage(photoImg, P2.dx, P2.dy, P2.sw, P2.sh);
  photoZoom.value = String(photoView.zoom);
}
let saveTimer = 0;
function savePhoto(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try { localStorage.setItem(PHOTO_KEY, JSON.stringify({ src: photoSrc, ...photoView })); } catch { /* blocked or full: it still shows for this visit */ }
  };
  if (now) write(); else saveTimer = setTimeout(write, 250);
}
async function showPhoto(src, view = { zoom: 1, x: 0, y: 0 }) {
  const img = new Image();
  img.src = src;
  await img.decode();
  photoImg = img;
  photoSrc = src;
  Object.assign(photoView, view);
  renderPhoto();
  pic.material.map = photoTex;
  pic.material.needsUpdate = true;
  photoAdjust.hidden = false;
}
function clearPhoto() {
  photoImg = null;
  photoSrc = '';
  pic.material.map = emptyPhoto;
  pic.material.needsUpdate = true;
  photoAdjust.hidden = true;
  closePhotoPanel();
  try { localStorage.removeItem(PHOTO_KEY); localStorage.removeItem(OLD_PHOTO_KEY); } catch { /* ignore */ }
}
async function shrink(file) { // keep enough pixels to zoom in, but stay small in storage
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const sc = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc);
  c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.86);
}
function openPhotoPanel() { photoPanel.hidden = false; }
function closePhotoPanel() { photoPanel.hidden = true; savePhoto(true); }
const clampView = () => {
  photoView.zoom = THREE.MathUtils.clamp(photoView.zoom, 1, ZOOM_MAX);
  photoView.x = THREE.MathUtils.clamp(photoView.x, -1, 1);
  photoView.y = THREE.MathUtils.clamp(photoView.y, -1, 1);
};

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  photoInput.value = ''; // so picking the same file again still fires
  if (!file) return;
  try {
    await showPhoto(await shrink(file));
    savePhoto(true);
    openPhotoPanel();
  } catch { /* not a picture the browser can read: the frame stays as it was */ }
});
photoZoom.addEventListener('input', () => { photoView.zoom = Number(photoZoom.value); clampView(); renderPhoto(); savePhoto(); });
photoPreview.addEventListener('wheel', (e) => {
  e.preventDefault();
  photoView.zoom *= Math.exp(-e.deltaY * 0.0015);
  clampView();
  renderPhoto();
  savePhoto();
}, { passive: false });
let photoDrag = null;
photoPreview.addEventListener('pointerdown', (e) => {
  if (!photoImg) return;
  photoDrag = { x: e.clientX, y: e.clientY, vx: photoView.x, vy: photoView.y };
  photoPreview.setPointerCapture(e.pointerId);
});
photoPreview.addEventListener('pointermove', (e) => {
  if (!photoDrag) return;
  const r = photoPreview.getBoundingClientRect();
  const L = photoLayout(r.width, r.height);
  // Dragging right shows more of the picture's left side, like sliding a print in a frame.
  if (L.ox > 0) photoView.x = photoDrag.vx - (e.clientX - photoDrag.x) / L.ox;
  if (L.oy > 0) photoView.y = photoDrag.vy - (e.clientY - photoDrag.y) / L.oy;
  clampView();
  renderPhoto();
});
const endPhotoDrag = () => { if (photoDrag) { photoDrag = null; savePhoto(); } };
photoPreview.addEventListener('pointerup', endPhotoDrag);
photoPreview.addEventListener('pointercancel', endPhotoDrag);
photoPanel.addEventListener('click', (e) => {
  if (e.target.closest('[data-photo-change]')) photoInput.click();
  if (e.target.closest('[data-photo-reset]')) { Object.assign(photoView, { zoom: 1, x: 0, y: 0 }); renderPhoto(); savePhoto(true); }
  if (e.target.closest('[data-photo-remove]')) clearPhoto();
  if (e.target.closest('[data-photo-done]')) closePhotoPanel();
});
photoAdjust.addEventListener('click', openPhotoPanel);
try {
  const saved = JSON.parse(localStorage.getItem(PHOTO_KEY) ?? 'null');
  const old = localStorage.getItem(OLD_PHOTO_KEY);
  if (saved?.src) showPhoto(saved.src, { zoom: saved.zoom ?? 1, x: saved.x ?? 0, y: saved.y ?? 0 }).catch(() => {});
  else if (old) showPhoto(old).then(() => { savePhoto(true); localStorage.removeItem(OLD_PHOTO_KEY); }).catch(() => {});
} catch { /* ignore */ }
const frameHit = hitBox(0.3, 0.32, 0.16);
frameHit.position.set(0, 0.11, 0);
frame.add(frameHit);
// With no photo yet a click opens the file picker; with one it opens the PHOTO panel.
makeClickable(frame, 'frame', () => (photoImg ? openPhotoPanel() : photoInput.click()));
frame.userData.when = () => tvMode === 'standby';

// Table lamp on a small side table right of the cabinet: on in the evening and at night, and a
// click (or a pull on its cord) switches it on or off.
const SIDE = { x: 1.18, z: -1.6, w: 0.34, d: 0.34, h: 0.55 };
const sideTable = new THREE.Group();
sideTable.name = 'sideTable';
sideTable.position.set(SIDE.x, 0, SIDE.z);
scene.add(sideTable);
box(SIDE.w, 0.03, SIDE.d, woodMat, 0, SIDE.h - 0.015, 0, sideTable, 0.008); // top
box(SIDE.w - 0.04, 0.02, SIDE.d - 0.04, woodMat, 0, 0.12, 0, sideTable, 0.006); // lower shelf
for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.035, SIDE.h - 0.03, 0.035, woodMat, lx * (SIDE.w / 2 - 0.03), (SIDE.h - 0.03) / 2, lz * (SIDE.d / 2 - 0.03), sideTable, 0.006);
const lamp = new THREE.Group();
lamp.name = 'lamp';
lamp.position.set(0, SIDE.h, 0);
sideTable.add(lamp);
const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 24), brass);
lampBase.position.y = 0.025;
const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 12), brass);
lampStem.position.y = 0.21;
lampBase.castShadow = lampStem.castShadow = true;
const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf1e2c0, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffc270, emissiveIntensity: 0.1 });
const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 0.21, 28, 1, true), shadeMat);
lampShade.position.y = 0.43;
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd99a, toneMapped: false }));
bulb.position.y = 0.37;
const lampLight = new THREE.PointLight(0xffb866, 0, 5, 2);
lampLight.position.set(0, 0.4, 0.02);
const lampGlowSprite = noPick(new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffb866, opacity: 0,
})));
lampGlowSprite.position.y = 0.42;
lampGlowSprite.scale.setScalar(0.85);
const lampHit = hitBox(0.3, 0.6, 0.3);
lampHit.position.y = 0.3;
lamp.add(lampBase, lampStem, lampShade, bulb, lampLight, lampGlowSprite, lampHit);
let lampOverride = null; // null = follows the time of day; true/false = the player's choice
const toggleLamp = () => { lampOverride = !(lampOverride === null ? lampState().auto > 0.5 : lampOverride); lampSwitch(lampOverride); };

// Pull cord under the shade: drag the bead down and let go, or just click the lamp. The cord is a
// spring (like a SpringJoint): it stretches while held, snaps back past its rest length, wobbles and
// settles. Pulled far enough, it clicks the lamp on or off.
const CORD_TOP = V(0.075, 0.37, 0.05); // lamp space, just inside the shade's rim
const CORD_REST = 0.14;
const CORD_MAX = 0.13; // extra length a pull can add
const CORD_CLICK = 0.06;
const cordMat = std(0xe8dcc0, 0.8);
const cordLine = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 6), cordMat);
cordLine.geometry.translate(0, -0.5, 0); // hangs down from its top point
const bead = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), std(0xb8964a, 0.35, 0.8));
const beadHit = hitBox(0.08, 0.1, 0.08);
bead.add(beadHit);
// The cord casts no shadow: it swings, and the baked shadow map is only redrawn when the curtain moves.
lamp.add(cordLine, bead);
const cord = { ext: 0, vel: 0, swing: 0, swingVel: 0, held: false, startY: 0, clicked: false };
function pullCord() { // a plain click: a short pull that is enough to click the lamp
  cord.vel = 1.6;
  cord.swingVel += 2.5;
  toggleLamp();
}
makeClickable(lamp, 'lamp', pullCord);
lamp.userData.when = () => tvMode === 'standby';
function updateCord(dt) {
  if (!cord.held) {
    // spring back to rest, slightly under-damped so it bounces
    cord.vel += (-cord.ext * 260 - cord.vel * 9) * dt;
    cord.ext += cord.vel * dt;
  }
  cord.ext = THREE.MathUtils.clamp(cord.ext, -0.03, CORD_MAX);
  cord.swing = THREE.MathUtils.clamp(cord.swing, -1.2, 1.2);
  cord.swingVel += (-cord.swing * 40 - cord.swingVel * 2.2) * dt;
  cord.swing += cord.swingVel * dt;
  const len = CORD_REST + cord.ext;
  cordLine.position.copy(CORD_TOP);
  cordLine.scale.set(1, len, 1);
  cordLine.rotation.z = cord.swing * 0.35;
  bead.position.set(CORD_TOP.x + Math.sin(cord.swing * 0.35) * len, CORD_TOP.y - Math.cos(cord.swing * 0.35) * len - 0.012, CORD_TOP.z);
}

// Bookshelf against the back wall, left of the window: open shelves with books.
function makeBookshelf() {
  const g = new THREE.Group();
  g.name = 'bookshelf';
  const W = 0.9;
  const H = 1.9;
  const D = 0.25;
  const T = 0.035;
  g.position.set(-1.95, 0, BACK + D / 2 + 0.015); // z -1.66
  scene.add(g);
  const wood = std(0x8f6a42, 0.7);
  box(T, H, D, wood, -W / 2 + T / 2, H / 2, 0, g);
  box(T, H, D, wood, W / 2 - T / 2, H / 2, 0, g);
  box(W - 2 * T, H, 0.012, std(0x6a4a2c, 0.85), 0, H / 2, -D / 2 + 0.01, g);
  const boards = [0.02, 0.42, 0.82, 1.22, 1.6, H - 0.015];
  for (const y of boards) box(W, 0.03, D, wood, 0, y, 0, g);

  const rand = rng(7);
  const palette = [0xb9483c, 0xd18b3a, 0x3f7f86, 0x2f4f7a, 0xe3d6b4, 0x6a8f4e, 0x8d4a6a, 0xc9a24a];
  const items = [];
  for (let s = 0; s < boards.length - 1; s++) {
    const floorY = boards[s] + 0.015;
    const maxH = boards[s + 1] - 0.015 - floorY - 0.02;
    const fill = s === 2 ? 0.55 : 0.92; // one shelf is half empty, like a real one
    const xEnd = W / 2 - T - 0.015;
    let x = -W / 2 + T + 0.015;
    // Books stand side by side with a small gap and never pass into each other (learner markup, 4 Oct
    // 2026: overlapping boxes flickered where their faces met). A leaning book only appears right after a
    // gap, tips toward the book before it, and rests its top on that book: it is rotated about its
    // bottom corner, and the next book starts after its full tilted footprint.
    let afterGap = false;
    let prevH = 0;
    while (x < xEnd - 0.03) {
      const w = 0.028 + rand() * 0.03;
      if (x + w > xEnd) break;
      if (rand() > fill) { x += 0.05 + rand() * 0.06; afterGap = true; continue; } // a gap
      const h = Math.min(maxH, 0.2 + rand() * 0.14);
      const d = 0.15 + rand() * 0.05;
      const c = palette[Math.floor(rand() * palette.length)];
      const wantLean = rand() > 0.6; // most books after a gap lean on their neighbour
      if (wantLean && afterGap && prevH > 0) {
        // Tilt to the left (toward the previous book, which ends at x - 0.04 or so): rotate about the
        // bottom-left corner by an angle that keeps the top-left corner just clear of that book.
        const ang = 0.2;
        const footprint = w * Math.cos(ang) + h * Math.sin(ang);
        const x0 = x + h * Math.sin(ang); // bottom-left corner, so the top-left leans back to x
        const cx = x0 + (w / 2) * Math.cos(ang) - (h / 2) * Math.sin(ang);
        const cy = floorY + (w / 2) * Math.sin(ang) + (h / 2) * Math.cos(ang);
        if (x + footprint + 0.004 > xEnd) break;
        items.push({ x: cx, y: cy, z: D / 2 - 0.03 - d / 2, w, h, d, lean: ang, c });
        x += footprint + 0.004;
      } else {
        items.push({ x: x + w / 2, y: floorY + h / 2, z: D / 2 - 0.03 - d / 2, w, h, d, lean: 0, c });
        x += w + 0.004;
      }
      afterGap = false;
      prevH = h;
    }
  }
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff, 0.75), items.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  items.forEach((b, i) => {
    m4.compose(V(b.x, b.y, b.z), q.setFromEuler(e.set(0, 0, b.lean)), V(b.w, b.h, b.d));
    books.setMatrixAt(i, m4);
    books.setColorAt(i, col.set(b.c));
  });
  books.instanceMatrix.needsUpdate = true;
  books.instanceColor.needsUpdate = true;
  g.userData.books = items; // for the checks: no two books may overlap
  books.castShadow = true;
  books.receiveShadow = true;
  g.add(books);
  return g;
}
const bookshelf = makeBookshelf();

// Seating around the table, like a real living room: a sofa on the left facing right and an
// armchair on the right facing left (they face each other across the table), and a long low sofa in
// front of the table facing the TV. The long sofa sits a little to the left, which leaves a clear
// walkway on the right into the TV corner. Nothing stands between the camera and the photo frame.
function makeSofa(name, width, color, cushionColor, backH = 0.53, seatsWanted = 0) {
  const g = new THREE.Group();
  g.name = name;
  scene.add(g);
  const fabric = std(color, 0.92);
  const cushion = std(cushionColor, 0.92);
  const leg = std(0x4a3222, 0.6);
  const hw = width / 2;
  for (const [lx, lz] of [[-hw + 0.06, -0.29], [hw - 0.06, -0.29], [-hw + 0.06, 0.29], [hw - 0.06, 0.29]]) box(0.05, 0.1, 0.05, leg, lx, 0.05, lz, g);
  g.scale.z = 0.75 / 0.72; // 0.75 m deep
  box(width, 0.22, 0.72, fabric, 0, 0.21, 0, g, 0.05); // base
  box(width, backH, 0.18, fabric, 0, 0.32 + backH / 2, -0.27, g, 0.06); // back
  for (const ax of [-hw + 0.07, hw - 0.07]) box(0.14, 0.34, 0.72, fabric, ax, 0.47, 0, g, 0.06); // arms
  const seats = seatsWanted || Math.round((width - 0.28) / 0.4);
  const sw = (width - 0.28) / seats;
  for (let i = 0; i < seats; i++) {
    const cx = -hw + 0.14 + sw * (i + 0.5);
    box(sw - 0.02, 0.13, 0.5, cushion, cx, 0.355, 0.08, g, 0.05); // seat cushion (top at 0.42 m)
    box(sw - 0.02, backH * 0.66, 0.12, cushion, cx, 0.46 + backH * 0.26, -0.15, g, 0.05).rotation.x = -0.2; // back cushion
  }
  return g;
}
// Small sofa (2 seats) on the left: 1.2 m long along z, facing +x (the middle of the room).
const sofa = makeSofa('sofa', 1.2, 0x3e7c80, 0x4a8c90, 0.53, 2);
sofa.position.set(-1.98, 0, 0.3);
sofa.rotation.y = Math.PI / 2; // faces right, toward the armchair
box(0.24, 0.24, 0.09, std(0xb5654a, 0.9), 0.28, 0.55, -0.04, sofa, 0.04).rotation.set(-0.1, -0.35, 0.15); // a pillow

// Main sofa (3 seats) at the front, facing the TV: 1.8 x 0.75, its front edge about 2.3 m from the TV.
const longSofa = makeSofa('longSofa', 1.8, 0x3e7c80, 0x4a8c90, 0.53, 3);
longSofa.position.set(0, 0, 1.33);
longSofa.rotation.y = Math.PI; // faces the TV, its back to the camera

// Armchair on the right, facing the sofa across the table.
function makeArmchair() {
  const g = new THREE.Group();
  g.name = 'armchair';
  g.position.set(1.85, 0, 0.22);
  g.rotation.y = -Math.PI / 2; // faces left
  g.scale.set(0.7 / 0.62, 1.06, 0.75 / 0.62); // 0.7 wide, 0.75 deep, back 0.85 high
  scene.add(g);
  const fabric = std(0xc98a4b, 0.9);
  const cushion = std(0xd99c5c, 0.9);
  const leg = std(0x4a3222, 0.6);
  for (const [lx, lz] of [[-0.25, -0.24], [0.25, -0.24], [-0.25, 0.24], [0.25, 0.24]]) box(0.045, 0.1, 0.045, leg, lx, 0.05, lz, g);
  box(0.62, 0.2, 0.62, fabric, 0, 0.2, 0, g, 0.05); // seat base
  box(0.62, 0.5, 0.16, fabric, 0, 0.55, -0.23, g, 0.06); // back
  for (const ax of [-0.25, 0.25]) box(0.12, 0.36, 0.6, fabric, ax, 0.42, 0, g, 0.05); // arms
  box(0.38, 0.12, 0.44, cushion, 0, 0.36, 0.06, g, 0.05); // seat cushion
  box(0.36, 0.3, 0.1, cushion, 0, 0.56, -0.13, g, 0.05).rotation.x = -0.18; // back cushion
  return g;
}
const armchair = makeArmchair();

// A low table in the middle with stacks of books and loose papers.
function makeTable() {
  const g = new THREE.Group();
  g.name = 'table';
  g.position.set(0, 0, 0.18);
  scene.add(g);
  const wood = std(0x9a6b42, 0.6);
  box(0.8, 0.04, 0.45, wood, 0, 0.38, 0, g, 0.012); // top (0.40 high)
  box(0.72, 0.025, 0.37, std(0x7d5634, 0.7), 0, 0.12, 0, g, 0.008); // lower shelf
  for (const [lx, lz] of [[-0.36, -0.18], [0.36, -0.18], [-0.36, 0.18], [0.36, 0.18]]) box(0.04, 0.38, 0.04, wood, lx, 0.19, lz, g, 0.008);
  const r = rng(21);
  const palette = [0xb9483c, 0x3f7f86, 0xe3d6b4, 0x2f4f7a, 0xd18b3a, 0x6a8f4e];
  const stack = (x, z, n, rot, y = 0.4) => { // a stack of books, each a little turned; y = the surface

    for (let i = 0; i < n; i++) {
      const h = 0.025 + r() * 0.02;
      const b = box(0.2 + r() * 0.06, h, 0.14 + r() * 0.04, std(palette[Math.floor(r() * palette.length)], 0.75), x, y + h / 2, z, g, 0.004);
      b.rotation.y = rot + (r() - 0.5) * 0.35;
      b.userData.kind = 'book';
      y += h;
    }
  };
  stack(-0.24, -0.04, 4, 0.1);
  stack(0.24, 0.06, 2, -0.3);
  const paper = std(0xf4f0e6, 0.95);
  for (let i = 0; i < 4; i++) { // loose sheets, fanned out
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.002, 0.21), paper);
    p.position.set(-0.02 + i * 0.025, 0.402 + i * 0.0025, 0.1 - i * 0.012);
    p.rotation.y = -0.5 + i * 0.28;
    p.castShadow = p.receiveShadow = true;
    p.userData.kind = 'paper';
    g.add(p);
  }
  const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 8), std(0x2f4f7a, 0.4));
  pen.rotation.set(Math.PI / 2, 0, 0.7);
  pen.position.set(0.05, 0.415, 0.12);
  g.add(pen);
  stack(0.14, 0.02, 3, 0.4, 0.1325); // and a few on the lower shelf
  return g;
}
const table = makeTable();

// A rug under the sofa and in front of the cabinet, so the floor isn't a bare plank field.
const rugTex = canvasTexture(512, 320, (g, w, h) => {
  g.fillStyle = '#b4624a';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#efe3c8';
  g.lineWidth = 10;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.strokeStyle = '#7d3f30';
  g.lineWidth = 4;
  g.strokeRect(34, 34, w - 68, h - 68);
  g.fillStyle = '#efe3c8';
  for (let i = 0; i < 9; i++) {
    const cx = 70 + i * 46;
    const cy = h / 2;
    g.globalAlpha = i % 2 ? 0.9 : 0.55;
    g.beginPath();
    g.moveTo(cx, cy - 22);
    g.lineTo(cx + 22, cy);
    g.lineTo(cx, cy + 22);
    g.lineTo(cx - 22, cy);
    g.closePath();
    g.fill();
  }
});
const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.95), std(0xffffff, 1, 0, { map: rugTex.texture }));
rug.rotation.x = -Math.PI / 2;
rug.position.set(0, 0.01, 0.17);
rug.receiveShadow = true;
scene.add(rug);

// A classic grandfather clock on the floor right of the TV cabinet, against the wall (from the
// learner's photo: carved teak case, arched crown with a carved crest, cream dial with gold numerals,
// a glass door showing a brass pendulum and three brass weights, a carved panel at the bottom). The
// hands show the visitor's real time; the pendulum swings once a second.
const clockGroup = new THREE.Group();
clockGroup.name = 'clock';
const CLOCK_W = 0.48;
const CLOCK_D = 0.3;
clockGroup.position.set(1.83, 0, -1.6); // learner request (4 Oct 2026): where the two paintings were, between the lamp and the right wall
clockGroup.scale.set(0.4 / 0.53, 1.0, 0.4 / 0.39); // footprint 0.4 x 0.4 (the model is 0.53 x 0.39 with its trim), 2.0 m tall
scene.add(clockGroup);
const carveTex = canvasTexture(256, 512, (g, w, h) => { // carved teak: grain, then a vine relief
  const r = rng(31);
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, '#8a4f22');
  grd.addColorStop(0.5, '#b0702f');
  grd.addColorStop(1, '#8a4f22');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(60,25,5,${0.05 + r() * 0.08})`;
    g.beginPath();
    const x = r() * w;
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 8, h * 0.3, x - 8, h * 0.6, x + 4, h);
    g.stroke();
  }
});
const teak = std(0xffffff, 0.55, 0.05, { map: carveTex.texture });
const reliefTex = canvasTexture(128, 512, (g, w, h) => { // the carved side pillars: stacked leaves
  g.fillStyle = '#9a5c27';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 42) {
    for (const [dx, flip] of [[0.3, -1], [0.7, 1]]) {
      g.fillStyle = 'rgba(55,22,5,0.55)';
      g.beginPath();
      g.ellipse(w * dx, y + 21, 16, 9, flip * 0.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(230,170,100,0.35)';
      g.beginPath();
      g.ellipse(w * dx - 2, y + 18, 11, 5, flip * 0.6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(55,22,5,0.6)';
    g.fillRect(w * 0.47, y, w * 0.06, 42);
  }
});
const relief = std(0xffffff, 0.6, 0.05, { map: reliefTex.texture });
const brassMat = std(0xd8b04a, 0.25, 0.9);
{
  const H = 1.95;
  const g = clockGroup;
  box(CLOCK_W + 0.04, 0.06, CLOCK_D + 0.03, teak, 0, 0.03, 0, g, 0.01); // plinth
  box(CLOCK_W, H - 0.3, CLOCK_D, teak, 0, 0.06 + (H - 0.3) / 2, 0, g, 0.01); // case
  for (const sx of [-1, 1]) box(0.075, H - 0.32, 0.04, relief, sx * (CLOCK_W / 2 - 0.035), 0.07 + (H - 0.32) / 2, CLOCK_D / 2 + 0.01, g, 0.008); // carved pillars
  // arched hood with a carved crest
  const hoodY = H - 0.24;
  box(CLOCK_W + 0.05, 0.05, CLOCK_D + 0.04, teak, 0, hoodY, 0.0, g, 0.01);
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(CLOCK_W / 2 + 0.02, CLOCK_W / 2 + 0.02, CLOCK_D + 0.02, 32, 1, false, -Math.PI / 2, Math.PI), teak);
  arch.rotation.x = -Math.PI / 2; // the half-cylinder's round side up
  arch.position.set(0, hoodY + 0.02, 0);
  arch.scale.set(1, 1, 0.55);
  arch.castShadow = true;
  g.add(arch);
  const crestShape = new THREE.Shape();
  crestShape.moveTo(-0.14, 0);
  crestShape.bezierCurveTo(-0.1, 0.06, -0.05, 0.03, -0.03, 0.08);
  crestShape.bezierCurveTo(-0.02, 0.12, 0.02, 0.12, 0.03, 0.08);
  crestShape.bezierCurveTo(0.05, 0.03, 0.1, 0.06, 0.14, 0);
  crestShape.lineTo(-0.14, 0);
  const crest = new THREE.Mesh(new THREE.ExtrudeGeometry(crestShape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }), relief);
  crest.position.set(0, hoodY + 0.02 + (CLOCK_W / 2 + 0.02) * 0.55 - 0.025, CLOCK_D / 2 - 0.03); // on top of the squashed arch
  crest.castShadow = true;
  g.add(crest);
  // dial: a carved ring, cream face, gold numerals, hands
  const dialY = H - 0.42;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 10, 40), relief);
  ring.position.set(0, dialY, CLOCK_D / 2 + 0.012);
  g.add(ring);
  const faceTex = canvasTexture(256, 256, (c, w, h) => {
    const grd = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    grd.addColorStop(0, '#fbf3c8');
    grd.addColorStop(1, '#e8d58e');
    c.fillStyle = grd;
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#b8902e';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2 - 22, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#9a7420';
    c.font = 'bold 22px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const roman = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    roman.forEach((n, i) => {
      const a = (i / 12) * Math.PI * 2;
      c.fillText(n, w / 2 + Math.sin(a) * (w / 2 - 44), h / 2 - Math.cos(a) * (h / 2 - 44));
    });
  });
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.145, 40), new THREE.MeshStandardMaterial({ map: faceTex.texture, roughness: 0.5 }));
  face.position.set(0, dialY, CLOCK_D / 2 + 0.006);
  g.add(face);
  const hand = (len, wdt) => {
    const geo = new THREE.BoxGeometry(wdt, len, 0.004);
    geo.translate(0, len / 2 - 0.012, 0);
    const m = new THREE.Mesh(geo, std(0x1a1410, 0.4, 0.5));
    m.position.set(0, dialY, CLOCK_D / 2 + 0.012);
    g.add(m);
    return m;
  };
  clockGroup.userData.hourHand = hand(0.075, 0.01);
  clockGroup.userData.minuteHand = hand(0.11, 0.007);
  // glass door with a carved arch, the pendulum and three weights behind it
  const doorY = 0.98;
  const doorH = 0.72;
  box(CLOCK_W - 0.15, doorH + 0.05, 0.02, relief, 0, doorY, CLOCK_D / 2 + 0.005, g, 0.006); // door frame
  const inside = new THREE.Mesh(new THREE.PlaneGeometry(CLOCK_W - 0.2, doorH), std(0x5a2f12, 0.8));
  inside.position.set(0, doorY, CLOCK_D / 2 + 0.017);
  g.add(inside);
  const swing = new THREE.Group(); // pivot at the top of the door
  swing.position.set(0, doorY + doorH / 2 - 0.03, CLOCK_D / 2 + 0.03);
  g.add(swing);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 6), brassMat);
  rod.position.y = -0.25;
  const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 28), brassMat);
  bob.rotation.x = Math.PI / 2;
  bob.position.y = -0.52;
  swing.add(rod, bob);
  clockGroup.userData.pendulum = swing;
  for (const [wx, wy] of [[-0.075, 0.12], [0.075, 0.12], [0, 0.04]]) {
    const wgt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 16), brassMat);
    wgt.position.set(wx, doorY + wy, CLOCK_D / 2 + 0.045);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, doorH / 2 - wy - 0.05, 4), brassMat);
    chain.position.set(wx, doorY + wy + (doorH / 2 - wy) / 2 + 0.05, CLOCK_D / 2 + 0.045);
    g.add(wgt, chain);
  }
  const glassPane = noPick(new THREE.Mesh(new THREE.PlaneGeometry(CLOCK_W - 0.2, doorH), new THREE.MeshBasicMaterial({ map: sheen.texture, transparent: true, opacity: 0.45, depthWrite: false })));
  glassPane.position.set(0, doorY, CLOCK_D / 2 + 0.08);
  g.add(glassPane);
  box(0.016, 0.03, 0.012, brassMat, -(CLOCK_W - 0.15) / 2 + 0.02, doorY, CLOCK_D / 2 + 0.02, g); // door knob
  // carved panel at the bottom
  box(CLOCK_W - 0.15, 0.26, 0.025, relief, 0, 0.3, CLOCK_D / 2 + 0.008, g, 0.01);
}
function updateClock(t) {
  const d = new Date();
  const min = d.getMinutes() + d.getSeconds() / 60;
  const hr = (d.getHours() % 12) + min / 60;
  clockGroup.userData.minuteHand.rotation.z = -(min / 60) * Math.PI * 2;
  clockGroup.userData.hourHand.rotation.z = -(hr / 12) * Math.PI * 2;
  clockGroup.userData.pendulum.rotation.z = reduced.matches ? 0 : Math.sin(t * Math.PI) * 0.12; // one swing a second
}

// Paintings on the empty walls: two on the back wall right of the window, one on the left side
// wall. The pictures are the learner's AI paintings (Seedream 5.0 pro); a wooden frame each.
const paintings = [];
function makePainting(file, w, h, place) {
  const g = new THREE.Group();
  g.name = `painting-${file}`;
  const frameMat = std(0x6b4423, 0.55, 0.05);
  const t = 0.045;
  box(w + 2 * t, t, 0.035, frameMat, 0, h / 2 + t / 2, 0, g, 0.008);
  box(w + 2 * t, t, 0.035, frameMat, 0, -h / 2 - t / 2, 0, g, 0.008);
  box(t, h, 0.035, frameMat, -w / 2 - t / 2, 0, 0, g, 0.008);
  box(t, h, 0.035, frameMat, w / 2 + t / 2, 0, 0, g, 0.008);
  const canvasMat = std(0xd8cdb4, 0.85);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), canvasMat);
  pic.position.z = 0.004;
  pic.receiveShadow = true;
  g.add(pic);
  loader.load(asset(`room/${file}`), (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; canvasMat.map = tex; canvasMat.color.set(0xffffff); canvasMat.needsUpdate = true; }, undefined, () => {});
  place(g);
  scene.add(g);
  paintings.push(g);
  return g;
}
// Learner layout (4 Oct 2026): one painting on each side wall, right next to the back corner, at eye
// height. Left wall beside the bookshelf: the rice terraces; right wall beside the clock: the mountain.
// (The flower painting was removed.) Each hangs flat on its wall, facing into the room.
const SIDE_X = ROOM.w / 2 - 0.02;
const SIDE_Z = BACK + 0.55; // its centre, 0.55 m out from the back corner (clear of the shelf and the clock)
makePainting('painting-sawah.webp', 0.6, 0.45, (g) => { g.position.set(-SIDE_X, 1.55, SIDE_Z); g.rotation.y = Math.PI / 2; });
makePainting('painting-gunung.webp', 0.56, 0.42, (g) => { g.position.set(SIDE_X, 1.55, SIDE_Z); g.rotation.y = -Math.PI / 2; });
// ── Lights ────────────────────────────────────────────────────────────

// One direction for everything that is "the sun": the light itself, the visible shafts and the
// disc seen in the window. It travels from the window's upper left toward the lower right.
const SUN_DIR = V(0.66, -0.4, 0.64).normalize();
const SUN_AIM = V(fx + 0.5, 0.7, -1.0);

const hemi = new THREE.HemisphereLight(0xffffff, 0x3a2a1f, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.copy(SUN_AIM).addScaledVector(SUN_DIR, -9); // behind the wall; the light enters through the window
sun.target.position.copy(SUN_AIM);
sun.castShadow = true;
// The shadow box hugs the room (5 x 3.6 m seen along the sun), so a 1024 map is as sharp as the old
// 2048 one over 7 m, at a quarter of the memory and fill. radius softens the edge like a real window.
sun.shadow.mapSize.set(LITE ? 512 : 1024, LITE ? 512 : 1024);
scene.add(sun, sun.target);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 3;
sun.shadow.blurSamples = 8;
// Fit the shadow box to the whole room as the sun sees it: every corner (floor to ceiling, back wall to
// past the camera) inside, with a small margin. A box smaller than the room ends in a hard straight line
// across the walls and the floor (the learner spotted two of them).
{
  const cam = sun.shadow.camera;
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
  cam.position.copy(sun.position);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const lo = V(Infinity, Infinity, Infinity);
  const hi = V(-Infinity, -Infinity, -Infinity);
  for (const x of [-ROOM.w / 2, ROOM.w / 2]) for (const y of [0, ROOM.h]) for (const zz of [WALL_Z - 0.1, BACK + ROOM.d + 2.0]) {
    const p = V(x, y, zz).applyMatrix4(inv);
    lo.min(p);
    hi.max(p);
  }
  const m = 0.15;
  Object.assign(cam, { left: lo.x - m, right: hi.x + m, bottom: lo.y - m, top: hi.y + m, near: Math.max(0.1, -hi.z - 1), far: -lo.z + 1 });
  cam.updateProjectionMatrix();
}

// The sun you can see in the window (upper left), and soft shafts of light leaving the window
// along SUN_DIR. The disc sits behind the wall, so it shifts a little when the camera turns,
// like the view does.
const sunTex = canvasTexture(256, 256, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.09, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const sunDisc = noPick(new THREE.Sprite(new THREE.SpriteMaterial({
  map: sunTex.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
})));
{
  const home = POSES.desktop.pos;
  const inWindow = V(fx - 0.36, fy + 0.33, WALL_Z); // where the sun should appear inside the opening
  const kk = (WALL_Z - 1.0 - home.z) / (inWindow.z - home.z);
  sunDisc.position.copy(home).addScaledVector(inWindow.clone().sub(home), kk);
}
scene.add(sunDisc);

// One soft ribbon per ray: bright in the middle, fading at the sides, at the window end and well
// before the far end. (The canvas is drawn bottom-up because texture rows run upward.)
const shaftTex = canvasTexture(64, 256, (g, w, h) => {
  const img = g.createImageData(w, h);
  const ease = (lo, hi, x) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < h; y++) {
    const along = 1 - y / (h - 1); // 0 at the window end, 1 at the far end
    const lengthwise = ease(0, 0.08, along) * (1 - ease(0.36, 1, along));
    for (let x = 0; x < w; x++) {
      const across = Math.abs((2 * x) / (w - 1) - 1);
      const a = lengthwise * Math.pow(1 - ease(0, 1, across), 1.7);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  g.putImageData(img, 0, 0);
});
// Four rays that start beside the sun and fan out (fan = turn in the picture, radians; negative =
// steeper), like the learner's drawing. They leave the window, cross the wall and fade out; the TV
// stands in front of them, so none can land on its screen.
// Fields: start inside the window (metres from its centre), width, length, strength, breathing phase.
const SHAFTS = [
  { u: -0.34, v: 0.3, fan: 0.05, w: 0.22, len: 2.5, k: 1.0, ph: 0 },
  { u: -0.26, v: 0.26, fan: -0.08, w: 0.17, len: 2.3, k: 0.9, ph: 1.7 },
  { u: -0.3, v: 0.2, fan: -0.2, w: 0.14, len: 2.0, k: 0.75, ph: 3.1 },
  { u: -0.36, v: 0.12, fan: -0.33, w: 0.11, len: 1.7, k: 0.6, ph: 4.4 },
];
const shafts = SHAFTS.map((d) => {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0); // the ribbon grows from its start point along +Y
  const mat = new THREE.MeshBasicMaterial({
    map: shaftTex.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide, opacity: 0,
  });
  const mesh = noPick(new THREE.Mesh(geo, mat));
  mesh.position.set(fx + d.u, fy + d.v, WALL_Z + 0.06);
  mesh.scale.set(d.w, d.len, 1);
  mesh.renderOrder = 2;
  scene.add(mesh);
  return { ...d, mesh, mat, dir: SUN_DIR.clone() };
});
const _n = V(0, 0, 0);
const _x = V(0, 0, 0);
const _basis = new THREE.Matrix4();
function aimShaft(d) {
  // Turn the ribbon around its own axis (the light direction) so its flat side faces the camera,
  // then tilt it by its fan angle in the picture so the rays spread out from the sun.
  _n.copy(camera.position).sub(d.mesh.position);
  _n.addScaledVector(SUN_DIR, -_n.dot(SUN_DIR)).normalize();
  d.dir.copy(SUN_DIR).applyAxisAngle(_n, d.fan);
  _x.crossVectors(d.dir, _n).normalize();
  _basis.makeBasis(_x, d.dir, _n);
  d.mesh.quaternion.setFromRotationMatrix(_basis);
}

// Dust in the window light: a few hundred soft points drifting inside the sun shafts' column, one draw
// call (Points), moved in the vertex shader so the CPU does nothing per frame. They only show where
// the light is (brightest along the shafts' axis), fade with the shafts, and stand still with
// reduced motion.
const DUST_N = LITE ? 90 : 180;
const dustGeo = new THREE.BufferGeometry();
{
  const r = rng(77);
  const base = new Float32Array(DUST_N * 3);
  const seed = new Float32Array(DUST_N);
  const start = V(fx - 0.3, fy + 0.18, WALL_Z + 0.1);
  for (let i = 0; i < DUST_N; i++) {
    const along = 0.1 + r() * 2.1; // metres along the light from the window
    const side = V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.55 * (0.4 + along / 2.4));
    const p = start.clone().addScaledVector(SUN_DIR, along).add(side);
    base.set([p.x, p.y, p.z], i * 3);
    seed[i] = r();
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  dustGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  dustGeo.boundingSphere = new THREE.Sphere(start.clone().addScaledVector(SUN_DIR, 1.2), 2.5);
}
const dustMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xfff0d0) }, uScale: { value: 1 },
    uStart: { value: V(fx - 0.3, fy + 0.18, WALL_Z + 0.1) }, uDir: { value: SUN_DIR.clone() } },
  vertexShader: /* glsl */ `
    attribute float seed;
    uniform float uTime, uScale;
    uniform vec3 uStart, uDir;
    varying float vLight;
    void main() {
      // Each speck drifts on its own slow, wandering path (sums of sines at unrelated speeds, like
      // turbulence), slowly sinks and is carried back up by warm air, and turns as it goes (learner: the
      // dust looked frozen; now each one moves visibly, a few centimetres a second).
      float t = uTime + seed * 100.0;
      vec3 w = vec3(
        sin(t * 0.37 + seed * 7.0) + 0.6 * sin(t * 0.91 + seed * 13.0) + 0.3 * sin(t * 1.73 + seed * 29.0),
        0.8 * sin(t * 0.29 + seed * 3.0) + 0.4 * sin(t * 0.83 + seed * 17.0),
        cos(t * 0.33 + seed * 5.0) + 0.5 * cos(t * 0.77 + seed * 11.0));
      float rise = mod(t * (0.012 + 0.012 * seed), 0.5) - 0.25; // a slow loop up through the light
      vec3 p = position + w * 0.09 + vec3(0.0, rise, 0.0);
      // brightness: how close to the middle of the light column it floats
      vec3 rel = p - uStart;
      float along = dot(rel, uDir);
      float off = length(rel - uDir * along);
      vLight = smoothstep(0.42, 0.05, off / (0.4 + along / 2.4)) * smoothstep(0.0, 0.3, along) * smoothstep(2.4, 1.4, along);
      vLight *= 0.45 + 0.55 * pow(0.5 + 0.5 * sin(t * 2.3 + seed * 11.0), 2.0); // glints as the specks turn in the light
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = max(2.0, uScale * (0.007 + 0.006 * seed) / -mv.z); // specks of 7-13 mm, so they read at room distance
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    uniform vec3 uColor;
    varying float vLight;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.1, d) * vLight * uOpacity * 1.6;
      if (a < 0.003) discard;
      gl_FragColor = vec4(uColor * a, a);
    }`,
});
const dust = noPick(new THREE.Points(dustGeo, dustMat));
dust.renderOrder = 3;
scene.add(dust);

// Weather outside the window, by season: snowflakes, spring petals, or dry leaves and dust drifting
// past the glass (between the view and the wall), so they move with real parallax. One Points draw,
// animated in the vertex shader; summer has none (it has the heat shimmer instead).
const WX_N = 160;
const wxGeo = new THREE.BufferGeometry();
{
  const rr = rng(91);
  const base = new Float32Array(WX_N * 3);
  const seed = new Float32Array(WX_N);
  for (let i = 0; i < WX_N; i++) {
    base.set([fx + (rr() - 0.5) * 2.2, fy + (rr() - 0.5) * 1.6, WALL_Z - 0.15 - rr() * 1.1], i * 3);
    seed[i] = rr();
  }
  wxGeo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  wxGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  wxGeo.boundingSphere = new THREE.Sphere(V(fx, fy, WALL_Z - 0.7), 2.2);
}
const WEATHER = { // fall speed m/s, sideways sway, size (m), colours, how many show
  // gain: the picture's exposure in daylight (the original day view was made for 1.0; snow and spring
  // are much brighter pictures, so they come down to keep their colours under the sunny tint).
  snow: { fall: 0.18, sway: 0.09, size: 0.016, a: 0xffffff, b: 0xe6eeff, count: 1, round: 1, gain: 0.72, glare: 0.35 },
  spring: { fall: 0.12, sway: 0.2, size: 0.02, a: 0xff9fc0, b: 0xffd6e4, count: 0.45, round: 0, gain: 0.8, glare: 0.6 },
  summer: { fall: 0, sway: 0, size: 0, a: 0xffffff, b: 0xffffff, count: 0, round: 1, gain: 0.95, glare: 1 },
  dry: { fall: 0.1, sway: 0.35, size: 0.022, a: 0xa8692e, b: 0xd2a560, count: 0.35, round: 0, gain: 0.8, glare: 0.4 },
};
const wxMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, toneMapped: false,
  uniforms: { uTime: { value: 0 }, uFall: { value: 0 }, uSway: { value: 0 }, uSize: { value: 0 }, uScale: { value: 1 },
    uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uCount: { value: 0 }, uRound: { value: 1 },
    uLight: { value: 1 }, uY0: { value: fy - 0.85 }, uY1: { value: fy + 0.85 } },
  vertexShader: /* glsl */ `
    attribute float seed;
    uniform float uTime, uFall, uSway, uSize, uScale, uCount, uY0, uY1;
    varying float vSeed; varying float vShow;
    void main() {
      vSeed = seed;
      vShow = step(seed, uCount);
      float h = uY1 - uY0;
      vec3 p = position;
      float speed = uFall * (0.7 + 0.6 * seed);
      p.y = uY0 + mod(position.y - uY0 - uTime * speed, h);
      p.x += sin(uTime * (0.6 + seed) + seed * 20.0) * uSway;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = vShow * max(1.5, uScale * uSize * (0.6 + 0.8 * seed) / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uA, uB; uniform float uRound, uLight;
    varying float vSeed; varying float vShow;
    void main() {
      if (vShow < 0.5) discard;
      vec2 c = gl_PointCoord - 0.5;
      // round flakes, or small tilted ovals for petals and leaves
      float ang = vSeed * 6.283;
      vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c;
      float d = mix(length(q * vec2(1.0, 2.0)), length(c), uRound);
      float a = smoothstep(0.5, 0.25, d);
      if (a < 0.02) discard;
      gl_FragColor = vec4(mix(uA, uB, vSeed) * uLight, a * 0.9);
    }`,
});
const weather = noPick(new THREE.Points(wxGeo, wxMat));
weather.renderOrder = 1;
scene.add(weather);
// Rain (learner request, 4 Oct 2026: the rain sound had no picture). With RAIN ON: streaks falling
// outside, between the view and the wall (one LineSegments draw, moved in the vertex shader), drops
// running down the glass (a shader on a plane just in front of the pane), and a duller, darker view.
// It follows the season: grey-blue drizzle in the dry season, warm heavy rain in summer, light rain with
// pink petals still drifting in spring, and sleet (slower, whiter, mixed with the snow) in snow.
const RAIN = {
  snow: { speed: 3.2, len: 0.05, color: 0xe8eeff, alpha: 0.6, amount: 0.55, drops: 0.35, dim: 0.86 },
  spring: { speed: 6.5, len: 0.11, color: 0xc9d8e6, alpha: 0.45, amount: 0.75, drops: 0.8, dim: 0.82 },
  summer: { speed: 8.0, len: 0.16, color: 0xd6e2ee, alpha: 0.55, amount: 1, drops: 1, dim: 0.78 },
  dry: { speed: 5.5, len: 0.09, color: 0xc2c8cc, alpha: 0.35, amount: 0.45, drops: 0.5, dim: 0.88 },
};
const RAIN_N = LITE ? 220 : 420;
const rainGeo = new THREE.BufferGeometry();
{
  const rr = rng(57);
  const pos = new Float32Array(RAIN_N * 2 * 3);
  const seed = new Float32Array(RAIN_N * 2);
  const end = new Float32Array(RAIN_N * 2);
  for (let i = 0; i < RAIN_N; i++) {
    const x = fx + (rr() - 0.5) * 2.4;
    const y = fy + (rr() - 0.5) * 1.6;
    const z = WALL_Z - 0.12 - rr() * 1.2;
    const s = rr();
    for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); seed[i * 2 + k] = s; end[i * 2 + k] = k; }
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rainGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  rainGeo.setAttribute('tip', new THREE.BufferAttribute(end, 1));
  rainGeo.boundingSphere = new THREE.Sphere(V(fx, fy, WALL_Z - 0.7), 2.4);
}
const rainMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, toneMapped: false,
  uniforms: { uTime: { value: 0 }, uSpeed: { value: 6 }, uLen: { value: 0.1 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 },
    uAmount: { value: 1 }, uY0: { value: fy - 0.85 }, uY1: { value: fy + 0.85 } },
  vertexShader: /* glsl */ `
    attribute float seed; attribute float tip;
    uniform float uTime, uSpeed, uLen, uAmount, uY0, uY1;
    varying float vA;
    void main() {
      float h = uY1 - uY0;
      vec3 p = position;
      float sp = uSpeed * (0.8 + 0.4 * seed);
      p.y = uY0 + mod(position.y - uY0 - uTime * sp, h) + tip * uLen * (0.7 + 0.6 * seed);
      p.x += tip * uLen * 0.18; // a slight slant in the wind
      vA = step(seed, uAmount) * (0.5 + 0.5 * tip);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uAlpha; varying float vA;
    void main() { if (vA < 0.01) discard; gl_FragColor = vec4(uColor, uAlpha * vA); }`,
});
const rainLines = noPick(new THREE.LineSegments(rainGeo, rainMat));
rainLines.renderOrder = 1;
rainLines.visible = false;
scene.add(rainLines);
// Drops on the pane: little beads that slide down in jerks and leave a faint trail, drawn procedurally
// in a fragment shader (no texture), so they never repeat in an obvious way.
const dropsMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, toneMapped: false,
  uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uLight: { value: 1 }, uAspect: { value: WIN.w / WIN.h } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform float uTime, uAmount, uLight, uAspect; varying vec2 vUv;
    float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
    void main() {
      vec2 uv = vec2(vUv.x * uAspect, vUv.y);
      // three layers of columns, each column carrying one sliding drop (a drop is a few millimetres
      // across: a clear bead with a bright rim and a darker middle, like real water on glass)
      float rim = 0.0;
      float body = 0.0;
      for (int L = 0; L < 3; L++) {
        float cols = 22.0 + float(L) * 14.0;
        float cx = floor(uv.x * cols);
        float id = cx + float(L) * 57.0;
        if (h1(id) > uAmount) continue;
        float fx = fract(uv.x * cols) - 0.5 - (h1(id + 3.0) - 0.5) * 0.4;
        float speed = 0.05 + h1(id + 7.0) * 0.09;
        float t = uTime * speed + h1(id + 11.0) * 10.0;
        float jerk = t + 0.25 * sin(t * 6.283 * 2.0); // it moves in small jerks, like a real drop
        float y = 1.0 - fract(jerk);
        float r = 0.07 + h1(id + 13.0) * 0.06; // in column widths
        float dist = length(vec2(fx, (uv.y - y) * cols * 0.75));
        float inside = smoothstep(r, r * 0.8, dist);
        rim = max(rim, inside * smoothstep(r * 0.45, r * 0.95, dist));
        body = max(body, inside);
        // the wet trail it leaves above it, thin and fading
        float trail = smoothstep(0.035, 0.0, abs(fx)) * step(y, uv.y) * smoothstep(y + 0.3, y, uv.y);
        rim = max(rim, trail * 0.35);
      }
      // fine still droplets scattered over the pane
      vec2 cell = uv * vec2(90.0, 80.0);
      vec2 g = floor(cell);
      float sp = h1(g.x * 13.0 + g.y * 71.0);
      if (sp > 1.0 - 0.08 * uAmount) {
        float dd = length(fract(cell) - 0.5);
        float rr = 0.12 + 0.1 * h1(g.x + g.y * 3.0);
        float ins = smoothstep(rr, rr * 0.7, dd);
        rim = max(rim, ins * smoothstep(rr * 0.3, rr, dd));
        body = max(body, ins);
      }
      if (body < 0.02 && rim < 0.02) discard;
      // the middle darkens a little (it refracts the darker ground), the rim catches the sky's light
      vec3 col = mix(vec3(0.35, 0.4, 0.48), vec3(0.92, 0.96, 1.0), rim) * uLight;
      float a = max(body * 0.16, rim * 0.5);
      gl_FragColor = vec4(col, a);
    }`,
});
const drops = noPick(new THREE.Mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), dropsMat));
drops.position.set(fx, fy, WALL_Z + 0.035);
drops.visible = false;
scene.add(drops);
let rainShown = 0; // eased 0..1, so rain fades in and out with the switch
function applyRain(name) {
  const p = RAIN[name];
  rainMat.uniforms.uSpeed.value = p.speed;
  rainMat.uniforms.uLen.value = p.len;
  rainMat.uniforms.uColor.value.set(p.color);
  rainMat.uniforms.uAmount.value = p.amount;
}

function applyWeather(name) {
  const w = WEATHER[name];
  wxMat.uniforms.uFall.value = w.fall;
  wxMat.uniforms.uSway.value = w.sway;
  wxMat.uniforms.uSize.value = w.size;
  wxMat.uniforms.uA.value.set(w.a);
  wxMat.uniforms.uB.value.set(w.b);
  wxMat.uniforms.uCount.value = w.count;
  wxMat.uniforms.uRound.value = w.round;
  weather.visible = w.count > 0;
  viewMat.uniforms.uHeat.value = name === 'summer' ? 1 : 0;
  viewMat.uniforms.uGain.value = w.gain;
  applyRain(name);
}
applyWeather(seasonName());
setSeasonSound(seasonName());
function setSeason(m) {
  seasonMode = m;
  try { localStorage.setItem(SEASON_KEY, m); } catch { /* still applies for this visit */ }
  const url = new URL(location.href);
  url.searchParams.delete('season');
  history.replaceState(null, '', url);
  loadSeason(seasonName());
  applyWeather(seasonName());
  setSeasonSound(seasonName());
}

// Time of day (prd.md > Look and Feel): four periods by the visitor's local hour, plus ?time=.
const PERIODS = {
  morning: { sun: 0xffbc78, sunI: 2.2, sky: 0xffd4a8, ground: 0x6b5644, hemiI: 0.95, env: 0.4, glow: 0xffc590, glowO: 0.5, night: 0, tint: [1.1, 0.95, 0.8], tv: 0.3, exposure: 0.97, disc: 0xffc880, discSize: 1.0, beam: 0xffd9a0, beamO: 0.3, lamp: 0 },
  day: { sun: 0xfff6e6, sunI: 3.0, sky: 0xe6f1ff, ground: 0x7a6a58, hemiI: 1.25, env: 0.7, glow: 0xffffff, glowO: 0.3, night: 0, tint: [1, 1, 1], tv: 0.15, exposure: 0.95, disc: 0xfff6dc, discSize: 0.85, beam: 0xfff2cc, beamO: 0.24, lamp: 0 },
  afternoon: { sun: 0xff7a2a, sunI: 3.0, sky: 0xff9a55, ground: 0x6b3a22, hemiI: 1.0, env: 0.18, glow: 0xff8a3a, glowO: 0.7, night: 0.15, tint: [1.2, 0.75, 0.5], tv: 0.4, exposure: 1.05, disc: 0xff8a2a, discSize: 1.25, beam: 0xff9a40, beamO: 0.42, lamp: 0.45 },
  night: { sun: 0x8fa8ff, sunI: 0.8, sky: 0x3f5bb0, ground: 0x121830, hemiI: 0.42, env: 0.08, glow: 0x6f8cff, glowO: 0.18, night: 1, tint: [0.34, 0.47, 0.9], tv: 2.5, exposure: 1.1, disc: 0xcfe0ff, discSize: 0.5, beam: 0x8fa8ff, beamO: 0.09, lamp: 1 },
};
const ALIASES = { pagi: 'morning', siang: 'day', sore: 'afternoon', malam: 'night' };
const asked = (params.get('time') ?? '').toLowerCase();
let mode = PERIODS[asked] ? asked : (ALIASES[asked] ?? 'auto');

function periodFor(hour) {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 15) return 'day';
  if (hour >= 15 && hour < 18) return 'afternoon';
  return 'night';
}
const currentName = () => (mode === 'auto' ? periodFor(new Date().getHours()) : mode);

const NUM = ['sunI', 'hemiI', 'env', 'glowO', 'night', 'tv', 'exposure', 'discSize', 'beamO'];
const COL = ['sun', 'sky', 'ground', 'glow', 'tint', 'disc', 'beam'];
const A = { lamp: 0 }; // what is on screen right now
const C = Object.fromEntries(COL.map((c) => [c, new THREE.Color()]));
const T = { name: '', num: {}, col: Object.fromEntries(COL.map((c) => [c, new THREE.Color()])) };

function setTarget(name) {
  const p = PERIODS[name];
  if (T.name !== name) lampOverride = null; // a new period hands the lamp back to the clock
  T.name = name;
  for (const n of NUM) T.num[n] = p[n];
  T.num.lamp = p.lamp;
  T.col.sun.set(p.sun);
  T.col.sky.set(p.sky);
  T.col.ground.set(p.ground);
  T.col.glow.set(p.glow);
  T.col.disc.set(p.disc);
  T.col.beam.set(p.beam);
  T.col.tint.setRGB(...p.tint);
}
setTarget(currentName());
for (const n of NUM) A[n] = T.num[n]; // start already at the target, so the first frame is right
A.lamp = T.num.lamp;
for (const c of COL) C[c].copy(T.col[c]);
const lampState = () => ({ auto: T.num.lamp, on: A.lamp, light: lampLight.intensity, override: lampOverride });

// ── The TV screen in the room: standby status, and the tape going in ──

const KEY = 'pausetape.tapes.v1'; // the app's own storage key, so the mockup shows real tapes
function tapeStatus() {
  let tapes = [];
  try { tapes = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { tapes = []; }
  if (!Array.isArray(tapes)) tapes = [];
  tapes = visibleTapes(tapes); // the sample tape counts too, so the VCR glows on a first visit
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ready = tapes.filter((t) => t && t.backOnItMinutes == null && t.returnDate <= today).length;
  return { total: tapes.length, ready };
}
let status = tapeStatus(); // read again whenever the camera comes back to the room

let tvMode = 'standby';

// VT323 has no ▶ or ●, so (as in the app) they are drawn as shapes.
function playIcon(g, x, y, s, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + s, y + s / 2);
  g.lineTo(x, y + s);
  g.closePath();
  g.fill();
}
function recDot(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function drawPicture(t) {
  const g = tvClean.getContext('2d');
  const w = tvClean.width;
  const h = tvClean.height;
  if (tvMode === 'standby') {
    g.fillStyle = '#1d2fb8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = '64px VT323, monospace';
    g.textAlign = 'center';
    g.fillText('PAUSE TAPE', w / 2, h * 0.36);
    g.font = '44px VT323, monospace';
    g.textAlign = 'left';
    const ready = status.ready > 0;
    const text = ready ? `${status.ready} TAPE${status.ready > 1 ? 'S' : ''} READY` : (status.total ? 'NO TAPE DUE TODAY' : 'NO TAPES YET');
    const icon = ready ? 28 : 0;
    const gap = ready ? 14 : 0;
    const x0 = (w - (icon + gap + g.measureText(text).width)) / 2;
    if (ready) playIcon(g, x0, h * 0.56 - 28, icon, '#62ff8f');
    g.fillStyle = ready ? '#62ff8f' : '#ffffff';
    g.fillText(text, x0 + icon + gap, h * 0.56);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '30px VT323, monospace';
    g.textAlign = 'center';
    if (Math.floor(t * 1.2) % 2 === 0) g.fillText('PRESS THE VCR', w / 2, h * 0.76);
  } else if (tvMode === 'eject') {
    // EJECT on a blue screen, as a VCR shows it.
    g.fillStyle = '#1f3cff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = '64px VT323, monospace';
    g.textAlign = 'center';
    g.fillText('EJECT', w / 2, h * 0.5);
    g.font = '40px VT323, monospace';
    if (playing) g.fillText(playing, w / 2, h * 0.64);
  } else if (tvMode === 'insert') {
    // The VCR is taking the tape: the picture drops to snow with a rolling bar.
    g.fillStyle = '#0a0c12';
    g.fillRect(0, 0, w, h);
    const r = rng(Math.floor(t * 24));
    for (let i = 0; i < 1400; i++) {
      const v = Math.floor(r() * 140);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(r() * w, r() * h, 3, 2);
    }
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, ((t * 160) % (h + 80)) - 80, w, 60);
    g.fillStyle = '#d9dee8';
    g.font = '40px VT323, monospace';
    g.textAlign = 'left';
    g.fillText('INSERTING', 36, 60);
    g.textAlign = 'center';
    g.font = '44px VT323, monospace';
    g.fillText(playing ?? 'TAPE', w / 2, h * 0.5);
  } else {
    return; // the real app is on the glass: nothing to draw
  }
  g.fillStyle = 'rgba(0,0,0,0.22)'; // scanlines
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
}


// The TV's picture cut (Update side). covered = the canvas picture is over the glass (standby, the tape
// going in); otherwise the real app shows. A change runs: freeze (the old picture holds still), then
// tear (bands of the picture jump sideways with a red/blue split, the other picture showing through the
// gaps), stepped like the app's own screen change in css/vhs.css.
const tvClean = document.createElement('canvas');
tvClean.width = 640;
tvClean.height = 480;
const CUT_FREEZE = 0.14;
const CUT_TEAR = 0.22;
let covered = true;
let cutT = Infinity;
let cutDir = 'in';
function startCut(toCovered) {
  if (covered === toCovered) return;
  staticBurst(0.32); // the picture cuts with a burst of static
  covered = toCovered;
  cutDir = toCovered ? 'in' : 'out';
  cutT = reduced.matches ? Infinity : 0; // reduced motion: a plain cut
}
let cutHold = null; // checks only
function drawScreen(t, dt) {
  cutT = cutHold ?? cutT + dt;
  const active = cutT < CUT_FREEZE + CUT_TEAR;
  // Going out, the picture freezes: it isn't redrawn. Otherwise draw it live (coming in it is drawn but
  // not shown during the freeze, while the app's own screen holds still).
  if (covered) drawPicture(t);
  const g = tvTex.canvas.getContext('2d');
  const w = tvTex.canvas.width;
  const h = tvTex.canvas.height;
  g.clearRect(0, 0, w, h);
  standby.visible = covered || active;
  if (!active) {
    if (covered) g.drawImage(tvClean, 0, 0);
  } else if (cutT < CUT_FREEZE) {
    if (cutDir === 'out') g.drawImage(tvClean, 0, 0);
  } else {
    const step = Math.min(3, Math.floor(((cutT - CUT_FREEZE) / CUT_TEAR) * 4)); // 4 hard steps
    const shown = cutDir === 'out' ? 0.75 - step * 0.22 : 0.3 + step * 0.22; // share of bands still/already there
    const r = rng(101 + step * 17 + (cutDir === 'in' ? 5 : 0));
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      if (r() > shown) continue;
      const y0 = Math.floor((i * h) / bands);
      const bh = Math.ceil(h / bands);
      const dx = Math.round((r() - 0.5) * 70 * (1 - step * 0.2));
      g.drawImage(tvClean, 0, y0, w, bh, dx, y0, w, bh);
      // red/blue split at the band's edges, like a worn tape losing sync
      g.fillStyle = 'rgba(255,50,50,0.55)';
      g.fillRect(dx - 8, y0, 8, bh);
      g.fillStyle = 'rgba(60,120,255,0.55)';
      g.fillRect(dx + w - 2, y0, 8, bh);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(0, y0, w, 2);
    }
  }
  tvTex.texture.needsUpdate = true;
}

function drawVcrDisplay(t) {
  const c = vcrDisplay.canvas;
  const g = c.getContext('2d');
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#62ff8f';
  g.font = '44px VT323, monospace';
  g.textAlign = 'center';
  const d = new Date();
  const colon = Math.floor(t) % 2 ? ':' : ' ';
  const label = { app: 'MENU', insert: 'LOAD', loading: 'LOAD', play: 'PLAY' }[tvMode];
  g.fillText(label ?? `${String(d.getHours()).padStart(2, '0')}${colon}${String(d.getMinutes()).padStart(2, '0')}`, c.width / 2, 48);
  vcrDisplay.texture.needsUpdate = true;
}

// ── Mouse: camera turn, hover and click (Physics.Raycast) ─────────────

const pointer = new THREE.Vector2(0, 0);
const _lampW = V(0, 0, 0);
const aim = new THREE.Vector2(0, 0); // the eased pointer the camera follows
let hasPointer = false;
let pressT = 1;
let hover = null;
const HOVERABLE = ['vcr', 'screen', 'window', 'lamp', 'frame'];
const hoverAmt = Object.fromEntries(HOVERABLE.map((n) => [n, 0])); // 0..1, eased
const tvGlass = { emissive: 0 };
const HOVER_TEXT = { vcr: 'VCR · OPEN THE TAPES', screen: 'TV · OPEN THE TAPES', window: 'CURTAIN', lamp: 'LAMP', frame: 'PHOTO' };
const hoverLabel = document.querySelector('[data-hover-label]');
let labelFor = null;
const _lbl = new THREE.Vector3();
function updateHoverLabel() {
  // the label follows the last hovered thing while it fades out
  let best = null;
  for (const n of HOVERABLE) if (hoverAmt[n] > 0.02 && (!best || hoverAmt[n] > hoverAmt[best])) best = n;
  if (!best) { hoverLabel.style.opacity = '0'; labelFor = null; return; }
  if (labelFor !== best) { hoverLabel.textContent = HOVER_TEXT[best]; labelFor = best; }
  const root = { vcr, screen, window: windowGroup, lamp, frame }[best];
  const b = solidBox(root);
  _lbl.set((b.min.x + b.max.x) / 2, b.max.y + 0.06, (b.min.z + b.max.z) / 2).project(camera);
  hoverLabel.style.transform = `translate(${((_lbl.x + 1) / 2) * innerWidth}px, ${((1 - _lbl.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
  hoverLabel.style.opacity = String(Math.min(1, hoverAmt[best] * 1.2));
}
const HINT_STANDBY = TOUCH ? 'TAP: VCR · CURTAIN · LAMP · PHOTO' : 'VCR · CURTAIN · LAMP · PHOTO';

// eject (a tape was in: STOP, BACK TO THE ROOM or the end of a replay brings the camera back out to the
// VCR, the cassette slides out and lifts away, then the room) is the reverse of insert.
// TV modes: standby (the room; the TV shows PRESS THE VCR) -> app (VCR clicked: the camera goes into
// the TV and the real app takes over the glass) -> insert (a tape is played: the camera pulls back, the
// cassette slides into the VCR) -> loading (the app's blue screen, about 3 s) -> play (the camera eases
// back into the TV for the replay). BACK TO THE ROOM or Escape returns to the room from any of them.
const SEQ = { insert: 1.5, slideFrom: 0.55, slideTo: 1.35, eject: 2.2, outFrom: 0.65, outTo: 1.3 };
let ejectThen = 'standby'; // where the camera goes after an eject: the room, or back into the TV (app)
let loaded = null; // the project name of the tape inside the VCR (null = empty), so it can be ejected
let seqT = 0; // seconds in the current mode
let playing = null; // the project name on the tape going in
let afterInsert = null; // starts the app's playback once the cassette is in
let hooks = {}; // set by startRoom(): what the app wants to hear about

// Camera moves: from where it is now to a pose, over a time, with an easing curve.
const easeInOut = (x) => x * x * (3 - 2 * x);
const easeIn = (x) => x * x * x; // starts slowly, speeds into the TV
const cam = { fromPos: V(0, 0, 0), fromLook: V(0, 0, 0), fromClose: 0, to: null, t: 1, dur: 1, ease: easeInOut };
const camPos = V(0, 0, 0);
const camLook = V(0, 0, 0);
let close = 0; // 0 = the room, 1 = right at the TV (fades the sun shafts, stops the cursor turn)
function goTo(pose, dur = 1.3, ease = easeInOut) {
  cam.fromPos.copy(camPos);
  cam.fromLook.copy(camLook);
  cam.fromClose = close;
  cam.to = pose;
  cam.t = 0;
  cam.dur = dur;
  cam.ease = ease;
}

// The app is only usable when the camera is in the TV; otherwise it is a picture on the glass that
// clicks go straight through (inert = like disabling a Canvas's GraphicRaycaster).
function setAppLive(on) {
  appScreen.inert = !on;
  screenWrap.style.pointerEvents = on ? 'auto' : 'none';
  document.body.classList.toggle('room-live', on);
}

function setMode(m) {
  const was = tvMode;
  tvMode = m;
  seqT = 0;
  const inRoom = m === 'standby';
  hint.textContent = inRoom ? HINT_STANDBY : '< BACK TO THE ROOM';
  hint.classList.toggle('is-button', !inRoom);
  document.body.classList.toggle('zoomed', !inRoom);
  setAppLive(false);
  startCut(m === 'standby' || m === 'insert' || m === 'eject'); // the canvas picture covers the glass in the room and while the tape goes in or out
  if (m === 'standby') {
    if (was !== 'eject') goTo(wide);
    cassette.visible = false;
    playing = null;
    afterInsert = null;
    status = tapeStatus();
    if (was !== 'standby' && was !== 'eject') hooks.onLeave?.();
  }
  if (m === 'eject') {
    // Out to the VCR, the tape comes out and lifts away, then on to the room view or back into the TV.
    goTo(POSES.insert, reduced.matches ? 0.01 : 0.9);
    playing = loaded;
    loaded = null;
    cassette.visible = true;
    cassette.position.set(-0.06, 0.06, 0.1); // just inside the slot
    if (ejectThen === 'standby') hooks.onLeave?.();
    tapeOut();
  }
  if (m === 'app' && was !== 'play') goTo(POSES.screen);
  if (m === 'insert') { goTo(POSES.insert, 1.0); cassette.visible = true; cassette.position.set(-0.06, 0.06, 0.42); tapeIn(); }
  if (m === 'play') goTo(POSES.screen, 1.4, easeIn);
}
function toggleTv() {
  pressT = 0;
  vcrClick();
  setMode(tvMode === 'standby' ? 'app' : 'standby');
}
makeClickable(vcr, 'vcr', toggleTv);
vcr.userData.when = () => tvMode === 'standby';
hint.textContent = HINT_STANDBY;
// The glass itself is a button in the room too: clicking the TV does what the VCR does.
makeClickable(screen, 'screen', toggleTv);
screen.userData.when = () => tvMode === 'standby';

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  hasPointer = true;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});
const ndcOf = (e) => [(e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1];
// Clicks inside the live app belong to the app, not to the room.
const inApp = (e) => !appScreen.inert && appScreen.contains(e.target);
let suppressClick = false;
stage.addEventListener('pointerdown', (e) => {
  if (tvMode !== 'standby' || inApp(e)) return;
  raycaster.setFromCamera(_ndc.set(...ndcOf(e)), camera);
  if (raycaster.intersectObject(beadHit, false).length) {
    cord.held = true;
    cord.clicked = false;
    cord.startY = e.clientY;
    cord.startExt = cord.ext;
    stage.setPointerCapture(e.pointerId);
  }
});
stage.addEventListener('pointermove', (e) => {
  if (!cord.held) return;
  // pixels to metres at the lamp's distance, so the bead stays under the pointer
  const dist = camera.position.distanceTo(lamp.getWorldPosition(_lampW));
  const mPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight;
  cord.ext = THREE.MathUtils.clamp(cord.startExt + (e.clientY - cord.startY) * mPerPx, 0, CORD_MAX);
  cord.vel = 0;
  if (!cord.clicked && cord.ext > CORD_CLICK) { cord.clicked = true; toggleLamp(); }
});
const releaseCord = () => {
  if (!cord.held) return;
  cord.held = false;
  suppressClick = true; // the click that follows must not pull again
  if (!cord.clicked) pullCord(); // let go without a real pull: it still clicks, like a plain click
  else cord.swingVel += 1.2 + cord.ext * 14;
};
stage.addEventListener('pointerup', releaseCord);
stage.addEventListener('pointercancel', releaseCord);
stage.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  if (inApp(e)) return;
  const o = clickableAt(...ndcOf(e));
  if (o) o.userData.click();
});
// Leaving the TV: with a tape in the VCR it comes out first (eject), otherwise straight to the room.
function leaveTv() {
  if (tvMode === 'standby' || tvMode === 'insert') return;
  if (tvMode === 'eject') { ejectThen = 'standby'; return; } // already ejecting: go on to the room after
  ejectThen = 'standby';
  setMode(loaded ? 'eject' : 'standby');
}
hint.addEventListener('click', leaveTv);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !howPanel.hidden) { howPanel.hidden = true; return; }
  if (e.key === 'Escape' && tvMode !== 'standby' && photoPanel.hidden) leaveTv();
});

// ── Panel: time switch and hide ───────────────────────────────────────

const panel = document.querySelector('[data-panel]');
const howPanel = document.querySelector('[data-how-panel]');
// The always-visible SOUND button (top left) lives in js/app.js; the SOUND switch in the controls is the same setting.
howPanel.querySelector('[data-how-close]').addEventListener('click', () => { howPanel.hidden = true; });
function syncButtons() {
  const sb = panel.querySelector('[data-sound]');
  sb.setAttribute('aria-pressed', String(soundOn()));
  sb.textContent = soundOn() ? 'SOUND ON' : 'SOUND OFF';
  for (const b of panel.querySelectorAll('[data-pref]')) b.setAttribute('aria-pressed', String(b.dataset.pref === 'motion' ? reducedMotion() : highContrast()));
  for (const b of panel.querySelectorAll('[data-time]')) b.setAttribute('aria-pressed', String(b.dataset.time === mode));
  for (const b of panel.querySelectorAll('[data-season]')) b.setAttribute('aria-pressed', String(b.dataset.season === seasonMode));
  const rb = panel.querySelector('[data-rain]');
  rb.setAttribute('aria-pressed', String(rainOn()));
  rb.textContent = rainOn() ? 'RAIN ON' : 'RAIN OFF';
}
panel.addEventListener('click', (e) => {
  const b = e.target.closest('[data-time]');
  if (b) {
    mode = b.dataset.time;
    const url = new URL(location.href);
    if (mode === 'auto') url.searchParams.delete('time'); else url.searchParams.set('time', mode);
    history.replaceState(null, '', url);
    setTarget(currentName());
    syncButtons();
  }
  const sbtn = e.target.closest('[data-season]');
  if (sbtn) { setSeason(sbtn.dataset.season); syncButtons(); }
  if (e.target.closest('[data-rain]')) { setRain(!rainOn()); syncButtons(); }
  const tg = e.target.closest('[data-toggle]');
  if (tg) {
    const open = panel.classList.toggle('is-hidden') === false;
    tg.setAttribute('aria-expanded', String(open));
    tg.querySelector('[data-toggle-text]').textContent = open ? 'HIDE CONTROLS' : 'ROOM CONTROLS';
  }
  if (e.target.closest('[data-how]')) howPanel.hidden = !howPanel.hidden;
  const sb = e.target.closest('[data-sound]');
  if (sb) setSound(!soundOn()).then(syncButtons);
  const pb = e.target.closest('[data-pref]');
  if (pb) {
    const name = pb.dataset.pref;
    setPref(name, !(name === 'motion' ? reducedMotion() : highContrast()));
  }
});
syncButtons();
onPrefsChange(syncButtons);

// ── Resize and the loop (Update) ──────────────────────────────────────

// Wide enough that the bookshelf, sofa, window, TV cabinet and lamp all fit, whatever the
// window's shape; on a phone the camera frames the cabinet (TV, VCR, lamp) only.
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  // pixels per metre at 1 m away, so a speck keeps its real size whatever the window or lens
  dustMat.uniforms.uScale.value = (innerHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  wxMat.uniforms.uScale.value = dustMat.uniforms.uScale.value;
  gradePass.uniforms.uAspect.value = innerWidth / innerHeight;
  css.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  const wasWide = cam.to === wide || cam.to === null;
  wide = aspect < 0.9 ? POSES.portrait : POSES.desktop;
  if (wasWide) { cam.to = wide; if (cam.t >= 1 || cam.to === null) { camPos.copy(wide.pos); camLook.copy(wide.look); } }
  const dist = wide.pos.distanceTo(wide.look);
  // Desktop: a fixed 45° lens. A window narrower than 16:10 widens the vertical FOV just enough to
  // keep the 5 m back wall in frame; a phone frames the TV corner.
  const keepWidth = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(DESKTOP_FOV / 2)) * 1.6 / aspect));
  camera.fov = aspect < 0.9 ? THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(3.3 / 2 / dist / aspect)), 36, 75) : Math.max(DESKTOP_FOV, Math.min(keepWidth, 60));
  camera.updateProjectionMatrix();
  // Full zoom: back off just enough that the whole glass, plus the two bezel bands, fits the window.
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const viewH = Math.max(SCREEN_H / (1 - BAND_TOP - BAND_BOTTOM), SCREEN.w * 1.03 / aspect); // world metres seen top to bottom
  const fitDist = viewH / 2 / tanV;
  const lift = viewH * (BAND_BOTTOM - BAND_TOP) / 2; // the glass sits a little above the middle
  POSES.screen.pos.set(SCREEN.x, SCREEN.y - lift, SCREEN.z + fitDist);
  POSES.screen.look.set(SCREEN.x, SCREEN.y - lift, SCREEN.z);
  sizeAppScreen((SCREEN.w / (viewH * aspect)) * innerWidth); // the glass's width in CSS pixels at full zoom
  if (cam.to === POSES.screen && cam.t >= 1) camPos.copy(POSES.screen.pos);
}
window.addEventListener('resize', resize);
resize();
camPos.copy(wide.pos);
camLook.copy(wide.look);

const timer = new THREE.Timer();
const k = (rate, dt) => 1 - Math.exp(-rate * dt);
const Y_AXIS = V(0, 1, 0);
const offset = V(0, 0, 0);
const origin = V(0, 0, 0);
const hoverTint = new THREE.Color(0.07, 0.055, 0.03);
let frameNo = 0;
let shadowsDirty = true; // draw the shadow map once at the start

renderer.setAnimationLoop((now) => {
  timer.update(now);
  // Never negative: the first frame's time can come before the timer's start, which would drag the
  // camera back toward its empty starting pose for a moment.
  const dt = THREE.MathUtils.clamp(timer.getDelta(), 0, 0.1);
  const t = timer.getElapsed();
  frameNo++;

  // Camera: eases between the room and the TV, and turns a little toward the cursor.
  // Still with reduced motion or on touch (no cursor).
  if (cam.to) {
    cam.t = reduced.matches ? 1 : Math.min(1, cam.t + dt / cam.dur);
    const e = cam.ease(cam.t);
    camPos.lerpVectors(cam.fromPos, cam.to.pos, e);
    camLook.lerpVectors(cam.fromLook, cam.to.look, e);
    close = cam.fromClose + ((cam.to.close ?? 0) - cam.fromClose) * e;
  }
  const z = close;
  const still = reduced.matches || !hasPointer || cord.held || tvMode !== 'standby';
  if (!cord.held) aim.lerp(still ? origin.set(0, 0, 0) : pointer, k(3, dt));

  // The VHS sequence runs on its own clock.
  seqT += dt;
  if (tvMode === 'insert') {
    const f = THREE.MathUtils.clamp((seqT - SEQ.slideFrom) / (SEQ.slideTo - SEQ.slideFrom), 0, 1);
    cassette.position.z = 0.42 + (0.1 - 0.42) * easeInOut(f);
    cassette.position.y = 0.06 + 0.012 * (1 - f) * (f > 0 ? 1 : 0.4);
    if (f >= 1 && cassette.visible) { cassette.visible = false; pressT = 0; } // swallowed by the VCR
    if (seqT >= SEQ.insert) { const go = afterInsert; afterInsert = null; loaded = playing; setMode('loading'); go?.(); }
  }
  if (tvMode === 'eject') {
    // The cassette slides out of the slot, then lifts up and away (as if taken by a hand), then the room.
    const f = THREE.MathUtils.clamp((seqT - SEQ.outFrom) / (SEQ.outTo - SEQ.outFrom), 0, 1);
    const lift = THREE.MathUtils.clamp((seqT - SEQ.outTo - 0.15) / 0.45, 0, 1);
    cassette.position.z = 0.1 + (0.42 - 0.1) * easeInOut(f) + 0.12 * easeInOut(lift);
    cassette.position.y = 0.06 + 0.012 * f + 0.25 * easeInOut(lift);
    cassette.rotation.x = -0.5 * easeInOut(lift);
    if (lift >= 1) cassette.visible = false;
    if (ejectThen === 'standby' && seqT >= SEQ.outTo + 0.1 && cam.to === POSES.insert) goTo(wide, 1.1);
    if (seqT >= SEQ.eject || reduced.matches) { cassette.rotation.x = 0; setMode(ejectThen); }
  }
  // Once the camera has arrived in the TV, the app takes clicks and typing.
  if ((tvMode === 'app' || tvMode === 'play') && cam.t >= 1 && appScreen.inert) setAppLive(true);
  updateCord(dt);
  updateClock(t);
  const amount = 1 - 0.6 * z;
  offset.copy(camPos).sub(camLook).applyAxisAngle(Y_AXIS, aim.x * 0.13 * amount);
  offset.y += aim.y * 0.12 * amount;
  camera.position.copy(camLook).add(offset);
  camera.lookAt(camLook);

  // The curtain slides toward its target; the panels bunch up at the rod ends when open.
  curtainAmount += (curtainTarget - curtainAmount) * k(reduced.matches ? 30 : 3, dt);
  const co = curtainAmount * curtainAmount * (3 - 2 * curtainAmount);
  curtainOpen = co;
  const pw = PANEL_CLOSED + (PANEL_OPEN - PANEL_CLOSED) * co;
  // The hem follows the moving panel like a spring (it lags, then swings back past and settles).
  cloth.vel = dt > 0 ? (pw - cloth.prevW) / dt : 0;
  cloth.prevW = pw;
  const lagGoal = -cloth.vel * 0.22;
  cloth.lagVel += ((lagGoal - cloth.lag) * 70 - cloth.lagVel * 7) * dt;
  cloth.lag = reduced.matches ? 0 : THREE.MathUtils.clamp(cloth.lag + cloth.lagVel * dt, -0.12, 0.12);
  const stillCloth = reduced.matches;
  shapeCurtain(curtainL, pw, t, stillCloth, hoverAmt.window);
  shapeCurtain(curtainR, pw, t, stillCloth, hoverAmt.window);

  // Light glides toward the current period over a few seconds, like the sky changing.
  if (T.name !== currentName()) setTarget(currentName());
  const s = k(1.5, dt);
  for (const n of NUM) A[n] += (T.num[n] - A[n]) * s;
  for (const c of COL) C[c].lerp(T.col[c], s);
  const lampGoal = lampOverride === null ? T.num.lamp : (lampOverride ? 1 : 0);
  A.lamp += (lampGoal - A.lamp) * k(3, dt);
  // Closed curtains keep the direct sun out (their shadow does that) and the room a bit dimmer.
  sun.color.copy(C.sun);
  sun.intensity = A.sunI * (1 - 0.6 * rainShown); // clouds cover the sun while it rains (last frame's rain amount)
  hemi.color.copy(C.sky);
  hemi.groundColor.copy(C.ground);
  hemi.intensity = A.hemiI * (0.6 + 0.4 * co);
  scene.environmentIntensity = A.env * (0.6 + 0.4 * co);
  glowMat.color.copy(C.glow);
  glowMat.opacity = A.glowO * (0.35 + 0.65 * co) * WEATHER[seasonName()].glare * (1 - 0.6 * rainShown); // pale pictures (snow, haze) get less glare
  viewMat.uniforms.mixNight.value = A.night;
  viewMat.uniforms.tint.value.copy(C.tint);
  viewMat.uniforms.uTime.value = reduced.matches ? 0 : t;
  wxMat.uniforms.uTime.value = reduced.matches ? 0 : t;
  wxMat.uniforms.uLight.value = 1 - 0.55 * A.night; // flakes and petals dim at night
  weather.visible = WEATHER[seasonName()].count > 0 && z < 0.98;
  // Rain fades with the RAIN switch; the view outside goes duller while it rains.
  rainShown += ((rainOn() ? 1 : 0) - rainShown) * k(reduced.matches ? 30 : 1.5, dt);
  const rp = RAIN[seasonName()];
  rainMat.uniforms.uTime.value = reduced.matches ? 0 : t;
  rainMat.uniforms.uAlpha.value = rp.alpha * rainShown * (1 - 0.4 * A.night);
  rainLines.visible = rainShown > 0.01 && z < 0.98;
  dropsMat.uniforms.uTime.value = reduced.matches ? 0 : t;
  dropsMat.uniforms.uAmount.value = rp.drops * rainShown;
  dropsMat.uniforms.uLight.value = 1 - 0.5 * A.night;
  drops.visible = rainShown > 0.01 && z < 0.98;
  viewMat.uniforms.uGain.value = WEATHER[seasonName()].gain * (1 - (1 - rp.dim) * rainShown);
  renderer.toneMappingExposure = A.exposure;
  const flick = reduced.matches ? 0 : Math.sin(t * 7.3) * 0.04 + Math.sin(t * 2.1) * 0.03; // a live picture flickers
  tvLight.intensity = A.tv * (1 + flick);
  tvLight.color.set(tvMode === 'standby' || tvMode === 'loading' ? 0x5a74ff : tvMode === 'insert' ? 0x9aa0aa : 0x9fb0d8);

  // The visible sun and its shafts; both fade when the camera is close to the TV so they never
  // cover the screen, and when the curtain is closed.
  sunDisc.material.color.copy(C.disc);
  sunDisc.material.opacity = co * (1 - 0.85 * rainShown);
  sunDisc.scale.setScalar(A.discSize);
  const shaftBase = A.beamO * (1 - z) * co * co * (1 - 0.7 * rainShown); // gone at the TV, so no band of light crosses the app
  dustMat.uniforms.uOpacity.value = Math.min(0.9, shaftBase * 2.4);
  dustMat.uniforms.uColor.value.copy(C.beam);
  dustMat.uniforms.uTime.value = reduced.matches ? 0 : t;
  dust.visible = shaftBase > 0.005;
  for (const d of shafts) {
    aimShaft(d);
    d.mat.color.copy(C.beam);
    d.mat.opacity = shaftBase * d.k * (reduced.matches ? 1 : 0.88 + 0.12 * Math.sin(t * 0.55 + d.ph));
  }

  // Hover: the first solid thing under the pointer, if it is a button.
  if (hasPointer && frameNo % 2 === 0) {
    hover = clickableAt(pointer.x, pointer.y)?.userData.name ?? null;
  }
  if (!hasPointer || tvMode !== 'standby') hover = null;
  stage.style.cursor = cord.held ? 'grabbing' : hover ? 'pointer' : '';
  // Each clickable thing's highlight fades in and out (about 0.2 s), and a small label with its name
  // fades in above it, so the player sees what can be clicked.
  for (const n of HOVERABLE) hoverAmt[n] += ((hover === n ? 1 : 0) - hoverAmt[n]) * k(reduced.matches ? 60 : 12, dt);
  updateHoverLabel();
  // The glass reflection reads as glass from the room; in the TV it would wash over the app.
  tvSheen.material.opacity = 0.55 * (1 - 0.85 * z) + 0.25 * hoverAmt.screen;

  pic.material.emissive.setScalar(0.16 * hoverAmt.frame);

  // Curtain fabric: light shines through it when it is closed (daylight behind it); hover brightens it.
  curtainMat.emissive.copy(C.glow).multiplyScalar((1 - co) * Math.min(1.2, A.sunI / 3) * 0.16); // a soft glow through the cloth; more would flatten the folds
  curtainMat.emissive.r += hoverTint.r * hoverAmt.window * 1.6;
  curtainMat.emissive.g += hoverTint.g * hoverAmt.window * 1.6;
  curtainMat.emissive.b += hoverTint.b * hoverAmt.window * 1.6;

  ceiling.material.emissiveIntensity = 0.45 * (1 - 0.85 * A.night); // cream by day, dark at night

  // Lamp: light, shade glow and halo follow how "on" it is.
  lampLight.intensity = 1.7 * A.lamp;
  shadeMat.emissiveIntensity = 0.1 + 1.0 * A.lamp + 0.35 * hoverAmt.lamp;
  bulb.material.color.setRGB(1, 0.85, 0.6).multiplyScalar(0.35 + 0.65 * A.lamp);
  lampGlowSprite.material.opacity = 0.75 * A.lamp;

  // VCR: glows green when a tape is due; hover lifts the glow; a click presses it down.
  const due = status.ready > 0;
  const pulse = due && !reduced.matches ? 0.75 + 0.25 * Math.sin(t * 2.4) : 1;
  vcrLedMat.color.set(due ? 0x62ff8f : 0x3a3c42).multiplyScalar(pulse);
  vcrGlow.intensity = (due ? 0.06 : 0) + 0.1 * hoverAmt.vcr;
  vcrShell.material.emissive.setRGB(0.05, 0.13, 0.08).multiplyScalar(hoverAmt.vcr);
  tvGlass.emissive = 0.18 * hoverAmt.screen; // the standby picture brightens a little
  pressT = Math.min(1, pressT + dt * 6);
  vcr.position.y = VCR_Y - Math.sin(pressT * Math.PI) * 0.006;

  drawScreen(t, dt);
  standbyMat.color.setScalar(1 + tvGlass.emissive);
  drawVcrDisplay(t);
  // Sun shadow, baked: the sun and the room don't move, so the shadow map is drawn once and again only
  // while the curtain slides (it is the one big thing that casts a moving shadow); never while the
  // camera is inside the TV. The cord, the pendulum and the cloth's breathing are too small to matter.
  const moving = Math.abs(curtainTarget - curtainAmount) > 0.002 || Math.abs(cloth.lag) > 0.004;
  if (shadowsDirty || (close < 0.98 && moving)) {
    renderer.shadowMap.needsUpdate = true;
    shadowsDirty = false;
  }
  // Grade, vignette and grain over the room; they fade out as the camera goes into the TV, where the
  // app has its own VHS look. Still grain with reduced motion; all off in high contrast.
  const post = highContrast() ? 0 : 1 - THREE.MathUtils.smoothstep(close, 0.6, 1);
  gradePass.uniforms.uAmount.value = post;
  gradePass.uniforms.uTime.value = reduced.matches ? 0 : t;
  if (post > 0.001) composer.render(dt);
  else renderer.render(scene, camera); // in the TV: skip the extra pass
  css.render(cssScene, camera);
});

// For the automated checks.
const named = { vcr: vcrShell, screen, frame, lamp, sideTable, sofa, longSofa, armchair, table, rug, bookshelf, clock: clockGroup, window: windowGroup, cabinet: cabBody, tv,
  paintingLeft: paintings[0], paintingRight: paintings[1] };
const _part = new THREE.Box3();
// Bounding box of the solid meshes only: glows, light shafts and invisible click boxes don't count.
function solidBox(root) {
  const b = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || o.raycast === NOOP || o.material.visible === false) return;
    if (o.isInstancedMesh) o.computeBoundingBox(); // covers every instance, not just the first
    else if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.union(_part.copy(o.isInstancedMesh ? o.boundingBox : o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  return b;
}
function blockedBy(target) {
  const hitNames = {};
  const b = new THREE.Box3().setFromObject(target);
  const rc = new THREE.Raycaster();
  let n = 0;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    const p = V(b.min.x + (b.max.x - b.min.x) * i / 4, b.min.y + (b.max.y - b.min.y) * j / 4, (b.min.z + b.max.z) / 2);
    const dir = p.clone().sub(camera.position);
    const dist = dir.length();
    rc.set(camera.position, dir.normalize());
    rc.far = dist - 0.03;
    const hits = rc.intersectObjects(scene.children, true).filter((h) => h.object.raycast !== NOOP && h.object.material?.visible !== false && h.object !== target);
    n++;
    if (hits.length) {
      let o = hits[0].object;
      while (o.parent && o.parent !== scene) o = o.parent;
      hitNames[o.name || 'unnamed'] = (hitNames[o.name || 'unnamed'] ?? 0) + 1;
    }
  }
  return { points: n, blocked: hitNames };
}
const _p = V(0, 0, 0);
function toPixels(v) {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight, ndcX: p.x, ndcY: p.y };
}
function project(name) {
  return toPixels(solidBox(named[name]).getCenter(_p));
}
function ndcSpan(name) { // horizontal and vertical extent on screen (NDC) of an object's bounding box
  const b = solidBox(named[name]);
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const zz of [b.min.z, b.max.z]) {
    const p = V(x, y, zz).project(camera);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x0, x1, y0, y1 };
}
// ── Baked ambient occlusion on the floor (learner request: baked, light, balanced) ──
// The sun's shadow only exists where the sun reaches, so furniture elsewhere looked as if it floated.
// Like a baked AO lightmap in Unity: once, at start, every piece's footprint is painted into one canvas
// covering the floor (a wide soft layer, then a tight dark one at the contact points: whole bases for
// pieces that stand on the floor, small dots under legs), and one see-through quad lays it over the
// floor and the rug. One texture, one draw call, nothing per frame.
const blobTex = canvasTexture(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const aoBandTex = canvasTexture(8, 64, (g, w, h) => {
  const grd = g.createLinearGradient(0, h, 0, 0); // dark at the floor line, fading upward / outward
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const contact = [];
const contactMat = (map, opacity) => new THREE.MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity, depthWrite: false, toneMapped: false });
const AO_PX = 200; // canvas pixels per metre
const AO_MARGIN = 0.4; // the floor map reaches a little past the room on every side
const aoW = Math.round((ROOM.w + 2 * AO_MARGIN) * AO_PX);
const aoD = Math.round((ROOM.d + 2 * AO_MARGIN) * AO_PX);
const aoCanvas = document.createElement('canvas');
aoCanvas.width = aoW;
aoCanvas.height = aoD;
const toAo = (x, z) => [(x + ROOM.w / 2 + AO_MARGIN) * AO_PX, (z - BACK + AO_MARGIN) * AO_PX];
// kind: 'base' = stands on the floor with its whole bottom; 'legs' = on legs at the corners.
const AO_PIECES = [
  [cab, 'base', 1.0], [bookshelf, 'base', 1.0], [clockGroup, 'base', 0.9],
  [sofa, 'legs', 1.0], [longSofa, 'legs', 1.0], [armchair, 'legs', 1.0],
  [table, 'legs', 0.85], [sideTable, 'legs', 0.75],
];
{
  const g = aoCanvas.getContext('2d');
  const rect = (b, grow) => {
    const [x0, z0] = toAo(b.min.x - grow, b.min.z - grow);
    const [x1, z1] = toAo(b.max.x + grow, b.max.z + grow);
    g.fillRect(x0, z0, x1 - x0, z1 - z0);
  };
  // 1. wide, soft: the light the piece takes away from the floor around it
  g.filter = `blur(${Math.round(0.16 * AO_PX)}px)`;
  for (const [root, , k] of AO_PIECES) {
    g.fillStyle = `rgba(0,0,0,${0.42 * k})`;
    rect(solidBox(root), 0.06);
  }
  // 2. tight and darker: where it actually touches the floor
  g.filter = `blur(${Math.round(0.035 * AO_PX)}px)`;
  for (const [root, kind, k] of AO_PIECES) {
    const b = solidBox(root);
    if (kind === 'base') {
      g.fillStyle = `rgba(0,0,0,${0.55 * k})`;
      rect(b, -0.01);
    } else {
      g.fillStyle = `rgba(0,0,0,${0.32 * k})`; // the seat or top shades the floor under it
      rect(b, -0.06);
      g.fillStyle = `rgba(0,0,0,${0.6 * k})`;
      const inset = 0.07;
      for (const x of [b.min.x + inset, b.max.x - inset]) for (const z of [b.min.z + inset, b.max.z - inset]) {
        const [px, pz] = toAo(x, z);
        g.beginPath();
        g.arc(px, pz, 0.045 * AO_PX, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.filter = 'none';
  const tex = new THREE.CanvasTexture(aoCanvas);
  tex.anisotropy = 4;
  const m = noPick(new THREE.Mesh(new THREE.PlaneGeometry(aoW / AO_PX, aoD / AO_PX), contactMat(tex, 1)));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.013, BACK - AO_MARGIN + aoD / AO_PX / 2); // just above the rug, so it shades both
  m.renderOrder = 1;
  scene.add(m);
  contact.push(m);
}
// Where the walls meet the floor: a band on the floor along each wall and one up the wall's foot.
function aoBand(w, h, x, y, z, rotX, rotY, opacity) {
  const m = noPick(new THREE.Mesh(new THREE.PlaneGeometry(w, h), contactMat(aoBandTex.texture, opacity)));
  m.rotation.order = 'YXZ';
  m.rotation.set(rotX, rotY, 0);
  m.position.set(x, y, z);
  scene.add(m);
  contact.push(m);
}
const AO_FLOOR = 0.3; // how far the darkening reaches over the floor
const AO_WALL = 0.22; // and up the wall
aoBand(ROOM.w, AO_FLOOR, 0, 0.003, BACK + AO_FLOOR / 2, -Math.PI / 2, Math.PI, 0.45); // back wall, on the floor
aoBand(ROOM.w, AO_WALL, 0, AO_WALL / 2, BACK + 0.022, 0, 0, 0.32); // back wall, up its foot (in front of the baseboard)
for (const sx of [-1, 1]) {
  aoBand(FLOOR_LEN, AO_FLOOR, sx * (ROOM.w / 2 - AO_FLOOR / 2), 0.003, BACK + FLOOR_LEN / 2, -Math.PI / 2, sx * Math.PI / 2, 0.42);
  aoBand(FLOOR_LEN, AO_WALL, sx * (ROOM.w / 2 - 0.004), AO_WALL / 2, BACK + FLOOR_LEN / 2, 0, -sx * Math.PI / 2, 0.3);
}

// For the automated checks (the room is a module, so they need a handle on it).
window.__room = {
  rain: () => ({ on: rainOn(), shown: rainShown, lines: rainLines.visible, drops: drops.visible, amount: dropsMat.uniforms.uAmount.value, alpha: rainMat.uniforms.uAlpha.value, speed: rainMat.uniforms.uSpeed.value }),
  books: () => bookshelf.userData.books.map(({ x, y, w, h, lean }) => ({ x, y, w, h, lean })),
  layout: () => {
    const bx = (o) => new THREE.Box3().setFromObject(o);
    const c = bx(clockGroup); const l = { min: { x: SIDE.x - SIDE.w / 2 }, max: { x: SIDE.x + SIDE.w / 2 } }; // the table itself (the lamp's light and glow make its box huge)
    return { paintings: paintings.length, paintingLeft: { x: paintings[0].position.x, ry: paintings[0].rotation.y }, paintingRight: { x: paintings[1].position.x, ry: paintings[1].rotation.y },
      clock: { x0: c.min.x, x1: c.max.x }, lamp: { x0: l.min.x, x1: l.max.x } };
  },
  // Where 6 dust specks are right now (the same formula as the vertex shader, on the CPU), in metres.
  dustSample: () => {
    const p = dustGeo.attributes.position.array; const s = dustGeo.attributes.seed.array; const u = dustMat.uniforms.uTime.value; const out = [];
    for (const i of [0, 17, 40, 63, 88, 89]) {
      const seed = s[i]; const t = u + seed * 100;
      const w = [Math.sin(t * 0.37 + seed * 7) + 0.6 * Math.sin(t * 0.91 + seed * 13) + 0.3 * Math.sin(t * 1.73 + seed * 29),
        0.8 * Math.sin(t * 0.29 + seed * 3) + 0.4 * Math.sin(t * 0.83 + seed * 17),
        Math.cos(t * 0.33 + seed * 5) + 0.5 * Math.cos(t * 0.77 + seed * 11)];
      const rise = ((t * (0.012 + 0.012 * seed)) % 0.5) - 0.25;
      out.push([p[i * 3] + w[0] * 0.09, p[i * 3 + 1] + w[1] * 0.09 + rise, p[i * 3 + 2] + w[2] * 0.09]);
    }
    return out;
  },
  lite: () => ({ lite: LITE, touch: TOUCH, pr: renderer.getPixelRatio(), shadow: sun.shadow.mapSize.x, dust: DUST_N }),
  season: () => ({ mode: seasonMode, name: seasonName(), shown: shownSeason, weather: weather.visible, count: wxMat.uniforms.uCount.value, heat: viewMat.uniforms.uHeat.value }),
  camera,
  renderer,
  sunShadowSize: () => sun.shadow.mapSize.x,
  status: () => status,
  getMode: () => tvMode,
  live: () => !appScreen.inert,
  seq: () => ({ loaded, ejectThen, rotX: cassette.rotation.x, cassetteY: cassette.position.y, mode: tvMode, t: seqT, cassette: cassette.visible, cassetteZ: cassette.position.z, close, camT: cam.t, playing, cover: cutT < CUT_FREEZE + CUT_TEAR ? 0.5 : covered ? 1 : 0 }),
  cut: () => ({ t: cutT, dir: cutDir, covered, visible: standby.visible }),
  // Hold the cut at a fixed time, for screenshots (null lets it run again).
  holdCut: (sec) => { cutHold = sec; },
  // Where the glass is on screen, in CSS pixels (its four corners projected by the camera).
  glassRect: () => {
    const c = [[-0.32, 0.24], [0.32, 0.24], [0.32, -0.24], [-0.32, -0.24]].map(([x, y]) => toPixels(screen.localToWorld(V(x, y, 0))));
    return { x0: Math.min(...c.map((p) => p.x)), x1: Math.max(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), y1: Math.max(...c.map((p) => p.y)) };
  },
  appRect: () => { const r = appScreen.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; },
  cord: () => ({ ext: cord.ext, held: cord.held, swing: cord.swing }),
  rotY: (name) => named[name].rotation.y,
  names: () => Object.fromEntries(Object.keys(named).map((k) => [k, 1])),
  setVisible: (name, on) => { named[name].visible = on; },
  // Share of the frame where the first thing the eye ray meets is part of the named object.
  coverageOf: (name, step = 0.04) => {
    const rc = new THREE.Raycaster();
    const root = named[name];
    let n = 0, hit = 0, top = -1;
    for (let y = -1 + step / 2; y < 1; y += step) for (let x = -1 + step / 2; x < 1; x += step) {
      n++;
      rc.setFromCamera(new THREE.Vector2(x, y), camera);
      const h = rc.intersectObjects(scene.children, true).find((q) => q.object.raycast !== NOOP && q.object.material?.visible !== false);
      if (!h) continue;
      let o = h.object;
      while (o && o !== root) o = o.parent;
      if (o === root) { hit++; top = Math.max(top, y); }
    }
    return { area: hit / n, fromBottom: (top + 1) / 2 };
  },
  seatTop: () => { const b = new THREE.Box3(); longSofa.traverse((o) => { if (o.isMesh && o.geometry.parameters?.height === 0.13) b.union(new THREE.Box3().setFromObject(o)); }); return b.max.y; },
  screenZ: () => screen.getWorldPosition(V(0, 0, 0)).z,
  // Which objects stand between the camera and a target: rays to a grid of points on it.
  frameBlockedBy: () => blockedBy(pic),
  screenBlockedBy: () => blockedBy(screen),
  tableItems: () => { let books = 0, papers = 0; table.traverse((o) => { if (o.userData.kind === 'book') books++; if (o.userData.kind === 'paper') papers++; }); return { books, papers }; },
  photoMatchesPreview: () => { // compare the frame texture and the preview at a few points (same crop)
    if (!photoImg) return false;
    const a = photoCanvas.getContext('2d');
    const b = photoPreview.getContext('2d');
    return [[0.25, 0.25], [0.5, 0.5], [0.75, 0.6], [0.4, 0.85]].every(([u, v]) => {
      const p = a.getImageData(Math.floor(u * FW), Math.floor(v * FH), 1, 1).data;
      const q = b.getImageData(Math.floor(u * photoPreview.width), Math.floor(v * photoPreview.height), 1, 1).data;
      return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < 60;
    });
  },
  beadPx: () => toPixels(bead.getWorldPosition(V(0, 0, 0))),
  photoState: () => ({ has: !!photoImg, panel: !photoPanel.hidden, ...photoView, stored: (() => { try { return (localStorage.getItem(PHOTO_KEY) || '').length; } catch { return -1; } })() }),
  curtainShape: () => { // how far the hem of the left panel is from straight below its top edge (cloth motion)
    const p = curtainL.geometry.attributes.position;
    const top = p.getX(CURTAIN_NU), bottom = p.getX(p.count - 1);
    return { top, bottom, lag: cloth.lag, depth: Math.max(...Array.from({ length: CURTAIN_NU + 1 }, (_, i) => Math.abs(p.getZ(i)))) };
  },
  getPeriod: () => T.name,
  project,
  ndcSpan,
  screenWidthPx: () => {
    const a = screen.localToWorld(V(-0.32, 0, 0)).project(camera);
    const b = screen.localToWorld(V(0.32, 0, 0)).project(camera);
    return Math.abs(((b.x - a.x) / 2) * innerWidth);
  },
  hitAt: (x, y) => clickableAt((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)?.userData.name ?? null,
  curtain: () => ({ target: curtainTarget, open: curtainOpen }),
  curtainPoint: () => toPixels(V(ROD.x0 + 0.09, (CURTAIN_TOP + CURTAIN_BOTTOM) / 2, CURTAIN_Z)),
  lamp: lampState,
  worldPos: (name) => solidBox(named[name]).getCenter(V(0, 0, 0)).toArray(),
  worldBox: (name) => { const b = solidBox(named[name]); return { min: b.min.toArray(), max: b.max.toArray() }; },
  sunDiscPx: () => toPixels(sunDisc.position),
  windowRect: () => {
    const a = toPixels(V(fx - WIN.w / 2, fy + WIN.h / 2, WALL_Z));
    const b = toPixels(V(fx + WIN.w / 2, fy - WIN.h / 2, WALL_Z));
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  },
  shaftLine: (i = 1, from = 0.15, to = 0.6) => {
    const d = shafts[i];
    const at = (f) => toPixels(d.mesh.position.clone().addScaledVector(d.dir, d.len * f));
    return { from: at(from), to: at(to) };
  },
  setShafts: (on) => { for (const d of shafts) d.mesh.visible = on; },
  setDust: (on) => { dust.material.visible = on; },
  dustAt: (i, time) => { const s = dustGeo.attributes.seed.array[i]; return s; },
  dust: () => ({ n: DUST_N, visible: dust.visible, opacity: dustMat.uniforms.uOpacity.value }),
  setSunDisc: (on) => { sunDisc.visible = on; },
  sound: soundState,
  post: () => ({ amount: gradePass.uniforms.uAmount.value, passes: composer.passes.length }),
  setPost: (on) => { gradePass.enabled = on; },
  hover: () => ({ name: hover, amt: { ...hoverAmt }, label: hoverLabel.textContent, labelOpacity: Number(hoverLabel.style.opacity || 0) }),
  setSunShadow: (on) => { sun.castShadow = on; shadowsDirty = true; },
  setContact: (on) => { for (const m of contact) m.visible = on; },
  // Where room corners land in the sun shadow's box (NDC); outside -1..1 means no shadow there.
  shadowCoverage: () => {
    const c = sun.shadow.camera;
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    const out = [];
    for (const x of [-ROOM.w / 2, ROOM.w / 2]) for (const y of [0, ROOM.h]) for (const zz of [BACK, BACK + FLOOR_LEN]) {
      const p = V(x, y, zz).applyMatrix4(c.matrixWorldInverse).applyMatrix4(c.projectionMatrix);
      out.push({ at: [x, y, +zz.toFixed(2)], ndc: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
    }
    return out;
  },
  // The sun shadow's box in world space (its 8 corners), to see what it covers.
  shadowBox: () => {
    const c = sun.shadow.camera;
    c.updateMatrixWorld(true);
    const pts = [];
    for (const x of [c.left, c.right]) for (const y of [c.bottom, c.top]) for (const zz of [-c.near, -c.far]) pts.push(V(x, y, zz).applyMatrix4(c.matrixWorld).toArray().map((v) => +v.toFixed(2)));
    return pts;
  },
  shaftOpacity: () => shafts[0].mat.opacity,
};

// ── The app's side ───────────────────────────────────────────────────

// js/app.js calls this once. The room returns what the app needs: playTape() runs the cassette
// insert before the app's own blue screen, enterTv() and toRoom() move the camera.
export function startRoom({ onLeave } = {}) {
  hooks = { onLeave };
  stage.hidden = false;
  roomUi.hidden = false;
  setAppLive(false);
  return {
    // A tape is played: back out so the VCR shows, slide the cassette in, then start the app's
    // playback (its blue loading screen) and ease back into the TV for the replay.
    playTape(name, start) {
      if (tvMode === 'standby' || reduced.matches) { start(); setMode('play'); return; }
      playing = name;
      afterInsert = start;
      setMode('insert');
    },
    // The app's blue loading screen is over and the replay begins: ease into the TV.
    loadingDone() { if (tvMode === 'loading') setMode('play'); },
    enterTv() { if (tvMode === 'standby') setMode('app'); },
    toRoom() { leaveTv(); },
    // The app's playback ended (STOP, or leaving the BACK ON IT screen): the camera pulls back, the
    // VCR ejects the tape, and the camera goes back into the TV, where the shelf is.
    tapeDone() {
      if (!loaded || tvMode === 'standby' || tvMode === 'eject' || tvMode === 'insert') return;
      ejectThen = 'app';
      setMode('eject');
    },
    mode: () => tvMode,
  };
}

// Turns the CRT curve on (laptops and desktops) or leaves only the CSS look (Safari, touch screens,
// reduced motion). Returns whether the bend is on.
export function setupCrtBend() {
  const filter = document.getElementById('crt-bend');
  const safari = /^((?!chrome|chromium|android|edg).)*safari/i.test(navigator.userAgent);
  const fine = window.matchMedia('(pointer: fine)').matches;
  if (!filter || safari || !fine || reduced.matches) return false;
  const { url, scale } = makeBendMap();
  filter.querySelector('feImage').setAttribute('href', url);
  filter.querySelector('feDisplacementMap').setAttribute('scale', String(scale));
  document.documentElement.classList.add('crt-bend');
  return true;
}

// Resolves when every room picture has arrived (or failed: the room works without them), and reports
// progress on the way: onProgress(loaded, total).
// Only the first load reports: pictures loaded later (another season) must not bring the loading
// screen back, which left it stuck over the room after a season change.
export function roomReady(onProgress = () => {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      load.listeners = load.listeners.filter((fn) => fn !== report);
      resolve();
    };
    const report = () => {
      if (done) return;
      onProgress(load.done, load.total);
      if (load.total && load.done >= load.total) finish();
    };
    load.listeners.push(report);
    report();
    setTimeout(finish, 8000); // never hold the app back for long
  });
}
