import { describe, expect, it } from 'vitest';
import {
  ALLEY,
  allColliders,
  clearLine,
  ESCORT,
  EXIT_INSIDE,
  guardSpot,
  isFree,
  NAV_POINTS,
  planEscort,
  pointAt,
  ROOM,
  SHAPES,
  seatExitPoint,
  seatWorld,
  SPAWN,
  STATIONS,
} from '../src/index';

const col = allColliders(true);
const pickups = STATIONS.flatMap((st) =>
  SHAPES[st.type].seats.map((_, i) => ({ st: `${st.id}#${i}`, p: seatExitPoint(seatWorld(st, i)) })),
);

describe('floor plan', () => {
  it('leaves every aisle point and the spawn standing room', () => {
    for (const p of [...NAV_POINTS, EXIT_INSIDE, SPAWN]) expect(isFree(p, ESCORT.navRadius, col), JSON.stringify(p)).toBe(true);
  });
  it('leaves room to stand behind every chair', () => {
    for (const { st, p } of pickups) expect(isFree(p, 0.3, col), st).toBe(true);
  });
});

describe('planEscort', () => {
  it('finds a clear route out from every chair at every table, in every room', () => {
    for (const { st, p: start } of pickups) {
      const plan = planEscort(start);
      expect(plan.direct, st).toBe(true);
      const pts = plan.victim.pts;
      expect(pts[0]).toEqual(start);
      const inside = pts.findIndex((q) => q.x === EXIT_INSIDE.x && q.z === EXIT_INSIDE.z);
      expect(inside).toBeGreaterThan(0);
      for (let k = 1; k <= inside; k++) {
        expect(clearLine(pts[k - 1], pts[k], ESCORT.navRadius, col, k === 1 ? 0.5 : 0), `${st} leg ${k}`).toBe(true);
      }
    }
  });

  it('ends at the far end of the alley, outside the room', () => {
    const plan = planEscort(pickups[0].p);
    const end = pointAt(plan.victim, plan.victim.length);
    expect(end.x).toBeGreaterThan(ROOM.halfW);
    expect(end.x).toBeLessThan(ALLEY.x1);
    expect(end.z).toBeGreaterThan(ALLEY.z0);
  });

  it('brings each guard to your side, and back to their post', () => {
    const plan = planEscort(pickups[7].p);
    for (const g of plan.guards) {
      const arrived = pointAt(g.approach, g.approach.length);
      const beside = guardSpot(plan.victim, 0, g.side);
      expect(arrived.x).toBeCloseTo(beside.x);
      expect(arrived.z).toBeCloseTo(beside.z);
      const home = pointAt(g.back, g.back.length);
      expect(home.x).toBeCloseTo(g.post.x);
      expect(home.z).toBeCloseTo(g.post.z);
    }
  });

  it('happens in order, and never keeps you out for too long', () => {
    for (const { st, p } of pickups) {
      const t = planEscort(p).t;
      expect(t.arrive).toBeLessThan(t.doorOpen + 1e-9);
      expect(t.doorOpen).toBeLessThan(t.walkEnd);
      expect(t.walkEnd).toBeLessThan(t.bang);
      expect(t.bang).toBeLessThan(t.back);
      expect(t.bang).toBeLessThan(t.respawn);
      expect(t.respawn).toBeLessThan(t.end);
      // The back room is the far corner of the building; everywhere else is quicker.
      expect(t.respawn, st).toBeLessThan(36);
    }
  });
});
