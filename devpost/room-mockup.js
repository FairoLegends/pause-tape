// Room mockup (devpost/room-mockup.html): a three.js room around the TV, for the learner to
// review before anything goes into the app. Unity map: Scene = scene graph, PerspectiveCamera =
// Camera, MeshStandardMaterial = URP Lit material, Directional/Point light = Light,
// Raycaster = Physics.Raycast from the mouse, setAnimationLoop = Update().

import * as THREE from '../assets/vendor/three.module.min.js';
import { RoomEnvironment } from '../assets/vendor/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../assets/vendor/addons/geometries/RoundedBoxGeometry.js';

const stage = document.getElementById('stage');
const hint = document.querySelector('[data-hint]');
const params = new URLSearchParams(location.search);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
document.fonts.load('44px VT323'); // canvas text doesn't make the browser load a font by itself

// ── Renderer, scene, camera ───────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.append(renderer.domElement);

const scene = new THREE.Scene();
// Soft bounce light from a generic lit room (three.js's RoomEnvironment): fills the shadows and
// gives metal something to reflect, like URP's ambient probe.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// Camera poses: the whole room, the room on a phone, and close to the TV once the shelf is open.
const POSES = {
  desktop: { pos: V(-0.3, 1.32, 1.3), look: V(-0.3, 1.02, -1.4) },
  portrait: { pos: V(0.1, 1.25, 1.5), look: V(0.1, 1.0, -1.4) },
  tv: { pos: V(0.02, 0.95, -0.05), look: V(0, 0.88, -1.16) },
};
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

// ── Room: floor, walls, window ────────────────────────────────────────

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

const floorTex = canvasTexture(512, 512, (g, w, h) => {
  for (let i = 0; i < 8; i++) { // wooden planks
    const shade = 92 + Math.round(Math.random() * 26);
    g.fillStyle = `rgb(${shade + 30},${shade},${shade - 30})`;
    g.fillRect(0, (i * h) / 8, w, h / 8);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, (i * h) / 8, w, 2);
  }
});
floorTex.texture.wrapS = floorTex.texture.wrapT = THREE.RepeatWrapping;
floorTex.texture.repeat.set(2, 2);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), std(0xffffff, 0.7, 0, { map: floorTex.texture }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), std(0xd8d4cc, 1));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 2.7;
scene.add(ceiling);

// Back wall with a window opening (four boxes around the hole).
const WALL_Z = -2.0;
const WIN = { x: -0.95, y: 1.45, w: 1.1, h: 1.0 };
const wallW = 6;
const wallH = 2.7;
const wt = 0.12;
const leftW = (WIN.x - WIN.w / 2) + wallW / 2;
box(leftW, wallH, wt, wallMat, -wallW / 2 + leftW / 2, wallH / 2, WALL_Z);
const rightW = wallW / 2 - (WIN.x + WIN.w / 2);
box(rightW, wallH, wt, wallMat, wallW / 2 - rightW / 2, wallH / 2, WALL_Z);
box(WIN.w, WIN.y - WIN.h / 2, wt, wallMat, WIN.x, (WIN.y - WIN.h / 2) / 2, WALL_Z);
const topH = wallH - (WIN.y + WIN.h / 2);
box(WIN.w, topH, wt, wallMat, WIN.x, wallH - topH / 2, WALL_Z);
for (const sx of [-1, 1]) { // side walls
  const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(8, wallH), wallMat);
  sideWall.position.set(sx * 3, wallH / 2, 2);
  sideWall.rotation.y = -sx * Math.PI / 2;
  sideWall.receiveShadow = true;
  scene.add(sideWall);
}
box(wallW, 0.1, 0.02, std(0xe9e4d8, 0.6), 0, 0.05, WALL_Z + 0.07); // baseboard

