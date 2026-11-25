import type { Card, HandResult } from './rules';

/** Table settings. Bets are any whole number of chips (from 1s and 5s up); a 3:2 blackjack on an odd bet rounds down. */
export const BJ = {
  seats: 5,
  decks: 6,
  reshuffleAt: 75,
  minBet: 10,
  maxBet: 100_000,
  chipValues: [1, 5, 10, 50, 100, 500, 1000, 5000, 10_000, 25_000],
  betTimeMs: 15_000,
  turnTimeMs: 20_000,
  payoutTimeMs: 5_000,
  dealCardMs: 180,
  dealerDrawMs: 900,
} as const;

export type BJPhase = 'waiting' | 'betting' | 'dealing' | 'players' | 'dealer' | 'payout';

export interface BJHandState {
  cards: Card[];
  bet: number;
  status: 'playing' | 'stood' | 'bust' | 'blackjack';
  doubled: boolean;
  fromSplit: boolean;
  result?: HandResult;
  payout?: number;
}

export interface BJSeatState {
  playerId: number;
  name: string;
  /** Bet being built during the betting phase (not yet taken from the account). */
  bet: number;
  ready: boolean;
  hands: BJHandState[];
  /** Player walked away mid-round; the seat frees up when the round ends. */
  gone: boolean;
  /** Chips won or lost this round, shown during payout. */
  net: number | null;
}

export interface BJState {
  type: 'blackjack';
  phase: BJPhase;
  round: number;
  seats: (BJSeatState | null)[];
  /** `null` is a face-down card. */
  dealer: (Card | null)[];
  dealerTotal: number | null;
  turn: { seat: number; hand: number } | null;
  timeLeftMs: number | null;
}

export type BJAction =
  | { type: 'bet'; amount: number }
  | { type: 'clearBet' }
  | { type: 'ready' }
  | { type: 'hit' }
  | { type: 'stand' }
  | { type: 'double' }
  | { type: 'split' };
