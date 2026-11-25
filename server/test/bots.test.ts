import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameTable, TableContext } from '../src/games/GameTable';
import { BaccaratTable } from '../src/games/baccarat/BaccaratTable';
import { BlackjackTable } from '../src/games/blackjack/BlackjackTable';
import { LiarsTable } from '../src/games/dice/LiarsTable';
import { MeyerTable } from '../src/games/dice/MeyerTable';
import { RussianTable } from '../src/games/dice/RussianTable';
import { PokerTable } from '../src/games/poker/PokerTable';
import { RouletteTable } from '../src/games/roulette/RouletteTable';

/** A table full of patrons (negative ids), playing on their own until something happens. */
function play(make: (ctx: TableContext) => GameTable, ids: number[], opts: { steps?: number; human?: (t: GameTable) => void } = {}) {
  const chips = new Map(ids.map((id) => [id, 1000]));
  const finished: number[] = [];
  const killed: number[] = [];
  const errors: string[] = [];
  let table: GameTable;
  const ctx: TableContext = {
    getChips: (id) => chips.get(id) ?? 0,
    addChips: (id, d) => chips.set(id, Math.max(0, (chips.get(id) ?? 0) + d)),
    changed: () => {},
    handFinished: (id) => finished.push(id),
    kill: (id) => {
      killed.push(id);
      table.leave(id);
    },
  };
  table = make(ctx);
  ids.forEach((id, i) => expect(table.sit({ id, name: `N${id}` }, i)).toBeNull());
  for (let step = 0; step < (opts.steps ?? 600); step++) {
    opts.human?.(table);
    for (const id of ids) {
      if (id > 0) continue;
      const move = table.botMove(id);
      if (!move) continue;
      const err = table.action(id, move);
      if (err) errors.push(`${JSON.stringify(move)}: ${err}`);
    }
    vi.advanceTimersByTime(500);
  }
  table.dispose();
  return { chips, finished, killed, errors };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('patrons at the tables', () => {
  const games: [string, (ctx: TableContext) => GameTable][] = [
    ['blackjack', (c) => new BlackjackTable('bj1', c)],
    ['roulette', (c) => new RouletteTable('roulette1', c)],
    ['baccarat', (c) => new BaccaratTable('baccarat1', c)],
    ['poker', (c) => new PokerTable('poker1', c)],
    ["liar's dice", (c) => new LiarsTable('liars1', c)],
    ['meyer', (c) => new MeyerTable('meyer1', c)],
  ];
  for (const [name, make] of games) {
    it(`play ${name} by the rules, and finish hands`, () => {
      const r = play(make, [-1, -2, -3]);
      expect(r.errors).toEqual([]);
      expect(r.finished.length).toBeGreaterThan(3);
      // Chips moved about, and nobody went below zero.
      for (const v of r.chips.values()) expect(v).toBeGreaterThanOrEqual(0);
    });
  }

  it('will not play Russian roulette among themselves', () => {
    const r = play((c) => new RussianTable('russian1', c), [-1, -2], { steps: 60 });
    expect(r.killed).toEqual([]);
    expect(r.finished).toEqual([]);
  });

  it('play Russian roulette once a real person is in', () => {
    const r = play((c) => new RussianTable('russian1', c), [-1, -2, 7], {
      steps: 200,
      // The player says they are in, then pulls the trigger whenever it is their go.
      human: (t) => {
        const st = t.publicState() as { phase: string; turn: number | null; seats: ({ playerId: number; ready: boolean } | null)[] };
        const me = st.seats.findIndex((s) => s?.playerId === 7);
        if (me < 0) return;
        if (st.phase === 'waiting' && !st.seats[me]!.ready) t.action(7, { type: 'ready' });
        if (st.phase === 'playing' && st.turn === me) t.action(7, { type: 'pull' });
      },
    });
    expect(r.errors).toEqual([]);
    expect(r.killed.length).toBeGreaterThan(0);
  });
});
