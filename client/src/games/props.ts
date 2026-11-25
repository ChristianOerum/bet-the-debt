// Things several tables share: chairs, chips, cards that fly from the shoe, dice and cups.
import * as THREE from 'three';
import type { Card, SeatLocal } from '@casino/shared';
import { canvasTexture, flat, matte, toonBright } from '../world/materials';
import { faceTexture, makeCardMesh } from './blackjack/cards';

export const BRASS = () => matte('#b08a45', { emissive: '#3a2a10' });

/** A padded leather chair with its back to the outside of the table. Returns the cushion (it lights up when aimed at). */
export function addChair(parent: THREE.Object3D, s: SeatLocal, leather = '#6a2619'): THREE.MeshLambertMaterial {
  const brass = BRASS();
  const dark = matte('#1f100a');
  const backMat = matte('#4a1a11');
  const cushion = matte(leather);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const rx = Math.sin(s.angle);
  const rz = Math.cos(s.angle);
  add(new THREE.CylinderGeometry(0.26, 0.29, 0.04, 20), dark, s.x, 0.02, s.z);
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 10), brass, s.x, 0.27, s.z);
  add(new THREE.CylinderGeometry(0.3, 0.27, 0.14, 22), cushion, s.x, 0.57, s.z);
  const bx = s.x + rx * 0.31;
  const bz = s.z + rz * 0.31;
  add(new THREE.BoxGeometry(0.6, 0.5, 0.1), backMat, bx, 0.95, bz).rotation.y = s.angle;
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 20), backMat, bx, 1.2, bz).quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(rx, 0, rz),
  );
  return cushion;
}

// ---- chips ------------------------------------------------------------------------

/** A chip's face value, short: 500, 1K, 25K. */
export const chipLabel = (v: number) => (v >= 1000 ? `${v / 1000}K` : String(v));
/** Which chips to offer as buttons: the small ones always, the big ones once you could afford one. */
export const offeredChips = (values: readonly number[], chips: number) => values.filter((v) => v <= 100 || v <= chips);

export const CHIP_COLORS: [number, string][] = [
  [25_000, '#c8d0e0'],
  [10_000, '#2a2a3a'],
  [5000, '#9a5a32'],
  [1000, '#ffd34e'],
  [500, '#b07cff'],
  [100, '#3ecf8e'],
  [50, '#ff6b8b'],
  [10, '#4ac6e8'],
  [5, '#ff9f43'],
  [1, '#f4f0e6'],
];
const chipGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.018, 20);
const chipMats = new Map<number, THREE.Material>();
function chipMat(value: number, color: string) {
  let m = chipMats.get(value);
  if (!m) chipMats.set(value, (m = toonBright(color, 0.12)));
  return m;
}

/** A neat stack (or a few stacks) of chips adding up to `amount`, sitting on y = 0. */
export function chipStack(amount: number, maxPerStack = 12): THREE.Group {
  const g = new THREE.Group();
  let rest = amount;
  let n = 0;
  for (const [value, color] of CHIP_COLORS) {
    while (rest >= value && n < maxPerStack * 3) {
      const col = Math.floor(n / maxPerStack);
      const chip = new THREE.Mesh(chipGeo, chipMat(value, color));
      chip.position.set((col - 1) * 0.125 * (n >= maxPerStack ? 1 : 0), 0.01 + (n % maxPerStack) * 0.02, 0);
      chip.castShadow = true;
      g.add(chip);
      rest -= value;
      n++;
    }
  }
  return g;
}

/** Keeps one chip stack per key, rebuilding a stack only when its amount changes. */
export class ChipPiles {
  private piles = new Map<string, { amount: number; g: THREE.Group }>();
  constructor(private parent: THREE.Object3D) {}

  set(key: string, amount: number, x: number, y: number, z: number) {
    const cur = this.piles.get(key);
    if (cur && cur.amount === amount) {
      cur.g.position.set(x, y, z);
      return;
    }
    if (cur) this.parent.remove(cur.g);
    this.piles.delete(key);
    if (amount <= 0) return;
    const g = chipStack(amount);
    g.position.set(x, y, z);
    this.parent.add(g);
    this.piles.set(key, { amount, g });
  }

  /** Drop every pile whose key is not in `keep`. */
  prune(keep: Set<string>) {
    for (const [k, p] of this.piles) {
      if (keep.has(k)) continue;
      this.parent.remove(p.g);
      this.piles.delete(k);
    }
  }
}

// ---- cards ------------------------------------------------------------------------

interface Flying {
  mesh: THREE.Mesh;
  face: THREE.MeshBasicMaterial;
  card: Card | null;
  cur: THREE.Vector3;
  target: THREE.Vector3;
  flip: number;
  delay: number;
}

export interface WantedCard {
  /** null = face down */
  card: Card | null;
  pos: THREE.Vector3;
  rotY: number;
  /** Lower goes first when several new cards appear at once. */
  order: number;
}

/** Cards that slide out of the shoe to where they belong, and flip when their face is revealed. */
export class CardSet {
  private cards = new Map<string, Flying>();
  constructor(
    private parent: THREE.Object3D,
    private from: THREE.Vector3,
    private staggerS = 0.18,
  ) {}

