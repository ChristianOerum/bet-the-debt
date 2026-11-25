// Punto Banco baccarat. Players bet on the Player hand, the Banker hand, or a tie;
// the cards are drawn by fixed rules, nobody makes decisions.
import type { Card, Rank } from '../blackjack/rules';

export const BAC = {
  decks: 8,
  betTimeMs: 15_000,
  cardMs: 650,
  payoutMs: 5_000,
  maxBet: 100_000,
  chipValues: [1, 5, 10, 50, 100, 500, 1000, 5000, 10_000, 25_000],
} as const;

export type BacSide = 'player' | 'banker' | 'tie';
export const BAC_SIDES: BacSide[] = ['player', 'banker', 'tie'];

export function bacValue(rank: Rank): number {
  if (rank === 'A') return 1;
  if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;
  return Number(rank);
}

export function bacTotal(cards: Card[]): number {
  return cards.reduce((t, c) => t + bacValue(c.rank), 0) % 10;
}

/** Should the banker draw a third card? `p3` is the player's third card value, or null if they stood. */
export function bankerDraws(bankerTotal: number, p3: number | null): boolean {
  if (p3 === null) return bankerTotal <= 5;
  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return p3 !== 8;
  if (bankerTotal === 4) return p3 >= 2 && p3 <= 7;
  if (bankerTotal === 5) return p3 >= 4 && p3 <= 7;
  if (bankerTotal === 6) return p3 === 6 || p3 === 7;
  return false;
}

/** Deal a whole coup. Cards come back in the order they are laid on the table. */
export function dealCoup(draw: () => Card): { side: 'player' | 'banker'; card: Card }[] {
  const player: Card[] = [];
  const banker: Card[] = [];
  const order: { side: 'player' | 'banker'; card: Card }[] = [];
  const give = (side: 'player' | 'banker') => {
    const card = draw();
    (side === 'player' ? player : banker).push(card);
    order.push({ side, card });
    return card;
  };
  give('player');
  give('banker');
  give('player');
  give('banker');
  const natural = bacTotal(player) >= 8 || bacTotal(banker) >= 8;
  if (!natural) {
    let p3: number | null = null;
    if (bacTotal(player) <= 5) p3 = bacValue(give('player').rank);
    if (bankerDraws(bacTotal(banker), p3)) give('banker');
  }
  return order;
}

export function bacWinner(player: Card[], banker: Card[]): BacSide {
  const p = bacTotal(player);
  const b = bacTotal(banker);
  return p > b ? 'player' : b > p ? 'banker' : 'tie';
}

/** What a bet hands back (stake included). Banker wins pay 19:20 (the house's cut); a tie pays 8:1. */
export function bacReturn(side: BacSide, amount: number, winner: BacSide): number {
  if (side === 'tie') return winner === 'tie' ? amount * 9 : 0;
  if (winner === 'tie') return amount; // player and banker bets push on a tie
  if (side !== winner) return 0;
  return side === 'player' ? amount * 2 : amount + Math.floor(amount * 0.95);
}

export interface BaccaratSeat {
  playerId: number;
  name: string;
  bets: Record<BacSide, number>;
  ready: boolean;
  net: number | null;
  gone: boolean;
}

export interface BaccaratState {
  type: 'baccarat';
  phase: 'waiting' | 'betting' | 'dealing' | 'payout';
  seats: (BaccaratSeat | null)[];
  cards: { side: 'player' | 'banker'; card: Card }[];
  playerTotal: number | null;
  bankerTotal: number | null;
  winner: BacSide | null;
  coup: number;
  history: BacSide[];
  timeLeftMs: number | null;
  timerMs: number;
}

export type BaccaratAction = { type: 'bet'; side: BacSide; amount: number } | { type: 'clear' } | { type: 'ready' };
