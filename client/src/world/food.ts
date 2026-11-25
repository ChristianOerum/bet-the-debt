// Everything on the bar's menu (and in the fridge) as a little 3D thing you can hold: glasses
// with the drink in them (going down as you sip), and the food itself (getting smaller as you
// eat). Real sizes, in metres; the origin is the bottom middle, standing upright.
import * as THREE from 'three';
import { flat, matte, toon } from './materials';

export interface FoodModel {
  group: THREE.Group;
  /** How much is left, 1 (full) to 0. */
  setLeft(frac: number): void;
  /** Glasses tip right up to drink; plates and buns barely tilt. */
  drink: boolean;
  /** Anything that moves on its own (a flame, a muzzle flash). */
  update?(time: number): void;
  /** A gun: held out in front, pointing where you look (the barrel is along -z). */
  aim?: boolean;
  /** Bang: a flash at the muzzle. */
  fire?(): void;
}

// ---- bits and pieces ----------------------------------------------------------------

const glassMat = () => new THREE.MeshLambertMaterial({ color: '#dff0f4', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
const liquid = (color: string, opacity = 0.92) => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.18, transparent: opacity < 1, opacity });

function add(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/**
 * A straight-sided glass (pint, highball, rocks, shot) with fluid in it. `rTop`/`rBot` are
 * the glass's radii, `h` its height, `fill` how far up it is full (0-1). Returns setLeft.
 */
function tumbler(g: THREE.Group, o: { rTop: number; rBot: number; h: number; fill: number; drink: string; opacity?: number; head?: string; headH?: number }) {
  const glass = add(g, new THREE.CylinderGeometry(o.rTop, o.rBot, o.h, 24, 1, true), glassMat(), 0, o.h / 2, 0);
  glass.renderOrder = 3;
  add(g, new THREE.CylinderGeometry(o.rBot, o.rBot, 0.008, 24), glassMat(), 0, 0.004, 0).renderOrder = 3; // the thick bottom
  const inner = (y: number) => (o.rBot + (o.rTop - o.rBot) * (y / o.h)) * 0.93;
  const fluid = add(g, new THREE.CylinderGeometry(1, 1, 1, 24), liquid(o.drink, o.opacity ?? 0.92));
  fluid.renderOrder = 1;
  const head = o.head ? add(g, new THREE.CylinderGeometry(1, 1, 1, 24), matte(o.head)) : null;
  if (head) head.renderOrder = 2;
  return (frac: number) => {
    const top = Math.max(0.004, o.h * o.fill * frac) + 0.008;
    const bot = 0.008;
    fluid.visible = frac > 0.01;
    fluid.scale.set(inner(top), top - bot, inner(top));
    fluid.position.y = (top + bot) / 2;
    if (head) {
      const hh = (o.headH ?? 0.014) * Math.min(1, frac * 1.5);
      head.visible = frac > 0.05;
      head.scale.set(inner(top + hh), hh, inner(top + hh));
      head.position.y = top + hh / 2;
    }
  };
}

/** A stemmed glass: foot, stem, and a bowl on top. The bowl is a cone (martini) or a cup (coupe). */
function stemmed(g: THREE.Group, o: { stem: number; bowlR: number; bowlH: number; cone: boolean; drink: string; opacity?: number }) {
  add(g, new THREE.CylinderGeometry(0.03, 0.032, 0.004, 24), glassMat(), 0, 0.002, 0).renderOrder = 3;
  add(g, new THREE.CylinderGeometry(0.003, 0.004, o.stem, 8), glassMat(), 0, o.stem / 2, 0).renderOrder = 3;
  const bowlGeo = o.cone ? new THREE.CylinderGeometry(o.bowlR, 0.004, o.bowlH, 24, 1, true) : new THREE.CylinderGeometry(o.bowlR, o.bowlR * 0.55, o.bowlH, 24, 1, true);
  add(g, bowlGeo, glassMat(), 0, o.stem + o.bowlH / 2, 0).renderOrder = 3;
  const fluid = add(g, new THREE.CylinderGeometry(1, o.cone ? 0.04 : 0.55, 1, 24), liquid(o.drink, o.opacity ?? 0.85));
  fluid.renderOrder = 1;
  return (frac: number) => {
    // A cone holds most of its drink near the top, so the level drops slowly at first.
    const level = o.cone ? Math.cbrt(frac) : Math.sqrt(frac);
    const h = Math.max(0.002, o.bowlH * 0.85 * level);
    const r = o.cone ? o.bowlR * 0.92 * (h / o.bowlH) + 0.004 : o.bowlR * (0.55 + 0.45 * (h / o.bowlH)) * 0.92;
    fluid.visible = frac > 0.01;
    fluid.scale.set(r, h, r);
    fluid.position.y = o.stem + h / 2 + 0.002;
  };
}

function ice(g: THREE.Group, n: number, r: number, y: number) {
  const mat = new THREE.MeshLambertMaterial({ color: '#f4fbff', transparent: true, opacity: 0.7 });
  const cubes: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = add(g, new THREE.BoxGeometry(0.022, 0.022, 0.022), mat, Math.cos(a) * r, y + (i % 2) * 0.018, Math.sin(a) * r);
    c.rotation.set(a, a * 1.3, 0.4);
    c.renderOrder = 2;
    cubes.push(c);
  }
  return cubes;
}

