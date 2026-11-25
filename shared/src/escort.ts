// Being shown out. When a player cannot pay, the two bodyguards at the exit walk over,
// march them through the exit door into the alley, and shoot them there.
// Everything here is worked out from the starting spot alone, so the server and every
// browser agree on the same route and the same timings without sending them around.

import { allColliders, DOORS, GUARD_POSTS, isFree, type Colliders, type Post, type Pt } from './world';

/** Hand-placed points in the aisles. A route is the shortest chain of these with nothing in the way. */
export const NAV_POINTS: Pt[] = [
  // main hall
  { x: 0, z: 10.5 },
  { x: 0, z: 0 },
  { x: -10.5, z: 7 },
  { x: 10.5, z: 7 },
  { x: -12, z: -1.5 },
  { x: 11.5, z: -1.5 },
  { x: -12.5, z: -6 },
  { x: -3.5, z: -4 },
  { x: 3.5, z: -4 },
  { x: -3, z: -12 },
  { x: 3, z: -12 },
  { x: 0, z: -12.5 },
  { x: 15.5, z: -12.5 },
  { x: 17.5, z: 9.8 },
  { x: 16, z: 2 },
  // card room
  { x: 0, z: -17.2 },
  { x: 0, z: -26 },
  { x: -10.5, z: -17.2 },
  { x: 10.5, z: -17.2 },
  { x: -10.5, z: -26 },
  { x: 9, z: -26 },
  { x: -12, z: -24.4 },
  // back room
  { x: -15.6, z: -24.4 },
  { x: -16, z: -21.2 },
  { x: -20.5, z: -24 },
  { x: -15.2, z: -26.8 },
  { x: -19.8, z: -27 },
  // dice parlour
  { x: 21.6, z: 9.8 },
  { x: 22, z: 12.2 },
  { x: 29.5, z: 12 },
  { x: 22, z: 17.5 },
  { x: 29, z: 17.5 },
  { x: 29, z: 6.4 },
  // the restrooms: either side of the door, and in front of the stalls
  { x: -17.8, z: 9.3 },
  { x: -21.3, z: 9.3 },
  { x: -24.2, z: 9.3 },
];
const NAV_POINTS_INTERNAL = NAV_POINTS;

export const ESCORT = {
  /** Guards hurrying over to you, metres a second. */
  approachSpeed: 5.2,
  /** Everyone walking out together (a brisk frog-march). */
  walkSpeed: 3.6,
  /** How far behind you the guards walk. */
  trail: 1.3,
  /** How far apart they walk, either side of you. */
  side: 0.62,
  /** In the alley they stop this far short of where you end up. */
  stopGap: 3.4,
  /** You turn round to face them... */
  turn: 0.9,
  /** ...they take aim... */
  aim: 1.1,
  /** ...and the second guard fires this long after the first. */
  doubleTap: 0.16,
  /** From the shot until you walk back in through the entrance. */
  deathView: 4.2,
  /** From the shot until the guards head back inside. */
  returnDelay: 1.6,
  /** How much room the route keeps clear around people. */
  navRadius: 0.4,
};

export interface Line {
  pts: Pt[];
  cum: number[];
  length: number;
}

export function makeLine(pts: Pt[]): Line {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

/** The point `s` metres along a line, and the direction of travel there. */
export function pointAt(l: Line, s: number): Pt & { dx: number; dz: number } {
  const n = l.pts.length;
  if (n === 1) return { ...l.pts[0], dx: 0, dz: -1 };
  s = Math.max(0, Math.min(l.length, s));
  let i = 1;
  while (i < n - 1 && l.cum[i] < s) i++;
  const a = l.pts[i - 1];
  const b = l.pts[i];
  const seg = l.cum[i] - l.cum[i - 1];
  if (seg < 1e-9) return { x: b.x, z: b.z, dx: 0, dz: -1 };
  const t = (s - l.cum[i - 1]) / seg;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / seg, dz: (b.z - a.z) / seg };
}

/** Where a guard walks: beside the route, on their own side of it. */
export function guardSpot(l: Line, s: number, side: number): Pt {
  const p = pointAt(l, s);
  return { x: p.x - p.dz * side * ESCORT.side, z: p.z + p.dx * side * ESCORT.side };
}

/** Yaw (0 = looking toward -z) for travelling in direction (dx, dz). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Can something of radius `r` walk the straight line from a to b? `skip` ignores the first metres, `skipEnd` the last. */
export function clearLine(a: Pt, b: Pt, r: number, col: Colliders, skip = 0, skipEnd = 0): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(d / 0.15));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    if (t * d < skip || (1 - t) * d < skipEnd) continue;
    if (!isFree({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, r, col)) return false;
  }
  return true;
}

/** Just inside the exit door. */
export const EXIT_INSIDE: Pt = { x: DOORS.exit.x - 4, z: DOORS.exit.z };
/** Through the door, along the alley, to the wall at the dead end. */
export const ALLEY_ROUTE: Pt[] = [
  { x: DOORS.exit.x + 0.5, z: DOORS.exit.z },
  { x: DOORS.exit.x + 3.6, z: DOORS.exit.z },
  { x: DOORS.exit.x + 3.6, z: -12 },
];