// Window frame and glass.
const frameMat = std(0xf0ebdf, 0.55);
const fx = WIN.x;
const fy = WIN.y;
box(WIN.w + 0.1, 0.06, 0.16, frameMat, fx, fy + WIN.h / 2 + 0.03, WALL_Z + 0.02);
box(WIN.w + 0.16, 0.05, 0.26, frameMat, fx, fy - WIN.h / 2 - 0.02, WALL_Z + 0.08); // sill
box(0.06, WIN.h + 0.1, 0.16, frameMat, fx - WIN.w / 2 - 0.03, fy, WALL_Z + 0.02);
box(0.06, WIN.h + 0.1, 0.16, frameMat, fx + WIN.w / 2 + 0.03, fy, WALL_Z + 0.02);
box(0.035, WIN.h, 0.06, frameMat, fx, fy, WALL_Z + 0.02); // mullion
box(WIN.w, 0.035, 0.06, frameMat, fx, fy, WALL_Z + 0.02); // transom

// A soft diagonal sheen drawn on the glass (and later on the TV screen).
const sheen = canvasTexture(256, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, h);
  for (const [at, a] of [[0, 0], [0.28, 0], [0.36, 0.22], [0.46, 0], [0.62, 0.08], [0.7, 0], [1, 0]]) {
    grd.addColorStop(at, `rgba(255,255,255,${a})`);
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const glass = new THREE.Mesh(
  new THREE.PlaneGeometry(WIN.w, WIN.h),
  new THREE.MeshBasicMaterial({ map: sheen.texture, transparent: true, opacity: 0.7, depthWrite: false }),
);
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
const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 3.4), glowMat);
glow.position.set(fx, fy, WALL_Z + 0.07);
scene.add(glow);

// One curtain on the left, on a rod.
const curtainTex = canvasTexture(256, 512, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 8; i++) grd.addColorStop(i / 8, i % 2 ? '#c9b99a' : '#a99a7c');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const curtain = new THREE.Mesh(
  new THREE.PlaneGeometry(0.36, 1.6),
  std(0xffffff, 0.95, 0, { map: curtainTex.texture, side: THREE.DoubleSide }),
);
curtain.position.set(fx - WIN.w / 2 - 0.2, 1.42, WALL_Z + 0.16);
curtain.castShadow = true;
scene.add(curtain);
box(1.5, 0.02, 0.02, std(0x3a3328, 0.4, 0.6), fx - 0.1, 2.2, WALL_Z + 0.14);

// ── The view outside the window (placeholder until the learner's pictures) ──

function drawView(g, w, h, night) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  if (night) {
    sky.addColorStop(0, '#0b1430');
    sky.addColorStop(1, '#1d2b52');
  } else {
    sky.addColorStop(0, '#7fb8e8');
    sky.addColorStop(1, '#d8ecf7');
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  if (night) {
    g.fillStyle = 'rgba(235,240,255,0.95)';
    g.beginPath();
    g.arc(w * 0.72, h * 0.22, h * 0.07, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`;
      g.fillRect(Math.random() * w, Math.random() * h * 0.5, 1.5, 1.5);
    }
  } else {
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [cx, cy, r] of [[0.25, 0.2, 0.08], [0.33, 0.18, 0.1], [0.42, 0.21, 0.07], [0.78, 0.3, 0.06], [0.85, 0.28, 0.08]]) {
      g.beginPath();
      g.arc(cx * w, cy * h, r * h, 0, Math.PI * 2);
      g.fill();
    }
  }
  const houses = [[0.02, 0.18, 0.62], [0.22, 0.2, 0.55], [0.44, 0.18, 0.6], [0.64, 0.22, 0.52], [0.86, 0.17, 0.58]];
  for (const [x, hw, top] of houses) {
    const X = x * w;
    const W = hw * w;
    const T0 = top * h;
    g.fillStyle = night ? '#1a2136' : '#c9b79a';
    g.fillRect(X, T0, W, h - T0);
    g.fillStyle = night ? '#121726' : '#8b4b3a';
    g.beginPath();
    g.moveTo(X - 6, T0);
    g.lineTo(X + W / 2, T0 - h * 0.1);
    g.lineTo(X + W + 6, T0);
    g.closePath();
    g.fill();
    for (let k = 0; k < 2; k++) {
      g.fillStyle = night ? (Math.random() > 0.35 ? '#ffcf7a' : '#2a3150') : '#5c6f80';
      g.fillRect(X + W * (0.18 + k * 0.42), T0 + (h - T0) * 0.25, W * 0.22, (h - T0) * 0.22);
    }
  }
  for (let i = 0; i < 7; i++) {
    g.fillStyle = night ? '#0d1a14' : '#3f6b3a';
    g.beginPath();
    g.arc((i / 6) * w, h * 0.86, h * 0.09, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = night ? '#0a0f18' : '#6d6a63';
  g.fillRect(0, h * 0.9, w, h * 0.1);
}
const viewDay = canvasTexture(1024, 576, (g, w, h) => drawView(g, w, h, false));
const viewNight = canvasTexture(1024, 576, (g, w, h) => drawView(g, w, h, true));

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
const view = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), viewMat);
view.position.set(-1.35, 1.59, WALL_Z - 1.4);
scene.add(view);

// The learner's AI pictures replace the placeholder when the files exist (ignored until then).
const loader = new THREE.TextureLoader();
for (const [file, key] of [['window-day.jpg', 'day'], ['window-night.jpg', 'night']]) {
  loader.load(`../assets/room/${file}`, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    viewMat.uniforms[key].value = t;
  }, undefined, () => {});
}

// ── Furniture: low cabinet with the TV and VCR, side table with can and photo ──

const woodTex = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#7a5637';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(30,15,5,${0.05 + Math.random() * 0.1})`;
    g.beginPath();
    const y = Math.random() * h;
    g.moveTo(0, y);
    g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 3);
    g.stroke();
  }
});
const woodMat = std(0xffffff, 0.6, 0, { map: woodTex.texture });

