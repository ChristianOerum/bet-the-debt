// The casino floor plan. Server and browser both read this, so they always agree on
// where rooms, walls, tables, doors and the people guarding them are.
// To add a game, add a station (and, for a new table shape, an entry in SHAPES).

export interface Pt {
  x: number;
  z: number;
}
/** A place to stand and the way to face. yaw 0 looks toward -z, yaw PI/2 toward -x. */
export interface Post extends Pt {
  yaw: number;
}
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
export interface Circle extends Pt {
  r: number;
}

export type AreaId = 'hall' | 'card' | 'back' | 'dice' | 'restroom';
export interface Area extends Box {
  id: AreaId;
  name: string;
  height: number;
}

/**
 * The rooms. The main hall is in the middle; the card room is through the big arch
 * behind it; the back room hides behind a bookcase in the card room; the dice parlour
 * opens off the right-hand side of the hall. The restrooms are through a door in its left wall.
 */
export const AREAS: Area[] = [
  { id: 'hall', name: 'Main Hall', x0: -20, x1: 20, z0: -15, z1: 15, height: 7 },
  { id: 'card', name: 'Card Room', x0: -14, x1: 14, z0: -28, z1: -15, height: 5.5 },
  { id: 'back', name: 'Back Room', x0: -22, x1: -14, z0: -28, z1: -20, height: 3.4 },
  { id: 'dice', name: 'Dice Parlour', x0: 20, x1: 31, z0: 5, z1: 19, height: 4.6 },
  { id: 'restroom', name: 'Restrooms', x0: -27, x1: -20, z0: 5, z1: 13.5, height: 3.2 },
];
export const areaById = (id: AreaId) => AREAS.find((a) => a.id === id)!;

/** The main hall, by its old name. */
export const ROOM = { halfW: 20, halfD: 15, height: 7 };
export const PLAYER_RADIUS = 0.35;
export const EYE_HEIGHT = 1.45;
/** Just inside the entrance, looking into the room. */
export const SPAWN = { x: 0, z: 12.4, yaw: 0 };

/** A hole in a wall. `line` says which coordinate is fixed (`at`); the hole runs from a to b along the other. */
export interface Opening {
  id: string;
  line: 'x' | 'z';
  at: number;
  a: number;
  b: number;
  height: number;
  /** door: the front doors (they only open for some); inner: an ordinary door anyone walks through. */
  kind: 'arch' | 'secret' | 'exit' | 'door' | 'inner';
}

export const OPENINGS: Opening[] = [
  { id: 'entrance', line: 'z', at: 15, a: -1.4, b: 1.4, height: 3.6, kind: 'door' },
  { id: 'arch', line: 'z', at: -15, a: -4.5, b: 4.5, height: 4.4, kind: 'arch' },
  { id: 'diceArch', line: 'x', at: 20, a: 7.5, b: 12, height: 3.6, kind: 'arch' },
  { id: 'secret', line: 'x', at: -14, a: -25.2, b: -23.6, height: 2.5, kind: 'secret' },
  { id: 'exit', line: 'x', at: 20, a: -7.2, b: -4.8, height: 3.3, kind: 'exit' },
  { id: 'restroom', line: 'x', at: -20, a: 8.6, b: 10, height: 2.4, kind: 'inner' },
];

/** The walkable strip through an opening, reaching a little way into the rooms on both sides. */
export function portal(o: Opening): Box {
  const d = 1.2;
  return o.line === 'z' ? { x0: o.a, x1: o.b, z0: o.at - d, z1: o.at + d } : { x0: o.at - d, x1: o.at + d, z0: o.a, z1: o.b };
}

/**
 * Where people can stand: every room plus the archways (and the bookcase passage when it is
 * open), and the world outside. Not the doorways: see walkableFor for those.
 */
export function walkableRects(secretOpen = true): Box[] {
  return [
    ...AREAS,
    ...OPENINGS.filter((o) => o.kind === 'arch' || o.kind === 'inner' || (o.kind === 'secret' && secretOpen)).map(portal),
    ...OUTSIDE_RECTS(),
  ];
}

