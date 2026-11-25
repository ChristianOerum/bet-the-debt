// Your body: health, how fed you are, how much water is in you, how much wants to come out,
// and how drunk you are. The server keeps these; browsers draw them.

/** All 0-100, except bac (blood alcohol, in promille ‰). */
export interface Vitals {
  health: number;
  /** 100 = stuffed, 0 = starving. */
  hunger: number;
  /** 100 = well watered, 0 = parched. */
  thirst: number;
  /** 100 = cannot hold it any more. */
  bladder: number;
  /** Blood alcohol, ‰. Past 3.0 it may kill you; at 3.5 it will. */
  bac: number;
}

export const VITALS = {
  /** Per second. */
  hungerDrop: 0.05,
  thirstDrop: 0.07,
  /** The bladder fills this fast, times (1 + bac): drinking makes you go more. */
  bladderFill: 0.05,
  /** The liver clears this much ‰ a second (about 0.15 ‰ a minute). */
  burnOff: 0.0025,
  /** Starving or parched: health lost a second. */
  starve: 0.5,
  /** Fed and watered: health back a second. */
  heal: 0.1,
  /** How fast you empty, a second, while peeing. */
  peeRate: 14,
  /** Below this there is nothing to come out. */
  peeMin: 3,
  /** Where the danger starts, and where it is certain. */
  bacDanger: 3.0,
  bacFatal: 3.5,
  /** Peeing on the casino floor: the cleaner's bill, in chips. */
  cleaningFee: 50,
};

export const freshVitals = (): Vitals => ({ health: 100, hunger: 75, thirst: 75, bladder: 15, bac: 0 });
/** Waking up the morning after: hungry, thirsty, and in a hurry to get to the toilet. */
export const morningVitals = (): Vitals => ({ health: 100, hunger: 45, thirst: 40, bladder: 60, bac: 0 });

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** One second (or `dt` seconds) of being alive. */
export function tickVitals(v: Vitals, dt: number): Vitals {
  const n = { ...v };
  n.hunger = clamp(v.hunger - VITALS.hungerDrop * dt);
  n.thirst = clamp(v.thirst - VITALS.thirstDrop * dt);
  n.bladder = clamp(v.bladder + VITALS.bladderFill * (1 + v.bac) * dt);
  n.bac = Math.max(0, v.bac - VITALS.burnOff * dt);
  if (n.hunger <= 0 || n.thirst <= 0) n.health = clamp(v.health - VITALS.starve * dt);
  else if (n.hunger > 40 && n.thirst > 40) n.health = clamp(v.health + VITALS.heal * dt);
  return n;
}

// ---- the menu ---------------------------------------------------------------------------

export type MenuSection = 'food' | 'soft' | 'beer' | 'cocktail' | 'shot' | 'home';

export interface MenuItem {
  id: string;
  name: string;
  section: MenuSection;
  /** In chips (the house's, while you are on a run). 0 at home. */
  price: number;
  icon: string;
  hunger?: number;
  thirst?: number;
  bladder?: number;
  /** ‰ added to your blood alcohol. */
  alcohol?: number;
  blurb: string;
}

export const MENU_SECTIONS: { id: MenuSection; label: string }[] = [
  { id: 'food', label: 'Food' },
  { id: 'soft', label: 'Soft drinks' },
  { id: 'beer', label: 'Beer' },
  { id: 'cocktail', label: 'Cocktails' },
  { id: 'shot', label: 'Shots' },
];

