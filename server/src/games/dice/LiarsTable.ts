import { countFace, LD, liarsMove, nextBid, rollDie, validBid, type Bid, type GutFeeling, type LiarsAction, type LiarsSeat, type LiarsState } from '@casino/shared';
import type { TablePlayer } from '../GameTable';
import { TableBase } from '../TableBase';

interface Seat extends LiarsSeat {
  dice: number[];
}

/**
 * Liar's Dice. Everyone pays the stake into the pot and hides five dice under a cup.
 * Bid on how many of a face are on the whole table (ones are wild), or call the last
 * bidder a liar. Whoever is wrong loses a die. Last player with dice takes the pot.
 */
export class LiarsTable extends TableBase<Seat> {
  readonly type = 'liars';
  private phase: LiarsState['phase'] = 'waiting';
  private turn: number | null = null;
  private bid: Bid | null = null;
  private pot = 0;
  private reveal: LiarsState['reveal'] = null;
  private winner: number | null = null;
  /** Tests only: dice to hand out instead of rolling. */
  rig: number[][] | null = null;

  protected newSeat(p: TablePlayer): Seat {
    return { playerId: p.id, name: p.name, ready: false, inGame: false, count: 0, gone: false, dice: [] };
  }

  protected onLeave(i: number) {
    const s = this.seats[i]!;
    if (s.inGame && (this.phase === 'bidding' || this.phase === 'reveal')) {
      // Leaving forfeits your stake.
      s.gone = true;
      s.count = 0;
      s.dice = [];
      if (this.alive().length <= 1) {
        this.win();
        return;
      }
      if (this.turn === i) {
        this.turn = this.nextAlive(i);
        this.startTurnTimer();
      }
      this.ctx.changed();
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
    return this.seats.map((s, i) => ({ s, i })).filter((x): x is { s: Seat; i: number } => !!x.s && x.s.inGame && x.s.count > 0 && !x.s.gone);
  }

  private nextAlive(from: number): number | null {
    return this.around(from).find((k) => this.alive().some((a) => a.i === k)) ?? null;
  }

  private totalDice() {
    return this.alive().reduce((t, a) => t + a.s.count, 0);
  }

  action(playerId: number, raw: unknown): string | null {
    const i = this.seatOf(playerId);
    if (i < 0) return 'You are not sitting at this table.';
    const a = raw as LiarsAction;
    if (!a || typeof a !== 'object') return 'Unknown action.';
    const s = this.seats[i]!;
    switch (a.type) {
      case 'ready':
        if (this.phase !== 'waiting') return 'A game is already going.';
        if (this.ctx.getChips(playerId) < LD.stake) return `You need ${LD.stake} chips to play.`;
        s.ready = true;
        this.checkStart();
        this.ctx.changed();
        return null;
      case 'unready':
        if (this.phase !== 'waiting') return 'A game is already going.';
        s.ready = false;
        this.ctx.changed();
        return null;
      case 'bid':
        if (this.phase !== 'bidding' || this.turn !== i) return 'It is not your turn.';
        if (!validBid(this.bid, a.quantity, a.face, this.totalDice())) return 'That bid does not beat the last one.';
        this.placeBid(i, a.quantity, a.face);
        return null;
      case 'liar':
        if (this.phase !== 'bidding' || this.turn !== i) return 'It is not your turn.';
        if (!this.bid) return 'There is no bid to call.';
        this.callLiar(i);
        return null;
      default:
        return 'Unknown action.';
    }
  }

  private checkStart() {
    if (this.phase !== 'waiting') return;
    const seated = this.seats.map((s, i) => ({ s, i })).filter((x): x is { s: Seat; i: number } => !!x.s && !x.s.gone);
    if (seated.length < 2 || !seated.every((x) => x.s.ready)) return;
    // Everyone pays in.
    const players = seated.filter((x) => this.ctx.getChips(x.s.playerId) >= LD.stake);
    if (players.length < 2) return;
    this.pot = 0;
    for (const { s } of players) {
      this.ctx.addChips(s.playerId, -LD.stake);
      this.pot += LD.stake;
      s.inGame = true;
      s.count = LD.dice;
    }
    this.winner = null;
    this.newRound(players[Math.floor(Math.random() * players.length)].i);
  }

  private newRound(starter: number) {
    let k = 0;
    for (const { s } of this.alive()) {
      s.dice = this.rig?.[k] ? [...this.rig[k]] : Array.from({ length: s.count }, () => rollDie());
      k++;
    }
    this.rig = null;
    this.bid = null;
    this.reveal = null;
    this.phase = 'bidding';
    this.turn = this.alive().some((a) => a.i === starter) ? starter : this.nextAlive(starter);
    this.startTurnTimer();
    this.ctx.changed();
  }

  private startTurnTimer() {
    this.setTimer(LD.turnTimeMs, () => {
      if (this.turn === null) return;
      // Too slow: call it if there is something to call, otherwise make the smallest bid.
      if (this.bid) this.callLiar(this.turn);
      else {
        const b = nextBid(null);
        this.placeBid(this.turn, b.quantity, b.face);
      }
    });
  }

  private placeBid(i: number, quantity: number, face: number) {
    this.bid = { quantity, face, seat: i };
    this.turn = this.nextAlive(i);
    this.startTurnTimer();
    this.ctx.changed();
  }

  private callLiar(i: number) {
    this.clearTimer();
    const bid = this.bid!;
    const dice = this.seats.map((s) => (s && s.inGame && s.count > 0 ? [...s.dice] : null));
    const count = countFace(
      dice.filter((d): d is number[] => d !== null),
      bid.face,
    );
    const loser = count >= bid.quantity ? i : bid.seat;
    const ls = this.seats[loser];
    if (ls) ls.count = Math.max(0, ls.count - 1);
    this.reveal = { dice, bid: { ...bid }, count, challenger: i, loser };
    this.phase = 'reveal';
    this.turn = null;
    this.setTimer(LD.revealMs, () => {
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
    this.setTimer(LD.overMs, () => this.endGame(), false);
    this.ctx.changed();
  }

  private endGame() {
    const played = this.seats.filter((s): s is Seat => !!s && s.inGame).map((s) => s.playerId);
    this.clearGone();
    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, { ready: false, inGame: false, count: 0, dice: [] });
    }
    this.phase = 'waiting';
    this.bid = null;
    this.reveal = null;
    this.winner = null;
    this.ctx.changed();
    for (const id of played) this.ctx.handFinished(id);
  }

  botMove(playerId: number): LiarsAction | null {
    const i = this.seatOf(playerId);
    if (i < 0) return null;
    const s = this.seats[i]!;
    if (this.phase === 'waiting') return !s.ready && this.ctx.getChips(playerId) >= LD.stake ? { type: 'ready' } : null;
    if (this.phase !== 'bidding' || this.turn !== i) return null;
    return liarsMove(s.dice, this.totalDice(), this.bid);
  }

  /** On your turn, with a bid on the table: is it true? */
  gutFeeling(playerId: number): GutFeeling | null {
    const i = this.seatOf(playerId);
    if (i < 0 || this.phase !== 'bidding' || this.turn !== i || !this.bid) return null;
    const all = this.alive().map((a) => a.s.dice);
    const truth = countFace(all, this.bid.face) >= this.bid.quantity;
    const yes = "That bid's true. Don't call it.";
    const no = 'Liar! That bid is a lie, you can feel it.';
    return { key: `ld:${this.bid.quantity}:${this.bid.face}:${this.bid.seat}`, right: truth ? yes : no, wrong: truth ? no : yes, pick: truth ? '[data-act="bid"]' : '[data-act="liar"]' };
  }

  peek(playerId: number): string | null {
    const i = this.seatOf(playerId);
    if (i < 0 || this.phase !== 'bidding') return null;
    const lines = this.alive()
      .filter((a) => a.i !== i)
      .map((a) => `${a.s.name}: ${a.s.dice.join(' ')}`);
    return lines.join('\n') || null;
  }

  secretState(playerId: number) {
    const i = this.seatOf(playerId);
    if (i < 0) return undefined;
    return { dice: [...this.seats[i]!.dice] };
  }

  publicState(): LiarsState {
    return {
      type: 'liars',
      phase: this.phase,
      seats: this.publicSeats(({ dice: _dice, ...rest }) => ({ ...rest })),
      turn: this.turn,
      bid: this.bid ? { ...this.bid } : null,
      pot: this.pot,
      totalDice: this.totalDice(),
      reveal: this.reveal ? { ...this.reveal, dice: this.reveal.dice.map((d) => (d ? [...d] : null)) } : null,
      winner: this.winner,
      timeLeftMs: this.timeLeft(),
      timerMs: this.timerMs,
    };
  }
}