const cab = new THREE.Group();
cab.name = 'cabinet';
cab.position.set(0.15, 0, -1.42);
scene.add(cab);
box(1.75, 0.5, 0.55, woodMat, 0, 0.25, 0, cab, 0.012);
box(1.77, 0.03, 0.57, woodMat, 0, 0.515, 0, cab, 0.012);
for (const dx of [-0.43, 0.43]) { // cabinet doors
  box(0.84, 0.38, 0.012, std(0x684730, 0.6), dx, 0.25, 0.28, cab);
  box(0.12, 0.018, 0.02, std(0xb8a77a, 0.3, 0.8), dx + (dx < 0 ? 0.34 : -0.34), 0.25, 0.295, cab);
}

// CRT TV: a deep body, a bezel, and the screen (the app lives here later).
const tv = new THREE.Group();
tv.name = 'tv';
tv.position.set(-0.15, 0.53, -0.02);
cab.add(tv);
const tvBody = std(0x24262c, 0.45, 0.1);
box(0.82, 0.62, 0.55, tvBody, 0, 0.31, -0.04, tv, 0.03);
box(0.6, 0.46, 0.18, tvBody, 0, 0.3, -0.38, tv, 0.03); // back hump
box(0.84, 0.64, 0.05, std(0x2d3037, 0.5, 0.1), 0, 0.31, 0.25, tv, 0.02); // front bezel
box(0.68, 0.52, 0.002, std(0x050608, 0.4), 0, 0.35, 0.2755, tv); // dark border around the glass
const tvTex = canvasTexture(640, 480, () => {});
const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.48), new THREE.MeshBasicMaterial({ map: tvTex.texture, toneMapped: false }));
screen.position.set(0, 0.35, 0.277);
tv.add(screen);
const tvSheen = new THREE.Mesh(
  new THREE.PlaneGeometry(0.64, 0.48),
  new THREE.MeshBasicMaterial({ map: sheen.texture, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
);
tvSheen.position.set(0, 0.35, 0.2785);
tv.add(tvSheen);
for (const ky of [0.47, 0.4]) { // two knobs
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 20), std(0x3f434b, 0.4, 0.6));
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.38, ky, 0.285);
  tv.add(knob);
}
for (let i = 0; i < 4; i++) box(0.5, 0.006, 0.006, std(0x111215, 0.8), 0, 0.03 + i * 0.014, 0.278, tv); // speaker grille
box(0.012, 0.012, 0.01, new THREE.MeshBasicMaterial({ color: 0xff3b3b }), 0.37, 0.04, 0.279, tv); // power LED