// ---- outside the casino: the street, the apartment building, the apartments -----------
// One continuous world. The casino's front doors open onto the street; across the road is
// the Lucky Arms, whose front door opens onto a long corridor with a flat off each side.
// Doors open as you walk up to them, if they will open for you at all.

/** Which part of the world someone is in. Apartments are numbered by slot in the building. */
export type ZoneKey = 'casino' | 'street' | 'hall' | `apt:${number}`;

/** The pavement in front of the casino's doors. Overlaps the street so you can walk between them. */
export const FORECOURT: Box = { x0: -5, x1: 5, z0: 15.4, z1: 21.5 };
/** Pavement, road, pavement. The apartment building faces the casino across it. */
export const STREET: Box = { x0: -40, x1: 40, z0: 20, z1: 44 };
export const APT_SLOTS = 8;
/** Room size by apartment level: `w` along the corridor, `d` back from it. Everyone starts at level 1. */
export const APT_SIZES: Record<number, { w: number; d: number; h: number }> = {
  1: { w: 5.2, d: 4.2, h: 2.7 },
  2: { w: 6.4, d: 5.4, h: 2.9 },
  3: { w: 7.6, d: 6.6, h: 3.2 },
};
export const aptSize = (level: number) => APT_SIZES[level] ?? APT_SIZES[1];
/** Each flat gets this much corridor, room for the biggest. */
const APT_PITCH = 8.2;
const HALL_HALF = 1.6;
/** The corridor inside the apartment building, straight back from its front door. */
export const HALLWAY = { x0: -HALL_HALF, x1: HALL_HALF, z0: 44.4, z1: 45.2 + 4 * APT_PITCH, height: 3 };

/**
 * A flat is built in its own coordinates: the room spans x 0..w and z 0..d, with the front
 * door in the z = d wall at x = 0.9. Flats 0-3 sit on the left of the corridor (1A-1D),
 * 4-7 on the right (2A-2D). This places one in the world.
 */
export function aptFrame(slot: number, level = 1): { x: number; z: number; rot: number } {
  const { d } = aptSize(level);
  const z0 = 45.2 + (slot % 4) * APT_PITCH;
  // Anchored so the front door is in the same place whatever size the flat is.
  return slot < 4 ? { x: -HALL_HALF - d, z: z0 + APT_SIZES[3].w, rot: Math.PI / 2 } : { x: HALL_HALF + d, z: z0, rot: -Math.PI / 2 };
}
/** A point in a flat's own coordinates, in the world. */
export function aptToWorld(slot: number, level: number, lx: number, lz: number): Pt {
  const f = aptFrame(slot, level);
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
}
const boxOf = (a: Pt, b: Pt): Box => ({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) });
/** A rectangle in a flat's own coordinates, in the world. */
export function aptBox(slot: number, level: number, lx0: number, lz0: number, lx1: number, lz1: number): Box {
  return boxOf(aptToWorld(slot, level, lx0, lz0), aptToWorld(slot, level, lx1, lz1));
}
export function aptRect(slot: number, level = 1): Box {
  const { w, d } = aptSize(level);
  return aptBox(slot, level, 0, 0, w, d);
}

export function OUTSIDE_RECTS(): Box[] {
  return [FORECOURT, STREET, HALLWAY];
}

/** The casino doors and the Lucky Arms' front door, and where you talk to the doorman. */
export const CASINO_DOOR: Pt = { x: 0, z: 15.2 };
export const BUILDING_DOOR: Pt = { x: 0, z: 44.2 };
/** The cashier's window, just inside the casino entrance. */
export const CASHIER: Pt = { x: 9, z: 14.6 };
/** Widths of the doorways. */
export const DOOR_SIZES = { casino: { w: 2.8, h: 3.6 }, building: { w: 1.5, h: 2.6 }, apt: { w: 1.1, h: 2.15 } };
/** An apartment's front door, in the corridor wall. */
export function aptDoor(slot: number, level = 1): Pt {
  return aptToWorld(slot, level, 0.9, aptSize(level).d);
}
/** Which way you face walking out of a flat into the corridor. */
export const aptOutYaw = (slot: number) => (slot < 4 ? -Math.PI / 2 : Math.PI / 2);
/** The desk with the computer: against the side wall at the foot of the bed. In a flat's own coordinates. */
export function aptDeskLocal(level = 1) {
  const { w, d } = aptSize(level);
  return { x0: w - 0.62, x1: w, z0: d - 1.55, z1: d - 0.3, screen: { x: w - 0.3, z: d - 0.925 } };
}
/**
 * Where the fixed things are in a flat, in its own coordinates. The studio has its toilet out
 * in the room next to the fridge. Every bigger flat has a bathroom: a little room of its own in
 * the far-left corner, with a doorway into the flat, and the fridge and TV moved along the wall.
 */
