import type { GutFeeling } from '@casino/shared';

/** What a table can ask of the casino around it. */
export interface TableContext {
  /** Current balance of an online player (0 if they are offline). */
  getChips(playerId: number): number;
  /** Add (or with a negative number, take) chips. Works for offline players too. */
  addChips(playerId: number, delta: number): void;
  /** Tell everyone the table changed (and each player their own secrets). */
  changed(): void;
  /**
   * Call once per player when a hand (or a whole game) they had chips on is over and paid.
   * The casino counts it toward their run and collects the ante when it is due.
   */
  handFinished(playerId: number): void;
  /** This player dies, right here at the table. Take their chips first if they are to go somewhere. */
  kill(playerId: number, cause: string): void;
}

export interface TablePlayer {
  id: number;
  name: string;
}

/**
 * Every casino game implements this. The casino knows nothing about the rules of
 * any game: it only seats players and passes their actions along.
 * Methods that can fail return an error message for the player, or null on success.
 */
export interface GameTable {
  readonly stationId: string;
  readonly type: string;
  sit(player: TablePlayer, seat: number): string | null;
  leave(playerId: number): void;
  action(playerId: number, action: unknown): string | null;
  /** True while the player has chips riding on an unfinished round. */
  hasStake(playerId: number): boolean;
  /** Where this player's chair is in the room (so security knows where to collect them). */
  seatPose(playerId: number): { x: number; z: number; yaw: number } | null;
  /** Safe to send to every browser: never includes hidden cards or dice. */
  publicState(): unknown;
  /** What only this player may see (their hole cards, their dice). undefined = nothing. */
  secretState?(playerId: number): unknown;
  /**
   * For a patron (the house's regulars) sitting here: the action they would take right now,
   * or null if there is nothing for them to do. The casino adds the thinking time.
   */
  botMove(playerId: number): unknown | null;
  /**
   * What a hunch would tell this player right now, from what the table knows and they do
   * not: the next card, where the ball will land, whether a bid is a lie. Null if nothing.
   */
  gutFeeling?(playerId: number): GutFeeling | null;
  /**
   * Third Eye: everything hidden at this table that the player could see if they could see
   * through things (the hole card, the next card, other hands, the dice). Null if nothing.
   */
  peek?(playerId: number): string | null;
  dispose(): void;
}

export type TableFactory = (stationId: string, ctx: TableContext) => GameTable;
