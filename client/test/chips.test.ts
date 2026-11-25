import { describe, expect, it } from 'vitest';
import { BAC, BJ, RT } from '@casino/shared';
import { chipLabel, CHIP_COLORS, offeredChips } from '../src/games/props';

describe('chips', () => {
  it('every game has 1s up to 25,000s, and every chip has a colour', () => {
    for (const values of [BJ.chipValues, RT.chipValues, BAC.chipValues]) {
      expect(values).toEqual([1, 5, 10, 50, 100, 500, 1000, 5000, 10_000, 25_000]);
      for (const v of values) expect(CHIP_COLORS.some(([c]) => c === v), String(v)).toBe(true);
    }
    // The table maximum lets you actually put a 25K chip down.
    expect(BJ.maxBet).toBeGreaterThanOrEqual(25_000);
  });

  it('big chips are labelled short, and only offered once you could afford one', () => {
    expect([1, 500, 1000, 25_000].map(chipLabel)).toEqual(['1', '500', '1K', '25K']);
    expect(offeredChips(BJ.chipValues, 300)).toEqual([1, 5, 10, 50, 100]);
    expect(offeredChips(BJ.chipValues, 12_000)).toEqual([1, 5, 10, 50, 100, 500, 1000, 5000, 10_000]);
  });
});
