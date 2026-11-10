// Textures for the 3D model, painted on canvases at load: the solder mask,
// traces, pads and silkscreen of each board, and the printing on the chips.
// Nothing here is an image file. Everything is drawn in millimetres, the
// same units as the model.

import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;
const SANS = 'Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

// The Raspberry Pi mark, about 2 mm tall at scale 1, centred on its middle.
const LEAF = 'M-0.9 -1.05 Q-0.5 -1.6 0 -0.95 Q0.5 -1.6 0.9 -1.05 Q0.4 -0.68 0 -0.78 Q-0.4 -0.68 -0.9 -1.05 Z';
const DRUPES = [[-0.5, -0.22], [0.5, -0.22], [0, -0.32], [-0.62, 0.45], [0, 0.4], [0.62, 0.45], [-0.31, 1.05], [0.31, 1.05]];

/** A small seeded random generator, so the boards look the same every load. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A canvas w × h millimetres at k pixels per millimetre, scaled to draw in mm. */
function sheet(w, h, k) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = c.getContext('2d');
  g.scale(c.width / w, c.height / h);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return [c, g];
}

function berry(g, x, y, s, fill) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = fill;
  g.fill(new Path2D(LEAF));
  for (const [cx, cy] of DRUPES) {
    g.beginPath();
    g.arc(cx, cy, 0.42, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** Text with its size in millimetres. Always set at 100px and scaled, so
 *  very small sizes render the same in every browser. */
function text(g, str, x, y, size, o = {}) {
  g.save();
  g.translate(x, y);
  if (o.rot) g.rotate(o.rot);
  g.scale(size / 100, size / 100);
  g.font = `${o.weight || 500} 100px ${o.font || SANS}`;
  g.textAlign = o.align || 'left';
  g.textBaseline = o.base || 'alphabetic';
  g.fillStyle = o.fill || '#eef2ea';
  if (o.spacing) g.letterSpacing = `${o.spacing}px`;
  g.fillText(str, 0, 0);
  g.restore();
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** n parallel copies of a polyline, pitch apart, mitred at the corners. */
function bundle(pts, n, pitch) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = (i - (n - 1) / 2) * pitch;
    out.push(pts.map((p, j) => {
      const before = j > 0 ? normal(pts[j - 1], p) : null;
      const after = j < pts.length - 1 ? normal(p, pts[j + 1]) : null;
      const a = before || after;
      const b = after || before;
      let mx = a[0] + b[0];
      let my = a[1] + b[1];
      const len = Math.hypot(mx, my) || 1;
      mx /= len;
      my /= len;
      const cos = Math.max(0.3, mx * a[0] + my * a[1]);
      return [p[0] + (mx * d) / cos, p[1] + (my * d) / cos];
    }));
  }
  return out;
}
function normal(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len ? [-dy / len, dx / len] : [0, 0];
}

/** A board being painted: the colour sheet and a height sheet for the bump map. */
class Board {
  constructor(w, h, k) {
    this.w = w;
    this.h = h;
    [this.canvas, this.g] = sheet(w, h, k);
    [this.bumpCanvas, this.b] = sheet(w, h, k * 0.5);
    this.b.fillStyle = '#6a6a6a';
    this.b.fillRect(0, 0, w, h);
    this.ends = [];
  }

  mask(top, bottom) {
    const { g, w, h } = this;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

  /** Copper under the mask: a lighter line, slightly raised. */
  trace(line, width = 0.13, alpha = 0.42) {
    const path = typeof line === 'string' ? new Path2D(line) : polyline(line);
    this.g.strokeStyle = `rgba(150, 235, 180, ${alpha})`;
    this.g.lineWidth = width;
    this.g.stroke(path);
    this.b.strokeStyle = '#8c8c8c';
    this.b.lineWidth = width;
    this.b.stroke(path);
    if (typeof line !== 'string') this.ends.push(line[0], line[line.length - 1]);
  }

  traces(pts, n, pitch, width, alpha) {
    for (const line of bundle(pts, n, pitch)) this.trace(line, width, alpha);
  }

  via(x, y, r = 0.24) {
    const { g, b } = this;
    g.fillStyle = 'rgba(150, 235, 180, 0.55)';
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(4, 30, 16, 0.85)';
    g.beginPath();
    g.arc(x, y, r * 0.42, 0, TAU);
    g.fill();
    b.fillStyle = '#3c3c3c';
    b.beginPath();
    b.arc(x, y, r * 0.5, 0, TAU);
    b.fill();
  }

  /** Bare metal: a pad, a test point, a plated ring. */
  pad(x, y, w, h, fill = '#cfd4d8', r = 0.06) {
    rrect(this.g, x, y, w, h, r);
    this.g.fillStyle = fill;
    this.g.fill();
    rrect(this.b, x, y, w, h, r);
    this.b.fillStyle = '#9a9a9a';
    this.b.fill();
  }

  ring(x, y, outer, inner, fill = '#d8b561') {
    const { g, b } = this;
    const grad = g.createLinearGradient(x - outer, y - outer, x + outer, y + outer);
    grad.addColorStop(0, '#f1d58a');
    grad.addColorStop(1, fill);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, outer, 0, TAU);
    g.fill();
    g.fillStyle = '#0b0c0d';
    g.beginPath();
    g.arc(x, y, inner, 0, TAU);
    g.fill();
    b.fillStyle = '#a0a0a0';
    b.beginPath();
    b.arc(x, y, outer, 0, TAU);
    b.fill();
  }

  /** Silkscreen: white ink, a touch proud of the mask. */
  silk(draw) {
    draw(this.g, 'rgba(240, 244, 236, 0.92)');
    draw(this.b, '#b4b4b4');
  }

  silkText(str, x, y, size, o = {}) {
    this.silk((g, ink) => text(g, str, x, y, size, { ...o, fill: ink }));
  }

  silkBox(x, y, w, h, r = 0.2, lw = 0.12) {
    this.silk((g, ink) => {
      rrect(g, x, y, w, h, r);
      g.strokeStyle = ink;
      g.lineWidth = lw;
      g.stroke();
    });
  }

  /** Short stubs ending in vias, scattered where keep(x, y) allows. */
  scatter(count, seed, keep) {
    const rand = rng(seed);
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
    let made = 0;
    for (let tries = 0; made < count && tries < count * 12; tries++) {
      const x = 2 + rand() * (this.w - 4);
      const y = 2 + rand() * (this.h - 4);
      if (!keep(x, y)) continue;
      const d1 = dirs[Math.floor(rand() * 4)];
      const d2 = dirs[4 + Math.floor(rand() * 4)];
      const l1 = 1 + rand() * 4.5;
      const l2 = 0.6 + rand() * 2.4;
      const mid = [x + d1[0] * l1, y + d1[1] * l1];
      const end = [mid[0] + d2[0] * l2, mid[1] + d2[1] * l2];
      if (!keep(end[0], end[1]) || !keep(mid[0], mid[1])) continue;
      const n = rand() < 0.3 ? 2 + Math.floor(rand() * 3) : 1;
      this.traces([[x, y], mid, end], n, 0.32, 0.12, 0.26);
      if (n === 1) {
        this.via(x, y, 0.22);
        if (rand() < 0.6) this.via(end[0], end[1], 0.22);
      }
      made++;
    }
  }

  /** Faint mottling so the mask isn't a flat fill. */
  grain(seed, amount = 0.008) {
    const { g, w, h } = this;
    const rand = rng(seed);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${amount * rand()})` : `rgba(0,0,0,${amount * 2 * rand()})`;
      g.beginPath();
      g.arc(rand() * w, rand() * h, 0.6 + rand() * 3, 0, TAU);
      g.fill();
    }
  }

  textures(renderer) {
    const map = new THREE.CanvasTexture(this.canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const bump = new THREE.CanvasTexture(this.bumpCanvas);
    for (const t of [map, bump]) {
      t.flipY = false; // row 0 of the canvas is z = 0, the board's back edge
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / this.w, 1 / this.h);
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    return { map, bump };
  }
}

function polyline(pts) {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  return p;
}

/** A zigzag between two points on a horizontal or vertical run: the
 *  length-matching wiggle fast signal pairs get. */
function meander(a, b, amp, period) {
  const pts = [a];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const steps = Math.max(2, Math.floor(len / period));
  for (let i = 0; i < steps; i++) {
    const t0 = (i + 0.25) / steps;
    const t1 = (i + 0.75) / steps;
    const side = i % 2 ? -amp : amp;
    pts.push([a[0] + ux * len * t0 - uy * side, a[1] + uy * len * t0 + ux * side]);
    pts.push([a[0] + ux * len * t1 - uy * side, a[1] + uy * len * t1 + ux * side]);
  }
  pts.push(b);
  return pts;
}

// ---------------------------------------------------------------------------
// Raspberry Pi 5, top side. 85 × 56 mm; x runs along the long edge from the
// SD-card end to the USB end, y from the GPIO edge to the HDMI edge.
// ---------------------------------------------------------------------------

/** Where the passives sit; the model puts a part on each. [x, y, kind]:
 *  c = capacitor lying along x, v = capacitor along y, r = resistor. */
export const PI_PASSIVES = [
  [24, 17.4, 'c'], [25.6, 17.4, 'c'], [27.2, 17.4, 'c'], [28.8, 17.4, 'c'], [30.4, 17.4, 'r'], [32, 17.4, 'c'], [33.6, 17.4, 'c'], [35.2, 17.4, 'c'], [36.8, 17.4, 'c'],
  [24.2, 36.1, 'c'], [25.6, 36.1, 'c'], [29.6, 36.1, 'c'], [31, 36.1, 'r'], [32.4, 36.1, 'c'], [36.6, 36.1, 'c'], [38, 36.1, 'c'],
  [40.1, 26.2, 'v'], [40.1, 27.6, 'v'], [40.1, 29, 'v'], [40.1, 33.4, 'v'], [41.3, 33.4, 'v'],
  [51.4, 22.9, 'c'], [52.8, 22.9, 'c'], [56.4, 22.9, 'r'], [57.8, 22.9, 'c'],
  [51.4, 33.2, 'c'], [52.8, 33.2, 'c'], [54.2, 33.2, 'c'], [57.4, 33.2, 'r'],
  [60.2, 25, 'v'], [60.2, 28.6, 'v'], [61.4, 28.6, 'v'],
  [29.5, 7.4, 'r'], [31, 7.4, 'r'], [36, 7.6, 'r'], [44.5, 7.6, 'r'], [46, 7.6, 'c'],
  [16.9, 36.6, 'v'], [18.1, 36.6, 'v'], [11.5, 46, 'c'], [13, 46, 'c'], [14.5, 46, 'c'],
  [20.6, 9, 'r'], [20.6, 10.2, 'r'], [3, 17, 'c'], [7, 33.4, 'v'],
  [44.5, 50, 'r'], [56, 47, 'c'], [56, 48.4, 'c'], [61.2, 31.6, 'c'], [62.8, 31.6, 'r'],
  [66.2, 34.6, 'v'], [67.4, 34.6, 'v'], [43.4, 13, 'c'], [45, 13, 'c'], [47.4, 16, 'r'], [49, 16, 'r'],
  [8.4, 20, 'v'], [9.6, 20, 'v'], [8.4, 30.4, 'v'], [23, 48.6, 'c'], [33, 48.2, 'r'], [42.6, 36.4, 'c'],
];

/** False where the Pi's big parts or its name sit, so scattered traces keep off. */
function piFree(x, y) {
  const boxes = [
    [6, 0, 53, 7], [7, 7.5, 14, 10.5], [11, 17.5, 30, 19], [50, 23, 11, 11], [64.5, 0, 21, 56],
    [20, 37, 23, 6.5], [44.5, 36.5, 10.5, 15], [9.5, 38.5, 15, 9.5], [0, 17.5, 6, 18],
    [0, 0, 7, 7], [58, 0, 7, 7.5], [0, 49, 7, 7], [58, 49, 7, 7], [6, 48.5, 39, 7.5], [57, 6, 8, 5],
  ];
  return !boxes.some(([bx, by, bw, bh]) => x > bx && x < bx + bw && y > by && y < by + bh);
}

export function paintPiTop(k) {
  const B = new Board(85, 56, k);
  B.mask('#12773f', '#0a5530');

  // Copper pours: big, barely lighter patches under the mask.
  B.g.fillStyle = 'rgba(160, 240, 190, 0.045)';
  for (const [x, y, w, h] of [[1.5, 7, 62, 10], [42, 18, 21, 17], [1.5, 36, 42, 11], [44, 7.5, 13, 9]]) {
    rrect(B.g, x, y, w, h, 1);
    B.g.fill();
  }

  // Signal bundles between the big parts.
  for (let y = 20.5; y <= 31.8; y += 0.55) B.trace([[21, y], [22.6, y]], 0.12, 0.34); // memory bus
  B.traces([[25, 18.5], [25, 13.5], [20.5, 9], [20.5, 6.6]], 6, 0.36); // to the GPIO header
  B.traces([[29.4, 18.5], [29.4, 11.5], [31.9, 9], [31.9, 6.6]], 7, 0.36);
  B.traces([[34.6, 18.5], [34.6, 12.4], [40.2, 6.8], [40.2, 6.6]], 5, 0.36);
  B.traces([[38, 18.5], [38, 15], [46, 7]], 4, 0.36);
  B.traces([[39.5, 22.5], [50, 12], [50, 6.6]], 3, 0.36);
  B.traces([[27.3, 35.5], [27.3, 45.6], [25.4, 47.5], [25.4, 51]], 8, 0.34); // HDMI 0
  B.traces([[34.6, 35.5], [34.6, 44], [38.8, 48.2], [38.8, 51]], 8, 0.34); // HDMI 1
  B.trace(meander([30.2, 36.5], [30.2, 44.5], 0.42, 1.1), 0.12, 0.36);
  B.trace(meander([31.2, 36.5], [31.2, 44.5], 0.42, 1.1), 0.12, 0.36);
  B.traces([[39.5, 26.2], [44.4, 26.2], [46.6, 28.4], [51, 28.4]], 8, 0.36); // to the RP1
  B.traces([[39.5, 32], [42.8, 32], [44.6, 33.8], [45.8, 33.8]], 4, 0.36);
  B.traces([[59.5, 26.6], [63.4, 26.6], [64.2, 27], [69.5, 27]], 6, 0.36); // USB 3
  B.traces([[57, 24], [57, 19.4], [62.4, 14], [69.5, 14]], 4, 0.36); // USB 2
  B.traces([[58.4, 24], [58.4, 20.4], [68.2, 10.6], [69.5, 10.6]], 2, 0.36);
  B.traces([[57, 32.5], [57, 35.4], [58.4, 36.8], [61, 36.8]], 5, 0.34); // Ethernet PHY
  B.traces([[63.2, 39], [63.2, 43.6], [65.4, 45.8], [66.2, 45.8]], 8, 0.32);
  B.traces([[53, 32.5], [53, 35.2], [51.9, 36.3], [51.9, 37.5]], 4, 0.32); // camera and display
  B.traces([[51.4, 32.5], [51.4, 34.4], [47.5, 36.4], [47.5, 37.5]], 4, 0.32);
  B.traces([[22.5, 34.2], [21.4, 35.3], [8.6, 35.3], [6.2, 32.9], [6.2, 26.5], [4.4, 26.5]], 6, 0.38); // PCIe
  B.trace(meander([9, 34.2], [19, 34.2], 0.3, 0.9), 0.12, 0.32);
  B.traces([[20, 12.8], [24, 12.8], [25, 13.8], [25, 18.5]], 2, 0.5); // radio
  B.trace('M1.5 9.1H5.6V10.1H1.8V11.1H5.6V12.1H1.8V13.1H5.6V14.1', 0.26, 0.5); // antenna
  B.trace('M11.9 50V46.5H16.8', 0.7, 0.34); // power in
  B.trace('M20.4 43.2H22.4V36.5', 0.7, 0.34);
  B.trace('M16.5 42.2H17.5M13.75 39.5V37.4H22.5', 0.5, 0.3);

  B.scatter(150, 7, piFree);

  // Stitching vias and the ends of the bundles.
  const rand = rng(11);
  for (const [x, y] of B.ends) if (rand() < 0.5 && piFree(x, y)) B.via(x, y, 0.22);
  for (let i = 0; i < 130; i++) {
    const x = 1.6 + rand() * 62;
    const y = 7.4 + rand() * 47;
    if (piFree(x, y)) B.via(x, y, 0.2 + rand() * 0.06);
  }

  // Pads under every passive, and the legs round the smaller chips.
  for (const [x, y, kind] of PI_PASSIVES) {
    if (kind === 'v') {
      B.pad(x - 0.08, y - 0.1, 0.66, 0.36);
      B.pad(x - 0.08, y + 0.74, 0.66, 0.36);
    } else {
      B.pad(x - 0.1, y - 0.08, 0.36, 0.66);
      B.pad(x + 0.74, y - 0.08, 0.36, 0.66);
    }
  }
  const legs = (x, y, w, h, pitch) => {
    for (let i = x + pitch; i < x + w - pitch * 0.5; i += pitch) {
      B.pad(i - 0.1, y - 0.42, 0.2, 0.5);
      B.pad(i - 0.1, y + h - 0.08, 0.2, 0.5);
    }
    for (let j = y + pitch; j < y + h - pitch * 0.5; j += pitch) {
      B.pad(x - 0.42, j - 0.1, 0.5, 0.2);
      B.pad(x + w - 0.08, j - 0.1, 0.5, 0.2);
    }
  };
  legs(11, 39.5, 5.5, 5.5, 0.5);
  legs(61, 34.5, 4.5, 4.5, 0.5);
  for (let i = 0; i < 14; i++) {
    const x = 3 + rand() * 60;
    const y = 8 + rand() * 44;
    if (piFree(x, y)) B.ring(x, y, 0.45, 0, '#c9a24f');
  }

  // Plated rings: the mounting holes and the four PoE pins.
  for (const [x, y] of [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]) B.ring(x, y, 3, 1.38);
  for (const [x, y] of [[61.1, 42.8], [63.64, 42.8], [61.1, 45.34], [63.64, 45.34]]) B.ring(x, y, 0.85, 0.42);

  // Silkscreen.
  B.silkBox(6.8, 0.7, 51.4, 5.7);
  B.silkBox(11.6, 18.1, 9.8, 14.8, 0.1);
  B.silkBox(50.6, 23.6, 9.3, 9.3, 0.1);
  B.silkBox(60.6, 34.1, 5.3, 5.3, 0.1);
  B.silkBox(1, 8.4, 5.2, 6.4, 0.1);
  B.silkBox(58, 6.8, 6.4, 3.6, 0.2);
  B.silk((g, ink) => berry(g, 21.7, 39.3, 0.92, ink));
  B.silkText('Raspberry Pi 5', 23.5, 40.4, 2.05, { weight: 700 });
  B.silkText('© Raspberry Pi Ltd 2023', 23.5, 42.05, 0.86);
  B.silkText('1', 6.3, 5.8, 0.9, { align: 'right' });
  B.silkText('40', 58.5, 2.3, 0.9);
  B.silkText('FAN', 57.6, 9.2, 0.8, { align: 'right' });
  B.silkText('POWER IN', 11.9, 49.5, 0.85, { align: 'center' });
  B.silkText('HDMI0', 25.8, 50.4, 0.85, { align: 'center' });
  B.silkText('HDMI1', 39.2, 50.4, 0.85, { align: 'center' });
  B.silkText('UART', 32.5, 51.8, 0.75, { align: 'center' });
  B.silkText('BAT', 7.5, 35.4, 0.75, { align: 'center' });
  B.silkText('STAT', 7, 46.6, 0.7);
  B.silkText('PoE', 62.4, 48, 0.75, { align: 'center' });
  B.silkText('PCIe', 5.5, 26.5, 0.85, { align: 'center', rot: -Math.PI / 2 });
  B.silkText('CAM/DISP 0', 45, 44, 0.8, { align: 'center', rot: -Math.PI / 2 });
  B.silkText('CAM/DISP 1', 54.7, 44, 0.8, { align: 'center', rot: -Math.PI / 2 });
  const refs = [['C1201', 24, 17.1], ['C1214', 40.9, 25.8], ['C3002', 51.4, 22.6], ['L1', 17.5, 39.4], ['L2', 17.5, 48.3], ['U5', 11, 39.1], ['R14', 29.5, 7.2], ['R3008', 61.2, 31.2], ['U8', 61, 33.9], ['C44', 43.4, 12.7], ['R61', 47.4, 15.7], ['X1', 41, 20.4], ['TP7', 9.3, 23.8], ['C7', 8.3, 19.6], ['J12', 60.2, 41.2]];
  for (const [s, x, y] of refs) B.silkText(s, x, y, 0.56, { fill: 'rgba(240, 244, 236, 0.6)' });

  // A laser-marked 2D code, as boards carry for traceability.
  B.silk((g, ink) => {
    g.fillStyle = ink;
    const r2 = rng(3);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) if (i === 0 || j === 11 || r2() < 0.5) g.fillRect(43.2 + i * 0.24, 44.2 + j * 0.24, 0.25, 0.25);
  });

  B.grain(5);
  return B;
}

/** The underside: the same mask, quieter, with the legal print. Drawn as
 *  seen from below, so the model mirrors it in x. */
export function paintPiBottom(k) {
  const B = new Board(85, 56, k);
  B.mask('#12683d', '#0b4a2b');
  const free = (x, y) => !(Math.hypot(x - 3.5, y - 3.5) < 4 || Math.hypot(x - 23.5, y - 3.5) < 4 || Math.hypot(x - 3.5, y - 52.5) < 4 || Math.hypot(x - 23.5, y - 52.5) < 4 || (x > 70 && y > 20 && y < 36) || (x > 30 && x < 62 && y > 22 && y < 36));
  B.scatter(230, 21, free);
  const rand = rng(23);
  for (let i = 0; i < 260; i++) {
    const x = 2 + rand() * 81;
    const y = 2 + rand() * 52;
    if (free(x, y)) B.via(x, y, 0.2);
  }
  for (const [x, y] of [[81.5, 3.5], [23.5, 3.5], [81.5, 52.5], [23.5, 52.5]]) B.ring(x, y, 3, 1.38);
  // Solder joints of the through-hole parts: the GPIO header, then the ports.
  for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) B.ring(85 - (8.37 + i * 2.54), 2.27 + j * 2.54, 0.8, 0, '#b9bec4');
  B.silk((g, ink) => berry(g, 34, 29, 1.5, ink));
  B.silkText('Raspberry Pi 5 Model B', 37, 28.2, 1.9, { weight: 700 });
  B.silkText('Designed and built in the UK', 37, 30.4, 1.1);
  B.silkText('© Raspberry Pi Ltd 2023', 37, 32.2, 1.1);
  B.silkBox(70.5, 21.5, 13.5, 13, 0.3);
  B.silkText('microSD', 77.2, 37, 0.9, { align: 'center' });
  B.grain(6);
  return B;
}

// ---------------------------------------------------------------------------
// The M.2 HAT+: 65 × 56 mm, the same hole pattern as the Pi under it.
// ---------------------------------------------------------------------------

/** Where the HAT's parts go, shared with the model. */
export const HAT = {
  w: 65,
  d: 56,
  window: [19, 37.5, 36, 12], // the cut-out, x y w h
  socket: { x: 8.6, z: 12.9, w: 5.6, d: 23.2 }, // M.2 socket
  drive: { x: 12.4, z: 13.5 }, // the SSD's corner at the socket
  ffc: { x: 0.6, z: 20.6, w: 4, d: 11.8 },
  posts: { 2230: 42.4, 2242: 54.4 }, // x of the drive's retaining post
  leds: [[5.2, 40.6], [5.2, 43.6]],
};

export function paintHatTop(k, drive) {
  const B = new Board(HAT.w, HAT.d, k);
  B.mask('#137a42', '#0b5832');
  const [wx, wy, ww, wh] = HAT.window;
  const mid = HAT.drive.z + 11;
  const free = (x, y) => !((x > 6 && x < 58 && y < 7) || (x > wx - 1.5 && x < wx + ww + 1.5 && y > wy - 1.5 && y < wy + wh + 1.5) || (x < 7.5 && y < 7.5) || (x > 57.5 && y < 7.5) || (x < 7.5 && y > 48.5) || (x > 57.5 && y > 48.5) || (x > 7 && x < 57 && y > 11.5 && y < 37) || (y > 49.5 && x > 8 && x < 44));

  B.g.fillStyle = 'rgba(160, 240, 190, 0.045)';
  rrect(B.g, 14, 12.5, 43, 24, 1);
  B.g.fill();

  // The PCIe lane: pairs from the ribbon connector into the socket.
  for (let i = 0; i < 4; i++) {
    const y = mid - 3 + i * 2;
    B.trace([[4.6, y], [6.2, y], [7, y + 0.5], [8.6, y + 0.5]], 0.14, 0.42);
    B.trace([[4.6, y + 0.4], [6, y + 0.4], [6.8, y + 0.9], [8.6, y + 0.9]], 0.14, 0.42);
  }
  B.traces([[14.2, mid - 9], [20, mid - 9], [22, mid - 11], [22, 9.5]], 3, 0.4); // 3.3 V rail
  B.trace('M5.2 40.6H9.4V36.8', 0.16, 0.36);
  B.trace('M5.2 43.6H10.6V36.8', 0.16, 0.36);
  B.trace('M22 9.5H30', 0.6, 0.32);
  B.scatter(46, 41, free);
  const rand = rng(43);
  for (let i = 0; i < 70; i++) {
    const x = 1.5 + rand() * 62;
    const y = 7.5 + rand() * 47;
    if (free(x, y)) B.via(x, y, 0.2);
  }
  // Ground stitching along the edges.
  for (let x = 8; x <= 57; x += 1.6) B.via(x, 55, 0.2);
  for (let y = 8; y <= 48; y += 1.6) B.via(64, y, 0.2);

  for (const [x, y] of [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]) B.ring(x, y, 3, 1.4);
  for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) B.ring(8.37 + i * 2.54, 2.27 + j * 2.54, 0.82, 0.42);
  for (const size of ['2230', '2242']) B.ring(HAT.posts[size], mid, 2.6, 0);
  for (const [x, y] of HAT.leds) {
    B.pad(x - 1.1, y - 0.4, 0.5, 0.8);
    B.pad(x + 0.6, y - 0.4, 0.5, 0.8);
  }

  // Silkscreen.
  B.silkBox(6.9, 0.8, 51.2, 5.6);
  B.silk((g, ink) => {
    g.strokeStyle = ink;
    g.lineWidth = 0.12;
    g.setLineDash([0.8, 0.5]);
    g.strokeRect(HAT.drive.x, HAT.drive.z, 30, 22);
    g.strokeRect(HAT.drive.x, HAT.drive.z, 42, 22);
    g.setLineDash([]);
  });
  B.silkText('2230', HAT.posts[2230], mid + 4.4, 0.95, { align: 'center', font: MONO });
  B.silkText('2242', HAT.posts[2242], mid + 4.4, 0.95, { align: 'center', font: MONO });
  B.silkText('PWR', 7.2, 40.95, 0.8);
  B.silkText('ACT', 7.2, 43.95, 0.8);
  B.silkText('PCIe', 5.9, 34.8, 0.8, { align: 'center' });
  B.silk((g, ink) => berry(g, 10.6, 52.2, 1.05, ink));
  B.silkText('Raspberry Pi', 12.8, 51.9, 1.45, { weight: 700 });
  B.silkText('M.2 HAT+', 12.8, 54, 1.9, { weight: 800 });
  B.silkText(`NVMe · ${drive}`, 31, 54, 0.95, { font: MONO });
  B.silkText('J1', 58.8, 7.6, 0.6, { fill: 'rgba(240, 244, 236, 0.6)' });
  B.silkText('C3', 16.6, 10.9, 0.6, { fill: 'rgba(240, 244, 236, 0.6)' });
  B.silkText('U1', 24.8, 11.2, 0.6, { fill: 'rgba(240, 244, 236, 0.6)' });
  B.grain(8);
  return B;
}

export function paintHatBottom(k) {
  const B = new Board(HAT.w, HAT.d, k);
  B.mask('#136b3f', '#0b4c2c');
  B.scatter(90, 51, (x, y) => x > 6 && x < 59 && y > 8 && y < 36);
  for (const [x, y] of [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]) B.ring(x, y, 3, 1.4);
  B.grain(9);
  return B;
}

// ---------------------------------------------------------------------------
// The SSD: 22 mm wide, 30 or 42 long, black, gold fingers at the socket end.
// ---------------------------------------------------------------------------

export function paintDrive(k, len) {
  const B = new Board(len, 22, k);
  B.mask('#101216', '#08090b');
  const pale = (line, w = 0.12) => {
    const path = polyline(line);
    B.g.strokeStyle = 'rgba(190, 200, 215, 0.13)';
    B.g.lineWidth = w;
    B.g.stroke(path);
    B.b.strokeStyle = '#868686';
    B.b.lineWidth = w;
    B.b.stroke(path);
  };
  for (const line of bundle([[2.6, 6], [4.4, 6], [5.6, 7.2], [7, 7.2]], 9, 0.34)) pale(line);
  for (const line of bundle([[2.6, 14.4], [4.2, 14.4], [5.4, 13.2], [7, 13.2]], 7, 0.34)) pale(line);
  for (const line of bundle([[14, 9], [16.2, 9]], 14, 0.36)) pale(line);
  const rand = rng(61);
  for (let i = 0; i < 60; i++) {
    const x = 3 + rand() * (len - 6);
    const y = 1 + rand() * 20;
    B.g.fillStyle = 'rgba(190, 200, 215, 0.2)';
    B.g.beginPath();
    B.g.arc(x, y, 0.16, 0, TAU);
    B.g.fill();
  }
  // Edge fingers, with the gap of the M key.
  for (let y = 1.2; y < 20.9; y += 0.5) {
    if (y > 14.6 && y < 17.4) continue;
    B.pad(0.15, y, 2.1, 0.32, '#e2bd62', 0.05);
  }
  B.ring(len, 11, 3, 0, '#d8b561');
  B.silkText(`M.2 ${len === 42 ? '2242' : '2230'}`, len - 4.4, 3.2, 0.9, { align: 'right', font: MONO, fill: 'rgba(240, 244, 236, 0.7)' });
  B.silkText('NVMe', len - 4.4, 20.4, 0.9, { align: 'right', font: MONO, fill: 'rgba(240, 244, 236, 0.7)' });
  return B;
}

// ---------------------------------------------------------------------------
// Printing on parts: transparent sheets laid just above a chip or a can.
// ---------------------------------------------------------------------------

function decal(w, h, k, draw) {
  const [c, g] = sheet(w, h, k);
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function paintDecals(drive) {
  const etch = 'rgba(96, 104, 112, 0.9)';
  const laser = 'rgba(176, 182, 190, 0.78)';
  return {
    // The processor's lid: engraved, so darker than the metal.
    soc: decal(15.4, 15.4, 40, (g) => {
      berry(g, 7.7, 5.2, 1.7, etch);
      text(g, 'BCM2712ZPKFSB00C0T', 7.7, 10.6, 1.02, { align: 'center', font: MONO, fill: etch, weight: 600 });
      text(g, 'TE2338  P21  085-25', 7.7, 12.1, 0.86, { align: 'center', font: MONO, fill: etch });
      text(g, '© 2023 BROADCOM', 7.7, 13.5, 0.86, { align: 'center', font: MONO, fill: etch });
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 0.1;
      rrect(g, 0.25, 0.25, 14.9, 14.9, 0.9);
      g.stroke();
    }),
    rp1: decal(8.5, 8.5, 48, (g) => {
      berry(g, 4.25, 3, 1, '#e9ecef');
      text(g, 'RP1-C0', 4.25, 6.5, 0.98, { align: 'center', font: MONO, fill: '#cfd3d8', weight: 700 });
      text(g, '© 2020-23 RPL', 4.25, 7.7, 0.62, { align: 'center', font: MONO, fill: '#8a9099' });
      g.fillStyle = '#5a6068';
      g.beginPath();
      g.arc(0.9, 0.9, 0.3, 0, TAU);
      g.fill();
    }),
    ram: decal(9, 14, 40, (g) => {
      text(g, 'MICRON', 3.9, 7, 1.15, { align: 'center', font: MONO, fill: laser, weight: 600, rot: -Math.PI / 2 });
      text(g, 'LPDDR4X', 5.5, 7, 0.95, { align: 'center', font: MONO, fill: laser, rot: -Math.PI / 2 });
      text(g, 'D8CZX 16GB', 6.9, 7, 0.8, { align: 'center', font: MONO, fill: 'rgba(150,156,164,0.7)', rot: -Math.PI / 2 });
      g.fillStyle = '#3c4046';
      g.beginPath();
      g.arc(1, 1, 0.35, 0, TAU);
      g.fill();
    }),
    pmic: decal(5.5, 5.5, 48, (g) => {
      text(g, 'DA9091', 2.75, 2.7, 0.78, { align: 'center', font: MONO, fill: laser });
      text(g, '2331', 2.75, 3.8, 0.66, { align: 'center', font: MONO, fill: 'rgba(150,156,164,0.7)' });
    }),
    phy: decal(4.5, 4.5, 48, (g) => {
      text(g, 'BCM', 2.25, 2, 0.7, { align: 'center', font: MONO, fill: laser });
      text(g, '54213PE', 2.25, 3, 0.62, { align: 'center', font: MONO, fill: laser });
    }),
    // The radio's can: the mark is stamped into the metal.
    can: decal(12, 8.5, 40, (g) => {
      g.strokeStyle = 'rgba(70, 76, 84, 0.55)';
      g.lineWidth = 0.14;
      rrect(g, 0.7, 0.7, 10.6, 7.1, 0.35);
      g.stroke();
      berry(g, 6, 4.3, 1.05, 'rgba(84, 92, 100, 0.6)');
    }),
    hatReg: decal(3, 3, 48, (g) => {
      text(g, 'AP22', 1.5, 1.4, 0.6, { align: 'center', font: MONO, fill: laser });
      text(g, '653', 1.5, 2.2, 0.6, { align: 'center', font: MONO, fill: laser });
    }),
    controller: decal(7, 7, 48, (g) => {
      text(g, 'NVMe', 3.5, 2.9, 1.1, { align: 'center', font: MONO, fill: laser, weight: 700 });
      text(g, 'PS5027-E27T', 3.5, 4.3, 0.62, { align: 'center', font: MONO, fill: 'rgba(150,156,164,0.75)' });
      text(g, '2443  TW', 3.5, 5.3, 0.62, { align: 'center', font: MONO, fill: 'rgba(150,156,164,0.75)' });
    }),
    // The drive's label: a white sticker over the flash chip.
    sticker: decal(13, 17, 48, (g) => {
      rrect(g, 0, 0, 13, 17, 0.5);
      g.fillStyle = '#f1f1ec';
      g.fill();
      berry(g, 2, 2.75, 0.95, '#c7254e');
      text(g, 'NVMe SSD', 3.7, 3.4, 1.62, { fill: '#15171a', weight: 800 });
      text(g, `M.2 ${drive} · PCIe`, 1, 5.9, 0.98, { font: MONO, fill: '#3a3f45', weight: 500 });
      text(g, 'M key · 3.3 V', 1, 7.4, 0.82, { font: MONO, fill: '#6a7078' });
      // A barcode and a 2D code with nothing to say.
      const r2 = rng(71);
      g.fillStyle = '#15171a';
      for (let x = 1; x < 11.8; ) {
        const w = 0.1 + r2() * 0.28;
        g.fillRect(x, 8.7, w, 2.9);
        x += w + 0.1 + r2() * 0.22;
      }
      for (let i = 0; i < 11; i++) for (let j = 0; j < 11; j++) if (i === 0 || j === 10 || r2() < 0.5) g.fillRect(1 + i * 0.32, 12.6 + j * 0.32, 0.33, 0.33);
      text(g, 'PCIe NVMe', 5.4, 13.6, 0.8, { font: MONO, fill: '#6a7078' });
      text(g, 'solid state', 5.4, 14.8, 0.8, { font: MONO, fill: '#6a7078' });
      text(g, 'drive', 5.4, 16, 0.8, { font: MONO, fill: '#6a7078' });
    }),
  };
}

/** The ribbon cable: amber film over sixteen copper conductors, with a
 *  blue stiffener at each end. u runs along the cable. */
export function paintRibbon() {
  const [c, g] = sheet(128, 16, 4);
  g.fillStyle = '#c98a2c';
  g.fillRect(0, 0, 128, 16);
  g.fillStyle = 'rgba(120, 62, 12, 0.5)';
  for (let i = 0; i < 16; i++) g.fillRect(0, 0.75 + i * 0.93, 128, 0.42);
  g.fillStyle = '#2a5fb8';
  g.fillRect(0, 0, 9, 16);
  g.fillRect(119, 0, 9, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A soft round glow for the LEDs. */
export function paintGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Fine horizontal scratches: the brushed finish on the metal shells.
 *  Used as a roughness map, so it's nearly white with darker strokes. */
export function paintBrushed() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, 256, 256);
  const rand = rng(81);
  for (let i = 0; i < 1400; i++) {
    const v = 150 + Math.floor(rand() * 105);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(rand() * 256, rand() * 256, 30 + rand() * 120, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
