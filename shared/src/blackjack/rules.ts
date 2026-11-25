// Pure blackjack rules. No timers, no networking: easy to test, used by server and browser.

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const SUIT_SIGNS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
/** A card written out, like "10♥". */
export const cardText = (c: Card) => `${c.rank}${SUIT_SIGNS[c.suit]}`;

export function cardValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return Number(rank);
}

/** Best total for a hand. `soft` means an ace is still counted as 11. */
export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function canSplit(cards: Card[]): boolean {
  return cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank);
}

export function createShoe(decks = 6, rng: () => number = Math.random): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

export type HandResult = 'blackjack' | 'win' | 'push' | 'lose';

/**
 * Settle one finished player hand against the dealer's final cards.
 * `payout` is the total handed back to the player (their bet included), so 0 = lost it all.
 */
export function settleHand(
  hand: { cards: Card[]; bet: number; fromSplit: boolean },
  dealer: Card[],
): { result: HandResult; payout: number } {
  const player = handValue(hand.cards).total;
  const dealerTotal = handValue(dealer).total;
  const playerNatural = isBlackjack(hand.cards) && !hand.fromSplit;
  const dealerNatural = isBlackjack(dealer);

  if (player > 21) return { result: 'lose', payout: 0 };
  if (playerNatural) {
    if (dealerNatural) return { result: 'push', payout: hand.bet };
    return { result: 'blackjack', payout: hand.bet + Math.floor(hand.bet * 1.5) };
  }
  if (dealerNatural) return { result: 'lose', payout: 0 };
  if (dealerTotal > 21 || player > dealerTotal) return { result: 'win', payout: hand.bet * 2 };
  if (player === dealerTotal) return { result: 'push', payout: hand.bet };
  return { result: 'lose', payout: 0 };
}

/** What the player whose turn it is may do with this hand. */
export function allowedActions(
  hand: { cards: Card[]; bet: number; status: string },
  handCount: number,
  chips: number,
): { hit: boolean; stand: boolean; double: boolean; split: boolean } {
  const playing = hand.status === 'playing';
  const twoCards = hand.cards.length === 2;
  const canAfford = chips >= hand.bet;
  return {
    hit: playing,
    stand: playing,
    double: playing && twoCards && canAfford,
    split: playing && handCount === 1 && canSplit(hand.cards) && canAfford,
  };
}
