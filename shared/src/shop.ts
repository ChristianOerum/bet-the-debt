// What the shop on your home computer sells. The server checks every purchase against this
// same list, so a price here is the price.

export type ShopCategory = 'clothes' | 'home' | 'weapons' | 'upgrades';
/** Where on you a piece of clothing goes. One thing per place. */
export type WearSlot = 'head' | 'eyes' | 'body' | 'neck' | 'feet';

export interface ShopItem {
  id: string;
  name: string;
  category: ShopCategory;
  /** In cash, the money you keep between runs. */
  price: number;
  blurb: string;
  /** A little picture for the listing (an emoji, drawn by the browser). */
  icon: string;
  /** Background colour of the listing's picture. */
  tint: string;
  /** Clothes: where it is worn. */
  slot?: WearSlot;
  /** A bigger flat: the apartment level you move up to. */
  level?: number;
}

export const SHOP_NAME = 'Shoddy.com';

export const SHOP_CATEGORIES: { id: ShopCategory; label: string }[] = [
  { id: 'clothes', label: 'Clothes' },
  { id: 'home', label: 'For the home' },
  { id: 'weapons', label: 'Self-defence' },
  { id: 'upgrades', label: 'Bigger flats' },
];

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'hat-fedora', name: 'Lucky fedora', category: 'clothes', slot: 'head', price: 250, blurb: 'Worn by a man who won once. Smells faintly of cigars.', icon: '🎩', tint: '#3a2a4a' },
  { id: 'shades', name: 'Poker shades', category: 'clothes', slot: 'eyes', price: 120, blurb: 'Nobody can read your face. Nobody can read anything, actually.', icon: '🕶️', tint: '#1e2a3a' },
  { id: 'suit-gold', name: 'Gold lamé suit', category: 'clothes', slot: 'body', price: 1500, blurb: 'For when you want security to see you coming.', icon: '🥻', tint: '#5a4510' },
  { id: 'chain', name: 'Big gold chain', category: 'clothes', slot: 'neck', price: 800, blurb: 'Real gold-coloured metal.', icon: '📿', tint: '#4a3a10' },
  { id: 'scarf', name: 'Red silk scarf', category: 'clothes', slot: 'neck', price: 90, blurb: 'Hides the rope burn.', icon: '🧣', tint: '#5a1a1a' },
  { id: 'sneakers', name: 'Running shoes', category: 'clothes', slot: 'feet', price: 300, blurb: 'For leaving in a hurry.', icon: '👟', tint: '#1a3a3a' },
  { id: 'bed', name: 'An actual bed', category: 'home', price: 600, blurb: 'With legs. Off the floor. Luxury.', icon: '🛏️', tint: '#2a3a5a' },
  { id: 'plant', name: 'Pot plant', category: 'home', price: 40, blurb: 'Something in the flat that is still alive.', icon: '🪴', tint: '#1e3a22' },
  { id: 'tv', name: 'Television with a picture', category: 'home', price: 900, blurb: 'Your current one only gets snow.', icon: '📺', tint: '#2a2a3a' },
  { id: 'neon', name: 'Neon "LUCKY" sign', category: 'home', price: 450, blurb: 'Pink. Buzzes. Keeps the neighbours up.', icon: '💡', tint: '#4a1a3a' },
  { id: 'roach-motel', name: 'Roach motel', category: 'home', price: 15, blurb: 'Your flatmate has to go.', icon: '🪳', tint: '#3a2a1a' },
  { id: 'pistol', name: 'Pistol', category: 'weapons', price: 2500, blurb: 'Loud. Everyone in the building will know. Lose it if you die with it.', icon: '🔫', tint: '#2a2a2a' },
  { id: 'pistol-silenced', name: 'Pistol with suppressor', category: 'weapons', price: 6000, blurb: 'A polite little cough. Only people standing close will hear it.', icon: '🔫', tint: '#1a2a2a' },
  { id: 'apt-2', name: 'One-bedroom flat', category: 'upgrades', level: 2, price: 5000, blurb: 'Room to swing a cat. The landlord says the damp is "character".', icon: '🏠', tint: '#2a3a2a' },
  { id: 'apt-3', name: 'The penthouse (third floor)', category: 'upgrades', level: 3, price: 20000, blurb: 'High ceilings. A window that opens. A lock that works.', icon: '🏙️', tint: '#2a2a4a' },
];

export const shopItem = (id: string) => SHOP_ITEMS.find((i) => i.id === id);

/** Whatever someone asks to wear, cut down to clothes they own, one per place (the last one wins). */
export function validOutfit(wanted: unknown, owned: readonly string[]): string[] {
  if (!Array.isArray(wanted)) return [];
  const bySlot = new Map<WearSlot, string>();
  for (const id of wanted) {
    const item = typeof id === 'string' ? shopItem(id) : undefined;
    if (item?.slot && owned.includes(item.id)) bySlot.set(item.slot, item.id);
  }
  return [...bySlot.values()];
}

/** Why someone cannot buy this (or null if they can). */
export function cannotBuy(item: ShopItem | undefined, s: { cash: number; owned: readonly string[]; aptLevel: number }): string | null {
  if (!item) return 'That is not for sale.';
  if (item.level !== undefined) {
    if (item.level <= s.aptLevel) return 'You already live somewhere at least that nice.';
  } else if (s.owned.includes(item.id)) return 'You already have one.';
  if (item.price > s.cash) return 'Card declined. Not enough money in the bank.';
  return null;
}
