import {
  cardText,
  BJ,
  bjSeatWorld,
  blackjackMove,
  patronStake,
  STATIONS,
  canSplit,
  createShoe,
  handValue,
  isBlackjack,
  settleHand,
  type BJAction,
  type BJHandState,
  type BJPhase,
  type BJSeatState,
  type BJState,
  type Card,
  type GutFeeling,
} from '@casino/shared';
import type { GameTable, TableContext, TablePlayer } from '../GameTable';

const LIVE_PHASES: BJPhase[] = ['dealing', 'players', 'dealer'];

/**
 * One blackjack table. The round moves through:
 *   waiting -> betting -> dealing -> players -> dealer -> payout -> waiting
 * Chips leave a player's account when the cards are dealt (and on double / split),
 * and winnings are paid in one go when the round is settled.
 */
export class BlackjackTable implements GameTable {
  readonly type = 'blackjack';
  private phase: BJPhase = 'waiting';
  private seats: (BJSeatState | null)[] = Array.from({ length: BJ.seats }, () => null);
  private dealer: Card[] = [];
  private holeHidden = true;
  private turn: { seat: number; hand: number } | null = null;
  private shoe: Card[] = [];
  private rigged = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;
  private round = 0;

  constructor(
    readonly stationId: string,
    private ctx: TableContext,
  ) {}

  /** Tests only: fix the order cards come out in. */
  loadShoe(cardsInDrawOrder: Card[]) {
    this.shoe = [...cardsInDrawOrder].reverse();
    this.rigged = true;
  }

  // ---- seating -------------------------------------------------------------

  sit(player: TablePlayer, seat: number): string | null {
    if (!Number.isInteger(seat) || seat < 0 || seat >= BJ.seats) return 'No such seat.';
    if (this.seats[seat]) return 'That seat is taken.';
    if (this.seats.some((s) => s?.playerId === player.id)) return 'Wait for your last hand to finish.';
    this.seats[seat] = { playerId: player.id, name: player.name, bet: 0, ready: false, hands: [], gone: false, net: null };
    this.ctx.changed();
    return null;
  }

  leave(playerId: number): void {
    const i = this.seatOf(playerId);
    if (i < 0) return;
    const seat = this.seats[i]!;
    const midRound = seat.hands.length > 0 && LIVE_PHASES.includes(this.phase);
    if (!midRound) {
      this.seats[i] = null;
      if (this.phase === 'betting' && this.afterBetChange()) return;
      this.ctx.changed();
      return;
    }
    // Their bet stays in play: stand on everything and free the seat after the round.
    seat.gone = true;
    for (const h of seat.hands) if (h.status === 'playing') h.status = 'stood';
    if (this.phase === 'players' && this.turn?.seat === i) {
      this.advance(i);
      return;
    }
    this.ctx.changed();
  }

  hasStake(playerId: number): boolean {
    return LIVE_PHASES.includes(this.phase) && this.seats.some((s) => s?.playerId === playerId && s.hands.length > 0);
  }

  seatPose(playerId: number) {
    const i = this.seatOf(playerId);
    const station = STATIONS.find((s) => s.id === this.stationId);
    return i >= 0 && station ? bjSeatWorld(station, i) : null;
  }

  private seatOf(playerId: number): number {
    return this.seats.findIndex((s) => s?.playerId === playerId && !s.gone);
  }

  // ---- actions -------------------------------------------------------------

