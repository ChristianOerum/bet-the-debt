import * as THREE from 'three';
import { zoneAt, type PlayerInfo, type Pt } from '@casino/shared';
import { buildCharacter, disposeObject, dressCharacter, partsOf, REST_HANDS, updateArms } from './character';
import { buildFood, type FoodModel } from './food';
import { TextSprite } from './labels';
import { angleDiff } from './player';

export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

interface Avatar {
  group: THREE.Group;
  tag: TextSprite;
  shadow: THREE.Mesh;
  target: Pose & { y: number };
  /** Drawn height off the floor (smoothed; above 0 while jumping). */
  y: number;
  stride: number;
  /** Being marched out by security: drawn exactly here, hands up. */
  script: Pose | null;
  state: 'alive' | 'dead';
  deadFor: number;
  /** Which part of the world they are in ('void' = invisible: a ghost). */
  zone: string;
  /** One of the house's regulars, not a player. */
  npc: boolean;
  /** Hands at the crotch, stream going. */
  peeing: boolean;
  /** Seconds left of a punch thrown, a punch taken, a bite or sip. */
  punchFor: number;
  flinchFor: number;
  eatFor: number;
  /** What they are eating or drinking right now, in their hand. */
  food: FoodModel | null;
  /** A gun, held out for a moment after they fire it. */
  gun: FoodModel | null;
  gunId: string;
  aimFor: number;
  /** What they last said, over their head for a few seconds. */
  bubble: TextSprite;
  bubbleFor: number;
}

const bubbleText = (t: string) => (t.length > 46 ? `${t.slice(0, 44).trimEnd()}…` : t);

/** How far a character is lifted when sitting on a chair. */
const SIT_LIFT = 0.33;

const shadowGeo = new THREE.CircleGeometry(0.42, 20);
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.38, depthWrite: false });

/** The other players in the room. Positions arrive ~15 times a second and are smoothed here. */
export class Avatars {
  private map = new Map<number, Avatar>();
  private seated = new Map<number, Pose>();
  /** The zone you are in. */
  viewZone = 'casino';
  /** Every zone you can see into from where you are: people in any of them are drawn. */
  viewZones: Set<string> = new Set(['casino']);

  constructor(private scene: THREE.Scene) {}

  /** Players only, not the regulars. */
  get count() {
    let n = 0;
    for (const a of this.map.values()) if (!a.npc) n++;
    return n;
  }

  add(info: PlayerInfo, npc = false) {
    this.remove(info.id);
    const group = buildCharacter(info.color);
    if (info.outfit?.length) dressCharacter(group, info.outfit);
    group.rotation.order = 'YXZ'; // so tipping over happens in the direction they face
    group.position.set(info.x, 0, info.z);
    group.rotation.y = info.yaw + Math.PI;
    const tag = new TextSprite(npc ? 0.22 : 0.27);
    // Regulars get a quieter tag than the players.
    if (npc) tag.set(info.name, '#d8c8a8', 'rgba(40, 28, 20, 0.75)');
    else tag.set(info.name);
    tag.sprite.position.y = 1.98;
    group.add(tag.sprite);
    const bubble = new TextSprite(0.24);
    bubble.sprite.position.y = 2.32;
    group.add(bubble.sprite);
    // The room is too dim for real shadows away from the tables, so everyone gets a soft blob.
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(group, shadow);
    this.map.set(info.id, {
      group,
      tag,
      shadow,
      target: { x: info.x, z: info.z, yaw: info.yaw, y: 0 },
      y: 0,
      stride: 0,
      script: null,
      state: 'alive',
      deadFor: 0,
      zone: info.zone,
      npc,
      peeing: false,
      punchFor: 0,
      flinchFor: 0,
      eatFor: 0,
      food: null,
      gun: null,
      gunId: '',
      aimFor: 0,
      bubble,
      bubbleFor: 0,
    });
  }

  /** They threw a punch. */
  punch(id: number) {
    const a = this.map.get(id);
    if (a) a.punchFor = 0.32;
  }

