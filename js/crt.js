// CRT layer: a three.js fullscreen shader drawn over the TV screen, like a URP fullscreen
// pass. It adds moving grain, a rolling VHS tracking band, chroma fringes, scanlines, a
// vignette, and glass glare. Its strength follows --vhs, the same number VHSDriver would set.
// The canvas never takes clicks (pointer-events: none), so the HTML underneath stays usable.
// If WebGL is missing or fails, the app simply keeps the CSS layer (css/vhs.css).

// three.js is loaded only after WebGL is confirmed, so a browser without it never fetches
// the library and never logs WebGL errors.
function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    return false;
  }
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Everything the screen needs is drawn as light over the HTML: the canvas is transparent,
// and alpha says how much each effect covers the page.
const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uVhs;      // 0 = calm, 1 = full playback strength
  uniform float uMotion;   // 0 with reduced motion: no grain flicker, no rolling band
  uniform vec2 uRes;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }

  void main() {
    vec2 uv = vUv;
    vec2 px = uv * uRes;
    float t = uTime * uMotion;
    float v = clamp(uVhs, 0.0, 1.0);

    // Scanlines: one dark line every 3 device pixels, stronger with --vhs.
    float line = step(1.5, mod(px.y, 3.0));
    float scan = (1.0 - line) * (0.10 + 0.22 * v);

    // Grain: fresh noise every frame (still noise when motion is reduced).
    float grain = hash(floor(px / 1.5) + floor(t * 24.0)) - 0.5;
    float grainA = abs(grain) * (0.05 + 0.13 * v);

    // VHS tracking band: a soft bright band rolling slowly up the screen.
    float bandY = fract(t * 0.07);
    float d = abs(uv.y - bandY);
    d = min(d, 1.0 - d);
    float band = (1.0 - smoothstep(0.0, 0.045, d)) * (0.04 + 0.12 * v) * uMotion;
    float bandNoise = band * (0.6 + 0.8 * hash(vec2(floor(px.y / 2.0), floor(t * 30.0))));

    // Chroma fringe: red on the left edge of the screen, blue on the right, like a worn tape.
    float edge = smoothstep(0.30, 0.50, abs(uv.x - 0.5));
    vec3 fringe = mix(vec3(0.0, 0.35, 1.0), vec3(1.0, 0.18, 0.18), step(uv.x, 0.5));
    float fringeA = edge * (0.03 + 0.07 * v);

    // Vignette: darker corners, like the curve of the tube.
    vec2 c = uv - 0.5;
    float vig = smoothstep(0.32, 0.78, length(c * vec2(1.0, 1.15)));
    float vigA = vig * (0.35 + 0.25 * v);

    // Glass glare: a faint diagonal sheen in the top left.
    float glare = (1.0 - smoothstep(0.0, 0.55, length((uv - vec2(0.18, 0.86)) * vec2(1.0, 1.6)))) * 0.05;

    // Slow, soft flicker: several seconds per cycle, small amplitude, never blinking.
    float flicker = (0.5 + 0.5 * sin(t * 1.3)) * 0.025 * v * uMotion;

    // Combine three layers with the standard "over" rule, bottom to top:
    // darkening (scanlines, vignette, dark grain, flicker), colored fringe, then light.
    float darkA = clamp(max(scan, vigA) + flicker + max(-grain, 0.0) * grainA * 2.0, 0.0, 0.9);
    vec3 col = vec3(0.0);
    float a = darkA;

    col = (fringe * fringeA + col * a * (1.0 - fringeA)) / max(fringeA + a * (1.0 - fringeA), 0.0001);
    a = fringeA + a * (1.0 - fringeA);

    vec3 light = vec3(0.86, 0.90, 1.0);
    float lightA = clamp(max(grain, 0.0) * grainA * 2.0 + bandNoise + glare, 0.0, 0.6);
    col = (light * lightA + col * a * (1.0 - lightA)) / max(lightA + a * (1.0 - lightA), 0.0001);
    a = lightA + a * (1.0 - lightA);

    gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
  }
`;

export async function startCrt(screenEl, { getVhs, reducedMotion }) {
  if (!webglAvailable()) return null; // No WebGL: keep the CSS layer.
  let THREE;
  let renderer;
  try {
    THREE = await import('../assets/vendor/three.module.min.js');
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  } catch {
    return null; // The library or the GPU failed: keep the CSS layer.
  }
  const { Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, Vector2 } = THREE;
  const canvas = renderer.domElement;
  canvas.className = 'crt';
  canvas.setAttribute('aria-hidden', 'true');
  screenEl.append(canvas);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uTime: { value: 0 },
    uVhs: { value: getVhs() },
    uMotion: { value: reducedMotion() ? 0 : 1 },
    uRes: { value: new Vector2(1, 1) },
  };
  const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true, depthTest: false });
  // One oversized triangle covers the whole screen, so there's no seam where two triangles meet.
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);

  function resize() {
    const r = screenEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)), false);
    uniforms.uRes.value.set(Math.round(r.width * dpr), Math.round(r.height * dpr));
  }
  new ResizeObserver(resize).observe(screenEl);
  resize();

  // The --vhs value glides instead of jumping, so a screen change feels like the signal settling.
  let shown = getVhs();
  const start = performance.now();
  renderer.setAnimationLoop(() => {
    shown += (getVhs() - shown) * 0.08;
    uniforms.uVhs.value = shown;
    uniforms.uMotion.value = reducedMotion() ? 0 : 1;
    uniforms.uTime.value = (performance.now() - start) / 1000;
    renderer.render(scene, camera);
  });

  // If the GPU drops the context, hide the canvas and let the CSS layer carry on.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    canvas.remove();
    document.documentElement.classList.remove('has-crt');
  });

  document.documentElement.classList.add('has-crt');
  return { renderer, uniforms };
}