// The screen glows onto the room, strongest at night. A point light held in front of the glass,
// so it reaches the VCR, the cabinet top, the floor and the side table without a hot spot on
// the TV's own body.
const tvLight = new THREE.PointLight(0x6f8cff, 0, 5, 2);
tvLight.position.set(0.05, 0.95, -0.7);
scene.add(tvLight);

// VCR on the cabinet, beside the TV: the clickable object.
const VCR_Y = 0.53;
const vcr = new THREE.Group();
vcr.name = 'vcr';
vcr.position.set(0.55, VCR_Y, 0.02);
cab.add(vcr);
const vcrShell = box(0.5, 0.1, 0.36, std(0x2b2d33, 0.4, 0.25), 0, 0.05, 0, vcr, 0.012);
box(0.3, 0.025, 0.01, std(0x0c0d10, 0.3), -0.06, 0.06, 0.182, vcr); // tape slot
box(0.19, 0.02, 0.1, std(0x111111, 0.6), -0.06, 0.06, 0.2, vcr); // a tape half inserted hints "play"
for (const bx of [-0.2, -0.15, -0.1]) box(0.03, 0.012, 0.012, std(0x3a3c42, 0.4, 0.3), bx, 0.025, 0.183, vcr);
const vcrDisplay = canvasTexture(256, 64, () => {});
const vcrScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.03), new THREE.MeshBasicMaterial({ map: vcrDisplay.texture, toneMapped: false }));
vcrScreen.position.set(0.17, 0.055, 0.181);
vcr.add(vcrScreen);
const vcrLedMat = new THREE.MeshBasicMaterial({ color: 0x62ff8f, toneMapped: false });
box(0.014, 0.014, 0.01, vcrLedMat, 0.225, 0.03, 0.181, vcr);
// An invisible, more generous box so the VCR is easy to click (a Collider in Unity terms).
const vcrHit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.46), new THREE.MeshBasicMaterial({ visible: false }));
vcrHit.position.set(0, 0.09, 0.03);
vcr.add(vcrHit);
const vcrGlow = new THREE.PointLight(0x62ff8f, 0, 0.9, 2);
vcrGlow.position.set(0.7, 0.58, -1.0);
scene.add(vcrGlow);

// Photo frame on the cabinet, just left of the TV (a fixed photo; placeholder until the learner's photo arrives).
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
frame.position.set(-0.71, 0.53, 0.05);
frame.rotation.y = 0.3; // turned a little toward the camera
frame.scale.setScalar(1.12);
cab.add(frame);
box(0.16, 0.2, 0.015, std(0x2b2018, 0.5), 0, 0.1, 0, frame);
const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.17), std(0xffffff, 0.6, 0, { map: photo.texture }));
pic.position.set(0, 0.1, 0.0085);
frame.add(pic);
box(0.02, 0.18, 0.02, std(0x2b2018, 0.5), 0, 0.08, -0.05, frame).rotation.x = -0.35; // easel leg
loader.load('../assets/room/photo.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; pic.material.map = t; pic.material.needsUpdate = true; }, undefined, () => {});

// ── Lights ────────────────────────────────────────────────────────────

// One direction for everything that is "the sun": the light itself, the visible shafts and the
// disc seen in the window. It travels from the window's upper left toward the lower right.
const SUN_DIR = V(0.66, -0.4, 0.64).normalize();
const SUN_AIM = V(-0.1, 0.55, -0.9);

const hemi = new THREE.HemisphereLight(0xffffff, 0x3a2a1f, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.copy(SUN_AIM).addScaledVector(SUN_DIR, -9); // behind the wall; the light enters through the window
sun.target.position.copy(SUN_AIM);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// The sun you can see in the window (upper left), and soft shafts of light leaving the window
// along SUN_DIR. The disc is placed so it appears at the window's upper left from the home camera;
// it sits behind the wall, so it shifts a little when the camera turns, like the view does.
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
const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
  map: sunTex.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
}));
{
  const home = POSES.desktop.pos;
  const inWindow = V(fx - 0.36, fy + 0.33, WALL_Z); // where the sun should appear inside the opening
  const k = (WALL_Z - 1.0 - home.z) / (inWindow.z - home.z);
  sunDisc.position.copy(home).addScaledVector(inWindow.clone().sub(home), k);
}
scene.add(sunDisc);

