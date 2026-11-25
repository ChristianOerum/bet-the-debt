// Everything beyond the main hall: the card room through the great arch, the back room
// hidden behind a bookcase, the dice parlour off to the right, and the hall's own furniture.
import * as THREE from 'three';
import { areaById, DECOR, RESTROOM, SECRET_DOOR, STATIONS, type Area } from '@casino/shared';
import { makeMirror } from './mirror';
import { buildToilet } from './pee';
import { TextSprite } from './labels';
import { canvasTexture, flat, glowPlane, glowSprite, matte, SERIF, toon } from './materials';

type Side = 'n' | 's' | 'e' | 'w';
type MatFn = (w: number, h: number) => THREE.Material;

/** The tools the main scene lends us. */
export interface RoomKit {
  /** The casino's group: everything built here goes in it. */
  scene: THREE.Object3D;
  mesh: (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D) => THREE.Mesh;
  box: (w: number, h: number, d: number) => THREE.BoxGeometry;
  buildWalls: (
    area: Area,
    style: { material: MatFn; dado?: THREE.Material; trim?: THREE.Material; crown?: THREE.Material },
    opts?: { omit?: Partial<Record<Side, [number, number][]>>; outer?: Partial<Record<Side, { a: number; b: number; material: MatFn }[]>> },
  ) => Record<Side, THREE.Group>;
  panelling: unknown;
  panelTex: unknown;
  chandelier: (x: number, z: number, s: number, power: number, drop?: number, ceiling?: number) => void;
  sconce: (g: THREE.Group, x: number, roomH?: number) => void;
  painting: (g: THREE.Group, x: number, seed: number, y?: number) => void;
  flicker: { light: THREE.PointLight; base: number; phase: number }[];
  woodDark: THREE.Material;
  brass: THREE.Material;
  hallRight: THREE.Group;
  /** The main hall's left wall (local x = -world z). */
  hallLeft: THREE.Group;
  greenPanel: MatFn;
  parlourPanel: MatFn;
  brickPanel: MatFn;
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function buildRooms(k: RoomKit) {
  const books = new Books();
  hallExtras(k);
  const secretDoor = cardRoom(k, books);
  const swing = backRoom(k);
  diceParlour(k);
  restroom(k);
  books.build(k.scene);
  return { secretDoor, update: swing };
}

// ---- shared bits ----------------------------------------------------------------------

function floorAndCeiling(k: RoomKit, a: Area, floor: THREE.Material, ceiling: THREE.Material) {
  const w = a.x1 - a.x0;
  const d = a.z1 - a.z0;
  const f = k.mesh(new THREE.PlaneGeometry(w, d), floor, (a.x0 + a.x1) / 2, 0, (a.z0 + a.z1) / 2);
  f.rotation.x = -Math.PI / 2;
  f.receiveShadow = true;
  const c = k.mesh(new THREE.PlaneGeometry(w, d), ceiling, (a.x0 + a.x1) / 2, a.height, (a.z0 + a.z1) / 2);
  c.rotation.x = Math.PI / 2;
}

function tiled(tex: THREE.Texture, w: number, d: number, size: number) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / size, d / size);
  t.needsUpdate = true;
  return t;
}

/** Every book on every shelf, drawn in one go. */
class Books {
  private mats: THREE.Matrix4[] = [];
  private cols: THREE.Color[] = [];
  private rnd = seeded(4242);
  private palette = ['#6b1d1d', '#1f3d2f', '#1d2b4a', '#5a3a1e', '#8a6a24', '#3a1f3a', '#2a2a2a', '#7a4a2a'];

  /** Fill a shelf (in `parent`'s coordinates) from x0 to x1 at height y, against z = back. */
  shelf(parent: THREE.Object3D, x0: number, x1: number, y: number, back: number) {
    parent.updateMatrixWorld(true);
    let x = x0;
    while (x < x1 - 0.05) {
      const w = 0.035 + this.rnd() * 0.045;
      if (this.rnd() < 0.06) {
        x += 0.08; // a gap
        continue;
      }
      const h = 0.2 + this.rnd() * 0.12;
      const d = 0.18 + this.rnd() * 0.08;
      const lean = this.rnd() < 0.05 ? 0.25 : 0;
      const m = new THREE.Matrix4()
        .compose(new THREE.Vector3(x + w / 2, y + h / 2, back + d / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, lean)), new THREE.Vector3(w, h, d))
        .premultiply(parent.matrixWorld);
      this.mats.push(m);
      this.cols.push(new THREE.Color(this.palette[Math.floor(this.rnd() * this.palette.length)]).multiplyScalar(0.7 + this.rnd() * 0.5));
      x += w + 0.004;
    }
  }

  build(scene: THREE.Object3D) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matte('#ffffff'), this.mats.length);
    this.mats.forEach((m, i) => {
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, this.cols[i]);
    });
    scene.add(inst);
  }
}

