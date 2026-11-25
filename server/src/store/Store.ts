import type { BankEntry, Difficulty, LeaderboardEntry } from '@casino/shared';

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  color: string;
  /** Money you keep between runs: what you have cashed out over the house's stake. */
  cash: number;
  /** How nice your apartment is. Everyone starts at 1. */
  aptLevel: number;
  /** Their best run ever (by leaderboard score): the round it reached, and at what level. */
  bestRound: number;
  bestLevel: Difficulty;
  /** The clothes they have on (shop item ids). */
  outfit: string[];
}

/**
 * Everything the game remembers between visits. Runs themselves are not saved: a run
 * that is not cashed out is lost. Async on purpose: today it is a local SQLite file,
 * later it can be a hosted database without changing any game code.
 */
export interface Store {
  /** Returns null when the username is already taken. */
  createUser(username: string, passwordHash: string, color: string): Promise<UserRecord | null>;
  getUserByName(username: string): Promise<UserRecord | null>;
  getUserById(id: number): Promise<UserRecord | null>;
  setColor(id: number, color: string): Promise<void>;
  /** Change someone's cash, and write it on their bank statement with `note`. */
  addCash(id: number, delta: number, note: string): Promise<void>;
  /** The latest lines of someone's bank statement, newest first. */
  bankHistory(id: number, limit: number): Promise<BankEntry[]>;
  /** Record a run, if it beats their best (round plus the level's handicap). */
  setBest(id: number, bestRound: number, level?: Difficulty): Promise<void>;
  setAptLevel(id: number, level: number): Promise<void>;
  /** Everything someone has bought from the shop (item ids). */
  ownedItems(id: number): Promise<string[]>;
  /** Someone picked one up (off a body): it is theirs now. */
  addOwned(id: number, itemId: string): Promise<void>;
  /** Someone lost it (died with it on them). */
  removeOwned(id: number, itemId: string): Promise<void>;
  /**
   * Pay `price` from someone's cash and give them the item, both or neither, with a line on
   * their bank statement. False (and nothing changes) if they cannot afford it.
   * `aptLevel`, if given, moves them into a bigger flat as part of the same purchase.
   */
  buy(id: number, itemId: string, price: number, note: string, aptLevel?: number): Promise<boolean>;
  setOutfit(id: number, items: string[]): Promise<void>;
  createSession(tokenHash: string, userId: number): Promise<void>;
  getSessionUser(tokenHash: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  leaderboard(limit: number): Promise<LeaderboardEntry[]>;
}
