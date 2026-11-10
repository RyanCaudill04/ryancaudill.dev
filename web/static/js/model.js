// The server, modelled part by part: a Raspberry Pi 5, the Active Cooler on
// it, the standoffs and stacking header above it, a GeeekPi P33 M.2 NVMe PoE+ HAT on those, and a
// Silicon Power NVMe SSD in the HAT's slot. No model file is loaded; every part is built here from boxes,
// extrusions and painted textures.
//
// Units are millimetres. x runs along the Pi's long edge, from the SD-card
// end (0) to the USB end (85); z runs from the GPIO edge (0) to the HDMI
// edge (56); y is up, with the Pi's top face at y = 0.

import * as THREE from '../vendor/three.module.min.js';
import {
  HAT, PI_PASSIVES, paintBrushed, paintDecals, paintDrive, paintGlow, paintHatBottom,
  paintHatTop, paintPiBottom, paintPiTop, paintRibbon,
} from './textures.js';

const HOLES = [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]];
const PCB = 1.4; // board thickness
const GAP = 16; // the standoffs: Pi's top face to the HAT's underside
const HAT_TOP = GAP + PCB;
const DRIVE_Y = 1.9; // the SSD's underside above the HAT, set by the socket
const X_FRONT = 87.3; // how far the USB and Ethernet shells reach past the edge

// ---------------------------------------------------------------------------
// Shapes and small helpers
// ---------------------------------------------------------------------------

/** A rounded rectangle from (x, y), as a Shape or (for holes) a Path. */
function rounded(x, y, w, h, r, Kind = THREE.Shape) {
  const s = new Kind();
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function circle(x, y, r) {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, true);
  return p;
}

/** A flat face cut from a shape drawn in (x, z), lying at y = 0 and facing
 *  up or down. Its UVs are the shape's own millimetres. */
function face(shape, up) {
  const g = new THREE.ShapeGeometry(shape, 10);
  g.rotateX(Math.PI / 2); // (x, y) -> (x, 0, y): now facing down
  if (up) {
    const i = g.index.array;
    for (let n = 0; n < i.length; n += 3) [i[n + 1], i[n + 2]] = [i[n + 2], i[n + 1]];
    const nrm = g.attributes.normal;
    for (let n = 0; n < nrm.count; n++) nrm.setY(n, 1);
  }
  return g;
}

/** A circuit board: an edge the colour of bare laminate, and a painted
 *  face on each side. Its top face is at y = 0. */
function board(shape, thick, top, bottom, edge) {
  const g = new THREE.Group();
  const body = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 10 });
  body.rotateX(Math.PI / 2); // extrude downward from y = 0
  const core = new THREE.Mesh(body, edge);
  core.castShadow = true;
  const up = new THREE.Mesh(face(shape, true), top);
  up.position.y = 0.012;
  up.receiveShadow = true;
  const down = new THREE.Mesh(face(shape, false), bottom);
  down.position.y = -thick - 0.012;
  down.receiveShadow = true;
  g.add(core, up, down);
  return g;
}

const blocks = new Map();
/** A box w × h × d with softened edges, its base centred on the origin. */
function block(w, h, d, r = 0.2, bevel = 0.08) {
  const key = `${w}|${h}|${d}|${r}|${bevel}`;
  if (blocks.has(key)) return blocks.get(key);
  const b = Math.min(bevel, h / 3, w / 4, d / 4);
  const s = rounded(-w / 2 + b, -d / 2 + b, w - 2 * b, d - 2 * b, Math.max(0.02, r - b));
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  blocks.set(key, g);
  return g;
}

function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A softened box with its corner at (x, z), standing on y0. */
function part(parent, x, z, w, d, h, material, o = {}) {
  return mesh(parent, block(w, h, d, o.r, o.bevel), material, x + w / 2, o.y || 0, z + d / 2);
}

/** A printed sheet laid flat just above a part. */
function label(parent, texture, x, z, w, d, y, o = {}) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    map: texture, transparent: true, depthWrite: false, roughness: o.roughness ?? 0.55, metalness: o.metalness ?? 0,
    polygonOffset: true, polygonOffsetFactor: -4,
  }));
  m.position.set(x + w / 2, y + 0.015, z + d / 2);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function instances(parent, geometry, material, places) {
  const m = new THREE.InstancedMesh(geometry, material, places.length);
  const at = new THREE.Matrix4();
  places.forEach(([x, y, z], i) => m.setMatrixAt(i, at.makeTranslation(x, y, z)));
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A metal shell with openings: a profile drawn in (u, v), with holes,
 *  pushed back `depth` from a front face. */
function shell(profile, depth, material) {
  const g = new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 2, curveSegments: 6 });
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

/**
 * Builds the whole server.
 *   drive    '2230', '2242', '2260' or '2280', the SSD's M.2 size
 *   detail   texture resolution in pixels per millimetre
 * Returns the root group, an anchor on each layer for the annotations, and
 * two functions: pose() takes the stack apart, tick() runs the LEDs.
 */