  action(playerId: number, raw: unknown): string | null {
    const i = this.seatOf(playerId);
    if (i < 0) return 'You are not sitting at this table.';
    const seat = this.seats[i]!;
    if (!raw || typeof raw !== 'object') return 'Unknown action.';
    const a = raw as BJAction;
    const bettingOpen = this.phase === 'waiting' || this.phase === 'betting';

    switch (a.type) {
      case 'bet': {
        if (!bettingOpen) return 'Betting is closed for this round.';
        const amount = a.amount;
        if (!Number.isInteger(amount) || amount <= 0) return 'Bets are in whole chips.';
        const next = seat.bet + amount;
        if (next > BJ.maxBet) return `The table maximum is ${BJ.maxBet}.`;
        if (next > this.ctx.getChips(playerId)) return 'Not enough chips.';
        seat.bet = next;
        seat.ready = false;
        if (this.phase === 'waiting') {
          this.phase = 'betting';
          this.setTimer(BJ.betTimeMs, () => this.deal(), true);
        }
        this.ctx.changed();
        return null;
      }
      case 'clearBet': {
        if (!bettingOpen) return 'Betting is closed for this round.';
        seat.bet = 0;
        seat.ready = false;
        if (!this.afterBetChange()) this.ctx.changed();
        return null;
      }
      case 'ready': {
        if (this.phase !== 'betting' || seat.bet < BJ.minBet) return 'Place a bet first.';
        seat.ready = true;
        if (!this.afterBetChange()) this.ctx.changed();
        return null;
      }
      case 'hit':
      case 'stand':
      case 'double':
      case 'split':
        return this.play(i, a.type);
      default:
        return 'Unknown action.';
    }
  }

  /** Re-check the betting phase after a bet or seat changed. Returns true if cards were dealt. */
  private afterBetChange(): boolean {
    if (this.phase !== 'betting') return false;
    const seated = this.seats.filter((s): s is BJSeatState => s !== null);
    if (!seated.some((s) => s.bet > 0)) {
      this.clearTimer();
      this.phase = 'waiting';
      return false;
    }
    if (seated.every((s) => s.bet > 0 && s.ready)) {
      this.deal();
      return true;
    }
    return false;
  }

  private play(seatIndex: number, type: 'hit' | 'stand' | 'double' | 'split'): string | null {
    if (this.phase !== 'players' || !this.turn || this.turn.seat !== seatIndex) return 'It is not your turn.';
    const seat = this.seats[seatIndex]!;
    const hand = seat.hands[this.turn.hand];
    const chips = this.ctx.getChips(seat.playerId);

    if (type === 'stand') {
      hand.status = 'stood';
    } else if (type === 'hit') {
      hand.cards.push(this.draw());
      const total = handValue(hand.cards).total;
      if (total > 21) hand.status = 'bust';
      else if (total === 21) hand.status = 'stood';
    } else if (type === 'double') {
      if (hand.cards.length !== 2) return 'You can only double on your first two cards.';
      if (chips < hand.bet) return 'Not enough chips to double.';
      this.ctx.addChips(seat.playerId, -hand.bet);
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(this.draw());
      hand.status = handValue(hand.cards).total > 21 ? 'bust' : 'stood';
    } else {
      if (seat.hands.length !== 1) return 'You can only split once.';
      if (!canSplit(hand.cards)) return 'You need a pair to split.';
      if (chips < hand.bet) return 'Not enough chips to split.';
      this.ctx.addChips(seat.playerId, -hand.bet);
      const aces = hand.cards[0].rank === 'A';
      seat.hands = hand.cards.map((card): BJHandState => {
        const cards = [card, this.draw()];
        // Split aces get one card each; a 21 here is a plain 21, not a blackjack.
        const done = aces || handValue(cards).total === 21;
        return { cards, bet: hand.bet, status: done ? 'stood' : 'playing', doubled: false, fromSplit: true };
      });
    }
    this.advance(seatIndex);
    return null;
  }

  // ---- round flow ----------------------------------------------------------

  private deal() {
    this.clearTimer();
    if (!this.rigged && this.shoe.length < BJ.reshuffleAt) this.shoe = createShoe(BJ.decks);

    const playing: BJSeatState[] = [];
    for (const s of this.seats) {
      if (!s) continue;
      s.hands = [];
      s.net = null;
      s.ready = false;
      const affordable = this.ctx.getChips(s.playerId);
      const bet = Math.min(s.bet, affordable);
      s.bet = 0;
      if (bet < BJ.minBet) continue;
      this.ctx.addChips(s.playerId, -bet);
      s.hands = [{ cards: [], bet, status: 'playing', doubled: false, fromSplit: false }];
      playing.push(s);
    }
    this.dealer = [];
    this.holeHidden = true;
    this.turn = null;
    if (playing.length === 0) {
      this.phase = 'waiting';
      this.ctx.changed();
      return;
    }

    this.round++;
    for (let pass = 0; pass < 2; pass++) {
      for (const s of playing) s.hands[0].cards.push(this.draw());
      this.dealer.push(this.draw());
    }
    for (const s of playing) if (isBlackjack(s.hands[0].cards)) s.hands[0].status = 'blackjack';

    this.phase = 'dealing';
    // Give browsers time to animate the cards landing before anyone has to act.
    this.setTimer((playing.length + 1) * 2 * BJ.dealCardMs + 500, () => this.afterDeal());
    this.ctx.changed();
  }

