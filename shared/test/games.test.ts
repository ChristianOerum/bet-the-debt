import { describe, expect, it } from 'vitest';
import {
  bacReturn,
  bacTotal,
  bacWinner,
  bankerDraws,
  betReturn,
  bestScore,
  buildPots,
  canAnnounce,
  colorOf,
  compareScores,
  countFace,
  dealCoup,
  describeHand,
  isValidBet,
  meyerName,
  meyerValue,
  nextBid,
  validBid,
  WHEEL_ORDER,
  type Card,
  type Rank,
  type Suit,
} from '../src/index';

const c = (s: string): Card => ({ rank: s.slice(0, -1) as Rank, suit: s.slice(-1) as Suit });
const cards = (s: string) => s.split(' ').map(c);

describe('roulette', () => {
  it('has every number once on the wheel', () => {
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });
  it('knows its colours', () => {
    expect(colorOf(0)).toBe('green');
    expect(colorOf(1)).toBe('red');
    expect(colorOf(2)).toBe('black');
  });
  it('pays the right amounts', () => {
    expect(betReturn('n17', 10, 17)).toBe(360);
    expect(betReturn('n17', 10, 18)).toBe(0);
    expect(betReturn('red', 50, 1)).toBe(100);
    expect(betReturn('red', 50, 0)).toBe(0);
    expect(betReturn('even', 50, 0)).toBe(0); // zero is neither odd nor even
    expect(betReturn('dozen2', 30, 24)).toBe(90);
    expect(betReturn('high', 20, 18)).toBe(0);
  });
  it('rejects nonsense bets', () => {
    expect(isValidBet('n36')).toBe(true);
    expect(isValidBet('n37')).toBe(false);
    expect(isValidBet('purple')).toBe(false);
  });
});

describe('baccarat', () => {
  it('counts only the last digit', () => {
    expect(bacTotal(cards('9S 8H'))).toBe(7);
    expect(bacTotal(cards('KS QH'))).toBe(0);
    expect(bacTotal(cards('AS 5H'))).toBe(6);
  });
  it('follows the banker drawing table', () => {
    expect(bankerDraws(5, null)).toBe(true);
    expect(bankerDraws(6, null)).toBe(false);
    expect(bankerDraws(3, 8)).toBe(false);
    expect(bankerDraws(3, 9)).toBe(true);
    expect(bankerDraws(6, 7)).toBe(true);
    expect(bankerDraws(6, 5)).toBe(false);
  });
  it('stops on a natural', () => {
    const deck = cards('9S 2H KD 3C 5S 5H');
    const coup = dealCoup(() => deck.shift()!);
    expect(coup).toHaveLength(4);
  });
  it('gives the player a third card on 5 or less, and the banker answers by the table', () => {
    // player A,4 = 5 -> draws 2 (p3 = 2). banker 10,4 = 4 -> draws on p3 2..7.
    const deck = cards('AS 10H 4D 4C 2S 7H');
    const coup = dealCoup(() => deck.shift()!);
    expect(coup.map((x) => x.side)).toEqual(['player', 'banker', 'player', 'banker', 'player', 'banker']);
  });
  it('pays player evens, banker less the commission, tie 8 to 1', () => {
    expect(bacWinner(cards('9S KH'), cards('8D KC'))).toBe('player');
    expect(bacReturn('player', 100, 'player')).toBe(200);
    expect(bacReturn('banker', 100, 'banker')).toBe(195);
    expect(bacReturn('banker', 10, 'banker')).toBe(19);
    expect(bacReturn('tie', 10, 'tie')).toBe(90);
    expect(bacReturn('player', 100, 'tie')).toBe(100);
    expect(bacReturn('player', 100, 'banker')).toBe(0);
  });
});