export function buildStack(renderer, { drive = '2230', detail = 24 } = {}) {
  const len = Number(drive.slice(2)); // the drive's length, mm
  const decals = paintDecals(drive);
  const glow = paintGlow();
  const brushed = paintBrushed();
  brushed.repeat.set(0.08, 0.08);

  // Materials, shared between parts.
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    steel: std({ color: 0xb9bdc2, metalness: 1, roughness: 0.46, roughnessMap: brushed }),
    lid: std({ color: 0xd8dbdf, metalness: 1, roughness: 0.5, roughnessMap: brushed }),
    can: std({ color: 0xc6cacf, metalness: 1, roughness: 0.52 }),
    gold: std({ color: 0xf0c468, metalness: 1, roughness: 0.36 }),
    brass: std({ color: 0xd8a848, metalness: 1, roughness: 0.4 }),
    plastic: std({ color: 0x121316, roughness: 0.55 }),
    chip: std({ color: 0x18191c, roughness: 0.48 }),
    ferrite: std({ color: 0x4b4f56, roughness: 0.7 }),
    cream: std({ color: 0xe6dfc9, roughness: 0.6 }),
    latch: std({ color: 0x2b2d31, roughness: 0.6 }),
    blue: std({ color: 0x1b5fdc, roughness: 0.45 }),
    substrate: std({ color: 0x143525, roughness: 0.5 }),
    ceramic: std({ color: 0xb89a6e, roughness: 0.6 }),
    resistor: std({ color: 0x17181b, roughness: 0.5 }),
    tin: std({ color: 0xd4d8dc, metalness: 1, roughness: 0.4 }),
    laminate: std({ color: 0x66713f, roughness: 0.75 }),
    alloy: std({ color: 0xc9cdd2, metalness: 1, roughness: 0.38, roughnessMap: brushed }),
    pad: std({ color: 0x8fa4b8, roughness: 0.8 }),
    tape: std({ color: 0xd2a92e, roughness: 0.5 }),
    sleeve: std({ color: 0x1a1b20, roughness: 0.35 }),
    hollow: std({ color: 0x0b0c0e, roughness: 0.6, side: THREE.BackSide }),
    darkLaminate: std({ color: 0x2a2b22, roughness: 0.7 }),
  };
  const mask = (B, o = {}) => {
    const { map, bump } = B.textures(renderer);
    return new THREE.MeshPhysicalMaterial({
      map, bumpMap: bump, bumpScale: 1.6, roughness: 0.55, metalness: 0.05,
      clearcoat: 0.22, clearcoatRoughness: 0.38, ...o,
    });
  };
  /** A bottom face shows its texture mirrored, as the paint functions expect. */
  const mirrored = (material) => {
    for (const t of [material.map, material.bumpMap]) {
      t.repeat.x = -t.repeat.x;
      t.offset.x = 1;
    }
    return material;
  };

  const leds = [];
  let spin = null; // the fan's impeller
  /** A lit LED: a bright body, and a halo on the surface it sits on. */
  const led = (parent, x, y, z, colour, kind, o = {}) => {
    const base = new THREE.Color(colour);
    const body = new THREE.Mesh(new THREE.BoxGeometry(o.w || 1.1, o.h || 0.45, o.d || 0.6), new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false }));
    body.position.set(x, y, z);
    const haloGeometry = new THREE.PlaneGeometry(o.halo || 8, o.halo || 8);
    if (o.facing === 'x') haloGeometry.rotateY(Math.PI / 2);
    else haloGeometry.rotateX(-Math.PI / 2);
    const halo = new THREE.Mesh(haloGeometry, new THREE.MeshBasicMaterial({ map: glow, color: base.clone(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.position.set(x + (o.facing === 'x' ? 0.2 : 0), y + (o.facing === 'x' ? 0 : -(o.h || 0.45) / 2 + 0.05), z);
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: base.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    spark.scale.setScalar(o.spark || 3.4);
    spark.position.set(x + (o.facing === 'x' ? 0.8 : 0), y + (o.facing === 'x' ? 0 : 0.8), z);
    parent.add(body, halo, spark);
    leds.push({ base, kind, seed: leds.length * 7.31, body, halo, spark });
  };

  /** The dark inside of a socket: a box seen from within, lining the
   *  opening a shell leaves. Centred on (x, y, z). */
  const hollow = (parent, x, y, z, w, h, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.hollow);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    parent.add(m);
  };

  const root = new THREE.Group();

  // -------------------------------------------------------------------------
  // Raspberry Pi 5
  // -------------------------------------------------------------------------
  const pi = new THREE.Group();
  root.add(pi);
  {
    const outline = rounded(0, 0, 85, 56, 3);
    for (const [x, z] of HOLES) outline.holes.push(circle(x, z, 1.375));
    pi.add(board(outline, PCB, mask(paintPiTop(detail)), mirrored(mask(paintPiBottom(detail * 0.6))), M.laminate));

    // The 40-pin header.
    part(pi, 7.1, 1, 50.8, 5.08, 2.5, M.plastic, { r: 0.15, bevel: 0.1 });
    const pins = [];
    const tails = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) {
      pins.push([8.37 + i * 2.54, 5.5, 2.27 + j * 2.54]);
      tails.push([8.37 + i * 2.54, -PCB - 0.55, 2.27 + j * 2.54]);
    }
    instances(pi, new THREE.BoxGeometry(0.64, 6, 0.64), M.gold, pins);
    instances(pi, new THREE.BoxGeometry(0.64, 1.1, 0.64), M.tin, tails);

    // Processor: a package with a metal lid.
    part(pi, 22.5, 18.5, 17, 17, 0.7, M.substrate, { r: 0.3, bevel: 0.05 });
    part(pi, 23.3, 19.3, 15.4, 15.4, 1.15, M.lid, { y: 0.7, r: 1, bevel: 0.14 });
    label(pi, decals.soc, 23.3, 19.3, 15.4, 15.4, 1.85, { roughness: 0.5, metalness: 0.6 });

    // Memory, the RP1 I/O controller, power management, the Ethernet PHY.
    part(pi, 12, 18.5, 9, 14, 1, M.chip, { r: 0.25 });
    label(pi, decals.ram, 12, 18.5, 9, 14, 1);
    part(pi, 51, 24, 8.5, 8.5, 0.9, M.chip, { r: 0.2 });
    label(pi, decals.rp1, 51, 24, 8.5, 8.5, 0.9);
    part(pi, 11, 39.5, 5.5, 5.5, 0.85, M.chip, { r: 0.15 });
    label(pi, decals.pmic, 11, 39.5, 5.5, 5.5, 0.85);
    part(pi, 61, 34.5, 4.5, 4.5, 0.85, M.chip, { r: 0.15 });
    label(pi, decals.phy, 61, 34.5, 4.5, 4.5, 0.85);

    // The radio under its can, the crystal, the inductors.
    part(pi, 8, 8.5, 12, 8.5, 1.8, M.can, { r: 0.5, bevel: 0.16 });
    label(pi, decals.can, 8, 8.5, 12, 8.5, 1.8, { metalness: 0.7, roughness: 0.5 });
    part(pi, 41, 20.8, 2.6, 1.6, 0.7, M.steel, { r: 0.5 });
    part(pi, 17.5, 39.8, 3, 3, 1.6, M.ferrite, { r: 0.4 });
    part(pi, 17.5, 43.8, 3, 3, 1.6, M.ferrite, { r: 0.4 });
    part(pi, 21, 44.6, 2.4, 2.4, 1.4, M.ferrite, { r: 0.35 });

    // Small sockets: fan, clock battery, UART.
    for (const [x, z, w, d] of [[58.4, 7.2, 5.6, 2.8], [5.5, 36, 4, 2.6], [30.4, 52.4, 4.2, 2.6]]) {
      part(pi, x, z, w, d, 3.2, M.cream, { r: 0.25 });
      part(pi, x + 0.5, z + 0.55, w - 1, d - 1.1, 0.1, M.latch, { y: 3.16, r: 0.1, bevel: 0.02 });
    }

    // The two camera/display connectors and the PCIe one, each a cream
    // body with a dark latch.
    for (const x of [45.8, 50.2]) {
      part(pi, x + 0.9, 37.5, 2.5, 13, 5, M.cream, { r: 0.2 });
      part(pi, x, 37.9, 1.1, 12.2, 5.4, M.latch, { r: 0.2 });
    }
    part(pi, 0.6, 21, 3, 11, 2, M.cream, { r: 0.2 });
    part(pi, 3.4, 21.4, 1.1, 10.2, 2.3, M.latch, { r: 0.2 });

    // Power button and the status LED beside it.
    part(pi, 0.3, 40.9, 3.4, 3.4, 1.5, M.plastic, { r: 0.4 });
    part(pi, -0.8, 41.9, 1.3, 1.4, 0.9, M.cream, { y: 0.3, r: 0.2 });
    led(pi, 5.8, 0.25, 46.2, 0x3dff8a, 'status');

    // PoE pins.
    part(pi, 59.83, 41.53, 5.08, 5.08, 2.5, M.plastic, { r: 0.15 });
    instances(pi, new THREE.BoxGeometry(0.64, 6, 0.64), M.gold, [[61.1, 5.5, 42.8], [63.64, 5.5, 42.8], [61.1, 5.5, 45.34], [63.64, 5.5, 45.34]]);

    // Passives: a body and two tinned ends each.
    const caps = [];
    const res = [];
    const ends = [];
    for (const [x, z, kind] of PI_PASSIVES) {
      if (kind === 'v') {
        caps.push([x + 0.25, 0.25, z + 0.5, true]);
        ends.push([x + 0.25, 0.25, z + 0.1, true], [x + 0.25, 0.25, z + 0.9, true]);
      } else {
        (kind === 'r' ? res : caps).push([x + 0.5, kind === 'r' ? 0.18 : 0.25, z + 0.25, false]);
        ends.push([x + 0.1, kind === 'r' ? 0.18 : 0.25, z + 0.25, false], [x + 0.9, kind === 'r' ? 0.18 : 0.25, z + 0.25, false]);
      }
    }
    const lay = (list, geometry, material) => {
      const m = new THREE.InstancedMesh(geometry, material, list.length);
      const at = new THREE.Matrix4();
      const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      list.forEach(([x, y, z, turned], i) => {
        at.makeTranslation(x, y, z);
        if (turned) at.multiply(turn);
        m.setMatrixAt(i, at);
      });
      m.receiveShadow = true;
      pi.add(m);
    };
    lay(caps, new THREE.BoxGeometry(0.62, 0.5, 0.5), M.ceramic);
    lay(res, new THREE.BoxGeometry(0.62, 0.36, 0.5), M.resistor);
    lay(ends, new THREE.BoxGeometry(0.2, 0.52, 0.52), M.tin);

    // USB-C power: a rounded tube with a tongue inside.
    {
      const outer = rounded(0, 0, 8.94, 3.2, 1.3);
      outer.holes.push(rounded(0.32, 0.32, 8.3, 2.56, 1.05, THREE.Path));
      const m = shell(outer, 7.2, M.steel);
      m.position.set(11.9 - 4.47, 0.12, 50.4);
      pi.add(m);
      hollow(pi, 11.9, 1.72, 54.3, 8.2, 2.46, 6.9);
      part(pi, 8.55, 52.6, 6.7, 4.6, 0.7, M.plastic, { y: 1.37, r: 0.2, bevel: 0.05 });
    }
    // Two micro-HDMI sockets.
    for (const x of [22.55, 35.95]) {
      const outer = new THREE.Shape();
      outer.moveTo(0.9, 0); outer.lineTo(5.6, 0); outer.lineTo(6.5, 1.1); outer.lineTo(6.5, 3); outer.lineTo(0, 3); outer.lineTo(0, 1.1); outer.closePath();
      const hole = new THREE.Path();
      hole.moveTo(1.1, 0.35); hole.lineTo(5.4, 0.35); hole.lineTo(6.15, 1.25); hole.lineTo(6.15, 2.65); hole.lineTo(0.35, 2.65); hole.lineTo(0.35, 1.25); hole.closePath();
      outer.holes.push(hole);
      const m = shell(outer, 7, M.steel);
      m.position.set(x, 0.12, 50.7);
      pi.add(m);
      hollow(pi, x + 3.25, 1.62, 54.4, 5.7, 2.2, 6.7);
      part(pi, x + 1.05, 52.6, 4.4, 4.8, 0.55, M.plastic, { y: 1.5, r: 0.15, bevel: 0.04 });
    }

    // The USB stacks: 2.0 nearest the header, then 3.0 with its blue tongues.
    const usb = (z0, tongue) => {
      const W = 13.3;
      const H = 15.7;
      const D = 17.4;
      const profile = rounded(0, 0, W, H, 0.5);
      for (const v of [1.7, 8.85]) profile.holes.push(rounded(0.55, v, W - 1.1, 5.15, 0.3, THREE.Path));
      const m = shell(profile, D, M.steel);
      m.rotation.y = -Math.PI / 2;
      m.position.set(X_FRONT, 0.1, z0);
      pi.add(m);
      for (const v of [1.7, 8.85]) {
        hollow(pi, X_FRONT - 4.6, v + 0.1 + 2.575, z0 + W / 2, 9.4, 5.05, W - 1.2);
        part(pi, X_FRONT - 9, z0 + 1.15, 8.3, W - 2.3, 1.8, tongue, { y: v + 0.1 + 2.75, r: 0.2, bevel: 0.06 });
        const contacts = [];
        for (let i = 0; i < 4; i++) contacts.push([X_FRONT - 3.6, v + 0.1 + 2.72, z0 + W / 2 - 3.5 + i * 2.33]);
        instances(pi, new THREE.BoxGeometry(5, 0.08, 1), M.gold, contacts);
      }
    };
    usb(2.35, M.plastic);
    usb(20.25, M.blue);

    // Ethernet: a deeper shell, its opening notched for the plug's latch.
    {
      const z0 = 37.8;
      const W = 16;
      const H = 13.4;
      const D = 21.2;
      const profile = rounded(0, 0, W, H, 0.5);
      const hole = new THREE.Path();
      hole.moveTo(2.1, 3.1); hole.lineTo(5.9, 3.1); hole.lineTo(5.9, 1.6); hole.lineTo(10.1, 1.6); hole.lineTo(10.1, 3.1);
      hole.lineTo(13.9, 3.1); hole.lineTo(13.9, 10.9); hole.lineTo(2.1, 10.9); hole.closePath();
      profile.holes.push(hole);
      const m = shell(profile, D, M.steel);
      m.rotation.y = -Math.PI / 2;
      m.position.set(X_FRONT, 0.1, z0);
      pi.add(m);
      hollow(pi, X_FRONT - 6.1, 7.1, z0 + W / 2, 12.4, 7.7, W - 4.3);
      hollow(pi, X_FRONT - 6.1, 2.45, z0 + W / 2, 12.4, 1.6, 4.1);
      mesh(pi, new THREE.BoxGeometry(11.6, 0.5, W - 4.4), M.plastic, X_FRONT - 6.2, 10.7, z0 + W / 2);
      const contacts = [];
      for (let i = 0; i < 8; i++) contacts.push([X_FRONT - 6.5, 10.25, z0 + W / 2 - 3.57 + i * 1.02]);
      instances(pi, new THREE.BoxGeometry(9, 0.25, 0.4), M.gold, contacts);
      led(pi, X_FRONT + 0.12, 12.2, z0 + 3.2, 0x3dff8a, 'link', { w: 0.3, h: 1, d: 2.2, facing: 'x', halo: 7, spark: 3 });
      led(pi, X_FRONT + 0.12, 12.2, z0 + W - 3.2, 0xffb640, 'traffic', { w: 0.3, h: 1, d: 2.2, facing: 'x', halo: 7, spark: 3 });
    }

    // Underside: the microSD slot, empty now the SSD does the work.
    part(pi, -0.4, 21.6, 12.8, 12.4, 1.45, M.steel, { y: -PCB - 1.45, r: 0.3 });
    mesh(pi, new THREE.BoxGeometry(1.2, 0.9, 11), M.plastic, 0.3, -PCB - 0.75, 27.8);

    // The ribbon cable: out of the Pi's PCIe connector, round and up into
    // the connector under the HAT. It stays with the Pi when the stack
    // comes apart.
    pi.add(ribbon(paintRibbon()));
  }

  // -------------------------------------------------------------------------
  // The Active Cooler: an aluminium plate over the Pi's hot chips, a blower
  // that draws air down and pushes it out through the fins, and two sprung
  // pins that hold it to the board. Its own layer, so it lifts off.
  // -------------------------------------------------------------------------
  const cooler = new THREE.Group();
  root.add(cooler);
  {
    const BASE = 2.2; // the plate's underside, resting on the chips' thermal pads
    const TOP = 9.4;
    // The plate, cut to miss the header, the fan socket and the connectors.
    const plate = new THREE.Shape();
    for (const [i, [x, z]] of [[21.5, 9], [57.5, 9], [57.5, 11.5], [62, 11.5], [62, 36.8], [21.5, 36.8], [21.5, 47.5], [10, 47.5], [10, 17.8], [21.5, 17.8]].entries()) plate[i ? 'lineTo' : 'moveTo'](x, z);
    plate.closePath();
    const slab = new THREE.ExtrudeGeometry(plate, { depth: 1.2, bevelEnabled: false });
    slab.rotateX(Math.PI / 2);
    mesh(cooler, slab, M.alloy, 0, BASE + 1.2, 0);
    // Thermal pads: on the memory, the RP1, the power chip. The processor's
    // lid meets the plate directly.
    for (const [x, z, w, d, y] of [[12.6, 19.5, 7.8, 12, 1], [51.6, 24.6, 7.3, 7.3, 0.9], [11.4, 39.9, 4.7, 4.7, 0.85]]) part(cooler, x, z, w, d, BASE - y, M.pad, { y, r: 0.2, bevel: 0.04 });
    part(cooler, 24, 20, 14, 14, BASE - 1.85, M.pad, { y: 1.85, r: 0.2, bevel: 0.04 });

    // The blower's housing: a block with the fan's well cut through it.
    const fan = { x: 35.5, z: 23, r: 11.2 };
    const housing = rounded(22, 9.5, 27, 27, 1.2);
    housing.holes.push(circle(fan.x, fan.z, fan.r));
    const walls = new THREE.ExtrudeGeometry(housing, { depth: TOP - BASE - 1.2, bevelEnabled: false, curveSegments: 24 });
    walls.rotateX(Math.PI / 2);
    mesh(cooler, walls, M.alloy, 0, TOP, 0);
    const well = new THREE.Mesh(new THREE.CylinderGeometry(fan.r, fan.r, TOP - BASE - 1.3, 40, 1, true), M.hollow);
    well.position.set(fan.x, (TOP + BASE + 1.2) / 2, fan.z);
    cooler.add(well);
    // The impeller: a hub, a ring of blades and a rim, turned by tick().
    const impeller = new THREE.Group();
    impeller.position.set(fan.x, BASE + 1.3, fan.z);
    cooler.add(impeller);
    mesh(impeller, new THREE.CylinderGeometry(4.6, 4.8, 5.2, 32), M.plastic, 0, 2.6, 0);
    const blade = new THREE.BoxGeometry(5.6, 4.6, 0.35);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const b = mesh(impeller, blade, M.plastic, Math.cos(a) * 7.6, 2.5, Math.sin(a) * 7.6);
      b.rotation.y = -a + 0.6;
    }
    const rim = mesh(impeller, new THREE.TorusGeometry(10.3, 0.35, 8, 48), M.plastic, 0, 4.9, 0);
    rim.rotation.x = Math.PI / 2;
    const hub = label(impeller, decals.fan, -4.2, -4.2, 8.4, 8.4, 5.2, { roughness: 0.4 });
    hub.castShadow = false;
    spin = impeller;

    // The fins the air leaves through, running toward the USB ports.
    const fins = [];
    for (let z = 18.1; z < 36.6; z += 1.45) fins.push([55.6, (TOP + BASE + 1.2) / 2, z]);
    instances(cooler, new THREE.BoxGeometry(12.4, TOP - BASE - 1.2, 0.5), M.alloy, fins);
    // A few low fins over the power chip.
    const low = [];
    for (let x = 11.2; x < 21; x += 1.6) low.push([x, BASE + 2.2, 42.4]);
    instances(cooler, new THREE.BoxGeometry(0.5, 2, 9.4), M.alloy, low);

    // The pins, each with its spring.
    const top = BASE + 1.2;
    for (const [x, z] of [[59.6, 14.4], [15.8, 35.2]]) {
      mesh(cooler, new THREE.CylinderGeometry(0.9, 0.9, top + 4 + PCB + 1.2, 14), M.cream, x, (top + 4 - PCB - 1.2) / 2, z);
      mesh(cooler, new THREE.CylinderGeometry(1.9, 1.9, 0.9, 20), M.cream, x, top + 4.2, z);
      mesh(cooler, new THREE.CylinderGeometry(1.45, 1.45, 3.6, 14), M.steel, x, top + 1.9, z);
    }

    // The fan's lead, round to the socket marked FAN.
    const lead = new THREE.CatmullRomCurve3([[49, 7.6, 12], [52, 8.2, 8.6], [57, 7, 7.6], [60.6, 5, 8.2], [61.2, 3.3, 8.6]].map((p) => new THREE.Vector3(...p)));
    mesh(cooler, new THREE.TubeGeometry(lead, 24, 0.55, 8), M.plastic);
    part(cooler, 58.9, 7.5, 4.6, 2.2, 1.6, M.cream, { y: 2.6, r: 0.2 });
  }

  // -------------------------------------------------------------------------
  // Between the boards: standoffs, the stacking header, screws
  // -------------------------------------------------------------------------
  const standoffs = new THREE.Group();
  const header = new THREE.Group();
  const screwsTop = new THREE.Group();
  const screwsBottom = new THREE.Group();
  root.add(standoffs, header, screwsTop, screwsBottom);
  {
    const hex = new THREE.CylinderGeometry(2.75, 2.75, GAP, 6);
    hex.rotateY(Math.PI / 6);
    for (const [x, z] of HOLES) {
      mesh(standoffs, hex, M.brass, x, GAP / 2, z);
      screwsTop.add(screw(M.steel, M.plastic, x, 0, z));
      const under = screw(M.steel, M.plastic, x, -PCB, z);
      under.rotation.x = Math.PI;
      screwsBottom.add(under);
    }

    // The header that carries the 40 pins up through the HAT.
    part(header, 7.1, 1, 50.8, 5.08, GAP - 2.5, M.plastic, { y: 2.5, r: 0.15, bevel: 0.1 });
    const pins = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) pins.push([8.37 + i * 2.54, GAP + (PCB + 5.4) / 2, 2.27 + j * 2.54]);
    instances(header, new THREE.BoxGeometry(0.5, PCB + 5.4, 0.5), M.gold, pins);
  }

  // -------------------------------------------------------------------------
  // The P33 HAT (its top face at this group's y = 0)
  // -------------------------------------------------------------------------
  const hat = new THREE.Group();
  root.add(hat);
  const driveMid = HAT.drive.z + 11;
  {
    const outline = rounded(0, 0, HAT.w, HAT.d, 3);
    for (const [x, z] of HOLES) outline.holes.push(circle(x, z, 1.4));
    for (const vent of HAT.vents) outline.holes.push(rounded(...vent, 2, THREE.Path));
    const black = { roughness: 0.42, clearcoat: 0.4, bumpScale: 1.2 };
    hat.add(board(outline, PCB, mask(paintHatTop(detail, drive), black), mirrored(mask(paintHatBottom(detail * 0.5), black)), M.darkLaminate));

    // M.2 socket, with the slot the drive's edge slides into.
    const s = HAT.socket;
    part(hat, s.x, s.z, s.w, s.d, 4.1, M.plastic, { r: 0.3, bevel: 0.12 });
    part(hat, s.x + s.w - 0.5, s.z + 0.5, 0.56, s.d - 1, 1.1, M.cream, { y: DRIVE_Y - 0.15, r: 0.1, bevel: 0.04 });
    part(hat, s.x + 1.6, s.z - 0.7, 2.4, 1.1, 1.6, M.tin, { r: 0.15 });
    part(hat, s.x + 1.6, s.z + s.d - 0.4, 2.4, 1.1, 1.6, M.tin, { r: 0.15 });

    // Underneath: the ribbon's connector, and the socket that takes the
    // Pi's four PoE pins.
    const f = HAT.ffc;
    part(hat, f.x, f.z, 3, f.d, 2, M.cream, { y: -PCB - 2, r: 0.2 });
    part(hat, f.x - 0.5, f.z + 0.4, 1.1, f.d - 0.8, 2.3, M.latch, { y: -PCB - 2.3, r: 0.2 });
    part(hat, HAT.poe[0][0] - 1.27, HAT.poe[0][1] - 1.27, 5.08, 5.08, 8.5, M.plastic, { y: -PCB - 8.5, r: 0.15 });
    instances(hat, new THREE.BoxGeometry(0.5, 1.1, 0.5), M.tin, HAT.poe.map(([x, z]) => [x, 0.55, z]));

    // The 3.3 V supply for the drive, and a few passives round it.
    part(hat, 23.4, 8.1, 3, 3, 0.9, M.chip, { r: 0.12 });
    label(hat, decals.hatReg, 23.4, 8.1, 3, 3, 0.9);
    part(hat, 28, 7.9, 3.4, 3.4, 1.7, M.ferrite, { r: 0.45 });
    const caps = [];
    for (const [x, z] of [[16, 8.4], [17.4, 8.4], [18.8, 8.4], [20.6, 9.6], [33, 8.4], [34.6, 8.4], [36.4, 9.4], [10.4, 38.4], [10.4, 46.4], [36, 46.2], [37.6, 46.2], [41.2, 39.4], [59.4, 49], [66, 51.4], [67.6, 51.4], [84.4, 42], [84.4, 44], [84.4, 50]]) caps.push([x + 0.5, 0.25, z + 0.25]);
    instances(hat, new THREE.BoxGeometry(1, 0.5, 0.5), M.ceramic, caps);

    // The PoE supply. A transformer: a ferrite core, taped round the
    // middle, on a base with a row of pins down each side.
    const t = HAT.transformer;
    part(hat, t.x, t.z, t.w, t.d, 1.4, M.plastic, { r: 0.3 });
    part(hat, t.x + 0.6, t.z + 1.2, t.w - 1.2, t.d - 2.4, 6.2, M.ferrite, { y: 1.4, r: 0.5, bevel: 0.2 });
    part(hat, t.x + 3.2, t.z + 1.05, t.w - 6.4, t.d - 2.1, 6.4, M.tape, { y: 1.3, r: 0.3, bevel: 0.1 });
    const legs = [];
    for (let i = 0; i < 6; i++) legs.push([t.x + 1.5 + i * 2, 0.35, t.z - 0.45], [t.x + 1.5 + i * 2, 0.35, t.z + t.d + 0.45]);
    instances(hat, new THREE.BoxGeometry(0.6, 0.7, 1.1), M.tin, legs);
    // The PoE controller, the output inductor, the two bridge rectifiers.
    part(hat, 36, 39.6, 4.4, 4.4, 0.9, M.chip, { r: 0.15 });
    part(hat, 67.5, 38, 5, 5, 3, M.ferrite, { r: 0.8, bevel: 0.2 });
    part(hat, 77, 38.6, 4.6, 4, 1.5, M.chip, { r: 0.15 });
    part(hat, 77, 45.4, 4.6, 4, 1.5, M.chip, { r: 0.15 });
    // The bulk capacitor: an aluminium can in a dark sleeve.
    const c = HAT.cap;
    mesh(hat, new THREE.CylinderGeometry(c.r, c.r, 7.6, 32), M.sleeve, c.x, 3.8, c.z);
    mesh(hat, new THREE.CylinderGeometry(c.r - 0.35, c.r - 0.35, 0.12, 32), M.can, c.x, 7.62, c.z);
    part(hat, c.x - c.r - 0.3, c.z - c.r - 0.3, c.r * 2 + 0.6, c.r * 2 + 0.6, 0.5, M.plastic, { r: 0.8, bevel: 0.05 });

    // A post at each drive length; the drive's screw goes into one.
    for (const x of Object.values(HAT.posts)) {
      const post = new THREE.CylinderGeometry(1.75, 1.75, DRIVE_Y, 20);
      mesh(hat, post, M.brass, x, DRIVE_Y / 2, driveMid);
    }

    for (const [i, [x, z]] of HAT.leds.entries()) led(hat, x, 0.25, z, 0x3dff8a, i ? 'disk' : 'power', { w: 1, d: 0.5, halo: 6, spark: 2.6 });
  }

  // -------------------------------------------------------------------------
  // The SSD (its underside at this group's y = 0)
  // -------------------------------------------------------------------------
  const ssd = new THREE.Group();
  const ssdScrew = new THREE.Group();
  hat.add(ssd, ssdScrew);
  {
    const outline = new THREE.Shape();
    outline.moveTo(0, 0);
    outline.lineTo(len, 0);
    outline.lineTo(len, 11 - 1.75);
    outline.absarc(len, 11, 1.75, -Math.PI / 2, Math.PI / 2, true);
    outline.lineTo(len, 22);
    outline.lineTo(0, 22);
    outline.lineTo(0, 17.2); // the M key
    outline.lineTo(1.6, 17.2);
    outline.absarc(1.6, 16.6, 0.6, Math.PI / 2, -Math.PI / 2, true);
    outline.lineTo(0, 16);
    outline.closePath();
    const top = mask(paintDrive(detail * (len > 42 ? 1 : 1.4), len), { roughness: 0.4, clearcoat: 0.5, bumpScale: 1 });
    const card = board(outline, 0.8, top, new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.45 }), M.darkLaminate);
    card.position.y = 0.8;
    ssd.add(card);

    const caps = [[4.2, 3], [5.6, 3], [7, 3], [8.4, 4.4], [4.4, 19.6], [8.6, 19.8]];
    part(ssd, 5, 16, 2.4, 2.4, 0.7, M.chip, { y: 0.8, r: 0.1 });
    if (decals.label) {
      // The 2280: single-sided, the controller and two flash packages in a
      // row, all under one long label.
      part(ssd, 12, 7, 8, 8, 0.9, M.chip, { y: 0.8, r: 0.15 });
      part(ssd, 26, 3, 12, 16, 1, M.chip, { y: 0.8, r: 0.2 });
      part(ssd, 42, 3, 12, 16, 1, M.chip, { y: 0.8, r: 0.2 });
      label(ssd, decals.label, 9.5, 2, 61, 18, 1.8, { roughness: 0.5 });
      caps.push([58, 5], [59.6, 5], [58, 16.4], [72.4, 8], [72.4, 10], [72.4, 13.4], [74.4, 13.4]);
    } else {
      part(ssd, 4, 7.5, 7, 7, 0.9, M.chip, { y: 0.8, r: 0.15 });
      label(ssd, decals.controller, 4, 7.5, 7, 7, 1.7);
      part(ssd, 13, 3, 12, 16, 1, M.chip, { y: 0.8, r: 0.2 });
      label(ssd, decals.sticker, 12.5, 2.5, 13, 17, 1.8, { roughness: 0.62 });
      if (len >= 42) part(ssd, 27, 4, 11, 14, 1, M.chip, { y: 0.8, r: 0.2 });
      if (len >= 60) part(ssd, 42, 4, 11, 14, 1, M.chip, { y: 0.8, r: 0.2 });
      caps.push([9, 16.6], [10.4, 16.6]);
    }
    instances(ssd, new THREE.BoxGeometry(1, 0.5, 0.5), M.ceramic, caps.map(([x, z]) => [x + 0.5, 1.05, z + 0.25]));

    ssdScrew.add(screw(M.steel, M.plastic, len, 0.8, 11, { scale: 0.86, thread: 2.3 }));
  }
  ssd.position.set(HAT.drive.x, DRIVE_Y, HAT.drive.z);
  ssdScrew.position.copy(ssd.position);

  // Where the annotations point.
  const anchors = { ssd: new THREE.Object3D(), hat: new THREE.Object3D(), cooler: new THREE.Object3D(), pi: new THREE.Object3D() };
  anchors.cooler.position.set(35.5, 9.4, 23);
  cooler.add(anchors.cooler);
  anchors.ssd.position.set(Math.min(len - 7, 36), 1.9, 11);
  ssd.add(anchors.ssd);
  anchors.hat.position.set(HAT.transformer.x + 6.5, 7.7, HAT.transformer.z + 5.5);
  hat.add(anchors.hat);
  anchors.pi.position.set(31, 1.9, 27);
  pi.add(anchors.pi);

  const ease = (t) => t * t * (3 - 2 * t);
  const span = (v, a, b) => ease(Math.min(1, Math.max(0, (v - a) / (b - a))));

  /**
   * Takes the stack apart.
   *   open    0 assembled .. 1 every layer floating above the one below
   *   lift    0..1, raises the SSD further out of its slot
   *   clear   0..1, carries the HAT and what holds it up and out of the way
   *   bare    0..1, carries the cooler off after them, leaving the Pi alone
   */
  function pose(open, lift = 0, clear = 0, bare = 0) {
    const away = ease(clear) * 150;
    cooler.position.y = span(open, 0.4, 1) * 6 + ease(clear) * 8 + ease(bare) * 150;
    screwsTop.position.y = HAT_TOP + span(open, 0, 0.55) * 46 + away * 1.15;
    ssdScrew.position.y = DRIVE_Y + span(open, 0.05, 0.6) * 24 + lift * 8;
    ssd.position.y = DRIVE_Y + span(open, 0.12, 0.75) * 13 + lift * 7;
    hat.position.y = HAT_TOP + span(open, 0.2, 0.95) * 30 + away;
    header.position.y = span(open, 0.3, 1) * 13 + away * 0.9;
    standoffs.position.y = span(open, 0.35, 1) * 7 * (1 - ease(clear));
    screwsBottom.position.y = -span(open, 0.1, 0.8) * 9;
  }
  pose(0);

  /** Runs the LEDs and the fan. power 0..1 fades the LEDs up, for the
   *  switch-on; still holds the fan where it is. */
  function tick(time, power = 1, still = false) {
    if (!still) spin.rotation.y = -time * 9;
    for (const l of leds) {
      let k = 1;
      const beat = (rate) => noise(Math.floor(time * rate) + l.seed);
      if (l.kind === 'traffic') k = beat(1.1) > 0.25 && beat(17) > 0.42 ? 1 : 0.12;
      else if (l.kind === 'disk') k = beat(0.7) > 0.45 && beat(23) > 0.5 ? 1 : 0.06;
      else if (l.kind === 'status') k = beat(0.9) > 0.6 && beat(11) > 0.6 ? 0.25 : 1;
      k *= power;
      l.body.material.color.copy(l.base).multiplyScalar(0.25 + k * 1.6);
      l.halo.material.opacity = 0.75 * k;
      l.spark.material.opacity = 0.9 * k;
    }
  }

  return { root, anchors, pose, tick, layers: { pi, cooler, hat, ssd } };
}

