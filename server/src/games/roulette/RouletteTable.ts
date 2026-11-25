import { betReturn, colorOf, isValidBet, patronStake, RT, type GutFeeling, type RouletteAction, type RouletteSeat, type RouletteState } from '@casino/shared';
import type { TablePlayer } from '../GameTable';
import { TableBase } from '../TableBase';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Roulette against the house:
 *   waiting -> betting (someone bet) -> spinning -> payout -> waiting
 * Bets come out of your chips when the wheel starts; winnings are paid when it stops.
 */
export class RouletteTable extends TableBase<RouletteSeat> {
  readonly type = 'roulette';
  private phase: RouletteState['phase'] = 'waiting';
  private result: number | null = null;
  private spin = 0;
  private history: number[] = [];
  /** Tests only: where the next ball lands. */
  rig: number | null = null;
  /** Where the next ball will land. Decided early, so a hunch can know it. */
  private next = Math.floor(Math.random() * 37);

  protected newSeat(p: TablePlayer): RouletteSeat {
    return { playerId: p.id, name: p.name, bets: {}, total: 0, ready: false, net: null, gone: false };
  }

  protected onLeave(i: number) {
    const seat = this.seats[i]!;
    if (this.phase === 'spinning' || this.phase === 'payout') {
      if (seat.total > 0) {
        seat.gone = true; // their bet stays on the table
        this.ctx.changed();
        return;
      }
    }
    this.seats[i] = null;
    if (!this.afterBetChange()) this.ctx.changed();
  }

  hasStake(playerId: number) {
    const i = this.seatOf(playerId);
    return i >= 0 && this.phase === 'spinning' && this.seats[i]!.total > 0;
  }

  action(playerId: number, raw: unknown): string | null {
    const i = this.seatOf(playerId);
    if (i < 0) return 'You are not sitting at this table.';
    const seat = this.seats[i]!;
    const a = raw as RouletteAction;
    const open = this.phase === 'waiting' || this.phase === 'betting';
    if (!a || typeof a !== 'object') return 'Unknown action.';
    switch (a.type) {
      case 'bet': {
        if (!open) return 'No more bets.';
        if (typeof a.bet !== 'string' || !isValidBet(a.bet)) return 'Unknown bet.';
        if (!Number.isInteger(a.amount) || a.amount <= 0) return 'Bets are in whole chips.';
        if (seat.total + a.amount > RT.maxBet) return `The table maximum is ${RT.maxBet}.`;
        if (seat.total + a.amount > this.ctx.getChips(playerId)) return 'Not enough chips.';
        seat.bets[a.bet] = (seat.bets[a.bet] ?? 0) + a.amount;
        seat.total += a.amount;
        seat.ready = false;
        if (this.phase === 'waiting') {
          this.phase = 'betting';
          this.setTimer(RT.betTimeMs, () => this.startSpin());
        }
        this.ctx.changed();
        return null;
      }
      case 'clear':
        if (!open) return 'No more bets.';
        seat.bets = {};
        seat.total = 0;
        seat.ready = false;
        if (!this.afterBetChange()) this.ctx.changed();
        return null;
      case 'ready':
        if (this.phase !== 'betting' || seat.total === 0) return 'Place a bet first.';
        seat.ready = true;
        if (!this.afterBetChange()) this.ctx.changed();
        return null;
      default:
        return 'Unknown action.';
    }
  }

  /** Back to waiting if nobody has a bet; spin at once if everyone is ready. Returns true if it spun. */
  private afterBetChange(): boolean {
    if (this.phase !== 'betting') return false;
    const seated = this.seats.filter((s): s is RouletteSeat => s !== null);
    if (!seated.some((s) => s.total > 0)) {
      this.clearTimer();
      this.phase = 'waiting';
      return false;
    }
    if (seated.every((s) => s.total > 0 && s.ready)) {
      this.startSpin();
      return true;
    }
    return false;
  }

  private startSpin() {
    let anyone = false;
    for (const s of this.seats) {
      if (!s || s.total === 0) continue;
      if (s.total > this.ctx.getChips(s.playerId)) {
        s.bets = {};
        s.total = 0;
        continue;
      }
      this.ctx.addChips(s.playerId, -s.total);
      s.net = null;
      anyone = true;
    }
    if (!anyone) {
      this.phase = 'waiting';
      this.clearTimer();
      this.ctx.changed();
      return;
    }
    this.result = this.rig ?? this.next;
    this.rig = null;
    this.next = Math.floor(Math.random() * 37);
    this.spin++;
    this.phase = 'spinning';
    this.setTimer(RT.spinMs, () => this.payout(), false);
    this.ctx.changed();
  }

