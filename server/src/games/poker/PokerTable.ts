import {
  cardText,
  bestScore,
  buildPots,
  compareScores,
  createShoe,
  describeScore,
  PK,
  pokerMove,
  pokerStrength,
  type Card,
  type GutFeeling,
  type PokerAction,
  type PokerSeat,
  type PokerSecret,
  type PokerState,
} from '@casino/shared';
import type { TablePlayer } from '../GameTable';
import { TableBase } from '../TableBase';

interface Seat extends PokerSeat {
  cards: Card[];
  /** Has acted since the last raise on this street. */
  acted: boolean;
}

const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;

/**
 * No-limit Texas Hold'em between the players. Chips leave your stack the moment you
 * bet; the pot (and any side pots) are paid out at the end of the hand.
 */
export class PokerTable extends TableBase<Seat> {
  readonly type = 'poker';
  private phase: PokerState['phase'] = 'waiting';
  private deck: Card[] = [];
  private board: Card[] = [];
  private button = -1;
  private turn: number | null = null;
  private currentBet = 0;
  private minRaise: number = PK.bigBlind;
  private hand = 0;
  private rigged = false;

  /** Tests only: fix the order cards come out in. */
  loadDeck(cards: Card[]) {
    this.deck = [...cards].reverse();
    this.rigged = true;
  }

  protected newSeat(p: TablePlayer): Seat {
    return {
      playerId: p.id,
      name: p.name,
      inHand: false,
      folded: false,
      allIn: false,
      bet: 0,
      committed: 0,
      shown: null,
      lastAction: null,
      won: null,
      handName: null,
      gone: false,
      cards: [],
      acted: false,
    };
  }

  protected onSit() {
    this.maybeStart();
  }

  protected onLeave(i: number) {
    const s = this.seats[i]!;
    const live = this.phase !== 'waiting' && this.phase !== 'showdown' && s.inHand;
    if (!live) {
      if (s.inHand && this.phase === 'showdown') s.gone = true;
      else this.seats[i] = null;
      this.maybeStart();
      this.ctx.changed();
      return;
    }
    // Leaving mid-hand folds you. Your chips in the pot stay there.
    s.gone = true;
    if (!s.folded) {
      s.folded = true;
      s.lastAction = 'Left';
      if (this.turn === i) {
        this.afterAction(i);
        return;
      }
      if (this.live().length <= 1) {
        this.afterAction(i);
        return;
      }
    }
    this.ctx.changed();
  }

  hasStake(playerId: number) {
    const i = this.seatOf(playerId);
    return i >= 0 && this.phase !== 'waiting' && this.seats[i]!.inHand;
  }

  private live() {
    return this.seats.map((s, i) => ({ s, i })).filter((x): x is { s: Seat; i: number } => !!x.s && x.s.inHand && !x.s.folded);
  }

  private canAct() {
    return this.live().filter((x) => !x.s.allIn);
  }

