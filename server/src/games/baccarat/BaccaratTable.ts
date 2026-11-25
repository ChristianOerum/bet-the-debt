import {
  cardText,
  BAC,
  BAC_SIDES,
  bacReturn,
  bacTotal,
  bacWinner,
  createShoe,
  dealCoup,
  patronStake,
  type BacSide,
  type BaccaratAction,
  type BaccaratSeat,
  type BaccaratState,
  type Card,
  type GutFeeling,
} from '@casino/shared';
import type { TablePlayer } from '../GameTable';
import { TableBase } from '../TableBase';

/**
 * Baccarat against the house:
 *   waiting -> betting -> dealing (cards laid one by one) -> payout -> waiting
 */
export class BaccaratTable extends TableBase<BaccaratSeat> {
  readonly type = 'baccarat';
  private phase: BaccaratState['phase'] = 'waiting';
  private shoe: Card[] = [];
  private cards: { side: 'player' | 'banker'; card: Card }[] = [];
  private winner: BacSide | null = null;
  private coup = 0;
  private history: BacSide[] = [];

  /** Tests only: fix the order cards come out in. */
  loadShoe(cards: Card[]) {
    this.shoe = [...cards].reverse();
  }

  protected newSeat(p: TablePlayer): BaccaratSeat {
    return { playerId: p.id, name: p.name, bets: { player: 0, banker: 0, tie: 0 }, ready: false, net: null, gone: false };
  }

  private total(s: BaccaratSeat) {
    return s.bets.player + s.bets.banker + s.bets.tie;
  }

  protected onLeave(i: number) {
    const seat = this.seats[i]!;
    if ((this.phase === 'dealing' || this.phase === 'payout') && this.total(seat) > 0) {
      seat.gone = true;
      this.ctx.changed();
      return;
    }
    this.seats[i] = null;
    if (!this.afterBetChange()) this.ctx.changed();
  }

  hasStake(playerId: number) {
    const i = this.seatOf(playerId);
    return i >= 0 && this.phase === 'dealing' && this.total(this.seats[i]!) > 0;
  }

  action(playerId: number, raw: unknown): string | null {
    const i = this.seatOf(playerId);
    if (i < 0) return 'You are not sitting at this table.';
    const seat = this.seats[i]!;
    const a = raw as BaccaratAction;
    const open = this.phase === 'waiting' || this.phase === 'betting';
    if (!a || typeof a !== 'object') return 'Unknown action.';
    switch (a.type) {
      case 'bet': {
        if (!open) return 'No more bets.';
        if (!BAC_SIDES.includes(a.side)) return 'Unknown bet.';
        if (!Number.isInteger(a.amount) || a.amount <= 0) return 'Bets are in whole chips.';
        const total = this.total(seat) + a.amount;
        if (total > BAC.maxBet) return `The table maximum is ${BAC.maxBet}.`;
        if (total > this.ctx.getChips(playerId)) return 'Not enough chips.';
        seat.bets[a.side] += a.amount;
        seat.ready = false;
        if (this.phase === 'waiting') {
          this.phase = 'betting';
          this.setTimer(BAC.betTimeMs, () => this.deal());
        }
        this.ctx.changed();
        return null;
      }
      case 'clear':
        if (!open) return 'No more bets.';
        seat.bets = { player: 0, banker: 0, tie: 0 };
        seat.ready = false;
        if (!this.afterBetChange()) this.ctx.changed();
        return null;
      case 'ready':
        if (this.phase !== 'betting' || this.total(seat) === 0) return 'Place a bet first.';
        seat.ready = true;
        if (!this.afterBetChange()) this.ctx.changed();
        return null;
      default:
        return 'Unknown action.';
    }
  }

  private afterBetChange(): boolean {
    if (this.phase !== 'betting') return false;
    const seated = this.seats.filter((s): s is BaccaratSeat => s !== null);
    if (!seated.some((s) => this.total(s) > 0)) {
      this.clearTimer();
      this.phase = 'waiting';
      return false;
    }
    if (seated.every((s) => this.total(s) > 0 && s.ready)) {
      this.deal();
      return true;
    }
    return false;
  }

  private draw(): Card {
    if (this.shoe.length < 1) this.shoe = createShoe(BAC.decks);
    return this.shoe.pop()!;
  }

  private deal() {
    if (this.shoe.length < 60) this.shoe = createShoe(BAC.decks);
    let anyone = false;
    for (const s of this.seats) {
      if (!s) continue;
      const total = this.total(s);
      if (total === 0) continue;
      if (total > this.ctx.getChips(s.playerId)) {
        s.bets = { player: 0, banker: 0, tie: 0 };
        continue;
      }
      this.ctx.addChips(s.playerId, -total);
      s.net = null;
      anyone = true;
    }
    if (!anyone) {
      this.phase = 'waiting';
      this.clearTimer();
      this.ctx.changed();
      return;
    }
    this.cards = dealCoup(() => this.draw());
    this.winner = null;
    this.coup++;
    this.phase = 'dealing';
    this.setTimer(this.cards.length * BAC.cardMs + 900, () => this.payout(), false);
    this.ctx.changed();
  }

