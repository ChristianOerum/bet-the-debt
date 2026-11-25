import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BJ, type BJState, type Card, type Rank } from '@casino/shared';
import { BlackjackTable } from '../src/games/blackjack/BlackjackTable';

const cards = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: 'S' }));

/** A table with fake accounts: everyone starts on 1000 chips. */
function setup(shoe: Rank[], playerIds = [1]) {
  const chips = new Map<number, number>(playerIds.map((id) => [id, 1000]));
  let changes = 0;
  /** Player ids, in the order the table reported their hands as finished. */
  const finished: number[] = [];
  const table = new BlackjackTable('t', {
    getChips: (id) => chips.get(id) ?? 0,
    addChips: (id, delta) => chips.set(id, (chips.get(id) ?? 0) + delta),
    changed: () => changes++,
    handFinished: (id) => finished.push(id),
    kill: () => {},
  });
  table.loadShoe(cards(...shoe));
  playerIds.forEach((id, seat) => expect(table.sit({ id, name: `P${id}` }, seat)).toBeNull());
  const state = () => table.publicState() as BJState;
  const act = (id: number, type: string, amount?: number) => table.action(id, { type, amount });
  const betAndDeal = (bet = 100) => {
    for (const id of playerIds) expect(act(id, 'bet', bet)).toBeNull();
    for (const id of playerIds) expect(act(id, 'ready')).toBeNull();
    expect(state().phase).toBe('dealing');
    vi.advanceTimersByTime((playerIds.length + 1) * 2 * BJ.dealCardMs + 500);
  };
  const finishDealer = () => {
    for (let i = 0; i < 12 && state().phase === 'dealer'; i++) vi.advanceTimersByTime(BJ.dealerDrawMs);
  };
  return { table, chips, state, act, betAndDeal, finishDealer, finished, changes: () => changes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('BlackjackTable', () => {
  it('plays a simple winning round', () => {
    // deal order: player, dealer up, player, dealer hole
    const t = setup(['10', '10', '9', '7']);
    t.betAndDeal(100);
    expect(t.chips.get(1)).toBe(900);
    expect(t.state().phase).toBe('players');
    expect(t.state().turn).toEqual({ seat: 0, hand: 0 });
    expect(t.state().dealer[1]).toBeNull(); // hole card stays hidden
    expect(t.state().dealerTotal).toBe(10);

    expect(t.act(1, 'stand')).toBeNull();
    expect(t.state().phase).toBe('dealer');
    expect(t.state().dealer[1]).toEqual({ rank: '7', suit: 'S' });
    t.finishDealer();

    const s = t.state();
    expect(s.phase).toBe('payout');
    expect(s.seats[0]!.hands[0].result).toBe('win');
    expect(s.seats[0]!.net).toBe(100);
    expect(t.chips.get(1)).toBe(1100);

    vi.advanceTimersByTime(BJ.payoutTimeMs);
    expect(t.state().phase).toBe('waiting');
    expect(t.state().seats[0]!.hands).toEqual([]);
    expect(t.state().dealer).toEqual([]);
  });

  it('pays a natural blackjack 3:2 without the dealer drawing', () => {
    const t = setup(['A', '9', 'K', '5', '10']);
    t.betAndDeal(100);
    expect(t.state().phase).toBe('dealer'); // nobody has a decision to make
    t.finishDealer();
    expect(t.state().dealer).toHaveLength(2); // 14, but no reason to draw
    expect(t.state().seats[0]!.hands[0].result).toBe('blackjack');
    expect(t.chips.get(1)).toBe(1150);
  });

  it('ends the round at once when the dealer has blackjack', () => {
    const t = setup(['10', 'A', '9', 'K']);
    t.betAndDeal(100);
    expect(t.state().phase).toBe('dealer');
    expect(t.state().turn).toBeNull();
    expect(t.act(1, 'hit')).toBe('It is not your turn.');
    t.finishDealer();
    expect(t.state().seats[0]!.hands[0].result).toBe('lose');
    expect(t.chips.get(1)).toBe(900);
  });

  it('busts a player who hits too far, and the dealer does not draw', () => {
    const t = setup(['10', '6', '6', '10', 'K', '5']);
    t.betAndDeal(100);
    expect(t.act(1, 'hit')).toBeNull();
    expect(t.state().seats[0]!.hands[0].status).toBe('bust');
    t.finishDealer();
    expect(t.state().dealer).toHaveLength(2);
    expect(t.chips.get(1)).toBe(900);
  });

  it('handles split, then double on a split hand', () => {
    // player 8,8 vs dealer 6 (hole 10). Split draws 3 and 10. Double first hand -> 10. Dealer draws 10 and busts.
    const t = setup(['8', '6', '8', '10', '3', '10', '10', '10']);
    t.betAndDeal(100);
    expect(t.act(1, 'split')).toBeNull();
    expect(t.chips.get(1)).toBe(800);
    expect(t.state().seats[0]!.hands).toHaveLength(2);
    expect(t.state().turn).toEqual({ seat: 0, hand: 0 });
    expect(t.act(1, 'split')).toBe('You can only split once.');

    expect(t.act(1, 'double')).toBeNull();
    expect(t.chips.get(1)).toBe(700);
    expect(t.state().seats[0]!.hands[0].bet).toBe(200);
    expect(t.state().turn).toEqual({ seat: 0, hand: 1 });

    expect(t.act(1, 'stand')).toBeNull();
    t.finishDealer();
    const seat = t.state().seats[0]!;
    expect(seat.hands.map((h) => h.result)).toEqual(['win', 'win']);
    expect(seat.net).toBe(300);
    expect(t.chips.get(1)).toBe(1300);
  });

  it('gives split aces one card each and treats 21 as a normal win', () => {
    const t = setup(['A', '6', 'A', '10', 'K', '5', '10']);
    t.betAndDeal(100);
    expect(t.act(1, 'split')).toBeNull();
    expect(t.state().phase).toBe('dealer'); // both hands stand automatically
    t.finishDealer(); // dealer 16 draws 10 and busts
    const seat = t.state().seats[0]!;
    expect(seat.hands.map((h) => h.result)).toEqual(['win', 'win']);
    expect(t.chips.get(1)).toBe(1200);
  });

  it('stands automatically when the turn timer runs out', () => {
    const t = setup(['10', '10', '9', '7']);
    t.betAndDeal(100);
    expect(t.state().timeLeftMs).toBe(BJ.turnTimeMs);
    vi.advanceTimersByTime(BJ.turnTimeMs);
    expect(t.state().phase).toBe('dealer');
    expect(t.state().seats[0]!.hands[0].status).toBe('stood');
  });

  it('deals when the betting timer runs out, skipping players without a bet', () => {
    const t = setup(['10', '10', '9', '7'], [1, 2]);
    expect(t.act(1, 'bet', 50)).toBeNull();
    expect(t.state().phase).toBe('betting');
    vi.advanceTimersByTime(BJ.betTimeMs);
    const s = t.state();
    expect(s.phase).toBe('dealing');
    expect(s.seats[0]!.hands).toHaveLength(1);
    expect(s.seats[1]!.hands).toHaveLength(0);
    expect(t.chips.get(2)).toBe(1000);
  });

  it('goes back to waiting when the only bet is cleared', () => {
    const t = setup([]);
    t.act(1, 'bet', 50);
    expect(t.act(1, 'clearBet')).toBeNull();
    expect(t.state().phase).toBe('waiting');
    vi.advanceTimersByTime(BJ.betTimeMs * 2);
    expect(t.state().phase).toBe('waiting');
  });

  it('rejects bad bets', () => {
    const t = setup([]);
    expect(t.act(1, 'bet', 2.5)).toBe('Bets are in whole chips.');
    expect(t.act(1, 'bet', -100)).toBe('Bets are in whole chips.');
    expect(t.act(1, 'bet', 2000)).toBe('Not enough chips.');
    expect(t.act(1, 'ready')).toBe('Place a bet first.');
    expect(t.act(1, 'bet', 5)).toBeNull(); // a 5 chip is fine...
    expect(t.act(1, 'ready')).toBe('Place a bet first.'); // ...but the table minimum is 10
    expect(t.act(99, 'bet', 10)).toBe('You are not sitting at this table.');
    expect(t.table.action(1, null)).toBe('Unknown action.');
    expect(t.chips.get(1)).toBe(1000);
  });

  it('refuses a double the player cannot afford', () => {
    const t = setup(['5', '10', '6', '7']);
    t.chips.set(1, 150);
    t.betAndDeal(100);
    expect(t.act(1, 'double')).toBe('Not enough chips to double.');
    expect(t.chips.get(1)).toBe(50);
  });

  it('takes turns in seat order and keeps a leaver’s bet in play', () => {
    // P1: 10,8  P2: 10,9  dealer: 10,7
    const t = setup(['10', '10', '10', '8', '9', '7'], [1, 2]);
    t.betAndDeal(100);
    expect(t.state().turn).toEqual({ seat: 0, hand: 0 });
    expect(t.act(2, 'stand')).toBe('It is not your turn.');

    t.table.leave(1); // walks away on their turn: auto-stand
    expect(t.state().seats[0]!.gone).toBe(true);
    expect(t.state().turn).toEqual({ seat: 1, hand: 0 });
    expect(t.table.sit({ id: 1, name: 'P1' }, 4)).toBe('Wait for your last hand to finish.');

    expect(t.act(2, 'stand')).toBeNull();
    t.finishDealer();
    expect(t.chips.get(1)).toBe(1100); // 18 beats 17, paid even though they left
    expect(t.chips.get(2)).toBe(1100);

    vi.advanceTimersByTime(BJ.payoutTimeMs);
    expect(t.state().seats[0]).toBeNull(); // seat is free again
    expect(t.state().seats[1]!.playerId).toBe(2);
  });

  it('goes round the table one move at a time, not one player at a time', () => {
    // Deal: P1 2,3 · P2 2,4 · dealer 10,8. Then hits: P1 gets 2, P2 gets 3, P2 gets 5.
    const t = setup(['2', '2', '10', '3', '4', '8', '2', '3', '5'], [1, 2]);
    t.betAndDeal(100);
    const turn = () => t.state().turn?.seat;
    expect(turn()).toBe(0);
    expect(t.act(1, 'hit')).toBeNull(); // P1: 7
    expect(turn()).toBe(1); // P2's go now, even though P1 could hit again
    expect(t.act(1, 'hit')).toBe('It is not your turn.');
    expect(t.act(2, 'hit')).toBeNull(); // P2: 9
    expect(turn()).toBe(0); // back round to P1
    expect(t.act(1, 'stand')).toBeNull();
    expect(turn()).toBe(1); // P1 is done, so P2 keeps going alone
    expect(t.act(2, 'hit')).toBeNull(); // P2: 14
    expect(turn()).toBe(1);
    expect(t.act(2, 'stand')).toBeNull();
    expect(t.state().phase).toBe('dealer');
    const hands = t.state().seats.filter((s) => s).map((s) => s!.hands[0].cards.map((c) => c.rank).join(','));
    expect(hands).toEqual(['2,3,2', '2,4,3,5']);
  });

  it('a timed-out player is stood and the turn moves on round the table', () => {
    const t = setup(['2', '2', '10', '3', '4', '8', '2'], [1, 2]);
    t.betAndDeal(100);
    expect(t.act(1, 'hit')).toBeNull();
    vi.advanceTimersByTime(BJ.turnTimeMs); // P2 dozes off
    expect(t.state().seats[1]!.hands[0].status).toBe('stood');
    expect(t.state().turn?.seat).toBe(0);
  });

  it('reports each finished hand once, after paying it, and only for players who were in', () => {
    // P1: 10,8 wins against dealer 10,7. P2 sits the round out.
    const t = setup(['10', '10', '8', '7'], [1, 2]);
    expect(t.act(1, 'bet', 100)).toBeNull();
    vi.advanceTimersByTime(BJ.betTimeMs + 2 * 2 * BJ.dealCardMs + 500);
    expect(t.finished).toEqual([]);
    expect(t.act(1, 'stand')).toBeNull();
    t.finishDealer();
    expect(t.finished).toEqual([1]);
    expect(t.chips.get(1)).toBe(1100); // already paid when reported
    vi.advanceTimersByTime(BJ.payoutTimeMs);
    expect(t.finished).toEqual([1]);
  });

  it('reports a split as one finished hand for the run', () => {
    const t = setup(['A', '6', 'A', '10', 'K', '5', '10']);
    t.betAndDeal(100);
    t.act(1, 'split');
    t.finishDealer();
    expect(t.finished).toEqual([1]);
  });

  it('never sends the hole card before the dealer turn', () => {
    const t = setup(['10', '9', '9', 'K']);
    t.betAndDeal(100);
    expect(JSON.stringify(t.state().dealer)).not.toContain('K');
  });
});