function straw(g: THREE.Group, color: string, h: number, x = 0.01) {
  const s = add(g, new THREE.CylinderGeometry(0.003, 0.003, h, 6), matte(color), x, h / 2 + 0.02, 0.005);
  s.rotation.z = -0.18;
}

/** A slice of citrus on the rim. */
function slice(g: THREE.Group, color: string, x: number, y: number) {
  const s = add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.004, 16, 1, false, 0, Math.PI), toon(color), x, y, 0);
  s.rotation.set(Math.PI / 2, 0, Math.PI / 2);
}

// ---- the drinks -----------------------------------------------------------------------

function pint(drink: string, head: string): FoodModel {
  const g = new THREE.Group();
  const set = tumbler(g, { rTop: 0.042, rBot: 0.033, h: 0.15, fill: 0.85, drink, head, headH: 0.016 });
  return { group: g, setLeft: set, drink: true };
}

function highball(drink: string, opts: { ice?: boolean; straw?: string; garnish?: (g: THREE.Group) => void; opacity?: number; head?: string } = {}): FoodModel {
  const g = new THREE.Group();
  const set = tumbler(g, { rTop: 0.034, rBot: 0.031, h: 0.14, fill: 0.88, drink, opacity: opts.opacity, head: opts.head, headH: 0.006 });
  const cubes = opts.ice ? ice(g, 3, 0.014, 0.06) : [];
  if (opts.straw) straw(g, opts.straw, 0.17);
  opts.garnish?.(g);
  return {
    group: g,
    setLeft: (f) => {
      set(f);
      cubes.forEach((c, i) => (c.position.y = 0.02 + f * 0.09 + (i % 2) * 0.018));
    },
    drink: true,
  };
}

function rocks(drink: string, garnish?: (g: THREE.Group) => void): FoodModel {
  const g = new THREE.Group();
  const set = tumbler(g, { rTop: 0.04, rBot: 0.038, h: 0.085, fill: 0.7, drink });
  const cube = ice(g, 1, 0, 0.03)[0];
  cube.scale.setScalar(1.6);
  garnish?.(g);
  return {
    group: g,
    setLeft: (f) => {
      set(f);
      cube.position.y = 0.022 + f * 0.035;
    },
    drink: true,
  };
}

function shot(drink: string, opacity = 0.9, garnish?: (g: THREE.Group) => void): FoodModel {
  const g = new THREE.Group();
  const set = tumbler(g, { rTop: 0.022, rBot: 0.018, h: 0.055, fill: 0.85, drink, opacity });
  garnish?.(g);
  return { group: g, setLeft: set, drink: true };
}