export function aptLayout(level = 1) {
  const bath = level >= 2 ? { x0: 0, z0: 0, x1: 2.0, z1: 1.9, door: { x0: 1.05, x1: 1.85 }, wall: 0.1 } : null;
  return {
    bath,
    toilet: bath ? { bowl: { x: 0.55, z: 0.42 }, stand: { x: 0.55, z: 1.1 } } : { bowl: { x: 1.15, z: 0.42 }, stand: { x: 1.15, z: 1.1 } },
    /** Where the sink is (bathrooms only). */
    sink: bath ? { x: 1.55, z: 0.25 } : null,
    /** The middle of the fridge's front. */
    fridge: bath ? { x: 0.4, z: 2.47 } : { x: 0.4, z: 0.4 },
    /** The TV, against the left wall: how far along it. */
    tvZ: bath ? 3.45 : 1.75,
  };
}

/**
 * The solid furniture in a flat, in its own coordinates (x0, z0, x1, z1): what you bump into.
 * Bigger flats get an armchair (one-bedroom) or a sofa (penthouse) under the window, and the
 * bathroom's walls (with a doorway in them).
 */
export function aptFurnitureLocal(level = 1): Record<string, [number, number, number, number]> {
  const { w } = aptSize(level);
  const desk = aptDeskLocal(level);
  const L = aptLayout(level);
  const out: Record<string, [number, number, number, number]> = {
    toilet: [L.toilet.bowl.x - 0.3, 0, L.toilet.bowl.x + 0.3, 0.72],
    bed: [w - 2.25, 0, w, 1.95],
    tv: [0, L.tvZ - 0.45, 0.7, L.tvZ + 0.45],
    fridge: [0, L.fridge.z - 0.4, 0.75, L.fridge.z + 0.38],
    desk: [desk.x0, desk.z0, desk.x1, desk.z1],
  };
  const b = L.bath;
  if (b) {
    const t = b.wall / 2;
    out.bathWallSide = [b.x1 - t, b.z0, b.x1 + t, b.z1 + t];
    out.bathWallFrontL = [b.x0, b.z1 - t, b.door.x0, b.z1 + t];
    out.bathWallFrontR = [b.door.x1, b.z1 - t, b.x1 + t, b.z1 + t];
    out.sink = [L.sink!.x - 0.27, 0, L.sink!.x + 0.27, 0.45];
  }
  if (level === 2) out.armchair = [2.3, 0.15, 3.15, 0.95];
  if (level >= 3) out.sofa = [2.4, 0.12, 4.8, 1.0];
  return out;
}

/**
 * The casino's restrooms: a room of their own through a door in the main hall's left wall.
 * Three toilet stalls along the far wall, a row of sinks under a mirror, urinals opposite.
 * Nobody out in the casino can see in.
 */
