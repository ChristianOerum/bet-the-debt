import { describe, expect, it } from 'vitest';
import {
  alcoholKills,
  APT_SLOTS,
  aptFridge,
  aptLayout,
  aptToWorld,
  CASINO_TOILET,
  consume,
  freshVitals,
  gutOdds,
  isFree,
  menuItem,
  MENU,
  PLAYER_RADIUS,
  portions,
  staticColliders,
  tickVitals,
  toiletAt,
  toilets,
  walkableFor,
  zoneAt,
} from '../src/index';

describe('the body', () => {
  it('gets hungrier, thirstier and fuller as time passes, and sobers up', () => {
    let v = { ...freshVitals(), bac: 1 };
    for (let s = 0; s < 60; s++) v = tickVitals(v, 1);
    expect(v.hunger).toBeLessThan(75);
    expect(v.thirst).toBeLessThan(75);
    expect(v.bladder).toBeGreaterThan(15);
    expect(v.bac).toBeCloseTo(1 - 0.15, 5);
  });

  it('fills the bladder faster when drunk', () => {
    const sober = tickVitals({ ...freshVitals(), bac: 0 }, 10).bladder;
    const drunk = tickVitals({ ...freshVitals(), bac: 2 }, 10).bladder;
    expect(drunk - 15).toBeGreaterThan(2.5 * (sober - 15));
  });

  it('loses health starving, and gets it back fed and watered', () => {
    expect(tickVitals({ health: 50, hunger: 0, thirst: 80, bladder: 0, bac: 0 }, 10).health).toBeLessThan(50);
    expect(tickVitals({ health: 50, hunger: 80, thirst: 80, bladder: 0, bac: 0 }, 10).health).toBeGreaterThan(50);
  });

  it('eats and drinks', () => {
    const v = consume(freshVitals(), menuItem('lager')!);
    expect(v.bac).toBeCloseTo(0.25);
    expect(v.thirst).toBeGreaterThan(75);
    expect(v.bladder).toBeGreaterThan(15);
    expect(consume(freshVitals(), menuItem('burger')!).hunger).toBe(100);
  });

  it('eats in bites and drinks in sips: all of them add up to the whole thing', () => {
    for (const id of ['lager', 'burger', 'peanuts', 'long-island', 'vodka']) {
      const item = menuItem(id)!;
      const n = portions(item);
      let bit = { ...freshVitals(), hunger: 10, thirst: 10, bladder: 0 };
      for (let k = 0; k < n; k++) bit = consume(bit, item, 1 / n);
      const whole = consume({ ...freshVitals(), hunger: 10, thirst: 10, bladder: 0 }, item);
      expect(bit.bac).toBeCloseTo(whole.bac, 6);
      expect(bit.hunger).toBeCloseTo(whole.hunger, 6);
    }
    expect(portions(menuItem('vodka')!)).toBe(1); // a shot goes down in one
    expect(portions(menuItem('lager')!)).toBe(3);
  });

  it('has a proper menu: food, water, beers, lots of cocktails, every id unique', () => {
    expect(new Set(MENU.map((m) => m.id)).size).toBe(MENU.length);
    expect(MENU.filter((m) => m.section === 'food').length).toBeGreaterThanOrEqual(5);
    expect(MENU.filter((m) => m.section === 'beer').length).toBeGreaterThanOrEqual(3);
    expect(MENU.filter((m) => m.section === 'cocktail').length).toBeGreaterThanOrEqual(6);
    expect(menuItem('water')).toBeDefined();
    for (const m of MENU) expect(m.price).toBeGreaterThanOrEqual(m.section === 'home' ? 0 : 1);
  });
});