  /** They took one. */
  flinch(id: number) {
    const a = this.map.get(id);
    if (a) a.flinchFor = 0.4;
  }

  /** A bite or a sip of this menu item: it appears in their hand on the way to their mouth. */
  eat(id: number, itemId: string) {
    const a = this.map.get(id);
    if (!a) return;
    a.eatFor = 1.1;
    if (a.food) {
      a.group.remove(a.food.group);
      disposeObject(a.food.group);
    }
    a.food = buildFood(itemId);
    a.food.setLeft(0.7);
    a.group.add(a.food.group);
  }

  /** They fired a gun: arm out, the gun in their hand, a flash at the end of it. */
  shoot(id: number, gunId: string) {
    const a = this.map.get(id);
    if (!a) return;
    if (a.gunId !== gunId) {
      if (a.gun) {
        a.group.remove(a.gun.group);
        disposeObject(a.gun.group);
      }
      a.gun = buildFood(gunId);
      a.gun.group.scale.setScalar(1.4); // hands are big on these people
      a.gunId = gunId;
      a.group.add(a.gun.group);
    }
    a.aimFor = 2.5;
    a.gun?.update?.(performance.now() / 1000);
    a.gun?.fire?.();
  }

  setPeeing(id: number, on: boolean) {
    const a = this.map.get(id);
    if (a) a.peeing = on;
  }

  /** Where someone's stream starts and which way it goes, or false if they are not drawn. */
  streamFrom(id: number, origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    const a = this.map.get(id);
    if (!a || !a.group.visible || a.state !== 'alive') return false;
    const g = a.group;
    // Characters face +z in their own space.
    const yaw = g.rotation.y;
    dir.set(Math.sin(yaw), 0, Math.cos(yaw));
    origin.set(g.position.x + dir.x * 0.3, g.position.y + 0.5, g.position.z + dir.z * 0.3);
    return true;
  }

  /** They changed clothes. */
  dress(id: number, outfit: string[]) {
    const a = this.map.get(id);
    if (a) dressCharacter(a.group, outfit);
  }

  /** They said something: show it over their head for a moment. */
  say(id: number, text: string) {
    const a = this.map.get(id);
    if (!a) return;
    a.bubble.set(bubbleText(text), '#2a1a08', 'rgba(246, 234, 210, 0.95)');
    a.bubbleFor = 3 + text.length / 18;
  }