export const RESTROOM = {
  ...({ x0: -27, x1: -20, z0: 5, z1: 13.5 } as Box),
  height: 3.2,
  door: { x: -20, z: 9.3, w: 1.4, h: 2.4 },
  /** The stalls' middles (along z). Each is 1.7 m wide and 1.6 m deep, against the far (x0) wall. */
  stalls: [7.25, 8.95, 10.65],
  stallDepth: 1.6,
  stallWidth: 1.7,
  /** The urinals, along the back (z1) wall. */
  urinals: [-24.2, -23.2, -22.2],
  /** The sink counter along the front (z0) wall. */
  sinks: { x0: -24.6, x1: -21, depth: 0.55 },
};
export const inRestroom = (p: Pt) => p.x >= RESTROOM.x0 && p.x <= RESTROOM.x1 && p.z >= RESTROOM.z0 && p.z <= RESTROOM.z1;
/** Each stall's toilet: where the bowl is, and where you stand (facing it). */
export const RESTROOM_STALLS = RESTROOM.stalls.map((z) => ({ bowl: { x: RESTROOM.x0 + 0.35, z } as Pt, stand: { x: RESTROOM.x0 + 1.05, z, yaw: Math.PI / 2 } as Post }));
const RESTROOM_URINALS = RESTROOM.urinals.map((x) => ({ bowl: { x, z: RESTROOM.z1 - 0.2 } as Pt, stand: { x, z: RESTROOM.z1 - 0.75, yaw: Math.PI } as Post }));
/** The casino toilet the regulars use (the middle stall). */
export const CASINO_TOILET = RESTROOM_STALLS[1];
/** Where a body is sat to hide it, if it is in the restrooms: the nearest stall's toilet. Null anywhere else. */
export function stallHideFor(p: Pt): Pt | null {
  if (!inRestroom(p)) return null;
  const s = [...RESTROOM_STALLS].sort((a, b) => Math.abs(a.bowl.z - p.z) - Math.abs(b.bowl.z - p.z))[0];
  return { x: s.bowl.x + 0.2, z: s.bowl.z };
}

/** Every toilet: where the bowl is, and where you stand to use it. */
export function toilets(levelOf: (slot: number) => number = () => 1): { zone: ZoneKey; bowl: Pt; stand: Post }[] {
  return [
    ...[...RESTROOM_STALLS, ...RESTROOM_URINALS].map((t) => ({ zone: 'casino' as ZoneKey, ...t })),
    ...Array.from({ length: APT_SLOTS }, (_, s) => {
      const level = levelOf(s);
      return {
        zone: `apt:${s}` as ZoneKey,
        bowl: aptToWorld(s, level, aptLayout(level).toilet.bowl.x, aptLayout(level).toilet.bowl.z),
        stand: { ...aptToWorld(s, level, aptLayout(level).toilet.stand.x, aptLayout(level).toilet.stand.z), yaw: aptFrame(s, level).rot },
      };
    }),
  ];
}

/** The toilet you are standing at, if any. */
export function toiletAt(p: Pt, levelOf: (slot: number) => number = () => 1) {
  return toilets(levelOf).find((t) => Math.hypot(p.x - t.stand.x, p.z - t.stand.z) < 1.3) ?? null;
}

/** Where you order at the bar: along the front of the counter. */
export function atBar(p: Pt): boolean {
  return p.x >= BAR.front - 0.3 && p.x <= BAR.front + 2.6 && p.z >= BAR.z0 - 0.6 && p.z <= BAR.z1 + 0.6;
}

/** The fridge in a flat, in the world. */
export function aptFridge(slot: number, level = 1): Pt {
  const f = aptLayout(level).fridge;
  return aptToWorld(slot, level, f.x, f.z);
}

/** Where the computer is, in the world. */
export function aptDesk(slot: number, level = 1): Pt {
  const s = aptDeskLocal(level).screen;
  return aptToWorld(slot, level, s.x, s.z);
}

/** Where the bed is: you wake up here. yaw is which way you face when you get up. */
export function aptBed(slot: number, level = 1): Post {
  const { w } = aptSize(level);
  const f = aptFrame(slot, level);
  return { ...aptToWorld(slot, level, w - 1.25, 1.05), yaw: Math.PI + f.rot };
}

/** Walking strips through each doorway, overlapping the spaces either side. */
const casinoDoorway: Box = { x0: -1.3, x1: 1.3, z0: 13.8, z1: 16.6 };
const buildingDoorway: Box = { x0: -0.72, x1: 0.72, z0: 43.2, z1: 45.4 };
function aptDoorway(slot: number, level: number): Box {
  const d = aptDoor(slot, level);
  return { x0: d.x - 0.85, x1: d.x + 0.85, z0: d.z - 0.52, z1: d.z + 0.52 };
}

/** Which doors open for someone. */
export interface DoorAccess {
  /** The casino doors: open to a lobby, but not while you are on a run (cash out to leave). */
  casino: boolean;
  /** The flats whose doors open: everyone in your lobby (or just yours, on your own). */
  apts: { slot: number; level: number }[];
}

