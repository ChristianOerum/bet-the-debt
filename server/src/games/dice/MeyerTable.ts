import { canAnnounce, MEYER_ORDER, meyerAnnounce, meyerDoubt, meyerRank, meyerValue, MY, rollDie, type GutFeeling, type MeyerAction, type MeyerSeat, type MeyerState } from '@casino/shared';
import type { TablePlayer } from '../GameTable';
import { TableBase } from '../TableBase';

/**
 * Meyer. Roll two dice in secret, say what you rolled (or lie), and pass the cup on.
 * The next player believes you and has to beat it, or calls your bluff. Whoever is
 * wrong loses a life (two, for doubting a true Meyer). Last one alive takes the pot.
 */
export class MeyerTable extends TableBase<MeyerSeat> {
  readonly type = 'meyer';
  private phase: MeyerState['phase'] = 'waiting';
  private turn: number | null = null;
  private announced: MeyerState['announced'] = null;
  /** The real throw behind the last announcement. Never sent to anyone until it is revealed. */
  private hidden: { dice: [number, number]; seat: number } | null = null;
  /** The throw the player on turn has just made and not announced yet. */
  private rolled: [number, number] | null = null;
  private pot = 0;
  private reveal: MeyerState['reveal'] = null;
  private winner: number | null = null;
  /** Tests only: the next throws. */
  rig: [number, number][] = [];

  protected newSeat(p: TablePlayer): MeyerSeat {
    return { playerId: p.id, name: p.name, ready: false, inGame: false, lives: 0, gone: false };
  }

  protected onLeave(i: number) {
    const s = this.seats[i]!;
    if (s.inGame && this.phase !== 'waiting' && this.phase !== 'over') {
      s.gone = true;
      s.lives = 0;
      if (this.alive().length <= 1) {
        this.win();
        return;
      }
      if (this.turn === i) this.newRound(i);
      else this.ctx.changed();
      return;
    }
    this.seats[i] = null;
    this.checkStart();
    this.ctx.changed();
  }

  hasStake(playerId: number) {
    const i = this.seatOf(playerId);
    return i >= 0 && this.seats[i]!.inGame && this.phase !== 'waiting';
  }

  private alive() {
    return this.seats.map((s, i) => ({ s, i })).filter((x): x is { s: MeyerSeat; i: number } => !!x.s && x.s.inGame && x.s.lives > 0 && !x.s.gone);
  }

  private nextAlive(from: number): number | null {
    return this.around(from).find((k) => this.alive().some((a) => a.i === k)) ?? null;
  }

  action(playerId: number, raw: unknown): string | null {
    const i = this.seatOf(playerId);
    if (i < 0) return 'You are not sitting at this table.';
    const a = raw as MeyerAction;
    if (!a || typeof a !== 'object') return 'Unknown action.';
    const s = this.seats[i]!;
    if (a.type === 'ready' || a.type === 'unready') {
      if (this.phase !== 'waiting') return 'A game is already going.';
      if (a.type === 'ready' && this.ctx.getChips(playerId) < MY.stake) return `You need ${MY.stake} chips to play.`;
      s.ready = a.type === 'ready';
      this.checkStart();
      this.ctx.changed();
      return null;
    }
    if (this.turn !== i) return 'It is not your turn.';
    switch (a.type) {
      case 'roll':
        if (this.phase !== 'rolling') return 'Not now.';
        this.roll();
        return null;
      case 'announce':
        if (this.phase !== 'announcing') return 'Roll first.';
        if (!canAnnounce(this.announced?.value ?? null, a.value)) return 'You have to beat the last call.';
        this.announce(a.value);
        return null;
      case 'believe':
        if (this.phase !== 'deciding') return 'Not now.';
        this.phase = 'rolling';
        this.startTurnTimer();
        this.ctx.changed();
        return null;
      case 'lie':
        if (this.phase !== 'deciding') return 'Not now.';
        this.callLie(i);
        return null;
      default:
        return 'Unknown action.';
    }
  }

  private checkStart() {
    if (this.phase !== 'waiting') return;
    const seated = this.seats.map((s, i) => ({ s, i })).filter((x): x is { s: MeyerSeat; i: number } => !!x.s && !x.s.gone);
    if (seated.length < 2 || !seated.every((x) => x.s.ready)) return;
    const players = seated.filter((x) => this.ctx.getChips(x.s.playerId) >= MY.stake);
    if (players.length < 2) return;
    this.pot = 0;
    for (const { s } of players) {
      this.ctx.addChips(s.playerId, -MY.stake);
      this.pot += MY.stake;
      s.inGame = true;
      s.lives = MY.lives;
    }
    this.winner = null;
    this.newRound(players[Math.floor(Math.random() * players.length)].i, true);
  }

  /** A fresh round: nothing announced, `starter` (or the next one alive) rolls first. */
  private newRound(starter: number, exact = false) {
    this.announced = null;
    this.hidden = null;
    this.rolled = null;
    this.reveal = null;
    const alive = this.alive();
    this.turn = exact || alive.some((a) => a.i === starter) ? starter : this.nextAlive(starter);
    if (this.turn === null || alive.length <= 1) {
      this.win();
      return;
    }
    this.phase = 'rolling';
    this.startTurnTimer();
    this.ctx.changed();
  }