  /** The regular you are looking at, if one is close enough to talk to. */
  patronInView(from: Pt, yaw: number, range: number): { id: number; seated: boolean } | null {
    const lx = -Math.sin(yaw);
    const lz = -Math.cos(yaw);
    let best: { id: number; seated: boolean } | null = null;
    let bestDot = 0.86;
    for (const [id, a] of this.map) {
      if (!a.npc || a.state !== 'alive' || a.zone !== this.viewZone || a.script) continue;
      const dx = a.group.position.x - from.x;
      const dz = a.group.position.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 0.05) continue;
      const dot = (dx * lx + dz * lz) / d;
      if (dot > bestDot) {
        bestDot = dot;
        best = { id, seated: this.seated.has(id) };
      }
    }
    return best;
  }

  /** They went through a door (or died, or woke up): put them there at once. */
  teleport(id: number, zone: string, pose: Pose) {
    const a = this.map.get(id);
    if (!a) return;
    a.zone = zone;
    if (zone === 'void') return; // a ghost: they stay wherever they fell, then vanish
    this.revive(id, pose);
  }

  remove(id: number) {
    const a = this.map.get(id);
    if (!a) return;
    this.scene.remove(a.group, a.shadow);
    a.tag.dispose();
    a.bubble.dispose();
    disposeObject(a.group);
    this.map.delete(id);
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
    this.seated.clear();
  }

  move(id: number, x: number, z: number, yaw: number, y = 0) {
    const a = this.map.get(id);
    if (!a) return;
    a.target = { x, z, yaw, y };
    // People walk between zones through doors now; ghosts ('void') do not send moves.
    if (a.zone !== 'void') a.zone = zoneAt({ x, z });
  }

  /** Players sitting at a game are drawn on their chair, whatever position they last sent. */
  setSeated(seated: Map<number, Pose>) {
    this.seated = seated;
  }

  /** Where this person is drawn right now. */
  positionOf(id: number): Pt | null {
    const a = this.map.get(id);
    return a ? { x: a.group.position.x, z: a.group.position.z } : null;
  }

  /** Where everyone is drawn right now. */
  positions(): Pt[] {
    return [...this.map.values()]
      .filter((a) => a.state === 'alive' && this.viewZones.has(a.zone))
      .map((a) => ({ x: a.group.position.x, z: a.group.position.z }));
  }

  /** Security has them: draw them here, hands up, until they are shot or released. */
  setScript(id: number, pose: Pose | null) {
    const a = this.map.get(id);
    if (a && a.state === 'alive') a.script = pose;
  }

  /** Bang. They tip over backwards and then pop out of existence. */
  kill(id: number) {
    const a = this.map.get(id);
    if (!a) return;
    a.state = 'dead';
    a.deadFor = 0;
    a.script = null;
  }

  /** Back through the entrance for another go. */
  revive(id: number, pose: Pose) {
    const a = this.map.get(id);
    if (!a) return;
    a.state = 'alive';
    a.script = null;
    a.target = { ...pose, y: 0 };
    a.group.position.set(pose.x, 0, pose.z);
    a.group.rotation.set(0, pose.yaw + Math.PI, 0);
    a.group.scale.setScalar(1);
    a.group.visible = true;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    for (const [id, a] of this.map) {
      const g = a.group;
      const parts = partsOf(g);
      // Only draw people who are where you are (a ghost still falls over before vanishing).
      const here = this.viewZones.has(a.zone) || (a.zone === 'void' && a.state === 'dead' && this.viewZones.has('casino'));
      a.shadow.visible = here;
      if (!here) {
        g.visible = false;
        continue;
      }
      if (a.bubbleFor > 0) {
        a.bubbleFor -= dt;
        if (a.bubbleFor <= 0) a.bubble.set('');
      }
      if (a.state !== 'dead') g.visible = true;

      if (a.state === 'dead') {
        a.deadFor += dt;
        const fall = Math.min(1, a.deadFor / 0.45);
        // overshoot a little and settle, like a skittle
        g.rotation.x = -(Math.PI / 2) * (fall + Math.sin(fall * Math.PI) * 0.12);
        g.position.y = 0;
        parts.hands[0].position.y = parts.hands[1].position.y = 0.68 + fall * 0.35;
        const pop = Math.max(0, 1 - Math.max(0, a.deadFor - 2.4) / 0.25);
        g.scale.setScalar(pop);
        g.visible = pop > 0;
        a.shadow.visible = false;
        updateArms(parts);
        continue;
      }

      if (a.script) {
        // Marched along by the bouncers.
        const s = a.script;
        const step = Math.hypot(s.x - g.position.x, s.z - g.position.z);
        g.position.x += (s.x - g.position.x) * (1 - Math.exp(-dt * 16));
        g.position.z += (s.z - g.position.z) * (1 - Math.exp(-dt * 16));
        g.rotation.y += angleDiff(s.yaw + Math.PI, g.rotation.y) * (1 - Math.exp(-dt * 8));
        g.rotation.x = 0;
        if (step > 0.02) a.stride += dt * 11;
        g.position.y = step > 0.02 ? Math.abs(Math.sin(a.stride)) * 0.05 : 0;
        // Hands up, and a nervous wobble.
        parts.hands[0].position.set(-0.48, 1.24 + Math.sin(a.stride * 2.7) * 0.03, 0.05);
        parts.hands[1].position.set(0.48, 1.24 + Math.cos(a.stride * 2.7) * 0.03, 0.05);
        parts.feet[0].visible = parts.feet[1].visible = true;
        g.rotation.z = Math.sin(performance.now() / 40) * 0.02;
        updateArms(parts);
        a.shadow.visible = true;
        a.shadow.position.set(g.position.x, 0.02, g.position.z);
        continue;
      }

      g.rotation.z = 0;
      const seat = this.seated.get(id);
      const t = seat ?? a.target;
      const dx = t.x - g.position.x;
      const dz = t.z - g.position.z;
      g.position.x += dx * k;
      g.position.z += dz * k;
      g.rotation.y += angleDiff(t.yaw + Math.PI, g.rotation.y) * k;
      a.y += ((seat ? 0 : a.target.y) - a.y) * (1 - Math.exp(-dt * 20));
      const airborne = a.y > 0.02;

      const walking = !seat && !airborne && Math.hypot(dx, dz) > 0.03;
      if (walking) a.stride += dt * 11;
      const swing = walking ? Math.sin(a.stride) : 0;
      g.position.y = (seat ? SIT_LIFT : a.y) + Math.abs(swing) * 0.07;

      for (let i = 0; i < 2; i++) {
        const h = parts.hands[i].position;
        h.copy(REST_HANDS[i]);
        h.z += (i === 0 ? swing : -swing) * 0.16;
        if (airborne) {
          // Arms fly up in a jump.
          h.y += 0.32;
          h.x *= 1.15;
        }
        if (seat) h.set(i === 0 ? -0.3 : 0.3, 0.72, 0.32); // resting forward on the table
        if (a.peeing) h.set(i === 0 ? -0.07 : 0.07, 0.5, 0.3); // hands at the crotch
        if (i === 1 && a.punchFor > 0) h.set(0.15, 1.0, 0.75); // fist out in front
        if (i === 1 && a.aimFor > 0) h.set(0.1, 1.22, 0.62); // arm out, aiming
        if (i === 1 && a.eatFor > 0) {
          // Lift it, bite or sip at the mouth, and lower it again.
          const up = Math.sin(Math.min(1, (1.1 - a.eatFor) / 1.1) * Math.PI);
          h.set(0.22 - up * 0.12, 0.85 + up * 0.35, 0.3 + up * 0.04);
        }
      }
      a.punchFor = Math.max(0, a.punchFor - dt);
      a.eatFor = Math.max(0, a.eatFor - dt);
      if (a.food) {
        const hand = parts.hands[1].position;
        a.food.group.position.set(hand.x - 0.02, hand.y - 0.05, hand.z + 0.03);
        const up = Math.sin(Math.min(1, (1.1 - a.eatFor) / 1.1) * Math.PI);
        a.food.group.rotation.x = -up * (a.food.drink ? 1.1 : 0.3); // tip it towards their face (+z)
        a.food.update?.(performance.now() / 1000);
        if (a.eatFor <= 0) {
          a.group.remove(a.food.group);
          disposeObject(a.food.group);
          a.food = null;
        }
      }
      a.aimFor = Math.max(0, a.aimFor - dt);
      if (a.gun) {
        const hand = parts.hands[1].position;
        a.gun.group.visible = a.aimFor > 0;
        a.gun.group.position.set(hand.x, hand.y - 0.1, hand.z);
        a.gun.group.rotation.set(0, Math.PI, 0); // the barrel along +z, the way they face
        a.gun.update?.(performance.now() / 1000);
      }
      // Hit: rock back on the heels.
      a.flinchFor = Math.max(0, a.flinchFor - dt);
      g.rotation.x = -Math.sin((a.flinchFor / 0.4) * Math.PI) * 0.35;
      parts.feet[0].visible = parts.feet[1].visible = !seat;
      updateArms(parts);

      a.shadow.visible = !seat;
      a.shadow.position.set(g.position.x, 0.02, g.position.z);
      a.shadow.scale.setScalar(1 / (1 + a.y));
    }
  }
}
