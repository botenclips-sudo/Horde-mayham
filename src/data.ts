// Static game data: weapons, zombie types and perks.

export type WeaponKind = 'bullet' | 'flame' | 'rocket' | 'tesla' | 'grenade' | 'frost';

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
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
  length: number; // drawn barrel length
  spinup?: number; // seconds to reach full fire rate (minigun)
  moveSlow?: number; // movement multiplier while firing
  pierce?: number; // extra zombies each bullet passes through
  ricochet?: number; // extra bounces to another zombie
  bounce?: number; // times a shot bounces off walls (saw discs)
  width?: number; // drawn tracer width
  goo?: boolean; // shots burst into acid pools that eat zombies
  homing?: boolean; // rockets steer toward the nearest zombie
  blast?: number; // rocket blast radius (default 115)
  vortex?: boolean; // grenades open a black hole that drags zombies in, then pops
  boomerang?: boolean; // the shot flies out, then curves back to you, cutting both ways
  harpoon?: boolean; // skewers zombies and shoves them back; slam them into a wall for bonus damage
  cluster?: boolean; // grenades burst into a ring of bomblets
}

export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: 'Pistol', kind: 'bullet', damage: 22, fireRate: 4.5, mag: 12, reload: 0.9, spread: 0.04, pellets: 1, speed: 950, life: 0.6, price: 0, upgradeBase: 80, shake: 0.12, color: '#ffe08a', length: 22 },
  { id: 'smg', name: 'SMG', kind: 'bullet', damage: 13, fireRate: 12, mag: 36, reload: 1.5, spread: 0.14, pellets: 1, speed: 900, life: 0.5, price: 250, upgradeBase: 140, shake: 0.08, color: '#ffd166', length: 26 },
  { id: 'shotgun', name: 'Shotgun', kind: 'bullet', damage: 15, fireRate: 1.5, mag: 6, reload: 1.9, spread: 0.42, pellets: 8, speed: 820, life: 0.38, price: 450, upgradeBase: 180, shake: 0.35, color: '#ffb36b', length: 30 },
  { id: 'rifle', name: 'Assault Rifle', kind: 'bullet', damage: 26, fireRate: 9, mag: 30, reload: 1.7, spread: 0.06, pellets: 1, speed: 1150, life: 0.6, price: 900, upgradeBase: 260, shake: 0.14, color: '#a0f0ff', length: 34 },
  { id: 'flamer', name: 'Flamethrower', kind: 'flame', damage: 7, fireRate: 28, mag: 140, reload: 2.2, spread: 0.32, pellets: 1, speed: 430, life: 0.42, price: 1300, upgradeBase: 380, shake: 0.02, color: '#ff8a2b', length: 30 },
  { id: 'rocket', name: 'Rocket Launcher', kind: 'rocket', damage: 130, fireRate: 1.1, mag: 4, reload: 2.4, spread: 0.02, pellets: 1, speed: 620, life: 1.4, price: 1900, upgradeBase: 520, shake: 0.4, color: '#ffcf5a', length: 36 },
  { id: 'launcher', name: 'Grenade Launcher', kind: 'grenade', damage: 105, fireRate: 1.6, mag: 6, reload: 2.3, spread: 0.04, pellets: 1, speed: 700, life: 0.55, price: 1500, upgradeBase: 420, shake: 0.3, color: '#9fd06a', length: 32 },
  { id: 'sniper', name: 'Sniper Rifle', kind: 'bullet', damage: 150, fireRate: 1.25, mag: 5, reload: 2.1, spread: 0, pellets: 1, speed: 2300, life: 0.75, price: 1700, upgradeBase: 460, shake: 0.32, color: '#ffffff', length: 42, pierce: 6 },
  { id: 'freeze', name: 'Freeze Ray', kind: 'frost', damage: 8, fireRate: 24, mag: 130, reload: 2.2, spread: 0.26, pellets: 1, speed: 540, life: 0.5, price: 1900, upgradeBase: 500, shake: 0.02, color: '#9fe8ff', length: 30 },
  { id: 'tesla', name: 'Tesla Gun', kind: 'tesla', damage: 34, fireRate: 4, mag: 32, reload: 2.2, spread: 0.5, pellets: 1, speed: 0, life: 0, price: 2300, upgradeBase: 600, shake: 0.08, color: '#8ad8ff', length: 30 },
  { id: 'minigun', name: 'Minigun', kind: 'bullet', damage: 15, fireRate: 24, mag: 180, reload: 3.2, spread: 0.17, pellets: 1, speed: 1050, life: 0.55, price: 2800, upgradeBase: 700, shake: 0.07, color: '#ffe9a0', length: 38, spinup: 0.7, moveSlow: 0.6 },
  { id: 'crossbow', name: 'Crossbow', kind: 'bullet', damage: 95, fireRate: 1.9, mag: 8, reload: 1.6, spread: 0.01, pellets: 1, speed: 1500, life: 0.7, price: 1100, upgradeBase: 320, shake: 0.18, color: '#d8f0a0', length: 30, pierce: 3, width: 3.5 },
  { id: 'autoshotgun', name: 'Auto Shotgun', kind: 'bullet', damage: 12, fireRate: 4, mag: 16, reload: 2.4, spread: 0.36, pellets: 6, speed: 800, life: 0.34, price: 1600, upgradeBase: 430, shake: 0.24, color: '#ffb36b', length: 32, width: 2.5 },
  { id: 'ripper', name: 'Ripper', kind: 'bullet', damage: 70, fireRate: 2.4, mag: 10, reload: 2, spread: 0.03, pellets: 1, speed: 640, life: 1.5, price: 2100, upgradeBase: 560, shake: 0.12, color: '#dfe6ee', length: 30, pierce: 2, ricochet: 1, bounce: 3, width: 5 },
  { id: 'acid', name: 'Acid Cannon', kind: 'bullet', damage: 30, fireRate: 3, mag: 14, reload: 1.9, spread: 0.08, pellets: 1, speed: 620, life: 0.6, price: 1400, upgradeBase: 400, shake: 0.12, color: '#9aff3a', length: 30, width: 6, goo: true },
  { id: 'swarm', name: 'Swarm Launcher', kind: 'rocket', damage: 42, fireRate: 1.6, mag: 8, reload: 2.4, spread: 0.2, pellets: 3, speed: 540, life: 1.6, price: 2400, upgradeBase: 620, shake: 0.16, color: '#ff9a5a', length: 32, homing: true, blast: 72 },
  { id: 'glaive', name: 'Glaive', kind: 'bullet', damage: 46, fireRate: 1.8, mag: 6, reload: 1.7, spread: 0.02, pellets: 1, speed: 780, life: 0.5, price: 1250, upgradeBase: 360, shake: 0.1, color: '#e0f4ff', length: 26, pierce: 99, width: 5, boomerang: true },
  { id: 'harpoon', name: 'Harpoon Gun', kind: 'bullet', damage: 90, fireRate: 1.3, mag: 5, reload: 1.9, spread: 0.01, pellets: 1, speed: 1300, life: 0.55, price: 1500, upgradeBase: 420, shake: 0.24, color: '#c8d0d8', length: 36, pierce: 3, width: 3, harpoon: true },
  { id: 'cluster', name: 'Cluster Bomb', kind: 'grenade', damage: 85, fireRate: 1, mag: 4, reload: 2.4, spread: 0.04, pellets: 1, speed: 660, life: 0.55, price: 2200, upgradeBase: 600, shake: 0.28, color: '#ffcf5a', length: 32, cluster: true },
  { id: 'singularity', name: 'Singularity', kind: 'grenade', damage: 170, fireRate: 0.8, mag: 3, reload: 2.6, spread: 0.02, pellets: 1, speed: 640, life: 0.5, price: 2600, upgradeBase: 680, shake: 0.3, color: '#c08aff', length: 34, vortex: true },
];

