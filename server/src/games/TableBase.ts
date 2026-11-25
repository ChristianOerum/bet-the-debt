import { SHAPES, STATIONS, seatWorld } from '@casino/shared';
import type { GameTable, TableContext, TablePlayer } from './GameTable';

export interface BaseSeat {
  playerId: number;
  name: string;
  /** Walked away mid-round; the seat frees up when the round ends. */
  gone: boolean;
}

/**
 * The parts every table shares: seats, one countdown timer, and finding where a player sits.
 * A game fills in what happens on sit, leave and each action.
 */
export abstract class TableBase<S extends BaseSeat> implements GameTable {
  abstract readonly type: string;
  protected seats: (S | null)[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the visible countdown runs out, or null if none is showing. */
  protected deadline: number | null = null;
  /** Length of that countdown, so browsers can draw how much is left. */
  protected timerMs = 1;

  constructor(
    readonly stationId: string,
    protected ctx: TableContext,
  ) {
    const station = STATIONS.find((s) => s.id === stationId)!;
    this.seats = Array.from({ length: SHAPES[station.type].seats.length }, () => null);
  }

  protected abstract newSeat(player: TablePlayer): S;
  /** Someone sat down at seat i. */
  protected onSit(_i: number): void {}
  /** Someone at seat i got up (or disconnected). Their seat is still filled; decide what to do. */
  protected abstract onLeave(i: number): void;
  abstract action(playerId: number, action: unknown): string | null;
  abstract hasStake(playerId: number): boolean;
  abstract publicState(): unknown;
  abstract botMove(playerId: number): unknown | null;

  /** Is anyone who is not a patron sitting here? */
  protected hasHuman(pred: (s: S) => boolean = () => true): boolean {
    return this.seats.some((s) => !!s && !s.gone && s.playerId > 0 && pred(s));
  }

  sit(player: TablePlayer, seat: number): string | null {
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seats.length) return 'No such seat.';
    if (this.seats[seat]) return 'That seat is taken.';
    if (this.seats.some((s) => s?.playerId === player.id)) return 'Wait for your last game to finish.';
    this.seats[seat] = this.newSeat(player);
    this.onSit(seat);
    this.ctx.changed();
    return null;
  }

  leave(playerId: number): void {
    const i = this.seatOf(playerId);
    if (i >= 0) this.onLeave(i);
  }

  seatPose(playerId: number) {
    const i = this.seatOf(playerId);
    const station = STATIONS.find((s) => s.id === this.stationId);
    return i >= 0 && station ? seatWorld(station, i) : null;
  }

  /** Seat index of a player who is still here, or -1. */
  protected seatOf(playerId: number): number {
    return this.seats.findIndex((s) => s?.playerId === playerId && !s.gone);
  }

  /** Free the seats of everyone who walked away. */
  protected clearGone() {
    this.seats = this.seats.map((s) => (s && !s.gone ? s : null));
  }

  /** Seats, in order, starting after `from` and going round to `from` itself last. */
  protected around(from: number): number[] {
    const n = this.seats.length;
    return Array.from({ length: n }, (_, k) => (from + 1 + k) % n);
  }

  protected setTimer(ms: number, fn: () => void, visible = true) {
    this.clearTimer();
    this.deadline = visible ? Date.now() + ms : null;
    this.timerMs = ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = null;
      fn();
    }, ms);
  }

  protected clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  protected get timerRunning() {
    return this.timer !== null;
  }

  protected timeLeft(): number | null {
    return this.deadline === null ? null : Math.max(0, this.deadline - Date.now());
  }

  /** Seats for the browser: a copy, so nobody edits ours. */
  protected publicSeats<T>(map: (s: S) => T): (T | null)[] {
    return this.seats.map((s) => (s ? map(s) : null));
  }

  dispose() {
    this.clearTimer();
  }
}
