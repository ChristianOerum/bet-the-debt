// Item icons: little pictures of the real thing, rendered once from its 3D model and kept.
// Food and drink, guns and drugs are the very models you hold; clothes are shown worn on a
// plain mannequin; the shop's things for the home and its flats get a little model each.
import * as THREE from 'three';
import { shopItem } from '@casino/shared';
import { buildCharacter, disposeObject, dressCharacter } from '../world/character';
import { buildFood, MODELLED } from '../world/food';
import { canvasTexture, flat, matte, SERIF, toon } from '../world/materials';

const SIZE = 128;
const cache = new Map<string, string | null>();
let renderer: THREE.WebGLRenderer | null | undefined;

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer !== undefined) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch {
    renderer = null; // no WebGL: the emoji will have to do
  }
  return renderer;
}

/** What to draw for an item, and which part of it to frame (null = all of it). */
interface Subject {
  obj: THREE.Object3D;
  /** Frame this box instead of the whole object (clothes: just the bit you wear). */
  focus?: THREE.Box3;
  /** Look a little from above (true), or straight on. */
  above?: boolean;
  /** Extra light, for dark things (gun steel). */
  bright?: boolean;
}

function subjectFor(id: string): Subject | null {
  if (MODELLED.includes(id)) {
    const food = buildFood(id);
    const g = new THREE.Group();
    g.add(food.group);
    if (food.aim) {
      // A gun in profile, barrel to the right, tipped up a touch.
      food.group.rotation.set(0, -Math.PI / 2, 0.12);
      return { obj: g, above: false, bright: true };
    }
    food.group.rotation.y = -0.5;
    return { obj: g, above: true };
  }
  const item = shopItem(id);
  if (!item) return null;
  if (item.slot) return worn(id, item.slot);
  return { obj: homeModel(id), above: true };
}

/** Clothes on a plain mannequin, cropped to where they go. */
function worn(id: string, slot: string): Subject {
  const g = buildCharacter('#8f8aa0');
  dressCharacter(g, [id]);
  g.rotation.y = -0.25;
  const box = (y0: number, y1: number, r: number) => new THREE.Box3(new THREE.Vector3(-r, y0, -r), new THREE.Vector3(r, y1, r));
  const focus = { head: box(1.0, 1.95, 0.46), eyes: box(1.0, 1.8, 0.42), neck: box(0.5, 1.25, 0.46), body: box(0.02, 1.7, 0.6), feet: box(-0.05, 0.5, 0.5) }[slot];
  return { obj: g, focus, above: slot !== 'feet' };
}

