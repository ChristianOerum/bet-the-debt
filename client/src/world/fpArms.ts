import * as THREE from 'three';
import { disposeObject, placeLimb } from './character';
import { buildFood, type FoodModel } from './food';
import { toonBright } from './materials';

export type ArmsMode = 'walk' | 'seated' | 'hands-up' | 'pee' | 'hidden';

// Everything here is in camera space: x right, y up, -z straight ahead.
const SHOULDERS = [new THREE.Vector3(-0.32, -0.62, 0.1), new THREE.Vector3(0.32, -0.62, 0.1)];
const POSES: Record<Exclude<ArmsMode, 'hidden'>, THREE.Vector3[]> = {
  walk: [new THREE.Vector3(-0.25, -0.27, -0.62), new THREE.Vector3(0.25, -0.27, -0.62)],
  seated: [new THREE.Vector3(-0.2, -0.33, -0.66), new THREE.Vector3(0.2, -0.33, -0.66)],
  'hands-up': [new THREE.Vector3(-0.33, 0.12, -0.5), new THREE.Vector3(0.33, 0.12, -0.5)],
  // Both hands down in front, at the crotch, aiming.
  pee: [new THREE.Vector3(-0.075, -0.3, -0.47), new THREE.Vector3(0.075, -0.31, -0.48)],
};

/** Where the right fist goes at the end of a punch, and where your hand goes to eat or drink. */
const PUNCH_POSE = new THREE.Vector3(0.06, -0.12, -0.95);
const MOUTH_POSE = new THREE.Vector3(0.04, -0.13, -0.3);
/** A gun held out in front, a little right of the middle, sights roughly on what you look at. */
const AIM_POSE = new THREE.Vector3(0.09, -0.2, -0.52);

/** Your own two arms, at the bottom of the screen. Hang this off the camera. */
export class FirstPersonArms {
  readonly group = new THREE.Group();
  private sleeve = toonBright('#ffffff', 0.18);
  private hands: THREE.Mesh[] = [];
  private limbs: THREE.Mesh[] = [];
  private cur = POSES.walk.map((v) => v.clone());
  private target = new THREE.Vector3();
  /** Seconds into a punch (right hand) or a bite / sip (right hand to the mouth); -1 when not. */
  private punchT = -1;
  private eatT = -1;
  /** Seconds since the last shot; -1 when the gun has settled. */
  private recoilT = -1;
  /**
   * What the right hand is holding: a real 3D model. It lives in its own little scene, drawn
   * after the world with a fresh depth buffer, so a glass never pokes into a wall or a table.
   */
  readonly overlay = new THREE.Scene();
  private root = new THREE.Group();
  private holder = new THREE.Group();
  private model: FoodModel | null = null;
  private heldId = '';
  private visible = false;

  constructor() {
    const skin = toonBright('#ffdcbd', 0.2);
    // Drawn over everything else, so they never poke into a wall or the table.
    for (const m of [this.sleeve, skin]) m.depthTest = false;
    const limbGeo = new THREE.CylinderGeometry(0.042, 0.055, 1, 12);
    const handGeo = new THREE.SphereGeometry(0.058, 16, 12);
    for (let i = 0; i < 2; i++) {
      const limb = new THREE.Mesh(limbGeo, this.sleeve);
      const hand = new THREE.Mesh(handGeo, skin);
      limb.renderOrder = 998;
      hand.renderOrder = 999;
      for (const m of [limb, hand]) m.frustumCulled = false;
      this.limbs.push(limb);
      this.hands.push(hand);
      this.group.add(limb, hand);
    }
    // The held thing's own scene: camera-space, with its own warm light so it always reads.
    this.root.matrixAutoUpdate = false;
    this.overlay.add(this.root);
    this.root.add(new THREE.HemisphereLight('#fff2dc', '#3a2418', 1.6));
    const key = new THREE.DirectionalLight('#ffe4b8', 1.8);
    key.position.set(0.6, 1, 0.8);
    this.root.add(key);
    this.root.add(this.holder);
  }

  /** Put the held thing where the camera is looking from. Call after the camera has moved, before drawing it. */
  syncOverlay(camera: THREE.Camera) {
    this.root.matrix.copy(camera.matrixWorld);
    this.root.matrixWorldNeedsUpdate = true;
    this.holder.visible = this.visible && !!this.model;
  }

  /** Throw a punch with the right hand. */
  punch() {
    if (this.punchT < 0) this.punchT = 0;
  }

