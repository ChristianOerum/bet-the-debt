import {
  advanceRun,
  runScore,
  type Difficulty,
  alcoholKills,
  aptBed,
  aptFridge,
  atBar,
  consume,
  gutOdds,
  HOTBAR_SLOTS,
  menuItem,
  morningVitals,
  portions,
  PUNCH,
  tickVitals,
  toiletAt,
  VITALS,
  aptDoor,
  aptOutYaw,
  APT_SLOTS,
  CASHIER,
  cashFor,
  inWalkable,
  planEscort,
  PLAYER_RADIUS,
  RUN,
  runState,
  seatExitPoint,
  shopItem,
  SPAWN,
  STATIONS,
  walkableFor,
  zoneAt,
  drugInfo,
  gunInfo,
  heldInfo,
  LOOT_RANGE,
  SHOOT,
  shotHits,
  stallHideFor,
  witnesses,
  type Body,
  type DrugId,
  type HeldItem,
  type Target,
  type DoorAccess,
  type LobbyInfo,
  type PlayerInfo,
  type Post,
  type Pt,
  type ZoneKey,
} from '@casino/shared';
import type { GameTable, TableContext } from './games/GameTable';
import { TABLE_TYPES } from './games/registry';
import type { GameServer, Hub, Player } from './hub';
import { Patrons, type Patron } from './patrons';
import type { Store } from './store/Store';

interface EscortJob {
  id: number;
  round: number;
  byAnte: boolean;
  cause: 'broke' | 'murder';
}

/** How long a body lies in the open before the staff find it. A killer still in the casino then gets caught on camera. */
export const BODIES = { foundMs: 40_000, clearedMs: 150_000 };

const isPatronId = (id: number) => id < 0;
const drugOn = (p: Player, d: DrugId) => (p.effects[d] ?? 0) > Date.now();
const copyItems = (items: (HeldItem | null)[]) => items.map((h) => (h ? { ...h } : null));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const near = (a: Pt, b: Pt, d = 2.6) => Math.hypot(a.x - b.x, a.z - b.z) <= d;

/**
 * One world: the street, the apartment building, and (for a lobby) the casino with its
 * tables. Everyone in it sees everyone else in the same part of it.
 */
export class Instance {
  private members = new Map<number, Player>();
  private tables = new Map<string, GameTable>();
  private leaderboardTimer: ReturnType<typeof setTimeout> | null = null;
  /** There are two bouncers at the exit, so people are shown out one at a time. */
  private escortQueue: EscortJob[] = [];
  private escorting = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  /** The house's regulars. Only a lobby's casino has them. */
  readonly patrons: Patrons | null = null;
  /** The dead on the casino floor (and in the toilet stall). */
  private bodies: Body[] = [];
  private nextBodyId = 1;

  constructor(
    private io: GameServer,
    private store: Store,
    private hub: Hub,
    readonly room: string,
    /** The lobby code, or null for someone on their own. */
    readonly code: string | null,
    /** How hard the house squeezes, for everyone in this lobby. */
    readonly difficulty: Difficulty = 'hard',
  ) {
    if (!code) return; // nobody plays alone: the casino only opens for a lobby
    for (const st of STATIONS) {
      const make = TABLE_TYPES[st.type];
      if (!make) continue;
      // Patrons (negative ids) keep their own chips; everyone else is a player on a run.
      const ctx: TableContext = {
        getChips: (id) => (isPatronId(id) ? (this.patrons?.chips(id) ?? 0) : (this.alive(id)?.chips ?? 0)),
        addChips: (id, delta) => (isPatronId(id) ? this.patrons?.addChips(id, delta) : this.addChips(id, delta)),
        changed: () => this.tableChanged(st.id),
        handFinished: (id) => (isPatronId(id) ? this.patrons?.handFinished(id) : this.handFinished(id)),
        kill: (id, cause) => (isPatronId(id) ? this.killPatron(id, st.id, cause) : this.killAtTable(id, st.id, cause)),
      };
      this.tables.set(st.id, make(st.id, ctx));
    }
    this.patrons = new Patrons({
      tables: this.tables,
      members: () => this.members.values(),
      emit: (event, ...args) => (this.io.to(this.room).emit as (e: string, ...a: unknown[]) => void)(event, ...args),
      escort: (p) => this.escortPatron(p),
      leaveTable: (p) => {
        if (p.stationId) this.tables.get(p.stationId)?.leave(p.id);
      },
    });
  }

  get size() {
    return this.members.size;
  }