  private afterDeal() {
    if (isBlackjack(this.dealer)) {
      // Dealer peeks: with a blackjack the round ends before anyone plays.
      this.phase = 'dealer';
      this.holeHidden = false;
      this.setTimer(BJ.dealerDrawMs, () => this.settle());
      this.ctx.changed();
      return;
    }
    this.phase = 'players';
    this.advance(null);
  }

  /**
   * Pass the turn round the table: each player makes one move, then the next player
   * after `afterSeat` who still has a live hand goes (coming back round to the same
   * player last). With a split, a player plays one of their hands per turn.
   * When nobody has a live hand left, the dealer plays.
   */
  private advance(afterSeat: number | null) {
    const n = this.seats.length;
    const start = afterSeat === null ? 0 : afterSeat + 1;
    for (let k = 0; k < n; k++) {
      const s = (start + k) % n;
      const h = (this.seats[s]?.hands ?? []).findIndex((x) => x.status === 'playing');
      if (h < 0) continue;
      this.turn = { seat: s, hand: h };
      this.setTimer(BJ.turnTimeMs, () => this.onTurnTimeout(), true);
      this.ctx.changed();
      return;
    }
    this.startDealer();
  }

  private onTurnTimeout() {
    if (!this.turn) return;
    const hand = this.seats[this.turn.seat]?.hands[this.turn.hand];
    if (hand?.status === 'playing') hand.status = 'stood';
    this.advance(this.turn.seat);
  }

  private startDealer() {
    this.turn = null;
    this.phase = 'dealer';
    this.holeHidden = false;
    this.setTimer(BJ.dealerDrawMs, () => this.dealerStep());
    this.ctx.changed();
  }

  private dealerStep() {
    // The dealer only draws if somebody is still standing on a hand that could lose to it.
    const contested = this.seats.some((s) => s?.hands.some((h) => h.status === 'stood'));
    if (contested && handValue(this.dealer).total < 17) {
      this.dealer.push(this.draw());
      this.setTimer(BJ.dealerDrawMs, () => this.dealerStep());
      this.ctx.changed();
      return;
    }
    this.settle();
  }

  private settle() {
    for (const s of this.seats) {
      if (!s || s.hands.length === 0) continue;
      let wagered = 0;
      let returned = 0;
      for (const h of s.hands) {
        if (h.status === 'playing') h.status = 'stood';
        const { result, payout } = settleHand(h, this.dealer);
        h.result = result;
        h.payout = payout;
        wagered += h.bet;
        returned += payout;
      }
      if (returned > 0) this.ctx.addChips(s.playerId, returned);
      s.net = returned - wagered;
      this.ctx.handFinished(s.playerId);
    }
    this.turn = null;
    this.phase = 'payout';
    this.setTimer(BJ.payoutTimeMs, () => this.reset());
    this.ctx.changed();
  }

  private reset() {
    this.seats = this.seats.map((s) => (s && !s.gone ? { ...s, bet: 0, ready: false, hands: [], net: null } : null));
    this.dealer = [];
    this.holeHidden = true;
    this.turn = null;
    this.phase = 'waiting';
    this.ctx.changed();
  }

  // ---- patrons ---------------------------------------------------------------

