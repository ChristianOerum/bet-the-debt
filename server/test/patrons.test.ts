import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATIONS } from '@casino/shared';
import type { GameTable, TableContext } from '../src/games/GameTable';
import { TABLE_TYPES } from '../src/games/registry';
import type { Player } from '../src/hub';
import { Patrons, type Patron } from '../src/patrons';

/** A casino with real tables and patrons, and one player standing about. */
function world() {
  const tables = new Map<string, GameTable>();
  const said: string[] = [];
  const left: number[] = [];
  const player = { id: 1, name: 'You', x: 0, z: 0, zone: 'casino', run: 'alive', doomed: false, stationId: null, socket: { emit: vi.fn() } } as unknown as Player;
  let patrons: Patrons;
  for (const st of STATIONS) {
    const ctx: TableContext = {
      getChips: (id) => (id < 0 ? patrons.chips(id) : 1000),
      addChips: (id, d) => (id < 0 ? patrons.addChips(id, d) : undefined),
      changed: () => {},
      handFinished: (id) => (id < 0 ? patrons.handFinished(id) : undefined),
      kill: () => {},
    };
    tables.set(st.id, TABLE_TYPES[st.type]!(st.id, ctx));
  }
  patrons = new Patrons({
    tables,
    members: () => [player],
    emit: (event, ...args) => {
      if (event === 'chat') said.push((args[0] as { text: string }).text);
      if (event === 'patronLeft') left.push(args[0] as number);
    },
    escort: () => false,
    leaveTable: (p) => {
      if (p.stationId) tables.get(p.stationId)?.leave(p.id);
    },
  });
  const list = () => [...(patrons as unknown as { list: Map<number, Patron> }).list.values()];
  /** A patron who is not sitting down, moved to stand next to the player. */
  const loose = () => {
    const p = list().find((x) => x.mode !== 'seated')!;
    Object.assign(p, { x: player.x + 1, z: player.z, path: [], mode: 'idle', idleUntil: Date.now() + 60_000 });
    return p;
  };
  return { tables, patrons, player, said, left, list, loose };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Patrons', () => {
  it('fill the casino, and some sit straight down to play', () => {
    const w = world();
    vi.advanceTimersByTime(200);
    expect(w.list().length).toBe(7);
    expect(w.list().some((p) => p.mode === 'seated')).toBe(true);
    w.patrons.dispose();
  });

  it('only play what has a table in the room you ask them in', () => {
    const w = world();
    vi.advanceTimersByTime(200);
    const p = w.loose(); // out in the main hall
    Object.assign(p, { likes: ['meyer', 'russian', 'blackjack'], nerve: 1 });
    for (const g of ['meyer', 'russian']) {
      w.patrons.invite(w.player, p.id, g);
      expect(p.mode, g).toBe('idle');
    }
    expect(w.said.at(-1)).toMatch(/table|around here|where they play/);
    const dice = vi.spyOn(Math, 'random').mockReturnValue(0.5); // not one of their "busy" moments
    w.patrons.invite(w.player, p.id, 'blackjack');
    dice.mockRestore();
    expect(p.mode).toBe('walking');
    w.patrons.dispose();
  });

  it('take a seat at Russian roulette when asked in the back room', () => {
    const w = world();
    vi.advanceTimersByTime(200);
    Object.assign(w.player, { x: -16.5, z: -21 });
    const p = w.loose();
    Object.assign(p, { likes: ['russian'], nerve: 1 });
    w.patrons.invite(w.player, p.id, 'russian');
    expect(p.mode).toBe('walking');
    vi.advanceTimersByTime(12_000); // a few steps across the back room
    expect(p.mode).toBe('seated');
    expect(p.stationId).toBe('russian1');
    expect(w.tables.get('russian1')!.seatPose(p.id)).not.toBeNull();
    // Nobody comes to play: after a while they give up and wander off.
    vi.advanceTimersByTime(45_000);
    expect(w.tables.get('russian1')!.seatPose(p.id)).toBeNull();
    expect(w.said).toContain('Nobody? Fine.');
    w.patrons.dispose();
  });

  it('turn down games they do not like', () => {
    const w = world();
    vi.advanceTimersByTime(200);
    const p = w.loose();
    p.likes = ['blackjack'];
    w.patrons.invite(w.player, p.id, 'meyer');
    expect(p.mode).toBe('idle');
    expect(w.said.length).toBeGreaterThan(0);
    w.patrons.dispose();
  });

  it('leave a seat when threatened (if they have the nerve to be scared), and go home', () => {
    const w = world();
    vi.advanceTimersByTime(200);
    const p = w.list().find((x) => x.mode === 'seated')!;
    p.nerve = 0;
    Object.assign(w.player, { x: p.x + 0.5, z: p.z });
    const table = p.stationId!;
    w.patrons.evict(w.player, p.id, 'threaten');
    expect(w.tables.get(table)!.seatPose(p.id)).toBeNull();
    expect(p.mode).toBe('leaving');
    vi.advanceTimersByTime(90_000);
    expect(w.left).toContain(p.id);
    w.patrons.dispose();
  });

  it('will not budge for a stranger across the room', () => {
    const w = world();
    vi.advanceTimersByTime(200);
    const p = w.list().find((x) => x.mode === 'seated')!;
    p.nerve = 0;
    Object.assign(w.player, { x: p.x + 20, z: p.z });
    w.patrons.evict(w.player, p.id, 'threaten');
    expect(p.mode).toBe('seated');
    w.patrons.dispose();
  });
});
