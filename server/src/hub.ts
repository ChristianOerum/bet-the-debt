import type { Server, Socket } from 'socket.io';
import {
  aptBed,
  cannotBuy,
  dealerAt,
  drugInfo,
  freshVitals,
  HOTBAR_SLOTS,
  RUN,
  type Difficulty,
  DIFFICULTIES,
  isDifficulty,
  type Effects,
  type HeldItem,
  shopItem,
  validOutfit,
  type ClientToServer,
  type PurchaseResult,
  type ServerToClient,
  type Vitals,
  type ZoneKey,
} from '@casino/shared';
import { userFromToken } from './auth';
import { Instance } from './instance';
import type { Store, UserRecord } from './store/Store';

interface SocketData {
  user: UserRecord;
}
export type GameServer = Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

/** Someone who is online right now. */
export interface Player {
  id: number;
  name: string;
  color: string;
  socket: GameSocket;
  /** Saved on the account. */
  cash: number;
  aptLevel: number;
  best: number;
  /** The level their best run was played at. */
  bestLevel: Difficulty;
  /** Everything bought from the shop, and the clothes from it they have on. */
  owned: string[];
  outfit: string[];
  /** A purchase is going through: one at a time. */
  buying: boolean;
  /** Health, hunger, thirst, bladder, blood alcohol. */
  vitals: Vitals;
  peeing: boolean;
  /** The last decision at a table they had a hunch about. */
  gutKey: string | null;
  /** Decisions in a row with a hunch possible and none coming: each makes the next likelier. */
  gutMisses: number;
  /** Food and drink in hand, by hotbar slot. */
  items: (HeldItem | null)[];
  /** When they last threw a punch (ms). */
  lastPunch: number;
  /** When they last fired a gun (ms). */
  lastShot: number;
  /** Drugs working on them, and until when. */
  effects: Effects;
  /** The world they are in: their own, or a lobby's. */
  instance: Instance | null;
  /** Their apartment's number in that world's building. */
  slot: number;
  zone: ZoneKey;
  x: number;
  z: number;
  yaw: number;
  /** none: not playing. alive: in the casino with chips. ghost: died, waiting for the others. */
  run: 'none' | 'alive' | 'ghost';
  chips: number;
  round: number;
  hands: number;
  /** Broke, and about to be shown out. No more sitting, betting or walking. */
  doomed: boolean;
  stationId: string | null;
  lastChat: number;
}

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const BODY_TICK_MS = 250;

/** A made-up bank account number: looks the part, and is the same every time. */
export function accountNumber(userId: number): string {
  const n = String((userId * 7919 + 40_213) % 100_000_000).padStart(8, '0');
  return `LA ${n.slice(0, 4)} ${n.slice(4)}`;
}

/**
 * Everyone who is online, and the worlds they are in. When you are on your own you have a
 * world to yourself (your apartment, the building, the street). A lobby is a world shared
 * by a group: the same street and building, and a casino of their own.
 */
export class Hub {
  private players = new Map<number, Player>();
  private lobbies = new Map<string, Instance>();
  private nextInstance = 1;

