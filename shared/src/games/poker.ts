// No-limit Texas Hold'em between the players. The house only deals.
import type { Card, Rank } from '../blackjack/rules';

export const PK = {
  smallBlind: 10,
  bigBlind: 20,
  startDelayMs: 6_000,
  turnTimeMs: 25_000,
  streetDelayMs: 1_200,
  showdownMs: 7_000,
} as const;

const RANK_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};
export const HAND_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

/** Score of exactly five cards: [category, tie-breakers...]. Bigger is better, compared left to right. */
export function score5(cards: Card[]): number[] {
  const values = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const unique = [...new Set(values)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (values[0] - values[4] === 4) straightHigh = values[0];
    else if (values.join() === '14,5,4,3,2') straightHigh = 5; // the wheel: A-2-3-4-5
  }
  if (straightHigh && flush) return [8, straightHigh];
  // Group by count, then by value: e.g. full house 8-8-8-K-K -> [[3,8],[2,13]]
  const counts = unique.map((v) => [values.filter((x) => x === v).length, v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kickers = counts.map((c) => c[1]);
  if (counts[0][0] === 4) return [7, ...kickers];
  if (counts[0][0] === 3 && counts[1][0] === 2) return [6, ...kickers];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (counts[0][0] === 3) return [3, ...kickers];
  if (counts[0][0] === 2 && counts[1][0] === 2) return [2, ...kickers];
  if (counts[0][0] === 2) return [1, ...kickers];
  return [0, ...values];
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Best five-card score from five to seven cards. */
export function bestScore(cards: Card[]): number[] {
  let best: number[] | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const s = score5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareScores(s, best) > 0) best = s;
          }
  return best ?? [0];
}

const NAMES: Record<number, string> = { 14: 'Aces', 13: 'Kings', 12: 'Queens', 11: 'Jacks', 10: 'Tens', 6: 'Sixes' };
const plural = (v: number) => NAMES[v] ?? `${v}s`;

export function describeScore(s: number[]): string {
  switch (s[0]) {
    case 1:
      return `Pair of ${plural(s[1])}`;
    case 2:
      return `Two pair, ${plural(s[1])} and ${plural(s[2])}`;
    case 3:
      return `Three ${plural(s[1])}`;
    case 7:
      return `Four ${plural(s[1])}`;
    case 6:
      return `Full house, ${plural(s[1])} over ${plural(s[2])}`;
    default:
      return HAND_NAMES[s[0]];
  }
}

/** Describe what someone has so far (two hole cards, plus whatever is on the board). */
export function describeHand(cards: Card[]): string {
  if (cards.length < 5) {
    const [a, b] = cards.map((c) => RANK_VALUE[c.rank]);
    return a === b ? `Pair of ${plural(a)}` : 'High card';
  }
  return describeScore(bestScore(cards));
}

/**
 * Split the money into the main pot and side pots. Each player can win back at most
 * what they matched from everyone else. Folded players' chips count but they cannot win.
 */
export function buildPots(contrib: { seat: number; amount: number; live: boolean }[]): { amount: number; eligible: number[] }[] {
  const levels = [...new Set(contrib.filter((c) => c.live && c.amount > 0).map((c) => c.amount))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contrib) amount += Math.max(0, Math.min(c.amount, level) - prev);
    const eligible = contrib.filter((c) => c.live && c.amount >= level).map((c) => c.seat);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  // Chips put in above the highest live level (a folded player's over-bet) go to the last pot.
  const leftover = contrib.reduce((t, c) => t + Math.max(0, c.amount - prev), 0);
  if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
  return pots;
}

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river';

export interface PokerSeat {
  playerId: number;
  name: string;
  /** Dealt into the current hand. */
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Chips put in on this street. */
  bet: number;
  /** Chips put in this whole hand. */
  committed: number;
  /** Their hole cards: only shown to everyone at a showdown. */
  shown: Card[] | null;
  lastAction: string | null;
  /** At the end of a hand: what they won, and with what. */
  won: number | null;
  handName: string | null;
  gone: boolean;
}

export interface PokerState {
  type: 'poker';
  phase: 'waiting' | PokerStreet | 'showdown';
  seats: (PokerSeat | null)[];
  board: Card[];
  button: number;
  turn: number | null;
  currentBet: number;
  minRaise: number;
  pot: number;
  hand: number;
  timeLeftMs: number | null;
  timerMs: number;
}

export interface PokerSecret {
  cards: Card[];
}

export type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }
  | { type: 'allin' };