// One soft ribbon per shaft: bright in the middle, fading at the sides, at the window end and at
// the far end. (The canvas is drawn bottom-up because texture rows run upward.)
const shaftTex = canvasTexture(64, 256, (g, w, h) => {
  const img = g.createImageData(w, h);
  const ease = (lo, hi, x) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < h; y++) {
    const along = 1 - y / (h - 1); // 0 at the window end, 1 at the far end
    const lengthwise = ease(0, 0.12, along) * (1 - ease(0.4, 1, along));
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
const SHAFTS = [ // start inside the window (metres from its centre), width, length, strength, breathing phase
  { u: -0.38, v: 0.3, w: 0.2, len: 2.0, k: 1.0, ph: 0 },
  { u: -0.16, v: 0.14, w: 0.15, len: 1.8, k: 0.85, ph: 1.7 },
  { u: 0.08, v: -0.02, w: 0.24, len: 1.9, k: 0.9, ph: 3.1 },
  { u: -0.4, v: -0.14, w: 0.12, len: 1.5, k: 0.6, ph: 4.4 },
  { u: 0.28, v: -0.24, w: 0.16, len: 1.5, k: 0.6, ph: 5.6 },
];
const shafts = SHAFTS.map((d) => {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0); // the ribbon grows from its start point along +Y
  const mat = new THREE.MeshBasicMaterial({
    map: shaftTex.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide, opacity: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(fx + d.u, fy + d.v, WALL_Z + 0.06);
  mesh.scale.set(d.w, d.len, 1);
  mesh.renderOrder = 2;
  scene.add(mesh);
  return { ...d, mesh, mat };
});
const _n = V(0, 0, 0);
const _x = V(0, 0, 0);
const _basis = new THREE.Matrix4();
function aimShaft(mesh) {
  // Turn the ribbon around its own axis (the light direction) so its flat side faces the camera.
  _n.copy(camera.position).sub(mesh.position);
  _n.addScaledVector(SUN_DIR, -_n.dot(SUN_DIR)).normalize();
  _x.crossVectors(SUN_DIR, _n).normalize();
  _basis.makeBasis(_x, SUN_DIR, _n);
  mesh.quaternion.setFromRotationMatrix(_basis);
}

// Time of day (prd.md > Look and Feel): four periods by the visitor's local hour, plus ?time=.
const PERIODS = {
  morning: { sun: 0xffbc78, sunI: 2.2, sky: 0xffd4a8, ground: 0x6b5644, hemiI: 0.95, env: 0.4, glow: 0xffc590, glowO: 0.5, night: 0, tint: [1.1, 0.95, 0.8], tv: 0.3, exposure: 0.97, disc: 0xffc880, discSize: 1.0, beam: 0xffd9a0, beamO: 0.3 },
  day: { sun: 0xfff6e6, sunI: 3.0, sky: 0xe6f1ff, ground: 0x7a6a58, hemiI: 1.25, env: 0.7, glow: 0xffffff, glowO: 0.3, night: 0, tint: [1, 1, 1], tv: 0.15, exposure: 0.95, disc: 0xfff6dc, discSize: 0.85, beam: 0xfff2cc, beamO: 0.24 },
  afternoon: { sun: 0xff7a2a, sunI: 3.0, sky: 0xff9a55, ground: 0x6b3a22, hemiI: 1.0, env: 0.18, glow: 0xff8a3a, glowO: 0.7, night: 0.15, tint: [1.2, 0.75, 0.5], tv: 0.4, exposure: 1.05, disc: 0xff8a2a, discSize: 1.25, beam: 0xff9a40, beamO: 0.42 },
  night: { sun: 0x8fa8ff, sunI: 0.9, sky: 0x4a66b8, ground: 0x151b30, hemiI: 0.6, env: 0.1, glow: 0x6f8cff, glowO: 0.18, night: 1, tint: [0.4, 0.5, 0.8], tv: 2.5, exposure: 1.1, disc: 0xcfe0ff, discSize: 0.5, beam: 0x8fa8ff, beamO: 0.09 },
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
const A = {}; // what is on screen right now
const C = Object.fromEntries(COL.map((c) => [c, new THREE.Color()]));
const T = { name: '', num: {}, col: Object.fromEntries(COL.map((c) => [c, new THREE.Color()])) };

function setTarget(name) {
  const p = PERIODS[name];
  T.name = name;
  for (const n of NUM) T.num[n] = p[n];
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
for (const c of COL) C[c].copy(T.col[c]);

// ── The TV screen: standby status, then the shelf after the VCR is clicked ──

const KEY = 'pausetape.tapes.v1'; // the app's own storage key, so the mockup shows real tapes
function tapeStatus() {
  let tapes = [];
  try { tapes = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { tapes = []; }
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ready = tapes.filter((t) => t && t.backOnItMinutes == null && t.returnDate <= today).length;
  return { total: tapes.length, ready };
}
// With no tapes in this browser the mockup shows a demo state instead.
const status = (() => { const s = tapeStatus(); return s.total ? s : { total: 2, ready: 1 }; })();

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

function drawScreen(t) {
  const g = tvTex.canvas.getContext('2d');
  const w = tvTex.canvas.width;
  const h = tvTex.canvas.height;
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
  } else {
    g.fillStyle = '#070b14';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9dee8';
    g.font = '36px VT323, monospace';
    g.textAlign = 'left';
    g.fillText('PAUSE TAPE', 36, 56);
    g.textAlign = 'right';
    g.fillText('SHELF', w - 36, 56);
    const tapes = [['TES AJA', 'READY', '#62ff8f'], ['NO SIGNAL', '101 DAYS', '#6b7280']];
    tapes.forEach(([name, st, col], i) => {
      const x = 36 + i * 290;
      g.fillStyle = '#171a21';
      g.fillRect(x, 92, 260, 170);
      g.fillStyle = '#d3cdbd';
      g.fillRect(x + 14, 106, 232, 96);
      g.fillStyle = col;
      g.fillRect(x + 14, 106, 6, 96);
      g.fillStyle = '#1a1a1e';
      g.textAlign = 'left';
      g.font = '32px VT323, monospace';
      g.fillText(name, x + 32, 140);
      g.fillStyle = '#0b0e0c';
      g.fillRect(x + 30, 156, 130, 34);
      g.fillStyle = col;
      g.font = '28px VT323, monospace';
      g.fillText(st, x + 38, 182);
      g.fillStyle = '#07080b';
      g.fillRect(x + 14, 212, 232, 38);
    });
    recDot(g, 48, h - 44, 10, '#ff3b3b');
    g.fillStyle = '#ff3b3b';
    g.font = '32px VT323, monospace';
    g.textAlign = 'left';
    g.fillText('REC', 68, h - 34);
  }
  g.fillStyle = 'rgba(0,0,0,0.22)'; // scanlines
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
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
  g.fillText(tvMode === 'standby' ? `${String(d.getHours()).padStart(2, '0')}${colon}${String(d.getMinutes()).padStart(2, '0')}` : 'PLAY', c.width / 2, 48);
  vcrDisplay.texture.needsUpdate = true;
}

// ── Mouse: camera turn, hover and click on the VCR (Physics.Raycast) ──

const pointer = new THREE.Vector2(0, 0);
const aim = new THREE.Vector2(0, 0); // the eased pointer the camera follows
let hasPointer = false;
const raycaster = new THREE.Raycaster();
const vcrTargets = [];
vcr.traverse((o) => { if (o.isMesh) vcrTargets.push(o); });
let pressT = 1;

function toggleTv() {
  tvMode = tvMode === 'standby' ? 'shelf' : 'standby';
  pressT = 0;
  hint.textContent = tvMode === 'shelf' ? '< BACK TO THE ROOM' : 'CLICK THE VCR';
  hint.classList.toggle('is-button', tvMode === 'shelf');
  document.body.classList.toggle('zoomed', tvMode === 'shelf');
}

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  hasPointer = true;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});
renderer.domElement.addEventListener('click', (e) => {
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (raycaster.intersectObjects(vcrTargets, false).length) toggleTv();
});
hint.addEventListener('click', () => { if (tvMode === 'shelf') toggleTv(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tvMode === 'shelf') toggleTv(); });

// ── Panel: time switch and hide ───────────────────────────────────────

const panel = document.querySelector('[data-panel]');
const clock = document.querySelector('[data-clock]');
function syncButtons() {
  for (const b of panel.querySelectorAll('[data-time]')) b.setAttribute('aria-pressed', String(b.dataset.time === mode));
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
  if (e.target.closest('[data-toggle]')) {
    panel.classList.toggle('is-hidden');
    e.target.textContent = panel.classList.contains('is-hidden') ? 'SHOW' : 'HIDE';
  }
});
syncButtons();
if (innerWidth < 700) { // on a phone the panel starts folded so it doesn't cover the room
  panel.classList.add('is-hidden');
  panel.querySelector('[data-toggle]').textContent = 'SHOW';
}

// ── Resize and the loop (Update) ──────────────────────────────────────

// Wide enough that the window, the TV, the VCR and the table all fit, whatever the window's
// shape; on a phone the camera frames the TV and VCR only.
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  wide = aspect < 0.9 ? POSES.portrait : POSES.desktop;
  const dist = wide.pos.distanceTo(wide.look);
  const need = aspect < 0.9 ? 2.1 : 3.0;
  camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(need / 2 / dist / aspect)), 38, 70);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
