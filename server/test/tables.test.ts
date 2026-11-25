import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BAC,
  LD,
  MY,
  PK,
  RR,
  RT,
  type BaccaratState,
  type Card,
  type LiarsState,
  type MeyerState,
  type PokerState,
  type Rank,
  type RouletteState,
  type RussianState,
  type Suit,
} from '@casino/shared';
import type { GameTable, TableContext } from '../src/games/GameTable';
import { BaccaratTable } from '../src/games/baccarat/BaccaratTable';
import { LiarsTable } from '../src/games/dice/LiarsTable';
import { MeyerTable } from '../src/games/dice/MeyerTable';
import { RussianTable } from '../src/games/dice/RussianTable';
import { PokerTable } from '../src/games/poker/PokerTable';
import { RouletteTable } from '../src/games/roulette/RouletteTable';

const cards = (s: string): Card[] => s.split(' ').map((x) => ({ rank: x.slice(0, -1) as Rank, suit: x.slice(-1) as Suit }));

/** A pretend casino: everyone starts with 1000 chips. */
function casino(ids: number[], start = 1000) {
  const chips = new Map(ids.map((id) => [id, start]));
  const finished: number[] = [];
  const killed: number[] = [];
  const ctx: TableContext = {
    getChips: (id) => chips.get(id) ?? 0,
    addChips: (id, d) => chips.set(id, (chips.get(id) ?? 0) + d),
    changed: () => {},
    handFinished: (id) => finished.push(id),
    kill: (id) => {
      killed.push(id);
      table?.leave(id);
    },
  };
  let table: GameTable | null = null;
  const seat = <T extends GameTable>(t: T) => {
    table = t;
    ids.forEach((id, i) => expect(t.sit({ id, name: `P${id}` }, i)).toBeNull());
    return t;
  };
  return { ctx, chips, finished, killed, seat };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RouletteTable', () => {
  it('takes bets, spins, and pays straight-ups 35 to 1', () => {
    const c = casino([1, 2]);
    const t = c.seat(new RouletteTable('roulette1', c.ctx));
    const st = () => t.publicState() as RouletteState;
    expect(t.action(1, { type: 'bet', bet: 'n17', amount: 10 })).toBeNull();
    expect(t.action(1, { type: 'bet', bet: 'black', amount: 50 })).toBeNull();
    expect(t.action(2, { type: 'bet', bet: 'red', amount: 100 })).toBeNull();
    expect(st().result).toBeNull(); // nobody gets to see the result before the spin
    t.rig = 17; // 17 is black
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    expect(st().phase).toBe('spinning');
    expect(st().result).toBe(17);
    expect(t.action(1, { type: 'bet', bet: 'red', amount: 10 })).toBe('No more bets.');
    vi.advanceTimersByTime(RT.spinMs);
    expect(c.chips.get(1)).toBe(1000 - 60 + 360 + 100);
    expect(c.chips.get(2)).toBe(900);
    expect(st().seats[0]!.net).toBe(400);
    expect(c.finished).toEqual([1, 2]);
    vi.advanceTimersByTime(RT.payoutMs);
    expect(st().phase).toBe('waiting');
    expect(st().history[0]).toBe(17);
  });

  it('refuses bets you cannot cover', () => {
    const c = casino([1], 50);
    const t = c.seat(new RouletteTable('roulette1', c.ctx));
    expect(t.action(1, { type: 'bet', bet: 'red', amount: 60 })).toBe('Not enough chips.');
    expect(t.action(1, { type: 'bet', bet: 'n40', amount: 10 })).toBe('Unknown bet.');
  });
});