  botMove(playerId: number): BJAction | null {
    const i = this.seatOf(playerId);
    if (i < 0) return null;
    const seat = this.seats[i]!;
    const chips = this.ctx.getChips(playerId);
    if ((this.phase === 'waiting' || this.phase === 'betting') && seat.hands.length === 0) {
      if (seat.bet === 0) {
        const amount = patronStake(chips, Math.random, BJ.minBet);
        return amount > 0 ? { type: 'bet', amount } : null;
      }
      return this.phase === 'betting' && !seat.ready ? { type: 'ready' } : null;
    }
    if (this.phase !== 'players' || this.turn?.seat !== i) return null;
    const hand = seat.hands[this.turn.hand];
    const move = blackjackMove(hand.cards, this.dealer[0], {
      canDouble: chips >= hand.bet,
      canSplit: seat.hands.length === 1 && chips >= hand.bet,
    });
    return { type: move };
  }

  /**
   * On your turn: play the hand out from the shoe, both ways, and say which one wins.
   * Only when you are the last one still playing (so nobody else's cards get in the way),
   * and only if one of the two actually wins: a hunch is never wrong.
   */
  gutFeeling(playerId: number): GutFeeling | null {
    const i = this.seatOf(playerId);
    if (i < 0 || this.phase !== 'players' || this.turn?.seat !== i || this.shoe.length < 12) return null;
    const othersPlaying = this.seats.some((s, k) => s && s.hands.some((h, hi) => h.status === 'playing' && !(k === i && hi === this.turn!.hand)));
    if (othersPlaying) return null;
    const hand = this.seats[i]!.hands[this.turn.hand];
    // Does a hand of these cards beat the dealer, who draws to 17 from what is left?
    const wins = (cards: Card[], shoe: Card[]) => {
      const mine = handValue(cards).total;
      if (mine > 21) return false;
      const dealer = [...this.dealer];
      while (handValue(dealer).total < 17) dealer.push(shoe.pop()!);
      const theirs = handValue(dealer).total;
      return theirs > 21 || mine > theirs;
    };
    const standShoe = [...this.shoe];
    const standWins = wins(hand.cards, standShoe);
    const hitShoe = [...this.shoe];
    const hitWins = wins([...hand.cards, hitShoe.pop()!], hitShoe);
    const stop = 'Stand. Do not touch another card. You win this.';
    const go = 'One more card. Take it. You win this.';
    if (standWins) return { key: `bj:${this.round}:${i}:${this.turn.hand}:${hand.cards.length}`, right: stop, wrong: go, pick: '[data-act="stand"]' };
    if (hitWins) return { key: `bj:${this.round}:${i}:${this.turn.hand}:${hand.cards.length}`, right: go, wrong: stop, pick: '[data-act="hit"]' };
    return null; // nothing wins this one: better no hunch than a wrong one
  }

  peek(playerId: number): string | null {
    if (this.seatOf(playerId) < 0) return null;
    const lines: string[] = [];
    if (this.holeHidden && this.dealer[1]) lines.push(`Dealer's hole card: ${cardText(this.dealer[1])} (${handValue(this.dealer).total} in all)`);
    const next = this.shoe.slice(-3).reverse();
    if (next.length) lines.push(`Next off the shoe: ${next.map(cardText).join(', ')}`);
    return lines.join('\n') || null;
  }

  // ---- helpers -------------------------------------------------------------

  private draw(): Card {
    if (this.shoe.length === 0) this.shoe = createShoe(BJ.decks);
    return this.shoe.pop()!;
  }

  /** `visible` timers are the ones players see counting down (betting, your turn). */
  private setTimer(ms: number, fn: () => void, visible = false) {
    this.clearTimer();
    this.deadline = visible ? Date.now() + ms : null;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = null;
      fn();
    }, ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  publicState(): BJState {
    const dealer = this.dealer.map((c, i) => (i === 1 && this.holeHidden ? null : c));
    const shown = dealer.filter((c): c is Card => c !== null);
    return {
      type: 'blackjack',
      phase: this.phase,
      round: this.round,
      seats: structuredClone(this.seats),
      dealer,
      dealerTotal: shown.length ? handValue(shown).total : null,
      turn: this.turn ? { ...this.turn } : null,
      timeLeftMs: this.deadline === null ? null : Math.max(0, this.deadline - Date.now()),
    };
  }

  dispose() {
    this.clearTimer();
  }
}