/** A tall bookcase against a wall, in the wall group's coordinates (local +z = into the room). */
function bookcase(k: RoomKit, books: Books, parent: THREE.Object3D, x: number, w: number, h = 3.2) {
  const wood = matte('#2e160c');
  const d = 0.45;
  k.mesh(k.box(w, h, 0.04), wood, x, h / 2, 0.02, parent);
  for (const sx of [-1, 1]) k.mesh(k.box(0.05, h, d), wood, x + (sx * (w - 0.05)) / 2, h / 2, d / 2, parent);
  k.mesh(k.box(w, 0.08, d + 0.04), wood, x, h, d / 2, parent);
  for (const y of [0.06, 0.72, 1.38, 2.04, 2.7]) {
    k.mesh(k.box(w - 0.06, 0.04, d - 0.02), wood, x, y, d / 2, parent);
    books.shelf(parent, x - w / 2 + 0.06, x + w / 2 - 0.06, y + 0.02, 0.06);
  }
}

function neonSign(text: string, color: string, w: number, h: number, font = SERIF) {
  const g = new THREE.Group();
  const tex = canvasTexture(512, Math.round((512 * h) / w), (c) => {
    const W = 512;
    const H = Math.round((512 * h) / w);
    c.fillStyle = '#120812';
    c.fillRect(0, 0, W, H);
    c.font = `italic 700 ${H * 0.62}px ${font}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = color;
    c.shadowBlur = 24;
    c.fillStyle = '#ffffff';
    c.fillText(text, W / 2, H / 2 + 4, W * 0.92);
    c.fillStyle = color;
    c.globalAlpha = 0.6;
    c.fillText(text, W / 2, H / 2 + 4, W * 0.92);
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat('#ffffff', { map: tex }));
  const glow = glowPlane(color, w * 1.7, h * 2.6, 0.45);
  glow.position.z = -0.01;
  g.add(glow, plate);
  return g;
}

// ---- the main hall's furniture ----------------------------------------------------------

function hallExtras(k: RoomKit) {
  const { mesh, box } = k;

  // A bank of slot machines along the front wall, lit up and waiting for the day they open.
  const reel = (seed: number) =>
    canvasTexture(256, 160, (c) => {
      const symbols = ['7', '★', '♦', 'BAR', '♣', '♥'];
      const rnd = seeded(seed);
      c.fillStyle = '#100a07';
      c.fillRect(0, 0, 256, 160);
      for (let i = 0; i < 3; i++) {
        c.fillStyle = '#f4ead4';
        c.fillRect(14 + i * 80, 22, 68, 116);
        c.fillStyle = ['#c8263b', '#2b2238', '#c99a2a'][i];
        c.font = `700 44px ${SERIF}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(symbols[Math.floor(rnd() * symbols.length)], 48 + i * 80, 82);
      }
      c.strokeStyle = '#e0b25a';
      c.lineWidth = 6;
      c.strokeRect(4, 4, 248, 152);
    });
  DECOR.slots.forEach((s, i) => {
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = Math.PI; // facing into the hall
    const body = matte(i % 2 ? '#5c1420' : '#1d2b4a');
    const trim = k.brass;
    mesh(box(0.9, 1.1, 0.7), body, 0, 0.55, 0, g).castShadow = true;
    mesh(box(0.92, 0.06, 0.72), trim, 0, 1.12, 0, g);
    mesh(box(0.86, 0.7, 0.55), body, 0, 1.5, -0.06, g);
    const screen = mesh(new THREE.PlaneGeometry(0.7, 0.44), flat('#ffffff', { map: reel(11 + i * 7) }), 0, 1.52, 0.225, g);
    screen.rotation.x = -0.12;
    mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.55, 20, 1, false, 0, Math.PI), body, 0, 1.86, -0.06, g).rotation.set(0, 0, Math.PI / 2);
    const lamp = glowSprite(['#ff6b8b', '#ffd34e', '#4ac6e8'][i % 3], 0.9, 0.55);
    lamp.position.set(0, 2.15, 0);
    g.add(lamp);
    mesh(box(0.7, 0.08, 0.3), trim, 0, 0.98, 0.42, g);
    mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), trim, 0.52, 1.2, 0.1, g).rotation.z = -0.25;
    mesh(new THREE.SphereGeometry(0.06, 12, 10), matte('#c8263b'), 0.58, 1.45, 0.1, g);
    k.scene.add(g);
  });
  const soon = new TextSprite(0.22);
  soon.set('SLOTS · opening soon', '#2a1a08', '#c9a24a');
  soon.sprite.position.set(-13, 2.75, 13.7);
  k.scene.add(soon.sprite);

  // A black grand piano that nobody plays.
  const p = DECOR.piano;
  const piano = new THREE.Group();
  piano.position.set(p.x, 0, p.z);
  piano.rotation.y = -0.5;
  const lacquer = matte('#0c0b0e', { emissive: '#08070a' });
  mesh(box(1.5, 0.32, 1.1), lacquer, 0, 0.88, -0.1, piano).castShadow = true;
  mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.32, 24, 1, false, 0, Math.PI), lacquer, 0, 0.88, -0.65, piano).rotation.y = Math.PI / 2;
  const lid = mesh(box(1.5, 0.03, 1.6), lacquer, 0, 1.35, -0.55, piano);
  lid.rotation.x = -0.55;
  lid.position.y = 1.4;
  mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.7, 6), k.brass, 0.6, 1.25, -0.35, piano);
  const keys = canvasTexture(256, 32, (c) => {
    c.fillStyle = '#f4efe2';
    c.fillRect(0, 0, 256, 32);
    c.fillStyle = '#111';
    for (let x = 0; x < 256; x += 7.3) c.fillRect(x, 0, 1, 32);
    for (let i = 0; i < 35; i++) if ([0, 1, 3, 4, 5].includes(i % 7)) c.fillRect(i * 7.3 + 4.5, 0, 4.5, 20);
  });
  mesh(box(1.45, 0.04, 0.22), matte('#ffffff', { map: keys }), 0, 0.92, 0.55, piano);
  for (const [x, z] of [[-0.62, 0.35], [0.62, 0.35], [0, -1.2]]) mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.72, 10), lacquer, x, 0.36, z, piano);
  mesh(box(0.9, 0.08, 0.4), matte('#2a120c'), 0, 0.5, 1.15, piano);
  for (const x of [-0.38, 0.38]) mesh(box(0.06, 0.5, 0.35), lacquer, x, 0.25, 1.15, piano);
  k.scene.add(piano);

  // Sofas round a low table, in the corner by the bar.
  lounge(k, DECOR.lounges[0].x, DECOR.lounges[0].z, 0, '#1f4a35');
}

