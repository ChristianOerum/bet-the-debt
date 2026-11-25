import { areaAt, CASINO_TOILET, gamesInRoom, LURE_HANDS, NAV_POINTS, navRoute, seatExitPoint, seatWorld, SPAWN, STATIONS, yawOf, type PatronInfo, type Pt } from '@casino/shared';
import type { GameTable } from './games/GameTable';
import type { Player } from './hub';

/** How the regulars behave. Tests turn the timings down. */
export const PATRON = {
  /** How many are about in a lobby's casino. */
  count: 7,
  walkSpeed: 1.35,
  /** How often they move and think, ms. */
  tickMs: 125,
  /** How long a patron mulls over a move before making it, ms (plus up to as much again). */
  thinkMs: 1100,
  /** How close you have to be to talk to one. */
  talkRange: 3.4,
  /** A new face walks in this often while there are fewer than `count`. */
  refillMs: 25_000,
  /** After saying no, they will not be asked again this soon. */
  sulkMs: 20_000,
};

/** Games they will play on their own. Russian roulette only ever with a real person. */
const SOLO_GAMES = ['blackjack', 'roulette', 'baccarat', 'poker', 'liars', 'meyer'];
const GAME_NAMES: Record<string, string> = {
  blackjack: 'blackjack',
  roulette: 'roulette',
  baccarat: 'baccarat',
  poker: "hold'em",
  liars: "liar's dice",
  meyer: 'Meyer',
  russian: 'Russian roulette',
};

const PEOPLE: { name: string; blurb: string; likes: string[]; nerve: number }[] = [
  { name: 'Big Sal', blurb: 'Has been about to win big since 1987.', likes: ['blackjack', 'poker', 'russian'], nerve: 0.85 },
  { name: 'Lucky Lorraine', blurb: 'Kisses every chip before she bets it.', likes: ['roulette', 'baccarat', 'blackjack'], nerve: 0.3 },
  { name: 'Two-Tooth Terry', blurb: 'Lost the other teeth on a bet. Will not say which.', likes: ['liars', 'meyer', 'russian'], nerve: 0.7 },
  { name: 'Velvet Vinnie', blurb: 'Smells of cologne and bad decisions.', likes: ['poker', 'baccarat'], nerve: 0.6 },
  { name: 'Granny Hex', blurb: 'Nobody has ever seen her lose. Nobody has seen her blink either.', likes: ['liars', 'roulette', 'meyer', 'russian'], nerve: 0.95 },
  { name: 'Nervous Ned', blurb: 'Sweating through his third shirt tonight.', likes: ['blackjack', 'roulette'], nerve: 0.1 },
  { name: 'Count Chipula', blurb: 'Only comes out at night. Collects other people\'s chips.', likes: ['poker', 'blackjack', 'baccarat', 'russian'], nerve: 0.75 },
  { name: 'Rosie Rollover', blurb: 'Asks everyone at the table for their star sign.', likes: ['meyer', 'roulette', 'liars'], nerve: 0.35 },
  { name: 'Tiny Tony', blurb: 'Seven feet tall. Nobody remembers why he is called Tiny.', likes: ['blackjack', 'poker', 'meyer'], nerve: 0.8 },
  { name: 'Professor Odds', blurb: 'Has a system. The system is losing.', likes: ['roulette', 'blackjack', 'baccarat', 'liars'], nerve: 0.25 },
  { name: 'Captain Snake-Eyes', blurb: 'Rolls dice with an eyepatch on. Both eyes are fine.', likes: ['meyer', 'liars', 'russian'], nerve: 0.65 },
  { name: 'Doug', blurb: 'Just Doug.', likes: ['blackjack', 'roulette', 'poker', 'baccarat', 'liars', 'meyer'], nerve: 0.5 },
];

