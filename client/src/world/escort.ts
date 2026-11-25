import * as THREE from 'three';
import {
  areaAt,
  ESCORT,
  GUARD_POSTS,
  guardSpot,
  planEscort,
  pointAt,
  yawOf,
  type EscortEvent,
  type EscortPlan,
  type Post,
  type Pt,
} from '@casino/shared';
import { buildCharacter, buildGun, partsOf, REST_HANDS, updateArms } from './character';
import { glowSprite } from './materials';
import { modelYaw, yawToward } from './npcs';
import { angleDiff } from './player';
import type { Pose } from './avatars';

export interface EscortHooks {
  /** Where the person being shown out should be right now (until they are shot). */
  victim(ev: EscortEvent, pose: Pose): void;
  /** A guard fired from `from`. `first` is the one that counts. */
  shot(ev: EscortEvent, first: boolean, from: Pt): void;
  /** They walk back in through the entrance. */
  respawn(ev: EscortEvent): void;
}

interface Guard {
  g: THREE.Group;
  gun: THREE.Group;
  muzzle: THREE.Sprite;
  post: Post;
  x: number;
  z: number;
  lastTarget: Pt;
  stride: number;
  aim: number;
  firedAt: number | null;
}

interface Active {
  ev: EscortEvent;
  plan: EscortPlan;
  t: number;
  /** performance.now() in seconds when it began. */
  startedAt: number;
  fired: boolean[];
  respawned: boolean;
}