/** Two sofas facing each other over a coffee table. */
function lounge(k: RoomKit, x: number, z: number, rot: number, velvet: string) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  const fabric = toon(velvet, { emissive: velvet, emissiveIntensity: 0.08 });
  const wood = matte('#2a120c');
  for (const side of [-1, 1]) {
    const s = new THREE.Group();
    s.position.z = side * 0.95;
    s.rotation.y = side > 0 ? Math.PI : 0;
    k.mesh(k.box(1.8, 0.4, 0.75), fabric, 0, 0.3, 0, s).castShadow = true;
    k.mesh(k.box(1.8, 0.6, 0.18), fabric, 0, 0.7, -0.3, s);
    for (const ax of [-0.85, 0.85]) k.mesh(k.box(0.16, 0.55, 0.75), fabric, ax, 0.45, 0, s);
    for (const lx of [-0.8, 0.8]) for (const lz of [-0.3, 0.3]) k.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), wood, lx, 0.06, lz, s);
    g.add(s);
  }
  k.mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 24), wood, 0, 0.42, 0, g);
  k.mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.4, 10), wood, 0, 0.2, 0, g);
  const glass = flat('#cfe3ea', { transparent: true, opacity: 0.45 });
  k.mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.12, 10, 1, true), glass, 0.15, 0.5, 0.1, g);
  k.mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.brass, -0.15, 0.445, -0.08, g);
  k.scene.add(g);
}

