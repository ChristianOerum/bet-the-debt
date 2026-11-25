// The dead on the casino floor: flat on their backs where they fell, or sat on the toilet in
// the stall with their head down. Anyone can walk up and go through their pockets.
import * as THREE from 'three';
import { DEALERS, LOOT_RANGE, type Body, type Pt } from '@casino/shared';
import { buildCharacter, disposeObject, partsOf, updateArms } from './character';
import { TextSprite } from './labels';
import { matte } from './materials';

interface Shown {
  group: THREE.Group;
  tag: TextSprite;
  key: string;
}

export class Bodies {
  private shown = new Map<number, Shown>();
  private list: Body[] = [];

  constructor(private parent: THREE.Object3D) {}

  set(list: Body[]) {
    this.list = list;
    const keep = new Set(list.map((b) => b.id));
    for (const [id, s] of this.shown) {
      if (keep.has(id)) continue;
      this.parent.remove(s.group);
      s.tag.dispose();
      disposeObject(s.group);
      this.shown.delete(id);
    }
    for (const b of list) {
      let s = this.shown.get(b.id);
      if (!s) {
        const group = buildCharacter(b.color);
        group.rotation.order = 'YXZ';
        const tag = new TextSprite(0.2);
        group.add(tag.sprite);
        this.parent.add(group);
        s = { group, tag, key: '' };
        this.shown.set(b.id, s);
      }
      const loot = b.chips > 0 || b.items.length > 0;
      const key = `${b.x}:${b.z}:${b.hidden}:${loot}`;
      if (s.key === key) continue;
      s.key = key;
      this.pose(s.group, s.tag.sprite, b);
      s.tag.set(`✝ ${b.name}`, loot ? '#ffe08a' : '#b8aa98', 'rgba(20, 12, 10, 0.7)');
    }
  }

  private pose(g: THREE.Group, tag: THREE.Object3D, b: Body) {
    const parts = partsOf(g);
    g.position.set(b.x, 0, b.z);
    g.rotation.set(0, b.yaw + Math.PI, 0);
    if (b.hidden) {
      // Sat on the toilet, slumped forward, hands in the lap.
      g.position.y = 0.3;
      g.rotation.x = 0.62;
      g.rotation.z = 0.18; // and a little to one side
      parts.hands[0].position.set(-0.22, 0.28, 0.3); // arms hanging
      parts.hands[1].position.set(0.24, 0.26, 0.26);
      tag.position.set(0, 1.5, 0);
    } else {
      // Flat on their back, arms flung out.
      g.position.y = 0.04;
      g.rotation.x = -Math.PI / 2;
      parts.hands[0].position.set(-0.62, 1.05, 0.04);
      parts.hands[1].position.set(0.62, 1.0, 0.04);
      // The tag floats above the chest, not off in the air where the head would be standing.
      tag.position.set(0, 0.8, 0.7);
    }
    updateArms(parts);
  }

  /** The body you are standing over and looking at, if any. */
  near(from: Pt, yaw: number): Body | null {
    const lx = -Math.sin(yaw);
    const lz = -Math.cos(yaw);
    let best: Body | null = null;
    let bestD = LOOT_RANGE + 0.3;
    for (const b of this.list) {
      const dx = b.x - from.x;
      const dz = b.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      if (d > 0.5 && (dx * lx + dz * lz) / d < 0.1) continue; // behind you
      best = b;
      bestD = d;
    }
    return best;
  }

  clear() {
    this.set([]);
  }
}

/** The two dealers on the street: hoods up, hands in pockets, shifting from foot to foot. */
export class Dealers {
  private people: { group: THREE.Group; phase: number; yaw: number }[] = [];

  constructor(parent: THREE.Object3D) {
    DEALERS.forEach((d, i) => {
      const g = buildCharacter(d.color);
      const parts = partsOf(g);
      // A hood: a dark dome over the back and top of the head.
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), matte('#24262a'));
      hood.position.set(0, 1.28, -0.05);
      hood.rotation.x = -0.35;
      g.add(hood);
      parts.hands[0].position.set(-0.26, 0.62, 0.16); // in the pockets
      parts.hands[1].position.set(0.26, 0.62, 0.16);
      updateArms(parts);
      const tag = new TextSprite(0.2);
      tag.set(d.name, '#c8d0b8', 'rgba(16, 20, 14, 0.75)');
      tag.sprite.position.y = 1.98;
      g.add(tag.sprite);
      g.position.set(d.at.x, 0, d.at.z);
      g.rotation.y = d.yaw + Math.PI;
      // A dim, buzzing light over them, so they can be found.
      const lamp = new THREE.PointLight('#a8ff9a', 2.2, 6, 1.6);
      lamp.position.set(0, 2.8, 0);
      g.add(lamp);
      parent.add(g);
      this.people.push({ group: g, phase: i * 2.1, yaw: d.yaw + Math.PI });
    });
  }

  update(time: number) {
    for (const p of this.people) {
      // Shifting weight, glancing up and down the street.
      p.group.position.y = Math.abs(Math.sin(time * 1.3 + p.phase)) * 0.02;
      p.group.rotation.y = p.yaw + Math.sin(time * 0.37 + p.phase) * 0.5;
    }
  }
}