export type ZombieKind =
  | 'walker'
  | 'runner'
  | 'tank'
  | 'bloater'
  | 'spitter'
  | 'screamer'
  | 'shield'
  | 'leaper'
  | 'necro'
  | 'crawler'
  | 'dog'
  | 'soldier'
  | 'electric'
  | 'bomber'
  | 'burrower'
  | 'wraith'
  | 'webber'
  | 'medic'
  | 'sludger'
  | 'icer'
  | 'roller'
  | 'mimic'
  | 'egg'
  | 'boss'
  | 'brood'
  | 'juggernaut'
  | 'reaper'
  | 'sludge'
  | 'titan';

export interface ZombieDef {
  kind: ZombieKind;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  cash: number;
  body: string;
  dark: string;
  eye: string;
  mass: number;
}

export const ZOMBIES: Record<ZombieKind, ZombieDef> = {
  walker: { kind: 'walker', hp: 45, speed: 82, damage: 9, radius: 15, cash: 4, body: '#6b8f4e', dark: '#3f5a2c', eye: '#e8f060', mass: 1 },
  runner: { kind: 'runner', hp: 26, speed: 165, damage: 6, radius: 12, cash: 6, body: '#a3a35a', dark: '#5f5f2c', eye: '#ff3b2f', mass: 0.7 },
  tank: { kind: 'tank', hp: 320, speed: 52, damage: 24, radius: 27, cash: 25, body: '#4f6b5e', dark: '#2b3d34', eye: '#ff6a2b', mass: 4 },
  bloater: { kind: 'bloater', hp: 70, speed: 64, damage: 0, radius: 20, cash: 10, body: '#8fb83a', dark: '#4e6b17', eye: '#c8ff3a', mass: 1.6 },
  spitter: { kind: 'spitter', hp: 55, speed: 95, damage: 12, radius: 14, cash: 12, body: '#6a5a8f', dark: '#3a2f55', eye: '#d06bff', mass: 0.9 },
  screamer: { kind: 'screamer', hp: 60, speed: 92, damage: 8, radius: 14, cash: 14, body: '#b07a8a', dark: '#5e3a46', eye: '#ffffff', mass: 0.9 },
  shield: { kind: 'shield', hp: 230, speed: 66, damage: 18, radius: 22, cash: 22, body: '#5a6670', dark: '#2e353b', eye: '#ffb02b', mass: 3 },
  leaper: { kind: 'leaper', hp: 50, speed: 112, damage: 16, radius: 13, cash: 12, body: '#8a6a3a', dark: '#4a3818', eye: '#ffe23a', mass: 0.8 },
  necro: { kind: 'necro', hp: 95, speed: 70, damage: 10, radius: 16, cash: 24, body: '#3a3a52', dark: '#1c1c2c', eye: '#5dffb0', mass: 1.1 },
  crawler: { kind: 'crawler', hp: 32, speed: 150, damage: 10, radius: 11, cash: 8, body: '#5a4a44', dark: '#2e2420', eye: '#ff7a3a', mass: 0.6 },
  dog: { kind: 'dog', hp: 34, speed: 235, damage: 7, radius: 12, cash: 6, body: '#7a5a4a', dark: '#3e2a20', eye: '#ffdd44', mass: 0.6 },
  soldier: { kind: 'soldier', hp: 150, speed: 80, damage: 15, radius: 18, cash: 20, body: '#55623f', dark: '#2c3420', eye: '#ff4a2a', mass: 2 },
  electric: { kind: 'electric', hp: 85, speed: 90, damage: 10, radius: 15, cash: 18, body: '#3a5a7a', dark: '#1c2e40', eye: '#a0f0ff', mass: 1.2 },
  bomber: { kind: 'bomber', hp: 40, speed: 128, damage: 0, radius: 14, cash: 10, body: '#9a6a4a', dark: '#4a2e1c', eye: '#ffcf3a', mass: 0.9 },
  burrower: { kind: 'burrower', hp: 110, speed: 88, damage: 14, radius: 16, cash: 18, body: '#7a6248', dark: '#3e3020', eye: '#ffa040', mass: 1.4 },
  wraith: { kind: 'wraith', hp: 70, speed: 104, damage: 13, radius: 14, cash: 16, body: '#9ab0c0', dark: '#4a5a6a', eye: '#7affea', mass: 0.8 },
  webber: { kind: 'webber', hp: 60, speed: 92, damage: 6, radius: 14, cash: 12, body: '#5a5a6a', dark: '#2a2a36', eye: '#e0e0ff', mass: 0.9 },
  medic: { kind: 'medic', hp: 120, speed: 78, damage: 8, radius: 16, cash: 22, body: '#c8c8b8', dark: '#6a6a5a', eye: '#ff4a4a', mass: 1.2 },
  sludger: { kind: 'sludger', hp: 140, speed: 70, damage: 14, radius: 18, cash: 16, body: '#5a7a2a', dark: '#2e4214', eye: '#d0ff3a', mass: 1.6 },
  icer: { kind: 'icer', hp: 90, speed: 80, damage: 10, radius: 16, cash: 16, body: '#a8d8f0', dark: '#4a7a9a', eye: '#e0ffff', mass: 1.3 },
  roller: { kind: 'roller', hp: 130, speed: 74, damage: 18, radius: 17, cash: 18, body: '#c8d4dc', dark: '#5a6a78', eye: '#ff6a3a', mass: 2 },
  mimic: { kind: 'mimic', hp: 150, speed: 150, damage: 20, radius: 15, cash: 30, body: '#8a5a20', dark: '#4a2e10', eye: '#ff2a2a', mass: 1.2 },
  egg: { kind: 'egg', hp: 70, speed: 0, damage: 0, radius: 14, cash: 3, body: '#d8c89a', dark: '#8a7a4a', eye: '#d8c89a', mass: 50 },
  boss: { kind: 'boss', hp: 2600, speed: 62, damage: 30, radius: 48, cash: 300, body: '#7a3f8f', dark: '#3f1f4a', eye: '#ff2040', mass: 20 },
  juggernaut: { kind: 'juggernaut', hp: 2700, speed: 46, damage: 40, radius: 56, cash: 600, body: '#5a5f66', dark: '#2a2d32', eye: '#ff3a2a', mass: 30 },
  brood: { kind: 'brood', hp: 2400, speed: 50, damage: 34, radius: 54, cash: 450, body: '#8f6a3a', dark: '#4a3218', eye: '#ffef3a', mass: 24 },
  reaper: { kind: 'reaper', hp: 2500, speed: 72, damage: 32, radius: 46, cash: 650, body: '#2c2c38', dark: '#14141c', eye: '#7affea', mass: 22 },
  sludge: { kind: 'sludge', hp: 2600, speed: 54, damage: 34, radius: 52, cash: 550, body: '#6a8a2a', dark: '#34461a', eye: '#f0ff3a', mass: 26 },
  titan: { kind: 'titan', hp: 2800, speed: 50, damage: 38, radius: 58, cash: 600, body: '#9ac8e0', dark: '#3a5a74', eye: '#e0ffff', mass: 30 },
};

