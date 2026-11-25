import * as THREE from 'three';
import { flat, toonBright } from './materials';

export type Role = 'player' | 'dealer' | 'guard' | 'bartender';

export interface CharacterParts {
  hands: [THREE.Mesh, THREE.Mesh];
  feet: [THREE.Mesh, THREE.Mesh];
  /** Stretched between shoulder and hand every time the hands move (see updateArms). */
  arms: [THREE.Mesh, THREE.Mesh];
  shoulders: [THREE.Vector3, THREE.Vector3];
}

/** Where hands hang when nothing else is going on. Index 0 is on the -x side. */
export const REST_HANDS: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-0.42, 0.66, 0.06), new THREE.Vector3(0.42, 0.66, 0.06)];

const UP = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();

/** Stretch a limb (a cylinder one unit tall) between two points. */
export function placeLimb(limb: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  dir.subVectors(to, from);
  const len = dir.length();
  limb.position.addVectors(from, to).multiplyScalar(0.5);
  limb.scale.set(1, Math.max(len, 0.001), 1);
  if (len > 1e-6) limb.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
}

/** Call after moving a character's hands, so the arms follow. */
export function updateArms(parts: CharacterParts) {
  for (let i = 0; i < 2; i++) placeLimb(parts.arms[i], parts.shoulders[i], parts.hands[i].position);
}

export const partsOf = (g: THREE.Object3D) => g.userData.parts as CharacterParts;

/**
 * A chunky little person: bean body, big round head, dot eyes, noodle arms.
 * Stands on y = 0 and faces +z. About 1.65 m tall (bouncers a bit more).
 * Deliberately bright and daft: the room is serious, the people in it are not.
 */