  private alive(id: number) {
    const p = this.members.get(id);
    return p && p.run === 'alive' ? p : undefined;
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // ---- coming and going ------------------------------------------------------------

  /** Bring someone in. `place` decides where, given the apartment slot they get. */
  add(p: Player, place: (slot: number) => Post & { zone: ZoneKey }, wakeUp: boolean) {
    const used = new Set([...this.members.values()].map((m) => m.slot));
    p.slot = Array.from({ length: APT_SLOTS }, (_, i) => i).find((i) => !used.has(i)) ?? 0;
    const at = place(p.slot);
    Object.assign(p, { instance: this, zone: at.zone, x: at.x, z: at.z, yaw: at.yaw, run: 'none', chips: 0, doomed: false, stationId: null });
    this.members.set(p.id, p);
    void p.socket.join(this.room);
    this.pocketGuns(p, false);

    const tables: Record<string, unknown> = {};
    for (const [id, t] of this.tables) tables[id] = t.publicState();
    void this.store.leaderboard(8).then((leaderboard) => {
      if (p.instance !== this) return;
      p.socket.emit('welcome', {
        you: this.info(p),
        slot: p.slot,
        cash: p.cash,
        aptLevel: p.aptLevel,
        owned: [...p.owned],
        vitals: { ...p.vitals },
        items: copyItems(p.items),
        lobby: this.lobbyInfo(),
        chips: 0,
        run: null,
        ghost: false,
        wakeUp,
        players: [...this.members.values()].filter((o) => o !== p).map((o) => this.info(o)),
        patrons: this.patrons?.all() ?? [],
        tables,
        leaderboard,
        bodies: this.bodies.map((b) => ({ ...b, items: b.items.map((h) => ({ ...h })) })),
        effects: { ...p.effects },
      });
    });
    p.socket.to(this.room).emit('playerJoined', this.info(p));
    this.io.to(this.room).emit('lobby', this.lobbyInfo());
  }

  /** Someone leaves this world (for another, or for good). A run they were on is lost. */
  remove(p: Player) {
    if (!this.members.has(p.id)) return;
    this.leaveTable(p);
    if (p.run !== 'none') this.saveBest(p);
    p.run = 'none';
    p.doomed = false;
    this.members.delete(p.id);
    void p.socket.leave(this.room);
    p.instance = null;
    // Anyone visiting their flat finds themselves back out in the corridor.
    for (const o of this.members.values()) {
      if (o.zone !== `apt:${p.slot}`) continue;
      const d = aptDoor(p.slot, p.aptLevel);
      this.teleport(o, 'hall', { x: d.x + (p.slot < 4 ? 1 : -1), z: d.z, yaw: aptOutYaw(p.slot) });
    }
    this.io.to(this.room).emit('playerLeft', p.id);
    this.io.to(this.room).emit('lobby', this.lobbyInfo());
    this.checkRunEnd();
    if (this.members.size === 0) this.hub.emptied(this);
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const t of this.tables.values()) t.dispose();
    this.patrons?.dispose();
    if (this.leaderboardTimer) clearTimeout(this.leaderboardTimer);
  }