  /** Who could be dealt in right now. */
  private eligible(): number[] {
    return this.seats
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s && !x.s.gone && this.ctx.getChips(x.s.playerId) >= PK.bigBlind)
      .map((x) => x.i);
  }

  private maybeStart() {
    if (this.phase !== 'waiting') return;
    if (this.eligible().length >= 2) {
      if (!this.timerRunning) this.setTimer(PK.startDelayMs, () => this.startHand());
    } else {
      this.clearTimer();
    }
  }

  private draw(): Card {
    if (this.deck.length === 0) this.deck = createShoe(1);
    return this.deck.pop()!;
  }

  private startHand() {
    const players = this.eligible();
    if (players.length < 2) {
      this.ctx.changed();
      return;
    }
    if (!this.rigged) this.deck = createShoe(1);
    this.rigged = false;
    this.hand++;
    this.board = [];
    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, { inHand: false, folded: false, allIn: false, bet: 0, committed: 0, shown: null, lastAction: null, won: null, handName: null, cards: [], acted: false });
    }
    for (const i of players) this.seats[i]!.inHand = true;

    const next = (from: number) => this.around(from).find((i) => players.includes(i))!;
    this.button = next(this.button < 0 ? this.seats.length - 1 : this.button);
    const headsUp = players.length === 2;
    const sb = headsUp ? this.button : next(this.button);
    const bb = next(sb);
    this.put(sb, Math.min(PK.smallBlind, this.ctx.getChips(this.seats[sb]!.playerId)));
    this.seats[sb]!.lastAction = 'Small blind';
    this.put(bb, Math.min(PK.bigBlind, this.ctx.getChips(this.seats[bb]!.playerId)));
    this.seats[bb]!.lastAction = 'Big blind';
    this.currentBet = PK.bigBlind;
    this.minRaise = PK.bigBlind;
    for (let round = 0; round < 2; round++) for (const i of this.around(this.button)) if (players.includes(i)) this.seats[i]!.cards.push(this.draw());

    this.phase = 'preflop';
    this.giveTurn(bb);
  }

  /** Move chips from a player's stack into the pot. */
  private put(i: number, amount: number) {
    const s = this.seats[i]!;
    const stack = this.ctx.getChips(s.playerId);
    const n = Math.max(0, Math.min(amount, stack));
    if (n > 0) this.ctx.addChips(s.playerId, -n);
    s.bet += n;
    s.committed += n;
    if (n >= stack) s.allIn = true;
  }

  /** Turn to the next player after `after` who can still act; if nobody needs to, move on. */
  private giveTurn(after: number) {
    const can = this.canAct();
    const needs = can.filter((x) => !x.s.acted || x.s.bet < this.currentBet);
    if (this.live().length <= 1) {
      this.finish();
      return;
    }
    if (needs.length === 0 || (can.length === 1 && can[0].s.bet >= this.currentBet)) {
      this.nextStreet();
      return;
    }
    const i = this.around(after).find((k) => needs.some((x) => x.i === k))!;
    this.turn = i;
    this.setTimer(PK.turnTimeMs, () => this.onTimeout());
    this.ctx.changed();
  }

  private onTimeout() {
    if (this.turn === null) return;
    const s = this.seats[this.turn]!;
    this.act(this.turn, s.bet >= this.currentBet ? { type: 'check' } : { type: 'fold' });
  }

  action(playerId: number, raw: unknown): string | null {
    const i = this.seatOf(playerId);
    if (i < 0) return 'You are not sitting at this table.';
    if (!raw || typeof raw !== 'object') return 'Unknown action.';
    if (this.turn !== i || !STREETS.includes(this.phase as (typeof STREETS)[number])) return 'It is not your turn.';
    return this.act(i, raw as PokerAction);
  }

  private act(i: number, a: PokerAction): string | null {
    const s = this.seats[i]!;
    const stack = this.ctx.getChips(s.playerId);
    const toCall = this.currentBet - s.bet;
    switch (a.type) {
      case 'fold':
        s.folded = true;
        s.lastAction = 'Fold';
        break;
      case 'check':
        if (toCall > 0) return `You need to call ${toCall} or fold.`;
        s.lastAction = 'Check';
        break;
      case 'call':
        if (toCall <= 0) return 'Nothing to call. Check instead.';
        this.put(i, toCall);
        s.lastAction = s.allIn ? 'All in' : `Call ${s.bet}`;
        break;
      case 'allin':
      case 'raise': {
        const max = s.bet + stack;
        const to = a.type === 'allin' ? max : a.to;
        if (!Number.isInteger(to) || to <= this.currentBet) {
          if (a.type === 'allin' && max > s.bet) {
            // All in for less than a full call.
            this.put(i, stack);
            s.lastAction = 'All in';
            break;
          }
          return 'Raise to more than the current bet.';
        }
        if (to > max) return 'You do not have that many chips.';
        const raiseBy = to - this.currentBet;
        if (raiseBy < this.minRaise && to < max) return `The smallest raise is to ${this.currentBet + this.minRaise}.`;
        this.put(i, to - s.bet);
        if (raiseBy >= this.minRaise) this.minRaise = raiseBy;
        this.currentBet = to;
        // Everyone else has to answer the raise.
        for (const o of this.seats) if (o && o !== s) o.acted = false;
        s.lastAction = s.allIn ? 'All in' : `Raise to ${to}`;
        break;
      }
      default:
        return 'Unknown action.';
    }
    s.acted = true;
    this.afterAction(i);
    return null;
  }

  private afterAction(i: number) {
    this.clearTimer();
    if (this.live().length <= 1) {
      this.finish();
      return;
    }
    this.giveTurn(i);
  }

  private nextStreet() {
    this.turn = null;
    for (const s of this.seats) {
      if (!s) continue;
      s.bet = 0;
      s.acted = false;
    }
    this.currentBet = 0;
    this.minRaise = PK.bigBlind;
    if (this.phase === 'river') {
      this.finish();
      return;
    }
    const idx = STREETS.indexOf(this.phase as (typeof STREETS)[number]);
    this.phase = STREETS[idx + 1];
    const n = this.phase === 'flop' ? 3 : 1;
    for (let k = 0; k < n; k++) this.board.push(this.draw());
    for (const s of this.seats) if (s && s.inHand && !s.folded && !s.allIn) s.lastAction = null;

    if (this.canAct().length <= 1) {
      // Everyone left is all in: just turn the cards over, slowly.
      this.setTimer(PK.streetDelayMs, () => this.nextStreet(), false);
      this.ctx.changed();
      return;
    }
    this.giveTurn(this.button);
  }

  /** The hand is over: pay the pots, show the cards, then start again. */
  private finish() {
    this.clearTimer();
    this.turn = null;
    const live = this.live();
    const contrib = this.seats
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s && x.s.inHand)
      .map((x) => ({ seat: x.i, amount: x.s!.committed, live: !x.s!.folded }));

    if (live.length === 1) {
      // Everyone else folded: no cards shown.
      const total = contrib.reduce((t, c) => t + c.amount, 0);
      this.pay(live[0].i, total);
    } else {
      // Deal out any board cards still to come, then the best hands share each pot.
      while (this.board.length < 5) this.board.push(this.draw());
      const scores = new Map<number, number[]>();
      for (const { s, i } of live) {
        const score = bestScore([...s.cards, ...this.board]);
        scores.set(i, score);
        s.shown = [...s.cards];
        s.handName = describeScore(score);
      }
      for (const pot of buildPots(contrib)) {
        let best: number[] | null = null;
        let winners: number[] = [];
        for (const i of pot.eligible) {
          const sc = scores.get(i)!;
          const cmp = best ? compareScores(sc, best) : 1;
          if (cmp > 0) {
            best = sc;
            winners = [i];
          } else if (cmp === 0) winners.push(i);
        }
        // Odd chips go to the first winner after the button.
        winners = this.around(this.button).filter((i) => winners.includes(i));
        const share = Math.floor(pot.amount / winners.length);
        winners.forEach((w, k) => this.pay(w, share + (k === 0 ? pot.amount - share * winners.length : 0)));
      }
    }
    this.phase = 'showdown';
    this.setTimer(PK.showdownMs, () => this.endHand(), false);
    this.ctx.changed();
  }

  private pay(i: number, amount: number) {
    const s = this.seats[i]!;
    if (amount > 0) this.ctx.addChips(s.playerId, amount);
    s.won = (s.won ?? 0) + amount;
  }

  private endHand() {
    const dealt = this.seats.filter((s): s is Seat => !!s && s.inHand).map((s) => s.playerId);
    this.clearGone();
    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, { inHand: false, folded: false, allIn: false, bet: 0, committed: 0, shown: null, lastAction: null, won: null, handName: null, cards: [], acted: false });
    }
    this.board = [];
    this.phase = 'waiting';
    this.ctx.changed();
    for (const id of dealt) this.ctx.handFinished(id);
    this.maybeStart();
    this.ctx.changed();
  }

  botMove(playerId: number): PokerAction | null {
    const i = this.seatOf(playerId);
    if (i < 0 || this.turn !== i || !STREETS.includes(this.phase as (typeof STREETS)[number])) return null;
    const s = this.seats[i]!;
    const strength = pokerStrength(s.cards, this.board);
    return pokerMove(strength, {
      toCall: this.currentBet - s.bet,
      stack: this.ctx.getChips(playerId),
      bet: s.bet,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      pot: this.seats.reduce((t, o) => t + (o?.inHand ? o.committed : 0), 0),
    });
  }

  /**
   * On your turn: deal the rest of the board in your head (it comes off the top of the deck)
   * and see who wins at the showdown. Win: stay in. Lose: fold, and lose no more.
   */
  gutFeeling(playerId: number): GutFeeling | null {
    const i = this.seatOf(playerId);
    if (i < 0 || this.turn !== i || !STREETS.includes(this.phase as (typeof STREETS)[number])) return null;
    const me = this.seats[i]!;
    const deck = [...this.deck];
    const board = [...this.board];
    while (board.length < 5 && deck.length) board.push(deck.pop()!);
    if (board.length < 5) return null;
    const mine = bestScore([...me.cards, ...board]);
    const wins = this.live()
      .filter((x) => x.i !== i)
      .every((x) => compareScores(mine, bestScore([...x.s.cards, ...board])) >= 0);
    const yes = "Stay in. You're winning this hand, you can smell it.";
    const no = "Fold. They've got you beat. Get out while you can.";
    return { key: `pk:${this.hand}:${this.phase}:${this.currentBet}`, right: wins ? yes : no, wrong: wins ? no : yes, pick: wins ? '[data-act="call"], [data-act="check"]' : '[data-act="fold"]' };
  }

  peek(playerId: number): string | null {
    const i = this.seatOf(playerId);
    if (i < 0) return null;
    const lines = this.live()
      .filter((x) => x.i !== i && x.s.cards.length)
      .map((x) => `${x.s.name}: ${x.s.cards.map(cardText).join(' ')}`);
    const left = 5 - this.board.length;
    if (left > 0 && this.live().length > 1 && this.deck.length >= left) {
      lines.push(`Rest of the board: ${this.deck.slice(-left).reverse().map(cardText).join(' ')}`);
    }
    return lines.join('\n') || null;
  }

  secretState(playerId: number): PokerSecret | undefined {
    const i = this.seatOf(playerId);
    if (i < 0) return undefined;
    return { cards: [...this.seats[i]!.cards] };
  }

  publicState(): PokerState {
    return {
      type: 'poker',
      phase: this.phase,
      seats: this.publicSeats(({ cards: _cards, acted: _acted, ...rest }) => ({ ...rest, shown: rest.shown ? [...rest.shown] : null })),
      board: [...this.board],
      button: this.button,
      turn: this.turn,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      pot: this.seats.reduce((t, s) => t + (s?.inHand ? s.committed : 0), 0),
      hand: this.hand,
      timeLeftMs: this.timeLeft(),
      timerMs: this.timerMs,
    };
  }
}
