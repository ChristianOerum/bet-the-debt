import * as THREE from 'three';
import { BAR, GUARD_POSTS, type Pt } from '@casino/shared';
import { buildCharacter, partsOf, REST_HANDS, updateArms } from './character';
import { flat } from './materials';
import { BAR_PLATFORM } from './scene';
import { angleDiff } from './player';

/** Characters are modelled facing +z; our yaw 0 looks toward -z. */
export const modelYaw = (yaw: number) => yaw + Math.PI;
/** The yaw that looks from one point at another. */
export const yawToward = (from: Pt, to: Pt) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** The staff who never leave their spot: the two bouncers at the entrance and the bartender. */
export class Npcs {
  private bouncers: { g: THREE.Group; base: number; post: Pt }[] = [];
  private bartender: THREE.Group;
  private glass: THREE.Mesh;
  private bt = { z: (BAR.z0 + BAR.z1) / 2, target: 0, wait: 3, stride: 0 };

  constructor(scene: THREE.Object3D) {
    for (const post of GUARD_POSTS.entrance) {
      const g = buildCharacter('', 'guard');
      g.position.set(post.x, 0, post.z);
      g.rotation.y = modelYaw(post.yaw);
      scene.add(g);
      this.bouncers.push({ g, base: modelYaw(post.yaw), post });
    }

    this.bartender = buildCharacter('', 'bartender');
    this.bartender.position.set(BAR.lane, BAR_PLATFORM, this.bt.z);
    this.bartender.rotation.y = Math.PI / 2; // facing the customers (+x)
    this.bt.target = this.bt.z;
    this.glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.045, 0.14, 14, 1, true),
      flat('#cfe3ea', { transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    this.bartender.add(this.glass);
    scene.add(this.bartender);
  }

  update(dt: number, time: number, people: Pt[]) {
    const turn = 1 - Math.exp(-dt * 4);

    // Bouncers: arms folded, and their heads (whole bodies, really) follow whoever walks past.
    for (const [i, b] of this.bouncers.entries()) {
      let target = b.base;
      let best = 5;
      for (const p of people) {
        const d = Math.hypot(p.x - b.post.x, p.z - b.post.z);
        if (d < best) {
          best = d;
          const toward = modelYaw(yawToward(b.post, p));
          target = b.base + Math.max(-0.9, Math.min(0.9, angleDiff(toward, b.base)));
        }
      }
      b.g.rotation.y += angleDiff(target, b.g.rotation.y) * turn;
      const parts = partsOf(b.g);
      const breathe = Math.sin(time * 1.6 + i) * 0.012;
      parts.hands[0].position.set(0.15, 0.8 + breathe, 0.36);
      parts.hands[1].position.set(-0.15, 0.78 + breathe, 0.39);
      updateArms(parts);
    }

    // Bartender: drifts up and down behind the bar, polishing the same glass forever.
    const bt = this.bt;
    const g = this.bartender;
    const parts = partsOf(g);
    let facing = Math.PI / 2;
    if (bt.wait > 0) {
      bt.wait -= dt;
      if (bt.wait <= 0) bt.target = BAR.z0 + 1 + Math.random() * (BAR.z1 - BAR.z0 - 2);
      const w = time * 6;
      parts.hands[0].position.set(0.1, 0.98, 0.38);
      parts.hands[1].position.set(-0.02 + Math.cos(w) * 0.06, 1.04 + Math.sin(w) * 0.04, 0.42);
    } else {
      const dz = bt.target - bt.z;
      const step = Math.sign(dz) * Math.min(Math.abs(dz), 1.1 * dt);
      bt.z += step;
      bt.stride += dt * 9;
      facing = dz > 0 ? 0 : Math.PI;
      const swing = Math.sin(bt.stride) * 0.12;
      parts.hands[0].position.set(0.12, 0.92, 0.3); // still holding the glass
      parts.hands[1].position.copy(REST_HANDS[1]).setZ(REST_HANDS[1].z + swing);
      if (Math.abs(dz) < 0.02) bt.wait = 3 + Math.random() * 5;
    }
    g.position.z = bt.z;
    g.rotation.y += angleDiff(facing, g.rotation.y) * turn;
    this.glass.position.copy(parts.hands[0].position).add(new THREE.Vector3(0, 0.06, 0.02));
    updateArms(parts);
  }
}