/** Where someone with this access can walk: everywhere, plus the doorways that open for them. */
export function walkableFor(access: DoorAccess, secretOpen = false): Box[] {
  const rects = [...walkableRects(secretOpen), buildingDoorway];
  if (access.casino) rects.push(casinoDoorway);
  for (const a of access.apts) rects.push(aptRect(a.slot, a.level), aptDoorway(a.slot, a.level));
  return rects;
}

/** Every doorway, the two zones it joins, and its middle. */
export interface Doorway {
  id: string;
  at: Pt;
  zones: [ZoneKey, ZoneKey];
  /** For a flat's door: whose. */
  slot?: number;
}
export function doorways(levels: (slot: number) => number = () => 1): Doorway[] {
  return [
    { id: 'casino', at: CASINO_DOOR, zones: ['casino', 'street'] },
    { id: 'building', at: BUILDING_DOOR, zones: ['street', 'hall'] },
    ...Array.from({ length: APT_SLOTS }, (_, s): Doorway => ({ id: `apt:${s}`, at: aptDoor(s, levels(s)), zones: ['hall', `apt:${s}`], slot: s })),
  ];
}

/** Which zone a point is in. */
export function zoneAt(p: Pt): ZoneKey {
  if (areaAt(p) || (p.x >= ALLEY.x0 - 0.5 && p.x <= ALLEY.x1 && p.z >= ALLEY.z0 && p.z <= ALLEY.z1)) return 'casino';
  if (p.x >= HALLWAY.x0 && p.x <= HALLWAY.x1 && p.z >= HALLWAY.z0) return 'hall';
  if (p.z >= HALLWAY.z0 - 0.2) {
    for (let s = 0; s < APT_SLOTS; s++) {
      const r = aptRect(s, 3);
      if (p.x >= r.x0 - 0.2 && p.x <= r.x1 + 0.2 && p.z >= r.z0 && p.z <= r.z1) return `apt:${s}`;
    }
    if (Math.abs(p.x) < 30) return 'hall';
  }
  return 'street';
}

/** Is a circle of radius r at p wholly inside one of the walkable rectangles? */
export function inWalkable(p: Pt, r: number, rects: Box[]): boolean {
  return rects.some((b) => p.x >= b.x0 + r && p.x <= b.x1 - r && p.z >= b.z0 + r && p.z <= b.z1 - r);
}

export function areaAt(p: Pt): Area | undefined {
  return AREAS.find((a) => p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1);
}

const exitOpening = OPENINGS.find((o) => o.id === 'exit')!;
export const DOORS = {
  entrance: { x: 0, z: ROOM.halfD, width: 2.8, height: 3.6 },
  exit: { x: exitOpening.at, z: (exitOpening.a + exitOpening.b) / 2, width: exitOpening.b - exitOpening.a, height: exitOpening.height },
};
const secretOpening = OPENINGS.find((o) => o.id === 'secret')!;
/** The middle of the bookcase that hides the back room. */
export const SECRET_DOOR: Pt = { x: secretOpening.at, z: (secretOpening.a + secretOpening.b) / 2 };

/** The alley behind the exit door: outside the room, past the right-hand wall. */
export const ALLEY = { x0: ROOM.halfW + 0.3, x1: ROOM.halfW + 7.5, z0: -16, z1: 4 };

export const GUARD_POSTS: { entrance: Post[]; exit: Post[] } = {
  entrance: [
    { x: -2.3, z: 13.6, yaw: 0 },
    { x: 2.3, z: 13.6, yaw: 0 },
  ],
  exit: [
    { x: 18.6, z: -7.8, yaw: Math.PI / 2 },
    { x: 18.6, z: -4.2, yaw: Math.PI / 2 },
  ],
};

/** The bar runs along the left wall of the hall. Customers stand on the room side of `front`. */
export const BAR = {
  z0: -8,
  z1: 4,
  front: -15.2,
  lane: -17.3,
  stoolX: -14.5,
  stools: [-7, -5.5, -4, -2.5, -1, 0.5, 2, 3.5],
};

