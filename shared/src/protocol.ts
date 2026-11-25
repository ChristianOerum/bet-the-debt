// Every message that travels between a browser and the server.
import type { Body, Effects } from './combat';
import type { Difficulty, RunState } from './run';
import type { HeldItem, Vitals } from './vitals';
import type { Pt, ZoneKey } from './world';

/** Character colours: deliberately bright and silly against the dark room. */
export const COLORS = [
  '#ff6b8b',
  '#ff9f43',
  '#ffd34e',
  '#5ed39a',
  '#4ac6e8',
  '#6c8cff',
  '#b07cff',
  '#f4f0e6',
];

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  x: number;
  z: number;
  yaw: number;
  /** Where they are. 'void' means you cannot see them (a ghost). */
  zone: ZoneKey | 'void';
  /** The shop's clothes they have on (item ids). */
  outfit: string[];
}

/**
 * A patron: one of the house's regulars, run by the server. They wander the floor, play at
 * the tables, and can be talked into a game (or out of a chair). Their ids are negative.
 */
export interface PatronInfo extends PlayerInfo {
  /** Game types they will agree to play. */
  likes: string[];
  /** One line about them, for when you walk up. */
  blurb: string;
}

/** One line on a bank statement. */
export interface BankEntry {
  /** Money in (positive) or out (negative). */
  amount: number;
  /** What was left afterwards. */
  balance: number;
  note: string;
  /** When, in ms since 1970. */
  at: number;
}

/** What the bank's website shows you. */
export interface BankStatement {
  name: string;
  /** A made-up account number, the same every time for the same person. */
  account: string;
  cash: number;
  history: BankEntry[];
}

export interface LeaderboardEntry {
  name: string;
  /** Furthest round ever reached (their best run, by leaderboard score). */
  best: number;
  /** The level that run was played at. */
  level: Difficulty;
  cash: number;
}

export interface ChatMsg {
  id: number;
  name: string;
  color: string;
  text: string;
}

/**
 * Somebody could not pay. Security walks them out to the alley. Every browser works out
 * the same route and timings from `start` with planEscort().
 */
export interface EscortEvent {
  id: number;
  name: string;
  round: number;
  byAnte: boolean;
  start: Pt;
  /** A patron, not a player. */
  npc?: boolean;
  /** Why: could not pay (the default), or they were seen killing someone. */
  cause?: 'broke' | 'murder';
}

/** Somebody died right where they were (Russian roulette, a bullet, the drink...). */
export interface DeathEvent {
  id: number;
  name: string;
  round: number;
  cause: string;
  stationId: string;
  at: Pt;
  npc?: boolean;
  /** Who did it, if somebody did. */
  by?: string;
}

/** Who you are playing with. A solo player has no code and is the only member. */
export interface LobbyInfo {
  code: string | null;
  /** How hard the house squeezes in this lobby's casino. */
  difficulty: Difficulty;
  /** `home`: the shop's things for the home that they own, set out in their flat. */
  members: { id: number; name: string; color: string; slot: number; aptLevel: number; home: string[] }[];
}

/** What came back from the shop's checkout. */
export interface PurchaseResult {
  ok: boolean;
  /** Why it did not go through. */
  error?: string;
  cash: number;
  owned: string[];
  aptLevel: number;
}

/** Everything about the world you have just arrived in. Sent on login and whenever you change lobby. */
export interface WelcomeMsg {
  you: PlayerInfo;
  /** Your apartment slot in this lobby's building. */
  slot: number;
  cash: number;
  aptLevel: number;
  /** Everything you have bought from the shop (item ids). */
  owned: string[];
  vitals: Vitals;
  /** What you are carrying, by hotbar slot. */
  items: (HeldItem | null)[];
  lobby: LobbyInfo;
  /** Chips and run, if you are in the middle of one. */
  chips: number;
  run: RunState | null;
  /** You are dead, waiting for the others to finish. */
  ghost: boolean;
  /** Start the camera lying in bed and get up. */
  wakeUp: boolean;
  players: PlayerInfo[];
  /** The regulars in the casino (only a lobby has a casino, so only a lobby has them). */
  patrons: PatronInfo[];
  /** stationId -> that game's public state */
  tables: Record<string, unknown>;
  leaderboard: LeaderboardEntry[];
  /** The dead on the casino floor. */
  bodies: Body[];
  effects: Effects;
}

