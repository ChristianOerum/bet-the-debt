// The roguelike part. A "run" is one life: you walk in with a small stack, and every few
// hands the house collects an ante that keeps growing. Fall to nothing and you get shot.

/** Working title. Change it here and every sign, screen and tab title follows. */
export const GAME_NAME = 'Bet the Debt';

export const RUN = {
  /** The house fronts you this much when you walk in, and takes it back when you cash out. */
  startChips: 500,
  /** Lobby size: one apartment each in the building. */
  maxLobby: 8,
  /** Hands you play before the house collects. */
  handsPerRound: 3,
  firstAnte: 50,
  /** Each round's ante is this many times the last one. */
  anteGrowth: 1.5,
  /** Below the table minimum you cannot play on, so that counts as broke. */
  brokeBelow: 10,
  /** Time to read the result before security comes for you. The rest is in ESCORT. */
  shotDelayMs: 2200,
  /** Shot at the table: how long you lie there before walking back in. */
  tableDeathMs: 5200,
} as const;

/**
 * How hard the house squeezes. Chosen once per lobby at the casino doors. Hard is the
 * original game; the easier ones give you more hands per round and a gentler climb.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export interface DifficultyRules {
  label: string;
  /** Hands you play before the house collects. */
  handsPerRound: number;
  firstAnte: number;
  /** Each round's ante is this many times the last one. */
  anteGrowth: number;
  /**
   * Rounds added to a run's round on the leaderboard, so runs at different levels compare
   * fairly: your starting stack lasts about this many rounds less than on Easy.
   */
  handicap: number;
  blurb: string;
}
export const DIFFICULTIES: Record<Difficulty, DifficultyRules> = {
  easy: { label: 'Easy', handsPerRound: 5, firstAnte: 20, anteGrowth: 1.25, handicap: 0, blurb: 'Five hands a round, small antes that grow slowly. Time to learn the games.' },
  normal: { label: 'Normal', handsPerRound: 4, firstAnte: 30, anteGrowth: 1.35, handicap: 2, blurb: 'Four hands a round. The house is patient, but not forever.' },
  hard: { label: 'Hard', handsPerRound: RUN.handsPerRound, firstAnte: RUN.firstAnte, anteGrowth: RUN.anteGrowth, handicap: 4, blurb: 'Three hands a round, and the ante grows by half each time. Win, or else.' },
};
export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
export const isDifficulty = (d: unknown): d is Difficulty => typeof d === 'string' && d in DIFFICULTIES;

/** What the house takes at the end of a round. On Hard: 50, 80, 110, 170, 250, 380, 570, 850 ... */
export function anteFor(round: number, d: Difficulty = 'hard'): number {
  const r = DIFFICULTIES[d];
  // Round to a chip you could actually pay with: tens on Hard, fives for the smaller antes.
  const step = r.firstAnte < RUN.firstAnte ? 5 : 10;
  return Math.round((r.firstAnte * Math.pow(r.anteGrowth, round - 1)) / step) * step;
}

/** How a run ranks on the leaderboard: the round reached, plus the level's handicap. */
export function runScore(round: number, d: Difficulty): number {
  return round + DIFFICULTIES[d].handicap;
}
export interface RunProgress {
  chips: number;
  round: number;
  /** Hands already played in this round. */
  hands: number;
}

export interface RunStep extends RunProgress {
  /** Ante taken just now (0 if the round is not over yet). */
  charged: number;
  dead: boolean;
  /** The round this hand was played in; for the dead, how far they got. */
  reached: number;
}

/**
 * Call once each time a player finishes a hand, with their balance after the payout.
 * Counts the hand, collects the ante if the round is over, and says whether they survive.
 * `chips` can come back negative: that is the debt they could not cover.
 */
export function advanceRun(s: RunProgress, d: Difficulty = 'hard'): RunStep {
  const reached = s.round;
  let { chips, round } = s;
  let hands = s.hands + 1;
  let charged = 0;
  if (hands >= DIFFICULTIES[d].handsPerRound) {
    charged = anteFor(round, d);
    chips -= charged;
    round += 1;
    hands = 0;
  }
  return { chips, round, hands, charged, dead: chips < RUN.brokeBelow, reached };
}

/** Cash you take home for cashing out `chips`: whatever is left after paying back the house's stake. */
export function cashFor(chips: number): number {
  return Math.max(0, chips - RUN.startChips);
}

/** What a player's screen needs to show about their run. */
export interface RunState {
  round: number;
  handsLeft: number;
  /** The ante due when those hands are played. */
  ante: number;
  /** This account's best run ever: the round, and at what level. */
  best: number;
  bestLevel: Difficulty;
  difficulty: Difficulty;
}

export function runState(round: number, hands: number, best: number, d: Difficulty = 'hard', bestLevel: Difficulty = 'hard'): RunState {
  return { round, handsLeft: DIFFICULTIES[d].handsPerRound - hands, ante: anteFor(round, d), best, bestLevel, difficulty: d };
}
