import { describe, expect, it } from 'vitest';
import {
  allowedActions,
  canSplit,
  createShoe,
  handValue,
  isBlackjack,
  settleHand,
  type Card,
  type Rank,
} from '../src/index';

const h = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: 'S' }));
const hand = (bet: number, fromSplit: boolean, ...ranks: Rank[]) => ({ cards: h(...ranks), bet, fromSplit });

describe('handValue', () => {
  it('adds number and face cards', () => {
    expect(handValue(h('10', '7'))).toEqual({ total: 17, soft: false });
    expect(handValue(h('K', 'Q'))).toEqual({ total: 20, soft: false });
  });
  it('counts an ace as 11 while it fits', () => {
    expect(handValue(h('A', '6'))).toEqual({ total: 17, soft: true });
  });
  it('drops aces to 1 to avoid busting', () => {
    expect(handValue(h('A', '6', '10'))).toEqual({ total: 17, soft: false });
    expect(handValue(h('A', 'A'))).toEqual({ total: 12, soft: true });
    expect(handValue(h('A', 'A', 'A', '9'))).toEqual({ total: 12, soft: false });
  });
  it('busts over 21', () => {
    expect(handValue(h('10', '9', '5')).total).toBe(24);
  });
});

describe('isBlackjack / canSplit', () => {
  it('needs exactly two cards making 21', () => {
    expect(isBlackjack(h('A', 'K'))).toBe(true);
    expect(isBlackjack(h('7', '7', '7'))).toBe(false);
    expect(isBlackjack(h('10', '9'))).toBe(false);
  });
  it('splits equal-value pairs only', () => {
    expect(canSplit(h('8', '8'))).toBe(true);
    expect(canSplit(h('K', '10'))).toBe(true);
    expect(canSplit(h('9', '8'))).toBe(false);
    expect(canSplit(h('8', '8', '2'))).toBe(false);
  });
});

describe('settleHand', () => {
  it('pays blackjack 3:2', () => {
    expect(settleHand(hand(100, false, 'A', 'K'), h('10', '9'))).toEqual({ result: 'blackjack', payout: 250 });
    expect(settleHand(hand(10, false, 'A', 'K'), h('10', '9'))).toEqual({ result: 'blackjack', payout: 25 });
    // An odd bet (1s and 5s): 3:2 of 15 is 22.5, and the house keeps the half chip.
    expect(settleHand(hand(15, false, 'A', 'K'), h('10', '9'))).toEqual({ result: 'blackjack', payout: 37 });
  });
  it('pushes blackjack against dealer blackjack', () => {
    expect(settleHand(hand(100, false, 'A', 'K'), h('A', 'Q'))).toEqual({ result: 'push', payout: 100 });
  });
  it('21 after a split is a normal win, not a blackjack', () => {
    expect(settleHand(hand(100, true, 'A', 'K'), h('10', '9'))).toEqual({ result: 'win', payout: 200 });
  });
  it('loses to dealer blackjack even with 21', () => {
    expect(settleHand(hand(100, false, '7', '7', '7'), h('A', 'K'))).toEqual({ result: 'lose', payout: 0 });
  });
  it('a bust loses even if the dealer busts too', () => {
    expect(settleHand(hand(100, false, '10', '9', '5'), h('10', '6', 'K'))).toEqual({ result: 'lose', payout: 0 });
  });
  it('wins when the dealer busts or has less', () => {
    expect(settleHand(hand(50, false, '10', '5'), h('10', '6', 'K'))).toEqual({ result: 'win', payout: 100 });
    expect(settleHand(hand(50, false, '10', '9'), h('10', '8'))).toEqual({ result: 'win', payout: 100 });
  });
  it('pushes on equal totals and loses on less', () => {
    expect(settleHand(hand(50, false, '10', '8'), h('9', '9'))).toEqual({ result: 'push', payout: 50 });
    expect(settleHand(hand(50, false, '10', '7'), h('9', '9'))).toEqual({ result: 'lose', payout: 0 });
  });
});

describe('allowedActions', () => {
  it('offers double and split only when affordable and legal', () => {
    const pair = { cards: h('8', '8'), bet: 100, status: 'playing' };
    expect(allowedActions(pair, 1, 100)).toEqual({ hit: true, stand: true, double: true, split: true });
    expect(allowedActions(pair, 1, 90)).toEqual({ hit: true, stand: true, double: false, split: false });
    expect(allowedActions(pair, 2, 100).split).toBe(false);
    expect(allowedActions({ cards: h('8', '8', '2'), bet: 100, status: 'playing' }, 1, 100).double).toBe(false);
  });
  it('offers nothing on a finished hand', () => {
    expect(allowedActions({ cards: h('10', '9'), bet: 100, status: 'stood' }, 1, 500)).toEqual({
      hit: false,
      stand: false,
      double: false,
      split: false,
    });
  });
});

describe('createShoe', () => {
  it('holds six full decks', () => {
    const shoe = createShoe(6);
    expect(shoe).toHaveLength(312);
    expect(shoe.filter((c) => c.rank === 'A')).toHaveLength(24);
    expect(shoe.filter((c) => c.rank === 'A' && c.suit === 'H')).toHaveLength(6);
  });
  it('shuffles', () => {
    const a = createShoe(1).map((c) => c.rank + c.suit).join();
    const b = createShoe(1).map((c) => c.rank + c.suit).join();
    expect(a).not.toBe(b);
  });
});