export const BOSS_NAMES: Partial<Record<ZombieKind, string>> = { boss: 'THE ABOMINATION', brood: 'MOTHER BROOD', juggernaut: 'THE JUGGERNAUT', reaper: 'THE REAPER', sludge: 'THE SLUDGE KING', titan: 'THE FROST TITAN' };

/** Boss waves cycle through these, one every 10 waves. */
export const BOSS_ORDER: ZombieKind[] = ['boss', 'brood', 'juggernaut', 'reaper', 'sludge', 'titan'];
/** Mini-boss waves (5, 15, 25...) preview the bosses you haven't met yet, at 40% health: all six show up by wave 30. */
export const MINI_BOSS_ORDER: ZombieKind[] = ['titan', 'sludge', 'reaper', 'juggernaut', 'brood', 'boss'];
export const BOSS_KINDS = new Set<ZombieKind>(BOSS_ORDER);

export type EliteKind = 'fast' | 'armored' | 'splitting' | 'vampiric' | 'explosive';

export const ELITES: Record<EliteKind, { name: string; color: string }> = {
  fast: { name: 'FAST', color: '#ffe23a' },
  armored: { name: 'ARMORED', color: '#b8c4d0' },
  splitting: { name: 'SPLITTING', color: '#5dff7a' },
  vampiric: { name: 'VAMPIRIC', color: '#ff2a4a' },
  explosive: { name: 'EXPLOSIVE', color: '#ff8a2b' },
};

export type PowerKind = 'nuke' | 'rage' | 'freeze' | 'ammo' | 'cash';

export const POWERUPS: Record<PowerKind, { name: string; color: string; icon: string; duration: number }> = {
  nuke: { name: 'NUKE', color: '#ffffff', icon: '☢', duration: 0 },
  rage: { name: 'RAGE', color: '#ff3b3b', icon: '🔥', duration: 8 },
  freeze: { name: 'DEEP FREEZE', color: '#7fd8ff', icon: '❄', duration: 5 },
  ammo: { name: 'BOTTOMLESS', color: '#ffd23f', icon: '∞', duration: 10 },
  cash: { name: 'DOUBLE CASH', color: '#5dff7a', icon: '$', duration: 15 },
};

export const COMBO_TIERS: [number, string][] = [
  [10, 'RAMPAGE!'],
  [25, 'MASSACRE!'],
  [50, 'UNSTOPPABLE!'],
  [100, 'GODLIKE!'],
  [200, 'HORDE MAYHEM!!'],
];

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
