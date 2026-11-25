import { describe, expect, it } from 'vitest';
import {
  blackjackMove,
  canAnnounce,
  liarsMove,
  meyerAnnounce,
  navRoute,
  patronStake,
  pokerMove,
  pokerStrength,
  seatExitPoint,
  seatWorld,
  SHAPES,
  SPAWN,
  STATIONS,
  validBid,
  type Card,
  type Rank,
  type Suit,
} from '../src/index';

const cards = (s: string): Card[] => s.split(' ').map((x) => ({ rank: x.slice(0, -1) as Rank, suit: x.slice(-1) as Suit }));
const fixed = (v: number) => () => v;

describe('patronStake', () => {
  it('bets a small slice, in tens, and never more than they have', () => {
    expect(patronStake(1000, fixed(0.5)) % 10).toBe(0);
    expect(patronStake(1000, fixed(0.5))).toBeLessThanOrEqual(120);
    expect(patronStake(5, fixed(0.5))).toBe(0);
    expect(patronStake(10, fixed(0.5))).toBe(10);
  });
});

describe('blackjackMove', () => {
  const opts = { canDouble: true, canSplit: true };
  it('plays like a sensible regular', () => {
    expect(blackjackMove(cards('8S 8H'), cards('10D')[0], opts)).toBe('split');
    expect(blackjackMove(cards('6S 5H'), cards('9D')[0], opts)).toBe('double');
    expect(blackjackMove(cards('10S 6H'), cards('10D')[0], opts)).toBe('hit');
    expect(blackjackMove(cards('10S 6H'), cards('5D')[0], opts)).toBe('stand');
    expect(blackjackMove(cards('10S 8H'), cards('AD')[0], opts)).toBe('stand');
    expect(blackjackMove(cards('AS 6H'), cards('10D')[0], opts)).toBe('hit');
    expect(blackjackMove(cards('6S 5H'), cards('9D')[0], { canDouble: false, canSplit: false })).toBe('hit');
  });
});

describe('poker', () => {
  it('rates aces above rags', () => {
    expect(pokerStrength(cards('AS AH'), [])).toBeGreaterThan(pokerStrength(cards('7S 2H'), []));
    expect(pokerStrength(cards('AS AH'), cards('AD 7C 2S'))).toBeGreaterThan(0.6);
  });
  it('folds junk to a big bet and raises the nuts', () => {
    const s = { toCall: 400, stack: 600, bet: 0, currentBet: 400, minRaise: 400, pot: 450 };
    expect(pokerMove(0.1, s, fixed(0.5))).toEqual({ type: 'fold' });
    const free = { ...s, toCall: 0, currentBet: 0, minRaise: 20, pot: 100 };
    expect(pokerMove(0.95, free, fixed(0.5)).type).toBe('raise');
    expect(pokerMove(0.2, free, fixed(0.5))).toEqual({ type: 'check' });
  });
});

describe("liar's dice", () => {
  it('always makes a legal bid, or calls', () => {
    for (let k = 0; k < 300; k++) {
      const own = Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 6));
      const total = 10;
      const bid = k % 3 === 0 ? null : { quantity: 1 + (k % 7), face: 2 + (k % 5), seat: 1 };
      const m = liarsMove(own, total, bid);
      if (m.type === 'bid') expect(validBid(bid, m.quantity, m.face, total)).toBe(true);
      else expect(bid).not.toBeNull();
    }
  });
  it('calls an impossible bid', () => {
    expect(liarsMove([2, 3, 4, 5, 6], 10, { quantity: 10, face: 6, seat: 1 }, fixed(0.5))).toEqual({ type: 'liar' });
  });
});

describe('meyer', () => {
  it('always announces something that beats the last call', () => {
    for (let k = 0; k < 300; k++) {
      const rolled: [number, number] = [1 + (k % 6), 1 + ((k * 7) % 6)];
      const prev = k % 4 === 0 ? null : [32, 54, 65, 22, 66, 31][k % 6];
      expect(canAnnounce(prev, meyerAnnounce(rolled, prev))).toBe(true);
    }
  });
});

describe('getting about', () => {
  it('a patron can walk from the entrance to every chair', () => {
    for (const st of STATIONS) {
      SHAPES[st.type].seats.forEach((_, i) => {
        const to = seatExitPoint(seatWorld(st, i));
        const path = navRoute(SPAWN, to, st.type === 'russian');
        expect(path, `${st.id} seat ${i}`).not.toBeNull();
      });
    }
  });
});