export const MENU: MenuItem[] = [
  { id: 'peanuts', name: 'Salted peanuts', section: 'food', price: 10, icon: '🥜', hunger: 8, thirst: -6, blurb: 'Make you thirsty. That is the point.' },
  { id: 'fries', name: 'Fries', section: 'food', price: 30, icon: '🍟', hunger: 18, thirst: -4, blurb: 'Hot, salty, gone in a minute.' },
  { id: 'hotdog', name: 'Hot dog', section: 'food', price: 40, icon: '🌭', hunger: 25, blurb: 'Do not ask what is in it.' },
  { id: 'club', name: 'Club sandwich', section: 'food', price: 60, icon: '🥪', hunger: 35, blurb: 'Three floors of sandwich.' },
  { id: 'burger', name: 'Cheeseburger', section: 'food', price: 80, icon: '🍔', hunger: 45, blurb: 'Double patty. Single napkin.' },
  { id: 'pizza', name: 'Pizza slice', section: 'food', price: 35, icon: '🍕', hunger: 22, blurb: 'Pepperoni. Cold in the middle.' },
  { id: 'lobster', name: 'Lobster thermidor', section: 'food', price: 400, icon: '🦞', hunger: 70, blurb: 'For when you are winning. Or want to look it.' },
  { id: 'water', name: 'Glass of water', section: 'soft', price: 5, icon: '💧', thirst: 30, bladder: 10, blurb: 'Sobers you up. Slightly. In your head.' },
  { id: 'cola', name: 'Cola', section: 'soft', price: 15, icon: '🥤', thirst: 22, bladder: 10, hunger: 3, blurb: 'Fizzy, sweet, and very brown.' },
  { id: 'coffee', name: 'Black coffee', section: 'soft', price: 20, icon: '☕', thirst: 10, bladder: 14, blurb: 'Makes you a wide-awake drunk.' },
  { id: 'juice', name: 'Orange juice', section: 'soft', price: 20, icon: '🧃', thirst: 25, bladder: 10, hunger: 4, blurb: 'Freshly opened.' },
  { id: 'lager', name: 'Lager', section: 'beer', price: 30, icon: '🍺', thirst: 15, bladder: 20, alcohol: 0.25, blurb: 'Cold, yellow, cheap.' },
  { id: 'stout', name: 'Stout', section: 'beer', price: 40, icon: '🍺', thirst: 12, bladder: 18, hunger: 6, alcohol: 0.3, blurb: 'A meal in a glass, they say.' },
  { id: 'ipa', name: 'IPA', section: 'beer', price: 45, icon: '🍻', thirst: 12, bladder: 18, alcohol: 0.35, blurb: 'Tastes like a pine tree.' },
  { id: 'pilsner', name: 'Pilsner', section: 'beer', price: 35, icon: '🍺', thirst: 15, bladder: 20, alcohol: 0.25, blurb: 'Crisp, and gone too fast.' },
  { id: 'martini', name: 'Dry martini', section: 'cocktail', price: 80, icon: '🍸', thirst: 4, bladder: 6, alcohol: 0.45, blurb: 'Shaken. Nobody asked how.' },
  { id: 'mojito', name: 'Mojito', section: 'cocktail', price: 70, icon: '🍹', thirst: 10, bladder: 10, alcohol: 0.35, blurb: 'More mint than a dentist.' },
  { id: 'margarita', name: 'Margarita', section: 'cocktail', price: 75, icon: '🍸', thirst: 8, bladder: 8, alcohol: 0.4, blurb: 'Salt on the rim, regret at the bottom.' },
  { id: 'old-fashioned', name: 'Old fashioned', section: 'cocktail', price: 90, icon: '🥃', thirst: 3, bladder: 5, alcohol: 0.5, blurb: 'Whisky, sugar, an orange peel, a bad idea.' },
  { id: 'negroni', name: 'Negroni', section: 'cocktail', price: 85, icon: '🍷', thirst: 3, bladder: 5, alcohol: 0.5, blurb: 'Bitter, like the last hand you lost.' },
  { id: 'pina-colada', name: 'Piña colada', section: 'cocktail', price: 70, icon: '🍍', thirst: 10, bladder: 10, hunger: 4, alcohol: 0.3, blurb: 'Comes with an umbrella. Keep it.' },
  { id: 'long-island', name: 'Long Island iced tea', section: 'cocktail', price: 100, icon: '🍹', thirst: 8, bladder: 12, alcohol: 0.9, blurb: 'Contains no tea. Contains everything else.' },
  { id: 'debt-collector', name: 'The Debt Collector', section: 'cocktail', price: 150, icon: '🔥', thirst: 2, bladder: 6, alcohol: 1.1, blurb: 'House special. Served on fire. Signed waiver optional.' },
  { id: 'vodka', name: 'Vodka shot', section: 'shot', price: 40, icon: '🥃', bladder: 2, alcohol: 0.4, blurb: 'Down in one.' },
  { id: 'whisky', name: 'Whisky, neat', section: 'shot', price: 60, icon: '🥃', bladder: 2, alcohol: 0.45, blurb: 'Smoky. Like the back room.' },
  { id: 'tequila', name: 'Tequila', section: 'shot', price: 45, icon: '🍋', bladder: 2, alcohol: 0.45, blurb: 'Lick, shoot, suck, regret.' },
  { id: 'absinthe', name: 'Absinthe', section: 'shot', price: 90, icon: '🧚', bladder: 2, alcohol: 0.8, blurb: 'You will see the green fairy. She deals blackjack.' },
  // At home, from the fridge: free, and nothing to write home about.
  { id: 'tap-water', name: 'Tap water', section: 'home', price: 0, icon: '🚰', thirst: 30, bladder: 10, blurb: 'Tastes of pipes.' },
  { id: 'old-pizza', name: 'Leftover pizza', section: 'home', price: 0, icon: '🍕', hunger: 20, blurb: 'From one of the boxes on the floor. Probably fine.' },
];

