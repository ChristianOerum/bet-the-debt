import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASINO_TOILET, freshVitals, LURE_HANDS, RUN, SHOOT, yawOf, type Body, type HeldItem } from '@casino/shared';
import type { GameServer, Hub, Player } from '../src/hub';
import { BODIES, Instance } from '../src/instance';
import type { Patron } from '../src/patrons';
import { SqliteStore } from '../src/store/SqliteStore';

type Sent = [string, unknown[]];

/** A lobby's casino with real tables and regulars, fake sockets, and a database in memory. */
async function casino() {
  const store = new SqliteStore(':memory:');
  const room: Sent[] = [];
  const io = { to: () => ({ emit: (e: string, ...a: unknown[]) => room.push([e, a]) }) } as unknown as GameServer;
  const inst = new Instance(io, store, { emptied: () => {} } as unknown as Hub, 'lobby-TEST', 'TEST');
  // The regulars stand well out of the way (in the dice room), unless a test wants one.
  const regulars = () => [...(inst.patrons as unknown as { list: Map<number, Patron> }).list.values()];
  inst.patrons!.dispose();
  for (const r of regulars()) Object.assign(r, { x: 25, z: 12, path: [], mode: 'idle', stationId: null, idleUntil: Infinity });

  const join = async (name: string, at: { x: number; z: number }, owned: string[] = []) => {
    const u = (await store.createUser(name, 'hash', '#fff'))!;
    for (const id of owned) await store.addOwned(u.id, id);
    const got: Sent[] = [];
    const socket = {
      emit: (e: string, ...a: unknown[]) => got.push([e, a]),
      join: () => {},
      leave: () => {},
      to: () => ({ emit: () => {}, volatile: { emit: () => {} } }),
    };
    const p = {
      id: u.id, name, color: '#fff', socket, cash: 0, aptLevel: 1, best: 0, bestLevel: 'hard', owned: [...owned], outfit: [], buying: false,
      vitals: freshVitals(), peeing: false, gutKey: null, gutMisses: 0, items: Array<HeldItem | null>(4).fill(null), lastPunch: 0, lastShot: 0,
      effects: {}, instance: null, slot: 0, zone: 'casino', x: 0, z: 0, yaw: 0, run: 'none', chips: 0, round: 1, hands: 0,
      doomed: false, stationId: null, lastChat: 0,
    } as unknown as Player;
    inst.add(p, () => ({ zone: 'casino', x: at.x, z: at.z, yaw: 0 }), false);
    Object.assign(p, { run: 'alive', chips: 500 });
    return Object.assign(p, { got });
  };
  /** Point `p` at `q` and pull the trigger in hotbar slot `slot`. */
  const shoot = (p: Player, q: { x: number; z: number }, slot = 0) => {
    p.lastShot = 0;
    inst.onShoot(p, slot, yawOf(q.x - p.x, q.z - p.z), 0);
  };
  const bodies = () => {
    const last = room.filter(([e]) => e === 'bodies').pop();
    return (last?.[1][0] ?? []) as Body[];
  };
  const escorted = (id: number) => room.some(([e, a]) => e === 'escort' && (a[0] as { id: number }).id === id);
  return { store, room, inst, regulars, join, shoot, bodies, escorted };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('guns, bodies and the toilet stall', () => {
  it('a kill in the stall goes unseen; the body keeps what was on it, and can be hidden and looted', async () => {
    const c = await casino();
    const stand = CASINO_TOILET.stand;
    const killer = await c.join('Killer', { x: CASINO_TOILET.stand.x + 0.6, z: CASINO_TOILET.stand.z }, ['pistol-silenced']);
    const victim = await c.join('Victim', { x: stand.x, z: stand.z }, ['pistol']);
    expect(killer.items[0]?.itemId).toBe('pistol-silenced'); // guns you own go in your pocket
    victim.items[1] = { itemId: 'lager', left: 2 };
    victim.chips = 740;

    c.shoot(killer, victim);
    expect(victim.vitals.health).toBe(100 - SHOOT.damage);
    c.shoot(killer, victim);
    expect(victim.doomed).toBe(true);
    // The victim's gun is gone from their account, whatever happens next.
    expect(await c.store.ownedItems(victim.id)).toEqual([]);

    vi.advanceTimersByTime(RUN.tableDeathMs + 2000);
    expect(victim.run).toBe('ghost');
    expect(killer.doomed).toBe(false); // nobody saw
    const [body] = c.bodies();
    expect(body).toMatchObject({ name: 'Victim', chips: 740, hidden: false });
    expect(body.items.map((h) => h.itemId).sort()).toEqual(['lager', 'pistol']);

    c.inst.onHideBody(killer, body.id);
    expect(c.bodies()[0].hidden).toBe(true);
    c.inst.onLoot(killer, body.id);
    expect(killer.chips).toBe(500 + 740);
    expect(killer.items.map((h) => h?.itemId)).toEqual(['pistol-silenced', 'pistol', 'lager', undefined]);
    expect((await c.store.ownedItems(killer.id)).sort()).toEqual(['pistol', 'pistol-silenced']);

    // Hidden: the staff never find it, so nobody comes for the killer.
    vi.advanceTimersByTime(BODIES.foundMs + 1000);
    expect(c.bodies().length).toBe(1);
    expect(c.escorted(killer.id)).toBe(false);
    c.inst.dispose();
  });

  it('shoot someone out on the floor and the whole casino hears it: security takes you out back', async () => {
    const c = await casino();
    const killer = await c.join('Loud', { x: 0, z: 4 }, ['pistol']);
    const victim = await c.join('Unlucky', { x: 0, z: 0 });
    c.shoot(killer, victim);
    c.shoot(killer, victim);
    expect(victim.doomed).toBe(true);
    expect(killer.doomed).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(c.room.some(([e, a]) => e === 'escort' && (a[0] as { cause?: string; id: number }).id === killer.id && (a[0] as { cause?: string }).cause === 'murder')).toBe(true);
    c.inst.dispose();
  });

  it('a body left lying in the stall is found in the end, and the cameras give the killer away', async () => {
    const c = await casino();
    const stand = CASINO_TOILET.stand;
    const killer = await c.join('Sloppy', { x: CASINO_TOILET.stand.x + 0.6, z: CASINO_TOILET.stand.z }, ['pistol-silenced']);
    const victim = await c.join('Gone', { x: stand.x, z: stand.z });
    c.shoot(killer, victim);
    c.shoot(killer, victim);
    vi.advanceTimersByTime(RUN.tableDeathMs + 2000);
    expect(killer.doomed).toBe(false);
    vi.advanceTimersByTime(BODIES.foundMs);
    expect(c.bodies()).toEqual([]);
    expect(killer.doomed).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(c.escorted(killer.id)).toBe(true);
    c.inst.dispose();
  });

  it('you cannot shoot outside the casino, or sitting down', async () => {
    const c = await casino();
    const p = await c.join('Calm', { x: 0, z: 4 }, ['pistol']);
    const q = await c.join('Target', { x: 0, z: 0 });
    p.zone = 'street';
    c.shoot(p, q);
    p.zone = 'casino';
    p.stationId = 'bj1';
    c.shoot(p, q);
    expect(q.vitals.health).toBe(100);
    c.inst.dispose();
  });

  it('a regular shot dead drops their chips; one you have played with will step into the bathroom with you', async () => {
    const c = await casino();
    const p = await c.join('Friendly', { x: 0, z: 4 }, ['pistol-silenced']);
    const [r] = c.regulars();
    Object.assign(r, { x: 0.8, z: 4 });
    c.inst.patrons!.lure(p, r.id);
    expect(r.mode).toBe('idle'); // a stranger: no
    r.playedWith.set(p.id, LURE_HANDS);
    c.inst.patrons!.lure(p, r.id);
    expect(r.mode).toBe('walking');
    const last = r.path[r.path.length - 1];
    expect(Math.hypot(last.x - CASINO_TOILET.stand.x, last.z - CASINO_TOILET.stand.z)).toBeLessThan(0.3);
    // Teleport them there (the walk itself is the patrons' business) and do it.
    Object.assign(r, { x: CASINO_TOILET.stand.x, z: CASINO_TOILET.stand.z, path: [], mode: 'idle', idleUntil: Infinity });
    Object.assign(p, { x: CASINO_TOILET.stand.x + 0.6, z: CASINO_TOILET.stand.z });
    r.chips = 900;
    c.shoot(p, r);
    c.shoot(p, r);
    vi.advanceTimersByTime(RUN.tableDeathMs + 100);
    expect(c.bodies()[0]).toMatchObject({ name: r.name, chips: 900 });
    expect(p.doomed).toBe(false);
    c.inst.dispose();
  });
});

describe('drugs', () => {
  it('Ice Water: nothing goes through you, and it wears off', async () => {
    const c = await casino();
    const p = await c.join('Cool', { x: 0, z: 4 });
    p.items[0] = { itemId: 'ice', left: 1 };
    c.inst.onUse(p, 0);
    expect(p.items[0]).toBeNull();
    const before = p.vitals.bladder;
    for (let i = 0; i < 40; i++) c.inst.tickBody(p, 0.25, false);
    expect(p.vitals.bladder).toBe(before);
    vi.advanceTimersByTime(200_000);
    c.inst.tickBody(p, 0.25, false);
    expect(p.effects).toEqual({});
    expect(p.got.some(([e, a]) => e === 'notice' && String(a[0]).includes('wears off'))).toBe(true);
    c.inst.dispose();
  });

  it('Third Eye: sitting at roulette, you see where the ball will land', async () => {
    const c = await casino();
    const p = await c.join('Seer', { x: 0, z: 4 });
    p.items[0] = { itemId: 'third-eye', left: 1 };
    c.inst.onUse(p, 0);
    c.inst.onSit(p, 'roulette1', 0);
    c.inst.onAction(p, 'roulette1', { type: 'bet', bet: 'red', amount: 10 });
    const peeks = p.got.filter(([e, a]) => e === 'peek' && a[0]);
    expect(String(peeks.pop()?.[1][0])).toMatch(/The ball will land on \d+/);
    c.inst.dispose();
  });
});