// ---- the card room -----------------------------------------------------------------

function cardRoom(k: RoomKit, books: Books): THREE.Object3D {
  const A = areaById('card');
  const parquet = canvasTexture(256, 256, (c) => {
    const rnd = seeded(99);
    for (let y = 0; y < 256; y += 32) {
      for (let x = 0; x < 256; x += 128) {
        const off = (y / 32) % 2 ? 64 : 0;
        const v = 60 + rnd() * 25;
        c.fillStyle = `rgb(${v + 30}, ${v * 0.6}, ${v * 0.35})`;
        c.fillRect(x + off - 128, y, 126, 30);
        c.fillRect(x + off, y, 126, 30);
      }
    }
  });
  floorAndCeiling(k, A, matte('#ffffff', { map: tiled(parquet, 28, 13, 2) }), matte('#1a0e08'));
  for (const z of [-24, -19.5]) k.mesh(k.box(A.x1 - A.x0, 0.3, 0.36), matte('#2f170d'), 0, A.height - 0.15, z);

  const walls = k.buildWalls(
    A,
    { material: k.greenPanel, dado: k.woodDark, trim: k.brass, crown: k.woodDark },
    {
      omit: { s: [[A.x0, A.x1]] }, // the hall's wall already stands there
      outer: { w: [{ a: -28, b: -20, material: k.brickPanel }] }, // the back room sees this side
    },
  );

  // Bookcases from floor to well above your head, along the back and the left wall.
  for (let i = 0; i < 12; i++) bookcase(k, books, walls.n, -13.5 + 1.125 + i * 2.25, 2.2);
  // Left wall, local x = -(z + 21.5): leave room for the secret one.
  bookcase(k, books, walls.w, 4.9, 1.95);
  for (const x of [-4.75, -2.85, -0.95, 0.95]) bookcase(k, books, walls.w, x, 1.88);

  // The secret door: one more bookcase, on a hinge, with one red book that does not quite fit.
  const gap = (walls.w.userData.gaps as { a: number; b: number }[])[0];
  const pivot = new THREE.Group();
  pivot.position.set(gap.a, 0, 0);
  const leafW = gap.b - gap.a;
  bookcase(k, books, pivot, leafW / 2, leafW - 0.02, 2.45);
  k.mesh(k.box(0.05, 0.27, 0.22), matte('#a3161e', { emissive: '#3a0508' }), leafW * 0.62, 1.52, 0.32, pivot);
  walls.w.add(pivot);
  // Fill the space above the hidden door so it looks like the rest of the wall.
  k.mesh(k.box(leafW, 0.7, 0.45), matte('#2e160c'), (gap.a + gap.b) / 2, 2.85, 0.225, walls.w);

  // A fireplace on the right-hand wall, with a pair of armchairs in front of it.
  const e = walls.e;
  const stone = matte('#8c7a68');
  k.mesh(k.box(2.4, 2.2, 0.5), stone, 0, 1.1, 0.25, e).castShadow = true;
  k.mesh(k.box(1.4, 1.05, 0.3), flat('#0a0604'), 0, 0.6, 0.37, e);
  k.mesh(k.box(2.8, 0.12, 0.62), matte('#2e160c'), 0, 2.26, 0.3, e);
  const fireMat = flat('#ff8a2c', { transparent: true, opacity: 0.9 });
  for (const [x, h] of [[-0.3, 0.42], [0, 0.55], [0.28, 0.38]]) k.mesh(new THREE.ConeGeometry(0.14, h, 8), fireMat, x, 0.22 + h / 2, 0.34, e);
  for (const x of [-0.35, 0.35]) k.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), matte('#3a2416'), x, 0.16, 0.36, e).rotation.z = Math.PI / 2;
  const fireGlow = glowSprite('#ff8a2c', 2.4, 0.8);
  fireGlow.position.set(0, 0.6, 0.55);
  e.add(fireGlow);
  for (const x of [-1, 1]) k.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), flat('#f4ead4'), x, 2.43, 0.3, e);
  k.painting(e, 0, 7, 3.75);
  const fire = new THREE.PointLight('#ff8a3c', 16, 0, 2);
  fire.position.set(A.x1 - 0.9, 0.9, -21.5);
  k.scene.add(fire);
  k.flicker.push({ light: fire, base: 16, phase: 9 });
  for (const x of [-4.5, 4.5]) k.sconce(e, x, A.height);
  const chair = (z: number) => {
    const g = new THREE.Group();
    g.position.set(11.6, 0, z);
    g.rotation.y = Math.PI / 2; // facing the fire
    const leather = matte('#5a2214');
    k.mesh(k.box(0.8, 0.4, 0.75), leather, 0, 0.3, 0, g).castShadow = true;
    k.mesh(k.box(0.8, 0.75, 0.2), leather, 0, 0.75, -0.33, g);
    for (const ax of [-0.38, 0.38]) k.mesh(k.box(0.14, 0.55, 0.75), leather, ax, 0.42, 0, g);
    k.scene.add(g);
  };
  chair(-22.8);
  chair(-20.2);
  k.mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 20), matte('#2a120c'), 12.1, 0.58, -21.5);
  k.mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.56, 10), matte('#2a120c'), 12.1, 0.28, -21.5);

  // Green-shaded lamps low over each table.
  for (const st of STATIONS.filter((s) => s.z < -15 && s.x > A.x0 && s.x < A.x1)) {
    for (const dx of [-0.8, 0.8]) {
      k.mesh(new THREE.CylinderGeometry(0.008, 0.008, A.height - 2.75, 6), k.brass, st.x + dx, (A.height + 2.75) / 2, st.z);
      k.mesh(new THREE.ConeGeometry(0.3, 0.22, 20, 1, true), flat('#1f6a3a', { side: THREE.DoubleSide }), st.x + dx, 2.7, st.z);
      const bulb = glowSprite('#ffe3a8', 1.1, 0.7);
      bulb.position.set(st.x + dx, 2.58, st.z);
      k.scene.add(bulb);
    }
    const light = new THREE.PointLight('#ffe0b0', 24, 0, 2);
    light.position.set(st.x, 2.5, st.z);
    k.scene.add(light);
  }
  k.chandelier(0, -18, 0.7, 0, 0.6, A.height);

  const plaque = new TextSprite(0.3);
  plaque.set('THE CARD ROOM', '#2a1a08', '#c9a24a');
  plaque.sprite.position.set(0, 4.8, -15.6);
  k.scene.add(plaque.sprite);

  lounge(k, 0, -26.3, 0, '#4a1f1a');
  return pivot;
}