// ---- tables -------------------------------------------------------------------

export interface Station {
  id: string;
  type: string;
  label: string;
  x: number;
  z: number;
  /** Rotation around the vertical axis, radians. */
  rot: number;
}

export const STATIONS: Station[] = [
  { id: 'bj1', type: 'blackjack', label: 'Blackjack', x: -7.5, z: 2.5, rot: 0 },
  { id: 'bj2', type: 'blackjack', label: 'Blackjack', x: 7.5, z: 2.5, rot: 0 },
  { id: 'bj3', type: 'blackjack', label: 'Blackjack', x: 7.5, z: -8.5, rot: 0 },
  { id: 'roulette1', type: 'roulette', label: 'Roulette', x: -7.5, z: -8.5, rot: 0 },
  { id: 'baccarat1', type: 'baccarat', label: 'Baccarat', x: -5, z: -22, rot: 0 },
  { id: 'poker1', type: 'poker', label: "Texas Hold'em", x: 5, z: -21.5, rot: 0 },
  { id: 'russian1', type: 'russian', label: 'Russian Roulette', x: -18, z: -24, rot: 0 },
  { id: 'liars1', type: 'liars', label: "Liar's Dice", x: 25.5, z: 9, rot: 0 },
  { id: 'meyer1', type: 'meyer', label: 'Meyer', x: 25.5, z: 15, rot: 0 },
];

/** The games with a table in the same room as `p` (what you can ask a regular to play from here). */
export function gamesInRoom(p: Pt): string[] {
  const room = areaAt(p)?.id;
  if (!room) return [];
  return [...new Set(STATIONS.filter((st) => areaAt(st)?.id === room).map((st) => st.type))];
}

/** A chair in a table's own coordinates. The sitter's back is toward (sin angle, cos angle). */
export interface SeatLocal {
  x: number;
  z: number;
  angle: number;
}
export interface TableShape {
  seats: SeatLocal[];
  /** Solid parts of the table, in its own coordinates. */
  blockers: Circle[];
  /** Where a dealer stands, if the game has one. */
  dealer?: Pt;
  /** Height of the playing surface. */
  top: number;
}

const ring = (anglesDeg: number[], rx: number, rz = rx): SeatLocal[] =>
  anglesDeg.map((d) => {
    const a = (d * Math.PI) / 180;
    return { x: Math.sin(a) * rx, z: Math.cos(a) * rz, angle: a };
  });

// Blackjack table: a half-circle. Dealer stands behind the flat edge, players sit round the arc.
export const BJ_LAYOUT = {
  tableRadius: 2.0,
  tableHeight: 0.95,
  seatRadius: 2.55,
  cardRadius: 1.28,
  betRadius: 1.72,
  seatAnglesDeg: [60, 30, 0, -30, -60],
  dealerZ: -0.6,
};

const halfMoon: TableShape = {
  seats: ring(BJ_LAYOUT.seatAnglesDeg, BJ_LAYOUT.seatRadius),
  blockers: [
    { x: 0, z: 0, r: BJ_LAYOUT.tableRadius + 0.05 },
    { x: 0, z: BJ_LAYOUT.dealerZ, r: 0.6 },
  ],
  dealer: { x: 0, z: BJ_LAYOUT.dealerZ },
  top: BJ_LAYOUT.tableHeight,
};

