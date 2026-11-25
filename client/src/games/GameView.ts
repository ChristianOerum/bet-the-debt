import type * as THREE from 'three';
import type { Station } from '@casino/shared';
import type { Pose } from '../world/avatars';

/** What a game's 3D view can ask of the app around it. */
export interface GameViewContext {
  myId: number;
  getChips(): number;
  /** Send a game action to the server (the server decides if it is allowed). */
  send(action: unknown): void;
  /** Get up from the table. */
  leave(): void;
  /** Where the game puts its on-screen buttons. */
  hudRoot: HTMLElement;
}

export interface SeatSpot extends Pose {
  index: number;
  occupied: boolean;
}

/**
 * Every casino game draws itself through this. The app knows nothing about the
 * game's rules: it only passes along the server's state and asks where the seats are.
 */
export interface GameView {
  readonly station: Station;
  /** Add this to the scene. */
  readonly group: THREE.Group;
  setState(state: unknown): void;
  /** What only you may see at this table (your hole cards, your dice). */
  setSecret?(secret: unknown): void;
  /** Called when your chip balance changes, so buttons can enable or disable. */
  refresh(): void;
  update(dt: number, time: number): void;
  seats(): SeatSpot[];
  /** Who is sitting, and where to draw them. */
  seatedPlayers(): Map<number, Pose>;
  /** Your seat number here, or -1. */
  mySeat(): number;
  /** Where your eyes are when sitting in a seat, and what you look at. */
  cameraPose(seat: number): { pos: THREE.Vector3; look: THREE.Vector3 };
  highlightSeat(seat: number | null): void;
  dispose(): void;
}

export type GameViewFactory = (station: Station, ctx: GameViewContext) => GameView;