  private payout() {
    const player = this.cards.filter((c) => c.side === 'player').map((c) => c.card);
    const banker = this.cards.filter((c) => c.side === 'banker').map((c) => c.card);
    const winner = bacWinner(player, banker);
    this.winner = winner;
    for (const s of this.seats) {
      if (!s) continue;
      const total = this.total(s);
      if (total === 0) continue;
      let back = 0;
      for (const side of BAC_SIDES) if (s.bets[side] > 0) back += bacReturn(side, s.bets[side], winner);
      if (back > 0) this.ctx.addChips(s.playerId, back);
      s.net = back - total;
      this.ctx.handFinished(s.playerId);
    }
    this.history = [winner, ...this.history].slice(0, 16);
    this.phase = 'payout';
    this.setTimer(BAC.payoutMs, () => this.reset(), false);
    this.ctx.changed();
  }

  private reset() {
    this.clearGone();
    for (const s of this.seats) {
      if (!s) continue;
      s.bets = { player: 0, banker: 0, tie: 0 };
      s.ready = false;
      s.net = null;
    }
    this.cards = [];
    this.winner = null;
    this.phase = 'waiting';
    this.ctx.changed();
  }

  botMove(playerId: number): BaccaratAction | null {
    const i = this.seatOf(playerId);
    if (i < 0 || (this.phase !== 'waiting' && this.phase !== 'betting')) return null;
    const seat = this.seats[i]!;
    if (this.total(seat) === 0) {
      const amount = patronStake(this.ctx.getChips(playerId));
      if (!amount) return null;
      const r = Math.random();
      const side: BacSide = r < 0.55 ? 'banker' : r < 0.94 ? 'player' : 'tie';
      return { type: 'bet', side, amount: side === 'tie' ? Math.max(10, Math.round(amount / 40) * 10) : amount };
    }
    return this.phase === 'betting' && !seat.ready ? { type: 'ready' } : null;
  }

  /** While bets are open: deal the next coup in your head, from the shoe as it stands. */
  gutFeeling(playerId: number): GutFeeling | null {
    if (this.seatOf(playerId) < 0 || (this.phase !== 'waiting' && this.phase !== 'betting')) return null;
    // A fresh shoe now rather than at the deal, so the hunch and the deal see the same cards.
    if (this.shoe.length < 60) this.shoe = createShoe(BAC.decks);
    const shoe = [...this.shoe];
    const coup = dealCoup(() => shoe.pop()!);
    const side = (k: 'player' | 'banker') => coup.filter((c) => c.side === k).map((c) => c.card);
    const winner = bacWinner(side('player'), side('banker'));
    const say: Record<BacSide, string> = {
      player: 'The Player. Back the Player.',
      banker: 'The Banker. Something about the Banker.',
      tie: 'A tie. Madness, but... a tie.',
    };
    const wrong = winner === 'banker' ? 'player' : 'banker';
    return { key: `bac:${this.coup}`, right: say[winner], wrong: say[wrong], pick: `[data-act="bet"][data-side="${winner}"]` };
  }

  peek(playerId: number): string | null {
    if (this.seatOf(playerId) < 0 || (this.phase !== 'waiting' && this.phase !== 'betting')) return null;
    if (this.shoe.length < 60) this.shoe = createShoe(BAC.decks);
    const shoe = [...this.shoe];
    const coup = dealCoup(() => shoe.pop()!);
    const side = (k: 'player' | 'banker') => coup.filter((c) => c.side === k).map((c) => c.card);
    const w = bacWinner(side('player'), side('banker'));
    return `Next coup: Player ${side('player').map(cardText).join(' ')} (${bacTotal(side('player'))}), Banker ${side('banker').map(cardText).join(' ')} (${bacTotal(side('banker'))}). ${w === 'tie' ? 'A tie.' : `${w === 'player' ? 'Player' : 'Banker'} wins.`}`;
  }

  publicState(): BaccaratState {
    const dealt = this.phase === 'payout';
    const side = (k: 'player' | 'banker') => this.cards.filter((c) => c.side === k).map((c) => c.card);
    return {
      type: 'baccarat',
      phase: this.phase,
      seats: this.publicSeats((s) => ({ ...s, bets: { ...s.bets } })),
      cards: this.cards.map((c) => ({ ...c })),
      playerTotal: dealt ? bacTotal(side('player')) : null,
      bankerTotal: dealt ? bacTotal(side('banker')) : null,
      winner: dealt ? this.winner : null,
      coup: this.coup,
      history: [...this.history],
      timeLeftMs: this.timeLeft(),
      timerMs: this.timerMs,
    };
  }
}