  /** Bang: the flash, and the kick. */
  fire() {
    this.recoilT = 0;
    this.model?.fire?.();
  }

  /** Holding a gun (so a click shoots, rather than eats). */
  get aiming() {
    return !!this.model?.aim;
  }

  /** A bite or a sip: the right hand goes to your mouth and back. */
  eat() {
    this.eatT = 0;
  }

  /** Hold this menu item in your right hand, `left` (0-1) of it still there; or nothing. */
  hold(itemId: string | null, left = 1) {
    const next = itemId ?? '';
    if (next !== this.heldId) {
      this.heldId = next;
      if (this.model) {
        this.holder.remove(this.model.group);
        disposeObject(this.model.group);
      }
      this.model = itemId ? buildFood(itemId) : null;
      if (this.model) this.holder.add(this.model.group);
    }
    this.model?.setLeft(left);
  }

  setColor(color: string) {
    this.sleeve.color.set(color);
    this.sleeve.emissive.set(color);
  }

  update(dt: number, mode: ArmsMode, o: { moving: boolean; airborne: boolean; stride: number; time: number }) {
    this.group.visible = mode !== 'hidden';
    // Only in your hand while you are walking about (not seated, hands up, or peeing).
    this.visible = mode === 'walk';
    if (mode === 'hidden') return;
    const k = 1 - Math.exp(-dt * 12);
    if (this.punchT >= 0) this.punchT = this.punchT + dt > 0.32 ? -1 : this.punchT + dt;
    if (this.eatT >= 0) this.eatT = this.eatT + dt > 0.7 ? -1 : this.eatT + dt;
    if (this.recoilT >= 0) this.recoilT = this.recoilT + dt > 0.25 ? -1 : this.recoilT + dt;
    const aim = mode === 'walk' && !!this.model?.aim;
    const kick = this.recoilT >= 0 ? Math.exp(-this.recoilT * 18) * (1 - Math.exp(-this.recoilT * 200)) : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const t = this.target.copy(POSES[mode][i]);
      if (mode === 'walk') {
        if (o.moving && !o.airborne) {
          t.z += Math.sin(o.stride) * side * 0.05;
          t.y += Math.abs(Math.cos(o.stride)) * 0.02;
        }
        t.y += Math.sin(o.time * 1.8 + i) * 0.006; // breathing
        if (o.airborne) {
          t.y += 0.09;
          t.x += side * 0.06;
        }
      } else if (mode === 'hands-up') {
        t.y += Math.sin(o.time * 14 + i * 2) * 0.012; // trembling
      } else if (mode === 'pee') {
        t.x += Math.sin(o.time * 2.3) * 0.012; // a little unsteady
      }
      if (i === 1 && aim) {
        t.copy(AIM_POSE);
        t.y += kick * 0.04 + Math.sin(o.time * 1.8) * 0.004;
        t.z += kick * 0.07;
      } else if (i === 1 && mode === 'walk') {
        if (this.punchT >= 0) {
          // Straight out, fast, and back a little slower.
          const p = this.punchT < 0.1 ? this.punchT / 0.1 : 1 - (this.punchT - 0.1) / 0.22;
          t.lerp(PUNCH_POSE, Math.max(0, p));
          this.cur[i].copy(t);
        } else if (this.eatT >= 0) {
          const p = Math.sin((this.eatT / 0.7) * Math.PI);
          t.lerp(MOUTH_POSE, p);
          this.cur[i].copy(t);
        }
      }
      this.cur[i].lerp(t, k);
      this.hands[i].position.copy(this.cur[i]);
      placeLimb(this.limbs[i], SHOULDERS[i], this.cur[i]);
    }
    // The held thing sits in the right hand: a glass upright in the fist, food on the palm.
    // Taking a sip tips the glass towards you; a bite barely tilts.
    const h = this.cur[1];
    this.holder.position.set(h.x - 0.02, h.y - 0.035, h.z - 0.01);
    const sip = this.eatT >= 0 ? Math.sin((this.eatT / 0.7) * Math.PI) : 0;
    const drink = this.model?.drink ?? true;
    if (aim) {
      // Pointing straight ahead, nose kicking up with each shot.
      this.holder.position.set(h.x, h.y - 0.035, h.z - 0.012); // the grip in the fist
      this.holder.rotation.set(kick * 0.5, 0.04, 0);
    } else this.holder.rotation.set(sip * (drink ? 1.25 : 0.35), -0.35, -0.08);
    this.model?.update?.(o.time);
  }
}