const SAY = {
  hm: ['Hm?', 'Yeah?', 'Can I help you?', 'Do I know you?', 'Make it quick.'],
  hello: ['Lead the way!', "Now you're talking.", 'Hope you brought chips.', "Deal me in, I'm feeling lucky.", 'You are on.'],
  notMine: ["Not my game, pal.", "Never touch the stuff.", 'Ask somebody who likes losing at that.'],
  notHere: ["There's no table for that in here.", 'Do you see one of those tables around here?', 'Ask me where they play it.'],
  busy: ['Maybe later. I am on a break.', 'Not now, I am watching the room.', 'Give me a minute.'],
  russianNo: ['With YOU? Not a chance.', 'I have a family. Well, a cat.', 'Absolutely not.'],
  russianYes: ["...Fine. I've got nothing left to lose.", 'Six chambers. I like those odds.', "Let's dance."],
  sulking: ['I said no.', 'Still no.', 'Ask me again and see what happens.'],
  askYes: ['Fine, fine. The seat is yours.', 'I was done anyway.', 'Only because you asked nicely.'],
  askNo: ["I'm on a hot streak. Get your own seat.", 'Find another table, sunshine.', 'Not a chance. I was here first.'],
  threatYes: ['OK OK OK! Going!', 'No need for that, I am leaving!', 'I know when I am not wanted...'],
  threatNo: ['Try it.', "You don't scare me.", 'Big words for someone that size.', "Bouncer! This one's bothering me. ...Bouncer?"],
  broke: ["I'm cleaned out. Again.", 'That was my rent money.', 'Night, all. Never again. See you tomorrow.'],
  bored: ['I need some air.', 'Let me stretch my legs.', 'Time for a drink.'],
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Aisle points a patron might drift to. Not the back room (not for strolling), nor the restrooms (they go there on purpose). */
const STROLL = NAV_POINTS.filter((p) => areaAt(p)?.id !== 'back' && areaAt(p)?.id !== 'restroom');

let nextId = -1;

export interface Patron {
  id: number;
  name: string;
  color: string;
  blurb: string;
  likes: string[];
  /** 0 does what they are told; 1 does not. */
  nerve: number;
  chips: number;
  x: number;
  z: number;
  yaw: number;
  mode: 'idle' | 'walking' | 'seated' | 'leaving' | 'gone';
  path: Pt[];
  /** What happens when the walk ends. */
  arrive: (() => void) | null;
  idleUntil: number;
  stationId: string | null;
  /** Games left before they get restless. */
  patience: number;
  /** A player who brought them to the table. */
  invitedBy: number | null;
  thinkUntil: number;
  sulkUntil: number;
  /** Since when nobody they came to play with has been at the table. */
  aloneSince: number;
  health: number;
  /** Hands played at the same table as each player (by id). */
  playedWith: Map<number, number>;
  /** In the toilet stall (on their own, or with someone who asked them along). */
  inToilet: boolean;
}

/** What the patrons need from the world they are in. */
export interface PatronHost {
  tables: Map<string, GameTable>;
  members(): Iterable<Player>;
  /** Broadcast to everyone in this world. */
  emit: (event: 'patronJoined' | 'patronLeft' | 'moved' | 'chat', ...args: unknown[]) => void;
  /** Have security show them out. False if security is busy. */
  escort(p: Patron): boolean;
  /** The only way back from a table to a patron: get them out of their seat. */
  leaveTable(p: Patron): void;
}

const COLORS = ['#ff6b8b', '#ff9f43', '#ffd34e', '#5ed39a', '#4ac6e8', '#6c8cff', '#b07cff', '#f4f0e6', '#c4a07a', '#9ad1c0'];

/**
 * The house's regulars: they stroll about, sit down to play on their own, and can be asked
 * to a game or out of a chair. Their chips are their own; whatever you win off them is yours.
 */
export class Patrons {
  private list = new Map<number, Patron>();
  private ticker: ReturnType<typeof setInterval>;
  private lastRefill = Date.now();
  private now = Date.now();

  constructor(private host: PatronHost) {
    // Some already at the tables, some standing about.
    const cast = [...PEOPLE].sort(() => Math.random() - 0.5).slice(0, PATRON.count);
    cast.forEach((who, k) => {
      const p = this.make(who);
      const at = STROLL[Math.floor(Math.random() * STROLL.length)];
      Object.assign(p, { x: at.x + (Math.random() - 0.5), z: at.z + (Math.random() - 0.5) });
      this.list.set(p.id, p);
      // Once the casino is fully set up (the tables ask it about their chips).
      if (k % 2 === 0) this.later(0, () => this.goPlay(p, true));
    });
    this.ticker = setInterval(() => this.tick(), PATRON.tickMs);
  }

  private timers = new Set<ReturnType<typeof setTimeout>>();

  dispose() {
    clearInterval(this.ticker);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private make(who: (typeof PEOPLE)[number]): Patron {
    return {
      id: nextId--,
      name: who.name,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      blurb: who.blurb,
      likes: who.likes,
      nerve: who.nerve,
      chips: 300 + Math.round(Math.random() * 15) * 100,
      x: SPAWN.x,
      z: SPAWN.z,
      yaw: SPAWN.yaw,
      mode: 'idle',
      path: [],
      arrive: null,
      idleUntil: Date.now() + 2000 + Math.random() * 8000,
      stationId: null,
      patience: 3 + Math.floor(Math.random() * 6),
      invitedBy: null,
      thinkUntil: 0,
      sulkUntil: 0,
      aloneSince: 0,
      health: 100,
      playedWith: new Map(),
      inToilet: false,
    };
  }

  info(p: Patron): PatronInfo {
    return { id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, yaw: p.yaw, zone: 'casino', outfit: [], likes: [...p.likes], blurb: p.blurb };
  }

  all(): PatronInfo[] {
    return [...this.list.values()].filter((p) => p.mode !== 'gone').map((p) => this.info(p));
  }

  get(id: number) {
    const p = this.list.get(id);
    return p && p.mode !== 'gone' ? p : undefined;
  }

  // ---- chips (the tables reach these through the casino) ---------------------------------

  chips(id: number) {
    return this.get(id)?.chips ?? 0;
  }

  addChips(id: number, delta: number) {
    const p = this.get(id);
    if (p) p.chips = Math.max(0, p.chips + delta);
  }

  /** A hand they played is over. Broke? Out they go. Bored? Up they get. */
  handFinished(id: number) {
    const p = this.get(id);
    if (!p) return;
    p.patience--;
    for (const m of this.host.members()) {
      if (m.stationId === p.stationId && m.run === 'alive') p.playedWith.set(m.id, (p.playedWith.get(m.id) ?? 0) + 1);
    }
    // Let the table finish paying everyone before anyone gets up.
    this.later(1500, () => {
      if (p.mode !== 'seated') return;
      if (p.chips < 10) this.broke(p);
      else if (p.patience <= 0 && (!this.withFriend(p) || p.patience < -8)) this.standUp(p, pick(SAY.bored));
    });
  }

  /** Shot at the table. The others keep their chips; the body is gone in a few seconds. */
  killed(id: number, afterMs: number) {
    const p = this.get(id);
    if (!p) return;
    p.mode = 'leaving';
    p.stationId = null;
    p.health = 0;
    p.path = []; // they drop where they are
    p.arrive = null;
    this.later(afterMs, () => this.remove(p));
  }

  /** Security walked them out. */
  shownOut(p: Patron) {
    this.remove(p);
  }

  private remove(p: Patron) {
    if (p.mode === 'gone') return;
    p.mode = 'gone';
    this.list.delete(p.id);
    this.host.emit('patronLeft', p.id);
  }

  /** Somebody punched a regular. Most complain. Some have had enough and go home. */
  punched(id: number, by: Player) {
    const p = this.get(id);
    if (!p || p.mode === 'leaving') return;
    if (Math.random() < 0.45 - p.nerve * 0.3) {
      this.say(p, pick(["That's it, I'm going home!", 'Animals. The lot of you.', 'Security! ...Never mind. Bye.']));
      this.host.leaveTable(p);
      p.stationId = null;
      this.leaveCasino(p);
      return;
    }
    const tough = p.nerve > 0.7;
    this.say(p, tough ? pick([`Is that all you've got, ${by.name}?`, 'My granny hits harder.', 'Do that again. I dare you.']) : pick(['OW!', 'What was that for?!', 'Ow! My nose!', 'Hey! Watch it!']));
  }

  /** Shot, but still standing: they run for the door. */
  wounded(id: number) {
    const p = this.get(id);
    if (!p || p.mode === 'leaving') return;
    this.say(p, pick(["AAAH! I'm hit!", 'Somebody has a GUN!', 'Call an ambulance!', 'Not the face!']));
    this.host.leaveTable(p);
    p.stationId = null;
    p.inToilet = false;
    this.leaveCasino(p);
  }

  /** A gun went off: some of those close enough to hear it say so. */
  heardShot(at: Pt, range: number, except: number | null) {
    for (const p of this.list.values()) {
      if (p.id === except || p.mode === 'gone' || p.mode === 'leaving') continue;
      if (Math.hypot(p.x - at.x, p.z - at.z) > range) continue;
      if (Math.random() < 0.3) this.say(p, pick(['Was that a gunshot?!', 'GET DOWN!', 'Oh my god.', 'Security!']));
    }
  }

  /** "Step into the bathroom with me a minute?" Only someone who has played a few hands with you says yes. */
  lure(by: Player, id: number) {
    const p = this.get(id);
    if (!p) return;
    if (!this.inReach(by, p, 1.5)) return by.socket.emit('notice', `${p.name} has wandered off.`, 'bad');
    if (p.mode === 'leaving') return;
    if ((p.playedWith.get(by.id) ?? 0) < LURE_HANDS) {
      return this.say(p, pick(['The bathroom? With you? I barely know you.', 'Buy me a drink first.', 'Weird thing to ask a stranger.']));
    }
    if (p.mode === 'seated' && p.stationId && this.host.tables.get(p.stationId)?.hasStake(p.id)) return this.say(p, 'After this hand.');
    this.say(p, pick(['...Sure. What have you got?', 'Lead the way, friend.', 'Is this about what I think it is about?', 'Fine. Two minutes.']));
    this.host.leaveTable(p);
    p.stationId = null;
    p.invitedBy = null;
    this.goToToilet(p, 45_000);
  }

  /** Into the stall, and wait there a while. */
  private goToToilet(p: Patron, stayMs: number) {
    const stand = CASINO_TOILET.stand;
    this.walk(p, { x: stand.x, z: stand.z }, false, () => {
      p.inToilet = true;
      p.yaw = stand.yaw;
      this.host.emit('moved', p.id, p.x, p.z, p.yaw, 0);
      this.idle(p, stayMs);
    });
  }

  /** Someone (another regular) is in there, or on the way. */
  private toiletTaken(except: Patron) {
    const stand = CASINO_TOILET.stand;
    for (const o of this.list.values()) {
      if (o === except || o.mode === 'gone') continue;
      const end = o.path[o.path.length - 1];
      if (o.inToilet || (end && Math.hypot(end.x - stand.x, end.z - stand.z) < 0.5)) return true;
    }
    return false;
  }

  /** The nearest regular (within shouting distance) has something to say about what just happened. */
  react(at: Pt, lines: readonly string[]) {
    let best: Patron | null = null;
    let bd = 9;
    for (const p of this.list.values()) {
      if (p.mode === 'gone' || p.mode === 'leaving') continue;
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) this.say(best, pick(lines));
  }

  private say(p: Patron, text: string) {
    this.host.emit('chat', { id: p.id, name: p.name, color: p.color, text });
  }

  // ---- what players ask of them ------------------------------------------------------------

  /** Someone walked up to talk: stop, turn round, and listen for a bit. */
  hail(by: Player, id: number) {
    const p = this.get(id);
    if (!p || !this.inReach(by, p, 1.5) || (p.mode !== 'idle' && p.mode !== 'walking')) return;
    if (p.stationId) {
      // They were on their way to a table on their own: that can wait.
      this.targetSeat.delete(p.id);
      p.stationId = null;
    }
    this.idle(p, 15_000);
    p.yaw = yawOf(by.x - p.x, by.z - p.z);
    this.host.emit('moved', p.id, p.x, p.z, p.yaw, 0);
    this.say(p, pick(SAY.hm));
  }

  /** "Fancy a game of ...?" Returns nothing: the patron answers out loud. */
  invite(by: Player, id: number, gameType: string) {
    const p = this.get(id);
    if (!p) return;
    if (!this.inReach(by, p, 2.5)) return by.socket.emit('notice', `${p.name} has wandered off.`, 'bad');
    if (p.mode === 'seated' || p.mode === 'leaving') return;
    const now = Date.now();
    if (now < p.sulkUntil) return this.say(p, pick(SAY.sulking));
    if (!p.likes.includes(gameType)) return this.say(p, pick(SAY.notMine));
    // Only a game with a table right here in this room.
    if (!gamesInRoom(by).includes(gameType)) return this.say(p, pick(SAY.notHere));
    if (gameType === 'russian') {
      if (Math.random() > p.nerve) {
        p.sulkUntil = now + PATRON.sulkMs;
        return this.say(p, pick(SAY.russianNo));
      }
    } else if (Math.random() < 0.12) {
      p.sulkUntil = now + PATRON.sulkMs / 2;
      return this.say(p, pick(SAY.busy));
    }
    const station = this.pickTable(gameType, by);
    if (!station) return this.say(p, `Every ${GAME_NAMES[gameType]} table is full.`);
    this.say(p, gameType === 'russian' ? pick(SAY.russianYes) : pick(SAY.hello));
    p.invitedBy = by.id;
    p.patience = 4 + Math.floor(Math.random() * 5);
    this.walkToSeat(p, station.table, station.seat);
  }

  /** Get them out of their chair. Nicely, or not. */
  evict(by: Player, id: number, how: 'ask' | 'threaten') {
    const p = this.get(id);
    if (!p || p.mode !== 'seated') return;
    if (!this.inReach(by, p, 1.5)) return by.socket.emit('notice', `You need to be standing right next to ${p.name}.`, 'bad');
    const now = Date.now();
    if (how === 'ask') {
      // A second polite ask after a no gets nowhere.
      if (now < p.sulkUntil) return this.say(p, pick(SAY.sulking));
      if (Math.random() < p.nerve * 0.85) {
        p.sulkUntil = now + PATRON.sulkMs;
        return this.say(p, pick(SAY.askNo));
      }
      this.standUp(p, pick(SAY.askYes));
      return;
    }
    // Most people fold when leaned on. The real hard cases do not.
    if (Math.random() < p.nerve * 0.45) return this.say(p, pick(SAY.threatNo));
    this.say(p, pick(SAY.threatYes));
    this.host.leaveTable(p);
    p.stationId = null;
    this.leaveCasino(p); // spooked: they go home
  }

  /** `slack` = extra metres allowed, for things said a moment after walking up. */
  private inReach(by: Player, p: Patron, slack = 0) {
    return by.run === 'alive' && !by.doomed && by.zone === 'casino' && Math.hypot(by.x - p.x, by.z - p.z) <= PATRON.talkRange + slack;
  }

  /** A free seat at a table of this type, nearest the player who asked. */
  private pickTable(type: string, near: Pt): { table: string; seat: number } | null {
    const options = STATIONS.filter((st) => st.type === type && this.host.tables.has(st.id))
      .map((st) => ({ st, seat: this.freeSeat(st.id) }))
      .filter((o) => o.seat >= 0)
      .sort((a, b) => Math.hypot(a.st.x - near.x, a.st.z - near.z) - Math.hypot(b.st.x - near.x, b.st.z - near.z));
    return options.length ? { table: options[0].st.id, seat: options[0].seat } : null;
  }

  /** A seat nobody is in and no other patron is heading for. -1 if none. */
  private freeSeat(stationId: string): number {
    const state = this.host.tables.get(stationId)!.publicState() as { seats: unknown[] };
    const reserved = new Set([...this.list.values()].filter((o) => o.mode === 'walking' && o.stationId === stationId).map((o) => this.targetSeat.get(o.id)));
    const free = state.seats.map((s, i) => (s === null && !reserved.has(i) ? i : -1)).filter((i) => i >= 0);
    return free.length ? free[Math.floor(Math.random() * free.length)] : -1;
  }

  private targetSeat = new Map<number, number>();

  // ---- getting about -----------------------------------------------------------------------

  /** Off to play something they like, on their own account. `instant` = already sitting there. */
  private goPlay(p: Patron, instant = false) {
    const games = p.likes.filter((g) => SOLO_GAMES.includes(g)).sort(() => Math.random() - 0.5);
    for (const g of games) {
      const station = this.pickTable(g, p);
      if (!station) continue;
      p.invitedBy = null;
      p.patience = 3 + Math.floor(Math.random() * 6);
      if (instant) {
        const st = STATIONS.find((s) => s.id === station.table)!;
        const spot = seatExitPoint(seatWorld(st, station.seat));
        Object.assign(p, { x: spot.x, z: spot.z });
        this.sit(p, station.table, station.seat);
      } else {
        this.walkToSeat(p, station.table, station.seat);
      }
      return;
    }
    this.stroll(p);
  }

  private walkToSeat(p: Patron, stationId: string, seat: number) {
    const st = STATIONS.find((s) => s.id === stationId)!;
    const spot = seatExitPoint(seatWorld(st, seat));
    p.stationId = stationId;
    this.targetSeat.set(p.id, seat);
    this.walk(p, spot, st.type === 'russian', () => {
      this.targetSeat.delete(p.id);
      // Taken while we walked over? Any other chair at the table will do.
      const s = this.host.tables.get(stationId)!.publicState() as { seats: unknown[] };
      const chosen = s.seats[seat] === null ? seat : s.seats.findIndex((x) => x === null);
      if (chosen < 0) {
        p.stationId = null;
        p.invitedBy = null;
        this.say(p, 'Oh. No room. Never mind.');
        this.idle(p);
        return;
      }
      this.sit(p, stationId, chosen);
    });
  }

  private sit(p: Patron, stationId: string, seat: number) {
    const err = this.host.tables.get(stationId)!.sit({ id: p.id, name: p.name }, seat);
    if (err) {
      p.stationId = null;
      this.idle(p);
      return;
    }
    p.mode = 'seated';
    p.stationId = stationId;
    p.thinkUntil = 0;
    p.aloneSince = 0;
  }

  /** Out of the chair and back to wandering. */
  private standUp(p: Patron, line?: string) {
    if (line) this.say(p, line);
    this.host.leaveTable(p);
    p.stationId = null;
    p.invitedBy = null;
    this.idle(p, 1500);
    this.host.emit('moved', p.id, p.x, p.z, p.yaw, 0);
  }

  private broke(p: Patron) {
    this.say(p, pick(SAY.broke));
    if (p.chips === 0 && this.host.escort(p)) {
      p.mode = 'leaving';
      return; // security has them now
    }
    this.host.leaveTable(p);
    p.stationId = null;
    this.leaveCasino(p);
  }

  private leaveCasino(p: Patron) {
    p.invitedBy = null;
    this.walk(p, SPAWN, false, () => this.remove(p));
    p.mode = 'leaving';
  }

  private stroll(p: Patron) {
    const to = STROLL[Math.floor(Math.random() * STROLL.length)];
    this.walk(p, { x: to.x + (Math.random() - 0.5) * 1.2, z: to.z + (Math.random() - 0.5) * 1.2 }, false, () => this.idle(p));
  }

  private idle(p: Patron, ms = 4000 + Math.random() * 10_000) {
    p.mode = 'idle';
    p.path = [];
    p.arrive = null;
    p.idleUntil = Date.now() + ms;
  }

  private walk(p: Patron, to: Pt, backRoom: boolean, arrive: () => void) {
    const inBack = areaAt(p)?.id === 'back';
    let path = navRoute(p, to, backRoom || inBack);
    if (!path) {
      // Somewhere awkward: start from the nearest aisle point.
      const near = [...NAV_POINTS].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      path = [{ x: p.x, z: p.z }, ...(navRoute(near, to, backRoom || inBack) ?? [near, to])];
    }
    p.path = path.slice(1);
    p.arrive = arrive;
    if (p.mode !== 'leaving') p.mode = 'walking';
  }

  // ---- every tick ----------------------------------------------------------------------------

  private tick() {
    this.now = Date.now();
    for (const p of [...this.list.values()]) {
      if (p.path.length) this.step(p);
      else if (p.mode === 'idle' && this.now >= p.idleUntil) {
        p.inToilet = false;
        // Nature calls now and then.
        if (Math.random() < 0.1 && !this.toiletTaken(p)) this.goToToilet(p, 10_000 + Math.random() * 10_000);
        else if (Math.random() < 0.45) this.goPlay(p);
        else this.stroll(p);
      } else if (p.mode === 'seated') this.play(p);
    }
    const here = [...this.list.values()].filter((p) => p.mode !== 'gone').length;
    if (here < PATRON.count && this.now - this.lastRefill > PATRON.refillMs) {
      this.lastRefill = this.now;
      const taken = new Set([...this.list.values()].map((p) => p.name));
      const who = PEOPLE.filter((w) => !taken.has(w.name));
      if (who.length) {
        const p = this.make(pick(who));
        this.list.set(p.id, p);
        this.host.emit('patronJoined', this.info(p));
        this.idle(p, 500);
        this.stroll(p);
      }
    }
  }

  private step(p: Patron) {
    let left = (PATRON.walkSpeed * PATRON.tickMs) / 1000;
    while (left > 0 && p.path.length) {
      const t = p.path[0];
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) p.yaw = yawOf(dx, dz);
      if (d <= left) {
        p.x = t.x;
        p.z = t.z;
        left -= d;
        p.path.shift();
      } else {
        p.x += (dx / d) * left;
        p.z += (dz / d) * left;
        left = 0;
      }
    }
    this.host.emit('moved', p.id, p.x, p.z, p.yaw, 0);
    if (!p.path.length) {
      const done = p.arrive;
      p.arrive = null;
      done?.();
    }
  }

  /** At the table: make the next move, after a moment's thought. */
  private play(p: Patron) {
    const table = p.stationId ? this.host.tables.get(p.stationId) : undefined;
    if (!table || !table.seatPose(p.id)) {
      // The table let them go (or worse).
      if (p.mode === 'seated') {
        p.stationId = null;
        this.idle(p, 1500);
      }
      return;
    }
    // Brought here by a player who has since wandered off? They do not wait long.
    if (p.invitedBy !== null) {
      if (this.withFriend(p)) p.aloneSince = 0;
      else if (!p.aloneSince) p.aloneSince = this.now;
      else if (this.now - p.aloneSince > 45_000 && !table.hasStake(p.id)) {
        this.standUp(p, 'Stood up again. Typical.');
        return;
      }
    }
    // Waiting at the Russian roulette table with nobody to play with is just sad.
    if (table.type === 'russian' && !this.withFriend(p) && !table.hasStake(p.id)) {
      if (!p.aloneSince) p.aloneSince = this.now;
      else if (this.now - p.aloneSince > 40_000) {
        this.standUp(p, 'Nobody? Fine.');
        return;
      }
    }
    const move = table.botMove(p.id);
    if (!move) {
      p.thinkUntil = 0;
      return;
    }
    if (!p.thinkUntil) {
      p.thinkUntil = this.now + PATRON.thinkMs * (1 + Math.random());
      return;
    }
    if (this.now < p.thinkUntil) return;
    p.thinkUntil = 0;
    table.action(p.id, move);
  }

  /** Is someone who is not a patron sitting at their table? */
  private withFriend(p: Patron) {
    if (!p.stationId) return false;
    for (const m of this.host.members()) if (m.stationId === p.stationId && m.run === 'alive') return true;
    return false;
  }
}
