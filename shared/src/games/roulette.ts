// European roulette: one zero, 37 pockets. Players bet against the house.

export const RT = {
  betTimeMs: 20_000,
  spinMs: 7_000,
  payoutMs: 5_000,
  maxBet: 100_000,
  chipValues: [1, 5, 10, 50, 100, 500, 1000, 5000, 10_000, 25_000],
} as const;

/** Pockets in the order they sit round the wheel. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function colorOf(n: number): 'red' | 'black' | 'green' {
  return n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';
}

/** Outside bets, by key. A straight bet on a single number is written `n17`. */
export const OUTSIDE_BETS: { key: string; label: string; pays: number; wins: (n: number) => boolean }[] = [
  { key: 'red', label: 'Red', pays: 2, wins: (n) => colorOf(n) === 'red' },
  { key: 'black', label: 'Black', pays: 2, wins: (n) => colorOf(n) === 'black' },
  { key: 'odd', label: 'Odd', pays: 2, wins: (n) => n > 0 && n % 2 === 1 },
  { key: 'even', label: 'Even', pays: 2, wins: (n) => n > 0 && n % 2 === 0 },
  { key: 'low', label: '1–18', pays: 2, wins: (n) => n >= 1 && n <= 18 },
  { key: 'high', label: '19–36', pays: 2, wins: (n) => n >= 19 },
  { key: 'dozen1', label: '1st 12', pays: 3, wins: (n) => n >= 1 && n <= 12 },
  { key: 'dozen2', label: '2nd 12', pays: 3, wins: (n) => n >= 13 && n <= 24 },
  { key: 'dozen3', label: '3rd 12', pays: 3, wins: (n) => n >= 25 },
];

function straight(key: string): number | null {
  const m = /^n(\d{1,2})$/.exec(key);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 36 ? n : null;
}

export function isValidBet(key: string): boolean {
  return OUTSIDE_BETS.some((b) => b.key === key) || straight(key) !== null;
}

export function betLabel(key: string): string {
  const n = straight(key);
  return n !== null ? `#${n}` : (OUTSIDE_BETS.find((b) => b.key === key)?.label ?? key);
}

/** What a bet hands back (stake included) when the ball lands on `n`. 0 = lost. */
export function betReturn(key: string, amount: number, n: number): number {
  const s = straight(key);
  if (s !== null) return s === n ? amount * 36 : 0;
  const b = OUTSIDE_BETS.find((o) => o.key === key);
  return b && b.wins(n) ? amount * b.pays : 0;
}

export interface RouletteSeat {
  playerId: number;
  name: string;
  /** bet key -> chips on it */
  bets: Record<string, number>;
  total: number;
  ready: boolean;
  net: number | null;
  gone: boolean;
}

export interface RouletteState {
  type: 'roulette';
  phase: 'waiting' | 'betting' | 'spinning' | 'payout';
  seats: (RouletteSeat | null)[];
  /** Where the ball lands. Sent when the spin starts, so every wheel lands in the same pocket. */
  result: number | null;
  /** Goes up by one per spin. */
  spin: number;
  history: number[];
  timeLeftMs: number | null;
  timerMs: number;
}

export type RouletteAction = { type: 'bet'; bet: string; amount: number } | { type: 'clear' } | { type: 'ready' };