describe('BaccaratTable', () => {
  it('deals by the rules and pays the banker less commission', () => {
    const c = casino([1, 2]);
    const t = c.seat(new BaccaratTable('baccarat1', c.ctx));
    // player 2,3 = 5 draws 4 -> 9? Use: player K,4 = 4 draws 2 = 6; banker 9,K = 9 natural... keep it simple:
    // player 2,3 (5), banker 9,8 (7) -> player draws K (5 stays 5), banker on 7 stands. Banker wins.
    t.loadShoe([...cards('2S 9H 3D 8C KS'), ...Array.from({ length: 80 }, () => cards('5S')[0])]);
    t.action(1, { type: 'bet', side: 'banker', amount: 100 });
    t.action(2, { type: 'bet', side: 'player', amount: 100 });
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    const st = () => t.publicState() as BaccaratState;
    expect(st().phase).toBe('dealing');
    expect(st().cards).toHaveLength(5);
    expect(st().winner).toBeNull(); // not until every card is on the table
    vi.advanceTimersByTime(5 * BAC.cardMs + 900);
    expect(st().winner).toBe('banker');
    expect(st().playerTotal).toBe(5);
    expect(st().bankerTotal).toBe(7);
    expect(c.chips.get(1)).toBe(1095);
    expect(c.chips.get(2)).toBe(900);
  });
});

describe('PokerTable', () => {
  const setup = (ids = [1, 2, 3]) => {
    const c = casino(ids);
    const t = c.seat(new PokerTable('poker1', c.ctx));
    const st = () => t.publicState() as PokerState;
    return { c, t, st };
  };

  it('posts blinds, deals, and gives the pot to the last player who did not fold', () => {
    const { c, t, st } = setup();
    vi.advanceTimersByTime(PK.startDelayMs);
    // Button is seat 0, so seat 1 is small blind, seat 2 big blind, seat 0 acts first.
    expect(st().phase).toBe('preflop');
    expect(st().button).toBe(0);
    expect(c.chips.get(2)).toBe(1000 - PK.smallBlind);
    expect(c.chips.get(3)).toBe(1000 - PK.bigBlind);
    expect(st().turn).toBe(0);
    expect((t.secretState(1) as { cards: Card[] }).cards).toHaveLength(2);
    expect(JSON.stringify(st())).not.toContain('"cards"'); // hole cards never go to everyone
    expect(t.action(1, { type: 'raise', to: 100 })).toBeNull();
    expect(t.action(2, { type: 'fold' })).toBeNull();
    expect(t.action(3, { type: 'fold' })).toBeNull();
    expect(st().phase).toBe('showdown');
    expect(c.chips.get(1)).toBe(1000 + PK.smallBlind + PK.bigBlind);
    vi.advanceTimersByTime(PK.showdownMs);
    expect(c.finished.sort()).toEqual([1, 2, 3]);
  });

  it('plays all four streets and the best hand takes it', () => {
    const { c, t, st } = setup([1, 2]);
    // Heads up: the button (seat 0) is small blind and acts first before the flop.
    // Deal order from after the button: seat 1, seat 0, seat 1, seat 0. Then flop, turn, river.
    t.loadDeck(cards('KS AS KD AD 2C 7H 9S JD 3C'));
    vi.advanceTimersByTime(PK.startDelayMs);
    expect(st().turn).toBe(0);
    expect(t.action(1, { type: 'call' })).toBeNull();
    expect(t.action(2, { type: 'check' })).toBeNull();
    expect(st().phase).toBe('flop');
    expect(st().board).toHaveLength(3);
    for (const street of ['flop', 'turn', 'river']) {
      expect(st().phase).toBe(street);
      // After the flop the player after the button (seat 1) acts first.
      expect(t.action(2, { type: 'check' })).toBeNull();
      expect(t.action(1, { type: 'check' })).toBeNull();
    }
    expect(st().phase).toBe('showdown');
    expect(st().seats[0]!.shown).toHaveLength(2);
    expect(st().seats[0]!.handName).toBe('Pair of Aces');
    expect(c.chips.get(1)).toBe(1020);
    expect(c.chips.get(2)).toBe(980);
  });

  it('runs the board out when someone is all in, and makes a side pot', () => {
    const c = casino([1, 2, 3]);
    c.chips.set(1, 100); // short stack
    const t = c.seat(new PokerTable('poker1', c.ctx));
    const st = () => t.publicState() as PokerState;
    // Deal from seat 1 round: 1,2,0 then 1,2,0. Seat 0 (P1) gets aces and wins the main pot;
    // seat 1 (P2) gets kings and wins the side pot over seat 2 (P3, queens).
    t.loadDeck(cards('KS QS AS KD QD AD 2C 7H 9S JD 3C'));
    vi.advanceTimersByTime(PK.startDelayMs);
    expect(t.action(1, { type: 'allin' })).toBeNull(); // 100
    expect(t.action(2, { type: 'raise', to: 300 })).toBeNull();
    expect(t.action(3, { type: 'call' })).toBeNull();
    // Flop onward: P2 and P3 check it down.
    for (let k = 0; k < 3; k++) {
      expect(t.action(2, { type: 'check' })).toBeNull();
      expect(t.action(3, { type: 'check' })).toBeNull();
    }
    expect(st().phase).toBe('showdown');
    expect(c.chips.get(1)).toBe(300); // main pot: 100 x 3
    expect(c.chips.get(2)).toBe(1000 - 300 + 400); // side pot: 200 x 2
    expect(c.chips.get(3)).toBe(700);
  });

  it('folds a player who runs out of time when there is a bet to face', () => {
    const { t, st } = setup([1, 2]);
    vi.advanceTimersByTime(PK.startDelayMs);
    vi.advanceTimersByTime(PK.turnTimeMs);
    expect(st().seats[0]!.folded).toBe(true);
  });
});

