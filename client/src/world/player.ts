import * as THREE from 'three';
import { EYE_HEIGHT, inWalkable, PLAYER_RADIUS, SPAWN, staticColliders, walkableFor, walkableRects, type Box, type DoorAccess } from '@casino/shared';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Shortest way round from angle b to angle a. */
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const isTyping = (e: Event) => (e.target as HTMLElement | null)?.tagName === 'INPUT';

const GRAVITY = 17;
const JUMP_SPEED = 5.4;

/** Where the camera is put while security is marching you out. */
export interface ScriptPose {
  x: number;
  z: number;
  yaw: number;
  pitch?: number;
}

/**
 * You. Walking: WASD + mouse look (arrow keys also turn and walk), Space to jump.
 * Seated: the camera glides to the chair and the mouse is free for buttons;
 * hold the mouse button on the scene and drag to look around.
 * Escorted: the camera goes where the bouncers take you.
 */
export class PlayerController {
  /** Your feet. `pos.y` is height off the floor while jumping. */
  readonly pos = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
  yaw = SPAWN.yaw;
  pitch = 0;
  /** False until you are logged in and in the casino. */
  active = false;
  /** Walked this frame (the first-person arms sway with it). */
  moving = false;
  /** Advances while walking; drives the bob and the arm swing. */
  stride = 0;
  private vy = 0;
  private keys = new Set<string>();
  private seat: { pos: THREE.Vector3; yaw: number; pitch: number } | null = null;
  private look = { yaw: 0, pitch: 0 };
  private dragging = false;
  /** Seconds since you were shot, or null while you are alive. */
  private deadFor: number | null = null;
  private script: ScriptPose | null = null;
  private colliders = staticColliders();
  /** Where you can walk: the rooms and the archways, the bookcase passage only while it is open, and the doors that open for you. */
  private walk: Box[] = walkableRects(false);
  private access: DoorAccess = { casino: false, apts: [] };
  private secretOpen = false;
  /** Doorways (narrow strips between two spaces), for lining you up with one. */
  private doorStrips: Box[] = [];
  /** The Esc menu is open: no walking, no looking. */
  paused = false;
  /** 0 sober, 1 legless: you do not walk in a straight line. */
  drunk = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
  ) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || this.paused) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && this.active && !this.seat) {
        e.preventDefault(); // no page scrolling, no pressing whatever button had focus
        if (!e.repeat) this.jump();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.active || this.dead || this.script || this.paused) return;
      if (this.seat) {
        if (!this.dragging) return;
        this.look.yaw = clamp(this.look.yaw - e.movementX * 0.004, -1.3, 1.3);
        this.look.pitch = clamp(this.look.pitch - e.movementY * 0.004, -0.5, 0.7);
      } else if (document.pointerLockElement === this.canvas) {
        this.yaw -= e.movementX * 0.0023;
        this.pitch = clamp(this.pitch - e.movementY * 0.0023, -1.3, 1.3);
      }
    });
    canvas.addEventListener('mousedown', () => {
      if (!this.active || this.dead || this.script || this.paused) return;
      if (this.seat) this.dragging = true;
      else this.lockMouse();
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
  }

  get seated() {
    return this.seat !== null;
  }

  get dead() {
    return this.deadFor !== null;
  }

  get scripted() {
    return this.script !== null;
  }

  get airborne() {
    return this.pos.y > 0.001;
  }

  get mouseLocked() {
    return document.pointerLockElement === this.canvas;
  }

  /** Tip your head down this far (radians), to see what is at your feet. */
  lookDown(amount: number) {
    this.pitch = Math.min(this.pitch, -amount);
  }

  /** Open or close the bookcase passage to the back room. */
  setSecretOpen(open: boolean) {
    if (open === this.secretOpen) return;
    this.secretOpen = open;
    this.rebuildWalk();
  }

  /** Which doors open for you. */
  setAccess(access: DoorAccess) {
    this.access = access;
    this.rebuildWalk();
  }

  private rebuildWalk() {
    this.walk = walkableFor(this.access, this.secretOpen);
    // Bigger flats have their furniture in other places.
    const levels = new Map(this.access.apts.map((a) => [a.slot, a.level]));
    this.colliders = staticColliders((s) => levels.get(s) ?? 1);
    // The doorways are whatever walkableFor adds on top of the plain map.
    this.doorStrips = this.walk.slice(walkableRects(this.secretOpen).length).filter((b) => Math.min(b.x1 - b.x0, b.z1 - b.z0) < 3);
    this.settle();
  }

  /** A door shut while you stood in its frame: step to the nearest spot that is clear of it. */
  private settle() {
    const p = this.pos;
    const ok = (x: number, z: number) => inWalkable({ x, z }, PLAYER_RADIUS, this.walk);
    if (this.seat || this.script || ok(p.x, p.z)) return;
    for (let r = 0.05; r <= 1.5; r += 0.05) {
      for (let a = 0; a < 16; a++) {
        const x = p.x + Math.cos((a / 16) * Math.PI * 2) * r;
        const z = p.z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (ok(x, z)) {
          p.x = x;
          p.z = z;
          return;
        }
      }
    }
  }

  pause(on: boolean) {
    this.paused = on;
    this.keys.clear();
    if (on && this.mouseLocked) document.exitPointerLock();
  }

  lockMouse() {
    if (!this.active || this.seat || this.dead || this.script || this.paused || this.mouseLocked) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* the browser said no; the "click to look around" hint stays up */
    }
  }

  jump() {
    if (!this.active || this.seat || this.dead || this.script || this.airborne) return;
    this.vy = JUMP_SPEED;
  }

  sit(pose: { pos: THREE.Vector3; look: THREE.Vector3 }) {
    const d = pose.look.clone().sub(pose.pos);
    this.seat = {
      pos: pose.pos.clone(),
      yaw: Math.atan2(-d.x, -d.z),
      pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)),
    };
    this.look = { yaw: 0, pitch: 0 };
    this.keys.clear();
    this.pos.y = 0;
    this.vy = 0;
    if (this.mouseLocked) document.exitPointerLock();
  }

  /** Security has you. The camera follows `pose` until you are shot or set free. */
  setScript(pose: ScriptPose) {
    if (!this.script) {
      this.keys.clear();
      this.seat = null;
      this.dragging = false;
      if (this.mouseLocked) document.exitPointerLock();
    }
    this.script = pose;
    this.pos.set(pose.x, 0, pose.z);
    this.vy = 0;
  }

  private waking: { t: number; lying: THREE.Vector3; stand: ScriptPose } | null = null;

  get isWaking() {
    return this.waking !== null;
  }

  /** Start flat on your back in bed, staring at the ceiling, then get up and stand at `stand`. */
  wakeUp(lying: THREE.Vector3, stand: ScriptPose) {
    this.stand(stand.x, stand.z, stand.yaw);
    this.waking = { t: 0, lying, stand };
    this.camera.position.copy(lying);
    this.camera.rotation.set(1.35, stand.yaw + Math.PI / 2, 0.3);
  }

  /** You have been shot. The camera keels over; nothing responds until `stand` is called. */
  die() {
    this.deadFor = 0;
    this.script = null;
    this.keys.clear();
    this.dragging = false;
    if (this.mouseLocked) document.exitPointerLock();
  }

  stand(x: number, z: number, yaw: number) {
    this.seat = null;
    this.deadFor = null;
    this.script = null;
    this.waking = null;
    this.camera.rotation.z = 0;
    this.dragging = false;
    this.pos.set(x, 0, z);
    this.vy = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.collide();
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c)) ? 1 : 0;
  }

  update(dt: number) {
    if (!this.active) return;
    const cam = this.camera;
    this.moving = false;

    if (this.deadFor !== null) {
      // Knocked backwards off your feet, ending up staring at the sky.
      this.deadFor += dt;
      const k = 1 - Math.exp(-dt * 5);
      cam.position.y += (0.32 - cam.position.y) * k;
      cam.rotation.x += (1.15 - cam.rotation.x) * k;
      cam.rotation.z += (0.55 - cam.rotation.z) * k;
      return;
    }

    if (this.waking) {
      // A moment staring at the ceiling, then a groan and up you get.
      const w = this.waking;
      w.t += dt;
      const k = Math.min(1, Math.max(0, (w.t - 1.3) / 1.4));
      const e = k * k * (3 - 2 * k);
      cam.position.set(
        w.lying.x + (w.stand.x - w.lying.x) * e,
        w.lying.y + (EYE_HEIGHT - w.lying.y) * e,
        w.lying.z + (w.stand.z - w.lying.z) * e,
      );
      cam.rotation.set(1.35 * (1 - e), w.stand.yaw + (Math.PI / 2) * (1 - e), 0.3 * (1 - e));
      if (w.t > 2.8) {
        this.waking = null;
        this.yaw = w.stand.yaw;
        this.pitch = 0;
      }
      return;
    }

    if (this.script) {
      const s = this.script;
      const k = 1 - Math.exp(-dt * 14);
      const step = Math.hypot(s.x - cam.position.x, s.z - cam.position.z);
      this.moving = step > 0.02;
      if (this.moving) this.stride += dt * 10;
      cam.position.x += (s.x - cam.position.x) * k;
      cam.position.z += (s.z - cam.position.z) * k;
      cam.position.y = EYE_HEIGHT + (this.moving ? Math.sin(this.stride) * 0.03 : 0);
      const turn = 1 - Math.exp(-dt * 5);
      cam.rotation.y += angleDiff(s.yaw, cam.rotation.y) * turn;
      cam.rotation.x += ((s.pitch ?? 0) - cam.rotation.x) * turn;
      cam.rotation.z = 0;
      this.yaw = cam.rotation.y;
      return;
    }

    if (this.seat) {
      const k = 1 - Math.exp(-dt * 7);
      cam.position.lerp(this.seat.pos, k);
      cam.rotation.y += angleDiff(this.seat.yaw + this.look.yaw, cam.rotation.y) * k;
      cam.rotation.x += (this.seat.pitch + this.look.pitch - cam.rotation.x) * k;
      cam.rotation.z = 0;
      return;
    }

    this.yaw += (this.down('ArrowLeft') - this.down('ArrowRight')) * 2.4 * dt;
    const fwd = this.down('KeyW', 'ArrowUp') - this.down('KeyS', 'ArrowDown');
    let side = this.down('KeyD') - this.down('KeyA');
    this.moving = fwd !== 0 || side !== 0;
    // Drunk: every step drifts off to one side, then the other.
    if (this.moving && this.drunk > 0.05) {
      const t = performance.now() / 1000;
      side += (Math.sin(t * 1.3) + Math.sin(t * 3.1) * 0.4) * this.drunk * 0.8;
    }
    if (this.moving) {
      const speed = (this.down('ShiftLeft', 'ShiftRight') ? 6.5 : 4) / Math.hypot(fwd, side);
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      this.step((-sin * fwd + cos * side) * speed * dt, (-cos * fwd - sin * side) * speed * dt);
      if (!this.airborne) this.stride += dt * 10;
    }

    // Jumping
    if (this.airborne || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vy = 0;
      }
    }

    const bob = this.moving && !this.airborne ? Math.sin(this.stride) * 0.035 : 0;
    cam.position.set(this.pos.x, EYE_HEIGHT + this.pos.y + bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0);
  }

  /** Walk by (dx, dz), sliding along walls rather than stopping dead. */
  private step(dx: number, dz: number) {
    const p = this.pos;
    const ok = (x: number, z: number) => inWalkable({ x, z }, PLAYER_RADIUS, this.walk);
    const ox = p.x;
    const oz = p.z;
    if (ok(ox + dx, oz + dz)) {
      p.x += dx;
      p.z += dz;
    } else if (!this.funnel(dx, dz, ok)) {
      if (ok(ox + dx, oz)) p.x += dx;
      else if (ok(ox, oz + dz)) p.z += dz;
    }
    this.collide();
    if (!ok(p.x, p.z) && ok(ox, oz)) {
      p.x = ox;
      p.z = oz;
    }
  }

  /**
   * Walking into the wall right beside a doorway: slide sideways towards the middle of the
   * doorway instead of stopping, so you do not have to line yourself up exactly.
   */
  private funnel(dx: number, dz: number, ok: (x: number, z: number) => boolean): boolean {
    const p = this.pos;
    const step = Math.hypot(dx, dz);
    for (const b of this.doorStrips) {
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      // The strip is longer along the way through than it is wide.
      const throughX = b.x1 - b.x0 > b.z1 - b.z0;
      const along = throughX ? p.z - cz : p.x - cx; // how far off the doorway's middle line
      const toward = throughX ? dx * Math.sign(cx - p.x) : dz * Math.sign(cz - p.z);
      const off = throughX ? Math.abs(p.x - cx) : Math.abs(p.z - cz); // how far from the doorway
      const halfLen = throughX ? (b.x1 - b.x0) / 2 : (b.z1 - b.z0) / 2;
      if (off > halfLen + 0.6 || Math.abs(along) > 1.1 || toward <= 0) continue;
      // Nudge across, towards the doorway's middle line.
      const shift = -Math.sign(along) * Math.min(Math.abs(along), step);
      const nx = throughX ? p.x : p.x + shift;
      const nz = throughX ? p.z + shift : p.z;
      if (ok(nx, nz)) {
        p.x = nx;
        p.z = nz;
        return true;
      }
    }
    return false;
  }

  /** Keep out of round obstacles, the bar and the furniture. */
  private collide() {
    const p = this.pos;
    const R = PLAYER_RADIUS;
    for (const c of this.colliders.circles) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.r + R;
      const dist = Math.hypot(dx, dz);
      if (dist >= min) continue;
      if (dist < 1e-6) {
        p.x = c.x + min;
        continue;
      }
      p.x = c.x + (dx / dist) * min;
      p.z = c.z + (dz / dist) * min;
    }
    for (const b of this.colliders.boxes) {
      const cx = clamp(p.x, b.x0, b.x1);
      const cz = clamp(p.z, b.z0, b.z1);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d > 1e-6) {
        p.x = cx + (dx / d) * R;
        p.z = cz + (dz / d) * R;
        continue;
      }
      // Somehow inside: leave by the nearest edge.
      const exits: [number, () => void][] = [
        [p.x - b.x0, () => (p.x = b.x0 - R)],
        [b.x1 - p.x, () => (p.x = b.x1 + R)],
        [p.z - b.z0, () => (p.z = b.z0 - R)],
        [b.z1 - p.z, () => (p.z = b.z1 + R)],
      ];
      exits.sort((a, c) => a[0] - c[0])[0][1]();
    }
  }
}
