import { describe, expect, it } from 'vitest';
import {
  APT_SLOTS,
  aptRect,
  aptSize,
  aptToWorld,
  inWalkable,
  isFree,
  PLAYER_RADIUS,
  SPAWN,
  staticColliders,
  walkableFor,
  zoneAt,
  type Box,
  type DoorAccess,
  type Pt,
} from '../src/index';

/** Can you walk this route in straight lines, every step of the way? */
function walkable(route: Pt[], rects: Box[]): boolean {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
      if (!inWalkable(p, PLAYER_RADIUS, rects)) return false;
    }
  }
  return true;
}

const everyone = (casino: boolean): DoorAccess => ({ casino, apts: Array.from({ length: APT_SLOTS }, (_, slot) => ({ slot, level: 1 })) });

/** From getting out of bed, out of the flat, down the corridor, across the road, to the casino doors. */
function bedToCasino(slot: number, level = 1): Pt[] {
  const { w, d } = aptSize(level);
  const out = aptToWorld(slot, level, 0.9, d + 0.9); // just outside the front door, in the corridor
  return [aptToWorld(slot, level, w - 1.55, 2.6), aptToWorld(slot, level, 0.9, d - 0.6), out, { x: 0, z: out.z }, { x: 0, z: 30 }, { x: 0, z: 16.2 }, { x: 0, z: 14 }, SPAWN];
}

describe('walking about', () => {
  it('every flat sits off the corridor, and none overlap', () => {
    for (let a = 0; a < APT_SLOTS; a++) {
      for (let b = a + 1; b < APT_SLOTS; b++) {
        const r = aptRect(a, 3);
        const s = aptRect(b, 3);
        const overlap = r.x0 < s.x1 && s.x0 < r.x1 && r.z0 < s.z1 && s.z0 < r.z1;
        expect(overlap, `${a} and ${b}`).toBe(false);
      }
    }
  });

  for (let slot = 0; slot < APT_SLOTS; slot++) {
    it(`flat ${slot}: from bed to the casino floor on foot`, () => {
      expect(walkable(bedToCasino(slot), walkableFor(everyone(true)))).toBe(true);
      expect(zoneAt(bedToCasino(slot)[0])).toBe(`apt:${slot}`);
    });
  }

  for (const level of [2, 3]) {
    it(`a level ${level} flat: out of bed and out of the door, past all the new furniture`, () => {
      const access: DoorAccess = { casino: true, apts: Array.from({ length: APT_SLOTS }, (_, slot) => ({ slot, level })) };
      const col = staticColliders(() => level);
      for (let slot = 0; slot < APT_SLOTS; slot++) {
        const route = bedToCasino(slot, level);
        expect(walkable(route, walkableFor(access)), `flat ${slot}`).toBe(true);
        // Getting up, walking to the door and out of it, without walking through furniture.
        for (const p of route.slice(0, 3)) expect(isFree(p, PLAYER_RADIUS * 0.9, { ...col, walk: walkableFor(access) }), `flat ${slot} at ${p.x},${p.z}`).toBe(true);
      }
    });
  }

  it('the casino doors stay shut on a run (or with no lobby)', () => {
    expect(walkable(bedToCasino(0), walkableFor(everyone(false)))).toBe(false);
    // ...but the street and the building are still all yours.
    expect(walkable(bedToCasino(0).slice(0, 6), walkableFor(everyone(false)))).toBe(true);
  });

  it("a stranger's flat is locked", () => {
    const mine: DoorAccess = { casino: true, apts: [{ slot: 2, level: 1 }] };
    expect(walkable(bedToCasino(5).slice(2, 4).reverse().concat(bedToCasino(5)[1]), walkableFor(mine))).toBe(false);
    expect(walkable(bedToCasino(2), walkableFor(mine))).toBe(true);
  });

  it('knows which zone each stretch is', () => {
    expect(zoneAt({ x: 0, z: 10 })).toBe('casino');
    expect(zoneAt({ x: 0, z: 30 })).toBe('street');
    expect(zoneAt({ x: 0, z: 50 })).toBe('hall');
    expect(zoneAt({ x: 25, z: 15 })).toBe('casino'); // the dice parlour, not the street
  });

  it('a bigger flat keeps its front door where it was', () => {
    for (let slot = 0; slot < APT_SLOTS; slot++) {
      const small = aptToWorld(slot, 1, 0.9, aptSize(1).d);
      const big = aptToWorld(slot, 3, 0.9, aptSize(3).d);
      expect(Math.hypot(small.x - big.x, small.z - big.z)).toBeLessThan(1e-9);
    }
  });
});