  sync(want: Map<string, WantedCard>) {
    const drop = (key: string, c: Flying) => {
      this.parent.remove(c.mesh);
      c.face.dispose();
      this.cards.delete(key);
    };
    for (const [key, c] of this.cards) if (!want.has(key)) drop(key, c);
    const fresh: { order: number; obj: Flying }[] = [];
    for (const [key, w] of want) {
      let obj = this.cards.get(key);
      const same = obj && (obj.card === null || (w.card !== null && obj.card.rank === w.card.rank && obj.card.suit === w.card.suit));
      if (obj && !same) {
        drop(key, obj);
        obj = undefined;
      }
      if (!obj) {
        const { mesh, face } = makeCardMesh(w.card);
        mesh.position.copy(this.from);
        mesh.rotation.z = w.card ? 0 : Math.PI;
        mesh.visible = false;
        this.parent.add(mesh);
        obj = { mesh, face, card: w.card, cur: this.from.clone(), target: w.pos, flip: mesh.rotation.z, delay: 0 };
        this.cards.set(key, obj);
        fresh.push({ order: w.order, obj });
      } else if (obj.card === null && w.card) {
        obj.card = w.card;
        obj.face.map = faceTexture(w.card);
        obj.face.needsUpdate = true;
        obj.flip = 0;
      }
      obj.target = w.pos;
      obj.mesh.rotation.y = w.rotY;
    }
    fresh.sort((a, b) => a.order - b.order).forEach((f, i) => (f.obj.delay = i * this.staggerS));
  }

  update(dt: number) {
    const move = 1 - Math.exp(-dt * 11);
    const turn = 1 - Math.exp(-dt * 9);
    for (const c of this.cards.values()) {
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      c.mesh.visible = true;
      c.cur.lerp(c.target, move);
      c.mesh.rotation.z += (c.flip - c.mesh.rotation.z) * turn;
      c.mesh.position.copy(c.cur);
      c.mesh.position.y += Math.sin(c.mesh.rotation.z) * 0.11;
    }
  }

  /** Seconds until every card has landed. */
  get busy() {
    let m = 0;
    for (const c of this.cards.values()) m = Math.max(m, c.delay);
    return m;
  }

  dispose() {
    for (const c of this.cards.values()) c.face.dispose();
    this.cards.clear();
  }
}

// ---- dice and cups ----------------------------------------------------------------

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]],
};
const dieFaces = new Map<string, THREE.Material[]>();

function dieMaterials(body: string, pip: string): THREE.Material[] {
  const key = body + pip;
  let mats = dieFaces.get(key);
  if (!mats) {
    // Box faces: +x, -x, +y, -y, +z, -z. Opposite faces add up to seven.
    const values = [3, 4, 1, 6, 2, 5];
    mats = values.map((v) =>
      flat('#ffffff', {
        map: canvasTexture(64, 64, (c) => {
          c.fillStyle = body;
          c.fillRect(0, 0, 64, 64);
          c.fillStyle = pip;
          for (const [x, y] of PIPS[v]) {
            c.beginPath();
            c.arc(x * 64, y * 64, 6.5, 0, Math.PI * 2);
            c.fill();
          }
        }),
      }),
    );
    dieFaces.set(key, mats);
  }
  return mats;
}

const dieGeo = new THREE.BoxGeometry(0.075, 0.075, 0.075);

/** A die. Call showDie to turn a face up. */
export function makeDie(body = '#f3ead8', pip = '#2b2238'): THREE.Mesh {
  const m = new THREE.Mesh(dieGeo, dieMaterials(body, pip));
  m.castShadow = true;
  return m;
}

/** Turn a die so `value` faces up, with a little random twist. */
export function showDie(die: THREE.Object3D, value: number, twist = 0) {
  die.rotation.set(0, 0, 0);
  if (value === 6) die.rotation.x = Math.PI;
  else if (value === 2) die.rotation.x = -Math.PI / 2;
  else if (value === 5) die.rotation.x = Math.PI / 2;
  else if (value === 3) die.rotation.z = Math.PI / 2;
  else if (value === 4) die.rotation.z = -Math.PI / 2;
  die.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), twist);
}

/** A leather dice cup, mouth down, sitting on y = 0. */
export function makeCup(color = '#4a2416'): THREE.Group {
  const g = new THREE.Group();
  const mat = matte(color);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.24, 20, 1, true), matte(color, { side: THREE.DoubleSide }));
  body.position.y = 0.12;
  body.castShadow = true;
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), mat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.24;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 24), BRASS());
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.01;
  g.add(body, top, rim);
  return g;
}

// ---- tables -----------------------------------------------------------------------

/** A round table: felt top, padded rim, a pedestal. */
export function roundTable(radius: number, top: number, felt = '#0f5f63'): THREE.Group {
  const g = new THREE.Group();
  const wood = matte('#3f1f13');
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(radius, radius, 0.08, 40), matte(felt, { emissive: '#041f20' }), top - 0.04);
  add(new THREE.TorusGeometry(radius, 0.07, 10, 40), matte('#33140e'), top).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(radius - 0.05, radius - 0.12, 0.16, 40), wood, top - 0.16);
  add(new THREE.CylinderGeometry(0.16, 0.24, top - 0.25, 16), wood, (top - 0.25) / 2);
  add(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 24), matte('#1f100a'), 0.03);
  return g;
}

/** Writing laid flat on a table, readable from the +z side. */
export function feltPrint(w: number, h: number, draw: (c: CanvasRenderingContext2D, W: number, H: number) => void, opacity = 0.75) {
  const W = 1024;
  const H = Math.round((W * h) / w);
  const tex = canvasTexture(W, H, (c) => draw(c, W, H));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat('#ffffff', { map: tex, transparent: true, opacity }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

export const DICE_CHARS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
