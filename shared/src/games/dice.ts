// The three player-versus-player games that are not cards: Liar's Dice, Meyer and
// Russian roulette. Everyone pays in (or bets their life), last one standing wins.

export const rollDie = (rng: () => number = Math.random) => 1 + Math.floor(rng() * 6);

// ---- Liar's Dice ------------------------------------------------------------------

export const LD = {
  dice: 5,
  stake: 100,
  turnTimeMs: 30_000,
  revealMs: 6_000,
  overMs: 6_000,
} as const;

export interface Bid {
  quantity: number;
  face: number;
  seat: number;
}

/**
 * A bid says "at least `quantity` dice on the table show `face`". Ones are wild, so you
 * cannot bid on ones. Each bid must beat the last: more dice, or the same number of a higher face.
 */
export function validBid(prev: Bid | null, quantity: number, face: number, totalDice: number): boolean {
  if (!Number.isInteger(quantity) || !Number.isInteger(face)) return false;
  if (face < 2 || face > 6 || quantity < 1 || quantity > totalDice) return false;
  if (!prev) return true;
  return quantity > prev.quantity || (quantity === prev.quantity && face > prev.face);
}

/** How many dice show `face`, counting ones as wild. */
export function countFace(dice: number[][], face: number): number {
  return dice.flat().filter((d) => d === face || d === 1).length;
}

/** The smallest bid that beats `prev`. */
export function nextBid(prev: Bid | null): { quantity: number; face: number } {
  if (!prev) return { quantity: 1, face: 2 };
  return prev.face < 6 ? { quantity: prev.quantity, face: prev.face + 1 } : { quantity: prev.quantity + 1, face: 2 };
}

export interface LiarsSeat {
  playerId: number;
  name: string;
  ready: boolean;
  inGame: boolean;
  /** Dice they still have. */
  count: number;
  gone: boolean;
}

export interface LiarsState {
  type: 'liars';
  phase: 'waiting' | 'bidding' | 'reveal' | 'over';
  seats: (LiarsSeat | null)[];
  turn: number | null;
  bid: Bid | null;
  pot: number;
  totalDice: number;
  /** After someone calls "Liar!": everyone's dice, and who lost one. */
  reveal: { dice: (number[] | null)[]; bid: Bid; count: number; challenger: number; loser: number } | null;
  winner: number | null;
  timeLeftMs: number | null;
  timerMs: number;
}

export type LiarsAction = { type: 'ready' } | { type: 'unready' } | { type: 'bid'; quantity: number; face: number } | { type: 'liar' };

// ---- Meyer -----------------------------------------------------------------------

export const MY = {
  lives: 3,
  stake: 100,
  turnTimeMs: 25_000,
  revealMs: 5_500,
  overMs: 6_000,
} as const;

/** Every throw, worst to best. 21 is Meyer, 31 is Little Meyer, then the pairs. */
export const MEYER_ORDER = [32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65, 11, 22, 33, 44, 55, 66, 31, 21];

/** Two dice as a Meyer throw: the higher die first (so 3 and 5 is 53), except Meyer (2-1) and Little Meyer (3-1). */
export function meyerValue(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === 2 && lo === 1) return 21;
  if (hi === 3 && lo === 1) return 31;
  return hi * 10 + lo;
}

export const meyerRank = (v: number) => MEYER_ORDER.indexOf(v);

export function meyerName(v: number): string {
  if (v === 21) return 'Meyer!';
  if (v === 31) return 'Little Meyer';
  if (Math.floor(v / 10) === v % 10) return `Pair of ${v % 10}s`;
  return String(v);
}

/** Can `value` be announced after `prev`? It must be better; only Meyer may be matched by Meyer. */
export function canAnnounce(prev: number | null, value: number): boolean {
  if (meyerRank(value) < 0) return false;
  if (prev === null) return true;
  return meyerRank(value) > meyerRank(prev) || (prev === 21 && value === 21);
}

export interface MeyerSeat {
  playerId: number;
  name: string;
  ready: boolean;
  inGame: boolean;
  lives: number;
  gone: boolean;
}

export interface MeyerState {
  type: 'meyer';
  /** rolling: the player on turn must roll. announcing: they rolled and must say what. deciding: believe it or call it. */
  phase: 'waiting' | 'rolling' | 'announcing' | 'deciding' | 'reveal' | 'over';
  seats: (MeyerSeat | null)[];
  turn: number | null;
  announced: { value: number; seat: number } | null;
  pot: number;
  reveal: { dice: [number, number]; announced: number; truthful: boolean; caller: number; loser: number; lost: number } | null;
  winner: number | null;
  timeLeftMs: number | null;
  timerMs: number;
}

/** Only the player who just rolled sees this. */
export interface MeyerSecret {
  dice: [number, number] | null;
}

export type MeyerAction =
  | { type: 'ready' }
  | { type: 'unready' }
  | { type: 'roll' }
  | { type: 'announce'; value: number }
  | { type: 'believe' }
  | { type: 'lie' };

// ---- Russian roulette --------------------------------------------------------------

export const RR = {
  chambers: 6,
  turnTimeMs: 15_000,
  startDelayMs: 4_000,
  resultMs: 6_000,
} as const;

export interface RussianSeat {
  playerId: number;
  name: string;
  ready: boolean;
  inGame: boolean;
  gone: boolean;
}

export interface RussianState {
  type: 'russian';
  phase: 'waiting' | 'starting' | 'playing' | 'result';
  seats: (RussianSeat | null)[];
  turn: number | null;
  /** How many times the trigger has been pulled this game. */
  pulls: number;
  /** The last pull, so every browser can play the click (or not). */
  lastPull: { seat: number; bang: boolean; n: number } | null;
  result: { victim: string; stack: number; share: number; survivors: number } | null;
  timeLeftMs: number | null;
  timerMs: number;
}

export type RussianAction = { type: 'ready' } | { type: 'unready' } | { type: 'pull' };