function noise(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** A pan-head screw with a cross in it: the head's underside at y, its
 *  thread hanging `thread` millimetres below. */
function screw(steel, dark, x, y, z, { scale = 1, thread: length = 4.6 } = {}) {
  const g = new THREE.Group();
  const profile = [[0, 0], [2.6, 0], [2.6, 0.2], [2.45, 0.7], [1.9, 1.22], [1.1, 1.46], [0, 1.5]].map(([r, h]) => new THREE.Vector2(r, h));
  const head = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), steel);
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, length, 14), steel);
  thread.position.y = -length / 2;
  for (const m of [head, thread]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  for (const turn of [0, Math.PI / 2]) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 0.36), dark);
    slot.position.y = 1.28;
    slot.rotation.y = turn;
    g.add(slot);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  return g;
}

/** The PCIe ribbon: a strip following a C-shaped path from the Pi's
 *  connector up to where the HAT's sits, under the board, when the stack
 *  is assembled. */
function ribbon(texture) {
  const top = GAP - 1;
  const path = new THREE.CurvePath();
  path.add(new THREE.LineCurve(new THREE.Vector2(3.2, 1), new THREE.Vector2(0.4, 1)));
  path.add(new THREE.CubicBezierCurve(new THREE.Vector2(0.4, 1), new THREE.Vector2(-7, 1), new THREE.Vector2(-7, top), new THREE.Vector2(0.4, top)));
  path.add(new THREE.LineCurve(new THREE.Vector2(0.4, top), new THREE.Vector2(3.2, top)));
  const pts = path.getSpacedPoints(48);
  const z0 = 22.25;
  const z1 = 30.75;
  const position = [];
  const uv = [];
  const index = [];
  pts.forEach((p, i) => {
    position.push(p.x, p.y, z0, p.x, p.y, z1);
    uv.push(i / (pts.length - 1), 0, i / (pts.length - 1), 1);
    if (i) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.42, metalness: 0.15 }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