describe('RussianTable', () => {
  it('kills whoever finds the bullet and splits their chips between the rest', () => {
    const c = casino([1, 2, 3]);
    c.chips.set(1, 999);
    const t = c.seat(new RussianTable('russian1', c.ctx));
    const st = () => t.publicState() as RussianState;
    for (const id of [1, 2, 3]) expect(t.action(id, { type: 'ready' })).toBeNull();
    expect(st().phase).toBe('starting');
    t.rigBullet = 2; // the third pull
    vi.advanceTimersByTime(RR.startDelayMs);
    expect(st().phase).toBe('playing');
    t.forceTurn(2);
    expect(t.action(3, { type: 'pull' })).toBeNull(); // click
    expect(st().turn).toBe(0);
    expect(t.action(2, { type: 'pull' })).toBe('It is not your turn.');
    expect(t.action(1, { type: 'pull' })).toBeNull(); // click
    expect(t.action(2, { type: 'pull' })).toBeNull(); // bang
    expect(c.killed).toEqual([2]);
    expect(c.chips.get(2)).toBe(0);
    expect(c.chips.get(1)).toBe(999 + 500);
    expect(c.chips.get(3)).toBe(1000 + 500);
    expect(st().result?.victim).toBe('P2');
    expect(st().seats[1]).toBeNull(); // they are no longer at the table
    vi.advanceTimersByTime(RR.resultMs);
    expect(c.finished.sort()).toEqual([1, 3]);
  });

  it('pulls the trigger for you if you hesitate', () => {
    const c = casino([1, 2]);
    const t = c.seat(new RussianTable('russian1', c.ctx));
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    t.rigBullet = 0;
    vi.advanceTimersByTime(RR.startDelayMs);
    vi.advanceTimersByTime(RR.turnTimeMs);
    expect(c.killed).toHaveLength(1);
  });
});

