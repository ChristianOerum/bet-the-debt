import type { TableFactory } from './GameTable';
import { BaccaratTable } from './baccarat/BaccaratTable';
import { BlackjackTable } from './blackjack/BlackjackTable';
import { LiarsTable } from './dice/LiarsTable';
import { MeyerTable } from './dice/MeyerTable';
import { RussianTable } from './dice/RussianTable';
import { PokerTable } from './poker/PokerTable';
import { RouletteTable } from './roulette/RouletteTable';

/** Station type (see shared/src/world.ts) -> the class that runs it. Add new games here. */
export const TABLE_TYPES: Record<string, TableFactory> = {
  blackjack: (stationId, ctx) => new BlackjackTable(stationId, ctx),
  roulette: (stationId, ctx) => new RouletteTable(stationId, ctx),
  baccarat: (stationId, ctx) => new BaccaratTable(stationId, ctx),
  poker: (stationId, ctx) => new PokerTable(stationId, ctx),
  russian: (stationId, ctx) => new RussianTable(stationId, ctx),
  liars: (stationId, ctx) => new LiarsTable(stationId, ctx),
  meyer: (stationId, ctx) => new MeyerTable(stationId, ctx),
};
