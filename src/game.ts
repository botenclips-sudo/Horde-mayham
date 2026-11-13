import { MusicMood, Sfx, SfxKind } from './audio';
import { baseStats, BOSS_KINDS, BOSS_NAMES, BOSS_ORDER, COMBO_TIERS, MINI_BOSS_ORDER, EliteKind, ELITES, PERKS, PerkDef, POWERUPS, PowerKind, RARITY_WEIGHT, Stats, WEAPONS, WeaponDef, ZOMBIES, ZombieDef, ZombieKind } from './data';
import { Challenge, dailySetup, meta, RunReport } from './meta';
import { BORDER, isInnerGate, mapById, MapDef, WORLD_H, WORLD_W } from './maps';
import { emptyBonus, GearBonus, gearDef, GearItem, gearValue, RARITY_COLOR, rollGear } from './gear';

export { WORLD_H, WORLD_W };

const groundCache = new Map<string, HTMLCanvasElement>();
const blockedCache = new Map<string, Uint8Array>();
import { Input, STICK_RADIUS, stickVec } from './input';
import type { NetMsg } from './net';
import { type OpDef, OKAFOR } from './campaign';
import { ARM_FRAMES, armsSprite, bodySprite, eggSprite, eyeSpot, hasFeet, stamp, Tint, VARIANTS, warmZombieArt } from './zombieArt';

const PLAYER_R = 16;
const DASH_TIME = 0.18;
const DASH_COOLDOWN = 2.2;
const COMBO_TIME = 2.5;
const FLASHLIGHT = 560;
const DARKNESS = 0.86;

interface Bullet {
  kind: 'bullet' | 'flame' | 'rocket' | 'frost';
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  life: number;
  max: number;
  pierce: number;
  ricochet: number;
  hits: number[];
  color: string;
  width: number;
  canExplode: boolean;
  /** Saw discs: wall bounces left (drawn as a spinning blade). */
  bounce?: number;
  /** Acid Cannon: bursts into a pool of acid that eats zombies. */
  goo?: boolean;
  /** Swarm Launcher: steers toward the nearest zombie. */
  homing?: boolean;
  /** Rocket blast radius. */
  blast?: number;
  /** Glaive: flies out, then curves back to whoever threw it. */
  boomerang?: boolean;
  back?: boolean;
  /** Harpoon: skewers zombies and shoves them hard (into walls, for bonus damage). */
  harpoon?: boolean;
  /** A teammate's shot drawn for show; their own game does the damage. */
  ghost?: boolean;
  /** Mind Ray: hits soak a zombie's will until it turns. */
  charm?: boolean;
}

/** Patient Zero's three forms and the attack timers for each. */
interface ZeroState {
  phase: 1 | 2 | 3;
  /** Seconds left in a transformation (it can't be hurt meanwhile). */
  trans: number;
  tendril: number;
  summon: number;
  yank: number;
  /** Psychic pull wind-up. */
  yankT: number;
  laser: number;
  /** Eye laser: aiming (warn) then sweeping. */
  laserW: number;
  laserT: number;
  laserA: number;
  laserDir: number;
  laserHit: object[];
}

interface Zombie {
  id: number;
  def: ZombieDef;
  x: number;
  y: number;
  kx: number;
  ky: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  r: number;
  flash: number;
  slow: number;
  burn: number;
  attackCd: number;
  bladeCd: number;
  phase: number;
  face: number;
  dead: boolean;
  spitCd: number;
  tx?: number;
  ty?: number;
  boss?: { state: 'walk' | 'windup' | 'charge'; t: number; dx: number; dy: number; summon: number };
  brood?: { lay: number; spit: number };
  leap?: { state: 'walk' | 'crouch' | 'leap'; t: number; dx: number; dy: number };
  elite?: EliteKind;
  mini?: boolean;
  buff: number; // seconds of screamer rage left
  abilityCd: number; // screamer scream / necromancer raise / egg hatch / electric zap timer
  chill: number; // freeze-ray hits soaked up; enough of them freeze the zombie solid
  frozenT: number;
  plates: number; // armored soldier plates left
  plateHp: number;
  zapT: number; // electric zombie charging a zap
  jug?: { slam: number; windup: number };
  dig?: { state: 'walk' | 'under' | 'rise'; t: number }; // burrower
  ghostT: number; // wraith: seconds left passing through walls (can't be hit)
  fuse: number; // bomber: seconds until the vest goes off (0 = not lit)
  reap?: { sweep: number; windup: number; aim: number; blink: number; orbs: number; summoned: boolean };
  sludge?: { mortar: number; drip: number; splits: number }; // The Sludge King
  titan?: { boulder: number; nova: number; windup: number; enraged: boolean }; // The Frost Titan
  lurk?: boolean; // mimic: still pretending to be a supply crate
  stun?: number; // roller: dizzy after rolling into a wall (takes extra damage)
  pin?: number; // harpooned: seconds left in which a wall slam hurts
  pinDmg?: number;
  gen?: number; // Mitosis blob: 0 = full size, splits twice
  latch?: number; // parasite: seconds left clinging to you
  latchA?: number;
  psi: number; // Mind Ray hits soaked up
  charm: number; // seconds left fighting for you
  prey?: number; // who a turned zombie is going for
  regenT: number; // mutant: seconds since it last got hurt
  healing?: boolean;
  yank?: { cd: number; windup: number; tx: number; ty: number }; // psyker
  zero?: ZeroState;
  /** Co-op guests: where the host last saw this zombie (we glide toward it). */
  nx?: number;
  ny?: number;
}

interface Train {
  y: number; // track center
  dir: 1 | -1;
  phase: 'idle' | 'warn' | 'go';
  t: number;
  x: number; // left edge
  hitPlayer: boolean;
  hitBoss: number[];
}

const TRAIN_LEN = 1100;
const TRAIN_SPEED = 1600;

interface Bolt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  color: string;
}

const isBoss = (z: Zombie) => BOSS_KINDS.has(z.def.kind);
/** Burrowed or ghostly: bullets, blasts and blades pass right through. */
const intangible = (z: Zombie) => z.ghostT > 0 || z.dig?.state === 'under';
/** Not something your guns should hit: intangible, or turned to your side. */
const offLimits = (z: Zombie) => intangible(z) || z.charm > 0;

/** Patient Zero's tendrils: a red line on the floor, then spikes burst out along it. */
interface Spike {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Warning time left; below zero it's erupting. */
  t: number;
  hit: object[];
}
const SPIKE_WARN = 0.85;
const SPIKE_LIFE = 0.45;
const SPIKE_W = 26;

/** Hive Lab consoles: stand on one to arm a laser sweep across the whole map. */
interface Console {
  x: number;
  y: number;
  axis: 'x' | 'y';
  hold: number;
  cd: number;
  phase: 'idle' | 'warn' | 'sweep';
  t: number;
  pos: number;
  dir: number;
  hit: object[];
}
const CONSOLE_R = 48;
const CONSOLE_CD = 32;
const SWEEP_TIME = 2.6;

/** Railgun and Plasma Cutter beams. */
interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

/** Story mode: where an op stands. */
interface OpState {
  t: number;
  n: number;
  hits: number;
  done: boolean;
  end: number;
  radio: number;
  drives: { x: number; y: number }[];
  gen: { x: number; y: number; vx: number; vy: number; hp: number; max: number; hurt: number } | null;
  zone: { x: number; y: number; r: number; hold: number } | null;
}

export interface OpResult {
  op: OpDef;
  won: boolean;
  time: number;
  hits: number;
  hpFrac: number;
  summary: RunSummary;
}
const SWEEP_R = 215;
const SWEEP_ARC = 1.05;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  drag: number;
  decal: boolean;
  glow: boolean;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
}

interface Pickup {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: 'cash' | 'health' | 'crate';
  value: number; // for crates: loot luck
  pulled: boolean;
}

export type DeployKind = 'turret' | 'mine' | 'barricade' | 'medic';

interface Deployable {
  kind: DeployKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  t: number; // fire cooldown / mine arming / heal pulse
  life: number; // seconds left (Infinity for barricades and mines)
  angle: number;
  r: number;
}

export const DEPLOYS: Record<DeployKind, { icon: string; name: string; desc: string; price: (wave: number) => number }> = {
  turret: { icon: '🔫', name: 'Auto-turret', desc: 'Shoots the nearest zombie for 60s', price: (w) => 200 + w * 8 },
  mine: { icon: '💥', name: 'Land mines (x3)', desc: 'Blow up whatever steps on them', price: (w) => 90 + w * 3 },
  barricade: { icon: '🧱', name: 'Sandbag wall', desc: 'Blocks zombies until they chew through', price: (w) => 110 + w * 4 },
  medic: { icon: '⛑️', name: 'Healing station', desc: 'Heals you while you stand near it, 40s', price: (w) => 160 + w * 5 },
};

const KINDS = Object.keys(ZOMBIES) as ZombieKind[];
const WEAPON_BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));
const POWER_KINDS: PowerKind[] = ['nuke', 'rage', 'freeze', 'ammo', 'cash'];
const DEPLOY_KINDS = Object.keys(DEPLOYS) as DeployKind[];
const SNAP_EVERY = 1 / 15;
const STATE_EVERY = 1 / 20;
const REVIVE_TIME = 3;
const REVIVE_RANGE = 70;

/** Suit colors per co-op slot: body, backpack, helmet. Slot 0 is the solo look. */
export const SUITS = [
  ['#3d5a3a', '#2e4430', '#56784f'],
  ['#34507a', '#253a5a', '#5a7ab0'],
  ['#7a5a2a', '#5a401c', '#b08a4a'],
  ['#5e3a70', '#432a50', '#9064aa'],
];

/** Another player in a co-op run. The host aims the horde at them; everyone draws them. */
export interface Ally {
  id: string;
  name: string;
  slot: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  down: boolean;
  revive: number;
  weapon: string;
  firing: boolean;
  dashing: boolean;
  fireT: number;
  /** Host: ignore "I'm down" from this guest for a moment after reviving them (it's stale). */
  grace: number;
}

interface PowerDrop {
  x: number;
  y: number;
  kind: PowerKind;
  life: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  color: string;
}

interface Light {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

interface Grenade {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  fuse: number;
  dmg?: number; // launcher shells carry their own damage and go off on contact
  radius?: number;
  impact?: boolean;
  /** Singularity: opens a black hole instead of exploding right away. */
  vortex?: boolean;
  /** Cluster Bomb: bursts into bomblets. */
  cluster?: boolean;
  bomblet?: boolean;
  /** Co-op guests: the host's grenade, shown in flight only. */
  remote?: boolean;
}

interface Spit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  /** The Reaper's soul orbs: no acid puddle, just a hit. */
  soul?: boolean;
  /** Webber globs: no damage to speak of, but they stick you in place. */
  web?: boolean;
  /** Icer shards: chill whoever they hit. */
  shard?: boolean;
}

interface Puddle {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  kind: 'acid' | 'toxic' | 'sludge' | 'ice';
}

const PUDDLE_KINDS: Puddle['kind'][] = ['acid', 'toxic', 'sludge', 'ice'];

/** Acid Cannon pools: yours, they only hurt zombies. Each player's own game owns its pools. */
interface Goo {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  dps: number;
  tick: number;
  /** A teammate's pool, drawn for show. */
  ghost?: boolean;
}

/** Singularity black hole: drags zombies in, then pops. */
interface Vortex {
  x: number;
  y: number;
  t: number;
  max: number;
  dmg: number;
  tick: number;
  /** Co-op guests: the host's black hole, drawn for show. */
  remote?: boolean;
}

/** The Sludge King's lobbed globs: a landing mark first, then a splash. */
interface Mortar {
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  max: number;
  /** The Frost Titan's ice boulders: bigger, and they leave a sheet of ice. */
  ice?: boolean;
}

/** The Frost Titan's frost nova: a ring of cold that rolls outward. Dash through it. */
interface Nova {
  x: number;
  y: number;
  r: number;
  max: number;
  hit: object[];
}

/** Blizzards on the Frozen Outpost (and when the Titan rages): calm, a warning, then wind and snow. */
interface Blizzard {
  phase: 'calm' | 'warn' | 'blow';
  t: number;
  dir: number;
}

/** Refinery steam vents: hiss as a warning, then blast whatever stands on them. */
interface Vent {
  x: number;
  y: number;
  phase: 'idle' | 'warn' | 'blast';
  t: number;
  hit: object[];
}

const VENT_R = 62;
const MORTAR_R = 72;
const VORTEX_R = 240;
const WEB_TIME = 2.2;
const BOULDER_R = 84;
const NOVA_W = 26;
const WIND = 100;

interface Barrel {
  x: number;
  y: number;
  hp: number;
  fuse: number;
  dead: boolean;
  big: boolean; // gas pump: bigger and a much bigger blast
}

interface OwnedWeapon {
  def: WeaponDef;
  level: number;
  ammo: number;
  reloadT: number;
}

export interface ShopItem {
  id: string;
  label: string;
  sub: string;
  price: number;
  enabled: boolean;
}

export interface RunSummary {
  wave: number;
  kills: number;
  cash: number;
  time: number;
  bestCombo: number;
  report: RunReport;
  perks: string[];
  weapons: string[];
}

export interface Hooks {
  onWaveCleared: (wave: number) => void;
  onGameOver: (s: RunSummary) => void;
  onPause: () => void;
  /** A moment worth clipping just happened (boss kill, massacre, big combo). */
  onHighlight?: (label: string) => void;
  /** Solo death with no Second Wind left: offer a revive (ad, token, diamonds). Call reviveNow() or endRun(). */
  onReviveOffer?: () => void;
  /** Story mode: an op was won or lost. */
  onOpEnd?: (r: OpResult) => void;
}

export type State = 'menu' | 'playing' | 'between' | 'paused' | 'over';

// Flow field for zombie pathing: a BFS distance map from the player over a coarse grid.
const CELL = 40;
const FLOW_W = Math.ceil(WORLD_W / CELL);
const FLOW_H = Math.ceil(WORLD_H / CELL);
/** Which flow-field cells are inside (or hugging) a wall, per map. */
function blockedFor(map: MapDef): Uint8Array {
  let b = blockedCache.get(map.id);
  if (b) return b;
  b = new Uint8Array(FLOW_W * FLOW_H);
  const pad = 14;
  for (let cy = 0; cy < FLOW_H; cy++)
    for (let cx = 0; cx < FLOW_W; cx++) {
      const x0 = cx * CELL;
      const y0 = cy * CELL;
      for (const w of map.walls) {
        if (x0 + CELL > w.x - pad && x0 < w.x + w.w + pad && y0 + CELL > w.y - pad && y0 < w.y + w.h + pad) {
          b[cy * FLOW_W + cx] = 1;
          break;
        }
      }
    }
  blockedCache.set(map.id, b);
  return b;
}

const FLOW_QUEUE = new Int32Array(FLOW_W * FLOW_H);
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Which wave each new zombie type starts showing up, announced on the wave banner.
const WEAPON_BLURB: Record<string, string> = {
  prism: '💎 Exclusive: a laser that slices through 10 zombies in a line',
  flamer: 'Sets the horde on fire',
  rocket: 'Huge explosions',
  minigun: 'Spins up, shreds everything',
  launcher: 'Explodes on contact',
  sniper: 'Punches through 6 zombies',
  freeze: 'Freezes zombies solid',
  tesla: 'Lightning chains between zombies',
  crossbow: 'Bolts punch through 3 zombies',
  autoshotgun: 'Full-auto buckshot',
  ripper: 'Saw discs bounce off walls',
  railgun: 'Hold to charge, pierces everything in a line',
  plasma: 'A beam that heats up the longer it stays on target',
  mindray: 'Turns zombies to fight for you',
  acid: 'Leaves pools of acid that eat zombies',
  swarm: 'Three rockets that hunt zombies down',
  singularity: 'A black hole drags the horde in, then pops',
  glaive: 'A blade that flies out and comes back',
  harpoon: 'Skewers zombies; slam them into walls',
  cluster: 'Bursts into a ring of bomblets',
};

const BOSS_COLORS: Partial<Record<ZombieKind, string>> = { boss: '#c065ff', brood: '#ffcf5a', juggernaut: '#ff6a3a', reaper: '#7affea', sludge: '#c8ff3a', titan: '#bfe8ff', zero: '#ff5adc' };

const ELITE_KINDS = Object.keys(ELITES) as EliteKind[];

const NEW_KIND_WAVES: Record<number, string> = {
  2: 'SOME OF THOSE CRATES BITE',
  3: 'ROLLERS: SIDESTEP THE CHARGE',
  4: 'WEBBERS: THEIR WEBS SLOW YOU DOWN',
  5: 'SHIELD BRUTES SPOTTED',
  6: 'WATCH FOR LEAPERS',
  7: 'BOMBERS: POP THEM BEFORE THEY REACH YOU',
  8: 'SCREAMERS ARE HERE',
  9: 'CRAWLERS IN THE DARK',
  11: 'DOG PACKS INCOMING',
  12: 'NECROMANCERS RAISE THE DEAD',
  13: 'ARMORED SOLDIERS: BREAK THEIR PLATES',
  14: 'ELECTRIC ZOMBIES',
  16: 'BURROWERS: WATCH THE GROUND MOVE',
  17: 'MEDICS HEAL THE HORDE: KILL THEM FIRST',
  18: 'WRAITHS WALK THROUGH WALLS',
  19: 'SLUDGERS LEAVE TOXIC TRAILS',
  21: 'ICERS SHATTER: KILL THEM FROM RANGE',
};

/** The lab's own zombies: when they turn up outside the lab, and what the banner says. */
const LAB_KINDS: [ZombieKind, number, string][] = [
  ['parasite', 21, 'PARASITES: DASH TO SHAKE THEM OFF'],
  ['mutant', 22, 'MUTANTS REGENERATE: BURN OR FREEZE THEM'],
  ['blob', 23, 'MITOSIS BLOBS SPLIT WHEN THEY POP'],
  ['psyker', 24, 'PSYKERS PULL YOU IN: DASH SIDEWAYS'],
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Distance from a point to a line segment. */
function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
const FONT = "'Black Ops One', 'Arial Black', system-ui, sans-serif";
const MONO = "'Share Tech Mono', ui-monospace, 'Roboto Mono', monospace";
const HUD_AMBER = '#f0b429';
const HUD_PLATE = 'rgba(8,10,7,0.72)';

/** Tactical corner brackets around a HUD box. */
function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, len = 7, color = HUD_AMBER) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** A soft radial blob in one color, cached so glows cost one drawImage instead of a gradient. */
function glowSprite(color: string): HTMLCanvasElement {
  let c = spriteCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(0.5, color.startsWith('#') ? color + '99' : color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  spriteCache.set(color, c);
  return c;
}

export class Game {
  state: State = 'menu';
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private zoom = 1;
  private zoomKick = 0;
  /** Set when the device can't hold ~45 fps in a big fight: zombies drop their animated arms and feet. */
  liteZombies = false;
  private frameAvg = 1 / 60;
  private lagT = 0;
  private cam = { x: WORLD_W / 2, y: WORLD_H / 2 };
  private ground!: HTMLCanvasElement;
  map: MapDef = mapById('lot');
  private blocked: Uint8Array = new Uint8Array(0);
  private decals: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private light: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private vignette: HTMLCanvasElement | null = null;

  // Run state
  stats: Stats = baseStats();
  perkCounts = new Map<string, number>();
  weapons: OwnedWeapon[] = [];
  wi = 0;
  cash = 0;
  armor = 0;
  wave = 0;
  grenadesMax = 2;
  private grenadeCount = 2;
  private p = { x: 0, y: 0, hp: 100, angle: 0, vx: 0, vy: 0 };
  private fireCd = 0;
  private spin = 0;
  private dashT = 0;
  private dashCd = 0;
  private dashDir = { x: 0, y: 0 };
  private novaCd = 0;
  private hurtFlash = 0;
  private zombies: Zombie[] = [];
  private bullets: Bullet[] = [];
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private pickups: Pickup[] = [];
  private powers: PowerDrop[] = [];
  private active: Record<PowerKind, number> = { nuke: 0, rage: 0, freeze: 0, ammo: 0, cash: 0 };
  private rings: Ring[] = [];
  private lights: Light[] = [];
  private grenades: Grenade[] = [];
  private spits: Spit[] = [];
  private puddles: Puddle[] = [];
  private goos: Goo[] = [];
  private vortexes: Vortex[] = [];
  private mortars: Mortar[] = [];
  private vents: Vent[] = [];
  private ventWarned = false;
  private webT = 0;
  /** Chilled by icers, shards and the Titan: slower until it wears off. */
  private chillT = 0;
  private chillK = 1;
  private novas: Nova[] = [];
  private blizzard: Blizzard = { phase: 'calm', t: 30, dir: 0 };
  private blizzardWarned = false;
  private spikes: Spike[] = [];
  private consoles: Console[] = [];
  private consoleWarned = false;
  /** Lab power: seconds until the next cut, and seconds left in a cut. */
  private power = { t: 45, out: 0 };
  private charge = 0;
  private beams: Beam[] = [];
  private heat = { id: -1, n: 0 };
  /** Psyker / Patient Zero pull: you're dragged toward (x, y) for t seconds. */
  private pull = { x: 0, y: 0, t: 0 };
  private latchWarned = false;
  private subtitle = { who: '', text: '', t: 0 };
  /** Story mode op being played (null in every other mode). */
  op: OpDef | null = null;
  private opS: OpState = Game.emptyOp();
  private barrels: Barrel[] = [];
  private toSpawn = 0;
  private spawnT = 0;
  private clearT = -1;
  private kills = 0;
  private earned = 0;
  private runTime = 0;
  private clock = 0;
  private trauma = 0;
  private slowT = 0;
  private hitstop = 0;
  private flash = { t: 0, color: '#fff', max: 1 };
  private nextId = 1;
  private bladeAngle = 0;
  private droneT: number[] = [];
  private banner = { text: '', sub: '', t: 0, color: '#fff' };
  private shout = { text: '', t: 0, color: '#ffd23f' };
  private cashPulse = 0;
  private combo = 0;
  private comboT = 0;
  private comboPop = 0;
  private bestCombo = 0;
  private heartT = 0;
  private ghosts: { x: number; y: number; a: number; life: number }[] = [];
  private flow = new Int32Array(FLOW_W * FLOW_H);
  private flowT = 0;
  /** Seconds since the last kill; drives the straggler rescue. */
  private quietT = 0;
  private mood: MusicMood | '' = '';
  private report: RunReport = Game.emptyReport();
  private reviveLeft = 0;
  /** The one paid/ad revive per run has been offered. */
  private reviveOffered = false;
  /** Waiting on the revive offer screen. */
  awaitingRevive = false;
  /** Diamond-shop skin for this player (null = the slot's normal suit). */
  skin: string[] | null = null;
  private corpses: { x: number; y: number }[] = [];
  private nadeBlast = false;
  private cause: '' | 'train' | 'barrel' | 'vent' | 'pin' | 'laser' = '';
  private burst = 0;
  private burstT = 0;
  private hitThisWave = false;
  private buzzT = 0;
  private toasts: { text: string; t: number }[] = [];
  private killCam = { x: 0, y: 0, t: 0 };
  challenge: Challenge | null = null;
  private gear: GearBonus = emptyBonus();
  /** Gear found this run (already added to the stash). */
  loot: GearItem[] = [];
  kit: DeployKind[] = [];
  private deploys: Deployable[] = [];
  private bolts: Bolt[] = [];
  private trains: Train[] = [];
  mode = 'endless';
  mutators = new Set<string>();
  private trainWarned = false;
  modeLabel = '';
  brainsPulse = 0;
  private clean = false;
  private moodLevel = -1;

  // Co-op
  net: '' | 'host' | 'client' = '';
  myId = '';
  slot = 0;
  allies: Ally[] = [];
  /** Sends to one player by id, or to everyone with null. Set by main.ts while in a room. */
  netSend: ((to: string | null, m: NetMsg, fast?: boolean) => void) | null = null;
  down = false;
  reviveProg = 0;
  hostPaused = false;
  private invT = 0;
  private firing = false;
  /** The guest whose shot is being applied right now (host only). */
  private killer = '';
  private netT = 0;
  private netHits: number[][] = [];
  private netEv: (string | number)[][] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private input: Input,
    private sfx: Sfx,
    private hooks: Hooks,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.decals = document.createElement('canvas');
    this.decals.width = WORLD_W / 2;
    this.decals.height = WORLD_H / 2;
    this.dctx = this.decals.getContext('2d')!;
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d')!;
    this.setMap(meta.data.map);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.newRun();
    this.state = 'menu';
    // Paint the detailed zombie sprites a kind at a time while the title screen is up,
    // so the first wave doesn't hitch painting them mid-fight.
    const defs = Object.values(ZOMBIES);
    const warm = () => {
      const d = defs.shift();
      if (!d) return;
      warmZombieArt([d]);
      setTimeout(warm, 30);
    };
    setTimeout(warm, 500);
  }

  // ---------------------------------------------------------------- setup

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.vignette = null;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.light.width = Math.ceil(this.w / 2);
    this.light.height = Math.ceil(this.h / 2);
    // Show roughly 460 world units across the short side of the screen.
    this.zoom = clamp(Math.min(this.w, this.h) / 460, 0.7, 1.8);
  }

  /** Bakes the map's ground into one big canvas (once per map). */
  private buildGround(map: MapDef): HTMLCanvasElement {
    let g = groundCache.get(map.id);
    if (g) return g;
    g = document.createElement('canvas');
    g.width = WORLD_W / 2;
    g.height = WORLD_H / 2;
    const c = g.getContext('2d')!;
    c.scale(0.5, 0.5);
    map.ground(c);
    groundCache.set(map.id, g);
    return g;
  }

  /** Picks the mode (and with it the map and mutators) for the next run. */
  configure(mode: string, challenge: Challenge | null = null) {
    this.mode = mode;
    this.challenge = challenge;
    this.op = null;
    if (challenge) {
      this.mutators = new Set(challenge.muts);
      this.setMap(challenge.map);
    } else if (mode === 'daily') {
      const d = dailySetup();
      this.mutators = new Set(d.mutators);
      this.setMap(d.map);
    } else {
      this.mutators = new Set();
      this.setMap(meta.data.map);
    }
  }

  has(m: string) {
    return this.mutators.has(m);
  }

  /** Story mode: set up an op (its map, guns and perks apply on the next newRun). */
  configureOp(op: OpDef) {
    this.mode = 'campaign';
    this.challenge = null;
    this.mutators = new Set();
    this.op = op;
    this.setMap(op.map);
  }

  static emptyOp(): OpState {
    return { t: 0, n: 0, hits: 0, done: false, end: 0, radio: 0, drives: [], gen: null, zone: null };
  }

  /** Switches the arena; takes effect for the next run and the title screen. */
  setMap(id: string) {
    this.map = mapById(id);
    this.blocked = blockedFor(this.map);
    this.ground = this.buildGround(this.map);
    this.resetBarrels();
  }

  static emptyReport(): RunReport {
    return { wave: 0, kills: 0, killsByKind: {}, killsByWeapon: {}, bosses: 0, elites: 0, bestCombo: 0, grenadeKills: 0, brains: 0, trainKills: 0, ventKills: 0, pinKills: 0, barrelKills: 0, laserKills: 0, turned: 0, shaken: 0, hitsTaken: 0, revives: 0, bestBurst: 0, flawlessWaves: 0, time: 0, teamRevives: 0, coop: false };
  }

  newRun() {
    this.liteZombies = false;
    this.lagT = 0;
    // Permanent training from the base screen.
    const t = (id: string) => meta.train(id);
    this.stats = baseStats();
    this.stats.maxHp += 10 * t('hp');
    this.stats.damage += 0.05 * t('dmg');
    this.stats.speed += 0.03 * t('speed');
    this.stats.crit += 0.02 * t('crit');
    this.stats.cash += 0.08 * t('greed');
    this.perkCounts.clear();
    // Equipped gear from the base screen.
    const g = (this.gear = meta.gearBonus());
    this.stats.maxHp += g.hp;
    this.stats.damage += g.dmg;
    this.stats.speed += g.speed;
    this.stats.crit += g.crit;
    this.stats.cash += g.cash;
    this.loot = [];
    this.kit = [];
    this.deploys = [];
    // Story ops hand out their own field kit.
    const loadout = this.op ? this.op.guns : meta.data.loadout.slice(0, meta.slots());
    this.weapons = loadout.map((id) => this.makeWeapon(WEAPONS.find((w) => w.id === id) ?? WEAPONS[0]));
    for (const w of this.weapons) w.ammo = this.weaponMag(w);
    this.wi = 0;
    this.cash = 75 * t('cash');
    this.armor = 0.03 * t('armor') + g.dr;
    this.wave = 0;
    this.grenadesMax = 2 + t('nades') + g.nades;
    this.grenadeCount = this.grenadesMax;
    this.reviveLeft = this.mode === 'hardcore' ? 0 : t('revive');
    this.reviveOffered = false;
    this.awaitingRevive = false;
    this.skin = meta.skinColors();
    if (this.has('glass')) {
      this.stats.damage *= 2;
      this.stats.maxHp = Math.round(this.stats.maxHp * 0.5);
    }
    if (this.has('rich')) this.stats.cash *= 2;
    if (this.op) {
      for (const id of this.op.perks ?? []) {
        const perk = PERKS.find((x) => x.id === id);
        if (!perk) continue;
        perk.apply(this.stats);
        this.perkCounts.set(id, (this.perkCounts.get(id) ?? 0) + 1);
      }
      for (const w of this.weapons) w.ammo = this.weaponMag(w);
      this.cash = 0;
    }
    this.opS = Game.emptyOp();
    this.consoles = (this.map.consoles ?? []).map((c) => ({ x: c.x, y: c.y, axis: c.axis, hold: 0, cd: 6, phase: 'idle', t: 0, pos: 0, dir: 1, hit: [] }));
    this.consoleWarned = false;
    this.power = { t: rand(40, 55), out: 0 };
    this.spikes = [];
    this.beams = [];
    this.charge = 0;
    this.heat = { id: -1, n: 0 };
    this.pull.t = 0;
    this.latchWarned = false;
    this.subtitle.t = 0;
    this.trains = (this.map.tracks ?? []).map((y, i) => ({ y, dir: i % 2 ? -1 : 1, phase: 'idle', t: rand(9, 14) + i * 5, x: 0, hitPlayer: false, hitBoss: [] }));
    this.trainWarned = false;
    this.vents = (this.map.vents ?? []).map((v, i) => ({ x: v.x, y: v.y, phase: 'idle', t: 4 + i * 1.7 + rand(0, 2), hit: [] }));
    this.ventWarned = false;
    this.webT = 0;
    this.chillT = 0;
    this.novas = [];
    this.blizzard = { phase: 'calm', t: rand(18, 26), dir: 0 };
    this.blizzardWarned = false;
    this.report = Game.emptyReport();
    this.report.coop = !!this.net;
    this.corpses = [];
    this.bolts = [];
    this.p = { x: WORLD_W / 2, y: WORLD_H / 2, hp: this.stats.maxHp, angle: -Math.PI / 2, vx: 0, vy: 0 };
    if (this.net) {
      // Co-op squads start side by side.
      this.p.x += [-40, 40, 0, 0][this.slot] ?? 0;
      this.p.y += [0, 0, -40, 40][this.slot] ?? 0;
    }
    this.down = false;
    this.reviveProg = 0;
    this.invT = 0;
    this.hostPaused = false;
    this.netHits = [];
    this.netEv = [];
    for (const a of this.allies) {
      a.down = false;
      a.revive = 0;
      a.firing = false;
    }
    this.cam = { x: this.p.x, y: this.p.y };
    this.zombies = [];
    this.bullets = [];
    this.particles = [];
    this.texts = [];
    this.pickups = [];
    this.powers = [];
    this.active = { nuke: 0, rage: 0, freeze: 0, ammo: 0, cash: 0 };
    this.rings = [];
    this.lights = [];
    this.grenades = [];
    this.spits = [];
    this.puddles = [];
    this.goos = [];
    this.vortexes = [];
    this.mortars = [];
    this.ghosts = [];
    this.kills = 0;
    this.earned = 0;
    this.runTime = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.droneT = [];
    this.slowT = 0;
    this.trauma = 0;
    this.combo = 0;
    this.comboT = 0;
    this.bestCombo = 0;
    this.burst = 0;
    this.burstT = 0;
    this.toasts = [];
    this.killCam.t = 0;
    this.spin = 0;
    this.resetBarrels();
    this.dctx.clearRect(0, 0, this.decals.width, this.decals.height);
  }

  private resetBarrels() {
    this.barrels = this.map.barrels.map((b) => ({ x: b.x, y: b.y, hp: b.big ? 60 : 30, fuse: 0, dead: false, big: !!b.big }));
  }

  private makeWeapon(def: WeaponDef): OwnedWeapon {
    return { def, level: 1, ammo: def.mag, reloadT: 0 };
  }

  startWave() {
    this.wave++;
    // Boss Rush jumps straight from boss wave to boss wave.
    if (this.mode === 'bossrush') this.wave = Math.ceil(this.wave / 10) * 10;
    const boss = this.wave % 10 === 0;
    // Mini-boss waves halfway between: a smaller version of a boss you haven't met yet.
    const miniBoss = !boss && this.wave % 10 === 5;
    this.toSpawn = 10 + this.wave * 5;
    if (boss) this.toSpawn = Math.round(this.toSpawn * (this.mode === 'bossrush' ? 0.3 : 0.5));
    if (miniBoss) this.toSpawn = Math.round(this.toSpawn * 0.7);
    if (this.has('horde')) this.toSpawn = Math.round(this.toSpawn * 1.5);
    // More players, more zombies.
    if (this.net === 'host') this.toSpawn = Math.round(this.toSpawn * (1 + 0.6 * this.allies.length));
    this.beginWave();
    let kind: ZombieKind | '' = '';
    if (boss) {
      const g = this.farthestGate();
      const order = this.map.boss ? [this.map.boss, ...BOSS_ORDER.filter((k) => k !== this.map.boss)] : BOSS_ORDER;
      kind = order[(this.wave / 10 - 1) % order.length];
      this.spawnZombie(kind, g.x, g.y + (g.y < WORLD_H / 2 ? 60 : -60));
    } else if (miniBoss) {
      const g = this.farthestGate();
      kind = MINI_BOSS_ORDER[((this.wave - 5) / 10) % MINI_BOSS_ORDER.length];
      this.spawnZombie(kind, g.x, g.y + (g.y < WORLD_H / 2 ? 60 : -60), { mini: true });
    }
    this.hideMimics();
    this.waveIntro(kind, miniBoss);
    if (this.net === 'host') this.netSend?.(null, { t: 'wave', w: this.wave, b: kind, m: miniBoss ? 1 : 0 });
    const ch = this.challenge;
    if (ch && this.wave > ch.wave && this.wave - (this.mode === 'bossrush' ? 10 : 1) <= ch.wave) {
      this.showShout('CHALLENGE BEATEN!', '#ffd23f');
      this.flash = { t: 0.4, color: '#ffd23f', max: 0.35 };
      this.sfx.play('levelup');
      this.buzz([40, 60, 40]);
    }
  }

  /** Mimics: a supply crate or two on the floor is really a zombie waiting for you to walk up. */
  private hideMimics() {
    if (this.wave < 2 || this.mode === 'bossrush') return;
    let n = this.wave === 2 ? 1 : Math.random() < 0.55 ? 1 : 0;
    if (this.wave >= 12 && Math.random() < 0.5) n++;
    if (this.wave >= 25) n++;
    const ts = this.targets();
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const x = rand(220, WORLD_W - 220);
        const y = rand(200, WORLD_H - 200);
        if (this.pointInWall(x, y) || this.pointInWall(x + 20, y) || this.pointInWall(x - 20, y) || this.pointInWall(x, y + 20) || this.pointInWall(x, y - 20)) continue;
        if (ts.some((t) => Math.hypot(t.x - x, t.y - y) < 420)) continue;
        const z = this.spawnZombie('mimic', x, y);
        z.lurk = true;
        z.face = -Math.PI / 2;
        break;
      }
    }
  }

  /** The mimic drops the act: lid flies open and it comes for you. */
  private wakeMimic(z: Zombie) {
    if (!z.lurk) return;
    z.lurk = false;
    z.attackCd = 0.4;
    this.addText(z.x, z.y - 30, 'MIMIC!', '#ff4a3a', 18);
    this.ring({ x: z.x, y: z.y, r: 6, max: 70, life: 0.3, color: 'rgba(255,90,60,' });
    for (let i = 0; i < 8; i++) this.spawnParticle(z.x, z.y, rand(-200, 200), rand(-200, 200), rand(0.3, 0.5), rand(3, 6), i % 2 ? '#8a5a20' : '#ffd23f', 5, true, false);
    this.wsfx('mimic');
    this.addShake(0.2);
  }

  /** Resets the arena for a new wave (shared by the host and co-op guests). */
  private beginWave() {
    this.spawnT = 1.2;
    this.quietT = 0;
    this.mortars = [];
    this.spikes = [];
    this.vortexes = [];
    this.novas = [];
    this.clearT = -1;
    this.hitThisWave = false;
    this.state = 'playing';
    this.grenadeCount = this.grenadesMax;
    this.input.reset();
    this.zombies = [];
    // Fade old blood so the floor doesn't turn solid red.
    this.dctx.globalCompositeOperation = 'destination-out';
    this.dctx.fillStyle = 'rgba(0,0,0,0.35)';
    this.dctx.fillRect(0, 0, this.decals.width, this.decals.height);
    this.dctx.globalCompositeOperation = 'source-over';
    this.resetBarrels();
  }

  private waveIntro(boss: ZombieKind | '', mini = false) {
    if (boss) {
      this.showBanner(`WAVE ${this.wave}`, mini ? `MINI-BOSS: ${BOSS_NAMES[boss]}` : `${BOSS_NAMES[boss]} IS COMING`, BOSS_COLORS[boss]!);
      this.sfx.play('boss');
      this.addShake(0.6);
    } else {
      const sub = this.wave === 1 ? (this.net ? 'STICK TOGETHER' : 'SURVIVE THE NIGHT') : this.wave === 15 ? 'ELITE ZOMBIES INCOMING' : this.kindIntro(this.wave);
      this.showBanner(`WAVE ${this.wave}`, sub, '#ffffff');
      this.sfx.play('wave');
    }
  }

  /** Wave banner hint for a zombie kind showing up for the first time (the lab's kinds come early in the lab). */
  private kindIntro(wave: number) {
    for (const [k, start, text] of LAB_KINDS) if ((this.map.natives?.[k] ?? start) === wave) return text;
    // A lab kind arriving early can bump the usual hint; otherwise show it.
    return NEW_KIND_WAVES[wave] ?? '';
  }

  /** First wave a kind spawns on this map. */
  private kindStart(k: ZombieKind, normal: number) {
    return this.map.natives?.[k] ?? normal;
  }

  // ---------------------------------------------------------------- story ops

  /** Starts the configured op (instead of startWave). */
  startOp() {
    const op = this.op;
    if (!op) return;
    this.wave = op.level;
    this.toSpawn = 1e6;
    this.beginWave();
    this.spawnT = 2;
    const S = (this.opS = Game.emptyOp());
    const g = op.goal;
    if (g.type === 'collect') S.drives = this.openSpots(g.n, 260);
    if (g.type === 'defend') S.gen = { x: WORLD_W / 2, y: WORLD_H / 2 - 110, vx: 0, vy: 0, hp: g.hp, max: g.hp, hurt: 0 };
    if (g.type === 'boss') {
      const gate = this.farthestGate();
      this.spawnZombie(g.kind, gate.x, gate.y + (gate.y < WORLD_H / 2 ? 60 : -60));
      this.sfx.play('boss');
    }
    if (this.map.powercut) this.power.t = 46;
    this.showBanner(op.name.toUpperCase(), this.opGoalLine(), '#ffd23f');
    this.sfx.play('wave');
  }

  /** Spread-out open floor spots, away from the player and each other. */
  private openSpots(n: number, gap: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let tries = 0; out.length < n && tries < 4000; tries++) {
      const x = rand(BORDER + 90, WORLD_W - BORDER - 90);
      const y = rand(BORDER + 90, WORLD_H - BORDER - 90);
      if (Math.hypot(x - this.p.x, y - this.p.y) < 300) continue;
      if (this.pointInWall(x, y) || this.map.walls.some((w) => x > w.x - 40 && x < w.x + w.w + 40 && y > w.y - 40 && y < w.y + w.h + 40)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < (tries < 2000 ? gap : gap / 2))) continue;
      out.push({ x, y });
    }
    return out;
  }

  private opGoalLine() {
    const g = this.op!.goal;
    switch (g.type) {
      case 'survive':
        return `SURVIVE ${g.time} SECONDS`;
      case 'kill':
        return `KILL ${g.n} ${(g.kind ?? 'zombie').toUpperCase()}S`;
      case 'collect':
        return `FIND ${g.n} DATA DRIVES`;
      case 'defend':
        return `DEFEND THE GENERATOR FOR ${g.time}s`;
      case 'evac':
        return 'GET TO THE LANDING ZONE';
      case 'boss':
        return `KILL ${BOSS_NAMES[g.kind] ?? 'THE BOSS'}`;
    }
  }

  /** Story mode: objective timers, pickups, radio chatter, and winning. */
  private updateOp(dt: number) {
    const op = this.op!;
    const S = this.opS;
    const g = op.goal;
    if (S.done) {
      S.end -= dt;
      if (S.end <= 0 && this.state === 'playing') this.finishOp(true);
      return;
    }
    S.t += dt;
    // Radio
    while (S.radio < op.radio.length && op.radio[S.radio][0] <= S.t) {
      const [, who, text] = op.radio[S.radio++];
      this.subtitle = { who, text, t: 5.5 };
      this.sfx.play('radio');
    }
    if (g.type === 'survive' && S.t >= g.time) this.winOp();
    else if (g.type === 'defend') {
      const G = S.gen!;
      if (G.hurt > 0) G.hurt -= dt;
      if (G.hp <= 0) {
        this.explode(G.x, G.y, 0, 160, 0);
        this.showBanner('GENERATOR DESTROYED', '', '#ff5a4a');
        this.finishOp(false);
        return;
      }
      if (S.t >= g.time) this.winOp();
    } else if (g.type === 'collect') {
      for (let i = S.drives.length - 1; i >= 0; i--) {
        const dv = S.drives[i];
        if (Math.hypot(dv.x - this.p.x, dv.y - this.p.y) > PLAYER_R + 22) continue;
        S.drives.splice(i, 1);
        S.n++;
        this.addText(dv.x, dv.y - 20, `DATA DRIVE ${S.n}/${g.n}`, '#5dff7a', 15);
        this.ring({ x: dv.x, y: dv.y, r: 0, max: 70, life: 0.4, color: 'rgba(93,255,122,' });
        this.sfx.play('pickup');
        this.buzz(30);
      }
      if (S.n >= g.n) this.winOp();
    } else if (g.type === 'evac') {
      if (!S.zone && S.t >= g.after) {
        // The landing zone is the far corner from wherever you are.
        const spots = [
          { x: 330, y: 300 },
          { x: WORLD_W - 330, y: 300 },
          { x: 330, y: WORLD_H - 300 },
          { x: WORLD_W - 330, y: WORLD_H - 300 },
        ].filter((s) => !this.pointInWall(s.x, s.y));
        spots.sort((a, b) => Math.hypot(b.x - this.p.x, b.y - this.p.y) - Math.hypot(a.x - this.p.x, a.y - this.p.y));
        const s = spots[0] ?? { x: 330, y: 300 };
        S.zone = { x: s.x, y: s.y, r: 110, hold: 0 };
        this.showShout('LANDING ZONE MARKED!', '#5dff7a');
        this.sfx.play('alarm');
      }
      const Z = S.zone;
      if (Z && !this.down && Math.hypot(this.p.x - Z.x, this.p.y - Z.y) < Z.r) {
        Z.hold += dt;
        if (Z.hold >= g.hold) this.winOp();
      }
    } else if (g.type === 'kill' && S.n >= g.n) this.winOp();
    // Boss ops are won in killZombie.
  }

  private winOp() {
    const S = this.opS;
    if (S.done) return;
    S.done = true;
    S.end = 2.4;
    this.toSpawn = 0;
    // Area secured: the rest of the horde drops where it stands.
    for (const z of this.zombies) {
      if (z.dead) continue;
      z.dead = true;
      this.deathFx(z, rand(0, Math.PI * 2));
    }
    this.spits = [];
    this.spikes = [];
    this.mortars = [];
    this.flash = { t: 0.5, color: '#ffffff', max: 0.5 };
    this.slowT = 1;
    this.showBanner('MISSION COMPLETE', this.op!.goal.type === 'evac' ? 'THE CHOPPER IS HERE' : 'AREA SECURED', '#5dff7a');
    this.sfx.play('levelup');
    this.buzz([60, 40, 120]);
    this.hooks.onHighlight?.(`${this.op!.name} complete`);
  }

  /** Hands the op's result to the menus. Losing by death goes through endRun instead. */
  private finishOp(won: boolean) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.input.reset();
    const r: OpResult = { op: this.op!, won, time: this.opS.t, hits: this.report.hitsTaken, hpFrac: clamp(this.p.hp / this.stats.maxHp, 0, 1), summary: this.summary() };
    this.hooks.onOpEnd?.(r);
  }

  /** Story mode: the op's live numbers, for the result screen if you die. */
  opProgress() {
    return { t: this.opS.t, n: this.opS.n };
  }

  /** A short line at the top of the screen (badges, clips). */
  toast(text: string) {
    this.toasts.push({ text, t: 2.6 });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  /** Haptic buzz on phones, throttled so explosions don't drone. */
  private buzz(pattern: number | number[]) {
    if (this.buzzT > 0) return;
    this.buzzT = 0.12;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not supported */
    }
  }

  /** share: on the co-op host, show it to the whole squad too. */
  private showBanner(text: string, sub: string, color: string, share = false) {
    this.banner = { text, sub, t: 2.4, color };
    if (share) this.netEvent('b', text, sub, color);
  }

  private showShout(text: string, color: string, share = false) {
    this.shout = { text, t: 1.6, color };
    if (share) this.netEvent('h', text, color);
  }

  /** A sound everyone in the squad should hear (zombie attacks, trains). */
  private wsfx(kind: SfxKind, vol = 1) {
    this.sfx.play(kind, vol);
    this.netEvent('a', kind, vol);
  }

  private ring(r: Ring) {
    this.rings.push(r);
    this.netEvent('r', Math.round(r.x), Math.round(r.y), Math.round(r.r), Math.round(r.max), r.life, r.color);
  }

  private bolt(b: Bolt) {
    this.bolts.push(b);
    this.netEvent('z', Math.round(b.x1), Math.round(b.y1), Math.round(b.x2), Math.round(b.y2), b.life, b.color);
  }

  /** Queues a world event for the next co-op snapshot (host only). */
  private netEvent(...e: (string | number)[]) {
    if (this.net === 'host' && this.netEv.length < 60) this.netEv.push(e);
  }

  // ---------------------------------------------------------------- perks & shop

  weaponDamage(w: OwnedWeapon) {
    return w.def.damage * (1 + 0.25 * (w.level - 1)) * (1 + 0.06 * meta.mastery(w.def.id)) * this.stats.damage * (this.active.rage > 0 ? 2 : 1);
  }
  private weaponRate(w: OwnedWeapon) {
    return w.def.fireRate * (1 + 0.08 * (w.level - 1)) * this.stats.fireRate * (this.active.rage > 0 ? 1.5 : 1);
  }
  private weaponMag(w: OwnedWeapon) {
    return Math.max(1, Math.round(w.def.mag * (1 + 0.04 * meta.mastery(w.def.id)) * this.stats.mag));
  }

  rollPerks(n = 3): PerkDef[] {
    const pool = PERKS.filter((p) => (this.perkCounts.get(p.id) ?? 0) < p.max && meta.perkUnlocked(p.id));
    const out: PerkDef[] = [];
    while (out.length < n && pool.length) {
      const total = pool.reduce((s, p) => s + RARITY_WEIGHT[p.rarity], 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < pool.length; idx++) {
        r -= RARITY_WEIGHT[pool[idx].rarity];
        if (r <= 0) break;
      }
      out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
    }
    return out;
  }

  pickPerk(p: PerkDef) {
    const oldMax = this.stats.maxHp;
    p.apply(this.stats);
    this.perkCounts.set(p.id, (this.perkCounts.get(p.id) ?? 0) + 1);
    this.p.hp += this.stats.maxHp - oldMax;
    for (const w of this.weapons) w.ammo = this.weaponMag(w);
    this.sfx.play('perk');
  }

  shopItems(): ShopItem[] {
    const items: ShopItem[] = [];
    const heal = 30 + this.wave * 6;
    const missing = this.stats.maxHp - this.p.hp;
    if (this.mode !== 'hardcore') items.push({ id: 'heal', label: '🩹 Medkit', sub: `Heal to full (${Math.ceil(this.p.hp)}/${this.stats.maxHp})`, price: heal, enabled: missing > 0.5 && this.cash >= heal });
    const armorLvl = Math.round((this.armor - 0.03 * meta.train('armor') - this.gear.dr) / 0.08);
    if (armorLvl < 5) {
      const price = 150 * (armorLvl + 1);
      items.push({ id: 'armor', label: '🛡️ Armor plate', sub: `Take ${Math.round((this.armor + 0.08) * 100)}% less damage`, price, enabled: this.cash >= price });
    }
    if (this.grenadesMax < 6 + meta.train('nades') + this.gear.nades) {
      const price = 120 * (this.grenadesMax - 1 - meta.train('nades') - this.gear.nades);
      items.push({ id: 'nade', label: '💣 Grenade belt', sub: `Carry ${this.grenadesMax + 1} grenades per wave`, price, enabled: this.cash >= price });
    }
    if (this.kit.length < 4)
      for (const [k, d] of Object.entries(DEPLOYS) as [DeployKind, (typeof DEPLOYS)[DeployKind]][]) {
        const price = d.price(this.wave);
        const have = this.kit.filter((x) => x === k).length;
        items.push({ id: `kit:${k}`, label: `${d.icon} ${d.name}`, sub: `${d.desc}${have ? ` · ${have} in kit` : ''}`, price, enabled: this.cash >= price });
      }
    for (const def of WEAPONS) {
      const owned = this.weapons.find((w) => w.def.id === def.id);
      if (!owned && def.exclusive && !meta.data.unlocked.includes(def.id)) continue;
      if (!owned) {
        const sub =
          WEAPON_BLURB[def.id] ?? `${def.pellets > 1 ? `${def.pellets}x` : ''}${def.damage} dmg, ${def.fireRate}/s`;
        items.push({ id: `buy:${def.id}`, label: `🔫 ${def.name}`, sub, price: def.price, enabled: this.cash >= def.price });
      } else if (owned.level < 10) {
        const price = Math.round(def.upgradeBase * Math.pow(1.55, owned.level - 1));
        items.push({ id: `up:${def.id}`, label: `⬆️ ${def.name} Lv ${owned.level + 1}`, sub: '+25% damage, +8% fire rate', price, enabled: this.cash >= price });
      }
    }
    return items;
  }

  buy(id: string): boolean {
    const item = this.shopItems().find((i) => i.id === id);
    if (!item || !item.enabled) return false;
    this.cash -= item.price;
    if (id === 'heal') this.p.hp = this.stats.maxHp;
    else if (id === 'armor') this.armor = Math.round((this.armor + 0.08) * 100) / 100;
    else if (id === 'nade') this.grenadesMax++;
    else if (id.startsWith('kit:')) this.kit.push(id.slice(4) as DeployKind);
    else if (id.startsWith('buy:')) {
      const def = WEAPONS.find((w) => w.id === id.slice(4))!;
      const w = this.makeWeapon(def);
      w.ammo = this.weaponMag(w);
      this.weapons.push(w);
      this.wi = this.weapons.length - 1;
    } else if (id.startsWith('up:')) {
      const w = this.weapons.find((x) => x.def.id === id.slice(3))!;
      w.level++;
      w.ammo = this.weaponMag(w);
    }
    this.sfx.play('buy');
    return true;
  }

  // ---------------------------------------------------------------- update

  update(rawDt: number) {
    this.clock += rawDt;
    this.updateButtons();
    this.updateMusic();
    if (this.state === 'menu') {
      this.updateAttract(rawDt);
      this.updateEffects(rawDt, rawDt);
      this.input.clearPressed();
      return;
    }
    if (this.state !== 'playing') {
      this.input.clearPressed();
      return;
    }
    const client = this.net === 'client';
    if (client && this.hostPaused) {
      this.input.clearPressed();
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      return;
    }
    if (this.slowT > 0) this.slowT -= rawDt;
    const dt = rawDt * (this.slowT > 0 ? 0.3 : 1);
    this.runTime += rawDt;

    const inp = this.input;
    if (inp.consume('p') || inp.consume('escape') || inp.consume('pause')) {
      this.state = 'paused';
      inp.reset();
      this.hooks.onPause();
      return;
    }
    if (!this.down) {
      if (inp.consume('q') || inp.consume('swap') || inp.consume('wheeldown')) this.switchWeapon(1);
      if (inp.consume('wheelup')) this.switchWeapon(-1);
      for (let i = 0; i < 9; i++) if (inp.consume(String(i + 1)) && this.weapons[i]) this.setWeapon(i);
      if (inp.consume('r') || inp.consume('reload')) this.startReload();
      if (inp.consume('g') || inp.consume('e') || inp.consume('nade')) this.throwGrenade();
      if (inp.consume('f') || inp.consume('deploy')) this.deploy();
    }

    for (const k of Object.keys(this.active) as PowerKind[]) if (this.active[k] > 0) this.active[k] -= dt;
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (this.invT > 0) this.invT -= dt;

    if (this.down) this.updateDowned(dt);
    else this.updatePlayer(dt);
    if (client) this.updateMirror(dt);
    else {
      this.updateSpawning(dt);
      this.rescueStragglers(dt);
      this.updateZombies(dt);
    }
    this.updateBullets(dt);
    this.updateGrenades(dt);
    this.updateHazards(dt);
    this.updateTrains(dt);
    this.updateVents(dt);
    this.updateBlizzard(dt);
    this.updateConsoles(dt);
    this.updatePower(dt);
    this.updateSpikes(dt);
    this.updateOrbitals(dt);
    if (!client) this.updatePickups(dt);
    this.updateDeploys(dt);
    this.updateAllies(dt);
    if (this.net === 'host') this.updateRevives(dt);
    this.updateEffects(dt, rawDt);

    if (!client) this.zombies = this.zombies.filter((z) => !z.dead);
    inp.clearPressed();
    if (client || this.state !== 'playing') return;
    if (this.op) {
      this.updateOp(dt);
      return;
    }

    if (this.clearT < 0 && this.toSpawn <= 0 && this.zombies.length === 0) {
      this.clearT = 1.6;
      this.showBanner('WAVE CLEARED', '', '#5dff7a');
      // Vacuum up any cash left on the floor.
      for (const pk of this.pickups) if (pk.kind !== 'health') pk.pulled = true;
    }
    if (this.clearT >= 0) {
      this.clearT -= rawDt;
      if (this.clearT < 0) {
        // Cash left on the floor is split between the squad.
        let left = 0;
        for (const pk of this.pickups) {
          if (pk.kind === 'cash') left += pk.value;
          else if (pk.kind === 'crate') this.openCrate(pk);
        }
        const share = left / (1 + this.allies.length);
        this.gainCash(share);
        if (this.net === 'host') this.netSend?.(null, { t: 'clear', w: this.wave, c: Math.round(share) });
        this.pickups = [];
        this.waveCleared();
      }
    }
  }

  /** Between-waves bookkeeping, run by the host and (on the host's word) by each guest. */
  private waveCleared() {
    if (!this.hitThisWave) this.report.flawlessWaves++;
    this.gainBrains(1 + Math.floor(this.wave / 3));
    if (this.down) this.getUp(0.3);
    this.bullets = [];
    this.spits = [];
    this.puddles = [];
    this.goos = [];
    this.vortexes = [];
    this.mortars = [];
    this.novas = [];
    this.spikes = [];
    this.pull.t = 0;
    this.webT = 0;
    this.chillT = 0;
    this.grenades = [];
    this.combo = 0;
    this.comboT = 0;
    this.state = 'between';
    this.input.reset();
    this.hooks.onWaveCleared(this.wave);
  }

  private updateMusic() {
    let mood: MusicMood = 'menu';
    let level = 0;
    if (this.state === 'playing') {
      if (this.zombies.some(isBoss)) mood = 'boss';
      else {
        mood = 'fight';
        level = Math.min(2, Math.floor(this.zombies.length / 15));
      }
    } else if (this.state === 'between' || this.state === 'paused') mood = 'calm';
    if (mood !== this.mood || level !== this.moodLevel) {
      this.mood = mood;
      this.moodLevel = level;
      this.sfx.setMusic(mood, level / 2);
    }
  }

  /** Title screen: zombies shamble around the dark lot under a sweeping searchlight. */
  private updateAttract(dt: number) {
    if (this.zombies.length < 26) {
      const kinds: ZombieKind[] = ['walker', 'walker', 'walker', 'runner', 'bloater', 'tank', 'spitter', 'shield', 'leaper', 'screamer', 'necro', 'dog', 'soldier', 'electric', 'bomber', 'wraith', 'webber', 'medic', 'sludger', 'icer', 'roller', 'mutant', 'blob', 'psyker', 'parasite'];
      const z = this.spawnZombie(kinds[Math.floor(Math.random() * kinds.length)], rand(150, WORLD_W - 150), rand(150, WORLD_H - 150));
      z.tx = rand(150, WORLD_W - 150);
      z.ty = rand(150, WORLD_H - 150);
    }
    for (const z of this.zombies) {
      const dx = (z.tx ?? z.x) - z.x;
      const dy = (z.ty ?? z.y) - z.y;
      const d = Math.hypot(dx, dy);
      if (d < 30) {
        z.tx = rand(150, WORLD_W - 150);
        z.ty = rand(150, WORLD_H - 150);
        continue;
      }
      const sp = z.speed * 0.45;
      z.face = Math.atan2(dy, dx);
      z.x += (dx / d) * sp * dt;
      z.y += (dy / d) * sp * dt;
      z.phase += sp * dt * 0.08;
      this.collideWalls(z, z.r);
    }
    const t = this.clock * 0.07;
    this.cam.x = WORLD_W / 2 + Math.cos(t) * 520;
    this.cam.y = WORLD_H / 2 + Math.sin(t * 1.3) * 300;
    this.p.x = this.cam.x;
    this.p.y = this.cam.y;
  }

  private updateButtons() {
    const inp = this.input;
    const btns = [{ id: 'pause', x: this.w - 32, y: 32, r: 24, label: 'II' }];
    if (inp.touchMode && this.state === 'playing') {
      const cy = clamp(this.h * 0.5, 150, this.h - 120);
      // Sized for thumbs: every button is at least 56px across, with clear gaps between them.
      btns.push({ id: 'dash', x: this.w - 58, y: cy + 18, r: 36, label: 'DASH' });
      btns.push({ id: 'nade', x: this.w - 142, y: cy + 34, r: 31, label: 'NADE' });
      btns.push({ id: 'swap', x: this.w - 58, y: cy - 70, r: 30, label: 'SWAP' });
      btns.push({ id: 'reload', x: this.w - 140, y: cy - 50, r: 29, label: 'R' });
      if (this.kit.length) btns.push({ id: 'deploy', x: this.w - 218, y: cy + 52, r: 28, label: DEPLOYS[this.kit[0]].icon });
    }
    if (this.state === 'menu') btns.length = 0;
    inp.buttons = btns;
  }

  private switchWeapon(dir: number) {
    if (this.weapons.length < 2) return;
    this.setWeapon((this.wi + dir + this.weapons.length) % this.weapons.length);
  }

  private setWeapon(i: number) {
    if (i === this.wi) return;
    this.wi = i;
    this.spin = 0;
    this.charge = 0;
    this.fireCd = Math.max(this.fireCd, 0.15);
    this.sfx.play('reload');
  }

  private startReload() {
    const w = this.weapons[this.wi];
    if (w.reloadT > 0 || w.ammo >= this.weaponMag(w)) return;
    w.reloadT = w.def.reload * this.stats.reload;
    this.sfx.play('reload');
  }

  private throwGrenade() {
    if (this.grenadeCount <= 0) {
      this.sfx.play('empty');
      return;
    }
    this.grenadeCount--;
    const a = this.p.angle;
    this.grenades.push({ x: this.p.x + Math.cos(a) * 20, y: this.p.y + Math.sin(a) * 20, vx: Math.cos(a) * 560 + this.p.vx * 0.5, vy: Math.sin(a) * 560 + this.p.vy * 0.5, z: 10, vz: 260, fuse: 1.05 });
    this.sfx.play('throw');
  }

  private updatePlayer(dt: number) {
    const p = this.p;
    const inp = this.input;
    const mv = inp.moveVec();

    // Aim
    let firing = false;
    if (inp.aim) {
      const a = stickVec(inp.aim);
      const m = Math.hypot(a.x, a.y);
      if (m > 0.2) {
        p.angle = Math.atan2(a.y, a.x);
        firing = m > 0.35;
      }
    } else if (inp.touchMode) {
      if (Math.hypot(mv.x, mv.y) > 0.2) p.angle = Math.atan2(mv.y, mv.x);
    } else {
      const s = this.toScreen(p.x, p.y);
      p.angle = Math.atan2(inp.mouse.y - s.y, inp.mouse.x - s.x);
      firing = inp.mouse.down || inp.keys.has('f');
    }

    const w = this.weapons[this.wi];
    this.firing = firing;

    // Dash
    this.dashCd -= dt;
    if ((inp.consume(' ') || inp.consume('shift') || inp.consume('dash')) && this.dashCd <= 0) {
      const m = Math.hypot(mv.x, mv.y);
      this.dashDir = m > 0.1 ? { x: mv.x / m, y: mv.y / m } : { x: Math.cos(p.angle), y: Math.sin(p.angle) };
      this.dashT = DASH_TIME;
      this.dashCd = DASH_COOLDOWN;
      this.sfx.play('dash');
      this.pull.t = 0;
      this.shakeOff();
    }

    const slow = firing && w.def.moveSlow ? w.def.moveSlow : 1;
    if (this.webT > 0) this.webT -= dt;
    if (this.chillT > 0) this.chillT -= dt;
    const slip = this.onIce(p.x, p.y);
    const riders = this.net === 'client' ? 0 : this.latchedCount();
    const speed = 230 * this.stats.speed * slow * (this.webT > 0 ? 0.5 : 1) * (this.chillT > 0 ? this.chillK : 1) * (slip ? 1.12 : 1) * (riders ? Math.max(0.55, 1 - 0.15 * riders) : 1);
    if (this.pull.t > 0) {
      // Dragged by a psychic: you slide toward it unless you dash.
      this.pull.t -= dt;
      const dx = this.pull.x - p.x;
      const dy = this.pull.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = d > 70 ? 720 : 0;
      p.vx = (dx / d) * sp + mv.x * speed * 0.25;
      p.vy = (dy / d) * sp + mv.y * speed * 0.25;
      if (Math.random() < 0.6) this.spawnParticle(p.x + rand(-10, 10), p.y + rand(-10, 10), 0, 0, 0.25, 4, '#e08aff', 2, false, true);
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      p.vx = this.dashDir.x * 230 * this.stats.speed * 3.6;
      p.vy = this.dashDir.y * 230 * this.stats.speed * 3.6;
      this.ghosts.push({ x: p.x, y: p.y, a: p.angle, life: 0.25 });
    } else {
      // Slight acceleration for a weightier feel (and very little grip on ice).
      const k = 1 - Math.exp(-dt * (slip ? 2.4 : 18));
      p.vx += (mv.x * speed - p.vx) * k;
      p.vy += (mv.y * speed - p.vy) * k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (this.blizzard.phase === 'blow') {
      p.x += Math.cos(this.blizzard.dir) * WIND * dt;
      p.y += Math.sin(this.blizzard.dir) * WIND * dt;
    }
    this.collideWalls(p, PLAYER_R);
    for (const d of this.deploys) if (d.kind === 'barricade') this.pushOut(p, PLAYER_R, d);
    for (const b of this.barrels) {
      if (b.dead) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d = Math.hypot(dx, dy);
      const br = PLAYER_R + (b.big ? 20 : 14);
      if (d < br && d > 0) {
        p.x = b.x + (dx / d) * br;
        p.y = b.y + (dy / d) * br;
      }
    }

    // Weapon
    this.fireCd -= dt;
    if (w.def.spinup) this.spin = clamp(this.spin + (firing && w.reloadT <= 0 ? dt / w.def.spinup : -dt * 2), 0, 1);
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) w.ammo = this.weaponMag(w);
    } else if (w.def.charge) this.chargeRail(w, firing, dt);
    else if (firing && this.fireCd <= 0) {
      if (w.ammo > 0 || this.active.ammo > 0) this.fire(w);
      else this.startReload();
    }

    this.novaCd -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (p.hp < this.stats.maxHp * 0.3) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.85;
        this.sfx.play('heart');
      }
    }
  }

  /** Railgun: holding the trigger charges it; it fires itself at full charge. */
  private chargeRail(w: OwnedWeapon, firing: boolean, dt: number) {
    if (!firing || this.fireCd > 0) {
      this.charge = Math.max(0, this.charge - dt * 2.5);
      return;
    }
    if (w.ammo <= 0 && this.active.ammo <= 0) {
      this.startReload();
      return;
    }
    if (this.charge === 0) this.sfx.play('charge');
    this.charge = Math.min(1, this.charge + (dt / w.def.charge!) * (this.active.rage > 0 ? 1.5 : 1) * Math.sqrt(this.stats.fireRate));
    const p = this.p;
    const mx = p.x + Math.cos(p.angle) * (w.def.length + 4);
    const my = p.y + Math.sin(p.angle) * (w.def.length + 4);
    // Sparks get sucked into the muzzle while it charges.
    if (Math.random() < 0.7) {
      const a = rand(0, Math.PI * 2);
      const r = rand(20, 46);
      this.spawnParticle(mx + Math.cos(a) * r, my + Math.sin(a) * r, -Math.cos(a) * r * 6, -Math.sin(a) * r * 6, 0.14, 2.5, this.charge > 0.9 ? '#ffffff' : '#7ae8ff', 1, false, true);
    }
    this.addLight(mx, my, 60 + this.charge * 120, 0.05, '#7ae8ff');
    if (this.charge >= 1) {
      this.fire(w);
      this.charge = 0;
    }
  }

  /** Dashing tears off every parasite riding you. */
  private shakeOff() {
    let n = 0;
    for (const z of this.zombies) {
      if (z.dead || !z.latch) continue;
      z.latch = 0;
      n++;
      this.killZombie(z, Math.atan2(z.y - this.p.y, z.x - this.p.x));
    }
    if (!n) return;
    this.report.shaken += n;
    this.addText(this.p.x, this.p.y - 30, n > 1 ? `SHOOK OFF ${n}!` : 'SHAKEN OFF!', '#ffd23f', 15);
  }

  private latchedCount() {
    let n = 0;
    for (const z of this.zombies) if (z.latch && !z.dead) n++;
    return n;
  }

  /** Psyker yank: drags a player toward (x, y). */
  private pullPlayer(who: { x: number; y: number }, x: number, y: number) {
    if (who !== this.p) {
      const a = who as Ally;
      if (this.allies.includes(a) && !a.down) this.netSend?.(a.id, { t: 'yank', x: Math.round(x), y: Math.round(y) });
      return;
    }
    if (this.dashT > 0 || this.down || this.invT > 0) return;
    this.pull = { x, y, t: 0.38 };
    this.addText(this.p.x, this.p.y - 28, 'YANKED!', '#e08aff', 14);
    this.sfx.play('yank');
    this.buzz(40);
  }

  /** Knocked down in co-op: you lie there until a teammate stands next to you long enough. */
  private updateDowned(dt: number) {
    const p = this.p;
    const k = Math.exp(-dt * 8);
    p.vx *= k;
    p.vy *= k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.collideWalls(p, PLAYER_R);
    this.firing = false;
    this.spin = 0;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
  }

  private getUp(frac: number) {
    this.down = false;
    this.reviveProg = 0;
    this.p.hp = Math.max(1, Math.round(this.stats.maxHp * frac));
    this.invT = 2;
    this.showBanner('BACK UP!', '', '#5dff7a');
    this.sfx.play('power');
  }

  private fire(w: OwnedWeapon) {
    const p = this.p;
    const rate = this.weaponRate(w) * (w.def.spinup ? 0.25 + 0.75 * this.spin : 1);
    this.fireCd = 1 / rate;
    if (this.active.ammo <= 0) w.ammo--;
    const dmg = this.weaponDamage(w);
    const kind = w.def.kind;
    const n = kind === 'bullet' ? w.def.pellets + this.stats.extraShots : (w.def.homing ? w.def.pellets : 1) + (kind === 'rocket' || kind === 'grenade' || kind === 'tesla' ? Math.floor(this.stats.extraShots / 2) : 0);
    const mx = p.x + Math.cos(p.angle) * (w.def.length + 4);
    const my = p.y + Math.sin(p.angle) * (w.def.length + 4);
    const rage = this.active.rage > 0;
    if (w.def.charge) {
      this.railShot(mx, my, p.angle, dmg * (1 + 0.5 * Math.floor(this.stats.extraShots / 2)));
      p.vx -= Math.cos(p.angle) * 260;
      p.vy -= Math.sin(p.angle) * 260;
      if (w.ammo <= 0 && this.active.ammo <= 0) this.startReload();
      return;
    }
    if (w.def.beam) {
      this.plasmaBeam(mx, my, p.angle + rand(-0.015, 0.015), dmg, w.def.beam, false);
      if (w.ammo <= 0 && this.active.ammo <= 0) this.startReload();
      return;
    }
    if (kind === 'tesla') {
      for (let i = 0; i < n; i++) this.teslaArc(mx, my, p.angle + (i - (n - 1) / 2) * 0.35, dmg);
      this.addLight(mx, my, 200, 0.08, '#8ad8ff');
      this.sfx.play('tesla');
      if (w.ammo <= 0 && this.active.ammo <= 0) this.startReload();
      return;
    }
    if (kind === 'grenade') {
      for (let i = 0; i < n; i++) {
        const a = p.angle + rand(-w.def.spread / 2, w.def.spread / 2) + (i - (n - 1) / 2) * 0.15;
        this.grenades.push({ x: mx, y: my, vx: Math.cos(a) * w.def.speed, vy: Math.sin(a) * w.def.speed, z: 8, vz: 160, fuse: w.def.life, dmg, radius: w.def.vortex ? 150 : w.def.cluster ? 95 : 110, impact: true, vortex: w.def.vortex, cluster: w.def.cluster });
      }
      this.addLight(mx, my, 160, 0.07, w.def.vortex ? '#c08aff' : w.def.cluster ? '#ffcf5a' : '#b0ff7a');
      this.addShake(w.def.shake * 0.5);
      this.sfx.play(w.def.vortex ? 'singularity' : w.def.cluster ? 'cluster' : 'launcher');
      if (w.ammo <= 0 && this.active.ammo <= 0) this.startReload();
      return;
    }
    for (let i = 0; i < n; i++) {
      let a = p.angle + rand(-w.def.spread / 2, w.def.spread / 2);
      if (w.def.pellets === 1 && n > 1) a += (i - (n - 1) / 2) * 0.1;
      if (w.def.homing) a = p.angle + (i - (n - 1) / 2) * 0.32 + rand(-0.08, 0.08);
      const sp = w.def.speed * rand(0.92, 1.05);
      this.bullets.push({
        kind,
        x: mx,
        y: my,
        vx: Math.cos(a) * sp + (kind === 'flame' || kind === 'frost' ? p.vx * 0.5 : 0),
        vy: Math.sin(a) * sp + (kind === 'flame' || kind === 'frost' ? p.vy * 0.5 : 0),
        dmg,
        life: w.def.life * (kind === 'flame' || kind === 'frost' ? rand(0.8, 1.1) : 1),
        max: w.def.life,
        pierce: kind === 'flame' || kind === 'frost' ? 99 : kind === 'rocket' ? 0 : this.stats.pierce + (w.def.pierce ?? 0),
        ricochet: kind === 'bullet' ? this.stats.ricochet + (w.def.ricochet ?? 0) : 0,
        hits: [],
        color: rage ? '#ff5a4a' : w.def.color,
        width: w.def.width ?? (w.def.id === 'shotgun' ? 2.5 : w.def.id === 'minigun' ? 2.5 : w.def.id === 'sniper' ? 4 : 3),
        canExplode: kind === 'bullet' && !w.def.goo && !w.def.boomerang && !w.def.charm,
        charm: w.def.charm,
        bounce: w.def.bounce,
        goo: w.def.goo,
        homing: w.def.homing,
        blast: w.def.blast,
        boomerang: w.def.boomerang,
        harpoon: w.def.harpoon,
      });
    }
    if (kind === 'flame' || kind === 'frost') {
      if (Math.random() < 0.4) this.addLight(mx, my, 150, 0.12, kind === 'flame' ? '#ff7a20' : '#7fd8ff');
      this.sfx.play(kind === 'flame' ? 'flamer' : 'freeze');
      return;
    }
    // Muzzle flash, light, smoke and a shell casing.
    for (let i = 0; i < 5; i++) {
      const a = p.angle + rand(-0.45, 0.45);
      this.spawnParticle(mx, my, Math.cos(a) * rand(80, 300), Math.sin(a) * rand(80, 300), 0.07, rand(3, 6), '#fff2b0', 8, false, true);
    }
    this.addLight(mx, my, kind === 'rocket' ? 260 : 190, 0.07, rage ? '#ff4a3a' : '#ffb050');
    this.spawnParticle(mx, my, Math.cos(p.angle) * 40, Math.sin(p.angle) * 40, 0.6, 6, 'rgba(160,160,160,0.25)', 3, false, false, 14);
    if (kind === 'bullet') {
      const side = p.angle + Math.PI / 2;
      this.spawnParticle(p.x, p.y, Math.cos(side) * rand(90, 150), Math.sin(side) * rand(90, 150), 0.45, 2.5, '#d4a24a', 6, false, false);
    }
    this.addShake(w.def.shake * 0.5);
    // Recoil
    p.vx -= Math.cos(p.angle) * 40 * w.def.shake;
    p.vy -= Math.sin(p.angle) * 40 * w.def.shake;
    this.sfx.play(w.def.id as SfxKind);
    if (w.ammo <= 0 && this.active.ammo <= 0) this.startReload();
  }

  /**
   * Safety net for a wave that will not end: if the last few zombies have been out of
   * reach for half a minute (wedged somewhere the pathing can't get them out of),
   * bring them back in through the gate nearest the fight.
   */
  private rescueStragglers(dt: number) {
    this.quietT += dt;
    if (this.toSpawn > 0 || this.quietT < 30) return;
    const live = this.zombies.filter((z) => !z.dead);
    if (!live.length || live.length > 3) return;
    this.quietT = 0;
    const ts = this.targets();
    if (!ts.length) return;
    for (const z of live) {
      if (isBoss(z) || z.def.kind === 'egg') continue;
      const t = this.nearest(ts, z.x, z.y);
      if (Math.hypot(t.x - z.x, t.y - z.y) < 500) continue;
      let gate = this.map.gates[0];
      let gd = Infinity;
      for (const g of this.map.gates) {
        const d = Math.hypot(g.x - t.x, g.y - t.y);
        if (d > 300 && d < gd) {
          gd = d;
          gate = g;
        }
      }
      z.x = gate.x;
      z.y = gate.y;
      z.kx = z.ky = 0;
    }
  }

  private farthestGate() {
    let best = this.map.gates[0];
    let bd = -1;
    for (const g of this.map.gates) {
      const d = Math.hypot(g.x - this.p.x, g.y - this.p.y);
      if (d > bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  private updateSpawning(dt: number) {
    if (this.toSpawn <= 0) return;
    this.spawnT -= dt;
    // Story ops keep the crowd smaller (a boss fight smaller still) so the objective stays readable.
    const opCap = this.op ? (this.op.goal.type === 'boss' ? 26 : this.op.goal.type === 'defend' ? 40 : 55) : Infinity;
    const cap = Math.min(30 + this.wave * 4, 100, opCap) + (this.has('horde') ? 30 : 0);
    if (this.spawnT > 0 || this.zombies.length >= cap) return;
    this.spawnT = Math.max(0.22, 0.85 - this.wave * 0.05) * (this.op?.goal.type === 'boss' ? 2.4 : this.op?.goal.type === 'defend' ? 1.5 : this.op ? 1.15 : 1);
    const far = this.map.gates.filter((g) => Math.hypot(g.x - this.p.x, g.y - this.p.y) > 520);
    const gate = far.length ? far[Math.floor(Math.random() * far.length)] : this.farthestGate();
    const group = Math.min(this.toSpawn, 1 + Math.floor(Math.random() * (2 + this.wave / 3)));
    const w = this.wave;
    const chances: [ZombieKind, number][] = [
      ['tank', w >= 4 ? Math.min(0.1, 0.04 + (w - 4) * 0.012) : 0],
      ['bloater', w >= 3 ? Math.min(0.1, 0.05 + (w - 3) * 0.01) : 0],
      ['spitter', w >= 6 ? Math.min(0.09, 0.05 + (w - 6) * 0.01) : 0],
      ['shield', w >= 5 ? Math.min(0.07, 0.035 + (w - 5) * 0.006) : 0],
      ['leaper', w >= 6 ? Math.min(0.09, 0.05 + (w - 6) * 0.008) : 0],
      ['screamer', w >= 8 && this.countKind('screamer') < 3 ? Math.min(0.05, 0.03 + (w - 8) * 0.004) : 0],
      ['necro', w >= 12 && this.countKind('necro') < 2 ? Math.min(0.035, 0.02 + (w - 12) * 0.003) : 0],
      ['crawler', w >= 9 ? Math.min(0.08, 0.045 + (w - 9) * 0.004) : 0],
      ['dog', w >= 11 ? Math.min(0.045, 0.025 + (w - 11) * 0.003) : 0],
      ['soldier', w >= 13 ? Math.min(0.06, 0.035 + (w - 13) * 0.004) : 0],
      ['electric', w >= 14 && this.countKind('electric') < 3 ? Math.min(0.05, 0.03 + (w - 14) * 0.003) : 0],
      ['bomber', w >= 7 ? Math.min(0.06, 0.035 + (w - 7) * 0.004) : 0],
      ['burrower', w >= 16 && this.countKind('burrower') < 3 ? Math.min(0.04, 0.025 + (w - 16) * 0.003) : 0],
      ['wraith', w >= 18 && this.countKind('wraith') < 4 ? Math.min(0.05, 0.03 + (w - 18) * 0.003) : 0],
      ['webber', w >= 4 && this.countKind('webber') < 4 ? Math.min(0.06, 0.04 + (w - 4) * 0.003) : 0],
      ['medic', w >= 17 && this.countKind('medic') < 2 ? Math.min(0.035, 0.02 + (w - 17) * 0.003) : 0],
      ['sludger', w >= 19 && this.countKind('sludger') < 4 ? Math.min(0.045, 0.03 + (w - 19) * 0.003) : 0],
      ['roller', w >= 3 && this.countKind('roller') < 4 ? Math.min(0.05, 0.03 + (w - 3) * 0.002) : 0],
      // Icers are locals on the Frozen Outpost; elsewhere they turn up late.
      ['icer', this.map.id === 'outpost' ? Math.min(0.12, 0.06 + w * 0.003) : w >= 21 ? Math.min(0.05, 0.03 + (w - 21) * 0.003) : 0],
      ...this.labChances(w),
      ...(this.op?.mix ?? []),
      ['runner', w >= 2 ? Math.min(0.36, 0.12 + (w - 2) * 0.04) : 0],
    ];
    let eliteChance = w >= 15 ? Math.min(0.15, 0.04 + (w - 15) * 0.006) : 0;
    if (this.has('elites')) eliteChance = Math.max(eliteChance, 0.12);
    for (let i = 0; i < group; i++) {
      let roll = Math.random();
      let kind: ZombieKind = 'walker';
      for (const [k, c] of chances) {
        if (roll < c) {
          kind = k;
          break;
        }
        roll -= c;
      }
      const inward = { x: WORLD_W / 2 - gate.x, y: WORLD_H / 2 - gate.y };
      const d = Math.hypot(inward.x, inward.y);
      const elite = Math.random() < eliteChance ? ELITE_KINDS[Math.floor(Math.random() * ELITE_KINDS.length)] : undefined;
      // Dogs always arrive as a pack, parasites as a swarm.
      const pack = kind === 'dog' ? 4 + Math.floor(Math.random() * 3) : kind === 'parasite' ? 3 + Math.floor(Math.random() * 2) : 1;
      for (let k = 0; k < pack; k++) this.spawnZombie(kind, gate.x + (inward.x / d) * 30 + rand(-50, 50), gate.y + (inward.y / d) * 30 + rand(-50, 50), { elite: k === 0 ? elite : undefined });
      this.toSpawn = Math.max(0, this.toSpawn - pack);
    }
  }

  /** Spawn chances for the lab's zombies (early on the lab map, late everywhere else). */
  private labChances(w: number): [ZombieKind, number][] {
    const at = (k: ZombieKind, normal: number) => w - this.kindStart(k, normal);
    const out: [ZombieKind, number][] = [];
    const p = at('parasite', 21);
    if (p >= 0) out.push(['parasite', Math.min(0.06, 0.035 + p * 0.004)]);
    const m = at('mutant', 22);
    if (m >= 0 && this.countKind('mutant') < 4) out.push(['mutant', Math.min(0.05, 0.03 + m * 0.003)]);
    const b = at('blob', 23);
    if (b >= 0) out.push(['blob', Math.min(0.05, 0.03 + b * 0.003)]);
    const y = at('psyker', 24);
    if (y >= 0 && this.countKind('psyker') < 2) out.push(['psyker', Math.min(0.035, 0.02 + y * 0.003)]);
    return out;
  }

  private countKind(kind: ZombieKind) {
    let n = 0;
    for (const z of this.zombies) if (z.def.kind === kind && !z.dead) n++;
    return n;
  }

  private spawnZombie(kind: ZombieKind, x: number, y: number, opts: { elite?: EliteKind; mini?: boolean; gen?: number } = {}): Zombie {
    const def = ZOMBIES[kind];
    const wv = Math.max(1, this.wave);
    const hpScale = 1 + 0.16 * (wv - 1) + 0.006 * (wv - 1) ** 2;
    const spScale = Math.min(1.35, 1 + 0.02 * (wv - 1));
    const { elite, mini } = opts;
    let hp = def.hp * hpScale * (kind === 'boss' || kind === 'brood' || kind === 'reaper' || kind === 'sludge' || kind === 'titan' || kind === 'zero' ? 1 + wv / 20 : 1);
    if (elite) hp *= elite === 'armored' ? 3 : 1.6;
    if (mini) hp *= 0.4;
    // Mitosis blobs: each split is smaller, weaker and quicker.
    const gen = opts.gen ?? 0;
    if (gen) hp *= [1, 0.45, 0.22][gen];
    const r = def.radius * (elite ? 1.15 : 1) * (mini ? 0.72 : 1) * [1, 0.72, 0.52][gen];
    const z: Zombie = {
      id: this.nextId++,
      def,
      x: clamp(x, BORDER + r, WORLD_W - BORDER - r),
      y: clamp(y, BORDER + r, WORLD_H - BORDER - r),
      kx: 0,
      ky: 0,
      hp,
      maxHp: hp,
      speed: def.speed * spScale * rand(0.9, 1.1) * (elite === 'fast' ? 1.55 : 1) * (mini ? 1.15 : 1) * (this.has('fast') ? 1.25 : 1) * [1, 1.2, 1.45][gen],
      dmg: def.damage * (1 + 0.05 * (wv - 1)) * (elite ? 1.25 : 1),
      r,
      flash: 0,
      slow: 0,
      burn: 0,
      attackCd: 0,
      bladeCd: 0,
      phase: Math.random() * 10,
      face: 0,
      dead: false,
      spitCd: rand(1, 2.5),
      buff: 0,
      abilityCd: kind === 'egg' ? 3.6 : rand(2, 4),
      chill: 0,
      frozenT: 0,
      plates: kind === 'soldier' ? 3 : 0,
      plateHp: hp * 0.25,
      zapT: 0,
      ghostT: 0,
      fuse: 0,
      psi: 0,
      charm: 0,
      regenT: 0,
      elite,
      mini,
    };
    if (kind === 'blob') z.gen = gen;
    if (kind === 'psyker') z.yank = { cd: rand(2.5, 4), windup: 0, tx: 0, ty: 0 };
    if (kind === 'zero') z.zero = { phase: 1, trans: 0, tendril: 2.5, summon: 6, yank: 4, yankT: 0, laser: 3, laserW: 0, laserT: 0, laserA: 0, laserDir: 1, laserHit: [] };
    if (kind === 'burrower') z.dig = { state: 'walk', t: rand(1.5, 3) };
    if (kind === 'reaper') z.reap = { sweep: 2, windup: 0, aim: 0, blink: 5, orbs: 3.5, summoned: false };
    if (kind === 'sludge') z.sludge = { mortar: 3, drip: 0, splits: 0 };
    if (kind === 'sludger') z.abilityCd = 0.5;
    if (kind === 'titan') z.titan = { boulder: 2.5, nova: 4, windup: 0, enraged: false };
    if (kind === 'roller') z.leap = { state: 'walk', t: rand(1.5, 2.5), dx: 0, dy: 0 };
    if (kind === 'boss') z.boss = { state: 'walk', t: 3, dx: 0, dy: 0, summon: 6 };
    if (kind === 'brood') z.brood = { lay: 4, spit: 2.5 };
    if (kind === 'juggernaut') {
      z.boss = { state: 'walk', t: 4, dx: 0, dy: 0, summon: 0 };
      z.jug = { slam: 3, windup: 0 };
    }
    if (kind === 'leaper') z.leap = { state: 'walk', t: rand(1, 2), dx: 0, dy: 0 };
    if (kind === 'shield') z.face = Math.atan2(this.p.y - z.y, this.p.x - z.x);
    this.zombies.push(z);
    return z;
  }

  private buildFlow() {
    const f = this.flow;
    f.fill(-1);
    const queue = FLOW_QUEUE;
    let head = 0;
    let tail = 0;
    // Every player is a source, so each zombie heads for whoever is closest around the walls.
    for (const t of this.targets()) {
      const i = clamp(Math.floor(t.y / CELL), 0, FLOW_H - 1) * FLOW_W + clamp(Math.floor(t.x / CELL), 0, FLOW_W - 1);
      if (f[i] === 0) continue;
      f[i] = 0;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const cx = i % FLOW_W;
      const cy = (i / FLOW_W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + NEIGHBORS[k][0];
        const ny = cy + NEIGHBORS[k][1];
        if (nx < 0 || ny < 0 || nx >= FLOW_W || ny >= FLOW_H) continue;
        const j = ny * FLOW_W + nx;
        if (f[j] >= 0 || this.blocked[j]) continue;
        f[j] = f[i] + 1;
        queue[tail++] = j;
      }
    }
  }

  /** Direction a zombie at (x, y) should walk to reach the player around cover. */
  private flowDir(x: number, y: number): { x: number; y: number } | null {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const inside = cx >= 0 && cy >= 0 && cx < FLOW_W && cy < FLOW_H;
    const here = inside ? this.flow[cy * FLOW_W + cx] : -1;
    // Shoved into a wall's padding (or off the map) there is no path from here, and
    // walking straight at the player can pin a zombie against cover forever, so the
    // wave never ends. Step back to the closest open cell instead.
    if (here < 0) return this.escapeDir(x, y, cx, cy);
    if (here <= 1) return null;
    let best = here;
    let bx = 0;
    let by = 0;
    for (const [ox, oy] of NEIGHBORS) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= FLOW_W || ny >= FLOW_H) continue;
      const v = this.flow[ny * FLOW_W + nx];
      // Diagonals only when both side cells are open, so we don't cut corners into walls.
      if (v < 0 || v >= best) continue;
      if (ox && oy && (this.flow[cy * FLOW_W + nx] < 0 || this.flow[ny * FLOW_W + cx] < 0)) continue;
      best = v;
      bx = ox;
      by = oy;
    }
    if (best === here) return null;
    const tx = (cx + bx + 0.5) * CELL - x;
    const ty = (cy + by + 0.5) * CELL - y;
    const d = Math.hypot(tx, ty) || 1;
    return { x: tx / d, y: ty / d };
  }

  /** From a cell with no path, the way to the nearest cell that has one (null if none close by). */
  private escapeDir(x: number, y: number, cx: number, cy: number): { x: number; y: number } | null {
    for (let r = 1; r <= 3; r++) {
      let best = Infinity;
      let bx = 0;
      let by = 0;
      for (let oy = -r; oy <= r; oy++)
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= FLOW_W || ny >= FLOW_H) continue;
          const v = this.flow[ny * FLOW_W + nx];
          if (v < 0) continue;
          // Prefer close cells, then cells nearer the player.
          const score = v + Math.hypot(ox, oy) * 2;
          if (score < best) {
            best = score;
            bx = nx;
            by = ny;
          }
        }
      if (best < Infinity) {
        const tx = (bx + 0.5) * CELL - x;
        const ty = (by + 0.5) * CELL - y;
        const d = Math.hypot(tx, ty) || 1;
        return { x: tx / d, y: ty / d };
      }
    }
    return null;
  }

  /** Everyone the horde can go for: the host and any co-op guests still on their feet. */
  private targets(): { x: number; y: number; vx: number; vy: number }[] {
    const ts: { x: number; y: number; vx: number; vy: number }[] = [];
    if (!this.down) ts.push(this.p);
    for (const a of this.allies) if (!a.down) ts.push(a);
    if (!ts.length) ts.push(this.p);
    // Story mode: the horde goes for the generator too.
    if (this.opS.gen && this.opS.gen.hp > 0) ts.push(this.opS.gen);
    return ts;
  }

  private nearest<T extends { x: number; y: number }>(ts: T[], x: number, y: number): T {
    let best = ts[0];
    let bd = Infinity;
    for (const t of ts) {
      const d = (t.x - x) ** 2 + (t.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  private updateZombies(dt: number) {
    const ts = this.targets();
    const zs = this.zombies;
    const frozen = this.active.freeze > 0;
    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.2;
      this.buildFlow();
    }
    const onlyMimics = this.toSpawn <= 0 && zs.every((z) => z.dead || z.lurk);
    const blow = this.blizzard.phase === 'blow';
    for (const z of zs) {
      if (z.dead) continue;
      if (z.flash > 0) z.flash -= dt;
      if (z.lurk) {
        // Sits still until someone walks up (or it's the last one left).
        if (onlyMimics || ts.some((t) => Math.hypot(t.x - z.x, t.y - z.y) < 150)) this.wakeMimic(z);
        else continue;
      }
      if (z.burn > 0) {
        z.burn -= dt;
        z.hp -= 12 * this.stats.damage * dt;
        if (Math.random() < dt * 14) this.spawnParticle(z.x + rand(-z.r, z.r) * 0.6, z.y + rand(-z.r, z.r) * 0.6, rand(-20, 20), rand(-60, -20), rand(0.3, 0.5), rand(4, 8), Math.random() < 0.5 ? '#ff8a2b' : '#ffd23f', 2, false, true, -8);
        if (Math.random() < dt * 4) this.addLight(z.x, z.y, 90, 0.2, '#ff7a20');
        if (z.hp <= 0) {
          this.killZombie(z, z.face + Math.PI);
          continue;
        }
      }
      if (frozen) continue;
      if (z.frozenT > 0) {
        z.frozenT -= dt;
        continue;
      }
      if (z.chill > 0) z.chill = Math.max(0, z.chill - dt * 3);
      if (z.charm > 0) {
        this.updateTurned(z, dt);
        continue;
      }
      if (z.latch) {
        this.updateLatched(z, dt);
        continue;
      }
      const p = ts.length > 1 ? this.nearest(ts, z.x, z.y) : ts[0];
      const dx = p.x - z.x;
      const dy = p.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = z.speed * (z.slow > 0 ? 0.5 : 1);
      const dir = d > 90 && !intangible(z) ? this.flowDir(z.x, z.y) : null;
      let vx = (dir ? dir.x : dx / d) * sp;
      let vy = (dir ? dir.y : dy / d) * sp;

      if (z.def.kind === 'spitter' || z.def.kind === 'webber') {
        const web = z.def.kind === 'webber';
        z.spitCd -= dt;
        if (d < 330) {
          // Keep a bit of distance and lob acid.
          const back = d < 220 ? -0.6 : 0;
          vx = (dx / d) * sp * back;
          vy = (dy / d) * sp * back;
          if (z.spitCd <= 0) {
            z.spitCd = web ? rand(2.4, 3.2) : rand(1.8, 2.6);
            const sp2 = web ? 380 : 300;
            const lead = d / sp2;
            const ax = p.x + p.vx * lead * 0.5 - z.x;
            const ay = p.y + p.vy * lead * 0.5 - z.y;
            const ad = Math.hypot(ax, ay) || 1;
            this.spits.push({ x: z.x, y: z.y, vx: (ax / ad) * sp2, vy: (ay / ad) * sp2, life: Math.min(1.4, ad / sp2) + (web ? 0.15 : 0), web });
            this.wsfx(web ? 'web' : 'spit');
          }
        }
      }

      const kind = z.def.kind;
      if (z.buff > 0) {
        z.buff -= dt;
        vx *= 1.45;
        vy *= 1.45;
      }
      if (z.elite === 'vampiric' && z.hp < z.maxHp) z.hp = Math.min(z.maxHp, z.hp + z.maxHp * 0.03 * dt);

      if (kind === 'egg') {
        vx = vy = 0;
        z.abilityCd -= dt;
        if (z.abilityCd <= 0) {
          this.hatchEgg(z);
          continue;
        }
      }

      if (kind === 'screamer' || kind === 'necro' || kind === 'medic') {
        // Hang back behind the horde.
        z.abilityCd -= dt;
        const near = kind === 'necro' ? 300 : kind === 'medic' ? 230 : 250;
        if (d < near + 100) {
          const back = d < near ? -0.55 : 0;
          vx = (dx / d) * sp * back;
          vy = (dy / d) * sp * back;
        }
        if (z.abilityCd <= 0 && d < 650) {
          if (kind === 'screamer') this.scream(z);
          else if (kind === 'medic') this.healPulse(z);
          else this.raiseDead(z);
        }
      }

      if (z.leap) {
        const L = z.leap;
        const roll = kind === 'roller';
        L.t -= dt;
        if (L.state === 'walk' && L.t <= 0) {
          if (d < (roll ? 460 : 330) && d > 70) {
            L.state = 'crouch';
            L.t = roll ? 0.75 : 0.55;
          } else L.t = 0.25;
        }
        if (L.state === 'crouch') {
          vx = vy = 0;
          // Locks its aim just before it jumps, so a late sidestep dodges it.
          if (L.t > 0.18) {
            L.dx = dx / d;
            L.dy = dy / d;
          }
          if (L.t <= 0) {
            L.state = 'leap';
            L.t = roll ? 1.4 : 0.42;
            this.wsfx(roll ? 'roll' : 'pounce');
          }
        } else if (L.state === 'leap') {
          vx = L.dx * (roll ? 600 : 720);
          vy = L.dy * (roll ? 600 : 720);
          if (Math.random() < 0.6) this.spawnParticle(z.x, z.y, rand(-30, 30), rand(-30, 30), 0.3, 6, roll ? 'rgba(230,240,250,0.4)' : 'rgba(140,110,60,0.3)', 3, false, false, 10);
          if (L.t <= 0) {
            L.state = 'walk';
            L.t = rand(1.8, 2.8);
          }
        }
      }

      if (kind === 'electric') {
        z.abilityCd -= dt;
        if (z.zapT > 0) {
          // Charging: stands still and crackles, then zaps.
          vx *= 0.2;
          vy *= 0.2;
          z.zapT -= dt;
          if (Math.random() < 0.5) this.spawnParticle(z.x + rand(-z.r, z.r), z.y + rand(-z.r, z.r), 0, 0, 0.12, 3, '#a0f0ff', 1, false, true);
          if (z.zapT <= 0) this.zap(z, d, p);
        } else if (z.abilityCd <= 0 && d < 250) {
          z.zapT = 0.6;
          z.abilityCd = rand(2.6, 3.4);
        }
      }

      if (kind === 'bomber') {
        if (z.fuse > 0) {
          // Lit: sprints the last few steps, then goes off.
          vx *= 1.3;
          vy *= 1.3;
          z.fuse -= dt;
          if (Math.random() < 0.6) this.spawnParticle(z.x + Math.cos(z.face) * z.r * 0.6, z.y + Math.sin(z.face) * z.r * 0.6, rand(-40, 40), rand(-80, -20), 0.25, 3, '#ffd23f', 3, false, true);
          if (z.fuse <= 0) {
            this.killZombie(z, z.face);
            continue;
          }
        } else if (d < 130) {
          z.fuse = 0.85;
          this.wsfx('fuse');
        }
      }

      if (z.dig) {
        const D = z.dig;
        D.t -= dt;
        if (D.state === 'walk' && D.t <= 0) {
          if (d > 230) {
            D.state = 'under';
            D.t = 3.5;
            this.dirt(z.x, z.y, 14);
            this.wsfx('dig');
          } else D.t = 0.5;
        } else if (D.state === 'under') {
          // Tunnels straight at you, under walls and all.
          vx = (dx / d) * sp * 2.3;
          vy = (dy / d) * sp * 2.3;
          if (Math.random() < dt * 30) this.spawnParticle(z.x + rand(-12, 12), z.y + rand(-12, 12), rand(-50, 50), rand(-50, 50), 0.4, rand(3, 6), Math.random() < 0.5 ? '#5a4632' : '#3a2c1e', 4, false, false);
          if ((d < 40 || D.t <= 0) && !this.pointInWall(z.x, z.y)) {
            D.state = 'rise';
            D.t = 0.5;
            this.wsfx('dig', 0.6);
          }
        } else if (D.state === 'rise') {
          vx = vy = 0;
          if (D.t <= 0) {
            D.state = 'walk';
            D.t = rand(4, 6);
            this.dirt(z.x, z.y, 22);
            this.ring({ x: z.x, y: z.y, r: 10, max: 80, life: 0.35, color: 'rgba(170,130,80,' });
            this.addShake(0.2);
            for (const t of ts) if (Math.hypot(t.x - z.x, t.y - z.y) < 80) this.hurtPlayer(z.dmg * 1.3, z, t);
            z.attackCd = 0.6;
          }
        }
      }

      if (kind === 'wraith') {
        if (z.ghostT > 0) {
          vx = (dx / d) * sp * 1.4;
          vy = (dy / d) * sp * 1.4;
          z.ghostT -= dt;
          // Never turn solid inside a wall.
          if (z.ghostT <= 0 && this.pointInWall(z.x, z.y)) z.ghostT = 0.1;
        } else {
          z.abilityCd -= dt;
          if (z.abilityCd <= 0 && d > 110) {
            z.ghostT = 1.8;
            z.abilityCd = rand(2.6, 3.8);
            this.wsfx('blink', 0.4);
          }
        }
      }

      if (z.reap) {
        const R = z.reap;
        R.sweep -= dt;
        R.blink -= dt;
        R.orbs -= dt;
        if (R.windup > 0) {
          vx = vy = 0;
          R.windup -= dt;
          if (R.windup <= 0) this.scytheSweep(z);
        } else if (R.sweep <= 0 && d < SWEEP_R - 20) {
          R.windup = 0.7;
          R.aim = Math.atan2(dy, dx);
          R.sweep = rand(2.2, 3);
          this.wsfx('pounce', 0.7);
        } else if (R.blink <= 0 && d > 380) {
          this.reaperBlink(z, p);
          R.blink = rand(6, 8);
          R.sweep = Math.min(R.sweep, 0.35);
        } else if (R.orbs <= 0 && d < 750) {
          R.orbs = rand(5, 6.5);
          const n = 10 + Math.min(6, Math.floor(this.wave / 20));
          const base = Math.atan2(dy, dx);
          for (let i = 0; i < n; i++) {
            const a = base + (i / n) * Math.PI * 2;
            this.spits.push({ x: z.x + Math.cos(a) * z.r, y: z.y + Math.sin(a) * z.r, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 2, soul: true });
          }
          this.ring({ x: z.x, y: z.y, r: 0, max: 110, life: 0.45, color: 'rgba(122,255,234,' });
          this.wsfx('raise', 0.7);
        }
        if (!R.summoned && z.hp < z.maxHp * 0.5) {
          R.summoned = true;
          for (let i = 0; i < 4 + Math.floor(this.wave / 20); i++) {
            const a = (i / 4) * Math.PI * 2;
            const x = z.x + Math.cos(a) * 110;
            const y = z.y + Math.sin(a) * 110;
            if (this.pointInWall(x, y)) continue;
            this.spawnZombie('wraith', x, y).flash = 0.3;
          }
          this.showShout('THE DEAD ANSWER HIM!', '#7affea', true);
          this.ring({ x: z.x, y: z.y, r: 0, max: 200, life: 0.6, color: 'rgba(122,255,234,' });
        }
      }

      if (kind === 'sludger') {
        z.abilityCd -= dt;
        if (z.abilityCd <= 0) {
          z.abilityCd = 0.7;
          this.puddles.push({ x: z.x, y: z.y, r: 26, life: 3.2, max: 3.2, kind: 'sludge' });
        }
      }

      if (kind === 'parasite' && p === this.p && d < 64 && z.attackCd <= 0 && this.dashT <= 0 && !this.down && this.invT <= 0 && this.state === 'playing') {
        // Jumps on and clings.
        z.latch = 6;
        z.latchA = Math.atan2(z.y - p.y, z.x - p.x);
        this.sfx.play('latch');
        if (!this.latchWarned) {
          this.latchWarned = true;
          this.showShout('PARASITE! DASH TO SHAKE IT OFF', '#ff4a6a');
        }
        continue;
      }

      if (kind === 'mutant') {
        z.regenT += dt;
        z.healing = z.regenT > 1.4 && z.hp < z.maxHp && z.burn <= 0 && z.slow <= 0 && !this.inGoo(z);
        if (z.healing) {
          z.hp = Math.min(z.maxHp, z.hp + z.maxHp * 0.08 * dt);
          if (Math.random() < dt * 12) this.spawnParticle(z.x + rand(-z.r, z.r) * 0.7, z.y + rand(-z.r, z.r) * 0.7, 0, rand(-60, -25), 0.5, 3.5, '#7aff5a', 1, false, true);
        }
        // Badly hurt mutants go berserk.
        if (z.hp < z.maxHp * 0.35) {
          vx *= 1.35;
          vy *= 1.35;
        }
      }

      if (z.yank) {
        // Psyker: hangs back, then locks on and yanks you into the horde.
        const Y = z.yank;
        Y.cd -= dt;
        if (d < 330) {
          const back = d < 250 ? -0.6 : 0;
          vx = (dx / d) * sp * back;
          vy = (dy / d) * sp * back;
        }
        if (Y.windup > 0) {
          vx = vy = 0;
          Y.windup -= dt;
          Y.tx = p.x;
          Y.ty = p.y;
          if (Math.random() < 0.6) this.spawnParticle(z.x + rand(-z.r, z.r), z.y + rand(-z.r, z.r), 0, rand(-50, -20), 0.3, 3, '#e08aff', 1, false, true);
          if (Y.windup <= 0 && d < 520) {
            this.pullPlayer(p, z.x, z.y);
            this.bolt({ x1: z.x, y1: z.y, x2: p.x, y2: p.y, life: 0.25, color: '#e08aff' });
          }
        } else if (Y.cd <= 0 && d < 440 && d > 140) {
          Y.windup = 0.9;
          Y.cd = rand(5, 6.5);
          Y.tx = p.x;
          Y.ty = p.y;
          this.wsfx('psy');
        }
      }

      if (z.zero) {
        const v = this.updateZero(z, dt, d, dx, dy, ts);
        if (v) {
          vx = v.x;
          vy = v.y;
        }
      }

      if (z.sludge) {
        const S = z.sludge;
        S.drip -= dt;
        S.mortar -= dt;
        if (S.drip <= 0) {
          S.drip = 0.35;
          this.puddles.push({ x: z.x + rand(-10, 10), y: z.y + rand(-10, 10), r: z.r * 0.8, life: 3.5, max: 3.5, kind: 'sludge' });
        }
        if (S.mortar <= 0 && d < 900) {
          S.mortar = rand(4.2, 5.2) * (z.mini ? 1.25 : 1);
          // One glob at each player's feet (a little ahead of them), plus strays around them.
          for (const t of ts) {
            const tx = t.x + t.vx * 0.6;
            const ty = t.y + t.vy * 0.6;
            const spots = [{ x: tx, y: ty }, ...[0, 1].map(() => ({ x: t.x + rand(-170, 170), y: t.y + rand(-170, 170) }))];
            for (const sp2 of spots) {
              const x = clamp(sp2.x, BORDER + 30, WORLD_W - BORDER - 30);
              const y = clamp(sp2.y, BORDER + 30, WORLD_H - BORDER - 30);
              const fl = rand(1.05, 1.3);
              this.mortars.push({ x, y, sx: z.x, sy: z.y, t: fl, max: fl });
            }
          }
          this.wsfx('mortar');
        }
        const nextSplit = S.splits === 0 ? 2 / 3 : S.splits === 1 ? 1 / 3 : -1;
        if (z.hp < z.maxHp * nextSplit) {
          S.splits++;
          for (let i = 0; i < 3; i++) {
            const a = rand(0, Math.PI * 2);
            const x = z.x + Math.cos(a) * z.r * 1.4;
            const y = z.y + Math.sin(a) * z.r * 1.4;
            if (this.pointInWall(x, y)) continue;
            this.spawnZombie('sludger', x, y, { mini: true }).flash = 0.3;
          }
          this.puddles.push({ x: z.x, y: z.y, r: 110, life: 5, max: 5, kind: 'sludge' });
          this.showShout('THE KING SPLITS!', '#c8ff3a', true);
          this.ring({ x: z.x, y: z.y, r: 0, max: 180, life: 0.5, color: 'rgba(200,255,60,' });
          this.wsfx('gurgle');
          this.addShake(0.4);
        }
      }

      if (z.titan) {
        const T = z.titan;
        const mk = z.mini ? 1.25 : 1;
        T.boulder -= dt;
        T.nova -= dt;
        if (T.windup > 0) {
          // Rearing up for a frost nova: stands still, frost gathering around it.
          vx = vy = 0;
          T.windup -= dt;
          if (Math.random() < 0.7) {
            const a = rand(0, Math.PI * 2);
            this.spawnParticle(z.x + Math.cos(a) * z.r * 2, z.y + Math.sin(a) * z.r * 2, -Math.cos(a) * 160, -Math.sin(a) * 160, 0.35, rand(3, 5), '#dff6ff', 1, false, true);
          }
          if (T.windup <= 0) {
            this.novas.push({ x: z.x, y: z.y, r: z.r, max: T.enraged ? 560 : 460, hit: [] });
            this.wsfx('nova');
            this.addShake(0.4);
            this.addLight(z.x, z.y, 320, 0.4, '#bfe8ff');
          }
        } else if (T.nova <= 0 && d < 380) {
          T.windup = 1;
          T.nova = rand(6.5, 8) * mk;
          this.wsfx('crack');
        } else if (T.boulder <= 0 && d < 950) {
          T.boulder = rand(3.4, 4.4) * mk * (T.enraged ? 0.7 : 1);
          for (const t of ts) {
            const spots = [{ x: t.x + t.vx * 0.7, y: t.y + t.vy * 0.7 }];
            if (T.enraged) for (let i = 0; i < 2; i++) spots.push({ x: t.x + rand(-220, 220), y: t.y + rand(-220, 220) });
            for (const sp2 of spots) {
              const fl = rand(1.2, 1.45);
              this.mortars.push({ x: clamp(sp2.x, BORDER + 40, WORLD_W - BORDER - 40), y: clamp(sp2.y, BORDER + 40, WORLD_H - BORDER - 40), sx: z.x, sy: z.y, t: fl, max: fl, ice: true });
            }
          }
          this.wsfx('mortar');
        }
        if (!T.enraged && z.hp < z.maxHp * 0.5) {
          T.enraged = true;
          z.speed *= 1.3;
          for (let i = 0; i < 3 + Math.floor(this.wave / 20); i++) {
            const a = (i / 3) * Math.PI * 2 + rand(-0.3, 0.3);
            const x = z.x + Math.cos(a) * (z.r + 50);
            const y = z.y + Math.sin(a) * (z.r + 50);
            if (this.pointInWall(x, y)) continue;
            this.spawnZombie('icer', x, y).flash = 0.3;
          }
          this.startBlizzard(9);
          this.showShout('THE TITAN CALLS THE BLIZZARD!', '#bfe8ff', true);
          this.ring({ x: z.x, y: z.y, r: 0, max: 220, life: 0.6, color: 'rgba(190,232,255,' });
          this.addShake(0.5);
        }
      }

      if (z.jug) {
        const J = z.jug;
        J.slam -= dt;
        if (J.windup > 0) {
          vx = vy = 0;
          J.windup -= dt;
          if (J.windup <= 0) this.groundSlam(z);
        } else if (J.slam <= 0 && d < 280 && z.boss?.state === 'walk') {
          J.windup = 0.9;
          J.slam = rand(4.5, 6.5);
        }
      }

      if (z.brood) {
        const B = z.brood;
        B.lay -= dt;
        B.spit -= dt;
        if (B.lay <= 0) {
          B.lay = 8;
          const n = 3 + Math.floor(this.wave / 20);
          for (let i = 0; i < n; i++) {
            const a = z.face + Math.PI + rand(-1.4, 1.4);
            this.spawnZombie('egg', z.x + Math.cos(a) * (z.r + 30), z.y + Math.sin(a) * (z.r + 30));
          }
          this.showShout('SHOOT THE EGGS!', '#ffcf5a', true);
          this.wsfx('splat');
          this.ring({ x: z.x, y: z.y, r: 0, max: 120, life: 0.45, color: 'rgba(255,220,120,' });
        }
        if (B.spit <= 0 && d < 560) {
          B.spit = rand(2.2, 3);
          const base = Math.atan2(dy, dx);
          for (let i = -2; i <= 2; i++) {
            const a = base + i * 0.22;
            this.spits.push({ x: z.x + Math.cos(a) * z.r, y: z.y + Math.sin(a) * z.r, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, life: 1.5 });
          }
          this.wsfx('spit');
        }
      }

      if (z.boss) {
        const b = z.boss;
        b.t -= dt;
        b.summon -= dt;
        if (kind === 'boss' && b.summon <= 0) {
          b.summon = 7;
          for (let i = 0; i < 3 + Math.floor(this.wave / 10); i++) this.spawnZombie(Math.random() < 0.3 ? 'bloater' : 'runner', z.x + rand(-60, 60), z.y + rand(-60, 60));
          this.ring({ x: z.x, y: z.y, r: 0, max: 130, life: 0.5, color: 'rgba(190,90,255,' });
        }
        if (z.jug && z.jug.windup > 0) b.t = Math.max(b.t, 0.5);
        if (z.zero && (z.zero.laserW > 0 || z.zero.laserT > 0 || z.zero.yankT > 0 || z.zero.trans > 0)) b.t = Math.max(b.t, 0.5);
        if (b.state === 'walk' && b.t <= 0) {
          b.state = 'windup';
          b.t = 0.8;
        } else if (b.state === 'windup') {
          vx = vy = 0;
          b.dx = dx / d;
          b.dy = dy / d;
          if (b.t <= 0) {
            b.state = 'charge';
            b.t = 0.8;
            this.wsfx('dash');
          }
        } else if (b.state === 'charge') {
          vx = b.dx * 540;
          vy = b.dy * 540;
          if (Math.random() < 0.5) this.spawnParticle(z.x, z.y, rand(-40, 40), rand(-40, 40), 0.5, 10, 'rgba(120,100,90,0.3)', 3, false, false, 20);
          if (b.t <= 0) {
            b.state = 'walk';
            b.t = rand(3, 4.5);
          }
        }
      }

      if ((z.stun ?? 0) > 0) {
        z.stun! -= dt;
        vx = vy = 0;
        if (Math.random() < dt * 6) this.spawnParticle(z.x + rand(-z.r, z.r), z.y - z.r, 0, -30, 0.4, 3, '#ffd23f', 1, false, true);
      }
      if (blow && !isBoss(z)) {
        vx += Math.cos(this.blizzard.dir) * WIND * 0.55;
        vy += Math.sin(this.blizzard.dir) * WIND * 0.55;
      }
      if ((z.pin ?? 0) > 0) z.pin! -= dt;
      let face = Math.atan2(z.boss?.state === 'charge' ? z.boss.dy : dy, z.boss?.state === 'charge' ? z.boss.dx : dx);
      if (z.leap && z.leap.state !== 'walk') face = Math.atan2(z.leap.dy, z.leap.dx);
      if (z.reap && z.reap.windup > 0) face = z.reap.aim;
      if (z.zero && (z.zero.laserW > 0 || z.zero.laserT > 0)) face = z.zero.laserA;
      if (kind === 'shield') {
        // Brutes turn slowly behind their shield, so you can flank them.
        let da = face - z.face;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        z.face += clamp(da, -1.25 * dt, 1.25 * dt);
      } else z.face = face;
      // On ice a shove sends them sliding.
      const grip = (z.pin ?? 0) > 0 ? 2.2 : this.map.ice && this.onIce(z.x, z.y) ? 2.5 : 9;
      z.kx *= Math.exp(-dt * grip);
      z.ky *= Math.exp(-dt * grip);
      const ox = z.x;
      const oy = z.y;
      z.x += (vx + z.kx) * dt;
      z.y += (vy + z.ky) * dt;
      const phasing = intangible(z);
      if (phasing) {
        z.x = clamp(z.x, BORDER + z.r, WORLD_W - BORDER - z.r);
        z.y = clamp(z.y, BORDER + z.r, WORLD_H - BORDER - z.r);
      } else if (this.collideWalls(z, z.r)) {
        if (kind === 'roller' && z.leap?.state === 'leap') {
          // Rolled into a wall: dizzy for a moment and easy to hurt.
          z.stun = 1.6;
          this.addText(z.x, z.y - z.r - 8, 'DIZZY', '#ffd23f', 13);
          this.wsfx('crack', 0.7);
          this.addShake(0.15);
          for (let i = 0; i < 6; i++) this.spawnParticle(z.x, z.y, rand(-160, 160), rand(-160, 160), 0.4, rand(3, 6), '#e8f0f6', 4, true, false);
        }
        if (z.leap?.state === 'leap') {
          z.leap.state = 'walk';
          z.leap.t = rand(1.8, 2.8);
        }
        if ((z.pin ?? 0) > 0 && Math.hypot(z.kx, z.ky) > 100) {
          // Harpooned into a wall.
          const dmg = z.pinDmg ?? 0;
          z.pin = 0;
          z.kx = z.ky = 0;
          this.addText(z.x, z.y - z.r - 10, 'PINNED!', '#c8d0d8', 15);
          this.wsfx('crack');
          this.addShake(0.2);
          this.cause = 'pin';
          this.damageZombie(z, dmg, z.face + Math.PI, false, 0);
          this.cause = '';
          if (z.dead) continue;
        }
        if (z.boss && z.boss.state === 'charge') {
          z.boss.state = 'walk';
          z.boss.t = rand(3, 4.5);
          this.addShake(0.7);
          this.wsfx('explode', 0.6);
          this.ring({ x: z.x, y: z.y, r: 0, max: 90, life: 0.4, color: 'rgba(200,180,160,' });
        }
      }
      // A big shove can tunnel a zombie through the outer wall, where it could never be
      // reached again; keep everyone inside the arena.
      if (!phasing) {
        z.x = clamp(z.x, BORDER + z.r, WORLD_W - BORDER - z.r);
        z.y = clamp(z.y, BORDER + z.r, WORLD_H - BORDER - z.r);
      }
      if (z.attackCd > 0) z.attackCd -= dt;
      for (const dp of this.deploys) {
        if (dp.kind === 'mine' || phasing) continue;
        const touching = Math.hypot(z.x - dp.x, z.y - dp.y) < z.r + dp.r + 3;
        if (dp.kind === 'barricade') this.pushOut(z, z.r, dp);
        if (touching && z.attackCd <= 0 && kind !== 'egg' && kind !== 'bloater') {
          z.attackCd = 0.8;
          dp.hp -= isBoss(z) ? z.dmg * 3 : z.dmg;
          if (Math.random() < 0.5) this.spawnParticle(dp.x, dp.y, rand(-120, 120), rand(-120, 120), 0.4, rand(3, 5), dp.kind === 'barricade' ? '#a8885a' : '#8a9298', 4, false, false);
        }
      }
      z.phase += Math.hypot(z.x - ox, z.y - oy) * 0.08;
      if (z.slow > 0) z.slow -= dt;
      if (z.bladeCd > 0) z.bladeCd -= dt;

      if (d < z.r + PLAYER_R + 3 && z.attackCd <= 0 && !phasing && z.dig?.state !== 'rise' && kind !== 'bomber') {
        if (z.def.kind === 'bloater') {
          this.killZombie(z, z.face);
          continue;
        }
        if (kind === 'egg') continue;
        z.attackCd = 0.8;
        const rolling = kind === 'roller' && z.leap?.state === 'leap';
        this.hurtPlayer(z.dmg * (rolling ? 1.3 : 1), z, p, rolling ? { x: z.leap!.dx * 420, y: z.leap!.dy * 420 } : undefined);
        if (kind === 'icer') this.chillPlayer(p, 1.6, 0.6);
        if (z.elite === 'vampiric') {
          z.hp = Math.min(z.maxHp, z.hp + z.maxHp * 0.25);
          this.addText(z.x, z.y - z.r - 8, 'DRAIN', '#ff2a4a', 12);
        }
        if (z.leap?.state === 'leap') {
          z.leap.state = 'walk';
          z.leap.t = rand(1.8, 2.8);
        }
      }
    }

    // Keep zombies from stacking on top of each other.
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i];
      if (a.latch) continue;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        if (b.latch) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        if (dx > min || dx < -min || dy > min || dy < -min) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const ma = a.lurk ? 999 : a.def.mass;
        const mb = b.lurk ? 999 : b.def.mass;
        const ra = mb / (ma + mb);
        const rb = ma / (ma + mb);
        a.x -= (dx / d) * push * ra * 2;
        a.y -= (dy / d) * push * ra * 2;
        b.x += (dx / d) * push * rb * 2;
        b.y += (dy / d) * push * rb * 2;
      }
    }
  }

  private hatchEgg(z: Zombie) {
    z.dead = true;
    const n = this.wave >= 40 ? 3 : 2;
    for (let i = 0; i < n; i++) this.spawnZombie(Math.random() < 0.5 ? 'leaper' : 'runner', z.x + rand(-20, 20), z.y + rand(-20, 20));
    for (let i = 0; i < 14; i++) this.spawnBlood(z.x, z.y, rand(0, Math.PI * 2), i % 2 ? '#d8c89a' : '#8a7a4a');
    this.wsfx('splat');
  }

  /** Electric zombie: lightning to the player if still in range, arcing on to nearby zombies and speeding them up. */
  private zap(z: Zombie, d: number, target: { x: number; y: number }) {
    this.wsfx('zap');
    this.addLight(z.x, z.y, 200, 0.2, '#a0f0ff');
    if (d < 300) {
      this.bolt({ x1: z.x, y1: z.y, x2: target.x, y2: target.y, life: 0.18, color: '#a0f0ff' });
      this.hurtPlayer(12 * (1 + 0.04 * this.wave), z, target);
    }
    let n = 0;
    for (const o of this.zombies) {
      if (n >= 3 || o === z || o.dead || isBoss(o) || o.def.kind === 'egg') continue;
      if (Math.hypot(o.x - z.x, o.y - z.y) > 220) continue;
      this.bolt({ x1: z.x, y1: z.y, x2: o.x, y2: o.y, life: 0.18, color: '#a0f0ff' });
      o.buff = Math.max(o.buff, 3);
      n++;
    }
  }

  /** Juggernaut: a shockwave around it after a telegraphed wind-up. */
  private groundSlam(z: Zombie) {
    const R = 240;
    this.ring({ x: z.x, y: z.y, r: 20, max: R, life: 0.5, color: 'rgba(255,140,80,' });
    this.ring({ x: z.x, y: z.y, r: 10, max: R * 0.7, life: 0.4, color: 'rgba(255,220,180,' });
    for (let i = 0; i < 30; i++) {
      const a = rand(0, Math.PI * 2);
      this.spawnParticle(z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r, Math.cos(a) * rand(200, 500), Math.sin(a) * rand(200, 500), rand(0.4, 0.8), rand(6, 12), 'rgba(120,100,90,0.45)', 3, false, false, 16);
    }
    this.addShake(0.8);
    this.zoomKick = Math.max(this.zoomKick, 0.06);
    this.wsfx('slam');
    for (const t of this.targets()) if (Math.hypot(t.x - z.x, t.y - z.y) < R) this.hurtPlayer(38 * (1 + 0.03 * this.wave), z, t);
  }

  /** The Reaper: a wide scythe swing in front of him after a telegraphed wind-up. */
  private scytheSweep(z: Zombie) {
    const aim = z.reap!.aim;
    for (let i = 0; i < 26; i++) {
      const a = aim + rand(-SWEEP_ARC, SWEEP_ARC);
      const r = rand(40, SWEEP_R);
      this.spawnParticle(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, Math.cos(a + 1.5) * 260, Math.sin(a + 1.5) * 260, 0.25, rand(3, 6), i % 2 ? '#7affea' : '#e8fffb', 5, false, true);
    }
    this.addShake(0.5);
    this.wsfx('scythe');
    for (const t of this.targets()) {
      const d = Math.hypot(t.x - z.x, t.y - z.y);
      if (d > SWEEP_R + PLAYER_R) continue;
      if (Math.cos(Math.atan2(t.y - z.y, t.x - z.x) - aim) < Math.cos(SWEEP_ARC)) continue;
      this.hurtPlayer(36 * (1 + 0.03 * this.wave), z, t);
    }
  }

  /** The Reaper: vanishes in smoke and steps out right next to you. */
  private reaperBlink(z: Zombie, t: { x: number; y: number }) {
    for (let k = 0; k < 10; k++) {
      const a = rand(0, Math.PI * 2);
      const x = t.x + Math.cos(a) * 170;
      const y = t.y + Math.sin(a) * 170;
      if (x < BORDER + z.r || x > WORLD_W - BORDER - z.r || y < BORDER + z.r || y > WORLD_H - BORDER - z.r) continue;
      if (this.pointInWall(x, y)) continue;
      this.ring({ x: z.x, y: z.y, r: 0, max: 120, life: 0.4, color: 'rgba(60,60,80,' });
      for (let i = 0; i < 16; i++) this.spawnParticle(z.x + rand(-30, 30), z.y + rand(-30, 30), rand(-60, 60), rand(-60, 60), rand(0.6, 1), rand(14, 22), 'rgba(30,30,40,0.5)', 2, false, false, 20);
      z.x = x;
      z.y = y;
      z.kx = z.ky = 0;
      this.ring({ x, y, r: 0, max: 120, life: 0.4, color: 'rgba(122,255,234,' });
      for (let i = 0; i < 16; i++) this.spawnParticle(x + rand(-30, 30), y + rand(-30, 30), rand(-60, 60), rand(-60, 60), rand(0.6, 1), rand(14, 22), 'rgba(30,30,40,0.5)', 2, false, false, 20);
      this.wsfx('blink');
      return;
    }
  }

  // ---------------------------------------------------------------- lab zombies

  /** A zombie turned by the Mind Ray: hunts its old friends until its brain fries. */
  private updateTurned(z: Zombie, dt: number) {
    z.charm -= dt;
    if (z.charm <= 0) {
      z.charm = 0;
      for (let i = 0; i < 10; i++) this.spawnParticle(z.x, z.y, rand(-90, 90), rand(-90, 90), 0.4, 4, '#c77dff', 3, false, true);
      this.killZombie(z, z.face + Math.PI);
      return;
    }
    if (z.attackCd > 0) z.attackCd -= dt;
    z.abilityCd -= dt;
    let prey = z.prey ? this.zombies.find((o) => o.id === z.prey && !o.dead && o.charm <= 0 && !intangible(o)) : undefined;
    if (!prey || z.abilityCd <= 0) {
      z.abilityCd = 0.5;
      let bd = 700;
      prey = undefined;
      for (const o of this.zombies) {
        if (o === z || o.dead || o.charm > 0 || intangible(o) || o.latch) continue;
        const dd = Math.hypot(o.x - z.x, o.y - z.y);
        if (dd < bd) {
          bd = dd;
          prey = o;
        }
      }
      z.prey = prey?.id;
    }
    // No one to fight: tag along with you.
    const tx = prey ? prey.x : this.p.x;
    const ty = prey ? prey.y : this.p.y;
    const dx = tx - z.x;
    const dy = ty - z.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = prey ? z.r + prey.r + 4 : 90;
    const sp = d > reach ? z.speed * 1.25 : 0;
    const ox = z.x;
    const oy = z.y;
    z.face = Math.atan2(dy, dx);
    z.kx *= Math.exp(-dt * 9);
    z.ky *= Math.exp(-dt * 9);
    z.x += ((dx / d) * sp + z.kx) * dt;
    z.y += ((dy / d) * sp + z.ky) * dt;
    this.collideWalls(z, z.r);
    z.phase += Math.hypot(z.x - ox, z.y - oy) * 0.08;
    if (prey && d <= reach + 2 && z.attackCd <= 0) {
      z.attackCd = 0.6;
      this.damageZombie(prey, z.dmg * 3 + 12 * this.stats.damage, z.face, false, 160);
      this.spawnBlood(prey.x, prey.y, z.face, '#7a1010');
    }
    if (Math.random() < dt * 6) this.spawnParticle(z.x + rand(-6, 6), z.y - z.r, 0, -40, 0.4, 3, '#c77dff', 1, false, true);
  }

  /** A parasite riding the player: chews until it's shaken off or gives up. */
  private updateLatched(z: Zombie, dt: number) {
    const p = this.p;
    z.latch! -= dt;
    z.latchA! += dt * 0.6;
    z.x = p.x + Math.cos(z.latchA!) * PLAYER_R * 0.75;
    z.y = p.y + Math.sin(z.latchA!) * PLAYER_R * 0.75;
    z.face = z.latchA! + Math.PI;
    z.phase += dt * 6;
    if (this.down || this.state !== 'playing' || z.latch! <= 0) {
      // Falls off, dazed.
      z.latch = 0;
      z.attackCd = 1.2;
      z.x = p.x + Math.cos(z.latchA!) * 40;
      z.y = p.y + Math.sin(z.latchA!) * 40;
      this.collideWalls(z, z.r);
      return;
    }
    if (this.invT > 0) return;
    const dps = 6 * (1 + 0.04 * this.wave) * (1 - this.armor);
    p.hp -= dps * dt;
    this.hurtFlash = Math.max(this.hurtFlash, 0.1);
    if (Math.random() < dt * 8) this.spawnBlood(p.x, p.y, rand(0, Math.PI * 2), '#b0201a');
    if (p.hp <= 0) this.gameOver();
  }

  /** Standing in your own Acid Cannon goo (stops mutants healing). */
  private inGoo(z: Zombie) {
    for (const g of this.goos) if (!g.ghost && Math.hypot(z.x - g.x, z.y - g.y) < g.r + z.r * 0.5) return true;
    return false;
  }

  /** Mind Ray hit: enough of them and the zombie fights for you. */
  private addPsi(z: Zombie) {
    if (z.dead || z.charm > 0 || z.def.kind === 'egg') return;
    if (isBoss(z)) {
      if (Math.random() < 0.15) this.addText(z.x, z.y - z.r - 10, 'TOO STRONG', '#c77dff', 12);
      return;
    }
    z.psi++;
    const need = clamp(Math.round(z.def.hp / 40), 2, 7) + (z.elite ? 1 : 0);
    if (z.psi < need) return;
    z.psi = 0;
    z.charm = 7;
    z.latch = 0;
    z.fuse = 0;
    z.zapT = 0;
    z.prey = undefined;
    z.abilityCd = 0;
    if (z.leap) z.leap.state = 'walk';
    if (z.yank) z.yank.windup = 0;
    if (z.dig) z.dig.state = 'walk';
    z.ghostT = 0;
    this.report.turned++;
    this.ring({ x: z.x, y: z.y, r: 0, max: z.r * 3, life: 0.4, color: 'rgba(199,125,255,' });
    this.addText(z.x, z.y - z.r - 10, 'TURNED!', '#c77dff', 14);
    this.sfx.play('charm');
  }

  // ---------------------------------------------------------------- Patient Zero

  /** Runs Patient Zero's three forms. Returns a velocity override, or null to walk normally. */
  private updateZero(z: Zombie, dt: number, d: number, dx: number, dy: number, ts: { x: number; y: number }[]): { x: number; y: number } | null {
    const Z = z.zero!;
    if (Z.trans > 0) {
      // Transforming: roars, can't be hurt, flesh bursts off it.
      Z.trans -= dt;
      if (Math.random() < 0.5) this.spawnBlood(z.x, z.y, rand(0, Math.PI * 2), Math.random() < 0.5 ? '#8a1414' : '#ff5adc', 1.6);
      if (Math.random() < dt * 6) this.addShake(0.3);
      return { x: 0, y: 0 };
    }
    const ph = z.hp < z.maxHp / 3 ? 3 : z.hp < (z.maxHp * 2) / 3 ? 2 : 1;
    if (ph > Z.phase) {
      Z.phase = ph as 2 | 3;
      Z.trans = 1.5;
      Z.laserW = Z.laserT = Z.yankT = 0;
      Z.tendril = 1.8;
      Z.summon = 1.6;
      z.speed *= ph === 2 ? 1.2 : 1.15;
      if (ph === 3) z.boss = { state: 'walk', t: 4, dx: 0, dy: 0, summon: 0 };
      this.showBanner(ph === 2 ? 'IT EVOLVES' : 'FINAL FORM', ph === 2 ? 'PATIENT ZERO TEARS OFF ITS RESTRAINTS' : 'ITS EYE OPENS', '#ff5adc', true);
      this.wsfx('roar');
      this.slowT = Math.max(this.slowT, 0.6);
      this.flash = { t: 0.3, color: '#ff5adc', max: 0.3 };
      this.ring({ x: z.x, y: z.y, r: 0, max: 320, life: 0.6, color: 'rgba(255,90,220,' });
      this.ring({ x: z.x, y: z.y, r: 0, max: 200, life: 0.45, color: 'rgba(255,255,255,' });
      this.addShake(0.9);
      this.zoomKick = Math.max(this.zoomKick, 0.08);
      for (const t of this.targets()) {
        const td = Math.hypot(t.x - z.x, t.y - z.y);
        if (td < 300) {
          const a = Math.atan2(t.y - z.y, t.x - z.x);
          this.hurtPlayer(10, null, t, { x: Math.cos(a) * 700, y: Math.sin(a) * 700 });
        }
      }
      // The lights die when it changes.
      if (this.map.powercut && this.power.out <= 0) this.cutPower(6);
      return { x: 0, y: 0 };
    }
    Z.tendril -= dt;
    Z.summon -= dt;
    Z.yank -= dt;
    Z.laser -= dt;
    const mini = z.mini ? 1.3 : 1;
    if (Z.laserW > 0 || Z.laserT > 0) {
      this.zeroLaser(z, dt);
      return { x: 0, y: 0 };
    }
    if (Z.yankT > 0) {
      Z.yankT -= dt;
      if (Z.yankT <= 0) {
        for (const t of ts) {
          if (Math.hypot(t.x - z.x, t.y - z.y) > 650) continue;
          this.pullPlayer(t, z.x, z.y);
          this.bolt({ x1: z.x, y1: z.y, x2: t.x, y2: t.y, life: 0.3, color: '#ff5adc' });
        }
      }
      return { x: 0, y: 0 };
    }
    if (Z.summon <= 0) {
      Z.summon = (Z.phase === 1 ? 9 : 10) * mini;
      const kinds: ZombieKind[] = Z.phase === 1 ? ['parasite', 'parasite', 'parasite'] : Z.phase === 2 ? ['blob', 'blob', 'parasite', 'parasite'] : ['mutant', 'parasite', 'parasite', 'parasite'];
      if (this.wave >= 30) kinds.push('parasite', 'parasite');
      kinds.forEach((k, i) => {
        const a = (i / kinds.length) * Math.PI * 2 + rand(-0.3, 0.3);
        const x = z.x + Math.cos(a) * (z.r + 30);
        const y = z.y + Math.sin(a) * (z.r + 30);
        if (!this.pointInWall(x, y)) this.spawnZombie(k, x, y).flash = 0.3;
      });
      this.ring({ x: z.x, y: z.y, r: 0, max: 140, life: 0.45, color: 'rgba(255,90,220,' });
      this.wsfx('gurgle');
    }
    if (Z.tendril <= 0 && d < 720) {
      Z.tendril = (Z.phase === 1 ? 3.4 : Z.phase === 2 ? 3.0 : 3.6) * mini;
      this.tendrils(z, ts);
      return null;
    }
    if (Z.phase >= 2 && Z.yank <= 0 && d > 220 && d < 600) {
      Z.yank = rand(7, 9) * mini;
      Z.yankT = 1.0;
      this.wsfx('psy');
      return { x: 0, y: 0 };
    }
    if (Z.phase === 3 && Z.laser <= 0 && d < 700) {
      Z.laser = rand(6.5, 8) * mini;
      Z.laserW = 0.9;
      Z.laserDir = Math.random() < 0.5 ? 1 : -1;
      // Starts off to one side of you and sweeps across.
      Z.laserA = Math.atan2(dy, dx) - Z.laserDir * 0.95;
      Z.laserHit = [];
      this.wsfx('charge');
      return { x: 0, y: 0 };
    }
    return null;
  }

  /** Red lines toward each player; spikes burst out along them a moment later. */
  private tendrils(z: Zombie, ts: { x: number; y: number }[]) {
    const Z = z.zero!;
    const n = 2 + Z.phase;
    for (const t of ts.slice(0, 2)) {
      const base = Math.atan2(t.y - z.y, t.x - z.x);
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * (0.5 / Z.phase + 0.18);
        const x1 = z.x + Math.cos(a) * z.r * 0.8;
        const y1 = z.y + Math.sin(a) * z.r * 0.8;
        const len = this.rayWall(x1, y1, a, 560);
        this.spikes.push({ x1, y1, x2: x1 + Math.cos(a) * len, y2: y1 + Math.sin(a) * len, t: SPIKE_WARN, hit: [] });
      }
    }
    this.wsfx('dig', 0.7);
  }

  private updateSpikes(dt: number) {
    if (!this.spikes.length) return;
    const host = this.net !== 'client';
    const keep: Spike[] = [];
    for (const s of this.spikes) {
      const was = s.t;
      s.t -= dt;
      if (was > 0 && s.t <= 0) {
        // Erupt!
        this.sfx.play('tendril', 0.7);
        this.addShake(0.15);
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        for (let k = 0; k < len; k += 40) this.dirt(s.x1 + ((s.x2 - s.x1) * k) / len, s.y1 + ((s.y2 - s.y1) * k) / len, 2);
      }
      if (host && s.t <= 0 && s.t > -0.2) {
        for (const t of this.targets()) {
          if (s.hit.includes(t) || segDist(t.x, t.y, s.x1, s.y1, s.x2, s.y2) > SPIKE_W + PLAYER_R * 0.6) continue;
          s.hit.push(t);
          this.hurtPlayer(26 * (1 + 0.03 * this.wave), { x: s.x1, y: s.y1 }, t);
        }
      }
      if (s.t > -SPIKE_LIFE) keep.push(s);
    }
    this.spikes = keep;
  }

  /** Patient Zero's final form: aims an eye beam, then sweeps it across the floor. */
  private zeroLaser(z: Zombie, dt: number) {
    const Z = z.zero!;
    if (Z.laserW > 0) {
      Z.laserW -= dt;
      if (Z.laserW <= 0) {
        Z.laserT = 1.5;
        this.wsfx('laser');
      }
      return;
    }
    Z.laserT -= dt;
    Z.laserA += Z.laserDir * dt * 1.3;
    const ex = z.x + Math.cos(Z.laserA) * z.r * 0.6;
    const ey = z.y + Math.sin(Z.laserA) * z.r * 0.6;
    const len = this.rayWall(ex, ey, Z.laserA, 760);
    const x2 = ex + Math.cos(Z.laserA) * len;
    const y2 = ey + Math.sin(Z.laserA) * len;
    this.addLight(x2, y2, 160, 0.05, '#ff5adc');
    if (Math.random() < 0.7) this.spawnParticle(x2, y2, rand(-160, 160), rand(-160, 160), 0.25, 3, '#ffd0f4', 5, false, true);
    if (Math.random() < 0.3) {
      // Scorch marks where it burns the floor.
      this.dctx.fillStyle = 'rgba(30,10,20,0.4)';
      this.dctx.fillRect(x2 / 2 - 2, y2 / 2 - 2, 4, 4);
    }
    for (const t of this.targets()) {
      if (Z.laserHit.includes(t) || segDist(t.x, t.y, ex, ey, x2, y2) > 14 + PLAYER_R * 0.6) continue;
      Z.laserHit.push(t);
      this.hurtPlayer(34 * (1 + 0.03 * this.wave), null, t);
    }
    // It doesn't care what else is in the way.
    for (const o of this.zombies) {
      if (o === z || o.dead || isBoss(o) || intangible(o)) continue;
      if (segDist(o.x, o.y, ex, ey, x2, y2) < o.r + 8) this.damageZombie(o, 400 * dt, Z.laserA + Math.PI / 2, false, 0, true);
    }
  }

  /** How far a ray gets before it hits a wall (up to `max`). */
  private rayWall(x: number, y: number, a: number, max: number) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let d = 0; d < max; d += 10) if (this.pointInWall(x + c * d, y + s * d)) return Math.max(0, d - 6);
    return max;
  }

  // ---------------------------------------------------------------- beam guns

  /** Railgun: a slug that goes through every zombie in a line, stopping at the first wall. */
  private railShot(x: number, y: number, a: number, dmg: number) {
    const len = this.rayWall(x, y, a, 1500);
    const x2 = x + Math.cos(a) * len;
    const y2 = y + Math.sin(a) * len;
    const bx = x - Math.cos(a) * 44;
    const by = y - Math.sin(a) * 44;
    const hits = this.zombies.filter((z) => !z.dead && !offLimits(z) && segDist(z.x, z.y, bx, by, x2, y2) < z.r + 7);
    hits.sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y));
    hits.forEach((z, i) => {
      const crit = Math.random() < this.stats.crit;
      this.damageZombie(z, dmg * Math.pow(0.92, i) * (crit ? 2.5 : 1), a, crit, 260);
    });
    for (const b of this.barrels) if (!b.dead && b.fuse <= 0 && segDist(b.x, b.y, x, y, x2, y2) < 20) b.fuse = 0.05;
    this.beams.push({ x1: x, y1: y, x2, y2, life: 0.35, max: 0.35, color: '#7ae8ff', width: 9 });
    for (let k = 0; k < len; k += 26) this.spawnParticle(x + Math.cos(a) * k + rand(-6, 6), y + Math.sin(a) * k + rand(-6, 6), rand(-30, 30), rand(-30, 30), rand(0.2, 0.45), rand(2, 4), k % 52 ? '#bff6ff' : '#ffffff', 3, false, true);
    this.addLight(x, y, 260, 0.12, '#7ae8ff');
    this.addLight(x2, y2, 200, 0.12, '#7ae8ff');
    this.addShake(0.45);
    this.zoomKick = Math.max(this.zoomKick, 0.02);
    this.sfx.play('railgun');
    if (hits.length >= 5) this.addText(x2, y2 - 20, `x${hits.length} PIERCE`, '#7ae8ff', 16);
  }

  /** Plasma Cutter: one tick of the beam. Staying on the same zombie heats it up. */
  private plasmaBeam(x: number, y: number, a: number, dmg: number, range: number, ghost: boolean) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    let len = this.rayWall(x, y, a, range);
    let hit: Zombie | null = null;
    for (const z of this.zombies) {
      if (z.dead || offLimits(z)) continue;
      const t = (z.x - x) * c + (z.y - y) * s;
      // Reaches back to the shooter's body, so zombies in your face still get cut.
      if (t < -44 || t > len + z.r) continue;
      const off = Math.abs((z.y - y) * c - (z.x - x) * s);
      if (off > z.r + 5) continue;
      const at = Math.max(0, t - Math.sqrt(Math.max(0, (z.r + 5) ** 2 - off * off)));
      if (at < len) {
        len = at;
        hit = z;
      }
    }
    let barrel: Barrel | null = null;
    for (const b of this.barrels) {
      if (b.dead || b.fuse > 0) continue;
      const t = (b.x - x) * c + (b.y - y) * s;
      if (t < 0 || t > len) continue;
      if (Math.abs((b.y - y) * c - (b.x - x) * s) > 16) continue;
      len = t;
      hit = null;
      barrel = b;
    }
    const x2 = x + c * len;
    const y2 = y + s * len;
    const heat = hit && hit.id === this.heat.id ? this.heat.n : 0;
    this.beams.push({ x1: x, y1: y, x2, y2, life: 0.075, max: 0.075, color: heat > 20 ? '#fff0ff' : heat > 10 ? '#ff9aee' : '#ff5adc', width: 4 + heat * 0.12 });
    if (Math.random() < 0.8) this.spawnParticle(x2, y2, rand(-150, 150) - c * 60, rand(-150, 150) - s * 60, 0.2, rand(2, 3.5), heat > 15 ? '#ffffff' : '#ff9aee', 6, false, true);
    if (Math.random() < 0.3) this.addLight(x2, y2, 120, 0.08, '#ff5adc');
    if (ghost) return;
    this.sfx.play('plasma', 0.6);
    if (barrel) {
      barrel.hp -= dmg;
      if (barrel.hp <= 0) barrel.fuse = 0.05;
      return;
    }
    if (!hit) {
      this.heat = { id: -1, n: 0 };
      return;
    }
    if (hit.def.kind === 'shield' && Math.cos(a - hit.face) < -0.35) {
      // The riot shield soaks the beam (and glows for it).
      if (Math.random() < 0.4) this.sfx.play('clank', 0.4);
      return;
    }
    this.heat = { id: hit.id, n: Math.min(30, heat + 1) };
    const crit = Math.random() < this.stats.crit;
    this.damageZombie(hit, dmg * (1 + heat / 20) * (crit ? 2.5 : 1), a, crit, 30, !crit && heat % 4 !== 0, 0);
    if (heat === 29) this.addText(hit.x, hit.y - hit.r - 12, 'MELTDOWN', '#ffd0f4', 13);
  }

  // ---------------------------------------------------------------- Hive Lab

  /** Lab consoles: stand on one to arm a laser sweep. The host runs them; everyone draws them. */
  private updateConsoles(dt: number) {
    if (!this.consoles.length) return;
    const host = this.net !== 'client';
    const span = (c: Console) => (c.axis === 'x' ? WORLD_W : WORLD_H);
    for (const c of this.consoles) {
      if (c.phase === 'sweep') {
        // Guests roll it along between snapshots too.
        c.pos += c.dir * ((span(c) - BORDER * 2) / SWEEP_TIME) * dt;
        if (Math.random() < dt * 40) {
          const o = rand(BORDER, (c.axis === 'x' ? WORLD_H : WORLD_W) - BORDER);
          this.spawnParticle(c.axis === 'x' ? c.pos : o, c.axis === 'x' ? o : c.pos, rand(-80, 80), rand(-80, 80), 0.25, 3, '#ff3a5a', 4, false, true);
        }
      }
      if (!host) continue;
      if (c.phase === 'idle') {
        if (c.cd > 0) c.cd -= dt;
        const on = this.power.out <= 0 && c.cd <= 0 && this.state === 'playing';
        const standing = on && this.targets().some((t) => !(t as Ally).down && Math.hypot(t.x - c.x, t.y - c.y) < CONSOLE_R);
        c.hold = standing ? c.hold + dt : Math.max(0, c.hold - dt * 2);
        if (c.hold >= 1) {
          c.hold = 0;
          c.phase = 'warn';
          c.t = 1.3;
          // The beam starts at the far side from the console and comes toward it.
          const far = c.axis === 'x' ? (c.x < WORLD_W / 2 ? WORLD_W - BORDER : BORDER) : c.y <= WORLD_H / 2 ? BORDER : WORLD_H - BORDER;
          c.pos = far;
          c.dir = far === BORDER ? 1 : -1;
          this.wsfx('alarm');
          if (!this.consoleWarned) {
            this.consoleWarned = true;
            this.showShout('LASER GRID! DASH THROUGH THE BEAM', '#ff3a5a', true);
          }
        }
      } else if (c.phase === 'warn') {
        c.t -= dt;
        if (c.t <= 0) {
          c.phase = 'sweep';
          c.hit = [];
          this.wsfx('laser');
        }
      } else if (c.phase === 'sweep') {
        const end = c.dir > 0 ? span(c) - BORDER : BORDER;
        if ((c.dir > 0 && c.pos >= end) || (c.dir < 0 && c.pos <= end)) {
          c.phase = 'idle';
          c.cd = CONSOLE_CD;
          continue;
        }
        const at = (o: { x: number; y: number }) => (c.axis === 'x' ? o.x : o.y);
        for (const z of this.zombies) {
          if (z.dead || offLimits(z) || z.latch || Math.abs(at(z) - c.pos) > 10 + z.r * 0.5) continue;
          if (isBoss(z)) {
            if (c.hit.includes(z)) continue;
            c.hit.push(z);
            this.damageZombie(z, z.maxHp * 0.06, c.axis === 'x' ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? Math.PI / 2 : -Math.PI / 2, false, 0);
            continue;
          }
          this.cause = 'laser';
          this.killZombie(z, c.axis === 'x' ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
          this.cause = '';
        }
        for (const t of this.targets()) {
          if (c.hit.includes(t) || Math.abs(at(t) - c.pos) > 10 + PLAYER_R) continue;
          c.hit.push(t);
          this.hurtPlayer(30, null, t);
        }
      }
    }
  }

  /** Lab power cuts: lamps die, consoles go offline, red emergency lights spin. */
  private updatePower(dt: number) {
    if (!this.map.powercut || this.net === 'client') {
      if (this.power.out > 0) this.power.out -= dt;
      return;
    }
    if (this.power.out > 0) {
      this.power.out -= dt;
      if (this.power.out <= 0) {
        this.power.t = rand(45, 65);
        this.wsfx('powerup');
        this.toast('💡 Power restored');
      }
      return;
    }
    this.power.t -= dt;
    if (this.power.t <= 0) this.cutPower(9);
  }

  private cutPower(secs: number) {
    this.power.out = secs;
    for (const c of this.consoles) c.hold = 0;
    this.wsfx('powerdown');
    this.showShout('POWER FAILURE!', '#ff3a3a', true);
  }

  /** Story mode: zombies chewing on the generator. */
  private hurtGen(amount: number) {
    const G = this.opS.gen;
    if (!G || amount <= 0) return;
    G.hp -= amount * 0.45; // armored casing
    G.hurt = 0.2;
    if (Math.random() < 0.5) this.spawnParticle(G.x + rand(-30, 30), G.y + rand(-20, 20), rand(-140, 140), rand(-200, -60), 0.35, 3, '#ffd23f', 4, false, true);
    if (G.hp < G.max * 0.3 && Math.random() < 0.05) this.showShout('THE GENERATOR IS FAILING!', '#ff5a4a');
  }

  private dirt(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      this.spawnParticle(x, y, Math.cos(a) * rand(60, 240), Math.sin(a) * rand(60, 240), rand(0.3, 0.6), rand(3, 7), i % 2 ? '#6a5236' : '#3a2c1e', 4, true, false);
    }
  }

  /** Tesla gun: an arc to the nearest zombie in front, chaining onward. */
  private teslaArc(x: number, y: number, angle: number, dmg: number) {
    let best: Zombie | null = null;
    let bd = 360;
    for (const z of this.zombies) {
      if (z.dead || offLimits(z)) continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d > bd) continue;
      let da = Math.atan2(z.y - y, z.x - x) - angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > 0.55) continue;
      bd = d;
      best = z;
    }
    if (!best) {
      this.bolts.push({ x1: x, y1: y, x2: x + Math.cos(angle) * 130, y2: y + Math.sin(angle) * 130, life: 0.08, color: '#8ad8ff' });
      return;
    }
    const hit: number[] = [];
    let from = { x, y };
    let cur: Zombie | null = best;
    const jumps = 4 + this.stats.ricochet * 2;
    for (let i = 0; cur && i <= jumps; i++) {
      this.bolts.push({ x1: from.x, y1: from.y, x2: cur.x, y2: cur.y, life: 0.1, color: i ? '#b8ecff' : '#ffffff' });
      hit.push(cur.id);
      const crit = Math.random() < this.stats.crit;
      from = { x: cur.x, y: cur.y };
      this.damageZombie(cur, dmg * Math.pow(0.85, i) * (crit ? 2.5 : 1), Math.atan2(cur.y - y, cur.x - x), crit, 60);
      cur = this.nearestZombie(from.x, from.y, 170, hit);
    }
  }

  private chill(z: Zombie) {
    if (z.def.kind === 'electric' || z.frozenT > 0) return;
    if (z.def.kind === 'icer') return; // already made of ice
    if (isBoss(z)) {
      // Bosses only get slowed, never frozen solid.
      z.slow = Math.max(z.slow, 0.5);
      return;
    }
    z.slow = Math.max(z.slow, 1.5);
    z.chill += 1;
    if (z.chill >= 10) {
      z.chill = 0;
      z.frozenT = 1.8;
      for (let i = 0; i < 6; i++) this.spawnParticle(z.x, z.y, rand(-80, 80), rand(-80, 80), 0.3, 3, '#dff6ff', 5, false, true);
    }
  }

  /** Screamer: buffs every zombie around it. */
  /** Medic: patches up every hurt zombie nearby. Bosses only get a little. */
  private healPulse(z: Zombie) {
    const R = 210;
    const hurt = this.zombies.filter((o) => !o.dead && o.def.kind !== 'egg' && o.hp < o.maxHp * 0.95 && Math.hypot(o.x - z.x, o.y - z.y) < R);
    if (!hurt.length) {
      z.abilityCd = 0.6;
      return;
    }
    z.abilityCd = rand(3.2, 4);
    for (const o of hurt) {
      o.hp = Math.min(o.maxHp, o.hp + o.maxHp * (isBoss(o) ? 0.02 : 0.3));
      for (let i = 0; i < 3; i++) this.spawnParticle(o.x + rand(-o.r, o.r), o.y + rand(-o.r, o.r), 0, rand(-70, -30), 0.6, 4, '#5dff7a', 1, false, true);
    }
    this.ring({ x: z.x, y: z.y, r: 10, max: R, life: 0.5, color: 'rgba(93,255,122,' });
    this.addLight(z.x, z.y, 220, 0.35, '#5dff7a');
    this.wsfx('heal');
  }

  /** Chills a player: slower (by k) for t seconds. Dashing shrugs it off. */
  private chillPlayer(who: { x: number; y: number }, t: number, k: number) {
    if (who !== this.p) {
      const a = who as Ally;
      if (!a.down) this.netSend?.(a.id, { t: 'chill', d: t, k });
      return;
    }
    if (this.dashT > 0 || this.down) return;
    if (this.chillT <= 0) {
      this.chillK = k;
      this.addText(this.p.x, this.p.y - 28, 'CHILLED!', '#bfe8ff', 14);
    } else this.chillK = Math.min(this.chillK, k);
    this.chillT = Math.max(this.chillT, t);
    for (let i = 0; i < 6; i++) this.spawnParticle(this.p.x, this.p.y, rand(-90, 90), rand(-90, 90), 0.4, 3, '#dff6ff', 3, false, true);
  }

  /** Slippery footing: the map's ice sheets and the Titan's frozen boulder splashes. */
  private onIce(x: number, y: number) {
    for (const r of this.map.ice ?? []) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
    for (const pd of this.puddles) if (pd.kind === 'ice' && (pd.x - x) ** 2 + (pd.y - y) ** 2 < pd.r * pd.r) return true;
    return false;
  }

  /** Blizzards: the Frozen Outpost runs its own cycle; the Titan can call one anywhere. The host runs the clock. */
  private updateBlizzard(dt: number) {
    const B = this.blizzard;
    if (this.net === 'client') return;
    if (!this.map.blizzard && B.phase === 'calm') return;
    B.t -= dt;
    if (B.phase === 'calm' && B.t <= 0) {
      B.phase = 'warn';
      B.t = 3;
      B.dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.35, 0.35);
      this.wsfx('wind', 0.4);
      this.showShout(this.blizzardWarned ? 'BLIZZARD!' : 'BLIZZARD INCOMING: THE WIND WILL PUSH YOU', '#e8f4ff', true);
      this.blizzardWarned = true;
    } else if (B.phase === 'warn' && B.t <= 0) {
      B.phase = 'blow';
      B.t = 7;
      this.wsfx('wind');
    } else if (B.phase === 'blow' && B.t <= 0) {
      B.phase = 'calm';
      B.t = rand(24, 32);
    }
  }

  private startBlizzard(len: number) {
    const B = this.blizzard;
    if (B.phase !== 'blow') B.dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.35, 0.35);
    B.phase = 'blow';
    B.t = Math.max(B.t, len);
    this.wsfx('wind');
  }

  /** Sticks a player in a web: half speed for a couple of seconds (dashing still works). */
  private webPlayer(who: { x: number; y: number }) {
    if (who === this.opS.gen) return;
    if (who !== this.p) {
      const a = who as Ally;
      if (!a.down) this.netSend?.(a.id, { t: 'web' });
      return;
    }
    if (this.dashT > 0 || this.down) return;
    if (this.webT <= 0) this.addText(this.p.x, this.p.y - 28, 'WEBBED!', '#e0e0ff', 14);
    this.webT = WEB_TIME;
    this.sfx.play('web');
  }

  private scream(z: Zombie) {
    z.abilityCd = rand(4.5, 6);
    const R = 300;
    this.ring({ x: z.x, y: z.y, r: 10, max: R, life: 0.6, color: 'rgba(255,90,120,' });
    this.ring({ x: z.x, y: z.y, r: 10, max: R * 0.6, life: 0.45, color: 'rgba(255,200,210,' });
    this.addLight(z.x, z.y, 220, 0.4, '#ff5a78');
    for (const o of this.zombies) {
      if (o === z || o.dead || isBoss(o) || o.def.kind === 'egg') continue;
      if (Math.hypot(o.x - z.x, o.y - z.y) < R) o.buff = 5;
    }
    this.wsfx('scream');
    this.addShake(0.15);
  }

  /** Necromancer: stands up the most recent corpses near it, or digs fresh ones out of the ground. */
  private raiseDead(z: Zombie) {
    z.abilityCd = rand(5, 6.5);
    const near = this.corpses.filter((c) => Math.hypot(c.x - z.x, c.y - z.y) < 420).slice(-4);
    const spots = near.length ? near : [0, 1].map(() => ({ x: z.x + rand(-90, 90), y: z.y + rand(-90, 90) }));
    this.corpses = this.corpses.filter((c) => !near.includes(c));
    for (const c of spots) {
      if (this.pointInWall(c.x, c.y)) continue;
      const r = this.spawnZombie('walker', c.x, c.y);
      r.flash = 0.3;
      for (let i = 0; i < 8; i++) this.spawnParticle(c.x, c.y, rand(-40, 40), rand(-120, -30), rand(0.4, 0.7), rand(3, 6), '#5dffb0', 2, false, true);
      // A beam from the necromancer to each raised corpse.
      for (let t = 0.1; t < 1; t += 0.12) this.spawnParticle(z.x + (c.x - z.x) * t, z.y + (c.y - z.y) * t, 0, 0, 0.35, 4, '#5dffb0', 1, false, true);
    }
    this.ring({ x: z.x, y: z.y, r: 0, max: 90, life: 0.45, color: 'rgba(93,255,176,' });
    this.addLight(z.x, z.y, 200, 0.4, '#5dffb0');
    this.wsfx('raise');
  }

  /** Hurts the local player, or (on the co-op host) tells a guest it got hurt. */
  private hurtPlayer(amount: number, from: { x: number; y: number } | null, who: { x: number; y: number } = this.p, knock?: { x: number; y: number }) {
    if (who === this.opS.gen) {
      this.hurtGen(amount);
      return;
    }
    if (who !== this.p) {
      const a = who as Ally;
      if (a.down || amount <= 0) return;
      this.netSend?.(a.id, { t: 'hurt', a: Math.round(amount * 10) / 10, x: from ? Math.round(from.x) : null, y: from ? Math.round(from.y) : null, kx: knock ? Math.round(knock.x) : 0, ky: knock ? Math.round(knock.y) : 0 });
      return;
    }
    if (this.dashT > 0 || this.invT > 0 || this.down || this.state !== 'playing' || amount <= 0) return;
    if (knock) {
      this.p.vx += knock.x;
      this.p.vy += knock.y;
    }
    const dmg = amount * (1 - this.armor);
    this.p.hp -= dmg;
    this.report.hitsTaken++;
    this.hitThisWave = true;
    this.hurtFlash = 0.25;
    this.addShake(0.45);
    this.sfx.play('hurt');
    this.addText(this.p.x, this.p.y - 24, `-${Math.round(dmg)}`, '#ff5a4e', 16);
    for (let i = 0; i < 6; i++) this.spawnBlood(this.p.x, this.p.y, rand(0, Math.PI * 2), '#b0201a');
    this.buzz(35);
    if (from) {
      const a = Math.atan2(this.p.y - from.y, this.p.x - from.x);
      this.p.vx += Math.cos(a) * 160;
      this.p.vy += Math.sin(a) * 160;
    }
    if (this.stats.nova > 0 && this.novaCd <= 0) {
      this.novaCd = 3;
      const radius = 130 + 40 * this.stats.nova;
      this.ring({ x: this.p.x, y: this.p.y, r: 0, max: radius, life: 0.4, color: 'rgba(120,200,255,' });
      this.addLight(this.p.x, this.p.y, radius * 1.5, 0.3, '#78c8ff');
      for (const z of this.zombies) {
        const d = Math.hypot(z.x - this.p.x, z.y - this.p.y);
        if (d < radius + z.r) {
          const a = Math.atan2(z.y - this.p.y, z.x - this.p.x);
          this.damageZombie(z, 35 * this.stats.nova * this.stats.damage, a, false, 900);
        }
      }
    }
    if (this.p.hp <= 0) this.gameOver();
  }

  private gameOver() {
    if (this.awaitingRevive || this.state !== 'playing') return;
    if (this.reviveLeft > 0) {
      // Second Wind: get back up and blast everything nearby away.
      this.reviveLeft--;
      this.standUp('SECOND WIND');
      return;
    }
    if (!this.net && this.mode !== 'hardcore' && !this.reviveOffered && this.hooks.onReviveOffer) {
      // One more chance per run: freeze the moment of death and let the player choose.
      this.reviveOffered = true;
      this.awaitingRevive = true;
      this.p.hp = 0;
      this.state = 'paused';
      this.addShake(0.6);
      this.flash = { t: 0.4, color: '#a00000', max: 0.4 };
      this.input.reset();
      this.hooks.onReviveOffer();
      return;
    }
    if (this.net && (this.net === 'client' || this.allies.some((a) => !a.down))) {
      // Co-op: go down and wait for a teammate. The host calls it when the whole squad is down.
      this.p.hp = 0;
      this.down = true;
      this.reviveProg = 0;
      this.hurtFlash = 0;
      this.addShake(0.8);
      this.flash = { t: 0.4, color: '#a00000', max: 0.4 };
      for (let i = 0; i < 20; i++) this.spawnBlood(this.p.x, this.p.y, rand(0, Math.PI * 2), '#a0201a', 1.3);
      this.showBanner("YOU'RE DOWN", 'A TEAMMATE CAN REVIVE YOU', '#ff5a4a');
      this.sfx.play('hurt');
      this.buzz([60, 40, 120]);
      if (this.net === 'host') this.netEvent('down', this.myId);
      return;
    }
    this.endRun();
  }

  private standUp(title: string) {
    this.report.revives++;
    this.p.hp = this.stats.maxHp * 0.5;
    this.slowT = 1.2;
    this.invT = Math.max(this.invT, 1.5);
    this.flash = { t: 0.6, color: '#ffffff', max: 0.6 };
    this.showBanner(title, 'GET BACK UP', '#5dff7a');
    this.explode(this.p.x, this.p.y, 300 * this.stats.damage, 280, 0);
    this.sfx.play('power');
  }

  /** Back into the fight from the revive offer (after an ad, a token or diamonds). */
  reviveNow() {
    if (!this.awaitingRevive) return;
    this.awaitingRevive = false;
    this.state = 'playing';
    this.input.reset();
    this.standUp('REVIVED');
  }

  /** The run is over for good: everyone down, or solo death. */
  endRun() {
    this.awaitingRevive = false;
    if (this.state === 'over') return;
    if (this.net === 'host') this.netSend?.(null, { t: 'over' });
    this.p.hp = 0;
    this.down = false;
    this.state = 'over';
    this.addShake(1);
    this.flash = { t: 0.5, color: '#a00000', max: 0.5 };
    for (let i = 0; i < 40; i++) this.spawnBlood(this.p.x, this.p.y, rand(0, Math.PI * 2), '#a0201a', 1.5);
    this.input.reset();
    this.hooks.onGameOver(this.summary());
  }

  /** Snapshot of the run so far, for the game-over screen, missions and the share card. */
  summary(): RunSummary {
    this.report.wave = this.wave;
    this.report.kills = this.kills;
    this.report.bestCombo = this.bestCombo;
    this.report.time = this.runTime;
    const perks: string[] = [];
    for (const perk of PERKS) for (let i = 0; i < (this.perkCounts.get(perk.id) ?? 0); i++) perks.push(perk.icon);
    return { wave: this.wave, kills: this.kills, cash: Math.round(this.earned), time: this.runTime, bestCombo: this.bestCombo, report: { ...this.report }, perks, weapons: this.weapons.map((w) => w.def.name) };
  }

  private gainBrains(n: number, x?: number, y?: number) {
    this.report.brains += n;
    this.brainsPulse = 0.25;
    if (x !== undefined && y !== undefined) this.addText(x, y, `+${n} 🧠`, '#ff8ad8', 15);
  }

  private updateBullets(dt: number) {
    const out: Bullet[] = [];
    for (const b of this.bullets) {
      if (b.kind === 'flame' || b.kind === 'frost') {
        const k = Math.exp(-dt * 2.5);
        b.vx *= k;
        b.vy *= k;
      }
      if (b.boomerang) {
        if (!b.back && b.life <= dt) this.turnBack(b);
        if (b.back && !b.ghost) {
          // Homes back to your hand; caught when it reaches you.
          const dx = this.p.x - b.x;
          const dy = this.p.y - b.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < 26) {
            this.sfx.play('catch', 0.5);
            continue;
          }
          const sp = Math.min(980, Math.hypot(b.vx, b.vy) + 1600 * dt);
          const k = 1 - Math.exp(-dt * 10);
          b.vx += ((dx / d) * sp - b.vx) * k;
          b.vy += ((dy / d) * sp - b.vy) * k;
        }
      }
      if (b.homing) {
        const t = this.nearestZombie(b.x, b.y, 520);
        if (t) {
          const want = Math.atan2(t.y - b.y, t.x - b.x);
          const cur = Math.atan2(b.vy, b.vx);
          let da = want - cur;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          const turn = clamp(da, -7 * dt, 7 * dt);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(cur + turn) * sp;
          b.vy = Math.sin(cur + turn) * sp;
        }
      }
      if (b.kind === 'rocket') {
        this.spawnParticle(b.x, b.y, rand(-30, 30), rand(-30, 30), 0.7, b.homing ? 4 : 6, 'rgba(170,170,170,0.3)', 2, false, false, b.homing ? 10 : 18);
        if (Math.random() < 0.7) this.spawnParticle(b.x, b.y, -b.vx * 0.2, -b.vy * 0.2, 0.12, 6, '#ffb347', 6, false, true);
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) {
        if (b.kind === 'rocket' && !b.ghost) this.explode(b.x, b.y, b.dmg, b.blast ?? 115, 0);
        if (b.goo) this.addGoo(b.x, b.y, b.dmg, b.ghost);
        continue;
      }
      if (b.boomerang && this.pointInWall(b.x, b.y)) {
        // Glaives bounce straight back off walls, and fly home through them.
        if (!b.back) {
          b.x -= b.vx * dt;
          b.y -= b.vy * dt;
          this.turnBack(b);
          if (!b.ghost) this.sfx.play('clank', 0.4);
        }
        out.push(b);
        continue;
      }
      if (this.pointInWall(b.x, b.y) && b.bounce && b.bounce > 0) {
        // Saw disc: bounce off the wall instead of breaking.
        b.bounce--;
        if (this.pointInWall(b.x - b.vx * dt, b.y)) b.vy = -b.vy;
        else b.vx = -b.vx;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.hits = [];
        for (let i = 0; i < 4; i++) this.spawnParticle(b.x, b.y, rand(-160, 160), rand(-160, 160), 0.15, 2.5, '#fff2b0', 6, false, true);
        if (!b.ghost) this.sfx.play('clank', 0.5);
      }
      if (this.pointInWall(b.x, b.y)) {
        if (b.kind === 'rocket' && !b.ghost) this.explode(b.x - b.vx * dt, b.y - b.vy * dt, b.dmg, b.blast ?? 115, 0);
        if (b.goo) this.addGoo(b.x - b.vx * dt * 2, b.y - b.vy * dt * 2, b.dmg, b.ghost);
        else if (b.kind === 'bullet') for (let i = 0; i < 3; i++) this.spawnParticle(b.x - b.vx * dt, b.y - b.vy * dt, rand(-120, 120), rand(-120, 120), 0.15, 2, '#ffd27a', 6, false, true);
        continue;
      }
      if (b.ghost) {
        // A teammate's shot: stops on the first zombie, their game does the damage.
        if (b.kind === 'flame' || b.kind === 'frost' || b.boomerang || !this.zombies.some((z) => !z.dead && !offLimits(z) && (z.x - b.x) ** 2 + (z.y - b.y) ** 2 < (z.r + 4) ** 2)) out.push(b);
        else if (b.goo) this.addGoo(b.x, b.y, 0, true);
        continue;
      }
      // Barrels
      let alive = true;
      for (const br of this.barrels) {
        if (br.dead || br.fuse > 0) continue;
        if (Math.hypot(br.x - b.x, br.y - b.y) < (br.big ? 22 : 16)) {
          if (b.kind === 'rocket') {
            this.explode(b.x, b.y, b.dmg, b.blast ?? 115, 0);
            alive = false;
            break;
          }
          const bd = b.kind === 'flame' ? 3 : b.kind === 'frost' ? 0 : b.dmg;
          br.hp -= bd;
          if (this.net === 'client' && bd > 0) this.netSend?.(null, { t: 'bar', i: this.barrels.indexOf(br), d: Math.round(bd) });
          this.spawnParticle(b.x, b.y, rand(-80, 80), rand(-80, 80), 0.15, 2, '#ffd27a', 6, false, true);
          if (br.hp <= 0) br.fuse = 0.05;
          if (b.kind === 'bullet') {
            alive = false;
            break;
          }
        }
      }
      if (!alive) continue;
      for (const z of this.zombies) {
        if (z.dead || b.hits.includes(z.id) || offLimits(z) || z.latch) continue;
        const dx = z.x - b.x;
        const dy = z.y - b.y;
        const rr = z.r + (b.kind === 'flame' || b.kind === 'frost' ? 10 : 4);
        if (dx * dx + dy * dy > rr * rr) continue;
        if (b.kind === 'rocket') {
          this.explode(b.x, b.y, b.dmg, b.blast ?? 115, 0);
          alive = false;
          break;
        }
        b.hits.push(z.id);
        if (b.charm) {
          if (this.net !== 'client') this.addPsi(z);
          this.damageZombie(z, b.dmg, Math.atan2(b.vy, b.vx), false, 30, false, 16);
          for (let i = 0; i < 5; i++) this.spawnParticle(b.x, b.y, rand(-120, 120), rand(-120, 120), 0.25, 3, '#e0b0ff', 5, false, true);
          alive = false;
          break;
        }
        if (b.goo) {
          this.damageZombie(z, b.dmg, Math.atan2(b.vy, b.vx), false, 60);
          this.addGoo(b.x, b.y, b.dmg);
          alive = false;
          break;
        }
        if (z.def.kind === 'shield' && b.kind === 'bullet' && Math.cos(Math.atan2(b.vy, b.vx) - z.face) < -0.35) {
          // Bullet hit the riot shield: sparks, a clank, and it stops dead.
          for (let i = 0; i < 4; i++) this.spawnParticle(b.x, b.y, rand(-160, 160), rand(-160, 160), 0.15, 2.5, '#fff2b0', 6, false, true);
          z.kx -= Math.cos(z.face) * 10;
          z.ky -= Math.sin(z.face) * 10;
          this.sfx.play('clank');
          if (Math.random() < 0.08) this.addText(z.x, z.y - z.r - 6, 'BLOCKED', '#c9d1d8', 11);
          alive = false;
          break;
        }
        let dmg = b.dmg;
        const crit = b.kind === 'bullet' && Math.random() < this.stats.crit;
        if (crit) dmg *= 2.5;
        if (b.kind === 'frost') {
          if (this.net !== 'client') this.chill(z);
          this.damageZombie(z, dmg, Math.atan2(b.vy, b.vx), false, 10, true, 8);
          continue;
        }
        if (b.kind === 'flame') {
          if (this.net !== 'client') z.burn = 2.5;
          this.damageZombie(z, dmg, Math.atan2(b.vy, b.vx), false, 20, true, 4);
          continue;
        }
        this.damageZombie(z, dmg, Math.atan2(b.vy, b.vx), crit, b.harpoon ? 620 : b.boomerang ? 70 : 140);
        if (b.canExplode && Math.random() < this.stats.explode) this.explode(b.x, b.y, b.dmg * 1.4, 80, 0);
        if (b.pierce > 0) {
          b.pierce--;
        } else if (b.ricochet > 0) {
          b.ricochet--;
          const t = this.nearestZombie(b.x, b.y, 380, b.hits);
          if (t) {
            const a = Math.atan2(t.y - b.y, t.x - b.x);
            const sp = Math.hypot(b.vx, b.vy);
            b.vx = Math.cos(a) * sp;
            b.vy = Math.sin(a) * sp;
            b.life = Math.max(b.life, 0.4);
          } else alive = false;
        } else alive = false;
        break;
      }
      if (alive) out.push(b);
    }
    this.bullets = out;
  }

  /** A glaive at the end of its throw: turn around and cut through everything again. */
  private turnBack(b: Bullet) {
    b.back = true;
    b.hits = [];
    if (b.ghost) {
      b.vx = -b.vx;
      b.vy = -b.vy;
      b.life = b.max;
    } else b.life = 2.5;
  }

  private updateGrenades(dt: number) {
    const keep: Grenade[] = [];
    for (const g of this.grenades) {
      g.fuse -= dt;
      g.vz -= 900 * dt;
      g.z += g.vz * dt;
      if (g.z <= 0) {
        g.z = 0;
        g.vz = Math.abs(g.vz) * 0.4;
        g.vx *= 0.6;
        g.vy *= 0.6;
      }
      const ox = g.x;
      const oy = g.y;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      let boom = g.fuse <= 0;
      if (this.pointInWall(g.x, g.y)) {
        g.x = ox;
        g.y = oy;
        g.vx *= -0.5;
        g.vy *= -0.5;
        if (g.impact) boom = true;
      }
      if (g.impact && !boom) for (const z of this.zombies) if (!z.dead && !offLimits(z) && Math.hypot(z.x - g.x, z.y - g.y) < z.r + 6) boom = true;
      if (boom) {
        if (g.remote) continue;
        if (g.vortex) {
          this.vortexes.push({ x: g.x, y: g.y, t: 1.5, max: 1.5, dmg: g.dmg ?? 170, tick: 0 });
          this.sfx.play('vortex');
          this.addShake(0.2);
          continue;
        }
        this.nadeBlast = true;
        this.explode(g.x, g.y, g.dmg ?? 170 * this.stats.damage, g.radius ?? 135, g.bomblet ? 3 : g.impact ? 8 : 18);
        this.nadeBlast = false;
        if (g.cluster) {
          // Six bomblets scatter and go off a moment later.
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + rand(-0.3, 0.3);
            const sp = rand(170, 300);
            keep.push({ x: g.x, y: g.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, z: 6, vz: rand(180, 260), fuse: rand(0.35, 0.6), dmg: (g.dmg ?? 85) * 0.45, radius: 72, bomblet: true });
          }
          this.sfx.play('cluster', 0.6);
        }
        continue;
      }
      keep.push(g);
    }
    this.grenades = keep;
  }

  private updateHazards(dt: number) {
    const p = this.p;
    const client = this.net === 'client';
    // Acid spit (guests only see it fly: the host decides who it hits)
    const spits: Spit[] = [];
    const ts = client ? [] : this.targets();
    for (const s of this.spits) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (Math.random() < 0.5) this.spawnParticle(s.x, s.y, rand(-20, 20), rand(-20, 20), 0.3, 4, s.soul ? '#7affea' : s.web ? '#e0e0ff' : s.shard ? '#dff6ff' : '#b04aff', 4, false, true);
      const hit = ts.find((t) => Math.hypot(s.x - t.x, s.y - t.y) < PLAYER_R + 8);
      if (hit) {
        if (s.web) {
          this.hurtPlayer(4 * (1 + 0.04 * this.wave), null, hit);
          this.webPlayer(hit);
          continue;
        }
        if (s.shard) {
          this.hurtPlayer(7 * (1 + 0.04 * this.wave), s, hit);
          this.chillPlayer(hit, 1.2, 0.6);
          continue;
        }
        this.hurtPlayer(10 * (1 + 0.04 * this.wave), s, hit);
        if (!s.soul) this.puddles.push({ x: s.x, y: s.y, r: 34, life: 2.5, max: 2.5, kind: 'acid' });
        continue;
      }
      if (s.life <= 0 || this.pointInWall(s.x, s.y)) {
        if (!client && !s.soul && !s.web && !s.shard) {
          this.puddles.push({ x: s.x, y: s.y, r: 40, life: 3.5, max: 3.5, kind: 'acid' });
          this.wsfx('splat', 0.4);
        }
        continue;
      }
      spits.push(s);
    }
    this.spits = spits;
    // Puddles hurt over time (each player checks their own feet)
    let dps = 0;
    this.puddles = this.puddles.filter((pd) => {
      pd.life -= dt;
      if (Math.hypot(pd.x - p.x, pd.y - p.y) < pd.r + PLAYER_R * 0.5) dps = Math.max(dps, pd.kind === 'acid' ? 14 : pd.kind === 'sludge' ? 11 + 0.25 * this.wave : 12);
      return pd.life > 0;
    });
    if (dps > 0 && this.dashT <= 0 && this.invT <= 0 && !this.down) {
      p.hp -= dps * dt * (1 - this.armor);
      this.hurtFlash = Math.max(this.hurtFlash, 0.08);
      if (p.hp <= 0) this.gameOver();
    }
    this.updateGoo(dt);
    this.updateVortexes(dt);
    this.updateNovas(dt, client);
    if (client) {
      for (const m of this.mortars) m.t -= dt;
      this.mortars = this.mortars.filter((m) => m.t > 0);
      return;
    }
    this.updateMortars(dt);
    // Barrels with a lit fuse go off (this is how chain reactions ripple).
    for (const b of this.barrels) {
      if (b.dead || b.fuse <= 0) continue;
      b.fuse -= dt;
      if (b.fuse <= 0) {
        b.dead = true;
        if (b.big) {
          // Fuel pump: a fireball that clears the whole forecourt.
          this.explode(b.x, b.y, 450 * this.stats.damage, 230, 40, true);
          this.flash = { t: 0.3, color: '#ffb050', max: 0.3 };
          this.slowT = Math.max(this.slowT, 0.4);
        } else this.explode(b.x, b.y, 240 * this.stats.damage, 150, 30, true);
      }
    }
  }

  /** Acid Cannon pools: tick damage on every zombie standing in them. */
  private updateGoo(dt: number) {
    this.goos = this.goos.filter((g) => {
      g.life -= dt;
      if (Math.random() < dt * 8) this.spawnParticle(g.x + rand(-g.r, g.r) * 0.6, g.y + rand(-g.r, g.r) * 0.6, 0, rand(-40, -10), 0.4, 3, '#9aff3a', 1, false, true);
      if (g.ghost) return g.life > 0;
      g.tick -= dt;
      if (g.tick <= 0) {
        g.tick = 0.25;
        for (const z of this.zombies) {
          if (z.dead || Math.hypot(z.x - g.x, z.y - g.y) > g.r + z.r * 0.5) continue;
          this.damageZombie(z, g.dps * 0.25, rand(0, Math.PI * 2), false, 0, true);
        }
      }
      return g.life > 0;
    });
  }

  private addGoo(x: number, y: number, dmg: number, ghost = false) {
    if (this.pointInWall(x, y)) return;
    if (this.goos.length > 40) this.goos.shift();
    this.goos.push({ x, y, r: 46, life: 2.6, max: 2.6, dps: dmg * 0.9, tick: 0.1, ghost });
    for (let i = 0; i < 6; i++) this.spawnParticle(x, y, rand(-140, 140), rand(-140, 140), 0.3, rand(3, 5), '#b6ff5a', 5, false, true);
    if (!ghost) this.sfx.play('splat', 0.35);
  }

  /** Singularity black holes: pull everything in, chew on it, then pop. */
  private updateVortexes(dt: number) {
    const keep: Vortex[] = [];
    for (const v of this.vortexes) {
      v.t -= dt;
      for (let i = 0; i < 3; i++) {
        const a = rand(0, Math.PI * 2);
        const r = rand(80, VORTEX_R);
        this.spawnParticle(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r, -Math.cos(a) * r * 2.4 + Math.cos(a + 1.57) * 120, -Math.sin(a) * r * 2.4 + Math.sin(a + 1.57) * 120, 0.35, rand(2, 4), i ? '#c08aff' : '#ffffff', 1, false, true);
      }
      this.addLight(v.x, v.y, 200, 0.05, '#a060ff');
      if (v.remote) {
        if (v.t > 0) keep.push(v);
        continue;
      }
      v.tick -= dt;
      if (v.tick <= 0) {
        v.tick = 0.1;
        for (const z of this.zombies) {
          if (z.dead) continue;
          const d = Math.hypot(z.x - v.x, z.y - v.y);
          if (d > VORTEX_R + z.r || d < 8) continue;
          this.damageZombie(z, v.dmg * 0.035, Math.atan2(v.y - z.y, v.x - z.x), false, 150 * (1 - (d / VORTEX_R) * 0.5), true);
        }
      }
      if (v.t <= 0) {
        this.explode(v.x, v.y, v.dmg, 150, 0);
        this.flash = { t: 0.15, color: '#c08aff', max: 0.2 };
        continue;
      }
      keep.push(v);
    }
    this.vortexes = keep;
  }

  /** The Frost Titan's nova rings roll outward; the host decides who they catch. */
  private updateNovas(dt: number, client: boolean) {
    const ts = client ? [] : this.targets();
    this.novas = this.novas.filter((n) => {
      n.r += 520 * dt;
      for (let i = 0; i < 4; i++) {
        const a = rand(0, Math.PI * 2);
        this.spawnParticle(n.x + Math.cos(a) * n.r, n.y + Math.sin(a) * n.r, Math.cos(a) * 60, Math.sin(a) * 60, 0.3, rand(3, 5), '#dff6ff', 2, false, true);
      }
      for (const t of ts) {
        if (n.hit.includes(t) || Math.abs(Math.hypot(t.x - n.x, t.y - n.y) - n.r) > NOVA_W + PLAYER_R * 0.5) continue;
        n.hit.push(t);
        this.hurtPlayer(16 * (1 + 0.03 * this.wave), null, t);
        this.chillPlayer(t, 2.4, 0.45);
      }
      return n.r < n.max;
    });
  }

  /** Host: the Sludge King's globs land, hurting players and leaving sludge. */
  private updateMortars(dt: number) {
    const keep: Mortar[] = [];
    for (const m of this.mortars) {
      m.t -= dt;
      if (m.t > 0) {
        keep.push(m);
        continue;
      }
      if (m.ice) {
        // An ice boulder: a crunch, flying chunks and a slippery sheet of ice left behind.
        this.puddles.push({ x: m.x, y: m.y, r: 90, life: 7, max: 7, kind: 'ice' });
        this.ring({ x: m.x, y: m.y, r: 10, max: BOULDER_R, life: 0.35, color: 'rgba(200,236,255,' });
        for (const t of this.targets())
          if (Math.hypot(t.x - m.x, t.y - m.y) < BOULDER_R + PLAYER_R * 0.5) {
            this.hurtPlayer(22 * (1 + 0.03 * this.wave), m, t);
            this.chillPlayer(t, 1.2, 0.6);
          }
        this.wsfx('boulder', 0.7);
        this.netEvent('ib', Math.round(m.x), Math.round(m.y));
        this.iceBurst(m.x, m.y);
        this.addShake(0.3);
        continue;
      }
      this.puddles.push({ x: m.x, y: m.y, r: 56, life: 4, max: 4, kind: 'sludge' });
      this.ring({ x: m.x, y: m.y, r: 10, max: MORTAR_R, life: 0.3, color: 'rgba(200,255,60,' });
      for (const t of this.targets()) if (Math.hypot(t.x - m.x, t.y - m.y) < MORTAR_R + PLAYER_R * 0.5) this.hurtPlayer(18 * (1 + 0.03 * this.wave), m, t);
      this.wsfx('splat', 0.5);
    }
    this.mortars = keep;
  }

  private iceBurst(x: number, y: number) {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      this.spawnParticle(x, y, Math.cos(a) * rand(120, 320), Math.sin(a) * rand(120, 320), rand(0.4, 0.7), rand(4, 9), i % 2 ? '#dff6ff' : '#8fb8d0', 5, true, false);
    }
  }

  /** Refinery steam vents. The host runs the timers; everyone draws the steam. */
  private updateVents(dt: number) {
    const host = this.net !== 'client';
    for (const v of this.vents) {
      if (v.phase === 'warn' && Math.random() < dt * 20) this.spawnParticle(v.x + rand(-20, 20), v.y + rand(-20, 20), rand(-20, 20), rand(-90, -40), 0.5, rand(6, 10), 'rgba(220,220,220,0.25)', 2, false, false, 16);
      if (v.phase === 'blast') {
        if (Math.random() < dt * 30) this.spawnParticle(v.x + rand(-30, 30), v.y + rand(-30, 30), rand(-60, 60), rand(-200, -100), rand(0.3, 0.5), rand(6, 10), 'rgba(235,240,240,0.18)', 1.5, false, false, 18);
        this.addLight(v.x, v.y, 180, 0.05, '#e8f4ff');
      }
      if (!host) continue;
      v.t -= dt;
      if (v.phase === 'idle' && v.t <= 0) {
        v.phase = 'warn';
        v.t = 1.3;
        this.wsfx('hiss', 0.6);
        if (!this.ventWarned) {
          this.ventWarned = true;
          this.showShout('STEAM VENTS: GET OFF THE GRATES!', '#e8f4ff', true);
        }
      } else if (v.phase === 'warn' && v.t <= 0) {
        v.phase = 'blast';
        v.t = 0.8;
        v.hit = [];
        this.wsfx('vent', 0.8);
      } else if (v.phase === 'blast') {
        for (const z of this.zombies) {
          if (z.dead || intangible(z) || Math.hypot(z.x - v.x, z.y - v.y) > VENT_R + z.r * 0.5) continue;
          if (isBoss(z)) {
            if (v.hit.includes(z)) continue;
            v.hit.push(z);
            this.damageZombie(z, z.maxHp * 0.04, rand(0, Math.PI * 2), false, 0);
            continue;
          }
          this.cause = 'vent';
          this.damageZombie(z, (260 + 12 * this.wave) * dt, rand(0, Math.PI * 2), false, 0, true);
          z.burn = Math.max(z.burn, 0.5);
          this.cause = '';
        }
        for (const t of this.targets()) {
          if (v.hit.includes(t) || Math.hypot(t.x - v.x, t.y - v.y) > VENT_R + PLAYER_R * 0.5) continue;
          v.hit.push(t);
          const a = Math.atan2(t.y - v.y, t.x - v.x);
          this.hurtPlayer(28 * (1 + 0.02 * this.wave), null, t, { x: Math.cos(a) * 600, y: Math.sin(a) * 600 });
        }
        if (v.t <= 0) {
          v.phase = 'idle';
          v.t = rand(5, 9);
        }
      }
    }
  }

  private updateTrains(dt: number) {
    for (const tr of this.trains) {
      if (this.net === 'client') {
        // Guests just roll the host's trains along between snapshots.
        if (tr.phase === 'go') tr.x += tr.dir * TRAIN_SPEED * dt;
        continue;
      }
      tr.t -= dt;
      if (tr.phase === 'idle' && tr.t <= 0) {
        tr.phase = 'warn';
        tr.t = 2.2;
        this.wsfx('horn');
        if (!this.trainWarned) {
          this.trainWarned = true;
          this.showShout('TRAIN INCOMING!', '#ff5a4a', true);
        }
      } else if (tr.phase === 'warn' && tr.t <= 0) {
        tr.phase = 'go';
        tr.x = tr.dir > 0 ? -TRAIN_LEN - 100 : WORLD_W + 100;
        tr.hitPlayer = false;
        tr.hitBoss = [];
        this.wsfx('train');
        this.addShake(0.3);
      } else if (tr.phase === 'go') {
        tr.x += tr.dir * TRAIN_SPEED * dt;
        if ((tr.dir > 0 && tr.x > WORLD_W + 100) || (tr.dir < 0 && tr.x + TRAIN_LEN < -100)) {
          tr.phase = 'idle';
          tr.t = rand(11, 17);
          continue;
        }
        const x0 = tr.x;
        const x1 = tr.x + TRAIN_LEN;
        const front = tr.dir > 0 ? x1 : x0;
        this.addLight(front, tr.y, 260, 0.06, '#fff2c0');
        for (const z of this.zombies) {
          if (z.dead || Math.abs(z.y - tr.y) > 48 + z.r || z.x < x0 || z.x > x1) continue;
          if (isBoss(z)) {
            if (tr.hitBoss.includes(z.id)) continue;
            tr.hitBoss.push(z.id);
            this.damageZombie(z, z.maxHp * 0.12, tr.dir > 0 ? 0 : Math.PI, false, 0);
          } else {
            this.cause = 'train';
            this.killZombie(z, tr.dir > 0 ? rand(-0.5, 0.5) : Math.PI + rand(-0.5, 0.5));
            this.cause = '';
          }
        }
        for (const p of this.targets()) {
          if (Math.abs(p.y - tr.y) >= 48 + PLAYER_R || p.x <= x0 || p.x >= x1) continue;
          if (p === this.p) {
            if (tr.hitPlayer || this.dashT > 0) continue;
            tr.hitPlayer = true;
          } else {
            const a = p as Ally;
            if (tr.hitBoss.includes(-1 - this.allies.indexOf(a))) continue;
            tr.hitBoss.push(-1 - this.allies.indexOf(a));
          }
          this.hurtPlayer(55, null, p, { x: tr.dir * 500, y: (p.y < tr.y ? -1 : 1) * 900 });
        }
      }
    }
  }

  private drawTrains() {
    const ctx = this.ctx;
    for (const tr of this.trains) {
      if (tr.phase === 'warn') {
        const on = Math.floor(this.clock * 6) % 2 === 0;
        ctx.fillStyle = `rgba(255,40,40,${on ? 0.18 : 0.08})`;
        ctx.fillRect(BORDER, tr.y - 50, WORLD_W - BORDER * 2, 100);
        for (const x of [BORDER + 20, WORLD_W - BORDER - 20]) {
          ctx.fillStyle = on ? '#ff3030' : '#501010';
          ctx.beginPath();
          ctx.arc(x, tr.y - 60, 9, 0, Math.PI * 2);
          ctx.fill();
          if (on) this.addLight(x, tr.y - 60, 140, 0.05, '#ff3030');
        }
      }
      if (tr.phase !== 'go') continue;
      const cars = 4;
      const carLen = TRAIN_LEN / cars;
      for (let i = 0; i < cars; i++) {
        const x = tr.x + i * carLen;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(x + 6, tr.y - 40, carLen - 8, 92);
        ctx.fillStyle = '#b8bec6';
        ctx.fillRect(x, tr.y - 46, carLen - 10, 92);
        ctx.fillStyle = '#2a5ab8';
        ctx.fillRect(x, tr.y - 6, carLen - 10, 12);
        ctx.fillStyle = '#1b2633';
        for (let wx = x + 18; wx < x + carLen - 40; wx += 44) {
          ctx.fillRect(wx, tr.y - 36, 26, 18);
          ctx.fillRect(wx, tr.y + 18, 26, 18);
        }
      }
      const front = tr.dir > 0 ? tr.x + TRAIN_LEN - 10 : tr.x;
      ctx.fillStyle = '#fff6c0';
      ctx.fillRect(front - (tr.dir > 0 ? 6 : 0), tr.y - 36, 6, 14);
      ctx.fillRect(front - (tr.dir > 0 ? 6 : 0), tr.y + 22, 6, 14);
    }
  }

  private nearestZombie(x: number, y: number, range: number, exclude: number[] = []): Zombie | null {
    let best: Zombie | null = null;
    let bd = range;
    for (const z of this.zombies) {
      if (z.dead || exclude.includes(z.id) || offLimits(z) || z.lurk) continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  private damageZombie(z: Zombie, dmg: number, angle: number, crit: boolean, knock: number, quiet = false, fx = 0) {
    if (z.dead || intangible(z) || z.charm > 0) return;
    if (z.zero && z.zero.trans > 0) {
      if (!quiet && Math.random() < 0.1) this.addText(z.x, z.y - z.r - 10, 'IMMUNE', '#ff9aee', 12);
      return;
    }
    z.regenT = 0;
    if (this.net === 'client') {
      this.netHit(z, dmg, angle, crit, knock, quiet, fx);
      return;
    }
    if (z.lurk) this.wakeMimic(z);
    // Mother Brood is shielded by her eggs.
    if (z.def.kind === 'brood' && this.countKind('egg') > 0) dmg *= 0.25;
    // Fire melts ice.
    if (fx & 4 && (z.def.kind === 'titan' || z.def.kind === 'icer')) dmg *= 1.6;
    if ((z.stun ?? 0) > 0) dmg *= 1.5;
    // A harpoon-strength shove: slam them into a wall soon and it hurts.
    if (knock >= 500 && !isBoss(z)) {
      z.pin = 0.7;
      z.pinDmg = dmg * 0.8;
    }
    if (z.def.kind === 'juggernaut') {
      // Armored front, glowing weak spot on the back.
      const c = Math.cos(angle - z.face);
      if (c < -0.3) dmg *= 0.2;
      else if (c > 0.5) {
        dmg *= 1.6;
        if (!quiet && Math.random() < 0.15) this.addText(z.x, z.y - z.r - 10, 'WEAK SPOT!', '#ffd23f', 14);
      }
    }
    if (z.plates > 0) {
      z.plateHp -= dmg;
      dmg *= 0.3;
      if (z.plateHp <= 0) {
        z.plates--;
        z.plateHp = z.maxHp * 0.25;
        for (let i = 0; i < 6; i++) this.spawnParticle(z.x, z.y, rand(-220, 220), rand(-220, 220), rand(0.4, 0.7), rand(4, 7), '#8a9298', 4, true, false);
        this.sfx.play('plate');
        if (z.plates === 0) this.addText(z.x, z.y - z.r - 8, 'ARMOR BROKEN', '#c9d1d8', 12);
      }
    }
    z.hp -= dmg;
    z.flash = 0.07;
    const k = knock / z.def.mass;
    z.kx += Math.cos(angle) * k;
    z.ky += Math.sin(angle) * k;
    if (this.stats.frost > 0 && z.def.kind !== 'electric') z.slow = 1.5;
    if (!quiet) {
      for (let i = 0; i < (crit ? 5 : 2); i++) this.spawnBlood(z.x, z.y, angle + rand(-0.6, 0.6), z.def.kind === 'bloater' ? '#6a8f10' : '#7a1010');
      if (crit || dmg >= 20) this.addText(z.x + rand(-8, 8), z.y - z.r - 4, String(Math.round(dmg)), crit ? '#ffd23f' : dmg >= 150 ? '#ffb347' : '#ffffff', clamp(11 + Math.sqrt(dmg) * (crit ? 1.2 : 0.7), 12, crit ? 30 : 22));
      this.sfx.play('hit');
    }
    if (z.hp <= 0) this.killZombie(z, angle);
  }

  private killZombie(z: Zombie, angle: number) {
    if (z.dead) return;
    z.dead = true;
    this.quietT = 0;
    const kind = z.def.kind;
    const boss = isBoss(z);
    // A guest's kill: their game keeps score, combos and brains for it.
    if (this.killer) this.netSend?.(this.killer, { t: 'kill', k: kind, e: z.elite ? 1 : 0, x: Math.round(z.x), y: Math.round(z.y), n: this.nadeBlast ? 1 : 0, c: this.cause });
    else this.creditKill(kind, !!z.elite, z.x, z.y, z.r);
    if (!boss && kind !== 'egg' && !z.mini) {
      this.corpses.push({ x: z.x, y: z.y });
      if (this.corpses.length > 40) this.corpses.shift();
    }
    if (kind === 'blob' && (z.gen ?? 0) < 2) {
      // Mitosis: two smaller blobs wobble out of the burst one.
      for (let i = 0; i < 2; i++) {
        const a = angle + (i ? 1.3 : -1.3) + rand(-0.3, 0.3);
        const c = this.spawnZombie('blob', z.x + Math.cos(a) * z.r * 0.6, z.y + Math.sin(a) * z.r * 0.6, { gen: (z.gen ?? 0) + 1, elite: z.elite === 'splitting' ? undefined : z.elite });
        c.kx = Math.cos(a) * 260;
        c.ky = Math.sin(a) * 260;
        c.flash = 0.15;
        c.attackCd = 0.5;
      }
      this.wsfx('splat', 0.7);
    }
    if (z.elite === 'splitting' && kind !== 'egg')
      for (let i = 0; i < 2; i++) this.spawnZombie(kind, z.x + rand(-z.r, z.r), z.y + rand(-z.r, z.r), { mini: true }).flash = 0.2;
    if (this.has('boom') && !boss && kind !== 'egg' && z.elite !== 'explosive') this.explode(z.x, z.y, 45 * this.stats.damage, 80, 10);
    if (z.elite === 'explosive') this.explode(z.x, z.y, 70 * this.stats.damage, 110, 22);
    this.deathFx(z, angle);

    const mult = (1 + Math.min(this.combo, 100) * 0.01) * (this.active.cash > 0 ? 2 : 1);
    const value = z.def.cash * this.stats.cash * (1 + 0.06 * (this.wave - 1)) * mult;
    const coins = boss ? 20 : kind === 'tank' || kind === 'shield' || kind === 'mutant' || z.elite ? 4 : 1;
    for (let i = 0; i < coins; i++) {
      const a = rand(0, Math.PI * 2);
      const s = coins > 1 ? rand(60, 220) : rand(20, 60);
      this.pickups.push({ x: z.x, y: z.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind: 'cash', value: value / coins, pulled: false });
    }
    const healthChance = this.mode === 'hardcore' ? 0 : boss ? 1 : kind === 'tank' || kind === 'shield' ? 0.25 : z.elite ? 0.3 : 0.025;
    if (Math.random() < healthChance) this.pickups.push({ x: z.x, y: z.y, vx: rand(-40, 40), vy: rand(-40, 40), kind: 'health', value: 25, pulled: false });
    if (this.state === 'playing' && (boss || (Math.random() < 0.022 && this.powers.length < 2))) {
      const kinds: PowerKind[] = boss ? ['rage'] : ['nuke', 'rage', 'freeze', 'ammo', 'cash'];
      this.powers.push({ x: z.x, y: z.y, kind: kinds[Math.floor(Math.random() * kinds.length)], life: 14 });
    }
    // Loot crates: always from bosses, rarely from elites.
    if (boss || (z.elite && Math.random() < 0.03)) this.pickups.push({ x: z.x, y: z.y, vx: rand(-60, 60), vy: rand(-60, 60), kind: 'crate', value: boss ? 1 : 0, pulled: false });
    if (kind === 'tank' || kind === 'shield' || boss) this.hitstop = boss ? 0.12 : 0.05;
    if (kind === 'bloater') this.explode(z.x, z.y, 60 * this.stats.damage, 95, 18, false, 'toxic');
    if (kind === 'bomber') this.explode(z.x, z.y, 90 * this.stats.damage, 125, 24 * (1 + 0.03 * this.wave));
    if (kind === 'sludger') {
      this.puddles.push({ x: z.x, y: z.y, r: 56, life: 4.5, max: 4.5, kind: 'sludge' });
      this.wsfx('gurgle', 0.6);
    }
    if (kind === 'icer') {
      // Shatters into a ring of ice shards: don't be standing next to it.
      const n = z.mini ? 5 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.15, 0.15);
        this.spits.push({ x: z.x, y: z.y, vx: Math.cos(a) * 360, vy: Math.sin(a) * 360, life: 0.5, shard: true });
      }
      this.wsfx('crack');
    }
    if (boss) {
      this.slowT = 1.8;
      this.zoomKick = Math.max(this.zoomKick, 0.25);
      this.killCam = { x: z.x, y: z.y, t: 1.6 };
      this.buzzT = 0;
      this.buzz([80, 50, 160]);
      this.hooks.onHighlight?.(`${BOSS_NAMES[kind]} kill`);
      this.explode(z.x, z.y, 0, 160, 0);
      this.showBanner('BOSS DOWN', `${BOSS_NAMES[kind]} SLAIN`, BOSS_COLORS[kind] ?? '#c065ff', true);
      this.flash = { t: 0.4, color: '#ffffff', max: 0.4 };
      // Her unhatched eggs die with her.
      if (kind === 'brood') for (const e of this.zombies) if (e.def.kind === 'egg') this.killZombie(e, rand(0, Math.PI * 2));
      if (kind === 'zero') this.spikes = [];
      if (this.op?.goal.type === 'boss' && this.op.goal.kind === kind && !z.mini) this.winOp();
    }
  }

  /** Score, combo, brains and lifesteal for a kill you made (on the host, or told by the host). */
  private creditKill(kind: ZombieKind, elite: boolean, x: number, y: number, r: number) {
    this.kills++;
    const boss = BOSS_KINDS.has(kind);
    const rep = this.report;
    rep.killsByKind[kind] = (rep.killsByKind[kind] ?? 0) + 1;
    const wid = this.weapons[this.wi].def.id;
    rep.killsByWeapon[wid] = (rep.killsByWeapon[wid] ?? 0) + 1;
    if (this.nadeBlast) rep.grenadeKills++;
    if (this.cause === 'train') rep.trainKills++;
    else if (this.cause === 'vent') rep.ventKills++;
    else if (this.cause === 'pin') rep.pinKills++;
    else if (this.cause === 'barrel') rep.barrelKills++;
    else if (this.cause === 'laser') rep.laserKills++;
    const g = this.op?.goal;
    if (g?.type === 'kill' && (!g.kind || g.kind === kind) && !this.opS.done) this.opS.n++;
    this.countBurst(x, y);
    if (boss) {
      rep.bosses++;
      this.gainBrains(25 + this.wave, x, y - r - 20);
    } else if (elite) {
      rep.elites++;
      this.gainBrains(3, x, y - r - 10);
    } else if (this.kills % 10 === 0) this.gainBrains(1);
    this.combo++;
    this.comboT = COMBO_TIME;
    this.comboPop = 0.15;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    for (const [at, text] of COMBO_TIERS) {
      if (this.combo === at) {
        this.showShout(text, at >= 100 ? '#ff3bd0' : at >= 50 ? '#ff5a4a' : '#ffd23f');
        this.sfx.play('combo');
        if (at === 100) this.hooks.onHighlight?.('x100 combo');
      }
    }
    if (this.stats.lifesteal > 0 && !this.down) this.p.hp = Math.min(this.stats.maxHp, this.p.hp + this.stats.lifesteal);
    if (boss && this.net === 'client') {
      this.hooks.onHighlight?.(`${BOSS_NAMES[kind]} kill`);
      this.killCam = { x, y, t: 1.6 };
    }
  }

  /** Blood, gibs and the splat on the floor. Co-op guests play it when the host's zombie disappears. */
  private deathFx(z: Zombie, angle: number) {
    const kind = z.def.kind;
    const boss = isBoss(z);
    if (z.frozenT > 0) {
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2);
        this.spawnParticle(z.x, z.y, Math.cos(a) * rand(100, 320), Math.sin(a) * rand(100, 320), rand(0.3, 0.6), rand(3, 7), i % 2 ? '#dff6ff' : '#7fd8ff', 4, false, true);
      }
      this.sfx.play('shatter');
    }
    if (kind === 'icer' || kind === 'titan') {
      for (let i = 0; i < (boss ? 40 : 12); i++) {
        const a = rand(0, Math.PI * 2);
        this.spawnParticle(z.x, z.y, Math.cos(a) * rand(100, 340), Math.sin(a) * rand(100, 340), rand(0.3, 0.7), rand(3, boss ? 10 : 6), i % 2 ? '#dff6ff' : '#9fd8f0', 4, true, false);
      }
      this.sfx.play('shatter');
    }
    const big = boss || kind === 'tank' || kind === 'shield';
    const n = boss ? 60 : big ? 22 : 12;
    for (let i = 0; i < n; i++) this.spawnBlood(z.x, z.y, angle + rand(-1.2, 1.2), kind === 'blob' ? (i % 2 ? '#7ad8b0' : '#2a6a5a') : i % 3 ? '#8a1414' : z.def.dark, rand(1, boss ? 3 : 1.8) * (kind === 'parasite' ? 0.5 : 1));
    // Gibs
    for (let i = 0; i < (boss ? 16 : big ? 8 : 4); i++) {
      const a = angle + rand(-1.4, 1.4);
      const s = rand(120, 380);
      this.spawnParticle(z.x, z.y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.6), rand(4, big ? 11 : 8), i % 2 ? z.def.body : z.def.dark, 5, true, false);
    }
    // A big splat on the floor.
    this.dctx.fillStyle = kind === 'bloater' ? 'rgba(80,110,10,0.5)' : kind === 'blob' ? 'rgba(60,170,130,0.45)' : 'rgba(90,10,10,0.55)';
    for (let i = 0; i < (boss ? 14 : 5); i++) {
      this.dctx.beginPath();
      this.dctx.arc((z.x + rand(-z.r, z.r)) / 2, (z.y + rand(-z.r, z.r)) / 2, rand(2, z.r / 2.5), 0, Math.PI * 2);
      this.dctx.fill();
    }
    this.sfx.play('death', boss ? 2 : 1);
    this.addShake(boss ? 1 : big ? 0.3 : 0.06);
  }

  /** Kills landing within a blink of each other count as one burst: big ones get slow-mo and a shout. */
  private countBurst(x: number, y: number) {
    if (this.burstT <= 0) this.burst = 0;
    this.burst++;
    this.burstT = 0.3;
    if (this.burst > this.report.bestBurst) this.report.bestBurst = this.burst;
    const tiers: [number, string, string, number][] = [
      [8, 'MULTI KILL!', '#ffd23f', 0.35],
      [15, 'MEGA KILL!', '#ff8a3a', 0.6],
      [25, 'MASSACRE!!', '#ff3b3b', 0.9],
      [40, 'GENOCIDE!!!', '#ff3bd0', 1.2],
    ];
    for (const [n, text, color, slow] of tiers) {
      if (this.burst !== n) continue;
      this.showShout(text, color);
      this.slowT = Math.max(this.slowT, slow);
      this.zoomKick = Math.max(this.zoomKick, 0.04 + slow * 0.08);
      this.buzzT = 0;
      this.buzz(Math.round(40 + slow * 60));
      this.sfx.play('combo');
      // Extra gore for the camera.
      for (let i = 0; i < 10; i++) this.spawnBlood(x, y, rand(0, Math.PI * 2), '#9a1010', 2.2);
      if (n >= 15) this.hooks.onHighlight?.(n >= 25 ? 'Massacre' : 'Mega kill');
    }
  }

  private explode(x: number, y: number, dmg: number, radius: number, playerDmg: number, barrel = false, style: 'fire' | 'toxic' = 'fire') {
    const toxic = style === 'toxic';
    this.explodeFx(x, y, radius, toxic, barrel);
    this.netEvent('x', Math.round(x), Math.round(y), Math.round(radius), toxic ? 1 : 0, barrel ? 1 : 0, this.killer);
    const client = this.net === 'client';
    if (toxic && !client) this.puddles.push({ x, y, r: radius * 0.6, life: 4, max: 4, kind: 'toxic' });
    if (playerDmg > 0) {
      // Your own grenades only hurt you; barrels and bursting zombies hurt the whole squad.
      for (const t of this.nadeBlast || client ? [this.p] : this.targets()) {
        const d = Math.hypot(t.x - x, t.y - y);
        if (d < radius) this.hurtPlayer(playerDmg * (1 - d / radius / 2), { x, y }, t);
      }
    }
    if (client) {
      // The host applies the damage (and sets off any barrels).
      if (dmg > 0) this.netSend?.(null, { t: 'boom', x: Math.round(x), y: Math.round(y), d: Math.round(dmg), r: Math.round(radius), s: toxic ? 1 : 0, n: this.nadeBlast ? 1 : 0 });
      return;
    }
    for (const b of this.barrels) {
      if (b.dead || b.fuse > 0) continue;
      if (Math.hypot(b.x - x, b.y - y) < radius + 10) b.fuse = rand(0.08, 0.2);
    }
    if (dmg <= 0) return;
    const prev = this.cause;
    if (barrel) this.cause = 'barrel';
    for (const z of this.zombies) {
      if (z.dead) continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < radius + z.r) {
        if (!toxic) z.burn = Math.max(z.burn, 1.2);
        this.damageZombie(z, dmg * (1 - (d / (radius + z.r)) * 0.4), Math.atan2(z.y - y, z.x - x), false, 420);
      }
    }
    this.cause = prev;
  }

  private explodeFx(x: number, y: number, radius: number, toxic: boolean, barrel: boolean) {
    this.rings.push({ x, y, r: 10, max: radius, life: 0.35, color: toxic ? 'rgba(160,255,60,' : 'rgba(255,170,60,' });
    this.addLight(x, y, radius * 2.6, 0.45, toxic ? '#9aff3a' : '#ff9a3a');
    const n = Math.round(radius / 5);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, radius * 3.2);
      this.spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.25, 0.6), rand(4, 10), toxic ? (i % 2 ? '#b6ff3a' : '#5a8f10') : i % 3 === 0 ? '#ffe08a' : i % 3 === 1 ? '#ffb347' : '#ff5a1f', 4, false, true, 10);
    }
    for (let i = 0; i < n / 2; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(20, radius * 1.2);
      this.spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.8, 1.6), rand(10, 18), toxic ? 'rgba(90,140,30,0.35)' : 'rgba(60,60,60,0.45)', 2, false, false, 24);
    }
    // Debris sparks
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(300, 600);
      this.spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.7), 2.5, '#fff0b0', 2.5, false, true);
    }
    this.dctx.fillStyle = toxic ? 'rgba(70,110,10,0.45)' : 'rgba(0,0,0,0.45)';
    this.dctx.beginPath();
    this.dctx.arc(x / 2, y / 2, radius / 3.2, 0, Math.PI * 2);
    this.dctx.fill();
    // Far-off blasts (a teammate's) shake the screen less.
    const far = clamp(1 - (Math.hypot(this.p.x - x, this.p.y - y) - 300) / 900, 0.15, 1);
    this.addShake((barrel ? 0.6 : Math.min(0.55, radius / 260)) * far);
    this.zoomKick = Math.max(this.zoomKick, (barrel ? 0.06 : 0.03) * far);
    if (radius >= 130 && far > 0.5) this.hitstop = Math.max(this.hitstop, 0.04);
    this.sfx.play(toxic ? 'splat' : 'explode', (toxic ? 1 : Math.min(1, radius / 130)) * Math.max(0.35, far));
    if (radius >= 110 && far > 0.5) this.buzz(barrel ? 60 : 25);
  }

  private activatePower(kind: PowerKind) {
    const def = POWERUPS[kind];
    // Power-ups count for the whole squad.
    if (this.net === 'host') this.netSend?.(null, { t: 'pw', k: kind });
    this.showBanner(def.name, '', def.color);
    this.sfx.play('power');
    this.flash = { t: 0.25, color: def.color, max: 0.25 };
    if (kind === 'nuke') {
      this.sfx.play('nuke');
      this.flash = { t: 0.9, color: '#ffffff', max: 0.9 };
      this.addShake(1);
      this.zoomKick = 0.1;
      for (const z of this.zombies) {
        if (z.dead || this.net === 'client') continue;
        if (isBoss(z)) this.damageZombie(z, z.maxHp * 0.2, 0, false, 0);
        else this.killZombie(z, Math.atan2(z.y - this.p.y, z.x - this.p.x));
      }
      return;
    }
    this.active[kind] = def.duration * (1 + this.gear.power);
  }

  private updateOrbitals(dt: number) {
    const p = this.p;
    const n = this.stats.blades;
    if (n > 0) {
      this.bladeAngle += dt * 3.4;
      for (let i = 0; i < n; i++) {
        const a = this.bladeAngle + (i * Math.PI * 2) / n;
        const bx = p.x + Math.cos(a) * 78;
        const by = p.y + Math.sin(a) * 78;
        for (const z of this.zombies) {
          if (z.dead || z.bladeCd > 0) continue;
          if (Math.hypot(z.x - bx, z.y - by) < z.r + 13) {
            z.bladeCd = 0.3;
            this.damageZombie(z, 28 * this.stats.damage, Math.atan2(z.y - p.y, z.x - p.x), false, 220);
          }
        }
      }
    }
    while (this.droneT.length < this.stats.drones) this.droneT.push(Math.random() * 0.5);
    for (let i = 0; i < this.stats.drones; i++) {
      this.droneT[i] -= dt;
      if (this.droneT[i] > 0) continue;
      const d = this.dronePos(i);
      const t = this.nearestZombie(d.x, d.y, 480);
      if (!t) continue;
      this.droneT[i] = 0.5;
      const a = Math.atan2(t.y - d.y, t.x - d.x);
      this.bullets.push({ kind: 'bullet', x: d.x, y: d.y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, dmg: 16 * this.stats.damage, life: 0.6, max: 0.6, pierce: 0, ricochet: 0, hits: [], color: '#7ef0ff', width: 2, canExplode: false });
      this.addLight(d.x, d.y, 80, 0.06, '#7ef0ff');
      this.sfx.play('smg', 0.4);
    }
  }

  private dronePos(i: number) {
    const a = this.runTime * 1.6 + (i * Math.PI * 2) / Math.max(1, this.stats.drones);
    return { x: this.p.x + Math.cos(a) * 44, y: this.p.y + Math.sin(a) * 44 - 6 };
  }

  private updatePickups(dt: number) {
    const ts = this.targets();
    const range = 110 * this.stats.magnet;
    const keep: Pickup[] = [];
    for (const pk of this.pickups) {
      // Floats to whoever is closest; your own magnet perk reaches further for you.
      const p = ts.length > 1 ? this.nearest(ts, pk.x, pk.y) : ts[0];
      const dx = p.x - pk.x;
      const dy = p.y - pk.y;
      const d = Math.hypot(dx, dy) || 1;
      if (pk.pulled || d < (p === this.p ? range : 110)) {
        pk.pulled = true;
        const s = 700;
        pk.vx += (dx / d) * s * dt * 6;
        pk.vy += (dy / d) * s * dt * 6;
        const v = Math.hypot(pk.vx, pk.vy);
        if (v > s) {
          pk.vx = (pk.vx / v) * s;
          pk.vy = (pk.vy / v) * s;
        }
      } else {
        pk.vx *= Math.exp(-dt * 5);
        pk.vy *= Math.exp(-dt * 5);
      }
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      if (d < PLAYER_R + 8) {
        if (p !== this.p) {
          const id = (p as Ally).id;
          this.netSend?.(id, pk.kind === 'cash' ? { t: 'cash', v: Math.round(pk.value * 10) / 10 } : pk.kind === 'crate' ? { t: 'crate', l: pk.value } : { t: 'heal', v: pk.value });
        } else if (pk.kind === 'cash') {
          this.gainCash(pk.value);
          this.sfx.play('coin');
        } else if (pk.kind === 'crate') {
          this.openCrate(pk);
        } else this.heal(pk.value);
        continue;
      }
      keep.push(pk);
    }
    this.pickups = keep;
    this.powers = this.powers.filter((pw) => {
      pw.life -= dt;
      if (ts.some((p) => Math.hypot(pw.x - p.x, pw.y - p.y) < PLAYER_R + 18)) {
        this.activatePower(pw.kind);
        return false;
      }
      return pw.life > 0;
    });
  }

  private heal(v: number) {
    this.p.hp = Math.min(this.stats.maxHp, this.p.hp + v);
    this.addText(this.p.x, this.p.y - 26, `+${v}`, '#5dff7a', 15);
    this.sfx.play('buy');
  }

  private openCrate(pk: Pickup) {
    const it = rollGear(this.wave, pk.value);
    const def = gearDef(it.id)!;
    const scrapped = meta.addGear(it);
    this.loot.push(it);
    const color = RARITY_COLOR[it.rarity];
    this.showShout(`${it.rarity.toUpperCase()} LOOT!`, color);
    this.toast(scrapped ? `📦 ${def.icon} ${def.name} (stash full: +${scrapped} 🧠)` : `📦 ${def.icon} ${it.rarity} ${def.name}: ${def.desc(gearValue(it))}`);
    this.addText(pk.x, pk.y - 20, `${def.icon} ${it.rarity.toUpperCase()}`, color, 18);
    this.addLight(pk.x, pk.y, 220, 0.5, color);
    this.ring({ x: pk.x, y: pk.y, r: 0, max: 90, life: 0.5, color: 'rgba(255,210,63,' });
    this.sfx.play(it.rarity === 'legendary' || it.rarity === 'epic' ? 'levelup' : 'power');
  }

  /** Puts down the next deployable from the kit, just in front of you. */
  private deploy() {
    const kind = this.kit.shift();
    if (!kind) return;
    const p = this.p;
    if (this.net === 'client') this.netSend?.(null, { t: 'dep', k: kind, x: Math.round(p.x), y: Math.round(p.y), a: Math.round(p.angle * 100) / 100 });
    else this.placeDeploy(kind, p);
    this.sfx.play('clank');
    this.addShake(0.1);
  }

  /** Puts a deployable down in front of someone (you, or a co-op guest on the host). */
  private placeDeploy(kind: DeployKind, p: { x: number; y: number; angle: number }) {
    const at = (dist: number) => {
      const o = { x: p.x + Math.cos(p.angle) * dist, y: p.y + Math.sin(p.angle) * dist };
      this.collideWalls(o, 24);
      return o;
    };
    const base = { hp: 1, maxHp: 1, t: 0, life: Infinity, angle: p.angle };
    if (kind === 'mine') {
      // Three mines in a little arc.
      for (let i = -1; i <= 1; i++) {
        const a = p.angle + i * 0.6;
        const o = { x: p.x + Math.cos(a) * 60, y: p.y + Math.sin(a) * 60 };
        this.collideWalls(o, 12);
        this.deploys.push({ ...base, kind, ...o, t: 0.8, r: 10 });
      }
    } else if (kind === 'turret') this.deploys.push({ ...base, kind, ...at(44), hp: 260, maxHp: 260, life: 60, r: 16 });
    else if (kind === 'barricade') this.deploys.push({ ...base, kind, ...at(56), hp: 700 + this.wave * 25, maxHp: 700 + this.wave * 25, r: 30 });
    else this.deploys.push({ ...base, kind, ...at(40), hp: 200, maxHp: 200, life: 40, r: 16 });
  }

  private pushOut(o: { x: number; y: number }, r: number, d: Deployable) {
    const dx = o.x - d.x;
    const dy = o.y - d.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const min = r + d.r;
    if (dist >= min) return;
    o.x = d.x + (dx / dist) * min;
    o.y = d.y + (dy / dist) * min;
  }

  private updateDeploys(dt: number) {
    const p = this.p;
    const client = this.net === 'client';
    for (const d of this.deploys) {
      if (d.life !== Infinity) d.life -= dt;
      d.t -= dt;
      if (client && d.kind !== 'medic') continue;
      if (d.kind === 'turret' && d.t <= 0) {
        const t = this.nearestZombie(d.x, d.y, 380);
        if (t) {
          d.t = 0.16;
          const want = Math.atan2(t.y - d.y, t.x - d.x);
          d.angle = want;
          const a = want + rand(-0.05, 0.05);
          const mx = d.x + Math.cos(a) * 22;
          const my = d.y + Math.sin(a) * 22;
          this.bullets.push({ kind: 'bullet', x: mx, y: my, vx: Math.cos(a) * 1000, vy: Math.sin(a) * 1000, dmg: 15 * this.stats.damage * (1 + 0.05 * this.wave), life: 0.5, max: 0.5, pierce: 0, ricochet: 0, hits: [], color: '#ffe08a', width: 2.5, canExplode: false });
          this.addLight(mx, my, 90, 0.05, '#ffd080');
          this.sfx.play('smg', 0.35);
        }
      } else if (d.kind === 'mine' && d.t <= 0) {
        if (this.zombies.some((z) => !z.dead && z.def.kind !== 'egg' && Math.hypot(z.x - d.x, z.y - d.y) < z.r + 18)) {
          d.hp = 0;
          this.explode(d.x, d.y, 220 * this.stats.damage * (1 + 0.04 * this.wave), 120, 0);
        }
      } else if (d.kind === 'medic') {
        if (Math.hypot(p.x - d.x, p.y - d.y) < 90 && p.hp < this.stats.maxHp && !this.down) {
          p.hp = Math.min(this.stats.maxHp, p.hp + 9 * dt);
          if (d.t <= 0) {
            d.t = 0.5;
            this.addText(p.x + rand(-10, 10), p.y - 24, '+', '#5dff7a', 16);
          }
        }
        if (Math.random() < dt * 2) this.addLight(d.x, d.y, 160, 0.5, '#5dff7a');
      }
    }
    if (client) return;
    const gone = this.deploys.filter((d) => d.hp <= 0 || d.life <= 0);
    for (const d of gone) {
      if (d.kind === 'mine') continue;
      for (let i = 0; i < 12; i++) this.spawnParticle(d.x, d.y, rand(-200, 200), rand(-200, 200), rand(0.3, 0.7), rand(3, 7), d.kind === 'barricade' ? '#a8885a' : '#6a7078', 4, true, false);
      if (d.hp <= 0) this.sfx.play('plate');
    }
    if (gone.length) this.deploys = this.deploys.filter((d) => !gone.includes(d));
  }

  private drawDeploys() {
    const ctx = this.ctx;
    for (const d of this.deploys) {
      ctx.save();
      ctx.translate(d.x, d.y);
      if (d.kind === 'mine') {
        ctx.fillStyle = '#2a2e26';
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#555c4c';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = d.t > 0 ? '#666' : Math.sin(this.clock * 8) > 0 ? '#ff3020' : '#701010';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.kind === 'barricade') {
        // A curved row of sandbags facing where you put it down.
        ctx.rotate(d.angle);
        for (let row = 0; row < 2; row++)
          for (let i = -2; i <= 2; i++) {
            const a = i * 0.32;
            const rr = 8 + row * 9;
            ctx.save();
            ctx.translate(Math.cos(a) * rr - 6, Math.sin(a) * (rr + 22));
            ctx.rotate(a);
            ctx.fillStyle = row ? '#b8975e' : '#9a7c4a';
            ctx.fillRect(-7, -9, 14, 18);
            ctx.strokeStyle = '#5e4a2a';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-7, -9, 14, 18);
            ctx.restore();
          }
      } else if (d.kind === 'turret') {
        ctx.fillStyle = '#3a4038';
        ctx.fillRect(-14, -14, 28, 28);
        ctx.strokeStyle = '#1c201a';
        ctx.lineWidth = 2;
        ctx.strokeRect(-14, -14, 28, 28);
        ctx.rotate(d.angle);
        ctx.fillStyle = '#8a9298';
        ctx.fillRect(0, -3.5, 24, 7);
        ctx.fillStyle = '#c9d1d8';
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const pulse = 1 + Math.sin(this.clock * 3) * 0.06;
        ctx.strokeStyle = 'rgba(93,255,122,0.35)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(0, 0, 90 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#eee';
        ctx.fillRect(-13, -11, 26, 22);
        ctx.fillStyle = '#d0302a';
        ctx.fillRect(-3.5, -8, 7, 16);
        ctx.fillRect(-8, -3.5, 16, 7);
      }
      ctx.restore();
      // Health or time left
      const frac = d.kind === 'mine' ? 1 : d.life !== Infinity ? Math.min(d.hp / d.maxHp, d.life / (d.kind === 'turret' ? 60 : 40)) : d.hp / d.maxHp;
      if (d.kind !== 'mine' && frac < 0.999) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(d.x - 16, d.y - d.r - 12, 32, 4);
        ctx.fillStyle = frac > 0.4 ? '#5dff7a' : '#ff5a4a';
        ctx.fillRect(d.x - 16, d.y - d.r - 12, 32 * frac, 4);
      }
    }
  }

  private gainCash(v: number) {
    this.cash += v;
    this.earned += v;
    this.cashPulse = 0.2;
  }

  private updateEffects(dt: number, rawDt: number) {
    const ps: Particle[] = [];
    for (const q of this.particles) {
      q.life -= dt;
      if (q.life <= 0) {
        if (q.decal) {
          this.dctx.fillStyle = q.color;
          this.dctx.globalAlpha = 0.6;
          this.dctx.beginPath();
          this.dctx.arc(q.x / 2, q.y / 2, q.size / 2.2, 0, Math.PI * 2);
          this.dctx.fill();
          this.dctx.globalAlpha = 1;
        }
        continue;
      }
      const k = Math.exp(-dt * q.drag);
      q.vx *= k;
      q.vy *= k;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.size = Math.max(0.5, q.size + q.grow * dt);
      ps.push(q);
    }
    this.particles = ps.length > 1100 ? ps.slice(ps.length - 1100) : ps;
    this.texts = this.texts.filter((t) => {
      t.life -= rawDt;
      t.y -= 40 * rawDt;
      return t.life > 0;
    });
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      r.r += (r.max - r.r) * Math.min(1, dt * 14);
      return r.life > 0;
    });
    this.lights = this.lights.filter((l) => (l.life -= dt) > 0);
    this.ghosts = this.ghosts.filter((g) => (g.life -= dt) > 0);
    this.bolts = this.bolts.filter((b) => (b.life -= dt) > 0);
    this.beams = this.beams.filter((b) => (b.life -= dt) > 0);
    if (this.subtitle.t > 0) this.subtitle.t -= rawDt;
    this.trauma = Math.max(0, this.trauma - rawDt * 1.8);
    this.zoomKick = Math.max(0, this.zoomKick - rawDt * 0.4);
    if (this.banner.t > 0) this.banner.t -= rawDt;
    if (this.shout.t > 0) this.shout.t -= rawDt;
    if (this.cashPulse > 0) this.cashPulse -= rawDt;
    if (this.brainsPulse > 0) this.brainsPulse -= rawDt;
    if (this.comboPop > 0) this.comboPop -= rawDt;
    if (this.burstT > 0) this.burstT -= rawDt;
    if (this.buzzT > 0) this.buzzT -= rawDt;
    for (const t of this.toasts) t.t -= rawDt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
    if (this.flash.t > 0) this.flash.t -= rawDt;
  }

  private spawnParticle(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, drag: number, decal: boolean, glow: boolean, grow = 0) {
    this.particles.push({ x, y, vx, vy, life, max: life, size, grow, color, drag, decal, glow });
  }

  private spawnBlood(x: number, y: number, angle: number, color: string, scale = 1) {
    const s = rand(60, 260) * scale;
    this.spawnParticle(x, y, Math.cos(angle) * s, Math.sin(angle) * s, rand(0.2, 0.5), rand(2, 5) * Math.min(scale, 1.6), color, 7, true, false);
  }

  private addLight(x: number, y: number, r: number, life: number, color: string) {
    if (this.lights.length > 70) this.lights.shift();
    this.lights.push({ x, y, r, life, max: life, color });
  }

  private addText(x: number, y: number, text: string, color: string, size: number) {
    if (this.texts.length > 50) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life: 0.6 });
  }

  addShake(v: number) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  private collideWalls(o: { x: number; y: number }, r: number): boolean {
    let hit = false;
    for (const w of this.map.walls) {
      const cx = clamp(o.x, w.x, w.x + w.w);
      const cy = clamp(o.y, w.y, w.y + w.h);
      const dx = o.x - cx;
      const dy = o.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 0) {
        const d = Math.sqrt(d2);
        o.x = cx + (dx / d) * r;
        o.y = cy + (dy / d) * r;
      } else {
        // Center is inside the rect: push out along the shortest axis.
        const left = o.x - w.x;
        const right = w.x + w.w - o.x;
        const top = o.y - w.y;
        const bottom = w.y + w.h - o.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) o.x = w.x - r;
        else if (m === right) o.x = w.x + w.w + r;
        else if (m === top) o.y = w.y - r;
        else o.y = w.y + w.h + r;
      }
    }
    return hit;
  }

  private pointInWall(x: number, y: number) {
    for (const w of this.map.walls) if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) return true;
    return false;
  }

  private toScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.zoom + this.w / 2, y: (y - this.cam.y) * this.zoom + this.h / 2 };
  }

  // ---------------------------------------------------------------- co-op

  /** Sets up the squad for a co-op run. `players` includes you. */
  setSquad(role: 'host' | 'client', myId: string, players: { id: string; name: string; slot: number }[]) {
    this.net = role;
    this.myId = myId;
    this.slot = players.find((p) => p.id === myId)?.slot ?? 0;
    this.allies = players
      .filter((p) => p.id !== myId)
      .map((p) => {
        const x = WORLD_W / 2 + ([-40, 40, 0, 0][p.slot] ?? 0);
        const y = WORLD_H / 2 + ([0, 0, -40, 40][p.slot] ?? 0);
        return { id: p.id, name: p.name, slot: p.slot, x, y, nx: x, ny: y, vx: 0, vy: 0, angle: -Math.PI / 2, hp: 100, maxHp: 100, down: false, revive: 0, weapon: 'pistol', firing: false, dashing: false, fireT: 0, grace: 0 };
      });
  }

  /** Back to solo play. */
  leaveSquad() {
    this.net = '';
    this.myId = '';
    this.slot = 0;
    this.allies = [];
    this.netSend = null;
    this.down = false;
    this.hostPaused = false;
  }

  /** A guest left mid-run (host only). */
  dropAlly(id: string) {
    const a = this.allies.find((x) => x.id === id);
    if (!a) return;
    this.allies = this.allies.filter((x) => x !== a);
    this.toast(`${a.name} left the game`);
    this.netEvent('h', `${a.name.toUpperCase()} LEFT`, '#c9d1b8');
  }

  /** Sends what the others need to know, at a steady rate. Called every frame by main.ts. */
  netTick(dt: number) {
    if (!this.net || !this.netSend) return;
    if (this.netHits.length) {
      this.netSend(null, { t: 'h', h: this.netHits });
      this.netHits = [];
    }
    this.netT -= dt;
    if (this.netT > 0 || (this.state !== 'playing' && this.state !== 'paused')) return;
    const r = Math.round;
    if (this.net === 'host') {
      this.netT = SNAP_EVERY;
      this.netSend(null, this.buildSnap(), true);
      this.netEv = [];
    } else {
      this.netT = STATE_EVERY;
      const p = this.p;
      const firing = this.firing && this.state === 'playing' && !this.hostPaused;
      this.netSend(null, { t: 'p', x: r(p.x), y: r(p.y), a: r(p.angle * 100) / 100, vx: r(p.vx), vy: r(p.vy), hp: r(p.hp), mh: r(this.stats.maxHp), dn: this.down ? 1 : 0, w: this.weapons[this.wi].def.id, f: firing ? 1 : 0, d: this.dashT > 0 ? 1 : 0 }, true);
    }
  }

  private buildSnap(): NetMsg {
    const r = Math.round;
    const p = this.p;
    const zs = this.zombies
      .filter((z) => !z.dead)
      .map((z) => [
        z.id,
        KINDS.indexOf(z.def.kind),
        r(z.x),
        r(z.y),
        r(z.face * 100),
        r(z.hp),
        r(z.maxHp),
        r(z.r),
        (z.elite ? ELITE_KINDS.indexOf(z.elite) + 1 : 0) | (z.mini ? 8 : 0) | (z.frozenT > 0 ? 16 : 0) | (z.burn > 0 ? 32 : 0) | (z.buff > 0 ? 64 : 0) | (z.zapT > 0 ? 128 : 0) | (z.slow > 0 ? 256 : 0) | (z.dig?.state === 'under' ? 512 : 0) | (z.dig?.state === 'rise' ? 1024 : 0) | (z.ghostT > 0 ? 2048 : 0) | (z.fuse > 0 ? 4096 : 0) | ((z.reap?.windup ?? 0) > 0 ? 8192 : 0) | (z.lurk ? 16384 : 0) | ((z.titan?.windup ?? 0) > 0 ? 32768 : 0) | ((z.stun ?? 0) > 0 ? 65536 : 0) | (z.charm > 0 ? 131072 : 0) | (z.healing ? 262144 : 0) | ((z.yank?.windup ?? 0) > 0 ? 524288 : 0) | (z.latch ? 1048576 : 0),
        z.boss ? ['walk', 'windup', 'charge'].indexOf(z.boss.state) : 0,
        z.leap ? ['walk', 'crouch', 'leap'].indexOf(z.leap.state) : 0,
        z.jug ? r(z.jug.windup * 100) : 0,
        z.plates,
        // Patient Zero: form + mutating, eye-beam angle, beam state (1 aim, 2 sweep), pull wind-up
        z.zero ? z.zero.phase * 2 + (z.zero.trans > 0 ? 1 : 0) : 0,
        z.zero ? r(z.zero.laserA * 100) : 0,
        z.zero ? (z.zero.laserW > 0 ? 1 : z.zero.laserT > 0 ? 2 : 0) : 0,
        z.zero ? r(z.zero.yankT * 100) : 0,
      ]);
    const me = [this.myId, r(p.x), r(p.y), r(p.angle * 100), r(p.hp), r(this.stats.maxHp), this.down ? 1 : 0, this.weapons[this.wi].def.id, this.firing && this.state === 'playing' ? 1 : 0, r(this.reviveProg * 100), this.dashT > 0 ? 1 : 0];
    const pl = [me, ...this.allies.map((a) => [a.id, r(a.x), r(a.y), r(a.angle * 100), r(a.hp), r(a.maxHp), a.down ? 1 : 0, a.weapon, a.firing ? 1 : 0, r(a.revive * 100), a.dashing ? 1 : 0])];
    return {
      t: 's',
      w: this.wave,
      left: this.toSpawn + zs.length,
      pz: this.state === 'paused' ? 1 : 0,
      z: zs,
      pl,
      pk: this.pickups.map((k) => [r(k.x), r(k.y), r(k.vx), r(k.vy), k.kind === 'cash' ? 0 : k.kind === 'health' ? 1 : 2]),
      pw: this.powers.map((w) => [r(w.x), r(w.y), POWER_KINDS.indexOf(w.kind), r(w.life * 10)]),
      sp: this.spits.map((q) => [r(q.x), r(q.y), r(q.vx), r(q.vy), r(q.life * 100), (q.soul ? 1 : 0) | (q.web ? 2 : 0) | (q.shard ? 4 : 0)]),
      pd: this.puddles.map((q) => [r(q.x), r(q.y), r(q.r), r(q.life * 100), r(q.max * 100), PUDDLE_KINDS.indexOf(q.kind)]),
      mo: this.mortars.map((m) => [r(m.x), r(m.y), r(m.sx), r(m.sy), r(m.t * 100), r(m.max * 100), m.ice ? 1 : 0]),
      nv: this.novas.map((n) => [r(n.x), r(n.y), r(n.r), r(n.max)]),
      bz: [['calm', 'warn', 'blow'].indexOf(this.blizzard.phase), r(this.blizzard.dir * 100)],
      vt: this.vents.map((v) => ['idle', 'warn', 'blast'].indexOf(v.phase)),
      vx: this.vortexes.map((v) => [r(v.x), r(v.y), r(v.t * 100)]),
      dp: this.deploys.map((d) => [DEPLOY_KINDS.indexOf(d.kind), r(d.x), r(d.y), r(d.angle * 100), r(d.hp), r(d.maxHp), d.life === Infinity ? -1 : r(d.life * 10), d.r, d.t > 0 ? 1 : 0]),
      tr: this.trains.map((t) => [['idle', 'warn', 'go'].indexOf(t.phase), r(t.x)]),
      br: this.barrels.map((b) => (b.dead ? 1 : 0)).join(''),
      gr: this.grenades.map((g) => [r(g.x), r(g.y), r(g.vx), r(g.vy), r(g.z), r(g.vz), r(g.fuse * 100), g.radius ?? 135, (g.vortex ? 1 : 0) | (g.cluster ? 2 : 0) | (g.bomblet ? 4 : 0)]),
      sk: this.spikes.map((q) => [r(q.x1), r(q.y1), r(q.x2), r(q.y2), r(q.t * 100)]),
      cs: this.consoles.map((c) => [['idle', 'warn', 'sweep'].indexOf(c.phase), r(c.pos), c.dir, r(c.cd * 10), r(c.hold * 100), r(c.t * 100)]),
      pc: r(this.power.out * 10),
      ev: this.netEv,
    };
  }

  /** A zombie the host told us about, built just well enough to draw and to shoot at. */
  private mirrorZombie(id: number, kind: ZombieKind, x: number, y: number): Zombie {
    const def = ZOMBIES[kind];
    const z: Zombie = { id, def, x, y, kx: 0, ky: 0, hp: 1, maxHp: 1, speed: 0, dmg: 0, r: def.radius, flash: 0, slow: 0, burn: 0, attackCd: 0, bladeCd: 0, phase: Math.random() * 10, face: 0, dead: false, spitCd: 0, buff: 0, abilityCd: 0, chill: 0, frozenT: 0, plates: 0, plateHp: 0, zapT: 0, ghostT: 0, fuse: 0, psi: 0, charm: 0, regenT: 0 };
    if (kind === 'psyker') z.yank = { cd: 0, windup: 0, tx: 0, ty: 0 };
    if (kind === 'zero') z.zero = { phase: 1, trans: 0, tendril: 0, summon: 0, yank: 0, yankT: 0, laser: 0, laserW: 0, laserT: 0, laserA: 0, laserDir: 1, laserHit: [] };
    if (kind === 'burrower') z.dig = { state: 'walk', t: 0 };
    if (kind === 'reaper') z.reap = { sweep: 0, windup: 0, aim: 0, blink: 0, orbs: 0, summoned: true };
    if (kind === 'sludge') z.sludge = { mortar: 0, drip: 0, splits: 2 };
    if (kind === 'titan') z.titan = { boulder: 0, nova: 0, windup: 0, enraged: true };
    if (kind === 'boss' || kind === 'juggernaut') z.boss = { state: 'walk', t: 0, dx: 0, dy: 0, summon: 0 };
    if (kind === 'juggernaut') z.jug = { slam: 0, windup: 0 };
    if (kind === 'brood') z.brood = { lay: 0, spit: 0 };
    if (kind === 'leaper' || kind === 'roller') z.leap = { state: 'walk', t: 0, dx: 0, dy: 0 };
    return z;
  }

  private applySnap(s: NetMsg) {
    type Row = number[];
    this.hostPaused = !!s.pz;
    const old = new Map(this.zombies.map((z) => [z.id, z]));
    const next: Zombie[] = [];
    for (const e of s.z as Row[]) {
      const [id, ki, x, y, face, hp, maxHp, rad, fl, bs, ls, jw, plates, zf, za, zl, zy] = e;
      let z = old.get(id);
      if (z) old.delete(id);
      else z = this.mirrorZombie(id, KINDS[ki], x, y);
      if (Math.hypot(z.x - x, z.y - y) > 250) {
        z.x = x;
        z.y = y;
      }
      z.nx = x;
      z.ny = y;
      z.face = face / 100;
      z.hp = hp;
      z.maxHp = maxHp;
      z.r = rad;
      z.elite = fl & 7 ? ELITE_KINDS[(fl & 7) - 1] : undefined;
      z.mini = !!(fl & 8);
      z.frozenT = fl & 16 ? 1 : 0;
      z.burn = fl & 32 ? 1 : 0;
      z.buff = fl & 64 ? 1 : 0;
      z.zapT = fl & 128 ? 0.3 : 0;
      z.slow = fl & 256 ? 1 : 0;
      if (z.dig) z.dig.state = fl & 512 ? 'under' : fl & 1024 ? 'rise' : 'walk';
      z.ghostT = fl & 2048 ? 1 : 0;
      z.fuse = fl & 4096 ? 0.5 : 0;
      if (z.reap) {
        z.reap.windup = fl & 8192 ? 0.3 : 0;
        z.reap.aim = z.face;
      }
      z.lurk = !!(fl & 16384);
      if (z.titan) z.titan.windup = fl & 32768 ? 0.3 : 0;
      z.stun = fl & 65536 ? 1 : 0;
      if (z.boss) z.boss.state = (['walk', 'windup', 'charge'] as const)[bs] ?? 'walk';
      if (z.leap) {
        z.leap.state = (['walk', 'crouch', 'leap'] as const)[ls] ?? 'walk';
        z.leap.dx = Math.cos(z.face);
        z.leap.dy = Math.sin(z.face);
      }
      if (z.jug) z.jug.windup = jw / 100;
      z.plates = plates;
      z.charm = fl & 131072 ? 1 : 0;
      z.healing = !!(fl & 262144);
      z.latch = fl & 1048576 ? 1 : 0;
      if (z.yank) z.yank.windup = fl & 524288 ? 0.5 : 0;
      if (z.zero && zf) {
        const Z = z.zero;
        Z.phase = Math.max(1, Math.min(3, zf >> 1)) as 1 | 2 | 3;
        Z.trans = zf & 1 ? 0.5 : 0;
        Z.laserA = (za ?? 0) / 100;
        Z.laserW = zl === 1 ? 0.5 : 0;
        Z.laserT = zl === 2 ? 0.5 : 0;
        Z.yankT = (zy ?? 0) / 100;
      }
      next.push(z);
    }
    // Whatever the host no longer has just died.
    for (const z of old.values()) this.deathFx(z, z.face + Math.PI);
    this.zombies = next;
    this.toSpawn = Math.max(0, (s.left as number) - next.length);

    for (const e of s.pl as (string | number)[][]) {
      const [id, x, y, ang, hp, maxHp, down, weapon, firing, revive, dashing] = e as [string, number, number, number, number, number, number, string, number, number, number];
      if (id === this.myId) {
        this.reviveProg = revive / 100;
        continue;
      }
      const a = this.allies.find((q) => q.id === id);
      if (!a) continue;
      a.nx = x;
      a.ny = y;
      if (Math.hypot(a.x - x, a.y - y) > 300) {
        a.x = x;
        a.y = y;
      }
      a.angle = ang / 100;
      a.hp = hp;
      a.maxHp = maxHp;
      a.down = !!down;
      a.weapon = weapon;
      a.firing = !!firing;
      a.revive = revive / 100;
      a.dashing = !!dashing;
    }
    const kinds: Pickup['kind'][] = ['cash', 'health', 'crate'];
    this.pickups = (s.pk as Row[]).map(([x, y, vx, vy, k]) => ({ x, y, vx, vy, kind: kinds[k], value: 0, pulled: true }));
    this.powers = (s.pw as Row[]).map(([x, y, k, life]) => ({ x, y, kind: POWER_KINDS[k], life: life / 10 }));
    this.spits = (s.sp as Row[]).map(([x, y, vx, vy, life, f]) => ({ x, y, vx, vy, life: life / 100, soul: !!(f & 1), web: !!(f & 2), shard: !!(f & 4) }));
    this.puddles = (s.pd as Row[]).map(([x, y, r, life, max, k]) => ({ x, y, r, life: life / 100, max: max / 100, kind: PUDDLE_KINDS[k] ?? 'acid' }));
    this.mortars = ((s.mo as Row[]) ?? []).map(([x, y, sx, sy, t, max, ice]) => ({ x, y, sx, sy, t: t / 100, max: max / 100, ice: !!ice }));
    this.novas = ((s.nv as Row[]) ?? []).map(([x, y, r, max]) => ({ x, y, r, max, hit: [] }));
    const bz = s.bz as Row | undefined;
    if (bz) {
      this.blizzard.phase = (['calm', 'warn', 'blow'] as const)[bz[0]] ?? 'calm';
      this.blizzard.dir = bz[1] / 100;
    }
    ((s.vt as number[]) ?? []).forEach((ph, i) => {
      const v = this.vents[i];
      if (v) v.phase = (['idle', 'warn', 'blast'] as const)[ph] ?? 'idle';
    });
    this.vortexes = [...this.vortexes.filter((v) => !v.remote), ...((s.vx as Row[]) ?? []).map(([x, y, t]) => ({ x, y, t: t / 100, max: 1.5, dmg: 0, tick: 0, remote: true }))];
    this.deploys = (s.dp as Row[]).map(([k, x, y, a, hp, maxHp, life, r, arming]) => ({ kind: DEPLOY_KINDS[k], x, y, angle: a / 100, hp, maxHp, life: life < 0 ? Infinity : life / 10, r, t: arming ? 1 : 0 }));
    (s.tr as Row[]).forEach(([ph, x], i) => {
      const tr = this.trains[i];
      if (!tr) return;
      tr.phase = (['idle', 'warn', 'go'] as const)[ph];
      tr.x = x;
    });
    const br = String(s.br);
    this.barrels.forEach((b, i) => {
      if (br[i] === '1' && !b.dead) b.dead = true;
    });
    this.grenades = [...this.grenades.filter((g) => !g.remote), ...(s.gr as Row[]).map(([x, y, vx, vy, z, vz, fuse, radius, vort]) => ({ x, y, vx, vy, z, vz, fuse: fuse / 100, radius, vortex: !!(vort & 1), cluster: !!(vort & 2), bomblet: !!(vort & 4), remote: true }))];
    if (s.sk) {
      // Keep the local hit lists so a spike can't hurt the same guest twice.
      this.spikes = (s.sk as Row[]).map(([x1, y1, x2, y2, t]) => ({ x1, y1, x2, y2, t: t / 100, hit: [] }));
    }
    ((s.cs as Row[]) ?? []).forEach(([ph, pos, dir, cd, hold, t], i) => {
      const c = this.consoles[i];
      if (!c) return;
      const phase = (['idle', 'warn', 'sweep'] as const)[ph] ?? 'idle';
      if (phase === 'sweep' && c.phase !== 'sweep') c.hit = [];
      c.phase = phase;
      if (phase !== 'sweep' || Math.abs(c.pos - pos) > 60) c.pos = pos;
      c.dir = dir;
      c.cd = cd / 10;
      c.hold = hold / 100;
      c.t = t / 100;
    });
    if (s.pc !== undefined) this.power.out = Number(s.pc) / 10;
    for (const e of s.ev as (string | number)[][]) this.applyEvent(e);
  }

  private applyEvent(e: (string | number)[]) {
    const [k, ...a] = e;
    const n = a as number[];
    if (k === 'x') {
      if (a[5] !== this.myId) this.explodeFx(n[0], n[1], n[2], !!n[3], !!n[4]);
    } else if (k === 'a') this.sfx.play(a[0] as SfxKind, n[1]);
    else if (k === 'r') this.rings.push({ x: n[0], y: n[1], r: n[2], max: n[3], life: n[4], color: String(a[5]) });
    else if (k === 'z') this.bolts.push({ x1: n[0], y1: n[1], x2: n[2], y2: n[3], life: n[4], color: String(a[5]) });
    else if (k === 'b') this.showBanner(String(a[0]), String(a[1]), String(a[2]));
    else if (k === 'h') this.showShout(String(a[0]), String(a[1]));
    else if (k === 'ib') this.iceBurst(n[0], n[1]);
    else if (k === 'down') {
      const who = this.allies.find((q) => q.id === a[0]);
      if (who) this.toast(`${who.name} is down! Stand next to them to revive`);
    }
  }

  /** Messages from the other players. */
  netRecv(from: string, m: NetMsg) {
    const num = (k: string) => Number(m[k]) || 0;
    if (this.net === 'host') {
      const a = this.allies.find((x) => x.id === from);
      if (!a) return;
      if (m.t === 'p') {
        a.nx = num('x');
        a.ny = num('y');
        a.vx = num('vx');
        a.vy = num('vy');
        a.angle = num('a');
        a.hp = num('hp');
        a.maxHp = num('mh') || 100;
        a.weapon = String(m.w);
        a.firing = !!m.f;
        a.dashing = !!m.d;
        if (a.grace <= 0) {
          const was = a.down;
          a.down = !!m.dn;
          if (a.down && !was) {
            a.revive = 0;
            this.toast(`${a.name} is down! Stand next to them to revive`);
            this.netEvent('down', a.id);
          }
        }
      } else if (m.t === 'h' && this.state === 'playing') {
        const byId = new Map(this.zombies.map((z) => [z.id, z]));
        this.killer = from;
        for (const [id, dmg, ang, knock, f] of m.h as number[][]) {
          const z = byId.get(id);
          if (!z || z.dead) continue;
          if (f & 4) z.burn = 2.5;
          if (f & 8) this.chill(z);
          if (f & 16) this.addPsi(z);
          this.damageZombie(z, dmg, ang, !!(f & 1), knock, !!(f & 2), f & 12);
        }
        this.killer = '';
      } else if (m.t === 'boom' && this.state === 'playing') {
        this.killer = from;
        this.nadeBlast = !!m.n;
        this.explode(num('x'), num('y'), num('d'), num('r'), 0, false, m.s ? 'toxic' : 'fire');
        this.nadeBlast = false;
        this.killer = '';
      } else if (m.t === 'bar') {
        const b = this.barrels[num('i')];
        if (b && !b.dead && b.fuse <= 0) {
          b.hp -= num('d');
          if (b.hp <= 0) b.fuse = 0.05;
        }
      } else if (m.t === 'dep' && this.state === 'playing') {
        const k = String(m.k) as DeployKind;
        if (DEPLOY_KINDS.includes(k)) this.placeDeploy(k, { x: num('x'), y: num('y'), angle: num('a') });
      }
      return;
    }
    switch (m.t) {
      case 's':
        if (this.state === 'playing' || this.state === 'paused') this.applySnap(m);
        break;
      case 'wave':
        this.wave = num('w');
        this.beginWave();
        this.waveIntro((m.b as ZombieKind) || '', !!m.m);
        break;
      case 'clear':
        if (this.state === 'playing' || this.state === 'paused') {
          this.gainCash(num('c'));
          this.waveCleared();
        }
        break;
      case 'over':
        this.endRun();
        break;
      case 'kill': {
        const k = String(m.k) as ZombieKind;
        if (!ZOMBIES[k]) break;
        this.nadeBlast = !!m.n;
        this.cause = (m.c as '' | 'train' | 'barrel' | 'vent' | 'pin') || '';
        this.creditKill(k, !!m.e, num('x'), num('y'), ZOMBIES[k].radius);
        this.nadeBlast = false;
        this.cause = '';
        break;
      }
      case 'cash':
        this.gainCash(num('v'));
        this.sfx.play('coin');
        break;
      case 'heal':
        if (!this.down) this.heal(num('v'));
        break;
      case 'crate':
        this.openCrate({ x: this.p.x, y: this.p.y, vx: 0, vy: 0, kind: 'crate', value: num('l'), pulled: false });
        break;
      case 'pw':
        if (POWER_KINDS.includes(m.k as PowerKind)) this.activatePower(m.k as PowerKind);
        break;
      case 'hurt':
        this.hurtPlayer(num('a'), m.x === null ? null : { x: num('x'), y: num('y') }, this.p, m.kx || m.ky ? { x: num('kx'), y: num('ky') } : undefined);
        break;
      case 'revive':
        if (this.down) this.getUp(0.35);
        break;
      case 'web':
        this.webPlayer(this.p);
        break;
      case 'chill':
        this.chillPlayer(this.p, num('d'), num('k'));
        break;
      case 'yank':
        this.pullPlayer(this.p, num('x'), num('y'));
        break;
      case 'saved':
        this.report.teamRevives++;
        this.toast('🚑 You revived a teammate');
        break;
    }
  }

  /** Co-op guests: show the hit right away, and tell the host (who owns the zombie's real health). */
  private netHit(z: Zombie, dmg: number, angle: number, crit: boolean, knock: number, quiet: boolean, fx: number) {
    z.hp -= dmg;
    z.flash = 0.07;
    if (!quiet) {
      for (let i = 0; i < (crit ? 5 : 2); i++) this.spawnBlood(z.x, z.y, angle + rand(-0.6, 0.6), z.def.kind === 'bloater' ? '#6a8f10' : '#7a1010');
      if (crit || dmg >= 20) this.addText(z.x + rand(-8, 8), z.y - z.r - 4, String(Math.round(dmg)), crit ? '#ffd23f' : dmg >= 150 ? '#ffb347' : '#ffffff', clamp(11 + Math.sqrt(dmg) * (crit ? 1.2 : 0.7), 12, crit ? 30 : 22));
      this.sfx.play('hit');
    }
    this.netHits.push([z.id, Math.round(dmg * 10) / 10, Math.round(angle * 100) / 100, Math.round(knock), (crit ? 1 : 0) | (quiet ? 2 : 0) | fx]);
  }

  /** Co-op guests: glide the host's zombies and pickups between snapshots. */
  private updateMirror(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    for (const z of this.zombies) {
      if (z.flash > 0) z.flash -= dt;
      if (z.nx === undefined || z.ny === undefined) continue;
      const ox = z.x;
      const oy = z.y;
      z.x += (z.nx - z.x) * k;
      z.y += (z.ny - z.y) * k;
      z.phase += Math.hypot(z.x - ox, z.y - oy) * 0.08;
    }
    for (const pk of this.pickups) {
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
    }
    for (const pw of this.powers) pw.life -= dt;
  }

  /** Teammates: glide toward where they really are and fire tracers when they shoot. */
  private updateAllies(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    for (const a of this.allies) {
      a.x += (a.nx - a.x) * k;
      a.y += (a.ny - a.y) * k;
      if (a.grace > 0) a.grace -= dt;
      if (!a.firing || a.down) {
        a.fireT = Math.max(0, a.fireT - dt);
        continue;
      }
      a.fireT -= dt;
      if (a.fireT > 0) continue;
      const def = WEAPON_BY_ID.get(a.weapon);
      if (!def) continue;
      a.fireT = Math.max(0, a.fireT + 1 / def.fireRate);
      this.ghostShot(a, def);
    }
  }

  private ghostShot(a: Ally, def: WeaponDef) {
    const mx = a.x + Math.cos(a.angle) * (def.length + 4);
    const my = a.y + Math.sin(a.angle) * (def.length + 4);
    const kind = def.kind;
    if (kind === 'tesla') {
      const t = this.zombies.find((z) => Math.hypot(z.x - mx, z.y - my) < 360 && Math.cos(Math.atan2(z.y - my, z.x - mx) - a.angle) > 0.85);
      this.bolts.push({ x1: mx, y1: my, x2: t ? t.x : mx + Math.cos(a.angle) * 130, y2: t ? t.y : my + Math.sin(a.angle) * 130, life: 0.08, color: '#b8ecff' });
      this.addLight(mx, my, 160, 0.08, '#8ad8ff');
      this.sfx.play('tesla', 0.3);
      return;
    }
    if (def.beam || def.charge) {
      // Beam guns are drawn, not simulated: a line to the first wall (or zombie, for the plasma).
      let len = this.rayWall(mx, my, a.angle, def.beam ?? 1500);
      if (def.beam) {
        const ex = mx + Math.cos(a.angle) * len;
        const ey = my + Math.sin(a.angle) * len;
        for (const z of this.zombies) if (!z.dead && segDist(z.x, z.y, mx, my, ex, ey) < z.r) len = Math.min(len, Math.hypot(z.x - mx, z.y - my));
      }
      const x2 = mx + Math.cos(a.angle) * len;
      const y2 = my + Math.sin(a.angle) * len;
      this.beams.push(def.beam ? { x1: mx, y1: my, x2, y2, life: 0.075, max: 0.075, color: def.color, width: 5 } : { x1: mx, y1: my, x2, y2, life: 0.35, max: 0.35, color: def.color, width: 9 });
      this.addLight(mx, my, def.beam ? 120 : 220, 0.08, def.color);
      this.sfx.play(def.id as SfxKind, 0.3);
      return;
    }
    if (kind === 'grenade') {
      this.addLight(mx, my, 140, 0.07, '#b0ff7a');
      this.sfx.play('launcher', 0.3);
      return;
    }
    const n = kind === 'bullet' || def.homing ? def.pellets : 1;
    for (let i = 0; i < n; i++) {
      const ang = def.homing ? a.angle + (i - (n - 1) / 2) * 0.32 : a.angle + rand(-def.spread / 2, def.spread / 2);
      const sp = def.speed * rand(0.92, 1.05);
      const spray = kind === 'flame' || kind === 'frost';
      this.bullets.push({ kind, x: mx, y: my, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, dmg: 0, life: def.life * (spray ? rand(0.8, 1.1) : 1), max: def.life, pierce: 0, ricochet: 0, hits: [], color: def.color, width: def.width ?? 2.5, canExplode: false, bounce: def.bounce, goo: def.goo, homing: def.homing, blast: def.blast, boomerang: def.boomerang, harpoon: def.harpoon, charm: def.charm, ghost: true });
    }
    if (kind === 'flame' || kind === 'frost') {
      if (Math.random() < 0.3) this.addLight(mx, my, 130, 0.12, kind === 'flame' ? '#ff7a20' : '#7fd8ff');
      this.sfx.play(kind === 'flame' ? 'flamer' : 'freeze', 0.3);
      return;
    }
    this.addLight(mx, my, kind === 'rocket' ? 220 : 160, 0.06, '#ffb050');
    this.sfx.play(def.id as SfxKind, 0.3);
  }

  /** Host: downed players get back up after a teammate stands next to them for a few seconds. */
  private updateRevives(dt: number) {
    const all: { id: string; x: number; y: number; down: boolean; ally: Ally | null }[] = [{ id: this.myId, x: this.p.x, y: this.p.y, down: this.down, ally: null }, ...this.allies.map((a) => ({ id: a.id, x: a.x, y: a.y, down: a.down, ally: a }))];
    for (const d of all) {
      if (!d.down) continue;
      const helper = all.find((o) => !o.down && Math.hypot(o.x - d.x, o.y - d.y) < REVIVE_RANGE);
      let prog = d.ally ? d.ally.revive : this.reviveProg;
      prog = helper ? prog + dt / REVIVE_TIME : Math.max(0, prog - dt / REVIVE_TIME);
      if (prog >= 1 && helper) {
        prog = 0;
        if (d.ally) {
          d.ally.down = false;
          d.ally.grace = 1.5;
          this.netSend?.(d.ally.id, { t: 'revive' });
          this.addText(d.x, d.y - 30, `${d.ally.name} IS BACK UP`, '#5dff7a', 14);
        } else this.getUp(0.35);
        if (helper.ally) this.netSend?.(helper.ally.id, { t: 'saved' });
        else {
          this.report.teamRevives++;
          this.toast('🚑 You revived a teammate');
        }
      }
      if (d.ally) d.ally.revive = prog;
      else this.reviveProg = prog;
    }
    // Everyone down: that's the run.
    if (this.down && this.allies.every((a) => a.down)) this.endRun();
  }

  // ---------------------------------------------------------------- render

  render(dt: number) {
    const ctx = this.ctx;
    if (this.state === 'playing' && dt > 0) {
      // Watch the frame rate; if the horde is dragging it down for a couple of
      // seconds, switch to lighter zombies for the rest of the run.
      this.frameAvg += (dt - this.frameAvg) * 0.05;
      this.lagT = this.frameAvg > 1 / 45 && this.zombies.length > 25 ? this.lagT + dt : 0;
      if (this.lagT > 2) this.liteZombies = true;
    }
    const p = this.p;
    const playing = this.state !== 'menu';
    if (playing) {
      // Camera leads a little toward where you aim.
      const lead = this.state === 'playing' ? 60 : 0;
      let tx = p.x + Math.cos(p.angle) * lead;
      let ty = p.y + Math.sin(p.angle) * lead;
      // Kill cam: drift toward a dying boss while time is slowed.
      if (this.killCam.t > 0) {
        this.killCam.t -= dt;
        tx = (p.x + this.killCam.x * 2) / 3;
        ty = (p.y + this.killCam.y * 2) / 3;
      }
      const k = 1 - Math.exp(-dt * 6);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }
    const zoom = this.zoom * (1 + this.zoomKick) * (playing ? 1 : 0.85);
    const sh = this.trauma * this.trauma * 16;
    const sx = rand(-sh, sh);
    const sy = rand(-sh, sh);
    const world = (c: CanvasRenderingContext2D, scale: number) => {
      c.setTransform(scale, 0, 0, scale, 0, 0);
      c.translate(this.w / 2 + sx, this.h / 2 + sy);
      c.scale(zoom, zoom);
      c.translate(-this.cam.x, -this.cam.y);
    };

    // 1. The world, lit normally
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, this.w, this.h);
    world(ctx, this.dpr);
    ctx.drawImage(this.ground, 0, 0, WORLD_W, WORLD_H);
    ctx.drawImage(this.decals, 0, 0, WORLD_W, WORLD_H);
    this.drawGates();
    this.drawVents();
    this.drawLabFloor();
    this.drawPuddles();
    this.drawPickups();
    this.drawBarrels();
    this.drawDeploys();
    for (const z of this.zombies) if (!z.latch) this.drawZombie(z);
    if (this.state !== 'over' && playing) {
      this.drawAllies();
      this.drawPlayer();
    }
    // Parasites riding you sit on top of you.
    for (const z of this.zombies) if (z.latch) this.drawZombie(z);
    this.drawTrains();
    this.drawGrenades();
    for (const q of this.particles) {
      if (q.glow) continue;
      ctx.globalAlpha = Math.min(1, q.life / q.max + 0.3);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
    this.drawWalls();
    this.drawLampPosts();

    // 2. Darkness with holes cut out for every light source
    this.drawDarkness(world, zoom);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.light, 0, 0, this.w, this.h);

    // 3. Additive glow pass: tracers, fire, eyes, explosions
    world(ctx, this.dpr);
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow();
    ctx.globalCompositeOperation = 'source-over';
    this.drawTelegraphs();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 3);
      ctx.font = `800 ${t.size}px system-ui, sans-serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(t.text, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    if (playing && this.state !== 'over') this.drawAllyTags();

    // 4. Screen-space overlays and HUD
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.clean) return;
    this.drawScreenFx();
    if (playing) this.drawHud();
  }

  /** The current scene without HUD or screen flashes, for the share card. */
  snapshot(): HTMLCanvasElement {
    this.clean = true;
    this.render(0);
    this.clean = false;
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return c;
  }

  private drawDarkness(world: (c: CanvasRenderingContext2D, s: number) => void, zoom: number) {
    const l = this.lctx;
    const p = this.p;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, this.light.width, this.light.height);
    const tint = this.active.freeze > 0 ? '6,14,26' : this.active.rage > 0 ? '22,4,4' : this.power.out > 0 ? '14,2,4' : '3,5,10';
    l.fillStyle = `rgba(${tint},${DARKNESS})`;
    l.fillRect(0, 0, this.light.width, this.light.height);
    l.globalCompositeOperation = 'destination-out';
    world(l, 0.5);
    const hole = (x: number, y: number, r: number, a: number) => {
      l.globalAlpha = clamp(a, 0, 1);
      l.drawImage(glowSprite('#000000'), x - r, y - r, r * 2, r * 2);
      l.globalAlpha = 1;
    };
    const powerOut = this.power.out > 0;
    for (const lamp of this.map.lamps) {
      if (powerOut) {
        // Emergency lights only: a dim red pool that rotates.
        hole(lamp.x + Math.cos(this.clock * 3 + lamp.x) * 40, lamp.y + Math.sin(this.clock * 3 + lamp.x) * 40, 150, 0.35);
        continue;
      }
      let a = 0.9;
      if (lamp.flicker) {
        const f = Math.sin(this.clock * 23 + lamp.x) + Math.sin(this.clock * 7.3 + lamp.y);
        a = f > 1.6 ? 0.15 : 0.85;
      }
      hole(lamp.x, lamp.y, 260, a);
    }
    for (const lt of this.lights) hole(lt.x, lt.y, lt.r * (0.6 + 0.4 * (lt.life / lt.max)), Math.min(1, (lt.life / lt.max) * 1.4));
    for (const pw of this.powers) hole(pw.x, pw.y, 90, 0.7);
    for (const c of this.consoles) {
      if (!powerOut) hole(c.x, c.y, 90, 0.5);
      if (c.phase === 'sweep') {
        // The laser lights up a band across the map.
        l.globalAlpha = 0.7;
        if (c.axis === 'x') l.drawImage(glowSprite('#000000'), c.pos - 90, 0, 180, WORLD_H);
        else l.drawImage(glowSprite('#000000'), 0, c.pos - 90, WORLD_W, 180);
        l.globalAlpha = 1;
      }
    }
    for (const dv of this.opS.drives) hole(dv.x, dv.y, 80, 0.6);
    if (this.opS.gen) hole(this.opS.gen.x, this.opS.gen.y, 170, 0.7);
    if (this.opS.zone) hole(this.opS.zone.x, this.opS.zone.y, this.opS.zone.r * 1.5, 0.6);
    for (const z of this.zombies) {
      if (z.zero && z.zero.laserT > 0) hole(z.x + Math.cos(z.zero.laserA) * 300, z.y + Math.sin(z.zero.laserA) * 300, 260, 0.6);
    }
    const cone = (x: number, y: number, ang: number, len: number, half: number, a: number) => {
      const g = l.createRadialGradient(x, y, 10, x, y, len);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.65, `rgba(0,0,0,${a * 0.75})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.beginPath();
      l.moveTo(x, y);
      l.arc(x, y, len, ang - half, ang + half);
      l.closePath();
      l.fill();
    };
    if (this.state === 'menu') {
      // Sweeping searchlight on the title screen
      const sa = this.clock * 0.6;
      cone(WORLD_W / 2, WORLD_H / 2, sa, 900, 0.3, 0.95);
      cone(WORLD_W / 2, WORLD_H / 2, sa + Math.PI, 900, 0.3, 0.95);
    } else if (this.state !== 'over') {
      const fl = FLASHLIGHT * (this.has('dark') ? 0.55 : 1);
      // Teammates carry lights too, so you can see them (and what they're fighting).
      for (const a of this.allies) {
        hole(a.x, a.y, 120, 0.7);
        if (!a.down) cone(a.x, a.y, a.angle, fl * 0.9, 0.42, 0.75);
      }
      hole(p.x, p.y, 150, 0.85);
      if (!this.down) {
        cone(p.x, p.y, p.angle, fl * 1.1, 0.75, 0.4);
        cone(p.x, p.y, p.angle, fl, 0.42, 0.95);
      }
    }
    void zoom;
  }

  private drawGlow() {
    const ctx = this.ctx;
    const glowDot = (x: number, y: number, r: number, color: string, a: number) => {
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    };
    // Colored light tints
    for (const lt of this.lights) glowDot(lt.x, lt.y, lt.r * 0.7, lt.color, 0.35 * (lt.life / lt.max));
    for (const lamp of this.map.lamps) {
      if (this.power.out > 0) glowDot(lamp.x + Math.cos(this.clock * 3 + lamp.x) * 40, lamp.y + Math.sin(this.clock * 3 + lamp.x) * 40, 140, '#ff2020', 0.2);
      else glowDot(lamp.x, lamp.y, 120, '#ffcf7a', 0.12);
    }
    for (const c of this.consoles) if (c.phase === 'idle' && c.cd <= 0 && this.power.out <= 0) glowDot(c.x, c.y, 70, '#ff3a5a', 0.2 + 0.1 * Math.sin(this.clock * 5));
    for (const dv of this.opS.drives) glowDot(dv.x, dv.y, 40, '#5dff7a', 0.3 + 0.2 * (Math.floor(this.clock * 4) % 2));
    for (const v of this.vents) {
      if (v.phase === 'blast') {
        glowDot(v.x, v.y, VENT_R * 1.7, '#e8f4ff', 0.45 + 0.15 * Math.sin(this.clock * 40));
        glowDot(v.x, v.y - 30, VENT_R * 1.2, '#ffffff', 0.3);
      } else if (v.phase === 'warn') glowDot(v.x, v.y, VENT_R * 1.2, '#ffd23f', 0.12 + 0.1 * (Math.floor(this.clock * 8) % 2));
    }
    ctx.globalAlpha = 1;

    // Zombie eyes glow in the dark
    for (const z of this.zombies) {
      const r = z.r;
      const c = Math.cos(z.face);
      const s = Math.sin(z.face);
      const [fwd, side] = eyeSpot(z.def.kind);
      const ex = z.x + c * r * fwd;
      const ey = z.y + s * r * fwd;
      const ox = -s * r * side;
      const oy = c * r * side;
      if (this.crawlerAlpha(z) < 0.6 || z.lurk) continue;
      if (z.def.kind !== 'egg') {
        // Two hot pinpricks in the eye sockets
        ctx.fillStyle = this.active.freeze > 0 ? '#9fe8ff' : z.def.eye;
        const es = Math.max(1, r * 0.065);
        ctx.fillRect(ex + ox - es, ey + oy - es, es * 2, es * 2);
        ctx.fillRect(ex - ox - es, ey - oy - es, es * 2, es * 2);
        glowDot(ex, ey, r * 0.9, z.def.eye, 0.25);
      }
      if (z.def.kind === 'bloater') glowDot(z.x, z.y, r * 1.8, '#9aff3a', 0.18 + 0.08 * Math.sin(this.clock * 6 + z.id));
      if (z.burn > 0) glowDot(z.x, z.y, r * 2, '#ff6a1f', 0.35);
      if (z.elite) glowDot(z.x, z.y, r * 2.2, ELITES[z.elite].color, 0.22);
      if (z.buff > 0) glowDot(z.x, z.y, r * 1.8, '#ff3050', 0.3 + 0.1 * Math.sin(this.clock * 14 + z.id));
      if (z.def.kind === 'necro') glowDot(z.x, z.y, r * 2.4, '#5dffb0', 0.2);
      if (z.def.kind === 'electric') glowDot(z.x, z.y, r * (z.zapT > 0 ? 3.2 : 2), '#8ad8ff', z.zapT > 0 ? 0.5 : 0.22);
      if (z.def.kind === 'bomber') glowDot(z.x, z.y, r * (z.fuse > 0 ? 3 : 1.6), '#ff4a2a', z.fuse > 0 ? 0.35 + 0.25 * (Math.floor(this.clock * 24) % 2) : 0.15);
      if (z.def.kind === 'wraith') glowDot(z.x, z.y, r * 2.2, '#7affea', 0.16);
      if (z.def.kind === 'reaper') glowDot(z.x, z.y, r * 2.6, '#7affea', 0.14 + 0.06 * Math.sin(this.clock * 4));
      if (z.def.kind === 'medic') glowDot(z.x, z.y, r * 2.2, '#5dff7a', 0.14 + 0.1 * Math.max(0, 1 - z.abilityCd));
      if (z.def.kind === 'icer') glowDot(z.x, z.y, r * 2, '#bfe8ff', 0.16);
      if (z.def.kind === 'titan') glowDot(z.x, z.y, r * (z.titan && z.titan.windup > 0 ? 3.4 : 2.2), '#bfe8ff', z.titan && z.titan.windup > 0 ? 0.4 + 0.15 * Math.sin(this.clock * 30) : 0.16);
      if (z.def.kind === 'sludger' || z.def.kind === 'sludge') glowDot(z.x, z.y, r * 2, '#c8ff3a', 0.14 + 0.05 * Math.sin(this.clock * 5 + z.id));
      if (z.def.kind === 'juggernaut') glowDot(z.x - Math.cos(z.face) * r * 0.62, z.y - Math.sin(z.face) * r * 0.62, r * 0.9, '#ffa040', 0.5);
      if (z.frozenT > 0) glowDot(z.x, z.y, r * 2, '#9fe8ff', 0.25);
      if (z.charm > 0) glowDot(z.x, z.y, r * 2.2, '#b060ff', 0.3 + 0.1 * Math.sin(this.clock * 8 + z.id));
      if (z.healing) glowDot(z.x, z.y, r * 2.2, '#7aff5a', 0.2 + 0.12 * Math.sin(this.clock * 10 + z.id));
      if (z.def.kind === 'psyker') glowDot(z.x, z.y, r * ((z.yank?.windup ?? 0) > 0 ? 3.4 : 2.2), '#e08aff', (z.yank?.windup ?? 0) > 0 ? 0.45 : 0.18);
      if (z.def.kind === 'blob') glowDot(z.x, z.y, r * 1.6, '#7ad8b0', 0.12);
      if (z.zero) {
        glowDot(z.x - Math.cos(z.face) * r * 0.5, z.y - Math.sin(z.face) * r * 0.5, r * 0.9, '#ff5adc', 0.35 + 0.15 * Math.sin(this.clock * 4));
        if (z.zero.trans > 0) glowDot(z.x, z.y, r * 3, '#ff5adc', 0.4);
        if (z.zero.phase === 3) glowDot(z.x + Math.cos(z.face) * r * 0.05, z.y + Math.sin(z.face) * r * 0.05, r * 0.8, '#ff3ad0', 0.5);
      }
      if (z.def.kind === 'brood' && this.countKind('egg') > 0) glowDot(z.x, z.y, r * 1.9, '#ffcf5a', 0.2 + 0.08 * Math.sin(this.clock * 5));
    }
    ctx.globalAlpha = 1;

    // Bullets, flames, rockets
    ctx.lineCap = 'round';
    for (const b of this.bullets) {
      if (b.kind === 'flame' || b.kind === 'frost') {
        const t = 1 - b.life / b.max;
        const r = 6 + t * 22;
        if (b.kind === 'flame') glowDot(b.x, b.y, r, t < 0.3 ? '#ffe08a' : t < 0.65 ? '#ff8a2b' : '#c0301a', 0.55 * (1 - t * 0.6));
        else glowDot(b.x, b.y, r, t < 0.4 ? '#ffffff' : '#7fd8ff', 0.5 * (1 - t * 0.6));
        continue;
      }
      if (b.kind === 'rocket') {
        const a = Math.atan2(b.vy, b.vx);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.fillStyle = b.homing ? '#ffd0b0' : '#c8c8c8';
        if (b.homing) ctx.fillRect(-6, -2, 11, 4);
        else ctx.fillRect(-9, -3, 16, 6);
        ctx.restore();
        glowDot(b.x - Math.cos(a) * (b.homing ? 7 : 10), b.y - Math.sin(a) * (b.homing ? 7 : 10), b.homing ? 14 : 22, b.homing ? '#ff8a4a' : '#ffb347', 0.8);
        continue;
      }
      if (b.charm) {
        // Mind Ray: a wobbling violet orb with a short trail.
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f0d8ff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3.5 + Math.sin(this.clock * 30) * 0.8, 0, Math.PI * 2);
        ctx.fill();
        glowDot(b.x, b.y, 16, '#c77dff', 0.75);
        glowDot(b.x - b.vx * 0.02, b.y - b.vy * 0.02, 10, '#8a4aff', 0.4);
        continue;
      }
      if (b.goo) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#b6ff5a';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
        ctx.fill();
        glowDot(b.x, b.y, 18, '#9aff3a', 0.7);
        continue;
      }
      if (b.boomerang) {
        // Spinning glaive: three curved blades.
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(this.clock * 24);
        ctx.fillStyle = b.color;
        for (let i = 0; i < 3; i++) {
          ctx.rotate((Math.PI * 2) / 3);
          ctx.beginPath();
          ctx.moveTo(0, -2.5);
          ctx.quadraticCurveTo(9, -8, 15, 0);
          ctx.quadraticCurveTo(8, -2, 0, 2.5);
          ctx.fill();
        }
        ctx.fillStyle = '#5a6a78';
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        glowDot(b.x, b.y, 20, '#bfe8ff', 0.4);
        continue;
      }
      if (b.harpoon) {
        const a = Math.atan2(b.vy, b.vx);
        ctx.globalAlpha = 1;
        if (!b.ghost) {
          // The line back to the gun.
          const p = this.p;
          ctx.strokeStyle = 'rgba(220,210,180,0.55)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(p.angle) * 30, p.y + Math.sin(p.angle) * 30);
          ctx.quadraticCurveTo((p.x + b.x) / 2 + Math.sin(a) * 14, (p.y + b.y) / 2 - Math.cos(a) * 14, b.x, b.y);
          ctx.stroke();
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.fillStyle = '#8a6a4a';
        ctx.fillRect(-26, -1.5, 24, 3);
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, -5);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, 5);
        ctx.fill();
        ctx.restore();
        glowDot(b.x, b.y, 12, '#ffffff', 0.35);
        continue;
      }
      if (b.bounce !== undefined) {
        // Spinning saw disc
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(this.clock * 30);
        ctx.fillStyle = b.color;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const rr = i % 2 ? 5 : 8;
          const a = (i / 16) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.fill();
        ctx.fillStyle = '#555';
        ctx.fillRect(-1.5, -1.5, 3, 3);
        ctx.restore();
        glowDot(b.x, b.y, 16, '#ffffff', 0.35);
        continue;
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.025, b.y - b.vy * 0.025);
      ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = b.width * 3.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Lightning: a fresh jagged path every frame so it flickers.
    for (const bo of this.bolts) {
      const dx = bo.x2 - bo.x1;
      const dy = bo.y2 - bo.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const segs = Math.max(3, Math.round(len / 22));
      ctx.beginPath();
      ctx.moveTo(bo.x1, bo.y1);
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const off = rand(-14, 14);
        ctx.lineTo(bo.x1 + dx * t + nx * off, bo.y1 + dy * t + ny * off);
      }
      ctx.lineTo(bo.x2, bo.y2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = bo.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.globalAlpha = 1;
      glowDot(bo.x2, bo.y2, 26, bo.color, 0.6);
    }
    ctx.globalAlpha = 1;

    // Railgun slugs and plasma beams
    for (const bm of this.beams) {
      const k = bm.life / bm.max;
      ctx.globalAlpha = k;
      ctx.strokeStyle = bm.color;
      ctx.lineWidth = bm.width * (0.6 + 0.4 * k);
      ctx.beginPath();
      ctx.moveTo(bm.x1, bm.y1);
      ctx.lineTo(bm.x2, bm.y2);
      ctx.stroke();
      ctx.globalAlpha = k * 0.35;
      ctx.lineWidth = bm.width * 3;
      ctx.stroke();
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, bm.width * 0.3);
      ctx.stroke();
      glowDot(bm.x2, bm.y2, bm.width * 3, bm.color, 0.6 * k);
    }
    ctx.globalAlpha = 1;
    // Lab laser sweeps: a wall of red light crossing the map.
    for (const c of this.consoles) {
      if (c.phase !== 'sweep') continue;
      const w = 20 + Math.sin(this.clock * 50) * 3;
      ctx.fillStyle = 'rgba(255,40,70,0.35)';
      if (c.axis === 'x') ctx.fillRect(c.pos - w, BORDER, w * 2, WORLD_H - BORDER * 2);
      else ctx.fillRect(BORDER, c.pos - w, WORLD_W - BORDER * 2, w * 2);
      ctx.fillStyle = 'rgba(255,220,230,0.9)';
      if (c.axis === 'x') ctx.fillRect(c.pos - 2.5, BORDER, 5, WORLD_H - BORDER * 2);
      else ctx.fillRect(BORDER, c.pos - 2.5, WORLD_W - BORDER * 2, 5);
    }
    // Patient Zero's eye beam
    for (const z of this.zombies) {
      const Z = z.zero;
      if (!Z || Z.laserT <= 0) continue;
      const ex = z.x + Math.cos(Z.laserA) * z.r * 0.6;
      const ey = z.y + Math.sin(Z.laserA) * z.r * 0.6;
      const len = this.rayWall(ex, ey, Z.laserA, 760);
      const x2 = ex + Math.cos(Z.laserA) * len;
      const y2 = ey + Math.sin(Z.laserA) * len;
      ctx.strokeStyle = '#ff3ad0';
      ctx.lineWidth = 26 + Math.sin(this.clock * 60) * 4;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#ffd0f4';
      ctx.stroke();
      glowDot(x2, y2, 50, '#ff5adc', 0.8);
      glowDot(ex, ey, 40, '#ffffff', 0.6);
    }
    // Erupting tendrils glow at the tips
    for (const s of this.spikes) if (s.t <= 0) glowDot(s.x2, s.y2, 30, '#ff5adc', 0.4 * (1 + s.t / SPIKE_LIFE));
    // Railgun charging glow at your muzzle
    if (this.charge > 0 && this.state === 'playing') {
      const w = this.weapons[this.wi];
      glowDot(this.p.x + Math.cos(this.p.angle) * (w.def.length + 4), this.p.y + Math.sin(this.p.angle) * (w.def.length + 4), 10 + this.charge * 26, '#7ae8ff', 0.5 + this.charge * 0.4);
    }

    // Spit
    for (const s of this.spits) glowDot(s.x, s.y, s.soul ? 18 : s.shard ? 11 : 14, s.soul ? '#7affea' : s.web ? '#e8e8ff' : s.shard ? '#dff6ff' : '#c060ff', 0.9);
    for (const n of this.novas) {
      // Frost nova: a bright ring of cold rolling outward.
      const fade = 1 - n.r / n.max;
      ctx.globalAlpha = 0.25 + 0.6 * fade;
      ctx.strokeStyle = '#dff6ff';
      ctx.lineWidth = NOVA_W * 1.4;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.9 * fade + 0.1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const v of this.vortexes) {
      const k = Math.min(1, (v.max - v.t) * 4) * (v.t < 0.2 ? 1.6 : 1);
      glowDot(v.x, v.y, 90 * k, '#a060ff', 0.55);
      glowDot(v.x, v.y, 40 * k, '#ffffff', 0.35);
    }
    for (const m of this.mortars) {
      const q = 1 - m.t / m.max;
      glowDot(m.sx + (m.x - m.sx) * q, m.sy + (m.y - m.sy) * q - Math.sin(q * Math.PI) * (m.ice ? 300 : 240), m.ice ? 34 : 26, m.ice ? '#bfe8ff' : '#c8ff3a', 0.8);
    }

    // Glowing particles (sparks, fire, muzzle flashes)
    for (const q of this.particles) {
      if (!q.glow) continue;
      ctx.globalAlpha = Math.min(1, q.life / q.max + 0.2);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Coins glint
    for (const pk of this.pickups) if (pk.kind === 'cash') glowDot(pk.x, pk.y, 14, '#ffd23f', 0.35);

    // Power-ups
    for (const pw of this.powers) {
      if (pw.life < 3 && Math.floor(pw.life * 8) % 2 === 0) continue;
      const def = POWERUPS[pw.kind];
      const bob = Math.sin(this.clock * 4 + pw.x) * 4;
      glowDot(pw.x, pw.y + bob, 60, def.color, 0.55);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(pw.x, pw.y + bob);
      ctx.rotate(this.clock * 1.5);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) ctx.lineTo(Math.cos((i / 6) * Math.PI * 2) * 20, Math.sin((i / 6) * Math.PI * 2) * 20);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = `900 18px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, pw.x, pw.y + bob + 1);
    }

    // Shock rings
    for (const r of this.rings) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `${r.color}${Math.max(0, r.life * 2).toFixed(2)})`;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Saw blades glint, drones, rage aura
    const p = this.p;
    for (let i = 0; i < this.stats.drones; i++) {
      const d = this.dronePos(i);
      glowDot(d.x, d.y, 16, '#7ef0ff', 0.6);
    }
    if (this.active.rage > 0 && this.state === 'playing') glowDot(p.x, p.y, 50, '#ff2a2a', 0.35 + 0.15 * Math.sin(this.clock * 12));
    ctx.globalAlpha = 1;
    // Laser sight
    if (this.state === 'playing' && !this.down) {
      const w = this.weapons[this.wi];
      if (w.def.kind !== 'flame' && w.def.kind !== 'frost') {
        const mx = p.x + Math.cos(p.angle) * (w.def.length + 4);
        const my = p.y + Math.sin(p.angle) * (w.def.length + 4);
        const g = ctx.createLinearGradient(mx, my, mx + Math.cos(p.angle) * 260, my + Math.sin(p.angle) * 260);
        g.addColorStop(0, 'rgba(255,40,40,0.45)');
        g.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + Math.cos(p.angle) * 260, my + Math.sin(p.angle) * 260);
        ctx.stroke();
      }
    }
  }

  private drawTelegraphs() {
    const ctx = this.ctx;
    for (const z of this.zombies) {
      if (z.boss?.state !== 'windup') continue;
      const a = z.face;
      ctx.strokeStyle = `rgba(255,40,40,${0.3 + 0.3 * Math.sin(this.clock * 30)})`;
      ctx.lineWidth = z.r * 1.6;
      ctx.beginPath();
      ctx.moveTo(z.x, z.y);
      ctx.lineTo(z.x + Math.cos(a) * 430, z.y + Math.sin(a) * 430);
      ctx.stroke();
    }
    for (const z of this.zombies) {
      if (z.leap?.state !== 'crouch') continue;
      ctx.strokeStyle = `rgba(255,220,60,${0.25 + 0.25 * Math.sin(this.clock * 30)})`;
      ctx.lineWidth = z.r * 1.4;
      ctx.beginPath();
      ctx.moveTo(z.x, z.y);
      const len = z.def.kind === 'roller' ? 560 : 300;
      ctx.lineTo(z.x + z.leap.dx * len, z.y + z.leap.dy * len);
      ctx.stroke();
    }
    for (const z of this.zombies) {
      if (!z.jug || z.jug.windup <= 0) continue;
      ctx.strokeStyle = `rgba(255,120,60,${0.35 + 0.3 * Math.sin(this.clock * 30)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(z.x, z.y, 240 * (1 - z.jug.windup / 0.9 * 0.3), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,90,40,0.08)';
      ctx.fill();
    }
    for (const z of this.zombies) {
      if (z.reap && z.reap.windup > 0) {
        const a = z.reap.aim;
        ctx.fillStyle = `rgba(122,255,234,${0.12 + 0.1 * Math.sin(this.clock * 30)})`;
        ctx.strokeStyle = 'rgba(122,255,234,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(z.x, z.y);
        ctx.arc(z.x, z.y, SWEEP_R, a - SWEEP_ARC, a + SWEEP_ARC);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      if (z.dig?.state === 'rise' || z.fuse > 0) {
        const R = z.fuse > 0 ? 125 : 80;
        ctx.strokeStyle = `rgba(255,${z.fuse > 0 ? 60 : 170},40,${0.4 + 0.3 * Math.sin(this.clock * 30)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(z.x, z.y, R, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const m of this.mortars) {
      const q = 1 - m.t / m.max;
      const R = m.ice ? BOULDER_R : MORTAR_R;
      const rgb = m.ice ? '200,236,255' : '200,255,60';
      ctx.fillStyle = `rgba(${rgb},${0.08 + 0.2 * q})`;
      ctx.strokeStyle = `rgba(${rgb},${0.5 + 0.3 * Math.sin(this.clock * 30)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(m.x, m.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(m.x, m.y, R * q, 0, Math.PI * 2);
      ctx.stroke();
      // The glob (or boulder) itself, arcing in.
      const gx = m.sx + (m.x - m.sx) * q;
      const gy = m.sy + (m.y - m.sy) * q - Math.sin(q * Math.PI) * (m.ice ? 300 : 240);
      ctx.fillStyle = m.ice ? '#a8c8dc' : '#7a9a20';
      ctx.beginPath();
      if (m.ice) {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + q * 6;
          const rr = 17 + (i % 2) * 5;
          ctx.lineTo(gx + Math.cos(a) * rr, gy + Math.sin(a) * rr);
        }
      } else ctx.arc(gx, gy, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const z of this.zombies) {
      if (!z.titan || z.titan.windup <= 0) continue;
      // Frost gathering before a nova: the ring that's about to roll out.
      ctx.strokeStyle = `rgba(200,236,255,${0.35 + 0.3 * Math.sin(this.clock * 30)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r * 1.5 + 10 * Math.sin(this.clock * 20), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.chillT > 0 && this.state === 'playing' && !this.down) {
      // Frost creeping over you while you're chilled.
      const p = this.p;
      ctx.strokeStyle = `rgba(200,236,255,${Math.min(0.7, this.chillT)})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + this.clock * 0.5;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14);
        ctx.lineTo(p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 26);
        ctx.moveTo(p.x + Math.cos(a) * 21, p.y + Math.sin(a) * 21);
        ctx.lineTo(p.x + Math.cos(a + 0.25) * 25, p.y + Math.sin(a + 0.25) * 25);
        ctx.stroke();
      }
    }
    for (const v of this.vortexes) {
      const k = Math.min(1, (v.max - v.t) * 4);
      ctx.fillStyle = '#05000a';
      ctx.strokeStyle = '#d0a0ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(v.x, v.y, 18 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(192,138,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, VORTEX_R * k * (1 - ((this.clock * 1.5 + i / 3) % 1)), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.webT > 0 && this.state === 'playing' && !this.down) {
      // Sticky strands around you while you're webbed.
      const p = this.p;
      ctx.strokeStyle = `rgba(235,235,255,${Math.min(0.7, this.webT)})`;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30);
        ctx.stroke();
      }
      for (const rr of [12, 22]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Tendrils: a cracked red line first, then a row of bone spikes.
    for (const s of this.spikes) {
      const dx = s.x2 - s.x1;
      const dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      if (s.t > 0) {
        const q = 1 - s.t / SPIKE_WARN;
        // A crack that widens and brightens until the bone bursts out.
        ctx.strokeStyle = `rgba(255,40,80,${0.12 + 0.38 * q + 0.1 * Math.sin(this.clock * 40)})`;
        ctx.lineWidth = SPIKE_W * (0.3 + 0.7 * q);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x1 + dx * Math.min(1, q * 2.5), s.y1 + dy * Math.min(1, q * 2.5));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(40,0,10,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k <= len * Math.min(1, q * 2.5); k += 18) ctx.lineTo(s.x1 + (dx / len) * k + nx * Math.sin(k * 0.7) * 6, s.y1 + (dy / len) * k + ny * Math.sin(k * 0.7) * 6);
        ctx.stroke();
        continue;
      }
      const up = Math.min(1, -s.t / 0.08) * Math.min(1, (SPIKE_LIFE + s.t) / 0.15);
      for (let k = 14; k < len; k += 22) {
        const cx = s.x1 + (dx / len) * k;
        const cy = s.y1 + (dy / len) * k;
        const h = (22 + ((k * 7) % 13)) * up;
        const side = (k / 22) % 2 ? 1 : -1;
        const tx = cx + nx * side * 6 + (dx / len) * 4;
        const ty = cy + ny * side * 6 + (dy / len) * 4;
        ctx.fillStyle = '#5a1a24';
        ctx.beginPath();
        ctx.moveTo(cx - (dx / len) * 9, cy - (dy / len) * 9);
        ctx.lineTo(tx + nx * side * h * 0.3, ty + ny * side * h * 0.3 - h * 0.9);
        ctx.lineTo(cx + (dx / len) * 9, cy + (dy / len) * 9);
        ctx.fill();
        ctx.fillStyle = '#f0e4c8';
        ctx.beginPath();
        ctx.moveTo(tx + nx * side * h * 0.3 - 3, ty + ny * side * h * 0.3 - h * 0.55);
        ctx.lineTo(tx + nx * side * h * 0.3, ty + ny * side * h * 0.3 - h * 0.9);
        ctx.lineTo(tx + nx * side * h * 0.3 + 3, ty + ny * side * h * 0.3 - h * 0.55);
        ctx.fill();
      }
    }
    // Psychic tethers while a Psyker (or Patient Zero) gets ready to yank.
    for (const z of this.zombies) {
      const w = (z.yank?.windup ?? 0) > 0 ? z.yank!.windup / 0.9 : z.zero && z.zero.yankT > 0 ? z.zero.yankT : -1;
      if (w < 0) continue;
      const to = z.yank && this.net !== 'client' ? [{ x: z.yank.tx, y: z.yank.ty }] : this.targets().filter((t) => Math.hypot(t.x - z.x, t.y - z.y) < 650);
      for (const t of to) {
        ctx.strokeStyle = `rgba(224,138,255,${0.35 + 0.4 * (1 - w)})`;
        ctx.lineWidth = 2 + 3 * (1 - w);
        ctx.setLineDash([8, 8]);
        ctx.lineDashOffset = this.clock * 60;
        ctx.beginPath();
        ctx.moveTo(z.x, z.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.strokeStyle = 'rgba(224,138,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 22 + 10 * w, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Patient Zero aiming its eye
    for (const z of this.zombies) {
      const Z = z.zero;
      if (!Z || Z.laserW <= 0) continue;
      ctx.strokeStyle = `rgba(255,58,208,${0.3 + 0.3 * Math.sin(this.clock * 30)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(z.x, z.y);
      ctx.lineTo(z.x + Math.cos(Z.laserA) * 760, z.y + Math.sin(Z.laserA) * 760);
      ctx.stroke();
      // Show which way it will sweep.
      ctx.fillStyle = 'rgba(255,58,208,0.1)';
      ctx.beginPath();
      ctx.moveTo(z.x, z.y);
      ctx.arc(z.x, z.y, 700, Math.min(Z.laserA, Z.laserA + Z.laserDir * 1.95), Math.max(Z.laserA, Z.laserA + Z.laserDir * 1.95));
      ctx.closePath();
      ctx.fill();
    }
    // Laser grid warming up: a flashing line where the beam will start.
    for (const c of this.consoles) {
      if (c.phase !== 'warn') continue;
      const on = Math.floor(this.clock * 10) % 2 === 0;
      ctx.strokeStyle = on ? 'rgba(255,40,70,0.8)' : 'rgba(255,40,70,0.25)';
      ctx.lineWidth = 4;
      ctx.setLineDash([20, 14]);
      ctx.beginPath();
      if (c.axis === 'x') {
        ctx.moveTo(c.pos, BORDER);
        ctx.lineTo(c.pos, WORLD_H - BORDER);
      } else {
        ctx.moveTo(BORDER, c.pos);
        ctx.lineTo(WORLD_W - BORDER, c.pos);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Railgun charge ring
    if (this.charge > 0 && this.state === 'playing' && !this.down) {
      ctx.strokeStyle = this.charge >= 0.95 ? '#ffffff' : '#7ae8ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.p.x, this.p.y, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.charge);
      ctx.stroke();
    }
    // Generator health
    const G = this.opS.gen;
    if (G) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(G.x - 50, G.y - 48, 100, 8);
      ctx.fillStyle = G.hp < G.max * 0.3 ? '#ff5a4a' : '#ffd23f';
      ctx.fillRect(G.x - 49, G.y - 47, 98 * Math.max(0, G.hp / G.max), 6);
    }
    // Grenade danger circles
    for (const g of this.grenades) {
      if (g.fuse > 0.5) continue;
      ctx.strokeStyle = `rgba(255,80,40,${0.5 * (1 - g.fuse * 2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius ?? 135, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Snowfall over the screen: light flurries on the Frozen Outpost, a white-out in a blizzard. */
  private drawSnow() {
    const B = this.blizzard;
    const outpost = !!this.map.blizzard;
    if (!outpost && B.phase !== 'blow') return;
    if (this.state === 'menu') return;
    const ctx = this.ctx;
    const blow = B.phase === 'blow';
    const n = blow ? 220 : B.phase === 'warn' ? 90 : 40;
    const wx = blow ? Math.cos(B.dir) * 900 : B.phase === 'warn' ? Math.cos(B.dir) * 260 : 30;
    const wy = blow ? Math.sin(B.dir) * 900 + 120 : 90;
    if (blow) {
      const R = Math.max(this.w, this.h);
      const rg = ctx.createRadialGradient(this.w / 2, this.h / 2, R * 0.12, this.w / 2, this.h / 2, R * 0.6);
      rg.addColorStop(0, 'rgba(225,235,245,0.08)');
      rg.addColorStop(1, 'rgba(225,235,245,0.5)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    const W = this.w + 40;
    const H = this.h + 40;
    for (let i = 0; i < n; i++) {
      const depth = 0.5 + ((i * 37) % 10) / 10;
      const x = ((((i * 211.7 + this.clock * wx * depth) % W) + W) % W) - 20;
      const y = ((((i * 97.3 + this.clock * wy * depth) % H) + H) % H) - 20;
      if (blow) {
        ctx.globalAlpha = 0.5 * depth;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - wx * 0.03 * depth, y - wy * 0.03 * depth);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.35 + 0.4 * depth;
        ctx.fillRect(x, y, 2 * depth + 1, 2 * depth + 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawScreenFx() {
    const ctx = this.ctx;
    const R = Math.max(this.w, this.h);
    const low = this.p.hp / this.stats.maxHp;
    if (this.state !== 'menu' && (this.hurtFlash > 0 || (low < 0.3 && this.state === 'playing'))) {
      const a = this.hurtFlash > 0 ? this.hurtFlash * 1.2 : (0.3 - low) * (0.6 + 0.4 * Math.sin(this.clock * 6));
      const rg = ctx.createRadialGradient(this.w / 2, this.h / 2, R * 0.3, this.w / 2, this.h / 2, R * 0.7);
      rg.addColorStop(0, 'rgba(180,0,0,0)');
      rg.addColorStop(1, `rgba(180,0,0,${clamp(a, 0, 0.6).toFixed(2)})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    const tint = this.active.rage > 0 ? '255,30,30' : this.active.freeze > 0 ? '120,210,255' : this.active.cash > 0 ? '90,255,120' : '';
    if (tint && this.state === 'playing') {
      const rg = ctx.createRadialGradient(this.w / 2, this.h / 2, R * 0.35, this.w / 2, this.h / 2, R * 0.75);
      rg.addColorStop(0, `rgba(${tint},0)`);
      rg.addColorStop(1, `rgba(${tint},0.28)`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    this.drawSnow();
    if (this.flash.t > 0) {
      ctx.globalAlpha = clamp(this.flash.t / this.flash.max, 0, 1) * 0.8;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    // Mood vignette, rendered once per screen size
    if (!this.vignette) {
      const v = document.createElement('canvas');
      v.width = Math.ceil(this.w / 4);
      v.height = Math.ceil(this.h / 4);
      const c = v.getContext('2d')!;
      const vg = c.createRadialGradient(v.width / 2, v.height / 2, (R / 4) * 0.25, v.width / 2, v.height / 2, (R / 4) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      c.fillStyle = vg;
      c.fillRect(0, 0, v.width, v.height);
      this.vignette = v;
    }
    ctx.drawImage(this.vignette, 0, 0, this.w, this.h);
  }

  private drawGates() {
    const ctx = this.ctx;
    for (const g of this.map.gates) {
      if (isInnerGate(g)) {
        // An open grave: dark pit with a heap of dug-up earth.
        ctx.fillStyle = '#4a3a28';
        ctx.beginPath();
        ctx.ellipse(g.x + 34, g.y, 22, 40, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0a0705';
        ctx.fillRect(g.x - 22, g.y - 38, 44, 76);
        ctx.strokeStyle = '#2a1e14';
        ctx.lineWidth = 3;
        ctx.strokeRect(g.x - 22, g.y - 38, 44, 76);
        continue;
      }
      const horiz = g.y < BORDER * 2 || g.y > WORLD_H - BORDER * 2;
      ctx.fillStyle = '#120d0b';
      if (horiz) ctx.fillRect(g.x - 50, g.y - 22, 100, 24);
      else ctx.fillRect(g.x - 22, g.y - 50, 24, 100);
    }
  }

  private drawVents() {
    const ctx = this.ctx;
    for (const v of this.vents) {
      // Hazard ring and a round floor grate.
      const warn = v.phase === 'warn' && Math.floor(this.clock * 8) % 2 === 0;
      ctx.strokeStyle = v.phase === 'blast' ? '#ff6a3a' : warn ? '#ffd23f' : 'rgba(200,160,30,0.55)';
      ctx.lineWidth = 6;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.arc(v.x, v.y, VENT_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#17191a';
      ctx.beginPath();
      ctx.arc(v.x, v.y, VENT_R - 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a4f52';
      ctx.lineWidth = 4;
      for (let i = -2; i <= 2; i++) {
        const o = i * 16;
        const h = Math.sqrt(Math.max(0, (VENT_R - 16) ** 2 - o * o));
        ctx.beginPath();
        ctx.moveTo(v.x + o, v.y - h);
        ctx.lineTo(v.x + o, v.y + h);
        ctx.stroke();
      }
      if (v.phase === 'blast') {
        ctx.fillStyle = `rgba(240,245,245,${0.25 + 0.1 * Math.sin(this.clock * 40)})`;
        ctx.beginPath();
        ctx.arc(v.x, v.y, VENT_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Lab console pads, story-mode drives, the generator and the landing zone (under everything that moves). */
  private drawLabFloor() {
    const ctx = this.ctx;
    for (const c of this.consoles) {
      const ready = c.phase === 'idle' && c.cd <= 0 && this.power.out <= 0;
      // Pad ring
      ctx.strokeStyle = ready ? (Math.floor(this.clock * 3) % 2 ? '#ff3a5a' : '#ff8a9a') : 'rgba(120,60,70,0.6)';
      ctx.lineWidth = 5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, CONSOLE_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Hold progress
      if (c.hold > 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(c.x, c.y, CONSOLE_R - 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.hold);
        ctx.stroke();
      }
      // Cooldown sweep
      if (c.phase === 'idle' && c.cd > 0) {
        ctx.fillStyle = 'rgba(255,58,90,0.12)';
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.arc(c.x, c.y, CONSOLE_R - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - c.cd / CONSOLE_CD));
        ctx.fill();
      }
      // The console itself: a little pedestal with a screen.
      ctx.fillStyle = '#1a1e22';
      ctx.fillRect(c.x - 16, c.y - 12, 32, 24);
      ctx.fillStyle = ready ? '#ff3a5a' : this.power.out > 0 ? '#101214' : '#5a2a32';
      ctx.fillRect(c.x - 12, c.y - 8, 24, 12);
      ctx.fillStyle = '#c8a020';
      ctx.fillRect(c.x - 16, c.y + 8, 32, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.power.out > 0 ? 'NO POWER' : c.phase !== 'idle' ? 'ARMED' : c.cd > 0 ? `${Math.ceil(c.cd)}s` : c.axis === 'x' ? 'LASER ⇆' : 'LASER ⇅', c.x, c.y + CONSOLE_R + 12);
    }
    const S = this.opS;
    if (!this.op) return;
    for (const dv of S.drives) {
      const b = Math.sin(this.clock * 4 + dv.x) * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(dv.x - 11, dv.y - 5, 24, 14);
      ctx.fillStyle = '#2a3036';
      ctx.fillRect(dv.x - 12, dv.y - 8 + b, 24, 14);
      ctx.fillStyle = '#8a9298';
      ctx.fillRect(dv.x - 12, dv.y - 8 + b, 24, 3);
      ctx.fillStyle = Math.floor(this.clock * 4) % 2 ? '#5dff7a' : '#1a5a2a';
      ctx.fillRect(dv.x + 5, dv.y - 2 + b, 4, 4);
    }
    const G = S.gen;
    if (G) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(G.x - 40, G.y - 26, 88, 62);
      ctx.fillStyle = G.hurt > 0 ? '#ffffff' : '#4a5a3a';
      ctx.fillRect(G.x - 44, G.y - 30, 88, 60);
      ctx.fillStyle = '#5a6a48';
      ctx.fillRect(G.x - 40, G.y - 26, 80, 52);
      ctx.strokeStyle = '#2a3020';
      ctx.lineWidth = 3;
      for (let i = -30; i <= 30; i += 10) {
        ctx.beginPath();
        ctx.moveTo(G.x + i, G.y - 22);
        ctx.lineTo(G.x + i, G.y + 22);
        ctx.stroke();
      }
      // Spinning fan
      ctx.save();
      ctx.translate(G.x + 22, G.y);
      ctx.fillStyle = '#1a1e14';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(this.clock * 20);
      ctx.fillStyle = '#8a9a78';
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.fillRect(-2, 2, 4, 12);
      }
      ctx.restore();
      ctx.fillStyle = '#c8a020';
      ctx.fillRect(G.x - 44, G.y + 22, 88, 8);
      ctx.fillStyle = G.hp < G.max * 0.3 && Math.floor(this.clock * 6) % 2 ? '#ff3a3a' : '#5dff7a';
      ctx.fillRect(G.x - 34, G.y - 18, 8, 8);
    }
    const Z = S.zone;
    if (Z) {
      const g = this.op.goal;
      const hold = g.type === 'evac' ? g.hold : 1;
      ctx.fillStyle = 'rgba(93,255,122,0.08)';
      ctx.beginPath();
      ctx.arc(Z.x, Z.y, Z.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(93,255,122,0.7)';
      ctx.lineWidth = 5;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -this.clock * 30;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = '#5dff7a';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(Z.x, Z.y, Z.r - 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Z.hold / hold));
      ctx.stroke();
      ctx.fillStyle = 'rgba(230,240,230,0.5)';
      ctx.font = `bold 70px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', Z.x, Z.y + 4);
      // The chopper's shadow circles lower as you hold the zone.
      const k = Math.min(1, Z.hold / hold);
      const a = this.clock * 0.9;
      const cx = Z.x + Math.cos(a) * 220 * (1 - k);
      const cy = Z.y + Math.sin(a) * 220 * (1 - k);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.25 * k})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-70, -4, 50, 8);
      ctx.rotate(this.clock * 25);
      ctx.fillRect(-80, -3, 160, 6);
      ctx.fillRect(-3, -80, 6, 160);
      ctx.restore();
    }
  }

  private drawPuddles() {
    const ctx = this.ctx;
    for (const g of this.goos) {
      const a = Math.min(1, g.life / 0.6) * 0.5;
      ctx.fillStyle = `rgba(110,220,30,${a})`;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * (0.85 + 0.15 * Math.min(1, (g.max - g.life) * 6)), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(210,255,120,${a})`;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(g.x + Math.cos(this.clock * 3 + i * 1.6) * g.r * 0.5, g.y + Math.sin(this.clock * 2.4 + i * 1.6) * g.r * 0.5, 3 + Math.sin(this.clock * 9 + i) * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const pd of this.puddles) {
      const a = Math.min(1, pd.life / 0.6) * 0.55;
      if (pd.kind === 'ice') {
        // A sheet of ice: pale, cracked and slippery.
        const a2 = Math.min(1, pd.life / 0.8);
        ctx.fillStyle = `rgba(160,205,235,${0.45 * a2})`;
        ctx.beginPath();
        ctx.arc(pd.x, pd.y, pd.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${0.55 * a2})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const ang = i * 1.26 + pd.x * 0.01;
          ctx.beginPath();
          ctx.moveTo(pd.x, pd.y);
          ctx.lineTo(pd.x + Math.cos(ang) * pd.r * 0.8, pd.y + Math.sin(ang) * pd.r * 0.8);
          ctx.stroke();
        }
        continue;
      }
      const sludge = pd.kind === 'sludge';
      ctx.fillStyle = pd.kind === 'acid' ? `rgba(150,60,220,${a})` : sludge ? `rgba(90,110,20,${a * 1.2})` : `rgba(120,190,30,${a})`;
      ctx.beginPath();
      ctx.arc(pd.x, pd.y, pd.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pd.kind === 'acid' ? `rgba(220,150,255,${a})` : sludge ? `rgba(200,220,60,${a})` : `rgba(200,255,90,${a})`;
      for (let i = 0; i < 3; i++) {
        const bx = pd.x + Math.cos(this.clock * 2 + i * 2) * pd.r * 0.5;
        const by = pd.y + Math.sin(this.clock * 2.5 + i * 2) * pd.r * 0.5;
        ctx.beginPath();
        ctx.arc(bx, by, 3 + Math.sin(this.clock * 8 + i) * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawWalls() {
    const ctx = this.ctx;
    for (const w of this.map.walls) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(w.x + 7, w.y + 9, w.w, w.h);
      if (w.kind === 'border') {
        ctx.fillStyle = '#3a2a24';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        const horiz = w.w > w.h;
        const len = horiz ? w.w : w.h;
        for (let i = 0; i < len; i += 30) {
          for (let row = 0; row < 3; row++) {
            const off = row % 2 ? 15 : 0;
            if (horiz) ctx.strokeRect(w.x + i + off, w.y + row * 13, 30, 13);
            else ctx.strokeRect(w.x + row * 13, w.y + i + off, 13, 30);
          }
        }
      } else if (w.kind === 'concrete') {
        ctx.fillStyle = '#8a8a84';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#a5a59e';
        ctx.fillRect(w.x + 5, w.y + 5, w.w - 10, w.h - 10);
        // Hazard stripes on the ends
        ctx.save();
        ctx.beginPath();
        ctx.rect(w.x, w.y, w.w, w.h);
        ctx.clip();
        const horiz = w.w > w.h;
        for (let i = -60; i < 60; i += 16) {
          ctx.fillStyle = (i / 16) % 2 ? '#1c1c1c' : '#e8c547';
          for (const end of [0, 1]) {
            ctx.beginPath();
            if (horiz) {
              const ex = end ? w.x + w.w - 40 : w.x;
              ctx.moveTo(ex + i, w.y);
              ctx.lineTo(ex + i + 8, w.y);
              ctx.lineTo(ex + i + 8 + w.h, w.y + w.h);
              ctx.lineTo(ex + i + w.h, w.y + w.h);
            } else {
              const ey = end ? w.y + w.h - 40 : w.y;
              ctx.moveTo(w.x, ey + i);
              ctx.lineTo(w.x, ey + i + 8);
              ctx.lineTo(w.x + w.w, ey + i + 8 + w.w);
              ctx.lineTo(w.x + w.w, ey + i + w.w);
            }
            ctx.fill();
          }
        }
        ctx.restore();
      } else if (w.kind === 'brick') {
        ctx.fillStyle = '#6a3a2a';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        const horiz = w.w > w.h;
        const len = horiz ? w.w : w.h;
        const thick = horiz ? w.h : w.w;
        for (let i = 0; i < len; i += 24)
          for (let r = 0; r < thick; r += 10) {
            const off = (r / 10) % 2 ? 12 : 0;
            if (horiz) ctx.strokeRect(w.x + i + off, w.y + r, 24, 10);
            else ctx.strokeRect(w.x + r, w.y + i + off, 10, 24);
          }
      } else if (w.kind === 'pillar') {
        ctx.fillStyle = '#6a6a66';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#85857f';
        ctx.fillRect(w.x + 5, w.y + 5, w.w - 10, w.h - 10);
        ctx.fillStyle = '#e8c547';
        ctx.fillRect(w.x, w.y + w.h - 8, w.w, 4);
      } else if (w.kind === 'grave') {
        // Headstone: rounded top, an engraved cross.
        ctx.fillStyle = '#6e7270';
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, [w.w / 2, w.w / 2, 2, 2]);
        ctx.fill();
        ctx.fillStyle = '#8a8e8a';
        ctx.fillRect(w.x + 3, w.y + 3, w.w - 6, 3);
        ctx.fillStyle = '#3e4240';
        ctx.fillRect(w.x + w.w / 2 - 1.5, w.y + 4, 3, w.h - 7);
        ctx.fillRect(w.x + w.w / 2 - 5, w.y + 7, 10, 3);
      } else if (w.kind === 'crypt') {
        ctx.fillStyle = '#4e524e';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#62665f';
        ctx.fillRect(w.x + 8, w.y + 8, w.w - 16, w.h - 16);
        // Roof ridge and an iron door
        ctx.fillStyle = '#3a3e3a';
        ctx.fillRect(w.x, w.y + w.h / 2 - 3, w.w, 6);
        ctx.fillStyle = '#22201c';
        const below = w.y > WORLD_H / 2;
        ctx.fillRect(w.x + w.w / 2 - 18, below ? w.y : w.y + w.h - 10, 36, 10);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        for (let i = 1; i < 4; i++) ctx.strokeRect(w.x + (w.w / 4) * i - 1, w.y + 8, 2, w.h - 16);
      } else if (w.kind === 'tank') {
        // Storage tank seen from above: a big drum with a hatch and a hazard band.
        const cx = w.x + w.w / 2;
        const cy = w.y + w.h / 2;
        const R = Math.min(w.w, w.h) / 2;
        ctx.fillStyle = '#4a5054';
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, 36);
        ctx.fill();
        ctx.fillStyle = '#5a6266';
        ctx.beginPath();
        ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#c8a020';
        ctx.lineWidth = 8;
        ctx.setLineDash([18, 14]);
        ctx.beginPath();
        ctx.arc(cx, cy, R - 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#6e777c';
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3a4044';
        ctx.beginPath();
        ctx.arc(cx + R * 0.3, cy - R * 0.25, R * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(150,230,40,0.5)';
        ctx.font = `bold ${Math.round(R * 0.32)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('☣', cx - R * 0.12, cy + R * 0.12);
      } else if (w.kind === 'hut') {
        // Research hut from above: corrugated roof under a layer of snow, a chimney and a door light.
        ctx.fillStyle = '#7a4a34';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#93593e';
        for (let x = w.x + 6; x < w.x + w.w - 4; x += 14) ctx.fillRect(x, w.y + 4, 7, w.h - 8);
        ctx.fillStyle = '#e8eef2';
        ctx.beginPath();
        ctx.roundRect(w.x + 4, w.y + 4, w.w - 8, w.h * 0.46, 14);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(w.x + w.w * 0.15, w.y + w.h * 0.42, w.w * 0.55, w.h * 0.22, 10);
        ctx.fill();
        ctx.fillStyle = '#4a4f54';
        ctx.fillRect(w.x + w.w - 46, w.y + 18, 22, 22);
        ctx.fillStyle = '#2a2d30';
        ctx.fillRect(w.x + w.w - 42, w.y + 22, 14, 14);
        ctx.fillStyle = '#ffcf5a';
        ctx.fillRect(w.x + w.w / 2 - 6, w.y + w.h - 6, 12, 4);
      } else if (w.kind === 'snowbank') {
        // A packed drift: rounded lumps of snow.
        const horiz = w.w > w.h;
        const len = horiz ? w.w : w.h;
        const th = horiz ? w.h : w.w;
        ctx.fillStyle = '#c8d4dc';
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, th / 2);
        ctx.fill();
        ctx.fillStyle = '#eef3f6';
        for (let t = th / 2; t < len - th / 3; t += th * 0.7) {
          ctx.beginPath();
          if (horiz) ctx.arc(w.x + t, w.y + th * 0.42, th * 0.42, 0, Math.PI * 2);
          else ctx.arc(w.x + th * 0.42, w.y + t, th * 0.42, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (w.kind === 'pipe') {
        const horiz = w.w > w.h;
        ctx.fillStyle = '#6a5a4a';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        if (horiz) ctx.fillRect(w.x, w.y + 4, w.w, 5);
        else ctx.fillRect(w.x + 4, w.y, 5, w.h);
        // Flanges every so often
        ctx.fillStyle = '#4a3e34';
        const len = horiz ? w.w : w.h;
        for (let t = 20; t < len - 10; t += 60) {
          if (horiz) ctx.fillRect(w.x + t, w.y - 3, 8, w.h + 6);
          else ctx.fillRect(w.x - 3, w.y + t, w.w + 6, 8);
        }
      } else if (w.kind === 'crate') {
        ctx.fillStyle = '#6b4a2a';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = '#3e2a16';
        ctx.lineWidth = 4;
        ctx.strokeRect(w.x + 3, w.y + 3, w.w - 6, w.h - 6);
        ctx.beginPath();
        ctx.moveTo(w.x + 4, w.y + 4);
        ctx.lineTo(w.x + w.w - 4, w.y + w.h - 4);
        ctx.moveTo(w.x + w.w - 4, w.y + 4);
        ctx.lineTo(w.x + 4, w.y + w.h - 4);
        ctx.stroke();
      } else if (w.kind === 'glass') {
        // Reinforced containment glass: steel frame, cyan pane, scratches.
        const horiz = w.w > w.h;
        ctx.fillStyle = '#3c4650';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = 'rgba(120,220,255,0.35)';
        if (horiz) ctx.fillRect(w.x + 3, w.y + 5, w.w - 6, w.h - 10);
        else ctx.fillRect(w.x + 5, w.y + 3, w.w - 10, w.h - 6);
        ctx.fillStyle = 'rgba(230,250,255,0.55)';
        if (horiz) ctx.fillRect(w.x + 3, w.y + 6, w.w - 6, 2);
        else ctx.fillRect(w.x + 6, w.y + 3, 2, w.h - 6);
        ctx.fillStyle = '#5a6670';
        const len = horiz ? w.w : w.h;
        for (let t = 0; t <= len - 6; t += 45) {
          if (horiz) ctx.fillRect(w.x + t, w.y, 6, w.h);
          else ctx.fillRect(w.x, w.y + t, w.w, 6);
        }
        if (horiz) ctx.fillRect(w.x + w.w - 6, w.y, 6, w.h);
        else ctx.fillRect(w.x, w.y + w.h - 6, w.w, 6);
        // A crack or two
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        const s = (w.x * 7 + w.y * 3) % 97;
        ctx.beginPath();
        const c0x = horiz ? w.x + 20 + (s % (w.w - 40)) : w.x + w.w / 2;
        const c0y = horiz ? w.y + w.h / 2 : w.y + 20 + (s % (w.h - 40));
        ctx.moveTo(c0x - 6, c0y - 4);
        ctx.lineTo(c0x, c0y);
        ctx.lineTo(c0x + 7, c0y + 3);
        ctx.moveTo(c0x, c0y);
        ctx.lineTo(c0x + 2, c0y - 6);
        ctx.stroke();
      } else if (w.kind === 'tube') {
        // Specimen tube: metal base ring, green fluid, something floating in it.
        const cx = w.x + w.w / 2;
        const cy = w.y + w.h / 2;
        const R = Math.min(w.w, w.h) / 2;
        ctx.fillStyle = '#4a525a';
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
        const broken = (w.x + w.y) % 3 === 0;
        ctx.fillStyle = broken ? 'rgba(40,60,50,0.9)' : 'rgba(90,255,170,0.42)';
        ctx.beginPath();
        ctx.arc(cx, cy, R - 6, 0, Math.PI * 2);
        ctx.fill();
        if (!broken) {
          // Curled specimen silhouette
          ctx.fillStyle = 'rgba(60,40,40,0.55)';
          ctx.beginPath();
          ctx.ellipse(cx + 2, cy + 1, R * 0.38, R * 0.26, 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx - R * 0.25, cy - R * 0.18, R * 0.16, 0, Math.PI * 2);
          ctx.fill();
          const t = this.clock * 1.4 + w.x;
          ctx.fillStyle = 'rgba(220,255,235,0.6)';
          for (let i = 0; i < 3; i++) {
            const k = (t + i * 0.33) % 1;
            ctx.beginPath();
            ctx.arc(cx - 6 + i * 6, cy + R * 0.5 - k * R, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Shattered: glass shards on the rim
          ctx.strokeStyle = 'rgba(180,240,255,0.6)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 6; i++) {
            const a = i * 1.1 + w.x;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6));
            ctx.lineTo(cx + Math.cos(a + 0.2) * (R - 14), cy + Math.sin(a + 0.2) * (R - 14));
            ctx.stroke();
          }
        }
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(cx - R * 0.35, cy - R * 0.35, R * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2a3036';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (w.kind === 'bench') {
        // Steel lab bench with clutter on top.
        const horiz = w.w > w.h;
        ctx.fillStyle = '#5a636c';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#7c868f';
        ctx.fillRect(w.x + 3, w.y + 3, w.w - 6, w.h - 6);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        if (horiz) ctx.fillRect(w.x + 3, w.y + 3, w.w - 6, 4);
        else ctx.fillRect(w.x + 3, w.y + 3, 4, w.h - 6);
        const len = horiz ? w.w : w.h;
        const at = (t: number, o: number): [number, number] => (horiz ? [w.x + t, w.y + o] : [w.x + o, w.y + t]);
        // Microscope, beakers, a monitor
        let [px, py] = at(len * 0.2, 20);
        ctx.fillStyle = '#2a2e33';
        ctx.fillRect(px - 7, py - 8, 14, 16);
        ctx.fillStyle = '#50565c';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        [px, py] = at(len * 0.5, 20);
        const fl = ['#5aff9a', '#ff5adc', '#5ac8ff'];
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = fl[i];
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.arc(px + (horiz ? (i - 1) * 9 : 0), py + (horiz ? 0 : (i - 1) * 9), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        [px, py] = at(len * 0.8, 20);
        ctx.fillStyle = '#16191c';
        ctx.fillRect(px - 9, py - 7, 18, 14);
        ctx.fillStyle = Math.sin(this.clock * 3 + w.x) > 0.6 ? '#ff4a4a' : '#3aff8a';
        ctx.fillRect(px - 7, py - 5, 14, 2);
        ctx.fillRect(px - 7, py - 1, 9, 2);
      } else if (w.kind === 'car') {
        const horiz = w.w > w.h;
        ctx.save();
        ctx.translate(w.x + w.w / 2, w.y + w.h / 2);
        if (!horiz) ctx.rotate(Math.PI / 2);
        const L = horiz ? w.w : w.h;
        const W = horiz ? w.h : w.w;
        ctx.fillStyle = w.color ?? '#777';
        ctx.beginPath();
        ctx.roundRect(-L / 2, -W / 2, L, W, 12);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.roundRect(-L / 2 + 4, -W / 2 + 4, L - 8, W / 3, 8);
        ctx.fill();
        // Windshields + roof
        ctx.fillStyle = '#1b2633';
        ctx.fillRect(-L * 0.22, -W / 2 + 6, L * 0.1, W - 12);
        ctx.fillRect(L * 0.16, -W / 2 + 6, L * 0.08, W - 12);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(-L * 0.12, -W / 2 + 6, L * 0.28, W - 12);
        // Busted headlights and tail lights
        ctx.fillStyle = '#ffe8a0';
        ctx.fillRect(L / 2 - 6, -W / 2 + 6, 4, 9);
        ctx.fillStyle = '#5a5040';
        ctx.fillRect(L / 2 - 6, W / 2 - 15, 4, 9);
        ctx.fillStyle = '#c0201a';
        ctx.fillRect(-L / 2 + 2, -W / 2 + 6, 4, 9);
        ctx.fillRect(-L / 2 + 2, W / 2 - 15, 4, 9);
        ctx.restore();
      }
    }
    // Re-open the gate holes on top of the border walls.
    for (const g of this.map.gates) {
      if (isInnerGate(g)) continue;
      const horiz = g.y < BORDER * 2 || g.y > WORLD_H - BORDER * 2;
      ctx.fillStyle = '#0d0907';
      if (horiz) ctx.fillRect(g.x - 50, g.y < WORLD_H / 2 ? 0 : WORLD_H - BORDER, 100, BORDER);
      else ctx.fillRect(g.x < WORLD_W / 2 ? 0 : WORLD_W - BORDER, g.y - 50, BORDER, 100);
      ctx.fillStyle = 'rgba(140,30,20,0.5)';
      if (horiz) ctx.fillRect(g.x - 50, g.y < WORLD_H / 2 ? BORDER - 4 : WORLD_H - BORDER, 100, 4);
      else ctx.fillRect(g.x < WORLD_W / 2 ? BORDER - 4 : WORLD_W - BORDER, g.y - 50, 4, 100);
    }
  }

  private drawLampPosts() {
    const ctx = this.ctx;
    for (const l of this.map.lamps) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.arc(l.x + 4, l.y + 6, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a3d42';
      ctx.beginPath();
      ctx.arc(l.x, l.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff2c0';
      ctx.beginPath();
      ctx.arc(l.x, l.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBarrels() {
    const ctx = this.ctx;
    for (const b of this.barrels) {
      if (b.dead) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.arc(b.x + 3, b.y + 5, 15, 0, Math.PI * 2);
      ctx.fill();
      const hot = b.fuse > 0 && Math.floor(this.clock * 30) % 2 === 0;
      if (b.big) {
        // Fuel pump
        ctx.fillStyle = hot ? '#ffffff' : '#d8d8d0';
        ctx.fillRect(b.x - 16, b.y - 20, 32, 40);
        ctx.fillStyle = '#c0201a';
        ctx.fillRect(b.x - 16, b.y - 20, 32, 10);
        ctx.fillStyle = '#1b2633';
        ctx.fillRect(b.x - 10, b.y - 5, 20, 10);
        ctx.fillStyle = '#e8c547';
        ctx.font = `900 9px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('FUEL', b.x, b.y + 13);
        continue;
      }
      ctx.fillStyle = hot ? '#ffffff' : '#b52a1f';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6e160f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e8c547';
      ctx.font = `900 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', b.x, b.y + 1);
    }
  }

  private drawGrenades() {
    const ctx = this.ctx;
    for (const g of this.grenades) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(g.x + 2, g.y + 3, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = g.vortex ? '#6a3aa0' : g.cluster || g.bomblet ? '#b08a2a' : '#3d5a2a';
      ctx.beginPath();
      ctx.arc(g.x, g.y - g.z * 0.6, g.bomblet ? 3.5 : g.cluster ? 7 : 6, 0, Math.PI * 2);
      ctx.fill();
      if (Math.floor(g.fuse * 12) % 2 === 0) {
        ctx.fillStyle = '#ff4030';
        ctx.fillRect(g.x - 1.5, g.y - g.z * 0.6 - 7, 3, 3);
      }
    }
  }

  private drawPickups() {
    const ctx = this.ctx;
    for (const pk of this.pickups) {
      if (pk.kind === 'cash') {
        ctx.fillStyle = '#7a5d10';
        ctx.beginPath();
        ctx.arc(pk.x + 1, pk.y + 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff3b0';
        ctx.fillRect(pk.x - 2, pk.y - 3, 2, 4);
      } else if (pk.kind === 'crate') {
        const bob = Math.sin(this.clock * 4) * 2;
        ctx.fillStyle = 'rgba(255,210,63,0.25)';
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, 22 + Math.sin(this.clock * 6) * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8a5a20';
        ctx.fillRect(pk.x - 13, pk.y - 11 + bob, 26, 22);
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 2;
        ctx.strokeRect(pk.x - 13, pk.y - 11 + bob, 26, 22);
        ctx.beginPath();
        ctx.moveTo(pk.x - 13, pk.y - 3 + bob);
        ctx.lineTo(pk.x + 13, pk.y - 3 + bob);
        ctx.stroke();
        if (Math.random() < 0.1) this.addLight(pk.x, pk.y, 120, 0.3, '#ffd23f');
      } else {
        ctx.fillStyle = '#eee';
        ctx.fillRect(pk.x - 10, pk.y - 8, 20, 16);
        ctx.fillStyle = '#d0302a';
        ctx.fillRect(pk.x - 2.5, pk.y - 6, 5, 12);
        ctx.fillRect(pk.x - 6, pk.y - 2.5, 12, 5);
      }
    }
  }

  /** Crawlers hide in the dark until they're close. */
  private crawlerAlpha(z: Zombie) {
    if (z.dig?.state === 'under') return 0;
    if (z.ghostT > 0) return 0.28 + 0.08 * Math.sin(this.clock * 9 + z.id);
    if (z.def.kind !== 'crawler' || this.state === 'menu') return 1;
    return clamp((260 - Math.hypot(z.x - this.p.x, z.y - this.p.y)) / 120, 0.1, 1);
  }

  private drawZombie(z: Zombie) {
    const ctx = this.ctx;
    const r = z.r;
    const def = z.def;
    const kind = def.kind;
    if (kind === 'egg') {
      this.drawEgg(z);
      return;
    }
    if (z.lurk) {
      this.drawMimicCrate(z);
      return;
    }
    if (z.def.kind === 'roller' && z.leap?.state === 'leap') {
      // Curled up into a rolling ball of frozen flesh.
      const spin = this.clock * 18;
      ctx.fillStyle = z.flash > 0 ? '#fff' : z.def.body;
      ctx.beginPath();
      ctx.arc(z.x, z.y, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = z.def.dark;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(z.x, z.y, r * (0.35 + i * 0.25), spin + i, spin + i + 2.2);
        ctx.stroke();
      }
      ctx.fillStyle = '#eef3f6';
      for (let i = 0; i < 4; i++) {
        const a = spin * 0.7 + i * 1.57;
        ctx.beginPath();
        ctx.arc(z.x + Math.cos(a) * r * 0.75, z.y + Math.sin(a) * r * 0.75, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    if (z.dig && z.dig.state !== 'walk') {
      // A mound of churned earth moving under the floor.
      const rise = z.dig.state === 'rise';
      const wob = Math.sin(this.clock * 14 + z.id) * 2;
      ctx.fillStyle = '#4a3a28';
      ctx.beginPath();
      ctx.ellipse(z.x, z.y, r * (rise ? 1.4 : 1.1) + wob, r * (rise ? 1.2 : 0.8), z.face, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6a5236';
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26 + this.clock * 3;
        ctx.beginPath();
        ctx.arc(z.x + Math.cos(a) * r * 0.55, z.y + Math.sin(a) * r * 0.45, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!rise) return;
    }
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.rotate(z.face);
    const hit = z.flash > 0;
    const frozen = this.active.freeze > 0;
    const windup = z.boss?.state === 'windup' || z.leap?.state === 'crouch' || (z.jug?.windup ?? 0) > 0 || (z.titan?.windup ?? 0) > 0 || z.zapT > 0 || (z.yank?.windup ?? 0) > 0 || (z.zero ? z.zero.yankT > 0 || z.zero.laserW > 0 || z.zero.trans > 0 : false);
    const alpha = this.crawlerAlpha(z);
    ctx.globalAlpha = alpha;
    const icy = frozen || z.frozenT > 0;
    const blink = windup && Math.floor(this.clock * 20) % 2 === 1;
    const tint = hit ? Tint.Hit : z.charm > 0 ? Tint.Charm : blink ? (z.zapT > 0 ? Tint.Zap : (z.yank?.windup ?? 0) > 0 ? Tint.Charm : Tint.Windup) : icy || z.slow > 0 ? Tint.Icy : z.burn > 0 ? Tint.Burn : Tint.None;
    const flat = (c: string) => (hit ? '#ffffff' : c);
    const swing = Math.sin(z.phase);
    const variant = z.id % VARIANTS;

    // 1. What sits under the body: feet, legs, shrouds.
    const lite = this.liteZombies;
    if (!lite && hasFeet(kind)) {
      ctx.fillStyle = flat(icy ? '#3a5a6a' : '#1c1814');
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(swing * side * r * 0.34 - r * 0.08, side * r * 0.36, r * 0.27, r * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (kind === 'dog') {
      // Four jointed legs with paws, trotting.
      const step = Math.sin(z.phase * 1.6) * r * 0.35;
      ctx.strokeStyle = flat(def.dark);
      ctx.lineWidth = r * 0.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [x, side, s] of [[0.45, -1, 1], [0.45, 1, -1], [-0.85, -1, -1], [-0.85, 1, 1]] as const) {
        const fx = r * x + step * s;
        ctx.moveTo(r * x, side * r * 0.35);
        ctx.lineTo(fx + r * 0.05, side * r * 0.62);
        ctx.lineTo(fx + r * 0.15, side * r * 0.78);
      }
      ctx.stroke();
    } else if (kind === 'leaper') {
      // Long, folded frog-like back legs.
      const kick = z.leap?.state === 'leap' ? 0.5 : z.leap?.state === 'crouch' ? -0.2 : swing * 0.12;
      ctx.strokeStyle = flat(def.dark);
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.lineWidth = r * 0.26;
        ctx.beginPath();
        ctx.moveTo(-r * 0.4, side * r * 0.35);
        ctx.lineTo(-r * 0.6, side * r * (1.0 + kick * 0.3));
        ctx.stroke();
        ctx.lineWidth = r * 0.16;
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, side * r * (1.0 + kick * 0.3));
        ctx.lineTo(-r * (1.35 + kick), side * r * 0.75);
        ctx.lineTo(-r * (1.55 + kick), side * r * 0.85);
        ctx.stroke();
      }
    } else if (kind === 'parasite') {
      // Eight scrabbling legs, much faster than they look.
      ctx.strokeStyle = flat('#3a2420');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.4, r * 0.13);
      const fast = z.latch ? 3 : 2.4;
      for (const side of [-1, 1])
        for (let i = 0; i < 4; i++) {
          const a = side * (0.7 + i * 0.5) + Math.sin(z.phase * fast + i * 1.7 + (side > 0 ? 1 : 0)) * 0.22;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r * 0.35 - r * 0.25, Math.sin(a) * r * 0.35);
          ctx.lineTo(Math.cos(a) * r * 1.1 - r * 0.2, Math.sin(a) * r * 1.1);
          ctx.lineTo(Math.cos(a + side * 0.5) * r * 1.5 - r * 0.2, Math.sin(a + side * 0.5) * r * 1.5);
          ctx.stroke();
        }
    } else if (kind === 'zero') {
      // Writhing tendrils: more of them as it evolves.
      const Z = z.zero;
      const n = Z && Z.phase >= 2 ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const base = Math.PI * 0.55 + (i / (n - 1)) * Math.PI * 0.9;
        const len = r * (1.25 + 0.25 * Math.sin(this.clock * 2.3 + i * 1.9));
        const pts: [number, number][] = [];
        for (let k = 0; k <= 6; k++) {
          const t = k / 6;
          const a = base + Math.sin(this.clock * 3 + i * 2.1 + t * 3) * 0.28 * t;
          pts.push([Math.cos(a) * (r * 0.55 + len * t), Math.sin(a) * (r * 0.55 + len * t)]);
        }
        for (let k = 0; k < 6; k++) {
          const t = k / 6;
          ctx.strokeStyle = flat(k % 2 ? '#a0404a' : '#8a3040');
          ctx.lineWidth = r * 0.2 * (1 - t * 0.8);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pts[k][0], pts[k][1]);
          ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
          ctx.stroke();
        }
        // Hooked tip
        ctx.fillStyle = flat('#f0e4c8');
        ctx.beginPath();
        ctx.arc(pts[6][0], pts[6][1], r * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'webber' || kind === 'brood') {
      // Jointed spider / insect legs.
      const big = kind === 'brood';
      ctx.strokeStyle = flat(big ? '#3a2410' : '#20202a');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = big ? r * 0.09 : 2.5;
      for (const side of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const a = side * (0.9 + i * 0.55) + Math.sin(z.phase * 1.4 + i + (side > 0 ? 1.5 : 0)) * 0.15;
          const k = big ? 1.25 : 1;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r * 0.5 - (big ? r * 0.2 : 0), Math.sin(a) * r * 0.5);
          ctx.lineTo(Math.cos(a) * r * 1.45 * k, Math.sin(a) * r * 1.45 * k);
          ctx.lineTo(Math.cos(a + side * 0.45) * r * 1.95 * k, Math.sin(a + side * 0.45) * r * 1.95 * k);
          ctx.stroke();
        }
    } else if (kind === 'wraith') {
      // Tattered trailing shroud, fading into nothing.
      const g = ctx.createLinearGradient(-r * 0.3, 0, -r * 2, 0);
      g.addColorStop(0, hit ? '#fff' : 'rgba(170,195,215,0.85)');
      g.addColorStop(1, 'rgba(120,255,234,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.9);
      for (let i = 0; i <= 4; i++) {
        const y = -r * 0.9 + (i / 4) * r * 1.8;
        ctx.lineTo(-r * (1.8 + 0.35 * Math.sin(this.clock * 8 + i * 1.7 + z.id)), y);
        if (i < 4) ctx.lineTo(-r * 1.0, y + r * 0.22);
      }
      ctx.lineTo(-r * 0.3, r * 0.9);
      ctx.fill();
    } else if (kind === 'reaper') {
      // Ragged hem of the robe whipping behind it.
      ctx.fillStyle = flat('#14141e');
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 0.62 + (i / 6) * Math.PI * 0.76;
        const l = 1.45 + 0.12 * Math.sin(this.clock * 7 + i);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.16) * r * 0.9, Math.sin(a - 0.16) * r * 0.9);
        ctx.lineTo(Math.cos(a) * r * l, Math.sin(a) * r * l);
        ctx.lineTo(Math.cos(a + 0.16) * r * 0.9, Math.sin(a + 0.16) * r * 0.9);
        ctx.fill();
      }
    }

    // 2. Arms reaching forward, swinging as they shamble (pre-posed frames).
    // Only lasting states recolor the arms; quick flashes show on the body alone.
    const armTint = tint === Tint.Icy || tint === Tint.Burn ? tint : Tint.None;
    const arms = lite ? null : armsSprite(def, Math.round((z.phase / (Math.PI * 2)) * ARM_FRAMES), armTint);
    if (arms) stamp(ctx, arms, r, windup ? 1.08 : 1, 1);

    // 3. The detailed body, swaying a little, plus gore as it gets hurt.
    const crouch = z.leap?.state === 'crouch' ? 0.85 : 1;
    const pulse = (kind === 'bloater' ? 1 + Math.sin(this.clock * 6 + z.id) * 0.06 : kind === 'screamer' && z.abilityCd < 0.6 ? 1.1 : kind === 'zero' && z.zero && z.zero.trans > 0 ? 1 + Math.sin(this.clock * 30) * 0.05 : 1) * crouch;
    // Blobs jiggle; psykers bob as they float.
    const wob = kind === 'blob' ? Math.sin(this.clock * 7 + z.id) * 0.07 : 0;
    const bob = kind === 'psyker' ? 1 + Math.sin(this.clock * 3 + z.id) * 0.04 : 1;
    ctx.save();
    ctx.rotate(swing * (r >= 40 ? 0.02 : kind === 'blob' ? 0 : 0.05));
    const hurt = z.hp < z.maxHp * 0.4 ? 2 : z.hp < z.maxHp * 0.8 ? 1 : 0;
    stamp(ctx, bodySprite(def, variant, tint, kind === 'blob' ? 0 : hurt), r, pulse * (1 + wob) * bob, pulse * (1 - wob) * bob);
    ctx.restore();

    // 4. Live details on top.
    if (kind === 'titan' && z.titan?.enraged) {
      ctx.strokeStyle = 'rgba(223,246,255,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (kind === 'shield') {
      // Scuffed riot shield held out front.
      const g = ctx.createLinearGradient(r * 0.9, -r, r * 1.5, r);
      g.addColorStop(0, hit ? '#fff' : 'rgba(200,220,235,0.95)');
      g.addColorStop(0.5, hit ? '#fff' : 'rgba(130,150,165,0.95)');
      g.addColorStop(1, hit ? '#fff' : 'rgba(70,85,100,0.95)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r * 0.35, 0, r * 1.25, -1.05, 1.05);
      ctx.arc(r * 0.35, 0, r * 0.95, 1.05, -1.05, true);
      ctx.fill();
      ctx.strokeStyle = '#20262c';
      ctx.lineWidth = r * 0.06;
      ctx.stroke();
      ctx.fillStyle = 'rgba(20,30,40,0.7)';
      ctx.fillRect(r * 1.18, -r * 0.35, r * 0.16, r * 0.7);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = r * 0.04;
      ctx.beginPath();
      ctx.arc(r * 0.35, 0, r * 1.12, -0.85, -0.3);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,20,20,0.6)';
      ctx.lineWidth = r * 0.025;
      ctx.beginPath();
      ctx.moveTo(r * 1.4, r * 0.45);
      ctx.lineTo(r * 1.25, r * 0.6);
      ctx.lineTo(r * 1.32, r * 0.75);
      ctx.stroke();
    }
    if (kind === 'soldier' && z.plates > 0) {
      // Armor plates, one per side and one on the back; they fall off as they break.
      const spots = [
        [0, -r * 0.62],
        [0, r * 0.62],
        [-r * 0.62, 0],
      ];
      for (let i = 0; i < z.plates; i++) {
        const [px, py] = spots[i];
        ctx.fillStyle = flat('#5a6268');
        ctx.fillRect(px - r * 0.35, py - r * 0.22, r * 0.7, r * 0.44);
        ctx.fillStyle = flat('#a8b0b8');
        ctx.fillRect(px - r * 0.35, py - r * 0.22, r * 0.7, r * 0.1);
        ctx.fillStyle = '#1c2024';
        ctx.fillRect(px - r * 0.28, py - r * 0.03, r * 0.04, r * 0.06);
        ctx.fillRect(px + r * 0.24, py - r * 0.03, r * 0.04, r * 0.06);
      }
    }
    if (kind === 'juggernaut') {
      // Glowing weak spot on the back.
      const pulseA = 0.6 + 0.4 * Math.sin(this.clock * 6);
      ctx.fillStyle = `rgba(255,${120 + Math.floor(60 * Math.sin(this.clock * 6))},40,1)`;
      ctx.beginPath();
      ctx.arc(-r * 0.62, 0, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,240,180,${pulseA})`;
      ctx.beginPath();
      ctx.arc(-r * 0.64, -r * 0.04, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    if (kind === 'electric') {
      // Jagged sparks crawling over the body.
      ctx.strokeStyle = '#d8faff';
      ctx.lineWidth = Math.max(1.2, r * 0.08);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = this.clock * 9 + i * 2.1 + z.id;
        let x = Math.cos(a) * r * 0.35;
        let y = Math.sin(a) * r * 0.35;
        ctx.moveTo(x, y);
        for (let k = 1; k <= 3; k++) {
          const d = r * (0.35 + k * 0.28);
          const j = Math.sin(this.clock * 40 + k * 3 + i) * 0.35;
          x = Math.cos(a + j) * d;
          y = Math.sin(a + j) * d;
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    if (kind === 'screamer') {
      // Gaping mouth that stretches wide right before a scream.
      const open = z.abilityCd < 0.6;
      ctx.fillStyle = '#1a0006';
      ctx.beginPath();
      ctx.ellipse(r * 0.66, 0, r * (open ? 0.24 : 0.14), r * (open ? 0.3 : 0.18), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8dcb0';
      for (const side of [-1, 1]) ctx.fillRect(r * 0.6, side * r * (open ? 0.24 : 0.13) - r * 0.03, r * 0.14, r * 0.06);
    }
    if (kind === 'bomber') {
      const lit = z.fuse > 0 ? Math.floor(this.clock * 24) % 2 : Math.floor(this.clock * 3) % 2;
      ctx.fillStyle = lit ? '#ff3a2a' : '#5a1a10';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      if (z.fuse > 0) {
        // Sparking fuse
        ctx.fillStyle = '#ffe08a';
        for (let i = 0; i < 3; i++) {
          const a = this.clock * 30 + i * 2;
          ctx.fillRect(-r * 0.4 + Math.cos(a) * r * 0.15, -r * 0.55 + Math.sin(a) * r * 0.15, 2, 2);
        }
      }
    }
    if (kind === 'necro') {
      // Gnarled staff with a glowing skull orb.
      ctx.strokeStyle = flat('#5a4630');
      ctx.lineWidth = r * 0.16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(r * 0.2, r * 0.7);
      ctx.quadraticCurveTo(r * 0.9, r * 0.6, r * 1.6, r * 0.72);
      ctx.stroke();
      ctx.fillStyle = '#d8d0b8';
      ctx.beginPath();
      ctx.arc(r * 1.75, r * 0.72, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5dffb0';
      ctx.beginPath();
      ctx.arc(r * 1.82, r * 0.66, r * 0.05, 0, Math.PI * 2);
      ctx.arc(r * 1.82, r * 0.78, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    if (kind === 'reaper') {
      // The scythe swings back during the wind-up.
      const wind = z.reap && z.reap.windup > 0 ? -1.3 : 0.35 * Math.sin(z.phase * 0.5);
      ctx.save();
      ctx.rotate(wind);
      ctx.fillStyle = flat('#4a3624');
      ctx.fillRect(r * 0.2, r * 0.55, r * 1.9, r * 0.14);
      ctx.fillStyle = flat('#2a1e14');
      for (let i = 0; i < 4; i++) ctx.fillRect(r * (0.5 + i * 0.12), r * 0.55, r * 0.05, r * 0.14);
      const g = ctx.createLinearGradient(r * 1.0, -r * 0.9, r * 2.0, r * 0.5);
      g.addColorStop(0, hit ? '#fff' : '#f0f8ff');
      g.addColorStop(0.6, hit ? '#fff' : '#8a9aa8');
      g.addColorStop(1, hit ? '#fff' : '#3a4450');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(r * 2.05, r * 0.55);
      ctx.quadraticCurveTo(r * 2.0, -r * 0.6, r * 1.0, -r * 0.95);
      ctx.quadraticCurveTo(r * 1.7, -r * 0.3, r * 1.85, r * 0.55);
      ctx.fill();
      ctx.strokeStyle = 'rgba(122,255,234,0.6)';
      ctx.lineWidth = r * 0.03;
      ctx.beginPath();
      ctx.moveTo(r * 1.0, -r * 0.95);
      ctx.quadraticCurveTo(r * 1.7, -r * 0.3, r * 1.85, r * 0.55);
      ctx.stroke();
      ctx.restore();
    }
    if (kind === 'zero' && z.zero) this.drawZeroParts(z, hit);
    if (kind === 'psyker') {
      // A ring of floating debris held up by its mind.
      ctx.fillStyle = flat('#8a7a90');
      const wind = (z.yank?.windup ?? 0) > 0;
      for (let i = 0; i < 5; i++) {
        const a = this.clock * (wind ? 6 : 1.5) + i * 1.26 + z.id;
        const rr = r * (wind ? 1.25 : 1.5);
        ctx.fillRect(Math.cos(a) * rr - 1.5, Math.sin(a) * rr - 1.5, 3 + (i % 2), 3);
      }
    }
    if (kind === 'sludger' || kind === 'sludge') {
      // Fresh sludge bubbling up and dripping off.
      ctx.fillStyle = flat('#b8e040');
      for (let i = 0; i < 3; i++) {
        const t = (this.clock * 0.8 + i / 3 + z.id * 0.37) % 1;
        const a = i * 2.1 + z.id;
        ctx.globalAlpha = alpha * (1 - t);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * (0.4 + t * 0.6), Math.sin(a) * r * (0.4 + t * 0.6), r * 0.14 * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if ((z.stun ?? 0) > 0) {
      // Dizzy stars
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) {
        const a = this.clock * 6 + (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(z.x + Math.cos(a) * r * 0.9, z.y - r - 6 + Math.sin(a) * r * 0.3, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (z.frozenT > 0) {
      // Ice block
      ctx.fillStyle = 'rgba(190,235,255,0.45)';
      ctx.strokeStyle = 'rgba(230,250,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(z.x - r * 1.2, z.y - r * 1.2, r * 2.4, r * 2.4, 4);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.moveTo(z.x - r * 0.9, z.y - r * 0.5);
      ctx.lineTo(z.x - r * 0.5, z.y - r * 0.9);
      ctx.stroke();
    }
    if (z.charm > 0) {
      // A little spiral over its head while it fights for you.
      ctx.strokeStyle = '#d8a8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 14; k++) {
        const a = this.clock * 8 + k * 0.6;
        const rr = 2 + k * 0.45;
        ctx.lineTo(z.x + Math.cos(a) * rr, z.y - r - 12 + Math.sin(a) * rr * 0.5);
      }
      ctx.stroke();
    }
    if (z.elite) {
      const c = ELITES[z.elite].color;
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.clock * 8 + z.id);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(z.x, z.y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (z.charm > 0) {
      // Turned: the bar shows how long until its brain fries.
      const w = Math.max(20, r * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(z.x - w / 2, z.y - r - 6, w, 3);
      ctx.fillStyle = '#c77dff';
      ctx.fillRect(z.x - w / 2, z.y - r - 6, w * Math.min(1, z.charm / 7), 3);
    } else if (z.hp < z.maxHp && !isBoss(z) && this.crawlerAlpha(z) > 0.5 && !z.latch) {
      const w = r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(z.x - w / 2, z.y - r - 10, w, 4);
      ctx.fillStyle = z.healing ? '#7aff5a' : '#e0483e';
      ctx.fillRect(z.x - w / 2, z.y - r - 10, w * Math.max(0, z.hp / z.maxHp), 4);
    }
  }

  /** A mimic still in disguise: drawn exactly like a loot crate, give or take a twitch. */
  private drawMimicCrate(z: Zombie) {
    const ctx = this.ctx;
    const twitch = Math.sin(this.clock * 1.3 + z.id) > 0.97 ? rand(-1.5, 1.5) : 0;
    const bob = Math.sin(this.clock * 4) * 2;
    const x = z.x + twitch;
    ctx.fillStyle = 'rgba(255,210,63,0.25)';
    ctx.beginPath();
    ctx.arc(x, z.y, 22 + Math.sin(this.clock * 6) * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = z.flash > 0 ? '#fff' : '#8a5a20';
    ctx.fillRect(x - 13, z.y - 11 + bob, 26, 22);
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 13, z.y - 11 + bob, 26, 22);
    ctx.beginPath();
    ctx.moveTo(x - 13, z.y - 3 + bob);
    ctx.lineTo(x + 13, z.y - 3 + bob);
    ctx.stroke();
  }

  /** Patient Zero's moving parts: restraints (form 1), glowing cracks (form 2+), the eye (form 3). */
  private drawZeroParts(z: Zombie, hit: boolean) {
    const ctx = this.ctx;
    const r = z.r;
    const Z = z.zero!;
    const flat = (c: string) => (hit ? '#ffffff' : c);
    if (Z.phase === 1) {
      // Containment harness: steel collar, straps across the body, snapped chains.
      ctx.strokeStyle = flat('#5a6066');
      ctx.lineWidth = r * 0.09;
      ctx.beginPath();
      ctx.arc(r * 0.5, 0, r * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = flat('#a8b0b8');
      ctx.lineWidth = r * 0.03;
      ctx.beginPath();
      ctx.arc(r * 0.5, 0, r * 0.4, -1.2, -0.4);
      ctx.stroke();
      ctx.strokeStyle = flat('#3a3028');
      ctx.lineWidth = r * 0.12;
      for (const off of [-0.25, 0.15]) {
        ctx.beginPath();
        ctx.moveTo(r * off - r * 0.25, -r * 0.95);
        ctx.quadraticCurveTo(r * off, 0, r * off - r * 0.25, r * 0.95);
        ctx.stroke();
      }
      ctx.fillStyle = flat('#c8a020');
      for (const off of [-0.25, 0.15]) ctx.fillRect(r * off - r * 0.08, -r * 0.08, r * 0.14, r * 0.16);
      // Broken chain links swinging off the collar
      ctx.strokeStyle = flat('#8a9298');
      ctx.lineWidth = r * 0.035;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const sw = Math.sin(this.clock * 4 + k + side) * 0.2;
          ctx.beginPath();
          ctx.ellipse(r * (0.3 - k * 0.2), side * r * (0.45 + k * 0.12 + sw * 0.2), r * 0.08, r * 0.05, k % 2 ? 0 : Math.PI / 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    } else {
      // Cracks glowing hot pink through the skin.
      ctx.strokeStyle = hit ? '#fff' : `rgba(255,${120 + Math.floor(60 * Math.sin(this.clock * 5))},230,0.85)`;
      ctx.lineWidth = r * 0.035;
      ctx.lineCap = 'round';
      const cracks = [
        [-0.2, -0.7, 0.1, -0.3, 0.3, -0.45],
        [-0.7, 0.2, -0.35, 0.35, -0.1, 0.75],
        [0.1, 0.2, 0.25, 0.45, 0.05, 0.7],
        [-0.6, -0.5, -0.3, -0.35, -0.35, -0.1],
      ];
      for (const c of cracks) {
        ctx.beginPath();
        ctx.moveTo(c[0] * r, c[1] * r);
        ctx.lineTo(c[2] * r, c[3] * r);
        ctx.lineTo(c[4] * r, c[5] * r);
        ctx.stroke();
      }
    }
    if (Z.phase === 3) {
      // A huge eye splits open across its chest and tracks you.
      const open = Z.trans > 0 ? 1 - Z.trans / 1.5 : 1;
      ctx.save();
      ctx.translate(r * 0.05, 0);
      ctx.fillStyle = '#2a0408';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.34, r * 0.24 * open + 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.3, r * 0.2 * open + 0.3, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = flat('#f4e8e0');
      ctx.fillRect(-r * 0.35, -r * 0.25, r * 0.7, r * 0.5);
      const look = Z.laserW > 0 || Z.laserT > 0 ? 0 : Math.sin(this.clock * 1.7) * 0.4;
      ctx.fillStyle = flat('#ff3ad0');
      ctx.beginPath();
      ctx.arc(r * 0.12, r * look * 0.2, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a0010';
      ctx.beginPath();
      ctx.ellipse(r * 0.15, r * look * 0.2, r * 0.04, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }
  }

  private drawEgg(z: Zombie) {
    const ctx = this.ctx;
    const ripe = 1 - clamp(z.abilityCd / 3.6, 0, 1);
    const wob = Math.sin(this.clock * (8 + ripe * 20) + z.id) * ripe * 0.12;
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.rotate(wob);
    stamp(ctx, eggSprite(z.def, z.flash > 0 ? Tint.Hit : Tint.None), z.r);
    // Whatever is inside darkens and twitches as it gets ready to hatch.
    ctx.fillStyle = `rgba(120,30,20,${ripe * 0.45})`;
    ctx.beginPath();
    ctx.ellipse(Math.sin(this.clock * 20 + z.id) * ripe * 2, 2, z.r * 0.45, z.r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (z.hp < z.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(z.x - z.r, z.y - z.r - 14, z.r * 2, 4);
      ctx.fillStyle = '#ffcf5a';
      ctx.fillRect(z.x - z.r, z.y - z.r - 14, z.r * 2 * Math.max(0, z.hp / z.maxHp), 4);
    }
  }

  private drawPlayer() {
    const ctx = this.ctx;
    const p = this.p;
    const w = this.weapons[this.wi];
    for (const g of this.ghosts) {
      ctx.globalAlpha = g.life * 1.6;
      ctx.fillStyle = this.skin?.[2] ?? SUITS[this.slot][2];
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, 13, 17, g.a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const hurt = this.hurtFlash > 0 && Math.floor(this.hurtFlash * 30) % 2 === 0;
    this.drawSoldier(p.x, p.y, p.angle, w.def, this.spin, hurt, this.slot, this.down, this.reviveProg);
    if (!this.down) this.drawOrbitals();
  }

  private drawAllies() {
    for (const a of this.allies) this.drawSoldier(a.x, a.y, a.angle, WEAPON_BY_ID.get(a.weapon) ?? WEAPONS[0], a.firing ? 1 : 0, false, a.slot, a.down, a.revive);
  }

  /** Names and health bars over teammates, drawn above the darkness. */
  private drawAllyTags() {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    for (const a of this.allies) {
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillStyle = '#000';
      ctx.fillText(a.name, a.x + 1, a.y - 33);
      ctx.fillStyle = a.down ? '#ff5a4a' : SUITS[a.slot][2];
      ctx.fillText(a.down ? `${a.name} · DOWN` : a.name, a.x, a.y - 34);
      if (a.down) continue;
      const f = clamp(a.hp / a.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(a.x - 16, a.y - 29, 32, 4);
      ctx.fillStyle = f > 0.3 ? '#4fbf4a' : '#e0483e';
      ctx.fillRect(a.x - 16, a.y - 29, 32 * f, 4);
    }
  }

  private drawSoldier(x: number, y: number, angle: number, def: WeaponDef, spin: number, hurt: boolean, slot: number, down: boolean, revive: number) {
    const ctx = this.ctx;
    const suit = (slot === this.slot && this.skin) || SUITS[slot] || SUITS[0];
    ctx.save();
    ctx.translate(x, y);
    if (down) {
      // Knocked down: flat on the floor with a pulsing ring and the revive progress.
      ctx.strokeStyle = `rgba(255,70,60,${0.35 + 0.25 * Math.sin(this.clock * 6)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, REVIVE_RANGE, 0, Math.PI * 2);
      ctx.stroke();
      if (revive > 0) {
        ctx.strokeStyle = '#5dff7a';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * revive);
        ctx.stroke();
      }
      ctx.rotate(angle);
      ctx.scale(1, 0.75);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#5a1a14';
      ctx.beginPath();
      ctx.ellipse(-4, 4, 22, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = suit[0];
      ctx.beginPath();
      ctx.ellipse(0, 0, 17, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = suit[2];
      ctx.beginPath();
      ctx.arc(14, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(3, 5, 17, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(angle);
    const gl = def.length;
    const kind = def.id;
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(6, kind === 'minigun' || kind === 'rocket' ? -5 : -3.5, gl, kind === 'minigun' || kind === 'rocket' ? 10 : 7);
    if (kind === 'minigun') {
      ctx.fillStyle = '#555';
      const spinOff = (this.clock * 60 * spin) % 3;
      for (let i = -1; i <= 1; i++) ctx.fillRect(14, i * 3 - 1 + spinOff * 0.3, gl - 8, 1.5);
    } else if (kind === 'flamer') {
      ctx.fillStyle = '#8a2c1a';
      ctx.fillRect(-14, -6, 8, 12);
      ctx.fillStyle = '#ff8a2b';
      ctx.fillRect(gl + 3, -1.5, 3, 3);
    } else if (kind === 'rocket') {
      ctx.fillStyle = '#4a5a3a';
      ctx.fillRect(2, -6, gl + 2, 12);
    } else if (kind === 'crossbow') {
      ctx.strokeStyle = '#6a4a2a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gl - 4, -12);
      ctx.quadraticCurveTo(gl + 6, 0, gl - 4, 12);
      ctx.stroke();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gl - 4, -12);
      ctx.lineTo(10, 0);
      ctx.lineTo(gl - 4, 12);
      ctx.stroke();
    } else if (kind === 'acid') {
      ctx.fillStyle = '#3a5a1a';
      ctx.fillRect(4, -7, 14, 14);
      ctx.fillStyle = '#9aff3a';
      ctx.fillRect(7, -5, 8, 10);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(gl - 6, -5, 8, 10);
    } else if (kind === 'swarm') {
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(6, -8, gl - 4, 16);
      ctx.fillStyle = '#1a1a1a';
      for (const o of [-5, 0, 5]) {
        ctx.beginPath();
        ctx.arc(gl + 1, o, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'glaive') {
      ctx.fillStyle = '#4a5a68';
      ctx.fillRect(6, -5, gl - 12, 10);
      ctx.fillStyle = '#e0f4ff';
      ctx.beginPath();
      ctx.moveTo(gl - 8, -9);
      ctx.quadraticCurveTo(gl + 4, 0, gl - 8, 9);
      ctx.quadraticCurveTo(gl - 2, 0, gl - 8, -9);
      ctx.fill();
    } else if (kind === 'harpoon') {
      ctx.fillStyle = '#4a4f54';
      ctx.fillRect(4, -6, gl - 12, 12);
      ctx.fillStyle = '#8a6a4a';
      ctx.fillRect(gl - 14, -1.5, 16, 3);
      ctx.fillStyle = '#c8d0d8';
      ctx.beginPath();
      ctx.moveTo(gl + 6, 0);
      ctx.lineTo(gl - 2, -5);
      ctx.lineTo(gl, 0);
      ctx.lineTo(gl - 2, 5);
      ctx.fill();
    } else if (kind === 'cluster') {
      ctx.fillStyle = '#5a4a2a';
      ctx.fillRect(6, -8, gl - 6, 16);
      ctx.fillStyle = '#ffcf5a';
      for (const o of [-4, 4]) {
        ctx.beginPath();
        ctx.arc(gl - 6, o, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(gl - 2, -7, 4, 14);
    } else if (kind === 'singularity') {
      ctx.fillStyle = '#2a2040';
      ctx.fillRect(6, -6, gl - 6, 12);
      for (const o of [0.35, 0.6, 0.85]) {
        ctx.strokeStyle = '#c08aff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(gl * o, -7);
        ctx.lineTo(gl * o, 7);
        ctx.stroke();
      }
      ctx.fillStyle = '#e0c8ff';
      ctx.beginPath();
      ctx.arc(gl, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'ripper') {
      ctx.fillStyle = '#5a6068';
      ctx.beginPath();
      ctx.arc(gl - 6, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c8d0d8';
      ctx.beginPath();
      ctx.arc(gl - 6, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#353535';
      ctx.fillRect(6, -2, gl - 6, 2);
    }
    // Arms holding the gun
    ctx.fillStyle = '#c9a27e';
    ctx.beginPath();
    ctx.arc(14, 5, 4, 0, Math.PI * 2);
    ctx.arc(20, -1, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hurt ? '#ff6a5a' : suit[0];
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    // Backpack
    ctx.fillStyle = hurt ? '#ff8a7a' : suit[1];
    ctx.fillRect(-13, -8, 7, 16);
    ctx.fillStyle = hurt ? '#ffaaa0' : suit[2];
    ctx.beginPath();
    ctx.arc(1, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    // Helmet lamp
    ctx.fillStyle = '#fff6cc';
    ctx.fillRect(8, -2.5, 3, 5);
    ctx.restore();
  }

  private drawOrbitals() {
    const ctx = this.ctx;
    const p = this.p;
    const n = this.stats.blades;
    for (let i = 0; i < n; i++) {
      const a = this.bladeAngle + (i * Math.PI * 2) / n;
      const bx = p.x + Math.cos(a) * 78;
      const by = p.y + Math.sin(a) * 78;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(this.clock * 20);
      ctx.fillStyle = '#c8ccd0';
      ctx.beginPath();
      for (let t = 0; t < 8; t++) {
        const aa = (t / 8) * Math.PI * 2;
        ctx.lineTo(Math.cos(aa) * 13, Math.sin(aa) * 13);
        ctx.lineTo(Math.cos(aa + 0.4) * 8, Math.sin(aa + 0.4) * 8);
      }
      ctx.fill();
      ctx.fillStyle = '#555';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < this.stats.drones; i++) {
      const d = this.dronePos(i);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(d.x + 4, d.y + 14, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a4a5a';
      ctx.fillRect(d.x - 9, d.y - 4, 18, 8);
      ctx.fillStyle = '#7ef0ff';
      ctx.beginPath();
      ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Co-op: teammates' health on the left, arrows to anyone off screen, and the downed overlay. */
  private drawSquadHud(pad: number) {
    const ctx = this.ctx;
    ctx.textAlign = 'left';
    let y = pad + 86;
    for (const a of this.allies) {
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillStyle = a.down ? '#ff5a4a' : SUITS[a.slot][2];
      ctx.fillText(a.down ? `${a.name} DOWN` : a.name, pad, y);
      const f = a.down ? a.revive : clamp(a.hp / a.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(pad, y + 7, 90, 5);
      ctx.fillStyle = a.down ? '#5dff7a' : f > 0.3 ? '#4fbf4a' : '#e0483e';
      ctx.fillRect(pad, y + 7, 90 * f, 5);
      y += 24;
      // Off-screen arrow
      const sp = this.toScreen(a.x, a.y);
      const m = 28;
      if (sp.x < m || sp.y < m || sp.x > this.w - m || sp.y > this.h - m) {
        const cx = this.w / 2;
        const cy = this.h / 2;
        const ang = Math.atan2(sp.y - cy, sp.x - cx);
        const t = Math.min(Math.abs((cx - m) / (Math.cos(ang) || 1e-6)), Math.abs((cy - m) / (Math.sin(ang) || 1e-6)));
        ctx.save();
        ctx.translate(cx + Math.cos(ang) * t, cy + Math.sin(ang) * t);
        ctx.rotate(ang);
        ctx.fillStyle = a.down ? (Math.sin(this.clock * 8) > 0 ? '#ff5a4a' : '#701010') : SUITS[a.slot][2];
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-8, -9);
        ctx.lineTo(-8, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.textAlign = 'center';
    if (this.down && this.state === 'playing') {
      ctx.font = `20px ${FONT}`;
      ctx.fillStyle = '#ff5a4a';
      ctx.fillText(this.reviveProg > 0 ? 'GETTING REVIVED…' : "YOU'RE DOWN", this.w / 2, this.h * 0.7);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('A teammate has to stand next to you', this.w / 2, this.h * 0.7 + 20);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(this.w / 2 - 70, this.h * 0.7 + 30, 140, 6);
      ctx.fillStyle = '#5dff7a';
      ctx.fillRect(this.w / 2 - 70, this.h * 0.7 + 30, 140 * this.reviveProg, 6);
    }
    if (this.hostPaused) {
      ctx.font = `28px ${FONT}`;
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('HOST PAUSED', this.w / 2, this.h * 0.45);
    }
  }

  /** Story mode objective progress for the HUD. */
  private opHudLine() {
    const g = this.op!.goal;
    const S = this.opS;
    const left = (n: number) => `${Math.max(0, Math.ceil(n - S.t))}s`;
    switch (g.type) {
      case 'survive':
        return `SURVIVE  ·  ${left(g.time)} LEFT`;
      case 'kill':
        return `${(g.kind ?? 'zombie').toUpperCase()}S  ${Math.min(S.n, g.n)} / ${g.n}`;
      case 'collect':
        return `DATA DRIVES  ${S.n} / ${g.n}`;
      case 'defend':
        return `DEFEND THE GENERATOR  ·  ${left(g.time)} LEFT`;
      case 'evac':
        return S.zone ? `HOLD THE LANDING ZONE  ${S.zone.hold.toFixed(1)} / ${g.hold}s` : `CHOPPER INBOUND  ·  ${left(g.after)}`;
      case 'boss':
        return 'KILL PATIENT ZERO';
    }
  }

  /** Radio subtitles, the DASH warning, power status and objective arrows. */
  private drawLabHud(pad: number) {
    const ctx = this.ctx;
    // Off-screen arrows to objectives
    const marks: { x: number; y: number; color: string }[] = [];
    if (this.op) {
      const S = this.opS;
      if (S.drives.length) {
        let best = S.drives[0];
        for (const d of S.drives) if (Math.hypot(d.x - this.p.x, d.y - this.p.y) < Math.hypot(best.x - this.p.x, best.y - this.p.y)) best = d;
        marks.push({ x: best.x, y: best.y, color: '#5dff7a' });
      }
      if (S.zone) marks.push({ x: S.zone.x, y: S.zone.y, color: '#5dff7a' });
      if (S.gen) marks.push({ x: S.gen.x, y: S.gen.y, color: S.gen.hurt > 0 ? '#ff5a4a' : '#ffd23f' });
    }
    for (const m of marks) {
      const s = this.toScreen(m.x, m.y);
      const mg = 46;
      if (s.x > mg && s.x < this.w - mg && s.y > mg && s.y < this.h - mg) continue;
      const a = Math.atan2(s.y - this.h / 2, s.x - this.w / 2);
      const ex = clamp(s.x, mg, this.w - mg);
      const ey = clamp(s.y, mg + 40, this.h - mg);
      const bob = Math.sin(this.clock * 6) * 4;
      ctx.save();
      ctx.translate(ex + Math.cos(a) * bob, ey + Math.sin(a) * bob);
      ctx.rotate(a);
      ctx.fillStyle = m.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-8, -11);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-8, 11);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    // Power status on maps with power cuts
    if (this.map.powercut && this.power.out > 0) {
      ctx.textAlign = 'right';
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = Math.sin(this.clock * 8) > 0 ? '#ff4a3a' : '#7a2a24';
      ctx.fillText(`⚡ POWER OUT  ${Math.ceil(this.power.out)}s`, this.w - 62, pad + 50);
    }
    // Parasites on you: flashing DASH prompt
    if (this.latchedCount() > 0 && this.state === 'playing') {
      const a = 0.6 + 0.4 * Math.sin(this.clock * 14);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = `${Math.round(Math.min(34, this.w / 16))}px ${FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText('DASH TO SHAKE IT OFF!', this.w / 2 + 2, this.h * 0.72 + 2);
      ctx.fillStyle = '#ff5a4a';
      ctx.fillText('DASH TO SHAKE IT OFF!', this.w / 2, this.h * 0.72);
      ctx.globalAlpha = 1;
    }
    // Radio subtitles
    const sb = this.subtitle;
    if (sb.t > 0 && this.state === 'playing') {
      ctx.globalAlpha = Math.min(1, sb.t * 2, (5.5 - sb.t) * 5);
      ctx.font = '600 14px system-ui, sans-serif';
      // Top of the screen, between the health and weapon panels, clear of the fight.
      const maxW = clamp(this.w - 440, 300, 560);
      const words = sb.text.split(' ');
      const lines: string[] = [];
      let cur = '';
      for (const wd of words) {
        const t = cur ? `${cur} ${wd}` : wd;
        if (ctx.measureText(t).width > maxW - 90 && cur) {
          lines.push(cur);
          cur = wd;
        } else cur = t;
      }
      if (cur) lines.push(cur);
      const bh = 26 + lines.length * 18;
      const bx = this.w / 2 - maxW / 2;
      const by = pad + 50 + (this.zombies.some(isBoss) ? 36 : 0);
      ctx.fillStyle = 'rgba(8,12,10,0.84)';
      ctx.fillRect(bx, by, maxW, bh);
      ctx.fillStyle = sb.who === OKAFOR ? '#5ac8ff' : '#ffd23f';
      ctx.fillRect(bx, by, 4, bh);
      // Static-y portrait square
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(bx + 12, by + 10, 50, bh - 20);
      ctx.font = '22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(sb.who === OKAFOR ? '🔬' : '🎖️', bx + 37, by + bh / 2 + 1);
      ctx.textAlign = 'left';
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = sb.who === OKAFOR ? '#5ac8ff' : '#ffd23f';
      ctx.fillText(`📻 ${sb.who}`, bx + 74, by + 14);
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillStyle = '#eef2e6';
      lines.forEach((l, i) => ctx.fillText(l, bx + 74, by + 33 + i * 18));
      ctx.globalAlpha = 1;
    }
  }

  private drawHud() {
    const ctx = this.ctx;
    const pad = 14;
    ctx.textBaseline = 'middle';

    // Health
    const hw = Math.min(220, this.w * 0.36);
    ctx.fillStyle = HUD_PLATE;
    ctx.fillRect(pad, pad, hw, 20);
    const frac = clamp(this.p.hp / this.stats.maxHp, 0, 1);
    const barX = pad + 26;
    const barW = hw - 92;
    // Segmented health bar
    const segs = 20;
    const segW = barW / segs;
    const lit = Math.ceil(frac * segs - 0.001);
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i < lit ? (frac > 0.3 ? '#a6e05a' : '#e0483e') : 'rgba(255,255,255,0.08)';
      ctx.fillRect(barX + i * segW, pad + 4, segW - 1.5, 12);
    }
    brackets(ctx, pad, pad, hw, 20, 6, frac > 0.3 ? HUD_AMBER : '#e0483e');
    ctx.textAlign = 'left';
    ctx.fillStyle = HUD_AMBER;
    ctx.font = `13px ${MONO}`;
    ctx.fillText('HP', pad + 5, pad + 11);
    ctx.fillStyle = '#fff';
    ctx.font = `12px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(Math.max(0, this.p.hp))}/${this.stats.maxHp}`, pad + hw - 5, pad + 11);
    ctx.textAlign = 'left';
    if (this.armor > 0) ctx.fillText(`🛡️ ${Math.round(this.armor * 100)}%`, pad + hw + 8, pad + 11);

    // Cash + grenades
    ctx.font = `${this.cashPulse > 0 ? 24 : 21}px ${FONT}`;
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`$${Math.floor(this.cash)}`, pad, pad + 40);
    const cashW = ctx.measureText(`$${Math.floor(this.cash)}`).width;
    ctx.font = `15px ${MONO}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(`💣 ${this.grenadeCount}`, pad + cashW + 16, pad + 40);
    ctx.font = `${this.brainsPulse > 0 ? 17 : 15}px ${MONO}`;
    ctx.fillStyle = '#ff8ad8';
    ctx.fillText(`🧠 ${this.report.brains}${this.reviveLeft ? '  ✚' : ''}`, pad + cashW + 62, pad + 40);

    // Perks
    let px = pad;
    for (const perk of PERKS) {
      const c = this.perkCounts.get(perk.id);
      if (!c) continue;
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText(perk.icon, px, pad + 64);
      if (c > 1) {
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(String(c), px + 16, pad + 70);
      }
      px += c > 1 ? 30 : 24;
    }

    // Wave
    ctx.textAlign = 'center';
    const waveSub = `${this.toSpawn + this.zombies.length} HOSTILES${this.modeLabel ? `  //  ${this.modeLabel.toUpperCase()}` : ''}`;
    ctx.font = `12px ${MONO}`;
    const plateW = Math.max(130, ctx.measureText(waveSub).width + 24);
    ctx.fillStyle = HUD_PLATE;
    ctx.fillRect(this.w / 2 - plateW / 2, pad - 6, plateW, 46);
    brackets(ctx, this.w / 2 - plateW / 2, pad - 6, plateW, 46);
    ctx.fillStyle = '#fff';
    if (this.op) {
      ctx.font = `20px ${FONT}`;
      ctx.fillText(this.op.name.toUpperCase(), this.w / 2, pad + 9);
      ctx.font = `12px ${MONO}`;
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(this.opHudLine(), this.w / 2, pad + 29);
    } else {
      ctx.font = `22px ${FONT}`;
      ctx.fillText(`WAVE ${this.wave}`, this.w / 2, pad + 9);
      ctx.font = `12px ${MONO}`;
      ctx.fillStyle = '#c9d1b8';
      ctx.fillText(waveSub, this.w / 2, pad + 29);
    }

    let rowY = pad + 50;
    if (this.challenge) {
      const beat = this.wave > this.challenge.wave;
      ctx.font = `13px ${FONT}`;
      ctx.fillStyle = beat ? '#5dff7a' : '#ffd23f';
      ctx.fillText(beat ? `⚔ CHALLENGE BEATEN (WAVE ${this.challenge.wave})` : `⚔ BEAT WAVE ${this.challenge.wave}`, this.w / 2, rowY - 2);
      rowY += 16;
    }
    const boss = this.zombies.find(isBoss);
    if (boss) {
      const bw = Math.min(360, this.w * 0.5);
      const bx = this.w / 2 - bw / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx, rowY - 6, bw, 12);
      const shielded = boss.def.kind === 'brood' && this.countKind('egg') > 0;
      ctx.fillStyle = BOSS_COLORS[boss.def.kind] ?? '#b05bd6';
      ctx.fillRect(bx + 2, rowY - 4, (bw - 4) * Math.max(0, boss.hp / boss.maxHp), 8);
      if (boss.def.kind === 'zero') {
        // Phase ticks at 2/3 and 1/3, and a white flicker while it transforms.
        ctx.fillStyle = '#fff';
        for (const f of [2 / 3, 1 / 3]) ctx.fillRect(bx + 2 + (bw - 4) * f - 1, rowY - 7, 2, 14);
        if (boss.zero && boss.zero.trans > 0) {
          ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(this.clock * 30)})`;
          ctx.fillRect(bx + 2, rowY - 4, bw - 4, 8);
        }
      }
      ctx.fillStyle = '#fff';
      ctx.font = `11px ${FONT}`;
      const zp = boss.zero ? `  ·  FORM ${boss.zero.phase}/3${boss.zero.trans > 0 ? '  (MUTATING!)' : ''}` : '';
      ctx.fillText(`${BOSS_NAMES[boss.def.kind]}${boss.mini ? ' (MINI)' : ''}${shielded ? '  (SHIELDED BY EGGS)' : ''}${zp}`, this.w / 2, rowY + 15);
      rowY += 34;
    }
    // Active power-ups
    const act = (Object.keys(this.active) as PowerKind[]).filter((k) => this.active[k] > 0);
    act.forEach((k, i) => {
      const def = POWERUPS[k];
      const x = this.w / 2 + (i - (act.length - 1) / 2) * 120;
      ctx.fillStyle = def.color;
      ctx.font = `12px ${FONT}`;
      ctx.fillText(`${def.icon} ${def.name}`, x, rowY);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x - 45, rowY + 9, 90, 3);
      ctx.fillStyle = def.color;
      ctx.fillRect(x - 45, rowY + 9, 90 * (this.active[k] / def.duration), 3);
    });

    // Weapon + ammo (top right, left of the pause button)
    const w = this.weapons[this.wi];
    ctx.textAlign = 'right';
    const wName = `${w.def.name}${w.level > 1 ? ` Lv${w.level}` : ''}`.toUpperCase();
    ctx.font = `15px ${FONT}`;
    const wBoxW = Math.max(100, ctx.measureText(wName).width + 20);
    ctx.fillStyle = HUD_PLATE;
    ctx.fillRect(this.w - 64 - wBoxW, pad - 6, wBoxW, 50);
    brackets(ctx, this.w - 64 - wBoxW, pad - 6, wBoxW, 50);
    ctx.fillStyle = '#fff';
    ctx.fillText(wName, this.w - 74, pad + 8);
    ctx.font = `16px ${MONO}`;
    if (w.reloadT > 0) {
      const tot = w.def.reload * this.stats.reload;
      ctx.fillStyle = '#ffb347';
      ctx.fillText('RELOADING', this.w - 74, pad + 28);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(this.w - 154, pad + 38, 80, 4);
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(this.w - 154, pad + 38, 80 * (1 - w.reloadT / tot), 4);
    } else if (this.active.ammo > 0) {
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('∞ BOTTOMLESS', this.w - 74, pad + 28);
    } else {
      ctx.fillStyle = w.ammo === 0 ? '#e0483e' : '#c9d1b8';
      ctx.fillText(`${w.ammo} / ${this.weaponMag(w)}`, this.w - 74, pad + 28);
    }

    // Combo meter (left side, clear of the touch buttons)
    if (this.combo >= 3) {
      const cx = pad;
      const cy = Math.max(pad + 100, Math.min(this.h * 0.4, 170)) + this.allies.length * 24;
      const pop = 1 + Math.max(0, this.comboPop) * 2;
      ctx.textAlign = 'left';
      ctx.font = `${Math.round(30 * pop)}px ${FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText(`x${this.combo}`, cx + 2, cy + 2);
      ctx.fillStyle = this.combo >= 50 ? '#ff5a4a' : this.combo >= 25 ? '#ffb347' : '#ffd23f';
      ctx.fillText(`x${this.combo}`, cx, cy);
      ctx.font = `12px ${MONO}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`COMBO  +${Math.min(this.combo, 100)}% CASH`, cx, cy + 22);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(cx, cy + 32, 90, 3);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(cx, cy + 32, 90 * (this.comboT / COMBO_TIME), 3);
    }

    if (this.allies.length) this.drawSquadHud(pad);
    this.drawLabHud(pad);

    // Buttons
    for (const b of this.input.buttons) {
      const held = this.input.heldButtons.has(b.id);
      ctx.fillStyle = held ? 'rgba(240,180,41,0.35)' : 'rgba(8,10,7,0.6)';
      ctx.strokeStyle = held ? HUD_AMBER : 'rgba(166,180,140,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Four tick marks, like a scope ring
      ctx.strokeStyle = HUD_AMBER;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        ctx.moveTo(b.x + Math.cos(a) * (b.r - 4), b.y + Math.sin(a) * (b.r - 4));
        ctx.lineTo(b.x + Math.cos(a) * (b.r + 2), b.y + Math.sin(a) * (b.r + 2));
      }
      ctx.stroke();
      if (b.id === 'dash' && this.dashCd > 0) {
        ctx.strokeStyle = '#78aaff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - this.dashCd / DASH_COOLDOWN));
        ctx.stroke();
      }
      ctx.fillStyle = b.id === 'nade' && this.grenadeCount === 0 ? 'rgba(255,255,255,0.3)' : '#fff';
      ctx.textAlign = 'center';
      ctx.font = `${b.label.length > 2 ? 12 : 16}px ${MONO}`;
      ctx.fillText(b.label, b.x, b.y + 1);
      if (b.id === 'nade') {
        ctx.font = `11px ${MONO}`;
        ctx.fillText(String(this.grenadeCount), b.x, b.y + 13);
      }
      if (b.id === 'deploy' && this.kit.length > 1) {
        ctx.font = '800 10px system-ui, sans-serif';
        ctx.fillText(`x${this.kit.length}`, b.x + b.r * 0.7, b.y - b.r * 0.7);
      }
    }

    // Touch sticks
    const inp = this.input;
    if (inp.touchMode && this.state === 'playing') {
      for (const s of [inp.move, inp.aim]) {
        if (!s) continue;
        const v = stickVec(s);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.ox, s.oy, STICK_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = s === inp.aim ? 'rgba(224,72,62,0.55)' : 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.arc(s.ox + v.x * STICK_RADIUS, s.oy + v.y * STICK_RADIUS, 24, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.wave === 1 && this.runTime < 8) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `13px ${MONO}`;
        ctx.textAlign = 'center';
        if (!inp.move) ctx.fillText('drag here to move', this.w * 0.22, this.h - 50);
        if (!inp.aim) ctx.fillText('drag here to aim + shoot', this.w * 0.68, this.h - 50);
      }
    } else if (this.state === 'playing') {
      // Crosshair
      const m = inp.mouse;
      ctx.strokeStyle = this.active.rage > 0 ? '#ff5a4a' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
      ctx.moveTo(m.x - 15, m.y);
      ctx.lineTo(m.x - 5, m.y);
      ctx.moveTo(m.x + 5, m.y);
      ctx.lineTo(m.x + 15, m.y);
      ctx.moveTo(m.x, m.y - 15);
      ctx.lineTo(m.x, m.y - 5);
      ctx.moveTo(m.x, m.y + 5);
      ctx.lineTo(m.x, m.y + 15);
      ctx.stroke();
    }

    // Toasts (badges, clips)
    if (this.state === 'playing' || this.state === 'between') {
      ctx.textAlign = 'center';
      ctx.font = `14px ${MONO}`;
      this.toasts.forEach((t, i) => {
        const y = this.h - 120 - i * 34;
        const tw = ctx.measureText(t.text).width + 28;
        ctx.globalAlpha = Math.min(1, t.t * 2, (2.6 - t.t) * 6);
        ctx.fillStyle = 'rgba(8,10,7,0.86)';
        ctx.fillRect(this.w / 2 - tw / 2, y - 13, tw, 26);
        ctx.fillStyle = HUD_AMBER;
        ctx.fillRect(this.w / 2 - tw / 2, y - 13, 3, 26);
        brackets(ctx, this.w / 2 - tw / 2, y - 13, tw, 26, 6);
        ctx.fillStyle = HUD_AMBER;
        ctx.fillText(t.text, this.w / 2, y + 1);
      });
      ctx.globalAlpha = 1;
    }
    // Banner
    if (this.banner.t > 0 && this.state === 'playing') {
      const age = 2.4 - this.banner.t;
      const a = Math.min(1, this.banner.t * 2);
      const scale = age < 0.2 ? 1.6 - age * 3 : 1;
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(this.w / 2, this.h * 0.3);
      ctx.scale(scale, scale);
      ctx.font = `${Math.round(Math.min(60, this.w / 9))}px ${FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText(this.banner.text, 3, 3);
      ctx.fillStyle = this.banner.color;
      ctx.fillText(this.banner.text, 0, 0);
      if (this.banner.sub) {
        ctx.font = `16px ${FONT}`;
        ctx.fillStyle = '#e0483e';
        ctx.fillText(this.banner.sub, 0, 40);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // Combo shout
    if (this.shout.t > 0 && this.state === 'playing') {
      const age = 1.6 - this.shout.t;
      const scale = age < 0.15 ? 2 - age * 6.6 : 1 + (age - 0.15) * 0.08;
      ctx.globalAlpha = Math.min(1, this.shout.t * 2);
      ctx.save();
      ctx.translate(this.w / 2, this.h * 0.62);
      ctx.rotate(-0.06);
      ctx.scale(scale, scale);
      ctx.textAlign = 'center';
      ctx.font = `${Math.round(Math.min(44, this.w / 12))}px ${FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText(this.shout.text, 3, 3);
      ctx.fillStyle = this.shout.color;
      ctx.fillText(this.shout.text, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }
}