export const SHAPES: Record<string, TableShape> = {
  blackjack: halfMoon,
  baccarat: halfMoon,
  roulette: {
    // A long table: the wheel at the left end, the betting layout to the right.
    seats: [
      { x: -1.25, z: 1.5, angle: 0 },
      { x: -0.35, z: 1.5, angle: 0 },
      { x: 0.55, z: 1.5, angle: 0 },
      { x: 1.45, z: 1.5, angle: 0 },
      { x: 2.6, z: 0.2, angle: Math.PI / 2 },
    ],
    blockers: [
      { x: -0.95, z: 0, r: 1.0 },
      { x: 0.95, z: 0, r: 1.0 },
      { x: -1.15, z: -1.35, r: 0.55 },
    ],
    dealer: { x: -1.15, z: -1.35 },
    top: 0.95,
  },
  poker: {
    seats: ring([0, 62, -62, 124, -124], 2.55, 1.85),
    blockers: [
      { x: -0.7, z: 0, r: 1.25 },
      { x: 0.7, z: 0, r: 1.25 },
      { x: 0, z: -1.7, r: 0.5 },
    ],
    dealer: { x: 0, z: -1.7 },
    top: 0.95,
  },
  russian: {
    seats: ring([0, 60, 120, 180, 240, 300], 1.35),
    blockers: [{ x: 0, z: 0, r: 0.85 }],
    top: 0.8,
  },
  liars: {
    seats: ring([0, 60, 120, 180, 240, 300], 1.75),
    blockers: [{ x: 0, z: 0, r: 1.15 }],
    top: 0.85,
  },
  meyer: {
    seats: ring([0, 72, 144, 216, 288], 1.55),
    blockers: [{ x: 0, z: 0, r: 0.95 }],
    top: 0.85,
  },
};

/** Turn a point in a station's own coordinates into room coordinates. */
export function toWorld(st: Station, lx: number, lz: number): Pt {
  const c = Math.cos(st.rot);
  const s = Math.sin(st.rot);
  return { x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c };
}

/** Where a seat is in the room, and which way someone sitting there faces. */
export function seatWorld(st: Station, i: number): Post {
  const l = SHAPES[st.type].seats[i];
  return { ...toWorld(st, l.x, l.z), yaw: l.angle + st.rot };
}

export function bjSeatLocal(i: number): SeatLocal {
  return halfMoon.seats[i];
}
export const bjSeatWorld = seatWorld;

/** The spot just behind a chair, where you stand when you get up from it. */
export function seatExitPoint(seat: Post): Pt {
  return { x: seat.x + Math.sin(seat.yaw) * 0.95, z: seat.z + Math.cos(seat.yaw) * 0.95 };
}

// ---- furniture --------------------------------------------------------------------

export const DECOR = {
  pillars: [
    { x: -12, z: -11 },
    { x: 12, z: -11 },
    { x: -12, z: 9 },
    { x: 12, z: 9 },
  ],
  plants: [
    { x: -19, z: -14 },
    { x: 19, z: -14 },
    { x: -19, z: 14 },
    { x: 19, z: 14 },
    { x: -3.7, z: 14.1 },
    { x: 3.7, z: 14.1 },
    { x: -19, z: 6.2 },
    { x: 19, z: -11 },
    { x: -13, z: -16.2 },
    { x: 13, z: -16.2 },
    { x: 30, z: 18 },
    { x: 30, z: 6 },
  ],
  /** A bank of slot machines along the front wall. Not open yet. */
  slots: [-16, -14.5, -13, -11.5, -10].map((x) => ({ x, z: 14.1 })),
  /** Sofas round a low table. */
  lounges: [
    { x: -15.5, z: -12.2, r: 1.6 },
    { x: 11, z: -21.5, r: 1.5 },
  ],
  piano: { x: 14.5, z: 12, r: 1.25 },
  /** Out on the street: lamp posts, a hydrant, a bench, parked cars. */
  streetLamps: [-30, -15, 15, 30].flatMap((x) => [
    { x, z: 21 },
    { x, z: 43 },
  ]),
  cars: [
    { x: -22, z: 25, rot: 0, color: '#c8263b' },
    { x: 12, z: 25, rot: 0, color: '#2f6fb0' },
    { x: -8, z: 35, rot: Math.PI, color: '#ffd34e' }, // a taxi
    { x: 26, z: 35, rot: Math.PI, color: '#3a8a5a' },
  ],
};