/** The two bouncers at the exit, and the walk they take people on. */
export class Escorts {
  private guards: Guard[] = [];
  private active: Active | null = null;
  private doorOpen = 0;
  private flash = new THREE.PointLight('#ffd27a', 0, 12, 2);
  private tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Object3D,
    private doors: THREE.Object3D[],
    private hooks: EscortHooks,
  ) {
    for (const post of GUARD_POSTS.exit) {
      const g = buildCharacter('', 'guard');
      g.position.set(post.x, 0, post.z);
      g.rotation.y = modelYaw(post.yaw);
      const gun = buildGun();
      gun.visible = false;
      const muzzle = glowSprite('#ffd27a', 1.2);
      muzzle.position.set(0, 0.03, 0.62);
      muzzle.visible = false;
      gun.add(muzzle);
      g.add(gun);
      scene.add(g);
      this.guards.push({ g, gun, muzzle, post, x: post.x, z: post.z, lastTarget: { ...post }, stride: 0, aim: 0, firedAt: null });
    }
    scene.add(this.flash); // added once, at intensity 0, so it never forces a shader rebuild mid-game
  }

  get busy() {
    return this.active !== null;
  }

  /** Walking someone out of the back room: the bookcase has to stay open until they are through. */
  get needsSecretDoor() {
    const a = this.active;
    return !!a && areaAt(a.plan.start)?.id === 'back' && a.t < a.plan.t.walkEnd;
  }

  start(ev: EscortEvent) {
    // The server never overlaps escorts, but our clock can lag a little behind it.
    if (this.active && !this.active.respawned) this.hooks.respawn(this.active.ev);
    this.active = { ev, plan: planEscort(ev.start), t: 0, startedAt: performance.now() / 1000, fired: [false, false], respawned: false };
  }

  /** Stop showing this player's walk (they are already a ghost, or awake at home). */
  forget(id: number) {
    if (this.active?.ev.id === id) this.active = null; // the guards stroll back to their posts
  }

  /** Forget everything (you logged out). */
  reset() {
    this.active = null;
    this.doorOpen = 0;
    for (const gd of this.guards) {
      gd.x = gd.post.x;
      gd.z = gd.post.z;
      gd.aim = 0;
      gd.firedAt = null;
    }
  }

  update(dt: number, time: number) {
    const a = this.active;
    // Wall-clock time, not summed frame times: a slow or hidden tab must stay in step with the server.
    if (a) a.t = time - a.startedAt;
    const t = a?.t ?? 0;
    const T = a?.plan.t;

    // The doors swing open as you get near them, and shut once the guards are back.
    const open = a && T && t >= T.doorOpen && t < T.end - 0.8 ? 1 : 0;
    this.doorOpen += (open - this.doorOpen) * (1 - Math.exp(-dt * 4));
    for (const d of this.doors) d.rotation.y = (d.userData.openSign as number) * this.doorOpen * 1.45;
    this.flash.intensity *= Math.exp(-dt * 30);

    if (!a || !T) {
      for (const [i, gd] of this.guards.entries()) this.pose(gd, gd.post, gd.post.yaw, false, dt, time, i);
      return;
    }
    const P = a.plan;

    // Where you are on your walk.
    const sv = t < T.arrive ? 0 : Math.min(P.victim.length, (t - T.arrive) * ESCORT.walkSpeed);
    const v = pointAt(P.victim, sv);

    // Where each guard is.
    const spots: Pt[] = [];
    for (const [i, gd] of this.guards.entries()) {
      const plan = P.guards[i];
      let at: Pt;
      let dir: { dx: number; dz: number };
      let moving: boolean;
      if (t < T.arrive) {
        const s = Math.min(plan.approach.length, t * ESCORT.approachSpeed);
        const p = pointAt(plan.approach, s);
        at = p;
        dir = p;
        moving = s < plan.approach.length;
      } else if (t < T.back) {
        const sg = Math.max(0, Math.min(P.stopS, sv - ESCORT.trail));
        at = guardSpot(P.victim, sg, plan.side);
        dir = pointAt(P.victim, sg);
        moving = sg > 0 && sg < P.stopS;
      } else {
        const s = Math.min(plan.back.length, (t - T.back) * ESCORT.walkSpeed);
        const p = pointAt(plan.back, s);
        at = p;
        dir = p;
        moving = s < plan.back.length;
      }
      let yaw: number;
      if (moving) yaw = yawOf(dir.dx, dir.dz);
      else if (t < T.back) yaw = yawToward(at, v);
      else yaw = gd.post.yaw;

      // Guns come up once you have turned round, and go away on the walk back.
      const aiming = t >= T.walkEnd + ESCORT.turn * 0.5 && t < T.back + 0.3;
      gd.aim += ((aiming ? 1 : 0) - gd.aim) * (1 - Math.exp(-dt * 6));
      this.pose(gd, at, yaw, moving, dt, time, i);
      spots.push({ x: gd.x, z: gd.z });

      // Bang.
      const fireAt = T.bang + i * ESCORT.doubleTap;
      if (!a.fired[i] && t >= fireAt) {
        a.fired[i] = true;
        gd.firedAt = time;
        gd.muzzle.getWorldPosition(this.tmp);
        this.flash.position.copy(this.tmp);
        this.flash.intensity = 60;
        this.hooks.shot(a.ev, i === 0, { x: gd.x, z: gd.z });
      }
    }

    // Which way you face: at the guards while they come, then where you are going,
    // then round to face them at the end of the alley.
    const mid = { x: (spots[0].x + spots[1].x) / 2, z: (spots[0].z + spots[1].z) / 2 };
    const walking = t >= T.arrive && t < T.walkEnd;
    const yaw = walking ? yawOf(v.dx, v.dz) : yawToward(v, mid);
    if (t < T.bang) this.hooks.victim(a.ev, { x: v.x, z: v.z, yaw });

    if (!a.respawned && t >= T.respawn) {
      a.respawned = true;
      this.hooks.respawn(a.ev);
    }
    if (t >= T.end) this.active = null;
  }

  /** Put a guard somewhere, facing somewhere, with the right arms for what they are doing. */
  private pose(gd: Guard, at: Pt, yaw: number, moving: boolean, dt: number, time: number, i: number) {
    const k = 1 - Math.exp(-dt * 10);
    gd.x += (at.x - gd.x) * k;
    gd.z += (at.z - gd.z) * k;
    gd.lastTarget = at;
    const g = gd.g;
    g.position.set(gd.x, 0, gd.z);
    g.rotation.y += angleDiff(modelYaw(yaw), g.rotation.y) * (1 - Math.exp(-dt * 8));
    if (moving) gd.stride += dt * 10;
    const swing = moving ? Math.sin(gd.stride) : 0;
    g.position.y = Math.abs(swing) * 0.05;

    const parts = partsOf(g);
    const kick = gd.firedAt === null ? 0 : Math.exp(-(time - gd.firedAt) * 9);
    const aim = gd.aim;
    gd.gun.visible = aim > 0.05;
    gd.gun.position.set(0.14, 0.6 + 0.42 * aim + kick * 0.05, 0.28 + 0.24 * aim - kick * 0.08);
    gd.gun.rotation.x = (1 - aim) * 1.2 - kick * 0.35;
    gd.muzzle.visible = kick > 0.45;

    if (aim > 0.05) {
      // Both hands on the gun.
      parts.hands[1].position.set(gd.gun.position.x, gd.gun.position.y - 0.08, gd.gun.position.z - 0.03);
      parts.hands[0].position.set(0.02, gd.gun.position.y - 0.1, gd.gun.position.z - 0.08);
    } else if (moving) {
      parts.hands[0].position.copy(REST_HANDS[0]).setZ(REST_HANDS[0].z + swing * 0.16);
      parts.hands[1].position.copy(REST_HANDS[1]).setZ(REST_HANDS[1].z - swing * 0.16);
    } else {
      // At their post: hands clasped in front, very professional.
      const breathe = Math.sin(time * 1.6 + i * 2) * 0.01;
      parts.hands[0].position.set(-0.05, 0.6 + breathe, 0.34);
      parts.hands[1].position.set(0.05, 0.6 + breathe, 0.35);
    }
    updateArms(parts);
  }
}