describe('drinking yourself to death', () => {
  const never = () => 0.999;
  const always = () => 0;
  it('never kills below 3.0 ‰', () => {
    expect(alcoholKills(0, 2.99, always)).toBe(false);
  });
  it('may kill past 3.0 ‰, more likely each 0.1 ‰', () => {
    expect(alcoholKills(2.9, 3.05, never)).toBe(false);
    expect(alcoholKills(2.9, 3.05, always)).toBe(true);
    // The odds at each step climb.
    const odds = [3.0, 3.1, 3.2, 3.3, 3.4].map((s) => (s - 2.9) / 0.6);
    for (let i = 1; i < odds.length; i++) expect(odds[i]).toBeGreaterThan(odds[i - 1]);
  });
  it('always kills at 3.5 ‰', () => {
    expect(alcoholKills(3.4, 3.5, never)).toBe(true);
    expect(alcoholKills(0, 4, never)).toBe(true);
  });
  it('gives more hunches the drunker you are', () => {
    expect(gutOdds(0.1).chance).toBe(0);
    expect(gutOdds(1).chance).toBeLessThan(gutOdds(2).chance);
    expect(gutOdds(3).chance).toBeLessThan(1);
  });

  it('a hunch gets likelier with every decision that brings none, faster the drunker you are, and comes in the end', () => {
    expect(gutOdds(0.1, 10).chance).toBe(0); // sober is sober
    for (const bac of [0.5, 1, 2]) {
      const odds = [0, 1, 2, 3].map((m) => gutOdds(bac, m).chance);
      for (let i = 1; i < odds.length; i++) expect(odds[i]).toBeGreaterThan(odds[i - 1]);
      expect(gutOdds(bac, 20).chance).toBe(1);
    }
    // One miss adds more at 2 ‰ than at 0.5 ‰.
    expect(gutOdds(2, 1).chance - gutOdds(2, 0).chance).toBeGreaterThan(gutOdds(0.5, 1).chance - gutOdds(0.5, 0).chance);
  });
});

describe('toilets', () => {
  it('one in every flat and six in the casino restrooms, each where its zone is', () => {
    const all = toilets();
    expect(all.length).toBe(APT_SLOTS + 6);
    for (const t of all) {
      expect(zoneAt(t.stand)).toBe(t.zone);
      expect(toiletAt(t.stand)?.zone).toBe(t.zone);
    }
    expect(toiletAt({ x: 0, z: 0 })).toBeNull();
  });
  it('you can stand at every toilet without being inside furniture', () => {
    for (const level of [1, 2, 3]) {
      const access = { casino: true, apts: Array.from({ length: APT_SLOTS }, (_, slot) => ({ slot, level })) };
      const col = { ...staticColliders(() => level), walk: walkableFor(access) };
      for (const t of toilets(() => level)) expect(isFree(t.stand, PLAYER_RADIUS * 0.9, col), `${t.zone} level ${level}`).toBe(true);
    }
    expect(CASINO_TOILET.stand.x).toBeGreaterThan(CASINO_TOILET.bowl.x);
  });
  it('bigger flats have a bathroom you walk into through its doorway; its walls keep you out elsewhere', () => {
    expect(aptLayout(1).bath).toBeNull(); // the studio: the toilet is just there in the room
    for (const level of [2, 3]) {
      const b = aptLayout(level).bath!;
      const access = { casino: false, apts: [{ slot: 0, level }] };
      const col = { ...staticColliders(() => level), walk: walkableFor(access) };
      const at = (x: number, z: number) => aptToWorld(0, level, x, z);
      const r = PLAYER_RADIUS * 0.9;
      const doorX = (b.door.x0 + b.door.x1) / 2;
      // Straight in through the doorway, from the flat to just inside.
      for (let z = b.z1 + 0.6; z >= b.z1 - 0.5; z -= 0.1) expect(isFree(at(doorX, z), r, col), `level ${level}, z ${z.toFixed(1)}`).toBe(true);
      // Through the wall beside the doorway: no.
      expect(isFree(at(b.x0 + 0.5, b.z1), r, col)).toBe(false);
      expect(isFree(at(b.x1, (b.z0 + b.z1) / 2), r, col)).toBe(false);
      // The toilet is in the bathroom, and the fridge is out in the flat.
      const t = aptLayout(level).toilet.stand;
      expect(t.x > b.x0 && t.x < b.x1 && t.z > b.z0 && t.z < b.z1).toBe(true);
      const f = aptFridge(0, level);
      const fl = aptLayout(level).fridge;
      expect(fl.z).toBeGreaterThan(b.z1);
      expect(Math.hypot(f.x - at(fl.x, fl.z).x, f.z - at(fl.x, fl.z).z)).toBeLessThan(1e-6);
    }
  });
});