const k = (rate, dt) => 1 - Math.exp(-rate * dt);
const Y_AXIS = V(0, 1, 0);
const camPos = V(0, 0, 0);
const camLook = V(0, 0, 0);
const offset = V(0, 0, 0);
const origin = V(0, 0, 0);
let zoom = 0;

renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();

  // Camera: eases between the room and the TV, and turns a little toward the cursor.
  // Still with reduced motion or on touch (no cursor).
  zoom += ((tvMode === 'shelf' ? 1 : 0) - zoom) * k(reduced.matches ? 30 : 2.6, dt);
  const z = zoom * zoom * (3 - 2 * zoom);
  camPos.lerpVectors(wide.pos, POSES.tv.pos, z);
  camLook.lerpVectors(wide.look, POSES.tv.look, z);
  const still = reduced.matches || !hasPointer;
  aim.lerp(still ? origin.set(0, 0, 0) : pointer, k(3, dt));
  const amount = 1 - 0.6 * z;
  offset.copy(camPos).sub(camLook).applyAxisAngle(Y_AXIS, aim.x * 0.16 * amount);
  offset.y += aim.y * 0.12 * amount;
  camera.position.copy(camLook).add(offset);
  camera.lookAt(camLook);

  // Light glides toward the current period over a few seconds, like the sky changing.
  if (T.name !== currentName()) setTarget(currentName());
  const s = k(1.5, dt);
  for (const n of NUM) A[n] += (T.num[n] - A[n]) * s;
  for (const c of COL) C[c].lerp(T.col[c], s);
  sun.color.copy(C.sun);
  sun.intensity = A.sunI;
  hemi.color.copy(C.sky);
  hemi.groundColor.copy(C.ground);
  hemi.intensity = A.hemiI;
  scene.environmentIntensity = A.env;
  glowMat.color.copy(C.glow);
  glowMat.opacity = A.glowO;
  viewMat.uniforms.mixNight.value = A.night;
  viewMat.uniforms.tint.value.copy(C.tint);
  renderer.toneMappingExposure = A.exposure;
  const flick = reduced.matches ? 0 : Math.sin(t * 7.3) * 0.04 + Math.sin(t * 2.1) * 0.03; // a live picture flickers
  tvLight.intensity = A.tv * (1 + flick);
  tvLight.color.set(tvMode === 'standby' ? 0x5a74ff : 0x9fb0d8);

  // The visible sun and its shafts; both fade when the camera is close to the TV so they never cover the screen.
  sunDisc.material.color.copy(C.disc);
  sunDisc.scale.setScalar(A.discSize);
  const shaftBase = A.beamO * (1 - 0.92 * z);
  for (const d of shafts) {
    aimShaft(d.mesh);
    d.mat.color.copy(C.beam);
    d.mat.opacity = shaftBase * d.k * (reduced.matches ? 1 : 0.88 + 0.12 * Math.sin(t * 0.55 + d.ph));
  }

  // VCR: glows green when a tape is due; hover lifts the glow; a click presses it down.
  raycaster.setFromCamera(pointer, camera);
  const hovering = hasPointer && raycaster.intersectObjects(vcrTargets, false).length > 0;
  renderer.domElement.style.cursor = hovering ? 'pointer' : 'default';
  const due = status.ready > 0;
  const pulse = due && !reduced.matches ? 0.75 + 0.25 * Math.sin(t * 2.4) : 1;
  vcrLedMat.color.set(due ? 0x62ff8f : 0x3a3c42).multiplyScalar(pulse);
  vcrGlow.intensity = (due ? 0.06 : 0) + (hovering ? 0.06 : 0);
  vcrShell.material.emissive.set(hovering ? 0x0d2216 : 0x000000);
  pressT = Math.min(1, pressT + dt * 6);
  vcr.position.y = VCR_Y - Math.sin(pressT * Math.PI) * 0.006;

  drawScreen(t);
  drawVcrDisplay(t);
  clock.textContent = `${mode === 'auto' ? 'AUTO · ' : ''}${T.name.toUpperCase()} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  renderer.render(scene, camera);
});

// For the automated checks.
const points = { vcr: vcrShell, screen, frame: pic };
const _p = V(0, 0, 0);
function toPixels(v) {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
}
function project(obj, dx = 0) {
  obj.localToWorld(_p.set(dx, 0, 0)).project(camera);
  return { x: ((_p.x + 1) / 2) * innerWidth, y: ((1 - _p.y) / 2) * innerHeight, ndcX: _p.x, ndcY: _p.y };
}
window.__room = {
  camera,
  vcrTargets,
  status,
  getMode: () => tvMode,
  getPeriod: () => T.name,
  project: (name) => project(points[name]),
  screenWidthPx: () => Math.abs(project(screen, 0.32).x - project(screen, -0.32).x),
  has: (name) => Boolean(scene.getObjectByName(name)),
  strayObjects: () => {
    const box = new THREE.Box3();
    const found = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      box.setFromObject(o);
      if (box.min.x > 1.05 && box.max.y < 1.0) found.push(o.name || o.geometry.type);
    });
    return found;
  },
  worldPos: (name) => scene.getObjectByName(name).getWorldPosition(V(0, 0, 0)).toArray(),
  sunDir: SUN_DIR.toArray(),
  lightDir: () => sun.target.position.clone().sub(sun.position).normalize().toArray(),
  sunDiscPx: () => toPixels(sunDisc.position),
  windowRect: () => {
    const a = toPixels(V(fx - WIN.w / 2, fy + WIN.h / 2, WALL_Z));
    const b = toPixels(V(fx + WIN.w / 2, fy - WIN.h / 2, WALL_Z));
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  },
  shaftLine: (i = 1, from = 0.15, to = 0.6) => {
    const d = shafts[i];
    const at = (f) => toPixels(d.mesh.position.clone().addScaledVector(SUN_DIR, d.len * f));
    return { from: at(from), to: at(to) };
  },
  setShafts: (on) => { for (const d of shafts) d.mesh.visible = on; },
  shaftOpacity: () => shafts[0].mat.opacity,
};
