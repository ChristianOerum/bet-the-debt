import { describe, expect, it } from 'vitest';
import { CASINO_TOILET, DEALERS, dealerAt, GUNS, heldInfo, inRestroom, navRoute, shopItem, stallHideFor, shotHits, startingUses, inWalkable, walkableFor, walkableRects, witnesses, yawOf, zoneAt } from '../src';

const walk = walkableRects();
const facing = (from: { x: number; z: number }, to: { x: number; z: number }) => yawOf(to.x - from.x, to.z - from.z);

describe('shooting', () => {
  it('hits the person you aim at, and the nearest one when two are in line', () => {
    const me = { x: 0, z: 0 };
    const a = { id: 1, x: 0, z: -4 };
    const b = { id: 2, x: 0, z: -8 };
    expect(shotHits(me, facing(me, a), 0, [b, a], walk)?.id).toBe(1);
    expect(shotHits(me, facing(me, a) + 0.4, 0, [a, b], walk)).toBeNull(); // missed
  });

  it('does not go through walls', () => {
    // From the hall, aiming at someone out on the street through the front wall.
    const me = { x: 0, z: 12 };
    const out = { id: 1, x: 0, z: 24 };
    expect(shotHits(me, facing(me, out), 0, [out], walk)).toBeNull();
  });

  it('can be aimed over somebody’s head', () => {
    const me = { x: 0, z: 0 };
    const a = { id: 1, x: 0, z: -3 };
    expect(shotHits(me, facing(me, a), 0.6, [a], walk)).toBeNull();
  });

  it('both pistols are in the shop, one quiet', () => {
    for (const g of GUNS) {
      expect(shopItem(g.id)?.category).toBe('weapons');
      expect(heldInfo(g.id)?.kind).toBe('gun');
    }
    expect(GUNS.filter((g) => g.silenced).length).toBe(1);
  });
});

describe('who sees a killing', () => {
  const stand = CASINO_TOILET.stand;

  it('in the restrooms, nobody out in the casino sees; whoever is in there with you does', () => {
    expect(inRestroom(stand)).toBe(true);
    const me = { x: stand.x + 0.6, z: stand.z };
    const crowd = [
      { id: 1, x: -12, z: 10 }, // the main hall
      { id: 2, x: 0, z: 0 },
      { id: 3, x: -17, z: 9.3 }, // right outside the restroom door
    ];
    expect(witnesses(stand, me, crowd, true)).toEqual([]);
    // A loud pistol is muffled by the walls: only the one by the door hears it.
    expect(witnesses(stand, me, crowd, false)).toEqual([3]);
    // Someone washing their hands sees everything.
    expect(witnesses(stand, me, [...crowd, { id: 4, x: -22.5, z: 5.8 }], true)).toEqual([4]);
  });

  it('a body in the restrooms can be sat in a stall; anywhere else, no', () => {
    expect(stallHideFor({ x: -23, z: 9 })).not.toBeNull();
    expect(stallHideFor({ x: -10, z: 9 })).toBeNull();
  });

  it('the restrooms have a door from the main hall you can walk through, and regulars can find their way in', () => {
    const walk = walkableFor({ casino: false, apts: [] }, false);
    for (const x of [-21, -20, -19]) expect(inWalkable({ x, z: 9.3 }, 0.3, walk), String(x)).toBe(true);
    expect(inWalkable({ x: -20, z: 6 }, 0.3, walk)).toBe(false); // the wall
    const path = navRoute({ x: 0, z: 10.5 }, stand);
    expect(path).not.toBeNull();
  });

  it('out on the floor, anyone in the room sees, and a loud shot is heard by everybody', () => {
    const at = { x: 0, z: 0 };
    const near = { id: 1, x: 6, z: 3 };
    const far = { id: 2, x: 25, z: 10 }; // over in the dice room
    expect(witnesses(at, at, [near, far], true)).toEqual([1]);
    expect(witnesses(at, at, [near, far], false).sort()).toEqual([1, 2]);
  });

  it('a suppressed shot only carries a few metres', () => {
    const at = { x: -14, z: 0 };
    const backTurned = { id: 1, x: -14, z: -19 }; // the card room, 19 m away
    expect(witnesses(at, at, [backTurned], true)).toEqual([]);
  });
});

describe('the street', () => {
  it('has dealers you can walk up to, selling things that fit in your pocket', () => {
    for (const d of DEALERS) {
      expect(dealerAt({ x: d.at.x + 1, z: d.at.z })).toBe(d);
      expect(zoneAt(d.at), d.name).toBe('street');
      expect(inWalkable({ x: d.at.x, z: d.at.z + (d.yaw === 0 ? -1.2 : 1.2) }, 0.3, walkableFor({ casino: false, apts: [] }, false)), d.name).toBe(true);
    }
    expect(dealerAt({ x: 0, z: 30 })).toBeNull();
    expect(heldInfo('snow')?.kind).toBe('drug');
    expect(startingUses('snow')).toBe(1);
    expect(startingUses('lager')).toBe(3);
  });
});