// ---- the back room -----------------------------------------------------------------

/** Returns a per-frame function that swings the bare bulb. */
function backRoom(k: RoomKit) {
  const A = areaById('back');
  const concrete = canvasTexture(256, 256, (c) => {
    const rnd = seeded(13);
    c.fillStyle = '#4a4744';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1200; i++) {
      const v = 50 + rnd() * 40;
      c.fillStyle = `rgba(${v},${v - 3},${v - 6},0.5)`;
      c.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 3, 2);
    }
    c.strokeStyle = 'rgba(20,18,16,0.6)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(20, 180);
    c.lineTo(90, 150);
    c.lineTo(140, 190);
    c.stroke();
  });
  floorAndCeiling(k, A, matte('#ffffff', { map: tiled(concrete, 8, 8, 3) }), matte('#231a14'));
  const walls = k.buildWalls(A, { material: k.brickPanel, crown: matte('#231a14') }, { omit: { e: [[A.z0, A.z1]] } });

  // Crates and a barrel in the corners.
  const crate = matte('#5a3c22');
  k.mesh(k.box(1.3, 0.9, 1.3), crate, -21.3, 0.45, -27.3).castShadow = true;
  k.mesh(k.box(0.9, 0.7, 0.9), crate, -21.2, 1.25, -27.2).rotation.y = 0.3;
  k.mesh(k.box(0.95, 0.8, 0.95), crate, -21.5, 0.4, -20.7).castShadow = true;
  k.mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 14), matte('#3a2a1e'), -15, 0.45, -27.4).castShadow = true;

  // Scratched on the wall: a tally of everyone who did not get lucky.
  const tally = canvasTexture(512, 256, (c) => {
    const rnd = seeded(31);
    c.clearRect(0, 0, 512, 256);
    c.strokeStyle = 'rgba(235, 225, 210, 0.75)';
    c.lineWidth = 5;
    c.lineCap = 'round';
    for (let g = 0; g < 7; g++) {
      const gx = 30 + g * 66;
      const gy = 40 + (g % 2) * 20;
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(gx + i * 11, gy + rnd() * 4);
        c.lineTo(gx + i * 11 + rnd() * 4, gy + 60);
        c.stroke();
      }
      c.beginPath();
      c.moveTo(gx - 6, gy + 50);
      c.lineTo(gx + 44, gy + 8);
      c.stroke();
    }
    c.font = `italic 700 52px ${SERIF}`;
    c.fillStyle = 'rgba(200, 40, 30, 0.85)';
    c.fillText('one in six', 120, 200);
  });
  const t = k.mesh(new THREE.PlaneGeometry(2.6, 1.3), matte('#ffffff', { map: tally, transparent: true }), 0, 1.9, 0.02, walls.n);
  t.renderOrder = 1;

  // One bare bulb on a cord, swinging slowly over the table.
  const pivot = new THREE.Group();
  pivot.position.set(-18, A.height, -24);
  const cordLen = 1.15;
  k.mesh(new THREE.CylinderGeometry(0.006, 0.006, cordLen, 4), flat('#111'), 0, -cordLen / 2, 0, pivot);
  k.mesh(new THREE.SphereGeometry(0.06, 12, 10), flat('#fff2c8'), 0, -cordLen - 0.05, 0, pivot);
  const halo = glowSprite('#ffcf8a', 1.4, 0.9);
  halo.position.y = -cordLen - 0.05;
  pivot.add(halo);
  const light = new THREE.PointLight('#ffcf8a', 12, 0, 2);
  light.position.y = -cordLen - 0.1;
  pivot.add(light);
  k.scene.add(pivot);
  k.flicker.push({ light, base: 12, phase: 2.2 });

  return (time: number) => {
    pivot.rotation.z = Math.sin(time * 0.9) * 0.08;
    pivot.rotation.x = Math.sin(time * 0.63 + 1) * 0.05;
  };
}