export function buildCharacter(color: string, role: Role = 'player'): THREE.Group {
  const g = new THREE.Group();
  const body = { player: color, dealer: '#3a3350', guard: '#1e1d26', bartender: '#f1ebdf' }[role];
  const bodyMat = toonBright(body, role === 'guard' ? 0.12 : role === 'player' ? 0.18 : 0.2);
  const skin = toonBright('#ffdcbd', 0.2);
  const ink = flat('#2b2238');

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    g.add(m);
    return m;
  };

  add(new THREE.CapsuleGeometry(0.3, 0.42, 6, 18), bodyMat, 0, 0.6, 0);
  const head = add(new THREE.SphereGeometry(0.35, 28, 20), skin, 0, 1.3, 0);
  head.scale.set(1, 0.92, 0.96);

  // ---- face ----
  if (role === 'guard') {
    // Sunglasses. Indoors. At night.
    const shades = flat('#0b0b10');
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.15, 0.085, 0.04), shades, side * 0.1, 1.345, 0.31, false);
      add(new THREE.BoxGeometry(0.04, 0.012, 0.006), flat('#6a7080'), side * 0.1 + 0.035, 1.37, 0.332, false);
    }
    add(new THREE.BoxGeometry(0.07, 0.02, 0.02), shades, 0, 1.36, 0.325, false);
    add(new THREE.BoxGeometry(0.08, 0.014, 0.01), ink, 0, 1.235, 0.33, false); // unimpressed
    // An earpiece with a curly wire.
    const beige = flat('#d8c8a8');
    add(new THREE.SphereGeometry(0.035, 10, 8), beige, 0.33, 1.28, 0.02, false);
    const wire = add(new THREE.TorusGeometry(0.03, 0.006, 6, 12), beige, 0.3, 1.16, -0.02, false);
    wire.rotation.y = Math.PI / 2;
  } else {
    const eyeGeo = new THREE.SphereGeometry(0.052, 12, 10);
    const glintGeo = new THREE.SphereGeometry(0.018, 8, 6);
    const white = flat('#ffffff');
    for (const side of [-1, 1]) {
      add(eyeGeo, ink, side * 0.125, 1.34, 0.305, false).scale.set(1, 1.25, 0.6);
      add(glintGeo, white, side * 0.125 + 0.018, 1.365, 0.335, false);
    }
    const smile = add(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), ink, 0, 1.245, 0.325, false);
    smile.rotation.z = Math.PI;
  }
  for (const side of [-1, 1]) {
    add(new THREE.SphereGeometry(0.06, 10, 8), flat('#ff9aa8'), side * 0.215, 1.245, 0.26, false).scale.set(1, 0.6, 0.4);
  }

  // ---- arms, hands and feet ----
  const sleeve = role === 'bartender' ? toonBright('#f1ebdf', 0.2) : bodyMat;
  const gloves = role === 'dealer' ? toonBright('#ffffff', 0.3) : role === 'guard' ? toonBright('#24232c', 0.1) : skin;
  const handGeo = new THREE.SphereGeometry(0.095, 14, 10);
  const footGeo = new THREE.SphereGeometry(0.13, 14, 10);
  const armGeo = new THREE.CylinderGeometry(0.06, 0.07, 1, 10);
  const shoe = toonBright('#4a3f66', 0.15);
  const hands: THREE.Mesh[] = [];
  const feet: THREE.Mesh[] = [];
  const arms: THREE.Mesh[] = [];
  REST_HANDS.forEach((rest, i) => {
    const side = i === 0 ? -1 : 1;
    const hand = add(handGeo, gloves, rest.x, rest.y, rest.z);
    hands.push(hand);
    arms.push(add(armGeo, sleeve, 0, 0, 0));
    const foot = add(footGeo, shoe, side * 0.15, 0.07, 0.06);
    foot.scale.set(1, 0.55, 1.35);
    feet.push(foot);
  });

  // ---- what each job wears ----
  if (role === 'dealer') {
    // White shirt front, red bow tie and a tiny top hat.
    add(new THREE.SphereGeometry(0.2, 16, 12), toonBright('#ffffff', 0.3), 0, 0.74, 0.17).scale.set(0.8, 1.15, 0.55);
    const red = toonBright('#ef4565');
    for (const side of [-1, 1]) add(new THREE.ConeGeometry(0.07, 0.13, 10), red, side * 0.075, 0.96, 0.27).rotation.z = side * (Math.PI / 2);
    add(new THREE.SphereGeometry(0.035, 10, 8), red, 0, 0.96, 0.28);
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 24), bodyMat, 0, 1.6, 0);
    add(new THREE.CylinderGeometry(0.19, 0.2, 0.2, 24), bodyMat, 0, 1.71, 0);
    add(new THREE.CylinderGeometry(0.205, 0.205, 0.05, 24), toonBright('#f0c14b'), 0, 1.645, 0);
  } else if (role === 'guard') {
    // Black suit, white shirt, black tie. They are bigger than you.
    add(new THREE.SphereGeometry(0.2, 16, 12), toonBright('#f4f1ea', 0.2), 0, 0.84, 0.19).scale.set(0.62, 0.95, 0.5);
    const tie = add(new THREE.BoxGeometry(0.06, 0.28, 0.02), flat('#101014'), 0, 0.78, 0.295);
    tie.rotation.x = -0.18;
    g.scale.setScalar(1.15);
  } else if (role === 'bartender') {
    // Burgundy waistcoat, bow tie, slicked hair and a magnificent moustache.
    const vest = add(new THREE.SphereGeometry(0.31, 20, 14), toonBright('#7c1d2a', 0.18), 0, 0.6, 0.015);
    vest.scale.set(1.02, 1.28, 0.95);
    add(new THREE.SphereGeometry(0.2, 14, 10), toonBright('#f1ebdf', 0.2), 0, 0.86, 0.2).scale.set(0.5, 0.75, 0.45);
    for (const y of [0.66, 0.52]) add(new THREE.SphereGeometry(0.02, 8, 6), toonBright('#e0b25a', 0.3), 0, y, 0.3);
    const black = flat('#15121a');
    for (const side of [-1, 1]) add(new THREE.ConeGeometry(0.055, 0.11, 10), black, side * 0.06, 0.97, 0.27).rotation.z = side * (Math.PI / 2);
    const brown = toonBright('#4a2a18', 0.15);
    for (const side of [-1, 1]) add(new THREE.TorusGeometry(0.055, 0.02, 6, 14, Math.PI), brown, side * 0.06, 1.2, 0.33, false);
    add(new THREE.SphereGeometry(0.365, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.3), toonBright('#2a1a12', 0.12), 0, 1.31, -0.01);
  }

  const parts: CharacterParts = {
    hands: hands as [THREE.Mesh, THREE.Mesh],
    feet: feet as [THREE.Mesh, THREE.Mesh],
    arms: arms as [THREE.Mesh, THREE.Mesh],
    shoulders: [new THREE.Vector3(-0.25, 0.9, 0.02), new THREE.Vector3(0.25, 0.9, 0.02)],
  };
  g.userData.parts = parts;
  updateArms(parts);
  return g;
}

