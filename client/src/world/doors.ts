// The doors you walk through: the casino's front doors, the Lucky Arms' front door, and
// the door of every flat. They swing open as someone walks up to them, if they open for
// that person at all, and close behind them. They live outside every zone's group, so a
// doorway is never a hole into nothing.
import * as THREE from 'three';
import { APT_SLOTS, aptDoor, BUILDING_DOOR, CASINO_DOOR, DOOR_SIZES, RESTROOM, type Pt } from '@casino/shared';
import { matte } from './materials';

interface Door {
  id: string;
  at: Pt;
  axis: 'x' | 'z';
  /** Which way it is swinging this time: away from whoever opened it. */
  swing: 1 | -1;
  pivots: { obj: THREE.Object3D; base: number; dir: number }[];
  open: number;
}

/** How close someone has to be for a door to start opening. */
const REACH = 2.3;
const WIDE = 1.45;

export class Doors {
  readonly group = new THREE.Group();
  private doors: Door[] = [];

  constructor(stage: THREE.Scene) {
    stage.add(this.group);
    const wood = matte('#3a1c10');
    const brass = matte('#b08a45', { emissive: '#3a2a10' });
    // The casino: a pair of heavy doors that swing in, towards the room.
    this.door('casino', CASINO_DOOR, 'x', DOOR_SIZES.casino.w, DOOR_SIZES.casino.h, 2, -1, wood, (leaf, w, h) => {
      leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 1.1, 0.03), matte('#24110a')), 0, h * 0.66, 0.05));
      leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 1.1, 0.03), matte('#24110a')), 0, h * 0.25, 0.05));
      leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), brass), w * 0.38, 1.45, 0.09));
      leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), brass), w * 0.38, 1.45, -0.09));
    });
    // The Lucky Arms: a tired green door with a little lit window, swinging into the corridor.
    this.door('building', BUILDING_DOOR, 'x', DOOR_SIZES.building.w, DOOR_SIZES.building.h, 1, 1, matte('#1d3a2a'), (leaf, w, h) => {
      leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, 0.6, 0.08), matte('#ffdf9a', { emissive: '#ffcf7a', emissiveIntensity: 0.6 })), 0, h * 0.7, 0));
      leaf.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), brass), w * 0.38, 1.0, 0.06));
      leaf.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), brass), w * 0.38, 1.0, -0.06));
    });
    // The casino's restrooms: a green door with a push plate, swinging either way. Opens for anyone.
    const rd = RESTROOM.door;
    this.door('restroom', { x: rd.x, z: rd.z }, 'z', rd.w, rd.h, 1, 1, matte('#2e4a44'), (leaf, w) => {
      for (const side of [-1, 1]) leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.01), brass), w * 0.32, 1.2, side * 0.035));
    });
    // Each flat: a cheap brown door, swinging into the flat.
    for (let s = 0; s < APT_SLOTS; s++) {
      this.door(`apt:${s}`, aptDoor(s), 'z', DOOR_SIZES.apt.w, DOOR_SIZES.apt.h, 1, s < 4 ? -1 : 1, matte('#5a3a22'), (leaf, w) => {
        leaf.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), brass), w * 0.38, 1.0, 0.05));
        leaf.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), brass), w * 0.38, 1.0, -0.05));
        leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), matte('#999')), w * 0.3, 1.55, 0.04)); // a spyhole
      });
    }
  }

  /**
   * A door in a wall that runs along `axis` (the doorway spans that axis), centred on `p`.
   * `swing` is which way it opens along the other axis. Two leaves meet in the middle.
   */
  private door(
    id: string,
    p: Pt,
    axis: 'x' | 'z',
    width: number,
    height: number,
    leaves: 1 | 2,
    swing: 1 | -1,
    mat: THREE.Material,
    dress: (leaf: THREE.Object3D, w: number, h: number) => void,
  ) {
    const lw = width / leaves - 0.03;
    const door: Door = { id, at: p, axis, swing, pivots: [], open: 0 };
    for (let k = 0; k < leaves; k++) {
      // Each leaf hangs from the outer edge of the doorway and reaches `dir` along the wall.
      const dir = k === 0 ? 1 : -1;
      const pivot = new THREE.Group();
      const edge = (dir * -width) / 2;
      const leaf = new THREE.Group();
      leaf.add(at(new THREE.Mesh(new THREE.BoxGeometry(lw, height - 0.02, 0.06), mat), 0, (height - 0.02) / 2, 0));
      dress(leaf, lw, height);
      leaf.position.x = (dir * lw) / 2;
      leaf.scale.x = dir; // so the handle is always on the free edge
      pivot.add(leaf);
      // A wall along x: local +x is world +x. Along z: turn so local +x is world +z.
      let base = 0;
      if (axis === 'x') pivot.position.set(p.x + edge, 0, p.z);
      else {
        pivot.position.set(p.x, 0, p.z + edge);
        base = -Math.PI / 2;
      }
      pivot.rotation.y = base;
      door.pivots.push({ obj: pivot, base, dir });
      this.group.add(pivot);
    }
    this.doors.push(door);
  }

  /**
   * Move every door towards open or shut. A door opens when someone it opens for is near:
   * `opensFor(id)` says whether it opens for you; anybody else near opens it regardless
   * (they would not be walking up to it otherwise).
   */
  update(dt: number, me: Pt | null, others: Pt[], opensFor: (id: string) => boolean) {
    const k = 1 - Math.exp(-dt * 6);
    for (const d of this.doors) {
      const near = (p: Pt) => Math.hypot(p.x - d.at.x, p.z - d.at.z) < REACH;
      const opener = me !== null && near(me) && opensFor(d.id) ? me : others.find(near);
      // A shut door swings away from whoever is opening it, so it never opens into their face.
      if (opener && d.open < 0.05) {
        const side = d.axis === 'x' ? opener.z - d.at.z : opener.x - d.at.x;
        if (Math.abs(side) > 0.05) d.swing = side > 0 ? -1 : 1;
      }
      d.open += ((opener ? 1 : 0) - d.open) * k;
      const angle = d.open * d.open * (3 - 2 * d.open) * WIDE;
      for (const pv of d.pivots) {
        const sign = d.axis === 'x' ? -d.swing * pv.dir : d.swing * pv.dir;
        pv.obj.rotation.y = pv.base + sign * angle;
      }
    }
  }

  /** Is a door (nearly) open? */
  isOpen(id: string) {
    return (this.doors.find((d) => d.id === id)?.open ?? 0) > 0.3;
  }

  /** The door nearest to `p`, if within `r`. */
  nearest(p: Pt, r: number): string | null {
    let best: string | null = null;
    let bd = r;
    for (const d of this.doors) {
      const dist = Math.hypot(p.x - d.at.x, p.z - d.at.z);
      if (dist < bd) {
        bd = dist;
        best = d.id;
      }
    }
    return best;
  }
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