export const menuItem = (id: string) => MENU.find((m) => m.id === id);

/** What eating or drinking something does to you. `share` is how much of it: one bite or sip of several. */
export function consume(v: Vitals, item: MenuItem, share = 1): Vitals {
  return {
    health: v.health,
    hunger: clamp(v.hunger + (item.hunger ?? 0) * share),
    thirst: clamp(v.thirst + (item.thirst ?? 0) * share),
    // Alcohol goes straight through you.
    bladder: clamp(v.bladder + (item.bladder ?? 0) * share * (1 + v.bac * 0.3)),
    bac: v.bac + (item.alcohol ?? 0) * share,
  };
}

/** How many bites or sips something is. A shot goes down in one. */
export function portions(item: MenuItem): number {
  if (item.section === 'shot') return 1;
  if (item.id === 'peanuts' || item.id === 'lobster') return 4;
  return 3;
}

/** Your hands and pockets: what you are carrying to eat or drink, by hotbar slot (keys 1-4). */
export const HOTBAR_SLOTS = 4;
export interface HeldItem {
  itemId: string;
  /** Bites or sips left. */
  left: number;
}

/** Punching: how far you reach, how often you can swing, what it does. */
export const PUNCH = { reach: 1.5, cooldownMs: 450, damage: 8 };

/**
 * Drinking from `before` to `after` ‰: did it kill you? Past 3.0 ‰ every 0.1 ‰ you cross is a
 * roll of the dice, worse each time; at 3.5 ‰ you are dead for certain.
 */
export function alcoholKills(before: number, after: number, rnd: () => number = Math.random): boolean {
  if (after >= VITALS.bacFatal) return true;
  for (let k = 0; k < 5; k++) {
    const step = VITALS.bacDanger + k * 0.1;
    if (before < step && after >= step && rnd() < (step - 2.9) / 0.6) return true;
  }
  return false;
}

export const GUT = {
  /** Stone sober, nothing comes. */
  minBac: 0.3,
  /** The chance at a fresh decision: `base + perBac × ‰`. */
  base: 0.1,
  perBac: 0.2,
  /** Each decision without a hunch adds `missBase + missPerBac × ‰`: the feeling builds up. */
  missBase: 0.08,
  missPerBac: 0.06,
};

/**
 * How likely a hunch is at the next decision, at this ‰, after `misses` decisions in a row
 * without one. More drink, more feelings; and the longer since the last, the surer the next.
 * It always comes in the end. A hunch is never wrong.
 */
export function gutOdds(bac: number, misses = 0): { chance: number } {
  if (bac < GUT.minBac) return { chance: 0 };
  const chance = GUT.base + GUT.perBac * bac + Math.max(0, misses) * (GUT.missBase + GUT.missPerBac * bac);
  return { chance: Math.min(1, chance) };
}

/** A hunch at a table: the winning call. */
export interface GutFeeling {
  /** Changes whenever there is a new decision to make, so one hunch per decision. */
  key: string;
  /** What it says: always the call that wins. */
  right: string;
  /** The losing call, the opposite of `right` (kept for tests and for the record). */
  wrong: string;
  /** The button for the winning call (a CSS selector for the table's buttons), lit up purple. */
  pick: string;
}