describe('LiarsTable', () => {
  it('takes the stake, and whoever is wrong about a bid loses a die', () => {
    const c = casino([1, 2]);
    const t = c.seat(new LiarsTable('liars1', c.ctx));
    const st = () => t.publicState() as LiarsState;
    t.rig = [
      [4, 4, 1, 2, 3],
      [4, 6, 6, 5, 2],
    ];
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    expect(st().pot).toBe(2 * LD.stake);
    expect(c.chips.get(1)).toBe(1000 - LD.stake);
    expect((t.secretState(1) as { dice: number[] }).dice).toEqual([4, 4, 1, 2, 3]);
    expect(JSON.stringify(st())).not.toContain('"dice"');
    const first = st().turn!;
    const other = first === 0 ? 1 : 0;
    const id = (seat: number) => seat + 1;
    // There are four 4s (counting the wild one). Bid five 4s: a lie.
    expect(t.action(id(first), { type: 'bid', quantity: 5, face: 4 })).toBeNull();
    expect(t.action(id(other), { type: 'bid', quantity: 5, face: 3 })).toBe('That bid does not beat the last one.');
    expect(t.action(id(other), { type: 'liar' })).toBeNull();
    expect(st().phase).toBe('reveal');
    expect(st().reveal!.count).toBe(4);
    expect(st().reveal!.loser).toBe(first);
    expect(st().seats[first]!.count).toBe(4);
  });

  it('gives the whole pot to the last player with dice', () => {
    const c = casino([1, 2]);
    const t = c.seat(new LiarsTable('liars1', c.ctx));
    const st = () => t.publicState() as LiarsState;
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    for (let guard = 0; guard < 40 && st().phase !== 'over'; guard++) {
      if (st().phase === 'reveal') {
        vi.advanceTimersByTime(LD.revealMs);
        continue;
      }
      const turn = st().turn!;
      // Bid more dice than exist, so every call of "Liar!" is right.
      if (!st().bid) t.action(turn + 1, { type: 'bid', quantity: st().totalDice, face: 6 });
      else t.action(turn + 1, { type: 'liar' });
    }
    expect(st().phase).toBe('over');
    const winner = st().winner!;
    expect(c.chips.get(winner + 1)).toBe(1000 + LD.stake);
    vi.advanceTimersByTime(LD.overMs);
    expect(c.finished.sort()).toEqual([1, 2]);
  });
});

describe('MeyerTable', () => {
  it('catches a liar and takes their life', () => {
    const c = casino([1, 2]);
    const t = c.seat(new MeyerTable('meyer1', c.ctx));
    const st = () => t.publicState() as MeyerState;
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    t.forceTurn(0);
    t.rig = [[3, 5]];
    expect(t.action(1, { type: 'roll' })).toBeNull();
    expect((t.secretState(1) as { dice: number[] }).dice).toEqual([3, 5]);
    expect((t.secretState(2) as { dice: number[] | null }).dice).toBeNull();
    expect(t.action(1, { type: 'announce', value: 66 })).toBeNull(); // really 53
    expect(st().phase).toBe('deciding');
    expect(st().turn).toBe(1);
    expect(t.action(2, { type: 'lie' })).toBeNull();
    expect(st().reveal).toMatchObject({ dice: [3, 5], announced: 66, truthful: false, loser: 0, lost: 1 });
    expect(st().seats[0]!.lives).toBe(MY.lives - 1);
  });

  it('costs two lives to doubt a real Meyer', () => {
    const c = casino([1, 2]);
    const t = c.seat(new MeyerTable('meyer1', c.ctx));
    const st = () => t.publicState() as MeyerState;
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    t.forceTurn(0);
    t.rig = [[2, 1]];
    t.action(1, { type: 'roll' });
    t.action(1, { type: 'announce', value: 21 });
    t.action(2, { type: 'lie' });
    expect(st().reveal!.truthful).toBe(true);
    expect(st().seats[1]!.lives).toBe(MY.lives - 2);
  });

  it('makes a believer roll, and beat the last call', () => {
    const c = casino([1, 2]);
    const t = c.seat(new MeyerTable('meyer1', c.ctx));
    const st = () => t.publicState() as MeyerState;
    t.action(1, { type: 'ready' });
    t.action(2, { type: 'ready' });
    t.forceTurn(0);
    t.rig = [[6, 4], [1, 1]];
    t.action(1, { type: 'roll' });
    t.action(1, { type: 'announce', value: 64 });
    expect(t.action(2, { type: 'believe' })).toBeNull();
    expect(st().phase).toBe('rolling');
    t.action(2, { type: 'roll' });
    expect(t.action(2, { type: 'announce', value: 63 })).toBe('You have to beat the last call.');
    expect(t.action(2, { type: 'announce', value: 11 })).toBeNull();
    expect(st().turn).toBe(0);
  });
});