function martini(): FoodModel {
  const g = new THREE.Group();
  const set = stemmed(g, { stem: 0.08, bowlR: 0.055, bowlH: 0.06, cone: true, drink: '#eef2dc', opacity: 0.55 });
  // An olive on a stick, leaning across the glass.
  const pick = add(g, new THREE.CylinderGeometry(0.0015, 0.0015, 0.08, 4), matte('#c8a060'), 0.01, 0.12, 0);
  pick.rotation.z = 0.7;
  add(g, new THREE.SphereGeometry(0.009, 10, 8), toon('#6a8a2a'), -0.005, 0.107, 0).scale.set(1, 1.3, 1);
  return { group: g, setLeft: set, drink: true };
}

function margarita(): FoodModel {
  const g = new THREE.Group();
  const set = stemmed(g, { stem: 0.07, bowlR: 0.058, bowlH: 0.04, cone: false, drink: '#dfeeaa', opacity: 0.8 });
  const rim = add(g, new THREE.TorusGeometry(0.058, 0.004, 6, 28), matte('#ffffff'), 0, 0.11, 0); // the salt
  rim.rotation.x = Math.PI / 2;
  slice(g, '#7ac043', 0.055, 0.112);
  return { group: g, setLeft: set, drink: true };
}

function absinthe(): FoodModel {
  const g = new THREE.Group();
  const set = stemmed(g, { stem: 0.04, bowlR: 0.03, bowlH: 0.05, cone: false, drink: '#7cff6a', opacity: 0.8 });
  // A slotted spoon with a sugar cube, the proper way.
  add(g, new THREE.BoxGeometry(0.08, 0.002, 0.016), matte('#c8c8c8'), 0, 0.092, 0);
  add(g, new THREE.BoxGeometry(0.012, 0.012, 0.012), matte('#ffffff'), 0, 0.1, 0);
  return { group: g, setLeft: set, drink: true };
}

function coffee(): FoodModel {
  const g = new THREE.Group();
  const china = matte('#f4f0e6');
  add(g, new THREE.CylinderGeometry(0.036, 0.032, 0.085, 22, 1, true), china, 0, 0.0425, 0).material = new THREE.MeshLambertMaterial({ color: '#f4f0e6', side: THREE.DoubleSide });
  add(g, new THREE.CylinderGeometry(0.032, 0.032, 0.006, 22), china, 0, 0.003, 0);
  const handle = add(g, new THREE.TorusGeometry(0.02, 0.006, 8, 16, Math.PI), china, 0.036, 0.045, 0);
  handle.rotation.z = -Math.PI / 2;
  const top = add(g, new THREE.CylinderGeometry(0.033, 0.033, 0.004, 22), matte('#2a1408'));
  return {
    group: g,
    setLeft: (f) => {
      top.visible = f > 0.01;
      top.position.y = 0.01 + f * 0.065;
    },
    drink: true,
  };
}