// ---- the dice parlour --------------------------------------------------------------

function diceParlour(k: RoomKit) {
  const A = areaById('dice');
  const checks = canvasTexture(128, 128, (c) => {
    c.fillStyle = '#e8dcc4';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#1a1416';
    c.fillRect(0, 0, 64, 64);
    c.fillRect(64, 64, 64, 64);
  });
  floorAndCeiling(k, A, matte('#c8bcb0', { map: tiled(checks, 11, 14, 1.2) }), matte('#1a0f1e'));
  const walls = k.buildWalls(
    A,
    { material: k.parlourPanel, dado: k.woodDark, trim: k.brass, crown: k.woodDark },
    { omit: { w: [[5, 15]] } }, // the hall's wall stands there
  );

  // Neon on the walls: e side local x = z - 12, n side local x = x - 25.5.
  const dice = neonSign('DICE', '#ff4fa0', 3.4, 1.1);
  dice.position.set(0, 3.2, 0.05);
  walls.e.add(dice);
  const liar = neonSign('Liar!', '#4fe0ff', 2.4, 0.9);
  liar.position.set(0, 3.0, 0.05);
  walls.n.add(liar);
  const meyer = neonSign('Meyer', '#ffd34e', 2.6, 0.9);
  meyer.position.set(0, 3.0, 0.05);
  walls.s.add(meyer);

  // Over the arch, on the hall side: a pointer to the dice parlour.
  const sign = neonSign('Dice Parlour', '#ff4fa0', 3.6, 0.7);
  sign.position.set(9.75, 4.25, 0.05);
  k.hallRight.add(sign);

  // A jukebox glowing in the corner.
  const jb = new THREE.Group();
  jb.position.set(30.6, 0, 12);
  jb.rotation.y = -Math.PI / 2;
  const wood = matte('#3a1a10');
  k.mesh(k.box(1.1, 1.3, 0.6), wood, 0, 0.65, 0, jb).castShadow = true;
  k.mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 24, 1, false, 0, Math.PI), wood, 0, 1.3, 0, jb).rotation.set(Math.PI / 2, 0, -Math.PI / 2);
  const stripes = canvasTexture(128, 128, (c) => {
    const g = c.createLinearGradient(0, 0, 128, 0);
    ['#ff4fa0', '#ffd34e', '#4fe0ff', '#7bff8a', '#ff4fa0'].forEach((col, i) => g.addColorStop(i / 4, col));
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  k.mesh(new THREE.PlaneGeometry(0.8, 0.9), flat('#ffffff', { map: stripes }), 0, 0.9, 0.31, jb);
  const glow = glowSprite('#ff8ad8', 2, 0.5);
  glow.position.set(0, 1.2, 0.5);
  jb.add(glow);
  k.scene.add(jb);

  for (const x of [-4, 4]) k.sconce(walls.e, x, A.height);
  // Low warm lamps over each table.
  for (const st of STATIONS.filter((s) => s.x > A.x0 && s.x < A.x1 && s.z > A.z0 && s.z < A.z1)) {
    k.mesh(new THREE.CylinderGeometry(0.008, 0.008, A.height - 2.4, 6), k.brass, st.x, (A.height + 2.4) / 2, st.z);
    k.mesh(new THREE.ConeGeometry(0.4, 0.26, 20, 1, true), flat('#7a1f4a', { side: THREE.DoubleSide }), st.x, 2.35, st.z);
    const bulb = glowSprite('#ffd7a8', 1.4, 0.7);
    bulb.position.set(st.x, 2.22, st.z);
    k.scene.add(bulb);
    const light = new THREE.PointLight('#ffd0b0', 18, 0, 2);
    light.position.set(st.x, 2.1, st.z);
    k.scene.add(light);
  }
}

// ---- the restrooms -----------------------------------------------------------------

/** Wall tiles, for a stretch of wall `w` by `h` metres. */
export function restroomTiles(w: number, h: number): THREE.Material {
  const tex = canvasTexture(128, 128, (c) => {
    c.fillStyle = '#b9c9c4';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#d9e6e1';
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) c.fillRect(x + 1, y + 1, 30, 30);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 0.6, h / 0.6);
  return matte('#ffffff', { map: tex });
}

/**
 * Through a door in the main hall's left wall: tiled walls, three toilet stalls along the far
 * wall (one out of order, sort of), a row of sinks under a long mirror, urinals opposite. Cold
 * light, a dripping tap, and nobody out in the casino can see in.
 */
function restroom(k: RoomKit) {
  const A = areaById('restroom');
  const R = RESTROOM;
  const floorTex = canvasTexture(128, 128, (c) => {
    c.fillStyle = '#e8e4da';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#2a2a30';
    for (let y = 0; y < 128; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < 128; x += 64) c.fillRect(x, y, 32, 32);
  });
  floorAndCeiling(k, A, matte('#ffffff', { map: tiled(floorTex, A.x1 - A.x0, A.z1 - A.z0, 1.2) }), matte('#d8dcd8'));
  const walls = k.buildWalls(A, { material: restroomTiles, crown: matte('#8a9a96') }, { omit: { e: [[A.z0, A.z1]] } });

  // The stalls: partitions, a rail along the top, a door on each (left ajar), a toilet inside.
  const partition = matte('#3d5a54');
  const chrome = matte('#c8ccd0', { emissive: '#202428' });
  for (const z of R.stalls) {
    for (const s of [-1, 1]) {
      k.mesh(k.box(R.stallDepth, 2.0, 0.05), partition, R.x0 + R.stallDepth / 2, 1.15, z + (s * R.stallWidth) / 2).castShadow = true;
    }
    // The door, hinged on the stall's front edge, hanging open into the stall.
    const hinge = new THREE.Group();
    hinge.position.set(R.x0 + R.stallDepth, 0, z - R.stallWidth / 2 + 0.05);
    hinge.rotation.y = -1.25;
    k.mesh(k.box(0.05, 1.85, R.stallWidth - 0.12), partition, 0, 1.12, (R.stallWidth - 0.12) / 2, hinge);
    k.mesh(k.box(0.07, 0.04, 0.12), chrome, 0.04, 1.05, R.stallWidth - 0.25, hinge);
    k.scene.add(hinge);
    const loo = buildToilet();
    loo.position.set(R.x0 + 0.02, 0, z);
    loo.rotation.y = Math.PI / 2; // facing out of the stall
    k.scene.add(loo);
    // A roll of paper, of course.
    k.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 14), matte('#fbfbf6'), R.x0 + 0.5, 0.75, z + R.stallWidth / 2 - 0.12).rotation.x = Math.PI / 2;
  }
  k.mesh(k.box(0.05, 0.05, R.stallWidth * R.stalls.length + 0.1), chrome, R.x0 + R.stallDepth, 2.17, (R.stalls[0] + R.stalls[R.stalls.length - 1]) / 2);
  // One door has a note on it.
  const note = canvasTexture(128, 96, (c) => {
    c.fillStyle = '#fffbe8';
    c.fillRect(0, 0, 128, 96);
    c.fillStyle = '#b01e1e';
    c.font = `700 22px ${SERIF}`;
    c.textAlign = 'center';
    c.fillText('DO NOT', 64, 38);
    c.fillText('FLUSH', 64, 66);
  });
  const sign = k.mesh(new THREE.PlaneGeometry(0.24, 0.18), flat('#ffffff', { map: note }), R.x0 + R.stallDepth + 0.04, 1.5, R.stalls[2]);
  sign.rotation.y = Math.PI / 2;

  // The sinks: a marble counter along the front wall, three basins, a long mirror.
  const S = R.sinks;
  const marble = matte('#e8e2d8');
  const cx = (S.x0 + S.x1) / 2;
  k.mesh(k.box(S.x1 - S.x0, 0.1, S.depth), marble, cx, 0.85, R.z0 + S.depth / 2).castShadow = true;
  k.mesh(k.box(S.x1 - S.x0, 0.8, 0.05), matte('#5a4a3a'), cx, 0.4, R.z0 + S.depth - 0.05);
  for (let i = 0; i < 3; i++) {
    const x = S.x0 + ((i + 0.5) * (S.x1 - S.x0)) / 3;
    const basin = k.mesh(new THREE.SphereGeometry(0.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), matte('#f6f6f2', { side: THREE.DoubleSide }), x, 0.97, R.z0 + 0.3);
    basin.rotation.x = Math.PI;
    basin.scale.y = 0.5;
    k.mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), chrome, x, 1.0, R.z0 + 0.08);
    k.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), chrome, x, 1.1, R.z0 + 0.14).rotation.x = Math.PI / 2;
  }
  const mirror = makeMirror(S.x1 - S.x0 - 0.2, 1.0);
  mirror.position.set(cx, 1.65, R.z0 + 0.03);
  k.scene.add(mirror);
  k.mesh(k.box(S.x1 - S.x0 - 0.1, 0.05, 0.05), chrome, cx, 2.18, R.z0 + 0.04);
  // A hand dryer that never works.
  k.mesh(k.box(0.3, 0.25, 0.18), chrome, S.x1 + 0.45, 1.25, R.z0 + 0.1);

  // The urinals, along the back wall, with little screens between them.
  const china = matte('#f2f0ea');
  for (const x of R.urinals) {
    const u = k.mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.6, 16, 1, false, 0, Math.PI), china, x, 0.75, R.z1 - 0.02);
    u.rotation.y = Math.PI / 2;
    u.rotation.z = 0;
    k.mesh(k.box(0.36, 0.05, 0.3), china, x, 0.46, R.z1 - 0.16);
  }
  for (const x of [R.urinals[0] - 0.5, (R.urinals[0] + R.urinals[1]) / 2, (R.urinals[1] + R.urinals[2]) / 2, R.urinals[2] + 0.5]) {
    k.mesh(k.box(0.04, 0.9, 0.45), partition, x, 1.05, R.z1 - 0.23);
  }

  // Cold light from two ceiling panels.
  for (const z of [7, 11.5]) {
    k.mesh(k.box(1.6, 0.04, 0.5), flat('#f4fbff'), (A.x0 + A.x1) / 2, A.height - 0.03, z);
    const light = new THREE.PointLight('#e8f4ff', 14, 0, 2);
    light.position.set((A.x0 + A.x1) / 2, A.height - 0.4, z);
    k.scene.add(light);
  }

  // Over the door, on the hall side: so you can find it.
  const plaque = neonSign('Restrooms', '#7fe0ff', 2.2, 0.5);
  plaque.position.set(-(R.door.z), R.door.h + 0.55, 0.06); // the hall's left wall: local x = -world z
  k.hallLeft.add(plaque);
  void walls;
}

// Make sure nobody forgets where the hidden door is.
export const SECRET_DOOR_CENTER = SECRET_DOOR;
