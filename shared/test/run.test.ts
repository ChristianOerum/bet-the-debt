import { describe, expect, it } from 'vitest';
import { advanceRun, anteFor, cashFor, DIFFICULTY_ORDER, RUN, runScore, runState } from '../src/index';

describe('anteFor', () => {
  it('starts small and keeps climbing', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => anteFor(n))).toEqual([50, 80, 110, 170, 250, 380, 570, 850]);
  });
  it('cannot be survived on the starting stack alone', () => {
    let total = 0;
    let round = 0;
    while (total < RUN.startChips) total += anteFor(++round);
    expect(round).toBeLessThanOrEqual(5);
  });
});

describe('advanceRun', () => {
  it('counts hands without charging until the round is over', () => {
    expect(advanceRun({ chips: 500, round: 1, hands: 0 })).toEqual({
      chips: 500,
      round: 1,
      hands: 1,
      charged: 0,
      dead: false,
      reached: 1,
    });
    expect(advanceRun({ chips: 500, round: 1, hands: 1 }).hands).toBe(2);
  });

  it('collects the ante on the last hand of the round and moves on', () => {
    expect(advanceRun({ chips: 500, round: 1, hands: 2 })).toEqual({
      chips: 450,
      round: 2,
      hands: 0,
      charged: 50,
      dead: false,
      reached: 1,
    });
    expect(advanceRun({ chips: 600, round: 4, hands: 2 }).charged).toBe(170);
  });

  it('kills a player who lost everything, even mid-round', () => {
    const r = advanceRun({ chips: 0, round: 3, hands: 0 });
    expect(r.dead).toBe(true);
    expect(r.charged).toBe(0);
    expect(r.reached).toBe(3);
  });

  it('kills a player the ante puts into debt', () => {
    const r = advanceRun({ chips: 100, round: 4, hands: 2 });
    expect(r.chips).toBe(-70);
    expect(r.dead).toBe(true);
    expect(r.reached).toBe(4);
  });

  it('kills a player left with less than the table minimum', () => {
    expect(advanceRun({ chips: 5, round: 1, hands: 0 }).dead).toBe(true);
    expect(advanceRun({ chips: 60, round: 1, hands: 2 }).dead).toBe(false); // exactly 10 left
    expect(advanceRun({ chips: 55, round: 1, hands: 2 }).dead).toBe(true);
  });
});

describe('runState', () => {
  it('tells the player what is due and when', () => {
    expect(runState(3, 1, 5)).toEqual({ round: 3, handsLeft: 2, ante: 110, best: 5, bestLevel: 'hard', difficulty: 'hard' });
  });
});

describe('cashFor', () => {
  it('pays out only what you won on top of the house stake', () => {
    expect(cashFor(700)).toBe(200);
    expect(cashFor(RUN.startChips)).toBe(0);
    expect(cashFor(120)).toBe(0); // never negative
  });
});

describe('difficulty', () => {
  /** The round in which the starting stack alone no longer covers the antes. */
  const runway = (d: (typeof DIFFICULTY_ORDER)[number]) => {
    let total = 0;
    let round = 0;
    while (total < RUN.startChips) total += anteFor(++round, d);
    return round;
  };

  it('hard is the original game', () => {
    expect([1, 2, 3, 4].map((n) => anteFor(n, 'hard'))).toEqual([50, 80, 110, 170]);
    expect(runState(1, 0, 1, 'hard').handsLeft).toBe(3);
  });

  it('easier levels charge less, less often, and the stack lasts longer', () => {
    expect(runState(1, 0, 1, 'easy').handsLeft).toBe(5);
    expect(runState(1, 0, 1, 'normal').handsLeft).toBe(4);
    expect(anteFor(1, 'easy')).toBeLessThan(anteFor(1, 'normal'));
    expect(anteFor(1, 'normal')).toBeLessThan(anteFor(1, 'hard'));
    expect(runway('easy')).toBeGreaterThan(runway('normal'));
    expect(runway('normal')).toBeGreaterThan(runway('hard'));
    // Four hands into a Normal round: the ante is collected on the fourth, not the third.
    expect(advanceRun({ chips: 500, round: 1, hands: 2 }, 'normal').charged).toBe(0);
    expect(advanceRun({ chips: 500, round: 1, hands: 3 }, 'normal').charged).toBe(30);
  });

  it('on the leaderboard, a round on Hard is worth more than the same round on Easy', () => {
    expect(runScore(5, 'hard')).toBeGreaterThan(runScore(5, 'easy'));
    // Each level's handicap is about how much shorter its runway is.
    expect(runScore(runway('hard'), 'hard')).toBeCloseTo(runScore(runway('easy'), 'easy'), -1);
  });
});