/** The house special: a rocks glass of something orange, on fire. */
function onFire(): FoodModel {
  const m = rocks('#ff7a1a');
  const flame = new THREE.Group();
  const outer = add(flame, new THREE.ConeGeometry(0.03, 0.09, 14), flat('#ff8a20', { transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.045, 0);
  const inner = add(flame, new THREE.ConeGeometry(0.016, 0.06, 12), flat('#ffe070', { transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.03, 0);
  outer.renderOrder = inner.renderOrder = 4;
  flame.position.y = 0.075;
  m.group.add(flame);
  const set = m.setLeft;
  return {
    ...m,
    setLeft: (f) => {
      set(f);
      flame.visible = f > 0.3; // it burns out as you drink it
    },
    update: (t) => {
      flame.scale.set(1 + Math.sin(t * 23) * 0.12, 1 + Math.sin(t * 17) * 0.2, 1 + Math.cos(t * 19) * 0.12);
    },
  };
}

// ---- the food -------------------------------------------------------------------------

/** Food gets eaten from one end: it shrinks along its length as you take bites. */
function bitten(g: THREE.Group, axis: 'x' | 'z' = 'x'): (frac: number) => void {
  return (f) => {
    const s = 0.25 + 0.75 * f;
    g.scale.set(axis === 'x' ? s : 1, 1, axis === 'z' ? s : 1);
    g.visible = f > 0.01;
  };
}

function burger(): FoodModel {
  const g = new THREE.Group();
  const bun = toon('#d8963c');
  add(g, new THREE.CylinderGeometry(0.05, 0.048, 0.022, 22), bun, 0, 0.011, 0);
  add(g, new THREE.CylinderGeometry(0.052, 0.052, 0.018, 22), toon('#5a3018'), 0, 0.031, 0); // patty
  const cheese = add(g, new THREE.BoxGeometry(0.085, 0.004, 0.085), toon('#ffc82a'), 0, 0.042, 0);
  cheese.rotation.y = Math.PI / 4;
  add(g, new THREE.CylinderGeometry(0.056, 0.056, 0.005, 14), toon('#5fb84a'), 0, 0.047, 0); // lettuce
  const top = add(g, new THREE.SphereGeometry(0.052, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), bun, 0, 0.05, 0);
  top.scale.y = 0.62;
  for (let i = 0; i < 10; i++) {
    const a = i * 2.4;
    const r = 0.012 + (i % 3) * 0.011;
    add(g, new THREE.SphereGeometry(0.0025, 6, 4), matte('#fff6dc'), Math.cos(a) * r, 0.08 - r * 0.25, Math.sin(a) * r).scale.set(1.6, 0.6, 1);
  }
  return { group: g, setLeft: bitten(g), drink: false };
}

function pizza(stale = false): FoodModel {
  const g = new THREE.Group();
  // A wedge of a circle: the point towards you (that end goes first), the crust away. The dough
  // is a bigger wedge than the topping, so the crust shows as a rim.
  const R = 0.13;
  const from = Math.PI - 0.32; // the wedge opens towards +z (towards you), point at the origin
  const dough = add(g, new THREE.CylinderGeometry(R, R, 0.01, 18, 1, false, from, 0.64), toon(stale ? '#c89858' : '#d89a48'), 0, 0.005, 0);
  dough.position.z = R * 0.45;
  const top = add(g, new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.004, 18, 1, false, from + 0.03, 0.58), toon(stale ? '#c8703a' : '#f07a2a'), 0, 0.011, R * 0.45);
  top.renderOrder = 1;
  for (const [x, z] of [[0, -0.048], [0.013, -0.022], [-0.006, 0.0]]) {
    add(g, new THREE.CylinderGeometry(0.011, 0.011, 0.003, 12), toon(stale ? '#7a2a1a' : '#b82a20'), x, 0.014, z);
  }
  return { group: g, setLeft: bitten(g, 'z'), drink: false };
}

function hotdog(): FoodModel {
  const g = new THREE.Group();
  const bun = add(g, new THREE.CapsuleGeometry(0.022, 0.11, 6, 12), toon('#e0a050'), 0, 0.022, 0);
  bun.rotation.x = Math.PI / 2;
  bun.scale.set(1.15, 1, 0.8);
  const sausage = add(g, new THREE.CapsuleGeometry(0.013, 0.13, 6, 10), toon('#a83a20'), 0, 0.038, 0);
  sausage.rotation.x = Math.PI / 2;
  // A wiggle of mustard along the top.
  for (let i = 0; i < 8; i++) add(g, new THREE.SphereGeometry(0.004, 6, 4), toon('#ffd420'), Math.sin(i * 1.4) * 0.006, 0.051, -0.06 + i * 0.017);
  return { group: g, setLeft: bitten(g, 'z'), drink: false };
}

function fries(): FoodModel {
  const g = new THREE.Group();
  const box = add(g, new THREE.CylinderGeometry(0.045, 0.032, 0.08, 4, 1, true), new THREE.MeshLambertMaterial({ color: '#d8262c', side: THREE.DoubleSide }), 0, 0.04, 0);
  box.rotation.y = Math.PI / 4;
  const sticks: THREE.Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.2;
    const s = add(g, new THREE.BoxGeometry(0.007, 0.075, 0.007), toon('#ffd65a'), Math.cos(a) * 0.016 * ((i % 3) + 0.3), 0.08, Math.sin(a) * 0.014 * ((i % 3) + 0.3));
    s.rotation.set(Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25);
    sticks.push(s);
  }
  return {
    group: g,
    setLeft: (f) => sticks.forEach((s, i) => (s.visible = i < Math.ceil(sticks.length * f))),
    drink: false,
  };
}

function peanuts(): FoodModel {
  const g = new THREE.Group();
  const bowl = add(g, new THREE.SphereGeometry(0.05, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#f4f0e6', side: THREE.DoubleSide }), 0, 0.04, 0);
  bowl.scale.y = 0.75;
  const nuts: THREE.Mesh[] = [];
  for (let i = 0; i < 22; i++) {
    const a = i * 2.4;
    const r = 0.008 + (i % 4) * 0.009;
    const n = add(g, new THREE.SphereGeometry(0.006, 8, 6), toon('#c88a4a'), Math.cos(a) * r, 0.03 + (i % 3) * 0.004, Math.sin(a) * r);
    n.scale.set(1.5, 0.9, 1);
    n.rotation.y = a;
    nuts.push(n);
  }
  return { group: g, setLeft: (f) => nuts.forEach((n, i) => (n.visible = i < Math.ceil(nuts.length * f))), drink: false };
}

function sandwich(): FoodModel {
  const g = new THREE.Group();
  const tri = (h: number, color: string, y: number) => {
    const m = add(g, new THREE.CylinderGeometry(0.06, 0.06, h, 3), toon(color), 0, y, 0);
    m.rotation.y = Math.PI / 6;
    return m;
  };
  let y = 0;
  for (const [h, c] of [[0.012, '#f0d8a0'], [0.006, '#5fb84a'], [0.007, '#e04030'], [0.008, '#f4c0b0'], [0.012, '#f0d8a0'], [0.006, '#ffc82a'], [0.012, '#f0d8a0']] as [number, string][]) {
    tri(h, c, y + h / 2);
    y += h;
  }
  add(g, new THREE.CylinderGeometry(0.0015, 0.0015, 0.08, 4), matte('#c8a060'), 0, y + 0.02, 0); // the cocktail stick
  add(g, new THREE.SphereGeometry(0.008, 8, 6), toon('#2a4a1a'), 0, y + 0.05, 0);
  return { group: g, setLeft: bitten(g), drink: false };
}

function lobster(): FoodModel {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.1, 0.09, 0.008, 28), matte('#f8f8f4'), 0, 0.004, 0); // the plate
  const red = toon('#d8401e');
  const body = add(g, new THREE.CapsuleGeometry(0.022, 0.06, 6, 12), red, 0, 0.03, 0);
  body.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) add(g, new THREE.SphereGeometry(0.018 - i * 0.002, 10, 8), red, 0, 0.024, 0.05 + i * 0.016).scale.set(1.3, 0.6, 0.8); // tail
  for (const side of [-1, 1]) {
    const arm = add(g, new THREE.CapsuleGeometry(0.007, 0.04, 4, 8), red, side * 0.03, 0.028, -0.05);
    arm.rotation.set(Math.PI / 2, 0, side * 0.6);
    add(g, new THREE.SphereGeometry(0.016, 10, 8), red, side * 0.045, 0.028, -0.075).scale.set(1, 0.7, 1.5); // claws
  }
  for (const side of [-1, 1]) add(g, new THREE.SphereGeometry(0.004, 6, 4), flat('#111111'), side * 0.01, 0.048, -0.03);
  const lemon = add(g, new THREE.SphereGeometry(0.014, 10, 8), toon('#ffe040'), 0.06, 0.016, 0.03);
  lemon.scale.set(1.3, 0.8, 1);
  return { group: g, setLeft: bitten(g, 'z'), drink: false };
}

// ---- guns and drugs: not on the menu, but they go in your hand all the same --------

/** A pistol, pointing along -z, the grip in the hand at the origin. With a suppressor, a long can on the end. */
function pistol(suppressed: boolean): FoodModel {
  const g = new THREE.Group();
  const steel = toon('#2a2c30');
  const dark = toon('#16171a');
  const grip = add(g, new THREE.BoxGeometry(0.028, 0.085, 0.036), toon('#3a2a20'), 0, 0.035, 0.012);
  grip.rotation.x = -0.25;
  add(g, new THREE.BoxGeometry(0.03, 0.034, 0.17), steel, 0, 0.085, -0.045); // the slide
  add(g, new THREE.BoxGeometry(0.004, 0.006, 0.012), dark, 0, 0.105, -0.12); // front sight
  add(g, new THREE.BoxGeometry(0.02, 0.006, 0.01), dark, 0, 0.105, 0.03); // back sight
  // The trigger guard.
  const guard = add(g, new THREE.TorusGeometry(0.016, 0.003, 6, 14, Math.PI), dark, 0, 0.066, -0.018);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  let muzzleZ = -0.13;
  if (suppressed) {
    const can = add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.1, 16), toon('#1c1d20'), 0, 0.085, -0.18);
    can.rotation.x = Math.PI / 2;
    muzzleZ = -0.23;
  }
  // The flash: a bright star at the muzzle for a moment after each shot.
  const flash = new THREE.Group();
  const fire = flat('#ffd070', { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const cone = add(flash, new THREE.ConeGeometry(suppressed ? 0.018 : 0.04, suppressed ? 0.05 : 0.12, 10), fire, 0, 0, -0.04);
  cone.rotation.x = -Math.PI / 2;
  add(flash, new THREE.SphereGeometry(suppressed ? 0.015 : 0.03, 10, 8), fire);
  flash.position.set(0, 0.085, muzzleZ);
  flash.visible = false;
  g.add(flash);
  let flashUntil = 0;
  let now = 0;
  return {
    group: g,
    setLeft: () => {},
    drink: false,
    aim: true,
    fire: () => {
      flashUntil = now + 0.06;
      flash.visible = true;
      flash.rotation.z = Math.random() * Math.PI;
    },
    update: (time) => {
      now = time;
      if (flash.visible && time > flashUntil) flash.visible = false;
    },
  };
}

/** A little bag of white powder. */
function baggie(): FoodModel {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.045, 0.06, 0.006), new THREE.MeshLambertMaterial({ color: '#eef4ff', transparent: true, opacity: 0.55 }), 0, 0.03, 0);
  add(g, new THREE.BoxGeometry(0.038, 0.035, 0.007), matte('#ffffff'), 0, 0.02, 0); // the powder
  add(g, new THREE.BoxGeometry(0.046, 0.004, 0.008), toon('#d83030'), 0, 0.055, 0); // the zip
  return { group: g, setLeft: () => {}, drink: false };
}