describe('poker hands', () => {
  const best = (s: string) => bestScore(cards(s));
  it('ranks hands in order', () => {
    const ladder = [
      'AS KD 9H 7C 3S 2D 4H', // high card
      '9S 9D AH 7C 3S 2D 4H'.replace('4H', '5H').replace('3S', 'JS'), // pair
      '9S 9D 7H 7C 3S 2D QH', // two pair
      '9S 9D 9H 7C 3S 2D QH', // trips
      '5S 6D 7H 8C 9S 2D QH', // straight
      '2H 6H 9H JH KH 2D 3C', // flush
      '9S 9D 9H 7C 7S 2D QH', // full house
      '9S 9D 9H 9C 7S 2D QH', // quads
      '5H 6H 7H 8H 9H 2D QC', // straight flush
    ];
    const scores = ladder.map(best);
    scores.forEach((s, i) => expect(s[0]).toBe(i));
    for (let i = 1; i < scores.length; i++) expect(compareScores(scores[i], scores[i - 1])).toBeGreaterThan(0);
  });
  it('knows the wheel is the lowest straight', () => {
    expect(best('AS 2D 3H 4C 5S KD QH')).toEqual([4, 5]);
    expect(compareScores(best('2S 3D 4H 5C 6S KD QH'), best('AS 2D 3H 4C 5S KD QH'))).toBeGreaterThan(0);
  });
  it('breaks ties on kickers', () => {
    expect(compareScores(best('AS AD KH 9C 3S 2D 4H'), best('AS AD QH 9C 3S 2D 4H'))).toBeGreaterThan(0);
    expect(compareScores(best('AS AD KH 9C 3S 2D 4H'), best('AC AH KS 9D 3C 2H 4S'))).toBe(0);
  });
  it('describes a hand in words', () => {
    expect(describeHand(cards('8S 8D'))).toBe('Pair of 8s');
    expect(describeHand(cards('9S 9D 9H 7C 7S'))).toBe('Full house, 9s over 7s');
  });
});

describe('side pots', () => {
  it('splits an all-in into main and side pots', () => {
    // A all-in for 100, B and C put in 300 each.
    const pots = buildPots([
      { seat: 0, amount: 100, live: true },
      { seat: 1, amount: 300, live: true },
      { seat: 2, amount: 300, live: true },
    ]);
    expect(pots).toEqual([
      { amount: 300, eligible: [0, 1, 2] },
      { amount: 400, eligible: [1, 2] },
    ]);
  });
  it('counts folded chips but never lets a folded player win them', () => {
    const pots = buildPots([
      { seat: 0, amount: 200, live: false },
      { seat: 1, amount: 100, live: true },
      { seat: 2, amount: 100, live: true },
    ]);
    expect(pots.reduce((t, p) => t + p.amount, 0)).toBe(400);
    expect(pots.every((p) => !p.eligible.includes(0))).toBe(true);
  });
});

describe("liar's dice", () => {
  it('only accepts bids that beat the last one', () => {
    expect(validBid(null, 1, 2, 10)).toBe(true);
    expect(validBid(null, 1, 1, 10)).toBe(false); // no bidding on ones
    const prev = { quantity: 3, face: 4, seat: 0 };
    expect(validBid(prev, 3, 5, 10)).toBe(true);
    expect(validBid(prev, 3, 4, 10)).toBe(false);
    expect(validBid(prev, 3, 3, 10)).toBe(false);
    expect(validBid(prev, 4, 2, 10)).toBe(true);
    expect(validBid(prev, 11, 2, 10)).toBe(false);
  });
  it('counts ones as wild', () => {
    expect(countFace([[1, 4, 4], [2, 1]], 4)).toBe(4);
  });
  it('suggests the smallest next bid', () => {
    expect(nextBid(null)).toEqual({ quantity: 1, face: 2 });
    expect(nextBid({ quantity: 2, face: 6, seat: 0 })).toEqual({ quantity: 3, face: 2 });
  });
});

describe('meyer', () => {
  it('reads throws the Meyer way', () => {
    expect(meyerValue(1, 2)).toBe(21);
    expect(meyerValue(1, 3)).toBe(31);
    expect(meyerValue(3, 5)).toBe(53);
    expect(meyerValue(4, 4)).toBe(44);
    expect(meyerName(21)).toBe('Meyer!');
    expect(meyerName(55)).toBe('Pair of 5s');
  });
  it('ranks Meyer above everything and pairs above ordinary throws', () => {
    expect(canAnnounce(65, 11)).toBe(true);
    expect(canAnnounce(66, 31)).toBe(true);
    expect(canAnnounce(31, 21)).toBe(true);
    expect(canAnnounce(54, 53)).toBe(false);
    expect(canAnnounce(21, 21)).toBe(true);
    expect(canAnnounce(null, 32)).toBe(true);
    expect(canAnnounce(null, 12)).toBe(false); // not a real throw: always the higher die first
  });
});