  private payout() {
    const n = this.result!;
    for (const s of this.seats) {
      if (!s || s.total === 0) continue;
      let back = 0;
      for (const [key, amount] of Object.entries(s.bets)) back += betReturn(key, amount, n);
      if (back > 0) this.ctx.addChips(s.playerId, back);
      s.net = back - s.total;
      this.ctx.handFinished(s.playerId);
    }
    this.history = [n, ...this.history].slice(0, 14);
    this.phase = 'payout';
    this.setTimer(RT.payoutMs, () => this.reset(), false);
    this.ctx.changed();
  }

  private reset() {
    this.clearGone();
    for (const s of this.seats) {
      if (!s) continue;
      s.bets = {};
      s.total = 0;
      s.ready = false;
      s.net = null;
    }
    this.phase = 'waiting';
    this.ctx.changed();
  }

  botMove(playerId: number): RouletteAction | null {
    const i = this.seatOf(playerId);
    if (i < 0 || (this.phase !== 'waiting' && this.phase !== 'betting')) return null;
    const seat = this.seats[i]!;
    if (seat.total === 0) {
      const amount = patronStake(this.ctx.getChips(playerId));
      if (!amount) return null;
      const r = Math.random();
      // Mostly the safe outside bets; now and then a lucky number.
      const bet = r < 0.2 ? `n${Math.floor(Math.random() * 37)}` : (['red', 'black', 'odd', 'even'] as const)[Math.floor(Math.random() * 4)];
      return { type: 'bet', bet, amount: r < 0.2 ? Math.max(10, Math.round(amount / 30) * 10) : amount };
    }
    return this.phase === 'betting' && !seat.ready ? { type: 'ready' } : null;
  }

  /** While bets are open: something true about where the ball will land. */
  gutFeeling(playerId: number): GutFeeling | null {
    if (this.seatOf(playerId) < 0 || (this.phase !== 'waiting' && this.phase !== 'betting')) return null;
    const n = this.rig ?? this.next;
    const key = `rt:${this.spin}`;
    switch (this.spin % 3) {
      case 0: {
        const c = colorOf(n);
        if (c === 'green') return { key, right: 'Zero. Weirdly, you can feel a zero coming.', wrong: 'Red. Definitely red.', pick: '[data-bet="n0"]' };
        const other = c === 'red' ? 'black' : 'red';
        return { key, right: `${cap(c)}. Your gut is screaming ${c}.`, wrong: `${cap(other)}. Your gut is screaming ${other}.`, pick: `[data-bet="${c}"]` };
      }
      case 1: {
        if (n === 0) return { key, right: 'Zero. Weirdly, you can feel a zero coming.', wrong: 'Odd. Something odd is coming.', pick: '[data-bet="n0"]' };
        const odd = n % 2 === 1;
        return { key, right: odd ? 'Odd. Something odd is coming.' : 'Even. It wants to be even.', wrong: odd ? 'Even. It wants to be even.' : 'Odd. Something odd is coming.', pick: `[data-bet="${odd ? 'odd' : 'even'}"]` };
      }
      default: {
        if (n === 0) return { key, right: 'Zero. Weirdly, you can feel a zero coming.', wrong: 'A low number. 1 to 18.', pick: '[data-bet="n0"]' };
        const low = n >= 1 && n <= 18;
        return { key, right: low ? 'A low number. 1 to 18.' : 'A high one. 19 to 36.', wrong: low ? 'A high one. 19 to 36.' : 'A low number. 1 to 18.', pick: `[data-bet="${low ? 'low' : 'high'}"]` };
      }
    }
  }

  peek(playerId: number): string | null {
    if (this.seatOf(playerId) < 0 || (this.phase !== 'waiting' && this.phase !== 'betting')) return null;
    const n = this.rig ?? this.next;
    return `The ball will land on ${n} (${colorOf(n)}).`;
  }

  publicState(): RouletteState {
    return {
      type: 'roulette',
      phase: this.phase,
      seats: this.publicSeats((s) => ({ ...s, bets: { ...s.bets } })),
      // The landing pocket is only sent once the wheel is turning.
      result: this.phase === 'spinning' || this.phase === 'payout' ? this.result : null,
      spin: this.spin,
      history: [...this.history],
      timeLeftMs: this.timeLeft(),
      timerMs: this.phase === 'spinning' ? RT.spinMs : this.timerMs,
    };
  }
}
