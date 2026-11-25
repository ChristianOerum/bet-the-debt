import type { GameViewFactory } from './GameView';
import { BaccaratView } from './baccarat/BaccaratView';
import { BlackjackView } from './blackjack/BlackjackView';
import { LiarsView } from './dice/LiarsView';
import { MeyerView } from './dice/MeyerView';
import { RussianView } from './dice/RussianView';
import { PokerView } from './poker/PokerView';
import { RouletteView } from './roulette/RouletteView';

/** Station type (see shared/src/world.ts) -> the class that draws it. Add new games here. */
export const VIEW_TYPES: Record<string, GameViewFactory> = {
  blackjack: (station, ctx) => new BlackjackView(station, ctx),
  roulette: (station, ctx) => new RouletteView(station, ctx),
  baccarat: (station, ctx) => new BaccaratView(station, ctx),
  poker: (station, ctx) => new PokerView(station, ctx),
  russian: (station, ctx) => new RussianView(station, ctx),
  liars: (station, ctx) => new LiarsView(station, ctx),
  meyer: (station, ctx) => new MeyerView(station, ctx),
};
