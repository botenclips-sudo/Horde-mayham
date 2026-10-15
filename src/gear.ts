// Gear: an armor slot and a trinket slot, filled with loot from boss crates or bought supply crates.
// Every item has a rarity that scales its bonus.

export type Slot = 'armor' | 'trinket';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_COLOR: Record<Rarity, string> = { common: '#c9d1b8', rare: '#4fa8ff', epic: '#c065ff', legendary: '#ffb020' };
export const SCRAP_VALUE: Record<Rarity, number> = { common: 10, rare: 25, epic: 60, legendary: 150 };

export interface GearBonus {
  dr: number; // fraction of damage ignored
  hp: number;
  speed: number;
  crit: number;
  nades: number;
  power: number; // power-up duration multiplier bonus
  cash: number;
  brains: number;
  dmg: number;
}

export const emptyBonus = (): GearBonus => ({ dr: 0, hp: 0, speed: 0, crit: 0, nades: 0, power: 0, cash: 0, brains: 0, dmg: 0 });

export interface GearDef {
  id: string;
  slot: Slot;
  icon: string;
  name: string;
  /** The bonus for each rarity, as [common, rare, epic, legendary]. */
  values: [number, number, number, number];
  stat: keyof GearBonus;
  desc: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const GEAR: GearDef[] = [
  { id: 'vest', slot: 'armor', icon: '🦺', name: 'Kevlar Vest', stat: 'dr', values: [0.04, 0.07, 0.1, 0.15], desc: (v) => `Take ${pct(v)} less damage` },
  { id: 'riot', slot: 'armor', icon: '🥋', name: 'Riot Suit', stat: 'hp', values: [15, 25, 40, 60], desc: (v) => `+${v} max HP` },
  { id: 'track', slot: 'armor', icon: '🩳', name: 'Lucky Tracksuit', stat: 'speed', values: [0.04, 0.07, 0.1, 0.14], desc: (v) => `+${pct(v)} move speed` },
  { id: 'spikes', slot: 'armor', icon: '🦔', name: 'Spiked Jacket', stat: 'dmg', values: [0.04, 0.07, 0.1, 0.15], desc: (v) => `+${pct(v)} damage` },
  { id: 'foot', slot: 'trinket', icon: '🐾', name: "Rabbit's Foot", stat: 'crit', values: [0.03, 0.05, 0.08, 0.12], desc: (v) => `+${pct(v)} crit chance` },
  { id: 'pouch', slot: 'trinket', icon: '👝', name: 'Grenade Pouch', stat: 'nades', values: [1, 1, 2, 3], desc: (v) => `+${v} grenade${v > 1 ? 's' : ''} per wave` },
  { id: 'battery', slot: 'trinket', icon: '🔋', name: 'Battery Pack', stat: 'power', values: [0.2, 0.35, 0.5, 0.75], desc: (v) => `Power-ups last ${pct(v)} longer` },
  { id: 'tooth', slot: 'trinket', icon: '🦷', name: 'Gold Tooth', stat: 'cash', values: [0.1, 0.2, 0.3, 0.45], desc: (v) => `+${pct(v)} cash` },
  { id: 'jar', slot: 'trinket', icon: '🫙', name: 'Brain Jar', stat: 'brains', values: [0.1, 0.2, 0.3, 0.5], desc: (v) => `+${pct(v)} brains from runs` },
];

export const gearDef = (id: string) => GEAR.find((g) => g.id === id);

export interface GearItem {
  uid: string;
  id: string;
  rarity: Rarity;
}

export const gearValue = (it: GearItem) => gearDef(it.id)!.values[RARITIES.indexOf(it.rarity)];

/** Rolls a piece of loot. Later waves and boss crates roll better rarities. */
export function rollGear(wave: number, luck = 0): GearItem {
  const r = Math.random();
  const leg = Math.min(0.12, 0.01 + wave * 0.0015 + luck * 0.04);
  const epic = Math.min(0.3, 0.06 + wave * 0.004 + luck * 0.08);
  const rare = 0.35 + luck * 0.1;
  const rarity: Rarity = r < leg ? 'legendary' : r < leg + epic ? 'epic' : r < leg + epic + rare ? 'rare' : 'common';
  const def = GEAR[Math.floor(Math.random() * GEAR.length)];
  return { uid: Math.random().toString(36).slice(2, 10), id: def.id, rarity };
}