  /** Tests only: hand the cup to someone. */
  forceTurn(i: number) {
    this.newRound(i, true);
  }

  private startTurnTimer() {
    this.setTimer(MY.turnTimeMs, () => {
      // Too slow: the house plays for you, honestly where it can.
      if (this.phase === 'rolling') this.roll();
      if (this.phase === 'announcing') {
        const truth = meyerValue(...this.rolled!);
        const prev = this.announced?.value ?? null;
        const value = canAnnounce(prev, truth) ? truth : MEYER_ORDER.find((v) => canAnnounce(prev, v))!;
        this.announce(value);
      } else if (this.phase === 'deciding') {
        this.phase = 'rolling';
        this.roll();
      }
    });
  }

  private roll() {
    this.rolled = this.rig.shift() ?? [rollDie(), rollDie()];
    this.phase = 'announcing';
    this.startTurnTimer();
    this.ctx.changed();
  }

  private announce(value: number) {
    this.announced = { value, seat: this.turn! };
    this.hidden = { dice: this.rolled!, seat: this.turn! };
    this.rolled = null;
    this.turn = this.nextAlive(this.turn!);
    this.phase = 'deciding';
    this.startTurnTimer();
    this.ctx.changed();
  }

  private callLie(caller: number) {
    this.clearTimer();
    const said = this.announced!;
    const truthValue = meyerValue(...this.hidden!.dice);
    // The truth is anything at least as good as what was said.
    const truthful = meyerRank(truthValue) >= meyerRank(said.value);
    const loser = truthful ? caller : said.seat;
    const lost = truthful && said.value === 21 ? 2 : 1;
    const ls = this.seats[loser];
    if (ls) ls.lives = Math.max(0, ls.lives - lost);
    this.reveal = { dice: this.hidden!.dice, announced: said.value, truthful, caller, loser, lost };
    this.phase = 'reveal';
    this.turn = null;
    this.setTimer(MY.revealMs, () => {
      if (this.alive().length <= 1) this.win();
      else this.newRound(loser);
    }, false);
    this.ctx.changed();
  }

  private win() {
    this.clearTimer();
    const w = this.alive()[0];
    if (w) {
      this.ctx.addChips(w.s.playerId, this.pot);
      this.winner = w.i;
    }
    this.pot = 0;
    this.phase = 'over';
    this.turn = null;
    this.setTimer(MY.overMs, () => this.endGame(), false);
    this.ctx.changed();
  }

  private endGame() {
    const played = this.seats.filter((s): s is MeyerSeat => !!s && s.inGame).map((s) => s.playerId);
    this.clearGone();
    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, { ready: false, inGame: false, lives: 0 });
    }
    this.phase = 'waiting';
    this.announced = null;
    this.reveal = null;
    this.winner = null;
    this.ctx.changed();
    for (const id of played) this.ctx.handFinished(id);
  }

  botMove(playerId: number): MeyerAction | null {
    const i = this.seatOf(playerId);
    if (i < 0) return null;
    const s = this.seats[i]!;
    if (this.phase === 'waiting') return !s.ready && this.ctx.getChips(playerId) >= MY.stake ? { type: 'ready' } : null;
    if (this.turn !== i) return null;
    if (this.phase === 'rolling') return { type: 'roll' };
    if (this.phase === 'announcing' && this.rolled) return { type: 'announce', value: meyerAnnounce(this.rolled, this.announced?.value ?? null) };
    if (this.phase === 'deciding' && this.announced) return meyerDoubt(this.announced.value) ? { type: 'lie' } : { type: 'believe' };
    return null;
  }

  /** Deciding whether to believe the last call: is it true? */
  gutFeeling(playerId: number): GutFeeling | null {
    const i = this.seatOf(playerId);
    if (i < 0 || this.phase !== 'deciding' || this.turn !== i || !this.announced || !this.hidden) return null;
    const truthful = meyerRank(meyerValue(...this.hidden.dice)) >= meyerRank(this.announced.value);
    const yes = "They're telling the truth. Believe them.";
    const no = "They're lying through their teeth.";
    return { key: `my:${this.announced.value}:${this.announced.seat}:${i}`, right: truthful ? yes : no, wrong: truthful ? no : yes, pick: truthful ? '[data-act="believe"]' : '[data-act="lie"]' };
  }

  peek(playerId: number): string | null {
    const i = this.seatOf(playerId);
    if (i < 0 || !this.hidden || this.hidden.seat === i) return null;
    const who = this.seats[this.hidden.seat]?.name ?? 'They';
    return `${who} really rolled ${this.hidden.dice[0]} and ${this.hidden.dice[1]}.`;
  }

  secretState(playerId: number) {
    const i = this.seatOf(playerId);
    if (i < 0) return undefined;
    return { dice: this.turn === i && this.phase === 'announcing' ? this.rolled : null };
  }

  publicState(): MeyerState {
    return {
      type: 'meyer',
      phase: this.phase,
      seats: this.publicSeats((s) => ({ ...s })),
      turn: this.turn,
      announced: this.announced ? { ...this.announced } : null,
      pot: this.pot,
      reveal: this.reveal ? { ...this.reveal } : null,
      winner: this.winner,
      timeLeftMs: this.timeLeft(),
      timerMs: this.timerMs,
    };
  }
}