export interface ServerToClient {
  welcome: (msg: WelcomeMsg) => void;
  playerJoined: (p: PlayerInfo) => void;
  playerLeft: (id: number) => void;
  /** Someone changed clothes. */
  dressed: (id: number, outfit: string[]) => void;
  /** Your body, about once a second. */
  vitals: (v: Vitals) => void;
  /** Someone started or stopped peeing (into a toilet, or not). */
  peeing: (id: number, on: boolean, atToilet: boolean) => void;
  /** A hunch, at the table. Drink makes them come more often. */
  gut: (text: string, pick: string) => void;
  /** Your chance (0-1) of a hunch at your next decision. Follows your ‰ and climbs with every decision that brings none. */
  gutChance: (chance: number) => void;
  /** What you are carrying, by hotbar slot (null = empty). */
  items: (items: (HeldItem | null)[]) => void;
  /** Someone threw a punch (everyone sees the swing). `target` is who it landed on, if anyone. */
  punched: (id: number, target: number | null) => void;
  /** Someone took a bite or a sip of something. */
  ate: (id: number, itemId: string) => void;
  /** Someone fired a gun, facing yaw/pitch. `hit` is who it hit, if anyone. */
  shot: (id: number, silenced: boolean, yaw: number, pitch: number, hit: number | null) => void;
  /** The dead on the casino floor (all of them, whenever that changes). */
  bodies: (list: Body[]) => void;
  /** Your drugs: what is working on you, and until when. */
  effects: (e: Effects) => void;
  /** Third Eye: what you can see at the table you sit at (null = nothing, or not sitting). */
  peek: (text: string | null) => void;
  /** A regular walked in through the entrance. */
  patronJoined: (p: PatronInfo) => void;
  /** A regular went home (or was carried out). */
  patronLeft: (id: number) => void;
  /** `y` is height off the floor: above 0 while jumping. */
  moved: (id: number, x: number, z: number, yaw: number, y: number) => void;
  /** Someone went through a door (or died, or woke up). For you, it also moves you. */
  teleported: (id: number, zone: ZoneKey | 'void', x: number, z: number, yaw: number) => void;
  lobby: (info: LobbyInfo) => void;
  chat: (msg: ChatMsg) => void;
  tableState: (stationId: string, state: unknown) => void;
  /** Only for you: your hole cards, your dice. */
  tableSecret: (stationId: string, secret: unknown) => void;
  chips: (chips: number) => void;
  cash: (cash: number) => void;
  run: (run: RunState | null) => void;
  escort: (ev: EscortEvent) => void;
  died: (ev: DeathEvent) => void;
  /** You are now a ghost: watch, but do not touch. */
  ghost: () => void;
  /** Your friends are done: you wake up at home. */
  wake: () => void;
  leaderboard: (list: LeaderboardEntry[]) => void;
  /** 'bad' = you did something that is not allowed; 'info' = the house has news for you. */
  notice: (text: string, kind: 'bad' | 'info') => void;
  kicked: (reason: string) => void;
}

export interface ClientToServer {
  move: (x: number, z: number, yaw: number, y: number) => void;
  chat: (text: string) => void;
  sit: (stationId: string, seat: number) => void;
  leave: () => void;
  action: (stationId: string, action: unknown) => void;
  /** Start a lobby, at this difficulty. */
  lobbyCreate: (difficulty: Difficulty) => void;
  lobbyJoin: (code: string) => void;
  lobbyLeave: () => void;
  /** At the cashier: turn your chips into cash and leave. */
  cashOut: () => void;
  /** On the computer at home: your bank account, sent back in `reply`. */
  bank: (reply: (statement: BankStatement) => void) => void;
  /** Buy something from the shop, at home, with cash. */
  shopBuy: (itemId: string, reply: (result: PurchaseResult) => void) => void;
  /** Put on these clothes (and take off everything else). */
  wear: (itemIds: string[]) => void;
  /** Food or drink: at the bar for chips, or from the fridge at home. */
  order: (itemId: string, reply: (result: { ok: boolean; error?: string }) => void) => void;
  /** Start (or stop) peeing, wherever you are. */
  pee: (on: boolean) => void;
  /** A bite or a sip of whatever is in this hotbar slot. */
  use: (slot: number) => void;
  /** Swing a fist, facing `yaw`. */
  punch: (yaw: number) => void;
  /** You walked up to a patron and started talking: they stop and listen for a moment. */
  patronHail: (id: number) => void;
  /** Ask a patron standing about to come and play a game of this type. */
  patronInvite: (id: number, gameType: string) => void;
  /** Get a seated patron out of their chair: ask nicely, or lean on them. */
  patronEvict: (id: number, how: 'ask' | 'threaten') => void;
  /** Ask a regular you have played with to step into the bathroom with you. */
  patronLure: (id: number) => void;
  /** Fire the gun in your selected hotbar slot. */
  shoot: (slot: number, yaw: number, pitch: number) => void;
  /** Go through a body's pockets: take everything. */
  loot: (bodyId: number) => void;
  /** Sit a body on the toilet in the stall and close the door. */
  hideBody: (bodyId: number) => void;
  /** Buy from a dealer on the street, with cash. */
  buyDrug: (drugId: string, reply: (result: { ok: boolean; error?: string; cash: number }) => void) => void;
}

/** What the login / sign-up endpoints send back. */
export interface AuthUser {
  id: number;
  name: string;
  color: string;
  cash: number;
}
export interface AuthResponse {
  token: string;
  user: AuthUser;
}
