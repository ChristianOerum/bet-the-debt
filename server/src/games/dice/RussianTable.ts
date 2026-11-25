import { RR, type GutFeeling, type RussianAction, type RussianSeat, type RussianState } from '@casino/shared';
import type { TablePlayer } from '../GameTable';
import { TableBase } from '../TableBase';

/**
 * Russian roulette, in the back room. Everyone who says they are in takes turns with
 * a six-shooter holding one bullet. Whoever finds it dies, and the others split
 * everything they were carrying.
 */
export class RussianTable extends TableBase<RussianSeat> {
  readonly type = 'russian';
  private phase: RussianState['phase'] = 'waiting';
  private turn: number | null = null;
  private bullet = 0;
  private chamber = 0;
  private pulls = 0;
  private pullCount = 0;
  private lastPull: RussianState['lastPull'] = null;
  private result: RussianState['result'] = null;
  /** Tests only: which pull fires. */
  rigBullet: number | null = null;

  protected newSeat(p: TablePlayer): RussianSeat {
    return { playerId: p.id, name: p.name, ready: false, inGame: false, gone: false };
  }

  protected onLeave(i: number) {
    const s = this.seats[i]!;
    if (this.phase === 'playing' && s.inGame) {
      // Walking out of a game of Russian roulette: you are out (and lucky).
      this.seats[i] = null;
      const left = this.players();
      if (left.length < 2) {
        this.endGame();
        return;
      }
      if (this.turn === i) this.passGun(i);
      else this.ctx.changed();
      return;
    }
    this.seats[i] = null;
    this.checkStart();
    this.ctx.changed();
  }

  hasStake(playerId: number) {
    const i = this.seatOf(playerId);
    return i >= 0 && this.phase === 'playing' && this.seats[i]!.inGame;
  }

  private players() {
    return this.seats.map((s, i) => ({ s, i })).filter((x): x is { s: RussianSeat; i: number } => !!x.s && x.s.inGame && !x.s.gone);
  }

  action(playerId: number, raw: unknown): string | null {
    const i = this.seatOf(playerId);
    if (i < 0) return 'You are not sitting at this table.';
    const a = raw as RussianAction;
    if (!a || typeof a !== 'object') return 'Unknown action.';
    const s = this.seats[i]!;
    switch (a.type) {
      case 'ready':
      case 'unready':
        if (this.phase !== 'waiting' && this.phase !== 'starting') return 'A game is already going.';
        s.ready = a.type === 'ready';
        this.checkStart();
        this.ctx.changed();
        return null;
      case 'pull':
        if (this.phase !== 'playing' || this.turn !== i) return 'It is not your turn.';
        this.pull(i);
        return null;
      default:
        return 'Unknown action.';
    }
  }

  /** Starts a short countdown once two or more are in and nobody seated is holding back. */
  private checkStart() {
    if (this.phase !== 'waiting' && this.phase !== 'starting') return;
    const seated = this.seats.filter((s): s is RussianSeat => !!s && !s.gone);
    const ready = seated.filter((s) => s.ready);
    if (ready.length >= 2 && ready.length === seated.length) {
      if (this.phase !== 'starting') {
        this.phase = 'starting';
        this.setTimer(RR.startDelayMs, () => this.start());
      }
    } else if (this.phase === 'starting') {
      this.phase = 'waiting';
      this.clearTimer();
    }
  }

  private start() {
    const ready = this.seats.map((s, i) => ({ s, i })).filter((x) => x.s?.ready && !x.s.gone);
    if (ready.length < 2) {
      this.phase = 'waiting';
      this.ctx.changed();
      return;
    }
    for (const s of this.seats) if (s) s.inGame = !!s.ready && !s.gone;
    this.bullet = this.rigBullet ?? Math.floor(Math.random() * RR.chambers);
    this.rigBullet = null;
    this.chamber = 0;
    this.pulls = 0;
    this.result = null;
    this.lastPull = null;
    this.phase = 'playing';
    this.giveGun(ready[Math.floor(Math.random() * ready.length)].i);
  }

