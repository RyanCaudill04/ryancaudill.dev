// The stage: one WebGL canvas, pinned to the screen, that draws the server
// wherever the page says it should be.
//
// The page marks two "slots" (the hero's and the hardware section's). Each
// frame this reads where they are on screen and how far the page has
// scrolled, works out where the model sits, how it's turned and how far
// apart its layers are, and draws it. Dragging turns it by hand.

import * as THREE from '../vendor/three.module.min.js';
import { buildStack } from './model.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
/** Moves cur toward target at the same pace whatever the frame rate. */
const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));

const CAMERA_FOV = 26;
const CAMERA_DISTANCE = 430; // mm; about how far you'd hold a board to look at it

// How the model is shown at each point of the page.
//   yaw, tilt   radians: turned about its vertical axis, then tipped toward the camera
//   at          the point of the model (mm) held at the centre of its slot
//   fit         the radius (mm) around that point that has to fit in the slot
//   open, lift, clear, bare   how far apart the layers are; see model.js pose()
const VIEWS = {
  hero: { yaw: -0.62, tilt: 0.6, at: [42.5, 9, 28], fit: 50, open: 0, lift: 0, clear: 0, bare: 0 },
  about: { yaw: -0.2, tilt: 0.72, at: [42.5, 9, 28], fit: 50, open: 0, lift: 0, clear: 0, bare: 0 },
  closed: { yaw: -0.5, tilt: 0.42, at: [42.5, 9, 28], fit: 54, open: 0, lift: 0, clear: 0, bare: 0 },
  peek: { tilt: 0.4, at: [40, 30, 28], fit: 64, open: 0.86 }, // laid over hero or about when clicked open
  open: { yaw: -0.56, tilt: 0.34, at: [40, 33, 28], fit: 68, open: 1, lift: 0, clear: 0, bare: 0 },
  ssd: { yaw: -0.86, tilt: 0.48, at: [35, 45, 27], fit: 55, open: 1, lift: 1, clear: 0, bare: 0 },
  hat: { yaw: -0.32, tilt: 0.52, at: [38, 34, 28], fit: 62, open: 1, lift: 0, clear: 0, bare: 0 },
  cooler: { yaw: -0.4, tilt: 0.72, at: [42.5, 9, 28], fit: 54, open: 1, lift: 0, clear: 1, bare: 0 },
  pi: { yaw: -0.52, tilt: 0.8, at: [42.5, 4, 28], fit: 54, open: 1, lift: 0, clear: 1, bare: 1 },
};
// The hardware section's scroll, 0..1: the stack opens over the first
// stretch, each layer gets an equal share, and it closes over the last.
const OPENED = 0.13;
const CLOSING = 0.93;

function mix(a, b, t) {
  const out = {};
  for (const k in a) out[k] = k === 'at' ? a.at.map((v, i) => lerp(v, b.at[i], t)) : lerp(a[k], b[k], t);
  return out;
}

/** Studio lighting as an environment map: a dark room with a few soft
 *  panels, which is what the metal parts reflect. */
function studio(renderer) {
  const room = new THREE.Scene();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.21, 0.23), side: THREE.BackSide }));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.05, 0.04), side: THREE.DoubleSide }));
  floor.rotation.x = Math.PI / 2;
  floor.position.y = -5.9;
  room.add(walls, floor);
  const panel = (colour, power, w, h, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    room.add(m);
  };
  panel(0xffffff, 1.5, 7, 7, 0, 5.8, 1); // overhead softbox
  panel(0xffe6cc, 3.2, 3, 8, -5.8, 1.5, 2); // warm strip, left
  panel(0xd4e6ff, 3.2, 3, 8, 5.8, 1, -1.5); // cool strip, right
  panel(0xffffff, 1.4, 9, 3, 0, 1, 5.8); // fill from the front
  panel(0xffffff, 2.6, 9, 3, 0, 2.5, -5.8); // rim from behind
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.035).texture;
  pmrem.dispose();
  return texture;
}

