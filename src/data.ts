// Static game data: weapons, zombie types and perks.

export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  fireRate: number; // shots per second
  mag: number;
  reload: number; // seconds
  spread: number; // radians, total cone
  pellets: number;
  speed: number;
  life: number; // bullet lifetime in seconds
  price: number;
  upgradeBase: number;
  shake: number;
  color: string;
}

export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: 'Pistol', damage: 22, fireRate: 4.5, mag: 12, reload: 0.9, spread: 0.04, pellets: 1, speed: 950, life: 0.6, price: 0, upgradeBase: 80, shake: 0.12, color: '#ffe08a' },
  { id: 'smg', name: 'SMG', damage: 13, fireRate: 12, mag: 36, reload: 1.5, spread: 0.14, pellets: 1, speed: 900, life: 0.5, price: 250, upgradeBase: 140, shake: 0.08, color: '#ffd166' },
  { id: 'shotgun', name: 'Shotgun', damage: 15, fireRate: 1.5, mag: 6, reload: 1.9, spread: 0.42, pellets: 8, speed: 820, life: 0.38, price: 450, upgradeBase: 180, shake: 0.35, color: '#ffb36b' },
  { id: 'rifle', name: 'Assault Rifle', damage: 26, fireRate: 9, mag: 30, reload: 1.7, spread: 0.06, pellets: 1, speed: 1150, life: 0.6, price: 900, upgradeBase: 260, shake: 0.14, color: '#a0f0ff' },
];

export type ZombieKind = 'walker' | 'runner' | 'tank' | 'boss';

export interface ZombieDef {
  kind: ZombieKind;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  cash: number;
  body: string;
  dark: string;
  mass: number;
}

export const ZOMBIES: Record<ZombieKind, ZombieDef> = {
  walker: { kind: 'walker', hp: 45, speed: 82, damage: 9, radius: 15, cash: 4, body: '#6b8f4e', dark: '#3f5a2c', mass: 1 },
  runner: { kind: 'runner', hp: 26, speed: 165, damage: 6, radius: 12, cash: 6, body: '#a3a35a', dark: '#5f5f2c', mass: 0.7 },
  tank: { kind: 'tank', hp: 320, speed: 52, damage: 24, radius: 27, cash: 25, body: '#4f6b5e', dark: '#2b3d34', mass: 4 },
  boss: { kind: 'boss', hp: 2600, speed: 62, damage: 30, radius: 48, cash: 300, body: '#7a3f8f', dark: '#3f1f4a', mass: 20 },
};

// Everything a perk can change lives here.
export interface Stats {
  damage: number;
  fireRate: number;
  reload: number;
  mag: number;
  pierce: number;
  ricochet: number;
  lifesteal: number;
  speed: number;
  explode: number;
  extraShots: number;
  cash: number;
  crit: number;
  frost: number;
  magnet: number;
  blades: number;
  drones: number;
  nova: number;
  maxHp: number;
}

export function baseStats(): Stats {
  return {
    damage: 1,
    fireRate: 1,
    reload: 1,
    mag: 1,
    pierce: 0,
    ricochet: 0,
    lifesteal: 0,
    speed: 1,
    explode: 0,
    extraShots: 0,
    cash: 1,
    crit: 0.05,
    frost: 0,
    magnet: 1,
    blades: 0,
    drones: 0,
    nova: 0,
    maxHp: 100,
  };
}

export type Rarity = 'common' | 'rare' | 'epic';

export interface PerkDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  rarity: Rarity;
  max: number;
  apply: (s: Stats) => void;
}

export const PERKS: PerkDef[] = [
  { id: 'hollow', name: 'Hollow Points', icon: '💥', desc: '+25% damage', rarity: 'common', max: 6, apply: (s) => (s.damage += 0.25) },
  { id: 'trigger', name: 'Trigger Happy', icon: '🔫', desc: '+20% fire rate', rarity: 'common', max: 5, apply: (s) => (s.fireRate += 0.2) },
  { id: 'hands', name: 'Fast Hands', icon: '✋', desc: '30% faster reloads', rarity: 'common', max: 3, apply: (s) => (s.reload *= 0.7) },
  { id: 'mags', name: 'Big Mags', icon: '📦', desc: '+50% magazine size', rarity: 'common', max: 4, apply: (s) => (s.mag += 0.5) },
  { id: 'sprint', name: 'Sprinter', icon: '👟', desc: '+15% move speed', rarity: 'common', max: 3, apply: (s) => (s.speed += 0.15) },
  { id: 'tough', name: 'Tough Skin', icon: '❤️', desc: '+25 max HP', rarity: 'common', max: 6, apply: (s) => (s.maxHp += 25) },
  { id: 'greed', name: 'Greed', icon: '💰', desc: '+35% cash from kills', rarity: 'common', max: 4, apply: (s) => (s.cash += 0.35) },
  { id: 'magnet', name: 'Magnet', icon: '🧲', desc: 'Pick up cash from further away', rarity: 'common', max: 3, apply: (s) => (s.magnet += 0.8) },
  { id: 'pierce', name: 'Piercing Rounds', icon: '🎯', desc: 'Bullets pass through +1 zombie', rarity: 'rare', max: 3, apply: (s) => (s.pierce += 1) },
  { id: 'ricochet', name: 'Ricochet', icon: '↪️', desc: 'Bullets bounce to another zombie', rarity: 'rare', max: 3, apply: (s) => (s.ricochet += 1) },
  { id: 'vampire', name: 'Vampire', icon: '🧛', desc: 'Kills heal 2 HP', rarity: 'rare', max: 3, apply: (s) => (s.lifesteal += 2) },
  { id: 'crit', name: 'Lucky Shot', icon: '🍀', desc: '+12% chance to crit for 2.5x', rarity: 'rare', max: 4, apply: (s) => (s.crit += 0.12) },
  { id: 'frost', name: 'Frost Rounds', icon: '❄️', desc: 'Hits slow zombies down', rarity: 'rare', max: 1, apply: (s) => (s.frost = 1) },
  { id: 'nova', name: 'Shockwave', icon: '🌀', desc: 'Getting hit blasts zombies away', rarity: 'rare', max: 3, apply: (s) => (s.nova += 1) },
  { id: 'explode', name: 'Explosive Rounds', icon: '🧨', desc: '15% chance for bullets to explode', rarity: 'epic', max: 3, apply: (s) => (s.explode += 0.15) },
  { id: 'multi', name: 'Multishot', icon: '🔱', desc: '+1 bullet per shot', rarity: 'epic', max: 3, apply: (s) => (s.extraShots += 1) },
  { id: 'blades', name: 'Saw Blades', icon: '⚙️', desc: 'A saw blade orbits you', rarity: 'epic', max: 4, apply: (s) => (s.blades += 1) },
  { id: 'drone', name: 'Gun Drone', icon: '🛸', desc: 'A drone shoots nearby zombies', rarity: 'epic', max: 3, apply: (s) => (s.drones += 1) },
];

export const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, rare: 30, epic: 12 };