/** Everything solid that a walking player bumps into, apart from the walls. `levelOf` sizes each flat. */
export function staticColliders(levelOf: (slot: number) => number = () => 1): { circles: Circle[]; boxes: Box[] } {
  const circles: Circle[] = [];
  for (const p of DECOR.pillars) circles.push({ ...p, r: 0.5 });
  for (const p of DECOR.plants) circles.push({ ...p, r: 0.55 });
  for (const p of DECOR.slots) circles.push({ ...p, r: 0.55 });
  for (const l of DECOR.lounges) circles.push(l);
  circles.push(DECOR.piano);
  for (const p of [...GUARD_POSTS.entrance, ...GUARD_POSTS.exit]) circles.push({ x: p.x, z: p.z, r: 0.45 });
  for (const z of BAR.stools) circles.push({ x: BAR.stoolX, z, r: 0.3 });
  for (const l of DECOR.streetLamps) circles.push({ ...l, r: 0.25 });
  // A parked car is about 4 m long and 1.9 m wide: two circles cover it well enough.
  for (const c of DECOR.cars) for (const dx of [-1, 1]) circles.push({ x: c.x + dx * 1.05, z: c.z, r: 1.05 });
  for (const st of STATIONS) {
    const shape = SHAPES[st.type];
    for (const b of shape.blockers) circles.push({ ...toWorld(st, b.x, b.z), r: b.r });
    shape.seats.forEach((_, i) => {
      const s = seatWorld(st, i);
      circles.push({ x: s.x, z: s.z, r: 0.42 });
    });
  }
  const boxes: Box[] = [
    // the bar, counter and the bartender's side of it
    { x0: -ROOM.halfW, x1: BAR.front + 0.05, z0: BAR.z0 - 0.1, z1: BAR.z1 + 0.1 },
    // card room: bookshelves on the back and left walls, the fireplace on the right
    { x0: -14, x1: 14, z0: -28, z1: -27.45 },
    { x0: -14, x1: -13.45, z0: -28, z1: -25.4 },
    { x0: -14, x1: -13.45, z0: -23.4, z1: -15.8 },
    { x0: 13.2, x1: 14, z0: -23, z1: -20 },
    // back room: crates in the corners
    { x0: -22, x1: -20.6, z0: -28, z1: -26.6 },
    { x0: -22, x1: -21, z0: -21.4, z1: -20 },
    // dice parlour: jukebox
    { x0: 30.2, x1: 31, z0: 11.3, z1: 12.7 },
    // the casino: the cashier's booth beside the entrance
    { x0: 7.6, x1: 10.4, z0: 14.2, z1: 15 },
    // the restrooms: the stall partitions and toilets, the sink counter, the urinals
    ...RESTROOM.stalls.flatMap((z) => [-1, 1].map((s) => ({ x0: RESTROOM.x0, x1: RESTROOM.x0 + RESTROOM.stallDepth, z0: z + (s * RESTROOM.stallWidth) / 2 - 0.04, z1: z + (s * RESTROOM.stallWidth) / 2 + 0.04 }))),
    ...RESTROOM_STALLS.map((t) => ({ x0: RESTROOM.x0, x1: t.bowl.x + 0.3, z0: t.bowl.z - 0.25, z1: t.bowl.z + 0.25 })),
    { x0: RESTROOM.sinks.x0, x1: RESTROOM.sinks.x1, z0: RESTROOM.z0, z1: RESTROOM.z0 + RESTROOM.sinks.depth },
    ...RESTROOM.urinals.map((x) => ({ x0: x - 0.22, x1: x + 0.22, z0: RESTROOM.z1 - 0.38, z1: RESTROOM.z1 })),
  ];
  // Each apartment's furniture: the bed, the TV on its crate, the fridge, the desk, and so on.
  for (let s = 0; s < APT_SLOTS; s++) {
    const level = levelOf(s);
    for (const [x0, z0, x1, z1] of Object.values(aptFurnitureLocal(level))) boxes.push(aptBox(s, level, x0, z0, x1, z1));
  }
  return { circles, boxes };
}

export interface Colliders {
  circles: Circle[];
  boxes: Box[];
  walk: Box[];
}

export function allColliders(secretOpen = true): Colliders {
  return { ...staticColliders(), walk: walkableRects(secretOpen) };
}

/** Is there room for something of radius `r` to stand at `p`? */
export function isFree(p: Pt, r: number, col: Colliders): boolean {
  if (!inWalkable(p, r, col.walk)) return false;
  for (const c of col.circles) if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + r) return false;
  for (const b of col.boxes) if (p.x > b.x0 - r && p.x < b.x1 + r && p.z > b.z0 - r && p.z < b.z1 + r) return false;
  return true;
}