/**
 * Starts drawing. els holds the page's elements:
 *   stage, view, canvas, glow       the pinned stage and what's in it
 *   lines, lead, ring, dot          the annotation line, an SVG over the canvas
 *   heroSlot, intro                 the hero's slot and the block it's pinned through
 *   teardown, teardownSlot          the hardware section and its slot (may be null)
 *   cards, steps                    the hardware cards and their buttons
 *   caption, hint                   the hero's caption, and the "drag to turn" note in it
 * Throws if WebGL isn't available.
 */
export async function startStage(els, { drive = '2230', still = false } = {}) {
  const { canvas, view } = els;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

  // The silkscreen is set in the page's fonts, so wait for them (briefly).
  await Promise.race([
    Promise.all([document.fonts.load('700 20px Inter'), document.fonts.load('500 20px "JetBrains Mono"')]),
    new Promise((done) => setTimeout(done, 1500)),
  ]).catch(() => {});

  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const model = buildStack(renderer, { drive, detail: small ? 16 : 24 });

  const scene = new THREE.Scene();
  scene.environment = studio(renderer);
  scene.environmentIntensity = 0.6;
  // The boards take less of the room than the metal does: a glossy mask
  // under a softbox goes pale, and these should stay a deep green.
  model.root.traverse((o) => {
    if (!o.material?.isMeshPhysicalMaterial) return;
    o.material.envMap = scene.environment;
    o.material.envMapIntensity = 0.32;
  });

  const key = new THREE.DirectionalLight(0xfff2e2, 3.2);
  key.position.set(-150, 300, 190);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -105, right: 105, top: 105, bottom: -105, near: 100, far: 800 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.12;
  key.shadow.radius = 3;
  const rim = new THREE.DirectionalLight(0xbcd6ff, 1.1);
  rim.position.set(180, 120, -220);
  scene.add(key, rim);

  // pivot turns the model; stack slides it so the point of interest is at
  // the pivot.
  const pivot = new THREE.Group();
  const stack = new THREE.Group();
  stack.add(model.root);
  pivot.add(stack);
  scene.add(pivot);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 60, 1400);
  camera.position.set(0, 0, CAMERA_DISTANCE);

  const parts = els.cards.map((c) => c.dataset.part);
  const share = parts.length ? (CLOSING - OPENED) / parts.length : 0;

  // What the model is doing now, eased toward what the page asks for.
  const now = mix(VIEWS.hero, VIEWS.hero, 0);
  const spot = { x: 0, y: 0, size: 0, set: false };
  const hand = { yaw: 0, tilt: 0, vyaw: 0, vtilt: 0, drag: null, idle: 10 };
  const lean = { x: 0, y: 0, tx: 0, ty: 0 };
  let width = 0;
  let height = 0;
  let active = -1;
  let visible = true;
  let age = 0; // seconds since the first frame, for the switch-on
  let spinning = 0;
  let peek = false; // opened in place by a click, outside the hardware section
  let scrolled = 0; // how far the page had scrolled last frame

  /** Reads the page: where the slots are and how far each part has scrolled. */
  function measure() {
    const vr = view.getBoundingClientRect();
    const vh = window.innerHeight;
    const box = (r) => ({ x: r.left + r.width / 2 - vr.left, y: r.top + r.height / 2 - vr.top, size: Math.min(r.width, r.height) });
    const hr = els.heroSlot.getBoundingClientRect();
    const ir = els.intro.getBoundingClientRect();
    const state = { vr, a: box(hr), b: null, blend: 0, intro: clamp(-ir.top / Math.max(1, ir.height - vh)), t: 0, card: null };
    state.b = state.a;
    if (els.teardown) {
      const sr = els.teardown.getBoundingClientRect();
      state.b = box(els.teardownSlot.getBoundingClientRect());
      // The model crosses from one slot to the other as the hardware
      // section rises into view. If the hero's slot has already scrolled
      // away (it isn't pinned on a phone), there's nothing to cross from.
      state.blend = hr.bottom <= 0 ? 1 : clamp((vh - sr.top) / vh);
      state.t = clamp(-sr.top / Math.max(1, sr.height - vh));
      state.pinned = sr.top <= 1 && sr.bottom >= vh - 1;
      if (active >= 0) state.card = els.cards[active].getBoundingClientRect();
    }
    return state;
  }

  /** The view the page is asking for, and which card goes with it. */
  function wanted(s) {
    if (s.t <= 0) {
      const view = mix(mix(VIEWS.hero, VIEWS.about, smooth(s.intro)), VIEWS.closed, smooth(s.blend));
      return { view: peek ? { ...view, ...VIEWS.peek } : view, step: -1, scrub: !peek };
    }
    if (s.t < OPENED) return { view: mix(VIEWS.closed, VIEWS.open, smooth(s.t / OPENED)), step: s.t > OPENED * 0.5 ? 0 : -1, scrub: true };
    const last = parts.length - 1;
    if (s.t >= CLOSING) return { view: mix(VIEWS[parts[last]], VIEWS.closed, smooth((s.t - CLOSING) / (1 - CLOSING))), step: last, scrub: true };
    const step = clamp(Math.floor((s.t - OPENED) / share), 0, last);
    return { view: VIEWS[parts[step]], step, scrub: false };
  }

  function setActive(step, on) {
    if (step !== active) {
      active = step;
      els.cards.forEach((c, i) => c.classList.toggle('is-active', i === step));
      els.steps.forEach((b, i) => (i === step ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
      els.lines.classList.remove('is-on'); // redraw the line for the new part
      return;
    }
    els.lines.classList.toggle('is-on', on);
  }

  const anchor = new THREE.Vector3();
  /** Draws the annotation: a line with one 45° bend, from the card to its part. */
  function annotate(s, part) {
    model.anchors[part].getWorldPosition(anchor).project(camera);
    const ax = (anchor.x * 0.5 + 0.5) * width;
    const ay = (-anchor.y * 0.5 + 0.5) * height;
    const card = s.card;
    let d;
    let sx;
    let sy;
    if (card.left - s.vr.left > ax + 48) {
      // The card is beside the model: run level, then angle to the part.
      sx = card.left - s.vr.left - 14;
      sy = card.top - s.vr.top + 38;
      const run = Math.max(28, sx - ax - Math.abs(sy - ay));
      const rest = sx - run - ax;
      d = `M${sx} ${sy}H${sx - run}L${ax} ${sy + Math.sign(ay - sy) * rest}V${ay}`;
    } else {
      // The card is under the model: run up, then angle across.
      sx = card.left - s.vr.left + 30;
      sy = card.top - s.vr.top - 12;
      const run = Math.max(18, sy - ay - Math.abs(sx - ax));
      const rest = sy - run - ay;
      d = `M${sx} ${sy}V${sy - run}L${sx + Math.sign(ax - sx) * rest} ${ay}H${ax}`;
    }
    els.lead.setAttribute('d', d);
    els.ring.setAttribute('cx', ax);
    els.ring.setAttribute('cy', ay);
    els.dot.setAttribute('cx', sx);
    els.dot.setAttribute('cy', sy);
  }

  function frame(dt, elapsed = dt) {
    const s = measure();
    if (s.vr.width !== width || s.vr.height !== height) {
      width = s.vr.width;
      height = s.vr.height;
      renderer.setSize(width, height, false);
    }
    if (!width || !height) return;
    age += elapsed;

    // Ease toward the view the page wants. While the page is scrubbing
    // (the model follows the scroll directly) keep up with it closely.
    const want = wanted(s);
    const rate = still ? 60 : want.scrub ? 9 : 3.6;
    for (const k of ['yaw', 'tilt', 'fit', 'open', 'lift', 'clear', 'bare']) now[k] = damp(now[k], want.view[k], rate, dt);
    now.at = now.at.map((v, i) => damp(v, want.view.at[i], rate, dt));

    // Where on the canvas: between the two slots, level with the scroll.
    // It moves across early in the crossing, clear of the incoming text.
    const e = smooth(clamp(s.blend * 1.5));
    const x = lerp(s.a.x, s.b.x, e);
    const y = lerp(s.a.y, s.b.y, s.blend);
    const size = lerp(s.a.size, s.b.size, e);
    if (els.caption) els.caption.style.opacity = 1 - clamp(s.blend * 5);
    if (!spot.set) Object.assign(spot, { x, y, size, set: true });
    spot.x = damp(spot.x, x, 14, dt);
    spot.y = y; // straight from the page, so it never lags the scroll
    spot.size = damp(spot.size, size, 14, dt);

    // The hand: a drag turns it, a flick keeps it turning. It stays where
    // it's left for a few seconds, or until the page scrolls on, then
    // settles back to where the page had it.
    const moved = Math.abs(window.scrollY - scrolled) > 0.5;
    scrolled = window.scrollY;
    if (s.blend > 0.5) peek = false;
    hand.idle += dt;
    if (!hand.drag) {
      hand.yaw += hand.vyaw * dt;
      hand.tilt = clamp(hand.tilt + hand.vtilt * dt, -1.7, 1.0);
      hand.vyaw *= Math.exp(-2.6 * dt);
      hand.vtilt *= Math.exp(-5 * dt);
      if (hand.idle > (moved ? 0.3 : 5)) {
        hand.yaw = Math.atan2(Math.sin(hand.yaw), Math.cos(hand.yaw)); // the short way round
        hand.yaw = damp(hand.yaw, 0, moved ? 4 : 1.4, dt);
        hand.tilt = damp(hand.tilt, 0, moved ? 4 : 1.4, dt);
      }
    }
    if (spinning > 0) {
      spinning -= dt;
      hand.vyaw = 7;
      hand.idle = 0;
    }
    lean.x = damp(lean.x, hand.drag || still ? 0 : lean.tx, 3, dt);
    lean.y = damp(lean.y, hand.drag || still ? 0 : lean.ty, 3, dt);

    // The switch-on: it arrives turning, slightly apart, and settles.
    const arrive = still ? 0 : 1 - smooth(clamp(age / 2.2));
    const drift = still ? 0 : 1;
    const yaw = now.yaw + hand.yaw + lean.x * 0.16 - arrive * 1.1 + Math.sin(age * 0.33) * 0.05 * drift;
    const tilt = now.tilt + hand.tilt + lean.y * 0.09 + arrive * 0.1 + Math.sin(age * 0.27 + 1) * 0.018 * drift;
    pivot.rotation.set(tilt, yaw, 0, 'XYZ');
    pivot.position.y = Math.sin(age * 0.9) * 0.9 * drift;
    stack.position.set(-now.at[0], -now.at[1], -now.at[2]);
    model.pose(Math.max(now.open, arrive * 0.32), now.lift, now.clear, now.bare);
    model.tick(age, still ? 1 : clamp((age - 1.1) / 0.7), still);

    // Frame it: zoom so `fit` millimetres span half the slot, then shift
    // the picture so the model's centre lands on the slot's.
    const perPx = (2 * CAMERA_DISTANCE * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2))) / height;
    // On a small screen the hardware section's slot is short and wide, and
    // the open stack is tall, so give it more room there.
    const room = (1 + arrive * 0.1) * (small ? lerp(1, 1.14, s.blend) : 1);
    camera.zoom = (spot.size * 0.5 * perPx) / (now.fit * room);
    camera.aspect = width / height;
    camera.setViewOffset(width, height, width / 2 - spot.x, height / 2 - spot.y, width, height);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    els.glow.style.transform = `translate(${spot.x}px, ${spot.y}px) scale(${(spot.size * 1.5) / 100})`;

    const lineOn = want.step >= 0 && !want.scrub && s.pinned && now.open > 0.9;
    setActive(want.step, lineOn);
    if (active >= 0 && s.card && s.pinned) annotate(s, parts[active]);
  }

  // --- The hand ---------------------------------------------------------
  const over = (e) => {
    const r = canvas.getBoundingClientRect();
    return Math.hypot(e.clientX - r.left - spot.x, e.clientY - r.top - spot.y) < spot.size * 0.5;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !over(e)) return;
    e.preventDefault(); // a drag on the model shouldn't start selecting the text beside it
    hand.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), from: [e.clientX, e.clientY, performance.now()] };
    hand.vyaw = hand.vtilt = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
    els.hint?.classList.add('is-done');
  });
  canvas.addEventListener('pointermove', (e) => {
    lean.tx = e.clientX / window.innerWidth - 0.5;
    lean.ty = e.clientY / window.innerHeight - 0.5;
    const d = hand.drag;
    if (!d || d.id !== e.pointerId) {
      canvas.classList.toggle('is-over', over(e));
      return;
    }
    const t = performance.now();
    const dt = Math.max(0.008, (t - d.t) / 1000);
    const dyaw = (e.clientX - d.x) * 0.0085;
    const dtilt = (e.clientY - d.y) * 0.006;
    hand.yaw += dyaw;
    hand.tilt = clamp(hand.tilt + dtilt, -1.7, 1.0);
    hand.vyaw = lerp(hand.vyaw, dyaw / dt, 0.4);
    hand.vtilt = lerp(hand.vtilt, dtilt / dt, 0.4);
    hand.idle = 0;
    Object.assign(d, { x: e.clientX, y: e.clientY, t });
  });
  const release = (e) => {
    if (!hand.drag || hand.drag.id !== e.pointerId) return;
    if (performance.now() - hand.drag.t > 80) hand.vyaw = hand.vtilt = 0; // held still, then let go
    // A press that didn't go anywhere is a click: open the stack where it
    // is, or close it again.
    const [x0, y0, t0] = hand.drag.from;
    if (e.type === 'pointerup' && Math.hypot(e.clientX - x0, e.clientY - y0) < 6 && performance.now() - t0 < 400 && active < 0) peek = !peek;
    hand.drag = null;
    hand.idle = 0;
    canvas.classList.remove('is-dragging');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { lean.tx = lean.ty = 0; canvas.classList.remove('is-over'); });
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) lean.tx = lean.ty = 0;

  // --- The steps under the cards scroll to their layer -------------------
  const scrollToShare = (at) => {
    const r = els.teardown.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top + at * (r.height - window.innerHeight), behavior: still ? 'auto' : 'smooth' });
  };
  els.steps.forEach((b, i) => b.addEventListener('click', () => scrollToShare(OPENED + (i + 0.5) * share)));

  // --- The loop: only while the stage is on screen ------------------------
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(els.stage);
  let last = performance.now();
  renderer.setAnimationLoop((t) => {
    const elapsed = Math.min(0.25, (t - last) / 1000);
    last = t;
    // Easing is capped at a 20 fps step so a stall can't overshoot; the
    // clock behind the switch-on and the LEDs keeps real time.
    if (visible && !document.hidden) frame(Math.min(0.05, elapsed), elapsed);
  });
  frame(0);

  return {
    /** Gives the model a spin, as a flick of the hand would. */
    spin() { spinning = 0.25; },
    /** Opens the stack where it is (or closes it), as a click on it does. */
    peek(open) { peek = open; },
    /** Scrolls to the hardware section with the stack apart, or back to the top. */
    explode(apart) {
      if (apart && els.teardown) scrollToShare(OPENED + share * 0.5);
      else window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
    },
  };
}