/**
 * Put the shop's clothes on a player's character (taking off whatever they had on before).
 * Hats, shades, chains and scarves are added on; a suit and shoes recolour what is there.
 */
export function dressCharacter(g: THREE.Group, outfit: readonly string[]) {
  const parts = partsOf(g);
  const old = g.userData.outfit as THREE.Group | undefined;
  if (old) {
    g.remove(old);
    disposeObject(old);
  }
  // Remember the undressed materials the first time, so taking things off puts them back.
  const base = (g.userData.base ??= {
    body: (g.children[0] as THREE.Mesh).material,
    arms: parts.arms[0].material,
    feet: parts.feet[0].material,
  }) as { body: THREE.Material; arms: THREE.Material; feet: THREE.Material };
  const has = (id: string) => outfit.includes(id);
  const body = g.children[0] as THREE.Mesh;
  const gold = toonBright('#e7b93c', 0.3);
  body.material = has('suit-gold') ? gold : base.body;
  for (const a of parts.arms) a.material = has('suit-gold') ? gold : base.arms;
  for (const f of parts.feet) f.material = has('sneakers') ? toonBright('#f4f4f0', 0.25) : base.feet;

  const wear = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    wear.add(m);
    return m;
  };
  if (has('hat-fedora')) {
    const felt = toonBright('#3a2a4a', 0.15);
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.035, 24), felt, 0, 1.56, 0);
    add(new THREE.CylinderGeometry(0.2, 0.24, 0.24, 20), felt, 0, 1.69, 0);
    add(new THREE.CylinderGeometry(0.245, 0.245, 0.05, 20), toonBright('#c8263b'), 0, 1.6, 0);
  }
  if (has('shades')) {
    const lens = flat('#141018');
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.15, 0.08, 0.035), lens, side * 0.11, 1.35, 0.32);
    add(new THREE.BoxGeometry(0.34, 0.02, 0.02), toonBright('#e7b93c'), 0, 1.385, 0.33);
  }
  if (has('suit-gold')) {
    // A shirt front and a bow tie, so it reads as a suit and not a banana.
    add(new THREE.SphereGeometry(0.2, 16, 12), toonBright('#ffffff', 0.3), 0, 0.8, 0.18).scale.set(0.6, 1, 0.5);
    for (const side of [-1, 1]) add(new THREE.ConeGeometry(0.06, 0.11, 10), flat('#15121a'), side * 0.065, 0.97, 0.28).rotation.z = side * (Math.PI / 2);
  }
  if (has('chain')) {
    const chain = add(new THREE.TorusGeometry(0.2, 0.025, 8, 28), toonBright('#f0c14b', 0.35), 0, 0.86, 0.08);
    chain.rotation.x = Math.PI / 2 - 0.5;
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), toonBright('#f0c14b', 0.35), 0, 0.72, 0.29).rotation.x = Math.PI / 2;
  }
  if (has('scarf')) {
    const silk = toonBright('#c8263b', 0.2);
    const ring = add(new THREE.TorusGeometry(0.21, 0.06, 10, 24), silk, 0, 0.95, 0.02);
    ring.rotation.x = Math.PI / 2;
    const tail = add(new THREE.BoxGeometry(0.1, 0.32, 0.04), silk, 0.12, 0.78, 0.27);
    tail.rotation.z = 0.25;
  }
  g.add(wear);
  g.userData.outfit = wear;
}

/** A comically oversized revolver, pointing along +z. */
export function buildGun(): THREE.Group {
  const g = new THREE.Group();
  const steel = toonBright('#6d7280', 0.25);
  const wood = toonBright('#8a4b2a', 0.2);
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  part(new THREE.CylinderGeometry(0.05, 0.05, 0.44, 12), steel, 0, 0.03, 0.34).rotation.x = Math.PI / 2;
  part(new THREE.CylinderGeometry(0.09, 0.09, 0.15, 14), steel, 0, 0.01, 0.07).rotation.x = Math.PI / 2;
  part(new THREE.BoxGeometry(0.09, 0.13, 0.26), steel, 0, 0, 0.02);
  part(new THREE.BoxGeometry(0.08, 0.24, 0.1), wood, 0, -0.15, -0.09).rotation.x = -0.35;
  return g;
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    // A mirror has a render target of its own to free.
    if ((o as { isReflector?: boolean }).isReflector) (o as unknown as { dispose(): void }).dispose();
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