/** A dried mushroom with a purple cap. */
function mushroom(): FoodModel {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.008, 0.011, 0.05, 10), matte('#e8dcc0'), 0, 0.025, 0);
  const cap = add(g, new THREE.SphereGeometry(0.026, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon('#7a3aa8'), 0, 0.048, 0);
  cap.scale.y = 0.6;
  for (let i = 0; i < 5; i++) add(g, new THREE.SphereGeometry(0.004, 6, 4), matte('#f4ecff'), Math.cos(i * 1.3) * 0.016, 0.058, Math.sin(i * 1.3) * 0.016);
  return { group: g, setLeft: () => {}, drink: false };
}

/** A blue pill in a tiny clear tub. */
function pillTub(): FoodModel {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.045, 14, 1, true), glassMat(), 0, 0.0225, 0).renderOrder = 3;
  add(g, new THREE.CylinderGeometry(0.019, 0.019, 0.008, 14), toon('#ffffff'), 0, 0.049, 0);
  for (let i = 0; i < 3; i++) add(g, new THREE.CapsuleGeometry(0.004, 0.008, 4, 8), toon('#3a8aff'), (i - 1) * 0.008, 0.006 + i * 0.004, 0).rotation.z = Math.PI / 2;
  return { group: g, setLeft: () => {}, drink: false };
}