  /** Tests only: who goes first. */
  forceTurn(i: number) {
    this.giveGun(i);
  }

  private giveGun(i: number) {
    this.turn = i;
    // Too slow, and the gun goes off in your hand all the same.
    this.setTimer(RR.turnTimeMs, () => this.pull(i));
    this.ctx.changed();
  }

  private passGun(from: number) {
    const next = this.around(from).find((k) => this.players().some((p) => p.i === k));
    if (next === undefined) {
      this.endGame();
      return;
    }
    this.giveGun(next);
  }

  private pull(i: number) {
    this.clearTimer();
    const s = this.seats[i]!;
    const bang = this.chamber === this.bullet;
    this.chamber++;
    this.pulls++;
    this.lastPull = { seat: i, bang, n: ++this.pullCount };
    if (!bang) {
      this.passGun(i);
      return;
    }
    // Their whole stack is split between the survivors.
    const survivors = this.players().filter((p) => p.i !== i);
    const stack = this.ctx.getChips(s.playerId);
    if (stack > 0) this.ctx.addChips(s.playerId, -stack);
    const share = survivors.length ? Math.floor(stack / survivors.length) : 0;
    survivors.forEach((p, k) => this.ctx.addChips(p.s.playerId, share + (k === 0 ? stack - share * survivors.length : 0)));
    this.result = { victim: s.name, stack, share, survivors: survivors.length };
    this.turn = null;
    this.phase = 'result';
    s.inGame = false;
    this.setTimer(RR.resultMs, () => this.endGame(), false);
    this.ctx.changed();
    this.ctx.kill(s.playerId, 'russian'); // this also gets them up from the table
  }

  private endGame() {
    this.clearTimer();
    const played = this.players().map((p) => p.s.playerId);
    this.clearGone();
    for (const s of this.seats) {
      if (!s) continue;
      s.ready = false;
      s.inGame = false;
    }
    this.turn = null;
    this.phase = 'waiting';
    this.ctx.changed();
    for (const id of played) this.ctx.handFinished(id);
  }

  /** Patrons only play this if a real person is in too; then they keep their nerve. */
  botMove(playerId: number): RussianAction | null {
    const i = this.seatOf(playerId);
    if (i < 0) return null;
    const s = this.seats[i]!;
    if ((this.phase === 'waiting' || this.phase === 'starting') && !s.ready) return this.hasHuman((o) => o.ready) ? { type: 'ready' } : null;
    if (this.phase === 'playing' && this.turn === i) return { type: 'pull' };
    return null;
  }

  /** The gun in your hand: is this the one? (Walking away from the table is always allowed.) */
  gutFeeling(playerId: number): GutFeeling | null {
    const i = this.seatOf(playerId);
    if (i < 0 || this.phase !== 'playing' || this.turn !== i) return null;
    const bang = this.chamber === this.bullet;
    const run = 'Something is very, very wrong. Get up from this table. Now.';
    const fine = "It's fine. This one's empty. Pull it.";
    return { key: `rr:${this.pullCount}`, right: bang ? run : fine, wrong: bang ? fine : run, pick: bang ? '[data-act="leave"]' : '[data-act="pull"]' };
  }

  peek(playerId: number): string | null {
    if (this.seatOf(playerId) < 0 || this.phase !== 'playing') return null;
    return this.chamber === this.bullet ? 'You can see the bullet. It is in the chamber. Right now.' : 'You can see right into the gun: this chamber is empty.';
  }

  publicState(): RussianState {
    return {
      type: 'russian',
      phase: this.phase,
      seats: this.publicSeats((s) => ({ ...s })),
      turn: this.turn,
      pulls: this.pulls,
      lastPull: this.lastPull ? { ...this.lastPull } : null,
      result: this.result ? { ...this.result } : null,
      timeLeftMs: this.timeLeft(),
      timerMs: this.timerMs,
    };
  }
}