  constructor(
    private io: GameServer,
    private store: Store,
  ) {
    io.use(async (socket, next) => {
      try {
        const user = await userFromToken(store, socket.handshake.auth?.token);
        if (!user) return next(new Error('unauthorized'));
        socket.data.user = user;
        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error('auth failed'));
      }
    });
    io.on('connection', (socket) => {
      this.onConnect(socket).catch((err) => {
        console.error('Could not set up a connection', err);
        socket.disconnect(true);
      });
    });
    // Everyone's body ticks along: hungrier, thirstier, fuller, soberer.
    let beat = 0;
    setInterval(() => {
      beat++;
      for (const p of this.players.values()) p.instance?.tickBody(p, BODY_TICK_MS / 1000, beat % 4 === 0);
    }, BODY_TICK_MS);
  }

  private async onConnect(socket: GameSocket) {
    const user = socket.data.user;
    const owned = await this.store.ownedItems(user.id);
    if (!socket.connected) return;
    // One body per account: a second login takes over from the first.
    const old = this.players.get(user.id);
    if (old) {
      old.socket.emit('kicked', 'You logged in somewhere else.');
      this.drop(old);
      old.socket.disconnect(true);
    }

    const p: Player = {
      id: user.id,
      name: user.username,
      color: user.color,
      socket,
      cash: user.cash,
      aptLevel: user.aptLevel,
      best: user.bestRound,
      bestLevel: user.bestLevel,
      owned,
      outfit: validOutfit(user.outfit, owned),
      buying: false,
      vitals: freshVitals(),
      peeing: false,
      gutKey: null,
      gutMisses: 0,
      items: Array<HeldItem | null>(HOTBAR_SLOTS).fill(null),
      lastPunch: 0,
      lastShot: 0,
      effects: {},
      instance: null,
      slot: 0,
      zone: 'apt:0',
      x: 0,
      z: 0,
      yaw: 0,
      run: 'none',
      chips: 0,
      round: 1,
      hands: 0,
      doomed: false,
      stationId: null,
      lastChat: 0,
    };
    this.players.set(p.id, p);
    // You start every visit waking up at home.
    this.solo().add(p, (slot) => ({ zone: `apt:${slot}`, ...aptBed(slot, p.aptLevel) }), true);

    const inst = () => p.instance;
    socket.on('move', (x, z, yaw, y) => inst()?.onMove(p, x, z, yaw, y));
    socket.on('chat', (text) => inst()?.onChat(p, text));
    socket.on('sit', (stationId, seat) => inst()?.onSit(p, stationId, seat));
    socket.on('leave', () => inst()?.onLeaveTable(p));
    socket.on('action', (stationId, action) => inst()?.onAction(p, stationId, action));
    socket.on('cashOut', () => inst()?.cashOut(p));
    socket.on('bank', (reply) => {
      if (typeof reply !== 'function') return;
      this.store
        .bankHistory(p.id, 30)
        .then((history) => reply({ name: p.name, account: accountNumber(p.id), cash: p.cash, history }))
        .catch((err) => console.error('Could not load bank statement', p.id, err));
    });
    socket.on('shopBuy', (itemId, reply) => {
      if (typeof reply === 'function') void this.buy(p, itemId, reply);
    });
    socket.on('wear', (items) => {
      p.outfit = validOutfit(items, p.owned);
      this.store.setOutfit(p.id, p.outfit).catch((err) => console.error('Could not save outfit', p.id, err));
      p.instance?.dressed(p);
    });
    socket.on('order', (itemId, reply) => {
      if (typeof reply === 'function') reply(p.instance?.onOrder(p, itemId) ?? { ok: false, error: 'Not now.' });
    });
    socket.on('use', (slot) => p.instance?.onUse(p, slot));
    socket.on('punch', (yaw) => p.instance?.onPunch(p, yaw));
    socket.on('pee', (on) => {
      if (on) p.instance?.startPee(p, false);
      else p.instance?.stopPee(p);
    });
    socket.on('patronHail', (id) => inst()?.onPatronHail(p, id));
    socket.on('patronInvite', (id, game) => inst()?.onPatronInvite(p, id, game));
    socket.on('patronEvict', (id, how) => inst()?.onPatronEvict(p, id, how));
    socket.on('patronLure', (id) => inst()?.onPatronLure(p, id));
    socket.on('shoot', (slot, yaw, pitch) => inst()?.onShoot(p, slot, yaw, pitch));
    socket.on('loot', (id) => inst()?.onLoot(p, id));
    socket.on('hideBody', (id) => inst()?.onHideBody(p, id));
    socket.on('buyDrug', (drugId, reply) => {
      if (typeof reply === 'function') void this.buyDrug(p, drugId, reply);
    });
    socket.on('lobbyCreate', (difficulty) => this.createLobby(p, isDifficulty(difficulty) ? difficulty : 'normal'));
    socket.on('lobbyJoin', (code) => this.joinLobby(p, code));
    socket.on('lobbyLeave', () => this.leaveLobby(p));
    socket.on('disconnect', () => {
      if (this.players.get(p.id) === p) this.drop(p);
    });
  }

  /** Checkout at Shoddy.com. The shop's own list sets the price; the bank pays or declines. */
  private async buy(p: Player, itemId: unknown, reply: (r: PurchaseResult) => void) {
    const answer = (ok: boolean, error?: string) => reply({ ok, error, cash: p.cash, owned: [...p.owned], aptLevel: p.aptLevel });
    if (!p.zone.startsWith('apt:')) return answer(false, 'The shop only works from a computer at home.');
    if (p.buying) return answer(false, 'One thing at a time.');
    const item = typeof itemId === 'string' ? shopItem(itemId) : undefined;
    const why = cannotBuy(item, p);
    if (why || !item) return answer(false, why ?? 'That is not for sale.');
    p.buying = true;
    try {
      const ok = await this.store.buy(p.id, item.id, item.price, `Shoddy.com: ${item.name}`, item.level);
      if (!ok) return answer(false, 'Card declined. Not enough money in the bank.');
      p.cash -= item.price;
      if (!p.owned.includes(item.id)) p.owned.push(item.id);
      if (item.level !== undefined) p.aptLevel = Math.max(p.aptLevel, item.level);
      p.socket.emit('cash', p.cash);
      // A bigger flat, or something new in it: everyone in the building sees the change.
      if (item.level !== undefined || item.category === 'home') p.instance?.lobbyChanged();
      // A gun goes straight into your pocket (a free hotbar slot).
      if (item.category === 'weapons') p.instance?.pocketGuns(p);
      answer(true);
    } catch (err) {
      console.error('Purchase failed', p.id, item.id, err);
      answer(false, 'Something went wrong at the bank. Nothing was charged.');
    } finally {
      p.buying = false;
    }
  }

  /** A dealer on the street: cash, no questions, straight into your pocket. */
  private async buyDrug(p: Player, drugId: unknown, reply: (r: { ok: boolean; error?: string; cash: number }) => void) {
    const answer = (ok: boolean, error?: string) => reply({ ok, error, cash: p.cash });
    const drug = typeof drugId === 'string' ? drugInfo(drugId) : undefined;
    const dealer = dealerAt(p);
    if (!drug) return answer(false, 'Never heard of it.');
    if (p.zone !== 'street' || !dealer || p.run !== 'none') return answer(false, 'There is nobody selling that here.');
    if (p.buying) return answer(false, 'One thing at a time.');
    const slot = p.items.findIndex((h) => h === null);
    if (slot < 0) return answer(false, 'Your pockets are full.');
    if (p.cash < drug.price) return answer(false, `That's $${drug.price}. You don't have it.`);
    p.buying = true;
    try {
      await this.store.addCash(p.id, -drug.price, 'Cash withdrawal, street ATM');
      p.cash -= drug.price;
      p.items[slot] = { itemId: drug.id, left: 1 };
      p.socket.emit('cash', p.cash);
      p.socket.emit('items', p.items.map((h) => (h ? { ...h } : null)));
      answer(true);
    } catch (err) {
      console.error('Drug purchase failed', p.id, err);
      answer(false, 'The ATM ate your card.');
    } finally {
      p.buying = false;
    }
  }

  private drop(p: Player) {
    p.instance?.remove(p);
    this.players.delete(p.id);
  }

  private solo(): Instance {
    return new Instance(this.io, this.store, this, `solo-${this.nextInstance++}`, null);
  }

  /** Called by a world when its last player has gone. */
  emptied(inst: Instance) {
    if (inst.code) this.lobbies.delete(inst.code);
    inst.dispose();
  }

  /** Move someone into another world, standing right where they were (at the casino doors). */
  private moveTo(p: Player, to: Instance) {
    const here = { zone: p.zone, x: p.x, z: p.z, yaw: p.yaw };
    p.instance?.remove(p);
    to.add(p, () => here, false);
  }

  private createLobby(p: Player, difficulty: Difficulty) {
    if (p.instance?.code) {
      p.socket.emit('notice', `You are already in lobby ${p.instance.code}.`, 'bad');
      return;
    }
    if (p.zone !== 'street') {
      p.socket.emit('notice', 'Lobbies are made at the casino doors.', 'bad');
      return;
    }
    let code = '';
    do code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
    while (this.lobbies.has(code));
    const lobby = new Instance(this.io, this.store, this, `lobby-${code}`, code, difficulty);
    this.lobbies.set(code, lobby);
    this.moveTo(p, lobby);
    p.socket.emit('notice', `Lobby ${code} is open, on ${DIFFICULTIES[difficulty].label}. Give your friends the code.`, 'info');
  }

  private joinLobby(p: Player, raw: unknown) {
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    const lobby = this.lobbies.get(code);
    if (!lobby) {
      p.socket.emit('notice', `There is no lobby called "${code.slice(0, 8)}".`, 'bad');
      return;
    }
    if (lobby === p.instance) return;
    if (lobby.size >= RUN.maxLobby) {
      p.socket.emit('notice', 'That lobby is full.', 'bad');
      return;
    }
    if (p.zone !== 'street') {
      p.socket.emit('notice', 'Lobbies are joined at the casino doors.', 'bad');
      return;
    }
    this.moveTo(p, lobby);
    p.socket.emit('notice', `You joined lobby ${code}.`, 'info');
  }

  /** Back to a world of your own, waking up at home. Any run you were on is lost. */
  private leaveLobby(p: Player) {
    if (!p.instance?.code) return;
    p.instance.remove(p);
    this.solo().add(p, (slot) => ({ zone: `apt:${slot}`, ...aptBed(slot, p.aptLevel) }), true);
  }
}