// ---- the menu, item by item ---------------------------------------------------------

const BUILDERS: Record<string, () => FoodModel> = {
  // food
  peanuts,
  fries,
  hotdog,
  club: sandwich,
  burger,
  pizza: () => pizza(),
  lobster,
  'old-pizza': () => pizza(true),
  // soft
  water: () => highball('#bfe4f4', { opacity: 0.35, ice: true }),
  'tap-water': () => highball('#d8e8c8', { opacity: 0.45 }),
  cola: () => highball('#3a1a0a', { ice: true, straw: '#ff3a3a', head: '#a07050' }),
  coffee,
  juice: () => highball('#ffa020', { straw: '#3a8aff' }),
  // beer
  lager: () => pint('#f0b020', '#fff8e8'),
  pilsner: () => pint('#f6cc40', '#ffffff'),
  stout: () => pint('#1a0c06', '#f0dcc0'),
  ipa: () => pint('#d8861a', '#fff0d0'),
  // cocktails
  martini,
  margarita,
  mojito: () =>
    highball('#d8f0c0', {
      opacity: 0.6,
      ice: true,
      straw: '#2ac060',
      garnish: (g) => {
        for (let i = 0; i < 4; i++) add(g, new THREE.SphereGeometry(0.009, 8, 6), toon('#3aa040'), Math.cos(i * 1.6) * 0.016, 0.13 + (i % 2) * 0.006, Math.sin(i * 1.6) * 0.016).scale.set(1.4, 0.4, 0.9);
        slice(g, '#7ac043', 0.033, 0.13);
      },
    }),
  'old-fashioned': () => rocks('#b8601a', (g) => {
    const peel = add(g, new THREE.BoxGeometry(0.04, 0.004, 0.012), toon('#ff9a20'), 0.02, 0.072, 0);
    peel.rotation.z = 0.5;
  }),
  negroni: () => rocks('#c81e2a', (g) => slice(g, '#ff9a20', 0.04, 0.08)),
  'pina-colada': () =>
    highball('#fff6dc', {
      opacity: 0.95,
      straw: '#ff6ac0',
      garnish: (g) => {
        const wedge = add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.008, 10, 1, false, 0, Math.PI / 2), toon('#ffd040'), 0.03, 0.14, 0);
        wedge.rotation.x = Math.PI / 2;
        // A paper umbrella.
        add(g, new THREE.CylinderGeometry(0.0012, 0.0012, 0.08, 4), matte('#c8a060'), -0.012, 0.17, 0).rotation.z = 0.3;
        add(g, new THREE.ConeGeometry(0.028, 0.014, 10), toon('#ff4a8a'), -0.024, 0.21, 0).rotation.z = 0.3;
      },
    }),
  'long-island': () => highball('#a85a1a', { opacity: 0.85, ice: true, straw: '#ffffff', garnish: (g) => slice(g, '#ffe040', 0.033, 0.135) }),
  'debt-collector': onFire,
  // shots
  vodka: () => shot('#f4f8ff', 0.35),
  whisky: () => rocks('#c07020'),
  tequila: () => shot('#f0e4b0', 0.6, (g) => slice(g, '#7ac043', 0.022, 0.056)),
  absinthe,
  // not from the bar
  pistol: () => pistol(false),
  'pistol-silenced': () => pistol(true),
  snow: baggie,
  'third-eye': mushroom,
  ice: pillTub,
};

/** The 3D model of a menu item, full. Unknown ids get a plain glass of water. */
export function buildFood(itemId: string): FoodModel {
  const make = BUILDERS[itemId] ?? BUILDERS.water;
  const m = make();
  m.setLeft(1);
  m.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = false;
  });
  return m;
}

/** Which menu items have a model (for tests). */
export const MODELLED = Object.keys(BUILDERS);