  private info(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, yaw: p.yaw, zone: p.run === 'ghost' ? 'void' : p.zone, outfit: [...p.outfit] };
  }

  private lobbyInfo(): LobbyInfo {
    return {
      code: this.code,
      difficulty: this.difficulty,
      members: [...this.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        slot: m.slot,
        aptLevel: m.aptLevel,
        home: m.owned.filter((id) => shopItem(id)?.category === 'home'),
      })),
    };
  }

  /** Someone's flat changed (bigger, or new things in it): tell the building. */
  lobbyChanged() {
    this.io.to(this.room).emit('lobby', this.lobbyInfo());
  }

  /** Someone changed clothes. */
  dressed(p: Player) {
    this.io.to(this.room).emit('dressed', p.id, [...p.outfit]);
  }

  /** Put someone somewhere else in this world, and tell everyone. */
  private teleport(p: Player, zone: ZoneKey, at: Post) {
    p.zone = zone;
    p.x = at.x;
    p.z = at.z;
    p.yaw = at.yaw;
    p.socket.emit('teleported', p.id, zone, at.x, at.z, at.yaw);
    p.socket.to(this.room).emit('teleported', p.id, p.run === 'ghost' ? 'void' : zone, at.x, at.z, at.yaw);
  }

  // ---- what players do -------------------------------------------------------------

  /**
   * Which doors open for someone. The casino lets a lobby in, but not back out while they
   * are on a run (that is what the cashier is for). Every flat in the lobby is open house.
   */
  access(p: Player): DoorAccess {
    return {
      casino: !!this.code && p.run === 'none',
      apts: [...this.members.values()].map((m) => ({ slot: m.slot, level: m.aptLevel })),
    };
  }

  onMove(p: Player, x: number, z: number, yaw: number, y: number) {
    if (![x, z, yaw].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
    if (p.stationId || p.doomed) return;
    // Somewhere a person can be, with the doors that open for them. A little more forgiving than the browsers are.
    if (!inWalkable({ x, z }, PLAYER_RADIUS * 0.5, walkableFor(this.access(p), true))) return;
    p.x = x;
    p.z = z;
    p.yaw = yaw;
    const zone = zoneAt({ x, z });
    if (zone !== p.zone && p.run !== 'ghost') {
      const from = p.zone;
      p.zone = zone;
      // Through the casino doors with nothing on you: the house fronts you a stack.
      if (zone === 'casino' && from === 'street' && p.run === 'none' && this.code) this.enterCasino(p);
    }
    if (p.run === 'ghost') return; // nobody can see you
    const height = typeof y === 'number' && Number.isFinite(y) ? clamp(y, 0, 2) : 0;
    p.socket.to(this.room).volatile.emit('moved', p.id, p.x, p.z, p.yaw, height);
  }

  onChat(p: Player, text: unknown) {
    if (typeof text !== 'string') return;
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    const now = Date.now();
    if (!clean || now - p.lastChat < 400) return;
    p.lastChat = now;
    const name = p.run === 'ghost' ? `${p.name} (ghost)` : p.name;
    this.io.to(this.room).emit('chat', { id: p.id, name, color: p.color, text: clean });
  }

  onSit(p: Player, stationId: string, seat: number) {
    if (p.stationId || p.doomed || p.run !== 'alive' || p.zone !== 'casino') return;
    const table = this.tables.get(stationId);
    if (!table) return;
    const err = table.sit({ id: p.id, name: p.name }, seat);
    if (err) p.socket.emit('notice', err, 'bad');
    else p.stationId = stationId;
  }

  onLeaveTable(p: Player) {
    if (!p.doomed) this.leaveTable(p);
  }

  onAction(p: Player, stationId: string, action: unknown) {
    if (p.stationId !== stationId || p.doomed) return;
    const err = this.tables.get(stationId)?.action(p.id, action);
    if (err) p.socket.emit('notice', err, 'bad');
  }

  // ---- runs ------------------------------------------------------------------------

  /** Through the doors with 500 of the house's chips. The doors shut behind you. */
  private enterCasino(p: Player) {
    p.run = 'alive';
    p.chips = RUN.startChips;
    p.round = 1;
    p.hands = 0;
    p.gutMisses = 0;
    p.doomed = false;
    p.socket.emit('chips', p.chips);
    p.socket.emit('run', runState(1, 0, p.best, this.difficulty, p.bestLevel));
    p.socket.emit('notice', `The house fronts you ${RUN.startChips} chips. Pay them back at the cashier; the rest is yours.`, 'info');
  }

  /** At the cashier: pay back the house, keep the rest, go home rich (or not). */
  cashOut(p: Player) {
    if (p.run !== 'alive' || p.zone !== 'casino' || p.doomed) return;
    if (!near({ x: p.x, z: p.z }, CASHIER, 3)) return;
    if (p.stationId) {
      if (this.tables.get(p.stationId)?.hasStake(p.id)) {
        p.socket.emit('notice', 'Finish your hand first.', 'bad');
        return;
      }
      this.leaveTable(p);
    }
    const cash = cashFor(p.chips);
    const chips = p.chips;
    p.cash += cash;
    // Every cash-out goes on the bank statement, even the ones the house took all of.
    this.store.addCash(p.id, cash, `Casino cash-out: ${chips} chips in round ${p.round}`).catch((err) => console.error('Could not save cash', p.id, err));
    this.saveBest(p);
    p.run = 'none';
    p.chips = 0;
    p.socket.emit('cash', p.cash);
    p.socket.emit('chips', 0);
    p.socket.emit('run', null);
    p.socket.emit(
      'notice',
      cash > 0
        ? `You cash ${chips} chips. After paying back the house, you walk out with $${cash}. The doormen will let you out now.`
        : `You cash ${chips} chips, and the house takes them all back. The doormen will let you out now.`,
      'info',
    );
    this.queueLeaderboard();
    this.checkRunEnd();
  }

  private saveBest(p: Player) {
    // Better than their best run ever? Runs at different levels compare by round plus handicap.
    if (runScore(p.round, this.difficulty) > runScore(p.best, p.bestLevel)) {
      p.best = p.round;
      p.bestLevel = this.difficulty;
    }
    this.store.setBest(p.id, p.round, this.difficulty).catch((err) => console.error('Could not save best round', p.id, err));
    this.queueLeaderboard();
  }

  /** Dead: drift round the casino unseen until your friends are done. */
  private makeGhost(p: Player) {
    if (this.members.get(p.id) !== p) return;
    this.stopPee(p);
    this.leaveTable(p);
    this.loseGuns(p); // whatever you brought in, you lose
    p.items.fill(null); // the dead carry nothing
    p.socket.emit('items', [...p.items]);
    p.effects = {};
    p.socket.emit('effects', {});
    p.run = 'ghost';
    p.doomed = false;
    p.chips = 0;
    p.socket.emit('chips', 0);
    p.socket.emit('run', null);
    this.teleport(p, 'casino', { x: SPAWN.x + (Math.random() - 0.5) * 2.4, z: SPAWN.z, yaw: SPAWN.yaw });
    p.socket.emit('ghost');
    this.checkRunEnd();
  }

  /** Nobody left playing? Then the dead wake up in their beds. */
  private checkRunEnd() {
    const members = [...this.members.values()];
    if (members.some((m) => m.run === 'alive')) return;
    const ghosts = members.filter((m) => m.run === 'ghost');
    if (ghosts.length && this.bodies.length) {
      // The casino is cleaned overnight.
      this.bodies = [];
      this.sendBodies();
    }
    for (const g of ghosts) {
      g.run = 'none';
      g.vitals = morningVitals(); // the morning after: sober, starving, and bursting
      this.teleport(g, `apt:${g.slot}`, aptBed(g.slot, g.aptLevel));
      g.socket.emit('wake');
    }
  }

  // ---- tables -------------------------------------------------------------------------

  private tableChanged(stationId: string) {
    const table = this.tables.get(stationId)!;
    this.io.to(this.room).emit('tableState', stationId, table.publicState());
    for (const p of this.members.values()) {
      if (p.stationId !== stationId) continue;
      const secret = table.secretState?.(p.id);
      if (secret !== undefined) p.socket.emit('tableSecret', stationId, secret);
      // Third Eye: you see through the cards, the dice, the gun.
      if (drugOn(p, 'third-eye')) p.socket.emit('peek', table.peek?.(p.id) ?? null);
      this.maybeGut(p, table);
    }
  }

  /** A drink or three in you (or a line of Snow), and sometimes you just know. When a hunch comes, trust it: it is always right. */
  private maybeGut(p: Player, table: GameTable) {
    if (p.run !== 'alive' || p.doomed) return;
    const chance = this.gutChance(p);
    if (chance <= 0) return;
    const g = table.gutFeeling?.(p.id);
    if (!g || g.key === p.gutKey) return;
    p.gutKey = g.key; // one chance at a hunch per decision
    if (Math.random() >= chance) {
      // Nothing this time: the feeling builds, and the next one is likelier.
      p.gutMisses++;
    } else {
      p.gutMisses = 0;
      p.socket.emit('gut', g.right, g.pick);
    }
    p.socket.emit('gutChance', this.gutChance(p));
  }

  /** The chance of a hunch at their next decision (shown to them, so they can see one coming). */
  private gutChance(p: Player): number {
    if (drugOn(p, 'snow')) return 1;
    return gutOdds(p.vitals.bac, p.gutMisses).chance;
  }

  private leaveTable(p: Player) {
    if (!p.stationId) return;
    const table = this.tables.get(p.stationId);
    p.stationId = null;
    table?.leave(p.id);
    p.socket.emit('peek', null);
  }

  /** The single place chips change during a run. */
  private addChips(id: number, delta: number) {
    const p = this.alive(id);
    if (!p) return; // their run is over; the chips go back to the house
    p.chips = Math.max(0, p.chips + delta);
    p.socket.emit('chips', p.chips);
  }

  /** A table tells us a player's hand is over and paid. */
  private handFinished(id: number) {
    const p = this.alive(id);
    if (!p || p.doomed) return;
    const step = advanceRun(p, this.difficulty);
    if (step.dead) {
      p.doomed = true;
      p.round = step.reached;
      this.saveBest(p);
      if (step.charged > 0) {
        this.addChips(id, -step.charged);
        p.socket.emit('notice', `The ante is ${step.charged}. You can't cover it.`, 'bad');
      } else {
        p.socket.emit('notice', "You're out of chips.", 'bad');
      }
      const job: EscortJob = { id, round: step.reached, byAnte: step.charged > 0, cause: 'broke' };
      this.later(RUN.shotDelayMs, () => {
        this.escortQueue.push(job);
        this.nextEscort();
      });
      return;
    }
    p.round = step.round;
    p.hands = step.hands;
    if (runScore(step.round, this.difficulty) > runScore(p.best, p.bestLevel)) this.saveBest(p);
    if (step.charged > 0) {
      this.addChips(id, -step.charged);
      p.socket.emit('notice', `Round ${step.reached} survived. The house takes its ante: ${step.charged}.`, 'info');
    }
    p.socket.emit('run', runState(p.round, p.hands, p.best, this.difficulty, p.bestLevel));
  }

  private nextEscort() {
    while (!this.escorting && this.escortQueue.length > 0) {
      const job = this.escortQueue.shift()!;
      const p = this.members.get(job.id);
      if (!p || !p.doomed) continue; // they left: their run is over all the same
      this.escort(p, job);
    }
  }

  // ---- the body: eating, drinking, peeing ------------------------------------------------

  private levelOf = (slot: number) => [...this.members.values()].find((m) => m.slot === slot)?.aptLevel ?? 1;

  /** A quarter of a second of being alive. `report` = send them their numbers. */
  tickBody(p: Player, dt: number, report: boolean) {
    if (p.run === 'ghost' || p.doomed) return;
    const bladder = p.vitals.bladder;
    p.vitals = tickVitals(p.vitals, dt);
    if (drugOn(p, 'ice')) p.vitals.bladder = Math.min(p.vitals.bladder, bladder); // Ice Water: nothing goes through you
    this.wearOff(p);
    if (p.peeing) {
      p.vitals.bladder = Math.max(0, p.vitals.bladder - VITALS.peeRate * dt);
      if (p.vitals.bladder <= 0) this.stopPee(p);
    } else if (p.vitals.bladder >= 100) {
      p.socket.emit('notice', "You couldn't hold it any longer.", 'bad');
      this.startPee(p, true);
    }
    if (p.vitals.health <= 0) this.bodyGivesOut(p, 'collapse');
    if (report || p.peeing) p.socket.emit('vitals', { ...p.vitals });
    if (report) p.socket.emit('gutChance', p.run === 'alive' ? this.gutChance(p) : 0); // it follows your ‰
  }

  /** At the bar (for chips) or the fridge at home (free). It goes in your hand: keys 1-4, click to eat or drink. */
  onOrder(p: Player, itemId: unknown): { ok: boolean; error?: string; slot?: number } {
    const item = typeof itemId === 'string' ? menuItem(itemId) : undefined;
    if (!item) return { ok: false, error: 'Not on the menu.' };
    if (p.run === 'ghost' || p.doomed) return { ok: false, error: 'You are in no state to.' };
    const slot = p.items.findIndex((h) => h === null);
    if (slot < 0) return { ok: false, error: 'Your hands are full. Finish something first.' };
    if (item.section === 'home') {
      const slot = p.zone.startsWith('apt:') ? Number(p.zone.slice(4)) : -1;
      if (slot < 0 || !near(p, aptFridge(slot, this.levelOf(slot)), 1.9)) return { ok: false, error: 'You need to be at a fridge.' };
    } else {
      if (p.zone !== 'casino' || p.run !== 'alive' || !atBar(p) || p.stationId) return { ok: false, error: 'Order at the bar.' };
      if (p.chips < item.price) return { ok: false, error: 'Not enough chips.' };
      this.addChips(p.id, -item.price);
    }
    p.items[slot] = { itemId: item.id, left: portions(item) };
    p.socket.emit('items', copyItems(p.items));
    return { ok: true, slot };
  }

  /** A bite or a sip of whatever is in that hand (or a drug: down it goes). */
  onUse(p: Player, slot: unknown) {
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOTS) return;
    const held = p.items[slot];
    if (!held || p.run === 'ghost' || p.doomed) return;
    const drug = drugInfo(held.itemId);
    if (drug) {
      p.items[slot] = null;
      p.effects[drug.id] = Date.now() + drug.lasts;
      p.socket.emit('items', copyItems(p.items));
      p.socket.emit('effects', { ...p.effects });
      p.socket.emit('notice', `${drug.icon} ${drug.name}. ${drug.what}`, 'info');
      // See through the table you are at straight away.
      if (drug.id === 'third-eye' && p.stationId) this.tableChanged(p.stationId);
      return;
    }
    const item = menuItem(held.itemId);
    if (!item) return;
    const before = p.vitals.bac;
    p.vitals = consume(p.vitals, item, 1 / portions(item));
    held.left--;
    if (held.left <= 0) p.items[slot] = null;
    p.socket.emit('items', copyItems(p.items));
    p.socket.emit('vitals', { ...p.vitals });
    this.io.to(this.room).emit('ate', p.id, item.id);
    if (drugOn(p, 'ice')) return; // nothing touches you
    if (item.alcohol && alcoholKills(before, p.vitals.bac)) {
      // That sip was one too many. It takes a moment to arrive.
      this.later(1800, () => this.bodyGivesOut(p, 'alcohol'));
    } else if (item.alcohol && p.vitals.bac >= VITALS.bacDanger) {
      p.socket.emit('notice', `${p.vitals.bac.toFixed(1)} ‰. The room is spinning. Another sip could be your last.`, 'bad');
    }
  }

  /** Swing. Whoever is right in front of you, within reach, takes it. */
  onPunch(p: Player, yaw: unknown) {
    const now = Date.now();
    if (typeof yaw !== 'number' || !Number.isFinite(yaw) || p.run === 'ghost' || p.doomed || p.stationId) return;
    if (now - p.lastPunch < PUNCH.cooldownMs) return;
    p.lastPunch = now;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const inFront = (x: number, z: number) => {
      const ox = x - p.x;
      const oz = z - p.z;
      const d = Math.hypot(ox, oz);
      return d <= PUNCH.reach && d > 0.05 && (ox * dx + oz * dz) / d > 0.5 ? d : null;
    };
    let target: { id: number; d: number } | null = null;
    for (const o of this.members.values()) {
      if (o === p || o.run === 'ghost' || o.doomed || o.zone !== p.zone) continue;
      const d = inFront(o.x, o.z);
      if (d !== null && (!target || d < target.d)) target = { id: o.id, d };
    }
    if (p.zone === 'casino') {
      for (const pt of this.patrons?.all() ?? []) {
        const d = inFront(pt.x, pt.z);
        if (d !== null && (!target || d < target.d)) target = { id: pt.id, d };
      }
    }
    this.io.to(this.room).emit('punched', p.id, target?.id ?? null);
    if (!target) return;
    if (isPatronId(target.id)) {
      this.patrons?.punched(target.id, p);
      return;
    }
    const victim = this.members.get(target.id)!;
    victim.vitals.health = Math.max(0, victim.vitals.health - PUNCH.damage);
    victim.socket.emit('vitals', { ...victim.vitals });
    victim.socket.emit('notice', `${p.name} punched you!`, 'bad');
    if (victim.vitals.health <= 0) this.bodyGivesOut(victim, 'beaten', p);
  }

  /** Let it go. At a toilet, nobody minds. Anywhere else in the casino, the cleaner sends a bill. */
  startPee(p: Player, forced: boolean) {
    if (p.peeing || p.run === 'ghost' || p.doomed) return;
    if (!forced && (p.stationId || p.vitals.bladder < VITALS.peeMin)) {
      if (!p.stationId) p.socket.emit('notice', 'Nothing to come out.', 'bad');
      return;
    }
    const toilet = toiletAt(p, this.levelOf);
    const atToilet = !!toilet && toilet.zone === p.zone && !p.stationId;
    p.peeing = true;
    this.io.to(this.room).emit('peeing', p.id, true, atToilet);
    if (atToilet || p.zone !== 'casino') return;
    this.patrons?.react(p, ['Disgusting!', 'Oh, come ON.', 'Somebody call security.', 'Not on the carpet!', 'Was that... in here?']);
    if (p.run === 'alive') {
      const fee = Math.min(VITALS.cleaningFee, p.chips);
      if (fee > 0) {
        this.addChips(p.id, -fee);
        p.socket.emit('notice', `The cleaner sends you a bill: ${fee} chips.`, 'bad');
      }
    }
  }

  stopPee(p: Player) {
    if (!p.peeing) return;
    p.peeing = false;
    this.io.to(this.room).emit('peeing', p.id, false, false);
    p.socket.emit('vitals', { ...p.vitals });
  }

  /**
   * Drank too much, or starved. In the casino, on a run, that is the end of it. Anywhere
   * else you pass out and come round in your own bed.
   */
  private bodyGivesOut(p: Player, cause: 'alcohol' | 'collapse' | 'beaten', by: Player | null = null) {
    if (this.members.get(p.id) !== p || p.doomed || p.run === 'ghost') return;
    this.stopPee(p);
    if (p.zone === 'casino' && p.run === 'alive') {
      // Long enough for the eyes to close.
      this.killPlayer(p, cause, { by, delay: RUN.tableDeathMs + 1500 });
      if (by) this.afterKill(by, { x: p.x, z: p.z }, null);
      return;
    }
    p.vitals = { ...morningVitals(), health: 50 };
    this.teleport(p, `apt:${p.slot}`, aptBed(p.slot, p.aptLevel));
    p.socket.emit('wake');
    p.socket.emit('notice', 'You passed out. You come round in your own bed, somehow.', 'bad');
  }

  // ---- the regulars ------------------------------------------------------------------

  onPatronHail(p: Player, id: unknown) {
    if (typeof id === 'number') this.patrons?.hail(p, id);
  }

  onPatronInvite(p: Player, id: unknown, gameType: unknown) {
    if (typeof id !== 'number' || typeof gameType !== 'string') return;
    this.patrons?.invite(p, id, gameType);
  }

  onPatronEvict(p: Player, id: unknown, how: unknown) {
    if (typeof id !== 'number' || (how !== 'ask' && how !== 'threaten')) return;
    this.patrons?.evict(p, id, how);
  }

  /** A patron lost the lot. If security is free, they get the full treatment. */
  private escortPatron(pt: Patron): boolean {
    if (this.escorting || this.escortQueue.length > 0) return false;
    this.escorting = true;
    const seat = pt.stationId ? (this.tables.get(pt.stationId)?.seatPose(pt.id) ?? null) : null;
    const start = seat ? seatExitPoint(seat) : { x: pt.x, z: pt.z };
    const plan = planEscort(start);
    this.io.to(this.room).emit('escort', { id: pt.id, name: pt.name, round: 0, byAnte: false, start, npc: true });
    if (pt.stationId) this.tables.get(pt.stationId)?.leave(pt.id);
    pt.stationId = null;
    this.later(plan.t.respawn * 1000, () => this.patrons?.shownOut(pt));
    this.later(plan.t.end * 1000, () => {
      this.escorting = false;
      this.nextEscort();
    });
    return true;
  }

  /** A patron found the bullet. */
  private killPatron(id: number, stationId: string, cause: string) {
    const pt = this.patrons?.get(id);
    if (!pt) return;
    const seat = this.tables.get(stationId)?.seatPose(id);
    this.io.to(this.room).emit('died', { id, name: pt.name, round: 0, cause, stationId, at: seat ?? { x: pt.x, z: pt.z }, npc: true });
    this.tables.get(stationId)?.leave(id);
    const body = this.makeBody(pt.name, pt.color, seat ? seatExitPoint(seat) : pt, pt.yaw, pt.chips, []);
    pt.chips = 0;
    this.patrons?.killed(id, RUN.tableDeathMs);
    this.later(RUN.tableDeathMs, () => this.publishBody(body, null));
  }

  /** The bouncers collect the player, walk them out to the alley, and shoot them there. */
  private escort(p: Player, job: EscortJob) {
    this.escorting = true;
    const seat = p.stationId ? (this.tables.get(p.stationId)?.seatPose(p.id) ?? null) : null;
    const start = seat ? seatExitPoint(seat) : { x: p.x, z: p.z };
    const plan = planEscort(start);
    this.io.to(this.room).emit('escort', { id: p.id, name: p.name, round: job.round, byAnte: job.byAnte, start, cause: job.cause });
    this.leaveTable(p);
    p.x = start.x;
    p.z = start.z;
    this.later(plan.t.respawn * 1000, () => this.makeGhost(p));
    this.later(plan.t.end * 1000, () => {
      this.escorting = false;
      this.nextEscort();
    });
  }

  /** Shot dead at a table. They drop where they sit, then haunt the place. */
  private killAtTable(id: number, stationId: string, cause: string) {
    const p = this.alive(id);
    if (!p || p.doomed) return;
    const seat = this.tables.get(stationId)?.seatPose(id);
    this.killPlayer(p, cause, { stationId, at: seat ?? undefined, bodyAt: seat ? seatExitPoint(seat) : undefined, delay: RUN.tableDeathMs });
  }

  // ---- death, bodies, guns --------------------------------------------------------------

  /**
   * A player dies on the casino floor. Everything on them (chips, food, drink, drugs, guns)
   * stays on the body for anyone to take; the guns are no longer theirs.
   */
  private killPlayer(p: Player, cause: string, o: { stationId?: string; at?: Pt; bodyAt?: Pt; by?: Player | null; delay: number }) {
    p.doomed = true;
    this.stopPee(p);
    this.saveBest(p);
    const at = o.at ?? { x: p.x, z: p.z };
    this.io.to(this.room).emit('died', { id: p.id, name: p.name, round: p.round, cause, stationId: o.stationId ?? '', at, by: o.by?.name });
    this.leaveTable(p);
    this.loseGuns(p);
    const body = this.makeBody(p.name, p.color, o.bodyAt ?? at, p.yaw, p.chips, p.items.filter((h): h is HeldItem => h !== null));
    p.items.fill(null);
    p.chips = 0;
    p.socket.emit('items', copyItems(p.items));
    p.socket.emit('chips', 0);
    this.later(o.delay, () => {
      this.makeGhost(p);
      this.publishBody(body, o.by?.id ?? null);
    });
  }

  private makeBody(name: string, color: string, at: Pt, yaw: number, chips: number, items: HeldItem[]): Body {
    return { id: this.nextBodyId++, name, color, x: at.x, z: at.z, yaw, chips, items: items.map((h) => ({ ...h })), hidden: false };
  }

  /** The body is on the floor for all to see. Left in the open, the staff find it in the end. */
  private publishBody(b: Body, killer: number | null) {
    this.bodies.push(b);
    this.sendBodies();
    this.later(killer !== null ? BODIES.foundMs : BODIES.clearedMs, () => this.bodyFound(b.id, killer));
  }

  private bodyFound(id: number, killer: number | null) {
    const b = this.bodies.find((x) => x.id === id);
    if (!b || b.hidden) return;
    this.bodies = this.bodies.filter((x) => x !== b);
    this.sendBodies();
    this.io.to(this.room).emit('chat', { id: 0, name: 'Security', color: '#ff5555', text: `Staff found ${b.name}'s body and carried it out back.` });
    if (killer === null) return;
    const k = this.alive(killer);
    if (k && !k.doomed && k.zone === 'casino') this.arrest(k, `They found ${b.name}. The cameras saw who did it.`);
  }

  private sendBodies() {
    this.io.to(this.room).emit('bodies', this.bodies.map((b) => ({ ...b, items: b.items.map((h) => ({ ...h })) })));
  }

  /** Guns you were carrying are gone (onto your body, or into the alley with you). */
  private loseGuns(p: Player) {
    for (const h of p.items) {
      if (!h || !gunInfo(h.itemId) || !p.owned.includes(h.itemId)) continue;
      p.owned = p.owned.filter((id) => id !== h.itemId);
      this.store.removeOwned(p.id, h.itemId).catch((err) => console.error('Could not take a gun away', p.id, err));
    }
  }

  /** Guns you own and are not carrying go in your pocket (a free hotbar slot), if there is room. */
  pocketGuns(p: Player, emit = true) {
    let changed = false;
    for (const id of p.owned) {
      if (!gunInfo(id) || p.items.some((h) => h?.itemId === id)) continue;
      const slot = p.items.findIndex((h) => h === null);
      if (slot < 0) break;
      p.items[slot] = { itemId: id, left: 1 };
      changed = true;
    }
    if (changed && emit) p.socket.emit('items', copyItems(p.items));
  }

  private patronAlive(id: number) {
    const pt = this.patrons?.get(id);
    return !!pt && pt.health > 0;
  }

  /** Who is about to see a killing: the players, the regulars, and the staff at every table and the cashier. */
  private watchers(except: number[]): Target[] {
    const out: Target[] = [];
    for (const m of this.members.values()) {
      if (!except.includes(m.id) && m.run === 'alive' && !m.doomed && m.zone === 'casino') out.push({ id: m.id, x: m.x, z: m.z });
    }
    for (const pt of this.patrons?.all() ?? []) if (!except.includes(pt.id) && this.patronAlive(pt.id)) out.push({ id: pt.id, x: pt.x, z: pt.z });
    for (const st of STATIONS) out.push({ id: 0, x: st.x, z: st.z });
    out.push({ id: 0, x: CASHIER.x, z: CASHIER.z });
    return out;
  }

  /** Someone killed someone at `at`. If anyone saw (or heard), security takes them. */
  private afterKill(killer: Player, at: Pt, silenced: boolean | null, victimId?: number) {
    const seen = witnesses(at, killer, this.watchers([killer.id, victimId ?? killer.id]), silenced);
    if (seen.length) this.arrest(killer, silenced === false ? 'The whole casino heard that. Security is coming for you.' : 'Somebody saw that. Security is coming for you.');
  }

  /** Security walks a killer out to the alley, like anyone else who cannot pay. */
  private arrest(p: Player, why: string) {
    if (p.doomed || p.run !== 'alive') return;
    p.doomed = true;
    this.stopPee(p);
    p.socket.emit('notice', why, 'bad');
    this.later(1200, () => {
      this.escortQueue.push({ id: p.id, round: p.round, byAnte: false, cause: 'murder' });
      this.nextEscort();
    });
  }

  /** Bang. The gun in that hotbar slot, at whoever is in front of you. */
  onShoot(p: Player, slot: unknown, yaw: unknown, pitch: unknown) {
    if (typeof slot !== 'number' || typeof yaw !== 'number' || typeof pitch !== 'number') return;
    if (![yaw, pitch].every(Number.isFinite) || !Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOTS) return;
    const gun = gunInfo(p.items[slot]?.itemId ?? '');
    if (!gun || p.run === 'ghost' || p.doomed) return;
    if (p.zone !== 'casino' || p.run !== 'alive') {
      p.socket.emit('notice', 'Not here. Save it for the casino.', 'bad');
      return;
    }
    if (p.stationId) {
      p.socket.emit('notice', 'Stand up first.', 'bad');
      return;
    }
    const now = Date.now();
    if (now - p.lastShot < SHOOT.cooldownMs) return;
    p.lastShot = now;
    const targets: Target[] = [];
    for (const o of this.members.values()) {
      if (o !== p && o.run === 'alive' && !o.doomed && o.zone === 'casino') targets.push({ id: o.id, x: o.x, z: o.z });
    }
    for (const pt of this.patrons?.all() ?? []) if (this.patronAlive(pt.id)) targets.push({ id: pt.id, x: pt.x, z: pt.z });
    const hit = shotHits(p, yaw, clamp(pitch, -1.4, 1.4), targets, walkableFor(this.access(p), true));
    this.io.to(this.room).emit('shot', p.id, gun.silenced, yaw, pitch, hit?.id ?? null);
    this.patrons?.heardShot(p, gun.silenced ? SHOOT.heardSilenced : 30, hit?.id ?? null);
    if (!hit) return;
    if (isPatronId(hit.id)) {
      const pt = this.patrons?.get(hit.id);
      if (!pt || !this.patronAlive(pt.id)) return;
      pt.health -= SHOOT.damage;
      if (pt.health > 0) {
        this.patrons?.wounded(pt.id);
        return;
      }
      const at = { x: pt.x, z: pt.z };
      this.io.to(this.room).emit('died', { id: pt.id, name: pt.name, round: 0, cause: 'shot', stationId: '', at, npc: true, by: p.name });
      if (pt.stationId) this.tables.get(pt.stationId)?.leave(pt.id);
      const body = this.makeBody(pt.name, pt.color, at, pt.yaw, pt.chips, []);
      pt.chips = 0;
      this.patrons?.killed(pt.id, RUN.tableDeathMs);
      this.later(RUN.tableDeathMs, () => this.publishBody(body, p.id));
      this.afterKill(p, at, gun.silenced, pt.id);
      return;
    }
    const victim = this.members.get(hit.id);
    if (!victim) return;
    victim.vitals.health = Math.max(0, victim.vitals.health - SHOOT.damage);
    victim.socket.emit('vitals', { ...victim.vitals });
    if (victim.vitals.health > 0) {
      victim.socket.emit('notice', `${p.name} shot you!`, 'bad');
      return;
    }
    const at = { x: victim.x, z: victim.z };
    this.killPlayer(victim, 'shot', { by: p, delay: RUN.tableDeathMs + 1500 });
    this.afterKill(p, at, gun.silenced, victim.id);
  }

  /** Go through a body's pockets: chips, and whatever fits in your hands. A gun you pick up is yours. */
  onLoot(p: Player, bodyId: unknown) {
    const b = this.bodies.find((x) => x.id === bodyId);
    if (!b || p.run !== 'alive' || p.doomed || p.zone !== 'casino' || p.stationId) return;
    if (Math.hypot(p.x - b.x, p.z - b.z) > LOOT_RANGE + 0.4) {
      p.socket.emit('notice', 'Get closer.', 'bad');
      return;
    }
    const got: string[] = [];
    if (b.chips > 0) {
      got.push(`${b.chips} chips`);
      this.addChips(p.id, b.chips);
      b.chips = 0;
    }
    const left: HeldItem[] = [];
    for (const h of b.items) {
      const slot = p.items.findIndex((x) => x === null);
      if (slot < 0) {
        left.push(h);
        continue;
      }
      p.items[slot] = { ...h };
      got.push(heldInfo(h.itemId)?.name ?? h.itemId);
      if (gunInfo(h.itemId) && !p.owned.includes(h.itemId)) {
        p.owned.push(h.itemId);
        this.store.addOwned(p.id, h.itemId).catch((err) => console.error('Could not give a gun', p.id, err));
      }
    }
    b.items = left;
    p.socket.emit('items', copyItems(p.items));
    p.socket.emit('notice', got.length ? `You go through ${b.name}'s pockets: ${got.join(', ')}.${left.length ? ' Your hands are full for the rest.' : ''}` : `${b.name}'s pockets are empty.`, got.length ? 'info' : 'bad');
    this.sendBodies();
  }

  /** Sit a body on the toilet in the stall and pull the door to. Nobody will find it there. */
  onHideBody(p: Player, bodyId: unknown) {
    const b = this.bodies.find((x) => x.id === bodyId);
    if (!b || b.hidden || p.run !== 'alive' || p.doomed || p.zone !== 'casino') return;
    if (Math.hypot(p.x - b.x, p.z - b.z) > LOOT_RANGE + 0.4) return;
    const spot = stallHideFor(b);
    if (!spot) {
      p.socket.emit('notice', 'There is nowhere to hide them out here. A restroom stall would do.', 'bad');
      return;
    }
    Object.assign(b, { x: spot.x, z: spot.z, yaw: -Math.PI / 2, hidden: true });
    p.socket.emit('notice', `You sit ${b.name} on the toilet and pull the door to. Nobody will look in there.`, 'info');
    this.sendBodies();
  }

  /** Drugs wear off. */
  private wearOff(p: Player) {
    const now = Date.now();
    let changed = false;
    for (const [id, until] of Object.entries(p.effects) as [DrugId, number][]) {
      if (until > now) continue;
      delete p.effects[id];
      changed = true;
      p.socket.emit('notice', `The ${drugInfo(id)?.name ?? id} wears off.`, 'info');
      if (id === 'third-eye') p.socket.emit('peek', null);
    }
    if (changed) p.socket.emit('effects', { ...p.effects });
  }

  onPatronLure(p: Player, id: unknown) {
    if (typeof id === 'number') this.patrons?.lure(p, id);
  }

  private queueLeaderboard() {
    if (this.leaderboardTimer) return;
    this.leaderboardTimer = setTimeout(async () => {
      this.leaderboardTimer = null;
      try {
        this.io.to(this.room).emit('leaderboard', await this.store.leaderboard(8));
      } catch (err) {
        console.error('Could not load leaderboard', err);
      }
    }, 500);
  }
}
