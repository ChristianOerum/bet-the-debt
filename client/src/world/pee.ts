// Toilets, and what goes in them (or, more often, does not): the stream, and the puddles.
import * as THREE from 'three';
import { matte, toon } from './materials';

/** A toilet, back against a wall, facing +z. The origin is the middle of its back, on the floor. */
export function buildToilet(grubby = false): THREE.Group {
  const g = new THREE.Group();
  const china = matte(grubby ? '#d8d2bc' : '#f2f0ea');
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.46, 0.4, 0.18), china, 0, 0.62, 0.1); // the cistern
  add(new THREE.BoxGeometry(0.5, 0.05, 0.22), china, 0, 0.84, 0.1);
  add(new THREE.BoxGeometry(0.08, 0.025, 0.03), matte('#b8b8b0'), 0.16, 0.74, 0.205); // the handle
  add(new THREE.CylinderGeometry(0.13, 0.11, 0.36, 18), china, 0, 0.18, 0.4); // pedestal
  const bowl = add(new THREE.CylinderGeometry(0.2, 0.15, 0.1, 22), china, 0, 0.36, 0.4);
  bowl.scale.z = 1.25;
  const water = add(new THREE.CircleGeometry(0.15, 20), matte(grubby ? '#a8a060' : '#9ec8d8'), 0, 0.4, 0.4);
  water.rotation.x = -Math.PI / 2;
  water.scale.y = 1.25;
  const seat = add(new THREE.TorusGeometry(0.17, 0.035, 8, 24), matte(grubby ? '#8a6a4a' : '#ffffff'), 0, 0.42, 0.41);
  seat.rotation.x = Math.PI / 2;
  seat.scale.y = 1.25;
  const lid = add(new THREE.BoxGeometry(0.4, 0.42, 0.03), matte(grubby ? '#8a6a4a' : '#ffffff'), 0, 0.62, 0.21); // up
  lid.rotation.x = -0.12;
  return g;
}

/** Someone peeing: where it comes from and which way, and whether it ends in a toilet. */
export interface Stream {
  origin: THREE.Vector3;
  /** Flat direction they face. */
  dir: THREE.Vector3;
  atToilet: boolean;
}

const DROPS = 40;
const G = 9.8;
const SPEED = 2.1;
const LIFT = 0.45;

interface Live {
  mesh: THREE.InstancedMesh;
  stream: Stream;
  lastPuddle: THREE.Vector3 | null;
  puddle: Puddle | null;
}

interface Puddle {
  mesh: THREE.Mesh;
  age: number;
  size: number;
}

/** Every stream being drawn, and the puddles they leave behind. */
export class PeeStreams {
  private live = new Map<number, Live>();
  private puddles: Puddle[] = [];
  private dropGeo = new THREE.SphereGeometry(0.016, 6, 5);
  private dropMat = toon('#f3d43a', { emissive: '#8a7010', emissiveIntensity: 0.4, transparent: true, opacity: 0.85 });
  private puddleGeo = new THREE.CircleGeometry(1, 24);
  private tmp = new THREE.Matrix4();
  private pos = new THREE.Vector3();

  constructor(private scene: THREE.Object3D) {}

  start(id: number, atToilet: boolean) {
    this.stop(id);
    const mesh = new THREE.InstancedMesh(this.dropGeo, this.dropMat, DROPS);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.live.set(id, { mesh, stream: { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), atToilet }, lastPuddle: null, puddle: null });
  }

  stop(id: number) {
    const l = this.live.get(id);
    if (!l) return;
    this.scene.remove(l.mesh);
    l.mesh.dispose();
    this.live.delete(id);
  }

  has(id: number) {
    return this.live.has(id);
  }

  clear() {
    for (const id of [...this.live.keys()]) this.stop(id);
    for (const p of this.puddles) this.scene.remove(p.mesh);
    this.puddles = [];
  }

  /** `where(id)` says where each stream comes from this frame (or null to hide it). */
  update(dt: number, time: number, where: (id: number, s: Stream) => boolean) {
    for (const [id, l] of this.live) {
      const visible = where(id, l.stream);
      l.mesh.visible = visible;
      if (!visible) continue;
      const { origin, dir, atToilet } = l.stream;
      // Where it lands: in the bowl (a little lower than you), or on the floor.
      const floor = atToilet ? 0.38 : 0.005;
      const drop = Math.max(0.01, origin.y - floor);
      const flight = (LIFT + Math.sqrt(LIFT * LIFT + 2 * G * drop)) / G;
      for (let k = 0; k < DROPS; k++) {
        const t = ((time * 2.2 + k / DROPS) % 1) * flight;
        this.pos.set(origin.x + dir.x * SPEED * t, origin.y + LIFT * t - (G / 2) * t * t, origin.z + dir.z * SPEED * t);
        this.tmp.makeTranslation(this.pos.x, this.pos.y, this.pos.z);
        l.mesh.setMatrixAt(k, this.tmp);
      }
      l.mesh.instanceMatrix.needsUpdate = true;
      if (atToilet) continue;
      // A puddle where it lands, spreading; a fresh one if they move off it.
      const land = new THREE.Vector3(origin.x + dir.x * SPEED * flight, 0.004, origin.z + dir.z * SPEED * flight);
      if (!l.puddle || !l.lastPuddle || l.lastPuddle.distanceTo(land) > 0.45) {
        l.puddle = this.addPuddle(land);
        l.lastPuddle = land;
      }
      l.puddle.size = Math.min(0.55, l.puddle.size + dt * 0.12);
      l.puddle.age = 0;
    }
    // Puddles linger, then dry up.
    for (const p of this.puddles) {
      p.age += dt;
      p.mesh.scale.setScalar(p.size);
      const fade = Math.max(0, 1 - Math.max(0, p.age - 60) / 20);
      (p.mesh.material as THREE.MeshLambertMaterial).opacity = 0.55 * fade;
    }
    const dried = this.puddles.filter((p) => p.age > 80);
    for (const p of dried) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.puddles = this.puddles.filter((p) => p.age <= 80);
  }

  private addPuddle(at: THREE.Vector3): Puddle {
    const mesh = new THREE.Mesh(this.puddleGeo, matte('#e8cc30', { transparent: true, opacity: 0.55, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.scale.setScalar(0.05);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    const p = { mesh, age: 0, size: 0.05 };
    this.puddles.push(p);
    return p;
  }
}