/** Shortest walk from `start` to `goal` through the aisle points, or null if there is none. */
function route(start: Pt, goal: Pt, col: Colliders, goalSlack = 0): Pt[] | null {
  const nodes = [start, ...NAV_POINTS_INTERNAL, goal];
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  const seen = new Map<number, boolean>();
  const visible = (i: number, j: number) => {
    const [a, b] = i < j ? [i, j] : [j, i];
    const key = a * n + b;
    let v = seen.get(key);
    if (v === undefined) {
      // From the starting spot, ignore the first half metre: it is right next to a chair.
      v = clearLine(nodes[a], nodes[b], ESCORT.navRadius, col, a === 0 ? 0.5 : 0, b === n - 1 ? goalSlack : 0);
      seen.set(key, v);
    }
    return v;
  };
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === n - 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || !visible(u, v)) continue;
      const d = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (dist[n - 1] === Infinity) return null;
  const out: Pt[] = [];
  for (let i = n - 1; i >= 0; i = prev[i]) out.unshift(nodes[i]);
  return out;
}

const navCols = { open: null as Colliders | null, shut: null as Colliders | null };

/**
 * A walk from `from` to `to` (usually the spot behind a chair) through the aisles.
 * The back room is only reachable with `secretOpen`. Null if there is no way.
 */
export function navRoute(from: Pt, to: Pt, secretOpen = false): Pt[] | null {
  const key = secretOpen ? 'open' : 'shut';
  const col = (navCols[key] ??= allColliders(secretOpen));
  return route(from, to, col, 0.5);
}

export interface GuardPlan {
  /** -1 walks on the victim's right, +1 on their left. */
  side: number;
  post: Post;
  /** From their post to beside you. */
  approach: Line;
  /** From where they fired back to their post. */
  back: Line;
}

export interface EscortPlan {
  start: Pt;
  /** Your walk, from where you were picked up to the alley wall. */
  victim: Line;
  /** True when the route needed no fallback (always, from any chair in the room). */
  direct: boolean;
  /** How far along your walk the guards stop. */
  stopS: number;
  guards: GuardPlan[];
  /** Seconds after the escort starts. */
  t: {
    /** Guards beside you; the walk begins. */
    arrive: number;
    /** You reach the alley wall. */
    walkEnd: number;
    /** The exit doors swing open. */
    doorOpen: number;
    /** First shot. */
    bang: number;
    /** You walk back in through the entrance. */
    respawn: number;
    /** Guards head back inside. */
    back: number;
    /** Guards at their posts, doors shut. The next escort may start. */
    end: number;
  };
}

export function planEscort(start: Pt): EscortPlan {
  const col = allColliders(true);
  let indoor = route(start, EXIT_INSIDE, col);
  const direct = indoor !== null;
  if (!indoor) {
    // Somewhere odd: head for the nearest aisle point first.
    const near = [...NAV_POINTS_INTERNAL].sort(
      (a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z),
    )[0];
    indoor = [start, ...(route(near, EXIT_INSIDE, col) ?? [near, EXIT_INSIDE])];
  }
  const victim = makeLine([...indoor, ...ALLEY_ROUTE]);
  const m = indoor.length - 1; // where EXIT_INSIDE sits in the victim's route
  const stopS = Math.max(0, victim.length - ESCORT.stopGap);

  const guards = GUARD_POSTS.exit.map((post, i): GuardPlan => {
    const side = i === 0 ? -1 : 1;
    const lane = (k: number) => guardSpot(victim, victim.cum[k], side);
    const approach: Pt[] = [post];
    for (let k = m; k >= 1; k--) approach.push(lane(k));
    approach.push(guardSpot(victim, 0, side));
    const back: Pt[] = [guardSpot(victim, stopS, side)];
    for (let k = victim.pts.length - 1; k >= m; k--) if (victim.cum[k] < stopS) back.push(lane(k));
    back.push(post);
    return { side, post, approach: makeLine(approach), back: makeLine(back) };
  });

  const arrive = Math.max(1.5, ...guards.map((g) => g.approach.length / ESCORT.approachSpeed));
  const walkEnd = arrive + victim.length / ESCORT.walkSpeed;
  const bang = walkEnd + ESCORT.turn + ESCORT.aim;
  const back = bang + ESCORT.returnDelay;
  return {
    start,
    victim,
    direct,
    stopS,
    guards,
    t: {
      arrive,
      walkEnd,
      doorOpen: arrive + Math.max(0, victim.cum[m] - 2.5) / ESCORT.walkSpeed,
      bang,
      respawn: bang + ESCORT.deathView,
      back,
      end: back + Math.max(...guards.map((g) => g.back.length)) / ESCORT.walkSpeed + 0.6,
    },
  };
}
