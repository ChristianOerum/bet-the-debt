import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { betReturn, colorOf, RR, type BJState, type Card, type Rank, type RouletteState, type Suit } from '@casino/shared';
import type { GameTable, TableContext } from '../src/games/GameTable';
import { BlackjackTable } from '../src/games/blackjack/BlackjackTable';
import { LiarsTable } from '../src/games/dice/LiarsTable';
import { RussianTable } from '../src/games/dice/RussianTable';
import { RouletteTable } from '../src/games/roulette/RouletteTable';

const cards = (s: string): Card[] => s.split(' ').map((x) => ({ rank: x.slice(0, -1) as Rank, suit: x.slice(-1) as Suit }));

function casino(ids: number[]) {
  const chips = new Map(ids.map((id) => [id, 1000]));
  let table: GameTable;
  const ctx: TableContext = {
    getChips: (id) => chips.get(id) ?? 0,
    addChips: (id, d) => chips.set(id, (chips.get(id) ?? 0) + d),
    changed: () => {},
    handFinished: () => {},
    kill: (id) => table.leave(id),
  };
  const seat = <T extends GameTable>(t: T) => {
    table = t;
    ids.forEach((id, i) => expect(t.sit({ id, name: `P${id}` }, i)).toBeNull());
    return t;
  };
  return { ctx, seat };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('gut feelings tell the truth (when they are right)', () => {
  /** Deal you two cards and the dealer two, then `rest` off the top. Padded so the shoe is deep enough. */
  function blackjack(you: string, dealer: string, rest: string) {
    const c = casino([1]);
    const t = c.seat(new BlackjackTable('bj1', c.ctx));
    const [y1, y2] = you.split(' ');
    const [d1, d2] = dealer.split(' ');
    t.loadShoe(cards(`${y1} ${d1} ${y2} ${d2} ${rest} ${Array(14).fill('5C').join(' ')}`));
    t.action(1, { type: 'bet', amount: 10 });
    t.action(1, { type: 'ready' });
    vi.advanceTimersByTime(10_000);
    expect((t.publicState() as BJState).phase).toBe('players');
    return t;
  }

  it('blackjack: says stand when standing wins (the dealer will bust)', () => {
    // You 16, dealer 16, and the next card is a king: hit and you bust; stand and the dealer does.
    const t = blackjack('10S 6D', '9H 7C', 'KS');
    const g = t.gutFeeling(1)!;
    expect(g.right).toMatch(/Stand/);
    // Asking again about the same decision gives the same key: one hunch per decision.
    expect(t.gutFeeling(1)!.key).toBe(g.key);
  });

  it('blackjack: says hit when one more card wins', () => {
    // You 12 against the dealer's 18: a 9 makes 21.
    const t = blackjack('10S 2D', '10H 8C', '9S');
    expect(t.gutFeeling(1)!.right).toMatch(/One more card/);
  });

  it('blackjack: no hunch at all when nothing wins', () => {
    // You 12 against 20, and the next card is a king: standing loses, hitting busts.
    const t = blackjack('10S 2D', '10H QC', 'KS');
    expect(t.gutFeeling(1)).toBeNull();
  });

  it('roulette: the button a hunch lights up is a winning bet, whatever the pocket (zero too)', () => {
    const c = casino([1]);
    const t = c.seat(new RouletteTable('roulette1', c.ctx));
    const inside = t as unknown as { next: number; spin: number; rig: number | null };
    for (let n = 0; n <= 36; n++) {
      for (let spin = 0; spin < 3; spin++) {
        Object.assign(inside, { next: n, spin, rig: null });
        const g = t.gutFeeling(1)!;
        const bet = /data-bet="([^"]+)"/.exec(g.pick)![1];
        expect(betReturn(bet, 1, n), `pocket ${n}, hunch ${spin}: ${g.right}`).toBeGreaterThan(0);
      }
    }
  });

  it('every hunch names a button to light up', () => {
    const c = casino([1]);
    const t = c.seat(new RouletteTable('roulette1', c.ctx));
    expect(t.gutFeeling(1)!.pick).toMatch(/^\[data-/);
  });

  it('roulette: knows where the ball will land', () => {
    const c = casino([1]);
    const t = c.seat(new RouletteTable('roulette1', c.ctx));
    for (let spin = 0; spin < 30; spin++) {
      const g = t.gutFeeling(1)!;
      t.action(1, { type: 'bet', bet: 'red', amount: 10 });
      t.action(1, { type: 'ready' });
      const n = (t.publicState() as RouletteState).result!;
      const said = g.right.toLowerCase();
      if (said.includes('red') || said.includes('black')) expect(said.startsWith(colorOf(n))).toBe(true);
      else if (said.startsWith('zero')) expect(n).toBe(0);
      else if (said.startsWith('odd')) expect(n % 2).toBe(1);
      else if (said.startsWith('even')) expect(n % 2).toBe(0);
      else if (said.startsWith('a low')) expect(n >= 1 && n <= 18).toBe(true);
      else expect(n === 0 || n >= 19).toBe(true);
      vi.advanceTimersByTime(30_000);
    }
  });

  it('russian roulette: knows when this is the one', () => {
    const c = casino([1, 2]);
    const t = c.seat(new RussianTable('russian1', c.ctx));
    t.rigBullet = 0;
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    vi.advanceTimersByTime(RR.startDelayMs);
    t.forceTurn(0);
    expect(t.gutFeeling(1)!.right).toMatch(/very, very wrong/);
    expect(t.gutFeeling(2)).toBeNull(); // not your turn, no feeling
  });

  it("liar's dice: knows whether the bid is true", () => {
    const c = casino([1, 2]);
    const t = c.seat(new LiarsTable('liars1', c.ctx));
    t.rig = [
      [2, 2, 3, 4, 5],
      [6, 6, 6, 1, 4],
    ];
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    const st = () => t.publicState() as { turn: number };
    const bidder = st().turn === 0 ? 1 : 2;
    const other = bidder === 1 ? 2 : 1;
    // Four sixes (three, plus a wild one): true.
    t.action(bidder, { type: 'bid', quantity: 4, face: 6 });
    expect(t.gutFeeling(other)!.right).toMatch(/true/);
  });
});