/** The shop's things for the home, and the flats themselves. */
function homeModel(id: string): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  switch (id) {
    case 'bed': {
      const wood = toon('#6a3a22');
      for (const [x, z] of [[-0.7, -0.95], [0.7, -0.95], [-0.7, 0.95], [0.7, 0.95]]) add(box(0.08, 0.3, 0.08), wood, x, 0.15, z);
      add(box(1.5, 0.12, 2), wood, 0, 0.32, 0);
      add(box(0.08, 0.7, 0.12), wood, 0, 0.35, -1.02).scale.x = 19; // the headboard
      add(box(1.42, 0.16, 1.9), matte('#f4f0e6'), 0, 0.46, 0);
      add(box(1.46, 0.08, 1.3), toon('#b03a4a'), 0, 0.56, 0.3);
      add(box(0.9, 0.12, 0.35), matte('#ffffff'), 0, 0.6, -0.7);
      break;
    }
    case 'plant': {
      add(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 16), toon('#a85a32'), 0, 0.15, 0);
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16), matte('#3a2214'), 0, 0.3, 0);
      for (let i = 0; i < 7; i++) {
        const leaf = add(new THREE.SphereGeometry(0.12, 12, 8), toon(i % 2 ? '#3f8a4a' : '#56a85c'), Math.cos(i * 1.3) * 0.09, 0.42 + i * 0.06, Math.sin(i * 1.3) * 0.09);
        leaf.scale.set(0.7, 1.25, 0.7);
      }
      break;
    }
    case 'tv': {
      add(box(1.1, 0.68, 0.12), toon('#1e1e24'), 0, 0.5, 0);
      const screen = canvasTexture(128, 80, (c) => {
        const grd = c.createLinearGradient(0, 0, 128, 80);
        grd.addColorStop(0, '#4ac6e8');
        grd.addColorStop(1, '#b07cff');
        c.fillStyle = grd;
        c.fillRect(0, 0, 128, 80);
        c.fillStyle = '#ffd34e';
        c.beginPath();
        c.arc(92, 26, 12, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#3f8a4a';
        c.fillRect(0, 58, 128, 22);
      });
      add(new THREE.PlaneGeometry(0.98, 0.56), flat('#ffffff', { map: screen }), 0, 0.5, 0.061);
      add(box(0.3, 0.04, 0.2), toon('#1e1e24'), 0, 0.12, 0);
      add(box(0.06, 0.1, 0.06), toon('#1e1e24'), 0, 0.17, 0);
      break;
    }
    case 'neon': {
      add(box(1.3, 0.55, 0.05), matte('#1a1018'), 0, 0.5, -0.04);
      const tex = canvasTexture(256, 110, (c) => {
        c.clearRect(0, 0, 256, 110);
        c.font = `italic 700 66px ${SERIF}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.shadowColor = '#ff4fa0';
        c.shadowBlur = 18;
        c.fillStyle = '#ffd0ea';
        for (let i = 0; i < 3; i++) c.fillText('LUCKY', 128, 56);
      });
      add(new THREE.PlaneGeometry(1.25, 0.54), flat('#ffffff', { map: tex, transparent: true }), 0, 0.5, 0);
      break;
    }
    case 'roach-motel': {
      const card = toon('#d8c060');
      add(box(0.5, 0.2, 0.34), card, 0, 0.1, 0);
      const roof = add(new THREE.CylinderGeometry(0.01, 0.3, 0.16, 4), toon('#c83a2a'), 0, 0.28, 0);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1.15, 1, 0.8);
      add(box(0.12, 0.1, 0.01), matte('#1a0e08'), 0, 0.06, 0.171); // the door
      const roach = add(new THREE.SphereGeometry(0.05, 10, 8), matte('#3a1e10'), 0.16, 0.02, 0.26);
      roach.scale.set(1.6, 0.5, 1);
      break;
    }
    default: {
      // A flat: a block of flats, the taller and grander the better.
      const level = shopItem(id)?.level ?? 2;
      const floors = level >= 3 ? 4 : 3;
      const wall = toon(level >= 3 ? '#4a4a6a' : '#7a5a3a');
      add(box(1, floors * 0.42, 0.8), wall, 0, (floors * 0.42) / 2, 0);
      const lit = flat('#ffd88a');
      const dark = flat('#2a2a3a');
      for (let f = 0; f < floors; f++) {
        for (const x of [-0.3, 0, 0.3]) {
          const top = f === floors - 1;
          add(box(0.16, 0.2, 0.02), top ? lit : (f + x * 10) % 2 ? lit : dark, x, 0.24 + f * 0.42, 0.41);
        }
      }
      if (level >= 3) {
        // The penthouse: a gold roof and a terrace.
        add(box(1.1, 0.06, 0.9), toon('#e7b93c'), 0, floors * 0.42 + 0.03, 0);
        add(box(0.6, 0.3, 0.5), toon('#e7b93c'), 0, floors * 0.42 + 0.2, -0.1);
      } else add(box(1.08, 0.06, 0.88), toon('#5a3a22'), 0, floors * 0.42 + 0.03, 0);
      break;
    }
  }
  return g;
}

/** Render one item into a picture. */
function render(id: string): string | null {
  const r = getRenderer();
  const subject = r ? subjectFor(id) : null;
  if (!r || !subject) return null;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff6e8', '#3a2a24', subject?.bright ? 6 : 2.2));
  const key = new THREE.DirectionalLight('#ffffff', subject.bright ? 5 : 2.2);
  key.position.set(2, 3, 4);
  scene.add(key);
  scene.add(subject.obj);
  subject.obj.updateMatrixWorld(true);

  // Frame it: fit the box (or the part of it we care about) snugly in view.
  // Only what is drawn counts (not a gun's hidden muzzle flash).
  const box = subject.focus ?? new THREE.Box3();
  if (!subject.focus) {
    subject.obj.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) box.expandByObject(o, true);
    });
  }
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(0.01, box.getBoundingSphere(new THREE.Sphere()).radius);
  const cam = new THREE.PerspectiveCamera(28, 1, radius / 20, radius * 40);
  const dir = subject.above ? new THREE.Vector3(0.25, 0.55, 1).normalize() : new THREE.Vector3(0, 0.12, 1).normalize();
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(14))) * (subject.focus ? 1.08 : 0.92);
  cam.position.copy(centre).addScaledVector(dir, dist);
  cam.lookAt(centre);

  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  disposeObject(subject.obj);
  return url;
}

/** A picture of this item (a data URL), or null where there is none (then use its emoji). */
export function itemIcon(id: string): string | null {
  if (!cache.has(id)) cache.set(id, render(id));
  return cache.get(id) ?? null;
}

/** An <img> of the item, or its emoji if it cannot be drawn. */
export function iconHtml(id: string, emoji: string, cls = 'item-icon'): string {
  const url = itemIcon(id);
  return url ? `<img class="${cls}" src="${url}" alt="" draggable="false">` : `<span class="${cls} emoji">${emoji}</span>`;
}
