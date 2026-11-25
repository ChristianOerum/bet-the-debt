// How the house's regulars play. Each function looks at what a patron can see and says what
// they do. They are not good players, just plausible ones: a little cautious, a little random.

import { handValue, RANKS, type Card } from './blackjack/rules';
import { canSplit } from './blackjack/rules';
import { canAnnounce, countFace, MEYER_ORDER, meyerRank, meyerValue, nextBid, validBid, type Bid } from './games/dice';
import { bestScore } from './games/poker';

/** Patrons have negative ids; players positive ones. */
export const isPatron = (id: number) => id < 0;

/** A random number from `rnd`, so tests can fix it. */
export type Rnd = () => number;

/** How much a patron puts on a hand: a small slice of their stack, in tens. */
export function patronStake(chips: number, rnd: Rnd = Math.random, min = 10): number {
  const want = Math.round((chips * (0.04 + rnd() * 0.08)) / 10) * 10;
  const bet = Math.max(min, Math.min(400, want));
  return bet <= chips ? bet : 0;
}

// ---- blackjack ------------------------------------------------------------------------

export type BJMove = 'hit' | 'stand' | 'double' | 'split';

/** Roughly basic strategy, without the tables. */
export function blackjackMove(cards: Card[], dealerUp: Card, opts: { canDouble: boolean; canSplit: boolean }): BJMove {
  const { total, soft } = handValue(cards);
  const up = handValue([dealerUp]).total; // ace counts 11
  const two = cards.length === 2;
  if (two && opts.canSplit && canSplit(cards) && (cards[0].rank === 'A' || cards[0].rank === '8')) return 'split';
  if (two && opts.canDouble && !soft && (total === 11 || (total === 10 && up < 10))) return 'double';
  if (soft) return total <= 17 ? 'hit' : 'stand';
  if (total <= 11) return 'hit';
  if (total <= 16) return up >= 7 ? 'hit' : 'stand';
  return 'stand';
}

// ---- poker ----------------------------------------------------------------------------

const rankValue = (c: Card) => (c.rank === 'A' ? 14 : RANKS.indexOf(c.rank) + 1);

/** How good a hand feels, 0 (rags) to 1 (the nuts, more or less). */
export function pokerStrength(hole: Card[], board: Card[]): number {
  if (board.length === 0) {
    const [a, b] = hole.map(rankValue).sort((x, y) => y - x);
    let s = (a + b - 4) / 30; // 0 for 2-2 high... 0.8 for A-K
    if (a === b) s = 0.5 + a / 28;
    if (hole[0].suit === hole[1].suit) s += 0.06;
    if (Math.abs(a - b) === 1) s += 0.04;
    return Math.max(0, Math.min(1, s));
  }
  const score = bestScore([...hole, ...board]);
  // Categories run 0 (high card) to 8 (straight flush).
  const base = [0.15, 0.42, 0.62, 0.74, 0.8, 0.84, 0.9, 0.96, 1][score[0]];
  // A pair that only lives on the board is worth much less.
  const boardOnly = board.length >= 5 && bestScore(board)[0] === score[0] && score[0] <= 2;
  return Math.min(1, (boardOnly ? base * 0.5 : base) + (score[1] ?? 0) / 200);
}

export type PokerMove = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number } | { type: 'allin' };

export function pokerMove(
  strength: number,
  s: { toCall: number; stack: number; bet: number; currentBet: number; minRaise: number; pot: number },
  rnd: Rnd = Math.random,
): PokerMove {
  const bluff = rnd() < 0.07;
  const feel = Math.min(1, strength + (bluff ? 0.35 : 0) + (rnd() - 0.5) * 0.1);
  const raiseTo = () => {
    const size = Math.max(s.minRaise, Math.round((s.pot * (0.5 + rnd() * 0.5)) / 10) * 10);
    const to = s.currentBet + size;
    return to >= s.bet + s.stack ? ({ type: 'allin' } as const) : ({ type: 'raise', to } as const);
  };
  if (s.toCall <= 0) return feel > 0.7 && s.stack > 0 ? raiseTo() : { type: 'check' };
  if (s.toCall >= s.stack) return feel > 0.75 ? { type: 'allin' } : { type: 'fold' };
  // The more it costs relative to the stack, the more it takes to stay in.
  const price = s.toCall / (s.stack + s.bet);
  if (feel < 0.25 + price) return { type: 'fold' };
  if (feel > 0.85 && rnd() < 0.6) return raiseTo();
  return { type: 'call' };
}

// ---- liar's dice ------------------------------------------------------------------------

export type LiarsMove = { type: 'bid'; quantity: number; face: number } | { type: 'liar' };

/** What I expect the whole table to hold of `face`: mine for sure, a third of the rest (ones are wild). */
function expected(own: number[], face: number, totalDice: number) {
  return countFace([own], face) + (totalDice - own.length) / 3;
}

export function liarsMove(own: number[], totalDice: number, bid: Bid | null, rnd: Rnd = Math.random): LiarsMove {
  if (bid && bid.quantity > expected(own, bid.face, totalDice) + 1 + rnd()) return { type: 'liar' };
  // Raise on the face I hold most of, as little as I can get away with.
  const faces = [2, 3, 4, 5, 6].sort((a, b) => expected(own, b, totalDice) - expected(own, a, totalDice));
  for (const face of faces) {
    const exp = expected(own, face, totalDice);
    let q = bid ? bid.quantity : Math.max(1, Math.floor(exp) - 1);
    if (bid && !validBid(bid, q, face, totalDice)) q++;
    if (validBid(bid, q, face, totalDice) && q <= exp + 0.5) return { type: 'bid', quantity: q, face };
  }
  if (bid) return { type: 'liar' };
  const b = nextBid(null);
  return { type: 'bid', ...b };
}

// ---- meyer ------------------------------------------------------------------------------

/** Say what you rolled if it is good enough; otherwise the smallest lie that is. Sometimes a bigger one. */
export function meyerAnnounce(rolled: [number, number], prev: number | null, rnd: Rnd = Math.random): number {
  const truth = meyerValue(...rolled);
  const lowest = MEYER_ORDER.find((v) => canAnnounce(prev, v)) ?? 21;
  if (canAnnounce(prev, truth)) return truth;
  if (rnd() < 0.3) {
    // Overclaim a step or two, to look natural.
    const k = Math.min(MEYER_ORDER.length - 1, meyerRank(lowest) + 1 + Math.floor(rnd() * 2));
    return MEYER_ORDER[k];
  }
  return lowest;
}

/** Believe the last call, or call it a lie? Big claims get doubted. */
export function meyerDoubt(announced: number, rnd: Rnd = Math.random): boolean {
  const r = meyerRank(announced) / (MEYER_ORDER.length - 1);
  return rnd() < r * r * 0.85;
}
