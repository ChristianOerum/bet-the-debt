// Guns, drugs, bodies, and who saw what. The server decides all of it; these are the rules.
import { menuItem, portions } from './vitals';
import { areaAt, inRestroom, inWalkable, RESTROOM, type Box, type Pt } from './world';

// ---- guns -------------------------------------------------------------------------------

export interface GunInfo {
  id: string;
  name: string;
  /** Heard all over the casino (false), or only up close (true). */
  silenced: boolean;
}

export const GUNS: GunInfo[] = [
  { id: 'pistol', name: 'Pistol', silenced: false },
  { id: 'pistol-silenced', name: 'Pistol with suppressor', silenced: true },
];
export const gunInfo = (id: string) => GUNS.find((g) => g.id === id);

export const SHOOT = {
  /** How far a bullet goes, metres. */
  range: 30,
  damage: 55,
  cooldownMs: 400,
  /** How tall and wide a person is, for being hit. */
  bodyRadius: 0.38,
  bodyHeight: 1.8,
  eyeHeight: 1.45,
  /** Who hears a shot: everyone in the casino, or only those this close. */
  heardLoud: 60,
  heardSilenced: 6,
  /** A loud shot inside the restrooms: heard only this close to their door. */
  heardMuffled: 7,
  /** Who sees a killing: this close, and in the same room (or this close whatever the room). */
  sightRange: 14,
  closeRange: 5,
};

export interface Target extends Pt {
  id: number;
}

/**
 * A shot from `from` (eye height), facing `yaw` and tilted `pitch` (up is positive): the
 * nearest target it hits before a wall, or null. Walls are anywhere outside `walk`.
 */
export function shotHits(from: Pt, yaw: number, pitch: number, targets: Target[], walk: Box[]): { id: number; dist: number } | null {
  const dx = -Math.sin(yaw) * Math.cos(pitch);
  const dz = -Math.cos(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  // How far before the bullet leaves the rooms (hits a wall).
  let wall = SHOOT.range;
  for (let t = 0.3; t < SHOOT.range; t += 0.1) {
    if (!inWalkable({ x: from.x + dx * t, z: from.z + dz * t }, 0, walk)) {
      wall = t;
      break;
    }
  }
  let best: { id: number; dist: number } | null = null;
  const flat = Math.hypot(dx, dz) || 1e-9;
  for (const tg of targets) {
    const ox = tg.x - from.x;
    const oz = tg.z - from.z;
    // Closest approach of the ray (in plan) to the target's middle.
    const along = (ox * dx + oz * dz) / (flat * flat);
    if (along <= 0) continue;
    const px = dx * along - ox;
    const pz = dz * along - oz;
    if (Math.hypot(px, pz) > SHOOT.bodyRadius) continue;
    const dist = along * Math.hypot(dx, dz, dy);
    if (dist > wall || dist > SHOOT.range) continue;
    // And at that point, is the bullet at body height?
    const y = SHOOT.eyeHeight + dy * along;
    if (y < 0 || y > SHOOT.bodyHeight) continue;
    if (!best || dist < best.dist) best = { id: tg.id, dist };
  }
  return best;
}

/**
 * Who saw a killing at `at` by someone at `from`: anyone in `watchers` close enough, in the
 * same room, or who heard the shot.
 *
 * The restrooms are walled off: a killing in there is seen only by whoever else is in there.
 * The walls muffle a loud pistol, so only people near the restroom door hear it; a
 * suppressed one is not heard outside at all.
 */
export function witnesses(at: Pt, from: Pt, watchers: Target[], silenced: boolean | null): number[] {
  const inside = inRestroom(at);
  const room = areaAt(at)?.id;
  const heard = silenced === null ? 0 : silenced ? SHOOT.heardSilenced : SHOOT.heardLoud;
  return watchers
    .filter((w) => {
      const d = Math.min(Math.hypot(w.x - at.x, w.z - at.z), Math.hypot(w.x - from.x, w.z - from.z));
      const wIn = inRestroom(w);
      if (inside) {
        if (wIn) return true; // in there with you
        return silenced === false && Math.hypot(w.x - RESTROOM.door.x, w.z - RESTROOM.door.z) <= SHOOT.heardMuffled;
      }
      if (wIn) return d <= heard; // in the restroom, they can only hear it
      if (d <= SHOOT.closeRange) return true;
      if (d <= SHOOT.sightRange && areaAt(w)?.id === room) return true;
      return d <= heard;
    })
    .map((w) => w.id);
}

// ---- drugs --------------------------------------------------------------------------------

export type DrugId = 'snow' | 'third-eye' | 'ice';

export interface DrugInfo {
  id: DrugId;
  name: string;
  /** In cash, from a dealer on the street. */
  price: number;
  icon: string;
  /** How long it lasts, ms. */
  lasts: number;
  what: string;
}

export const DRUGS: DrugInfo[] = [
  { id: 'snow', name: 'Snow', price: 300, icon: '❄️', lasts: 180_000, what: 'Every decision comes with a gut feeling. And every gut feeling is right.' },
  { id: 'third-eye', name: 'Third Eye', price: 500, icon: '🍄', lasts: 120_000, what: "You see through things: the dealer's hole card, the next card, other people's hands and dice." },
  { id: 'ice', name: 'Ice Water', price: 400, icon: '💊', lasts: 180_000, what: 'Steady as a rock: no spinning, no blur, no bladder, and the drink cannot kill you.' },
];
export const drugInfo = (id: string) => DRUGS.find((d) => d.id === id);

/** The two dealers on the street, in the dark ends of the pavement. */
export const DEALERS: { name: string; at: Pt; yaw: number; color: string }[] = [
  { name: 'Sketchy Steve', at: { x: -34, z: 42.4 }, yaw: 0, color: '#5a6a4a' },
  { name: 'Twitchy Tina', at: { x: 35, z: 21.4 }, yaw: Math.PI, color: '#6a4a6a' },
];
export const dealerAt = (p: Pt) => DEALERS.find((d) => Math.hypot(p.x - d.at.x, p.z - d.at.z) < 2.4) ?? null;

/** Drug effects on someone: when each wears off (ms since 1970), or absent. */
export type Effects = Partial<Record<DrugId, number>>;

// ---- bodies -------------------------------------------------------------------------------

export interface HeldLike {
  itemId: string;
  left: number;
}

/** Someone dead on the casino floor, and what is on them. */
export interface Body {
  id: number;
  name: string;
  color: string;
  x: number;
  z: number;
  yaw: number;
  chips: number;
  items: HeldLike[];
  /** Hidden in the toilet stall: nobody can see it. */
  hidden: boolean;
}

/** What anything in a hotbar slot is: food or drink from the menu, a gun, or a drug. */
export function heldInfo(itemId: string): { name: string; icon: string; kind: 'food' | 'gun' | 'drug' } | null {
  const m = menuItem(itemId);
  if (m) return { name: m.name, icon: m.icon, kind: 'food' };
  const g = gunInfo(itemId);
  if (g) return { name: g.name, icon: '🔫', kind: 'gun' };
  const d = drugInfo(itemId);
  if (d) return { name: d.name, icon: d.icon, kind: 'drug' };
  return null;
}
/** How many uses something in your hand starts with. */
export function startingUses(itemId: string): number {
  const m = menuItem(itemId);
  return m ? portions(m) : 1;
}

export const LOOT_RANGE = 1.6;
/** Hands with a regular before they will step into the bathroom with you. */
export const LURE_HANDS = 3;
