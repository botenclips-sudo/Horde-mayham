import { MusicMood, Sfx, SfxKind } from './audio';
import { baseStats, BOSS_NAMES, COMBO_TIERS, EliteKind, ELITES, PERKS, PerkDef, POWERUPS, PowerKind, RARITY_WEIGHT, Stats, WEAPONS, WeaponDef, ZOMBIES, ZombieDef, ZombieKind } from './data';
import { meta, RunReport } from './meta';
import { Input, STICK_RADIUS, stickVec } from './input';

export const WORLD_W = 2200;
export const WORLD_H = 1600;
const PLAYER_R = 16;
const BORDER = 40;
const DASH_TIME = 0.18;
const DASH_COOLDOWN = 2.2;
const COMBO_TIME = 2.5;
const FLASHLIGHT = 560;
const DARKNESS = 0.86;

type WallKind = 'border' | 'concrete' | 'car' | 'crate';

interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: WallKind;
  color?: string;
}

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
}

interface Bolt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  color: string;
}

const isBoss = (z: Zombie) => z.def.kind === 'boss' || z.def.kind === 'brood' || z.def.kind === 'juggernaut';

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
  kind: 'cash' | 'health';
  value: number;
  pulled: boolean;
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
}

interface Spit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface Puddle {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  kind: 'acid' | 'toxic';
}

interface Barrel {
  x: number;
  y: number;
  hp: number;
  fuse: number;
  dead: boolean;
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
}

export type State = 'menu' | 'playing' | 'between' | 'paused' | 'over';

const WALLS: Wall[] = [
  // Arena border
  { x: 0, y: 0, w: WORLD_W, h: BORDER, kind: 'border' },
  { x: 0, y: WORLD_H - BORDER, w: WORLD_W, h: BORDER, kind: 'border' },
  { x: 0, y: 0, w: BORDER, h: WORLD_H, kind: 'border' },
  { x: WORLD_W - BORDER, y: 0, w: BORDER, h: WORLD_H, kind: 'border' },
  // Cover
  { x: 480, y: 330, w: 130, h: 60, kind: 'car', color: '#8a2c2c' },
  { x: 630, y: 334, w: 52, h: 52, kind: 'crate' },
  { x: 1480, y: 340, w: 240, h: 40, kind: 'concrete' },
  { x: 480, y: 1220, w: 240, h: 40, kind: 'concrete' },
  { x: 1560, y: 1200, w: 130, h: 60, kind: 'car', color: '#2c4f8a' },
  { x: 1496, y: 1206, w: 48, h: 48, kind: 'crate' },
  { x: 300, y: 680, w: 40, h: 240, kind: 'concrete' },
  { x: 1844, y: 690, w: 60, h: 130, kind: 'car', color: '#c9a227' },
  { x: 1040, y: 520, w: 56, h: 56, kind: 'crate' },
  { x: 1102, y: 532, w: 44, h: 44, kind: 'crate' },
  { x: 1036, y: 1010, w: 130, h: 60, kind: 'car', color: '#3f6b3a' },
];

const GATES = [
  { x: WORLD_W / 2, y: BORDER + 10 },
  { x: WORLD_W / 2, y: WORLD_H - BORDER - 10 },
  { x: BORDER + 10, y: WORLD_H / 2 },
  { x: WORLD_W - BORDER - 10, y: WORLD_H / 2 },
  { x: 200, y: BORDER + 10 },
  { x: WORLD_W - 200, y: BORDER + 10 },
  { x: 200, y: WORLD_H - BORDER - 10 },
  { x: WORLD_W - 200, y: WORLD_H - BORDER - 10 },
];

const LAMPS = [
  { x: 260, y: 240, flicker: false },
  { x: 1940, y: 240, flicker: true },
  { x: 260, y: 1360, flicker: true },
  { x: 1940, y: 1360, flicker: false },
  { x: 1100, y: 250, flicker: false },
  { x: 1100, y: 1350, flicker: true },
];

const BARREL_SPOTS = [
  { x: 760, y: 430 },
  { x: 1420, y: 430 },
  { x: 770, y: 1170 },
  { x: 1430, y: 1150 },
  { x: 600, y: 800 },
  { x: 1620, y: 790 },
  { x: 1180, y: 470 },
  { x: 980, y: 1120 },
  { x: 420, y: 470 },
  { x: 1800, y: 1120 },
];

// Flow field for zombie pathing: a BFS distance map from the player over a coarse grid.
const CELL = 40;
const FLOW_W = Math.ceil(WORLD_W / CELL);
const FLOW_H = Math.ceil(WORLD_H / CELL);
const BLOCKED = (() => {
  const b = new Uint8Array(FLOW_W * FLOW_H);
  const pad = 14;
  for (let cy = 0; cy < FLOW_H; cy++)
    for (let cx = 0; cx < FLOW_W; cx++) {
      const x0 = cx * CELL;
      const y0 = cy * CELL;
      for (const w of WALLS) {
        if (x0 + CELL > w.x - pad && x0 < w.x + w.w + pad && y0 + CELL > w.y - pad && y0 < w.y + w.h + pad) {
          b[cy * FLOW_W + cx] = 1;
          break;
        }
      }
    }
  return b;
})();
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
  flamer: 'Sets the horde on fire',
  rocket: 'Huge explosions',
  minigun: 'Spins up, shreds everything',
  launcher: 'Explodes on contact',
  sniper: 'Punches through 6 zombies',
  freeze: 'Freezes zombies solid',
  tesla: 'Lightning chains between zombies',
};

const BOSS_COLORS: Partial<Record<ZombieKind, string>> = { boss: '#c065ff', brood: '#ffcf5a', juggernaut: '#ff6a3a' };

const ELITE_KINDS = Object.keys(ELITES) as EliteKind[];

const NEW_KIND_WAVES: Record<number, string> = {
  5: 'SHIELD BRUTES SPOTTED',
  6: 'WATCH FOR LEAPERS',
  8: 'SCREAMERS ARE HERE',
  9: 'CRAWLERS IN THE DARK',
  11: 'DOG PACKS INCOMING',
  12: 'NECROMANCERS RAISE THE DEAD',
  13: 'ARMORED SOLDIERS: BREAK THEIR PLATES',
  14: 'ELECTRIC ZOMBIES',
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const FONT = "'Black Ops One', 'Arial Black', system-ui, sans-serif";

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
  private cam = { x: WORLD_W / 2, y: WORLD_H / 2 };
  private ground: HTMLCanvasElement;
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
  private mood: MusicMood | '' = '';
  private report: RunReport = Game.emptyReport();
  private reviveLeft = 0;
  private corpses: { x: number; y: number }[] = [];
  private nadeBlast = false;
  private bolts: Bolt[] = [];
  brainsPulse = 0;
  private clean = false;
  private moodLevel = -1;

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
    this.ground = this.buildGround();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.newRun();
    this.state = 'menu';
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

  /** Bakes the asphalt lot (lines, cracks, stains) into one big canvas. */
  private buildGround(): HTMLCanvasElement {
    const g = document.createElement('canvas');
    g.width = WORLD_W / 2;
    g.height = WORLD_H / 2;
    const c = g.getContext('2d')!;
    c.scale(0.5, 0.5);
    c.fillStyle = '#2b2e33';
    c.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let i = 0; i < 9000; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.09)';
      const s = rand(2, 7);
      c.fillRect(rand(0, WORLD_W), rand(0, WORLD_H), s, s);
    }
    // Big asphalt patches
    for (let i = 0; i < 26; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.025)';
      c.beginPath();
      c.ellipse(rand(0, WORLD_W), rand(0, WORLD_H), rand(80, 260), rand(60, 200), rand(0, 3), 0, Math.PI * 2);
      c.fill();
    }
    // Parking bays
    c.strokeStyle = 'rgba(230,230,210,0.22)';
    c.lineWidth = 6;
    for (let x = 160; x < WORLD_W - 120; x += 110) {
      for (const y0 of [60, WORLD_H - 230]) {
        if (Math.abs(x - WORLD_W / 2) < 120) continue;
        c.beginPath();
        c.moveTo(x, y0);
        c.lineTo(x, y0 + 170);
        c.stroke();
      }
    }
    // Center road with dashed yellow line
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(BORDER, WORLD_H / 2 - 150, WORLD_W - BORDER * 2, 300);
    c.strokeStyle = 'rgba(232,197,71,0.45)';
    c.lineWidth = 8;
    c.setLineDash([60, 50]);
    c.beginPath();
    c.moveTo(BORDER, WORLD_H / 2);
    c.lineTo(WORLD_W - BORDER, WORLD_H / 2);
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = 'rgba(230,230,210,0.25)';
    c.lineWidth = 5;
    for (const y of [WORLD_H / 2 - 150, WORLD_H / 2 + 150]) {
      c.beginPath();
      c.moveTo(BORDER, y);
      c.lineTo(WORLD_W - BORDER, y);
      c.stroke();
    }
    // Cracks
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 2;
    for (let i = 0; i < 60; i++) {
      let x = rand(0, WORLD_W);
      let y = rand(0, WORLD_H);
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += rand(-40, 40);
        y += rand(-40, 40);
        c.lineTo(x, y);
      }
      c.stroke();
    }
    // Oil stains and a couple of manholes
    for (let i = 0; i < 30; i++) {
      c.fillStyle = 'rgba(10,10,14,0.35)';
      c.beginPath();
      c.ellipse(rand(0, WORLD_W), rand(0, WORLD_H), rand(15, 45), rand(10, 30), rand(0, 3), 0, Math.PI * 2);
      c.fill();
    }
    for (const [mx, my] of [
      [700, 640],
      [1500, 960],
    ]) {
      c.fillStyle = '#1d1f22';
      c.beginPath();
      c.arc(mx, my, 28, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#3a3d42';
      c.lineWidth = 3;
      for (let r = 8; r < 28; r += 7) {
        c.beginPath();
        c.arc(mx, my, r, 0, Math.PI * 2);
        c.stroke();
      }
    }
    return g;
  }

  static emptyReport(): RunReport {
    return { wave: 0, kills: 0, killsByKind: {}, killsByWeapon: {}, bosses: 0, elites: 0, bestCombo: 0, grenadeKills: 0, brains: 0 };
  }

  newRun() {
    // Permanent training from the base screen.
    const t = (id: string) => meta.train(id);
    this.stats = baseStats();
    this.stats.maxHp += 10 * t('hp');
    this.stats.damage += 0.05 * t('dmg');
    this.stats.speed += 0.03 * t('speed');
    this.stats.crit += 0.02 * t('crit');
    this.stats.cash += 0.08 * t('greed');
    this.perkCounts.clear();
    const loadout = meta.data.loadout.slice(0, meta.slots());
    this.weapons = loadout.map((id) => this.makeWeapon(WEAPONS.find((w) => w.id === id) ?? WEAPONS[0]));
    for (const w of this.weapons) w.ammo = this.weaponMag(w);
    this.wi = 0;
    this.cash = 75 * t('cash');
    this.armor = 0.03 * t('armor');
    this.wave = 0;
    this.grenadesMax = 2 + t('nades');
    this.grenadeCount = this.grenadesMax;
    this.reviveLeft = t('revive');
    this.report = Game.emptyReport();
    this.corpses = [];
    this.bolts = [];
    this.p = { x: WORLD_W / 2, y: WORLD_H / 2, hp: this.stats.maxHp, angle: -Math.PI / 2, vx: 0, vy: 0 };
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
    this.spin = 0;
    this.resetBarrels();
    this.dctx.clearRect(0, 0, this.decals.width, this.decals.height);
  }

  private resetBarrels() {
    this.barrels = BARREL_SPOTS.map((b) => ({ x: b.x, y: b.y, hp: 30, fuse: 0, dead: false }));
  }

  private makeWeapon(def: WeaponDef): OwnedWeapon {
    return { def, level: 1, ammo: def.mag, reloadT: 0 };
  }

  startWave() {
    this.wave++;
    const boss = this.wave % 10 === 0;
    this.toSpawn = 10 + this.wave * 5;
    if (boss) this.toSpawn = Math.round(this.toSpawn * 0.5);
    this.spawnT = 1.2;
    this.clearT = -1;
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
    if (boss) {
      const g = this.farthestGate();
      const kind: ZombieKind = this.wave % 30 === 0 ? 'juggernaut' : this.wave % 20 === 0 ? 'brood' : 'boss';
      this.spawnZombie(kind, g.x, g.y + (g.y < WORLD_H / 2 ? 60 : -60));
      this.showBanner(`WAVE ${this.wave}`, `${BOSS_NAMES[kind]} IS COMING`, BOSS_COLORS[kind]!);
      this.sfx.play('boss');
      this.addShake(0.6);
    } else {
      const sub = this.wave === 1 ? 'SURVIVE THE NIGHT' : this.wave === 15 ? 'ELITE ZOMBIES INCOMING' : (NEW_KIND_WAVES[this.wave] ?? '');
      this.showBanner(`WAVE ${this.wave}`, sub, '#ffffff');
      this.sfx.play('wave');
    }
  }

  private showBanner(text: string, sub: string, color: string) {
    this.banner = { text, sub, t: 2.4, color };
  }

  private showShout(text: string, color: string) {
    this.shout = { text, t: 1.6, color };
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
    items.push({ id: 'heal', label: '🩹 Medkit', sub: `Heal to full (${Math.ceil(this.p.hp)}/${this.stats.maxHp})`, price: heal, enabled: missing > 0.5 && this.cash >= heal });
    const armorLvl = Math.round((this.armor - 0.03 * meta.train('armor')) / 0.08);
    if (armorLvl < 5) {
      const price = 150 * (armorLvl + 1);
      items.push({ id: 'armor', label: '🛡️ Armor plate', sub: `Take ${Math.round((this.armor + 0.08) * 100)}% less damage`, price, enabled: this.cash >= price });
    }
    if (this.grenadesMax < 6 + meta.train('nades')) {
      const price = 120 * (this.grenadesMax - 1 - meta.train('nades'));
      items.push({ id: 'nade', label: '💣 Grenade belt', sub: `Carry ${this.grenadesMax + 1} grenades per wave`, price, enabled: this.cash >= price });
    }
    for (const def of WEAPONS) {
      const owned = this.weapons.find((w) => w.def.id === def.id);
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
    if (inp.consume('q') || inp.consume('swap') || inp.consume('wheeldown')) this.switchWeapon(1);
    if (inp.consume('wheelup')) this.switchWeapon(-1);
    for (let i = 0; i < 9; i++) if (inp.consume(String(i + 1)) && this.weapons[i]) this.setWeapon(i);
    if (inp.consume('r') || inp.consume('reload')) this.startReload();
    if (inp.consume('g') || inp.consume('e') || inp.consume('nade')) this.throwGrenade();

    for (const k of Object.keys(this.active) as PowerKind[]) if (this.active[k] > 0) this.active[k] -= dt;
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    this.updatePlayer(dt);
    this.updateSpawning(dt);
    this.updateZombies(dt);
    this.updateBullets(dt);
    this.updateGrenades(dt);
    this.updateHazards(dt);
    this.updateOrbitals(dt);
    this.updatePickups(dt);
    this.updateEffects(dt, rawDt);

    this.zombies = this.zombies.filter((z) => !z.dead);
    inp.clearPressed();

    if (this.clearT < 0 && this.toSpawn <= 0 && this.zombies.length === 0 && this.state === 'playing') {
      this.clearT = 1.6;
      this.showBanner('WAVE CLEARED', '', '#5dff7a');
      // Vacuum up any cash left on the floor.
      for (const pk of this.pickups) if (pk.kind === 'cash') pk.pulled = true;
    }
    if (this.clearT >= 0 && this.state === 'playing') {
      this.clearT -= rawDt;
      if (this.clearT < 0) {
        this.gainBrains(1 + Math.floor(this.wave / 3));
        for (const pk of this.pickups) if (pk.kind === 'cash') this.gainCash(pk.value);
        this.pickups = [];
        this.bullets = [];
        this.spits = [];
        this.puddles = [];
        this.grenades = [];
        this.combo = 0;
        this.comboT = 0;
        this.state = 'between';
        this.input.reset();
        this.hooks.onWaveCleared(this.wave);
      }
    }
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
      const kinds: ZombieKind[] = ['walker', 'walker', 'walker', 'runner', 'bloater', 'tank', 'spitter', 'shield', 'leaper', 'screamer', 'necro', 'dog', 'soldier', 'electric'];
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
    const btns = [{ id: 'pause', x: this.w - 30, y: 30, r: 20, label: 'II' }];
    if (inp.touchMode && this.state === 'playing') {
      const cy = clamp(this.h * 0.5, 150, this.h - 120);
      btns.push({ id: 'dash', x: this.w - 54, y: cy + 10, r: 32, label: 'DASH' });
      btns.push({ id: 'nade', x: this.w - 132, y: cy + 22, r: 27, label: 'NADE' });
      btns.push({ id: 'swap', x: this.w - 54, y: cy - 74, r: 25, label: 'SWAP' });
      btns.push({ id: 'reload', x: this.w - 124, y: cy - 58, r: 23, label: 'R' });
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

    // Dash
    this.dashCd -= dt;
    if ((inp.consume(' ') || inp.consume('shift') || inp.consume('dash')) && this.dashCd <= 0) {
      const m = Math.hypot(mv.x, mv.y);
      this.dashDir = m > 0.1 ? { x: mv.x / m, y: mv.y / m } : { x: Math.cos(p.angle), y: Math.sin(p.angle) };
      this.dashT = DASH_TIME;
      this.dashCd = DASH_COOLDOWN;
      this.sfx.play('dash');
    }

    const slow = firing && w.def.moveSlow ? w.def.moveSlow : 1;
    const speed = 230 * this.stats.speed * slow;
    if (this.dashT > 0) {
      this.dashT -= dt;
      p.vx = this.dashDir.x * 230 * this.stats.speed * 3.6;
      p.vy = this.dashDir.y * 230 * this.stats.speed * 3.6;
      this.ghosts.push({ x: p.x, y: p.y, a: p.angle, life: 0.25 });
    } else {
      // Slight acceleration for a weightier feel.
      const k = 1 - Math.exp(-dt * 18);
      p.vx += (mv.x * speed - p.vx) * k;
      p.vy += (mv.y * speed - p.vy) * k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.collideWalls(p, PLAYER_R);
    for (const b of this.barrels) {
      if (b.dead) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < PLAYER_R + 14 && d > 0) {
        p.x = b.x + (dx / d) * (PLAYER_R + 14);
        p.y = b.y + (dy / d) * (PLAYER_R + 14);
      }
    }

    // Weapon
    this.fireCd -= dt;
    if (w.def.spinup) this.spin = clamp(this.spin + (firing && w.reloadT <= 0 ? dt / w.def.spinup : -dt * 2), 0, 1);
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) w.ammo = this.weaponMag(w);
    } else if (firing && this.fireCd <= 0) {
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

  private fire(w: OwnedWeapon) {
    const p = this.p;
    const rate = this.weaponRate(w) * (w.def.spinup ? 0.25 + 0.75 * this.spin : 1);
    this.fireCd = 1 / rate;
    if (this.active.ammo <= 0) w.ammo--;
    const dmg = this.weaponDamage(w);
    const kind = w.def.kind;
    const n = kind === 'bullet' ? w.def.pellets + this.stats.extraShots : 1 + (kind === 'rocket' || kind === 'grenade' || kind === 'tesla' ? Math.floor(this.stats.extraShots / 2) : 0);
    const mx = p.x + Math.cos(p.angle) * (w.def.length + 4);
    const my = p.y + Math.sin(p.angle) * (w.def.length + 4);
    const rage = this.active.rage > 0;
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
        this.grenades.push({ x: mx, y: my, vx: Math.cos(a) * w.def.speed, vy: Math.sin(a) * w.def.speed, z: 8, vz: 160, fuse: w.def.life, dmg, radius: 110, impact: true });
      }
      this.addLight(mx, my, 160, 0.07, '#b0ff7a');
      this.addShake(w.def.shake * 0.5);
      this.sfx.play('launcher');
      if (w.ammo <= 0 && this.active.ammo <= 0) this.startReload();
      return;
    }
    for (let i = 0; i < n; i++) {
      let a = p.angle + rand(-w.def.spread / 2, w.def.spread / 2);
      if (w.def.pellets === 1 && n > 1) a += (i - (n - 1) / 2) * 0.1;
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
        ricochet: kind === 'bullet' ? this.stats.ricochet : 0,
        hits: [],
        color: rage ? '#ff5a4a' : w.def.color,
        width: w.def.id === 'shotgun' ? 2.5 : w.def.id === 'minigun' ? 2.5 : w.def.id === 'sniper' ? 4 : 3,
        canExplode: kind === 'bullet',
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

  private farthestGate() {
    let best = GATES[0];
    let bd = -1;
    for (const g of GATES) {
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
    const cap = Math.min(30 + this.wave * 4, 100);
    if (this.spawnT > 0 || this.zombies.length >= cap) return;
    this.spawnT = Math.max(0.22, 0.85 - this.wave * 0.05);
    const far = GATES.filter((g) => Math.hypot(g.x - this.p.x, g.y - this.p.y) > 520);
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
      ['runner', w >= 2 ? Math.min(0.36, 0.12 + (w - 2) * 0.04) : 0],
    ];
    const eliteChance = w >= 15 ? Math.min(0.15, 0.04 + (w - 15) * 0.006) : 0;
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
      // Dogs always arrive as a pack.
      const pack = kind === 'dog' ? 4 + Math.floor(Math.random() * 3) : 1;
      for (let k = 0; k < pack; k++) this.spawnZombie(kind, gate.x + (inward.x / d) * 30 + rand(-50, 50), gate.y + (inward.y / d) * 30 + rand(-50, 50), { elite: k === 0 ? elite : undefined });
      this.toSpawn = Math.max(0, this.toSpawn - pack);
    }
  }

  private countKind(kind: ZombieKind) {
    let n = 0;
    for (const z of this.zombies) if (z.def.kind === kind && !z.dead) n++;
    return n;
  }

  private spawnZombie(kind: ZombieKind, x: number, y: number, opts: { elite?: EliteKind; mini?: boolean } = {}): Zombie {
    const def = ZOMBIES[kind];
    const wv = Math.max(1, this.wave);
    const hpScale = 1 + 0.16 * (wv - 1) + 0.006 * (wv - 1) ** 2;
    const spScale = Math.min(1.35, 1 + 0.02 * (wv - 1));
    const { elite, mini } = opts;
    let hp = def.hp * hpScale * (kind === 'boss' || kind === 'brood' ? 1 + wv / 20 : 1);
    if (elite) hp *= elite === 'armored' ? 3 : 1.6;
    if (mini) hp *= 0.4;
    const r = def.radius * (elite ? 1.15 : 1) * (mini ? 0.72 : 1);
    const z: Zombie = {
      id: this.nextId++,
      def,
      x: clamp(x, BORDER + r, WORLD_W - BORDER - r),
      y: clamp(y, BORDER + r, WORLD_H - BORDER - r),
      kx: 0,
      ky: 0,
      hp,
      maxHp: hp,
      speed: def.speed * spScale * rand(0.9, 1.1) * (elite === 'fast' ? 1.55 : 1) * (mini ? 1.15 : 1),
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
      elite,
      mini,
    };
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
    const px = clamp(Math.floor(this.p.x / CELL), 0, FLOW_W - 1);
    const py = clamp(Math.floor(this.p.y / CELL), 0, FLOW_H - 1);
    const queue = FLOW_QUEUE;
    let head = 0;
    let tail = 0;
    f[py * FLOW_W + px] = 0;
    queue[tail++] = py * FLOW_W + px;
    while (head < tail) {
      const i = queue[head++];
      const cx = i % FLOW_W;
      const cy = (i / FLOW_W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + NEIGHBORS[k][0];
        const ny = cy + NEIGHBORS[k][1];
        if (nx < 0 || ny < 0 || nx >= FLOW_W || ny >= FLOW_H) continue;
        const j = ny * FLOW_W + nx;
        if (f[j] >= 0 || BLOCKED[j]) continue;
        f[j] = f[i] + 1;
        queue[tail++] = j;
      }
    }
  }

  /** Direction a zombie at (x, y) should walk to reach the player around cover. */
  private flowDir(x: number, y: number): { x: number; y: number } | null {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= FLOW_W || cy >= FLOW_H) return null;
    const here = this.flow[cy * FLOW_W + cx];
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

  private updateZombies(dt: number) {
    const p = this.p;
    const zs = this.zombies;
    const frozen = this.active.freeze > 0;
    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.2;
      this.buildFlow();
    }
    for (const z of zs) {
      if (z.dead) continue;
      if (z.flash > 0) z.flash -= dt;
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
      const dx = p.x - z.x;
      const dy = p.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = z.speed * (z.slow > 0 ? 0.5 : 1);
      const dir = d > 90 ? this.flowDir(z.x, z.y) : null;
      let vx = (dir ? dir.x : dx / d) * sp;
      let vy = (dir ? dir.y : dy / d) * sp;

      if (z.def.kind === 'spitter') {
        z.spitCd -= dt;
        if (d < 330) {
          // Keep a bit of distance and lob acid.
          const back = d < 220 ? -0.6 : 0;
          vx = (dx / d) * sp * back;
          vy = (dy / d) * sp * back;
          if (z.spitCd <= 0) {
            z.spitCd = rand(1.8, 2.6);
            const lead = d / 300;
            const ax = p.x + p.vx * lead * 0.5 - z.x;
            const ay = p.y + p.vy * lead * 0.5 - z.y;
            const ad = Math.hypot(ax, ay) || 1;
            this.spits.push({ x: z.x, y: z.y, vx: (ax / ad) * 300, vy: (ay / ad) * 300, life: Math.min(1.4, ad / 300) });
            this.sfx.play('spit');
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

      if (kind === 'screamer' || kind === 'necro') {
        // Hang back behind the horde.
        z.abilityCd -= dt;
        const near = kind === 'necro' ? 300 : 250;
        if (d < near + 100) {
          const back = d < near ? -0.55 : 0;
          vx = (dx / d) * sp * back;
          vy = (dy / d) * sp * back;
        }
        if (z.abilityCd <= 0 && d < 650) {
          if (kind === 'screamer') this.scream(z);
          else this.raiseDead(z);
        }
      }

      if (z.leap) {
        const L = z.leap;
        L.t -= dt;
        if (L.state === 'walk' && L.t <= 0) {
          if (d < 330 && d > 70) {
            L.state = 'crouch';
            L.t = 0.55;
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
            L.t = 0.42;
            this.sfx.play('pounce');
          }
        } else if (L.state === 'leap') {
          vx = L.dx * 720;
          vy = L.dy * 720;
          if (Math.random() < 0.6) this.spawnParticle(z.x, z.y, rand(-30, 30), rand(-30, 30), 0.3, 6, 'rgba(140,110,60,0.3)', 3, false, false, 10);
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
          if (z.zapT <= 0) this.zap(z, d);
        } else if (z.abilityCd <= 0 && d < 250) {
          z.zapT = 0.6;
          z.abilityCd = rand(2.6, 3.4);
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
          this.showShout('SHOOT THE EGGS!', '#ffcf5a');
          this.sfx.play('splat');
          this.rings.push({ x: z.x, y: z.y, r: 0, max: 120, life: 0.45, color: 'rgba(255,220,120,' });
        }
        if (B.spit <= 0 && d < 560) {
          B.spit = rand(2.2, 3);
          const base = Math.atan2(dy, dx);
          for (let i = -2; i <= 2; i++) {
            const a = base + i * 0.22;
            this.spits.push({ x: z.x + Math.cos(a) * z.r, y: z.y + Math.sin(a) * z.r, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, life: 1.5 });
          }
          this.sfx.play('spit');
        }
      }

      if (z.boss) {
        const b = z.boss;
        b.t -= dt;
        b.summon -= dt;
        if (kind === 'boss' && b.summon <= 0) {
          b.summon = 7;
          for (let i = 0; i < 3 + Math.floor(this.wave / 10); i++) this.spawnZombie(Math.random() < 0.3 ? 'bloater' : 'runner', z.x + rand(-60, 60), z.y + rand(-60, 60));
          this.rings.push({ x: z.x, y: z.y, r: 0, max: 130, life: 0.5, color: 'rgba(190,90,255,' });
        }
        if (z.jug && z.jug.windup > 0) b.t = Math.max(b.t, 0.5);
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
            this.sfx.play('dash');
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

      let face = Math.atan2(z.boss?.state === 'charge' ? z.boss.dy : dy, z.boss?.state === 'charge' ? z.boss.dx : dx);
      if (z.leap && z.leap.state !== 'walk') face = Math.atan2(z.leap.dy, z.leap.dx);
      if (kind === 'shield') {
        // Brutes turn slowly behind their shield, so you can flank them.
        let da = face - z.face;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        z.face += clamp(da, -1.25 * dt, 1.25 * dt);
      } else z.face = face;
      z.kx *= Math.exp(-dt * 9);
      z.ky *= Math.exp(-dt * 9);
      const ox = z.x;
      const oy = z.y;
      z.x += (vx + z.kx) * dt;
      z.y += (vy + z.ky) * dt;
      if (this.collideWalls(z, z.r)) {
        if (z.leap?.state === 'leap') {
          z.leap.state = 'walk';
          z.leap.t = rand(1.8, 2.8);
        }
        if (z.boss && z.boss.state === 'charge') {
          z.boss.state = 'walk';
          z.boss.t = rand(3, 4.5);
          this.addShake(0.7);
          this.sfx.play('explode', 0.6);
          this.rings.push({ x: z.x, y: z.y, r: 0, max: 90, life: 0.4, color: 'rgba(200,180,160,' });
        }
      }
      z.phase += Math.hypot(z.x - ox, z.y - oy) * 0.08;
      if (z.slow > 0) z.slow -= dt;
      if (z.attackCd > 0) z.attackCd -= dt;
      if (z.bladeCd > 0) z.bladeCd -= dt;

      if (d < z.r + PLAYER_R + 3 && z.attackCd <= 0) {
        if (z.def.kind === 'bloater') {
          this.killZombie(z, z.face);
          continue;
        }
        if (kind === 'egg') continue;
        z.attackCd = 0.8;
        this.hurtPlayer(z.dmg, z);
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
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        if (dx > min || dx < -min || dy > min || dy < -min) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const ma = a.def.mass;
        const mb = b.def.mass;
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
    this.sfx.play('splat');
  }

  /** Electric zombie: lightning to the player if still in range, arcing on to nearby zombies and speeding them up. */
  private zap(z: Zombie, d: number) {
    this.sfx.play('zap');
    this.addLight(z.x, z.y, 200, 0.2, '#a0f0ff');
    if (d < 300) {
      this.bolts.push({ x1: z.x, y1: z.y, x2: this.p.x, y2: this.p.y, life: 0.18, color: '#a0f0ff' });
      this.hurtPlayer(12 * (1 + 0.04 * this.wave), z);
    }
    let n = 0;
    for (const o of this.zombies) {
      if (n >= 3 || o === z || o.dead || isBoss(o) || o.def.kind === 'egg') continue;
      if (Math.hypot(o.x - z.x, o.y - z.y) > 220) continue;
      this.bolts.push({ x1: z.x, y1: z.y, x2: o.x, y2: o.y, life: 0.18, color: '#a0f0ff' });
      o.buff = Math.max(o.buff, 3);
      n++;
    }
  }

  /** Juggernaut: a shockwave around it after a telegraphed wind-up. */
  private groundSlam(z: Zombie) {
    const R = 240;
    this.rings.push({ x: z.x, y: z.y, r: 20, max: R, life: 0.5, color: 'rgba(255,140,80,' });
    this.rings.push({ x: z.x, y: z.y, r: 10, max: R * 0.7, life: 0.4, color: 'rgba(255,220,180,' });
    for (let i = 0; i < 30; i++) {
      const a = rand(0, Math.PI * 2);
      this.spawnParticle(z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r, Math.cos(a) * rand(200, 500), Math.sin(a) * rand(200, 500), rand(0.4, 0.8), rand(6, 12), 'rgba(120,100,90,0.45)', 3, false, false, 16);
    }
    this.addShake(0.8);
    this.zoomKick = Math.max(this.zoomKick, 0.06);
    this.sfx.play('slam');
    const d = Math.hypot(this.p.x - z.x, this.p.y - z.y);
    if (d < R) this.hurtPlayer(38 * (1 + 0.03 * this.wave), z);
  }

  /** Tesla gun: an arc to the nearest zombie in front, chaining onward. */
  private teslaArc(x: number, y: number, angle: number, dmg: number) {
    let best: Zombie | null = null;
    let bd = 360;
    for (const z of this.zombies) {
      if (z.dead) continue;
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
  private scream(z: Zombie) {
    z.abilityCd = rand(4.5, 6);
    const R = 300;
    this.rings.push({ x: z.x, y: z.y, r: 10, max: R, life: 0.6, color: 'rgba(255,90,120,' });
    this.rings.push({ x: z.x, y: z.y, r: 10, max: R * 0.6, life: 0.45, color: 'rgba(255,200,210,' });
    this.addLight(z.x, z.y, 220, 0.4, '#ff5a78');
    for (const o of this.zombies) {
      if (o === z || o.dead || isBoss(o) || o.def.kind === 'egg') continue;
      if (Math.hypot(o.x - z.x, o.y - z.y) < R) o.buff = 5;
    }
    this.sfx.play('scream');
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
    this.rings.push({ x: z.x, y: z.y, r: 0, max: 90, life: 0.45, color: 'rgba(93,255,176,' });
    this.addLight(z.x, z.y, 200, 0.4, '#5dffb0');
    this.sfx.play('raise');
  }

  private hurtPlayer(amount: number, from: { x: number; y: number } | null) {
    if (this.dashT > 0 || this.state !== 'playing' || amount <= 0) return;
    const dmg = amount * (1 - this.armor);
    this.p.hp -= dmg;
    this.hurtFlash = 0.25;
    this.addShake(0.45);
    this.sfx.play('hurt');
    this.addText(this.p.x, this.p.y - 24, `-${Math.round(dmg)}`, '#ff5a4e', 16);
    for (let i = 0; i < 6; i++) this.spawnBlood(this.p.x, this.p.y, rand(0, Math.PI * 2), '#b0201a');
    try {
      navigator.vibrate?.(35);
    } catch {
      /* not supported */
    }
    if (from) {
      const a = Math.atan2(this.p.y - from.y, this.p.x - from.x);
      this.p.vx += Math.cos(a) * 160;
      this.p.vy += Math.sin(a) * 160;
    }
    if (this.stats.nova > 0 && this.novaCd <= 0) {
      this.novaCd = 3;
      const radius = 130 + 40 * this.stats.nova;
      this.rings.push({ x: this.p.x, y: this.p.y, r: 0, max: radius, life: 0.4, color: 'rgba(120,200,255,' });
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
    if (this.reviveLeft > 0) {
      // Second Wind: get back up and blast everything nearby away.
      this.reviveLeft--;
      this.p.hp = this.stats.maxHp * 0.5;
      this.slowT = 1.2;
      this.flash = { t: 0.6, color: '#ffffff', max: 0.6 };
      this.showBanner('SECOND WIND', 'GET BACK UP', '#5dff7a');
      this.explode(this.p.x, this.p.y, 300 * this.stats.damage, 280, 0);
      this.sfx.play('power');
      return;
    }
    this.p.hp = 0;
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
      if (b.kind === 'rocket') {
        this.spawnParticle(b.x, b.y, rand(-30, 30), rand(-30, 30), 0.7, 6, 'rgba(170,170,170,0.3)', 2, false, false, 18);
        if (Math.random() < 0.7) this.spawnParticle(b.x, b.y, -b.vx * 0.2, -b.vy * 0.2, 0.12, 6, '#ffb347', 6, false, true);
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) {
        if (b.kind === 'rocket') this.explode(b.x, b.y, b.dmg, 115, 0);
        continue;
      }
      if (this.pointInWall(b.x, b.y)) {
        if (b.kind === 'rocket') this.explode(b.x - b.vx * dt, b.y - b.vy * dt, b.dmg, 115, 0);
        else if (b.kind === 'bullet') for (let i = 0; i < 3; i++) this.spawnParticle(b.x - b.vx * dt, b.y - b.vy * dt, rand(-120, 120), rand(-120, 120), 0.15, 2, '#ffd27a', 6, false, true);
        continue;
      }
      // Barrels
      let alive = true;
      for (const br of this.barrels) {
        if (br.dead || br.fuse > 0) continue;
        if (Math.hypot(br.x - b.x, br.y - b.y) < 16) {
          if (b.kind === 'rocket') {
            this.explode(b.x, b.y, b.dmg, 115, 0);
            alive = false;
            break;
          }
          br.hp -= b.kind === 'flame' ? 3 : b.kind === 'frost' ? 0 : b.dmg;
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
        if (z.dead || b.hits.includes(z.id)) continue;
        const dx = z.x - b.x;
        const dy = z.y - b.y;
        const rr = z.r + (b.kind === 'flame' || b.kind === 'frost' ? 10 : 4);
        if (dx * dx + dy * dy > rr * rr) continue;
        if (b.kind === 'rocket') {
          this.explode(b.x, b.y, b.dmg, 115, 0);
          alive = false;
          break;
        }
        b.hits.push(z.id);
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
          this.chill(z);
          this.damageZombie(z, dmg, Math.atan2(b.vy, b.vx), false, 10, true);
          continue;
        }
        if (b.kind === 'flame') {
          z.burn = 2.5;
          this.damageZombie(z, dmg, Math.atan2(b.vy, b.vx), false, 20, true);
          continue;
        }
        this.damageZombie(z, dmg, Math.atan2(b.vy, b.vx), crit, 140);
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
      if (g.impact && !boom) for (const z of this.zombies) if (!z.dead && Math.hypot(z.x - g.x, z.y - g.y) < z.r + 6) boom = true;
      if (boom) {
        this.nadeBlast = true;
        this.explode(g.x, g.y, g.dmg ?? 170 * this.stats.damage, g.radius ?? 135, g.impact ? 8 : 18);
        this.nadeBlast = false;
        continue;
      }
      keep.push(g);
    }
    this.grenades = keep;
  }

  private updateHazards(dt: number) {
    const p = this.p;
    // Acid spit
    const spits: Spit[] = [];
    for (const s of this.spits) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (Math.random() < 0.5) this.spawnParticle(s.x, s.y, rand(-20, 20), rand(-20, 20), 0.3, 4, '#b04aff', 4, false, true);
      if (Math.hypot(s.x - p.x, s.y - p.y) < PLAYER_R + 8) {
        this.hurtPlayer(10 * (1 + 0.04 * this.wave), s);
        this.puddles.push({ x: s.x, y: s.y, r: 34, life: 2.5, max: 2.5, kind: 'acid' });
        continue;
      }
      if (s.life <= 0 || this.pointInWall(s.x, s.y)) {
        this.puddles.push({ x: s.x, y: s.y, r: 40, life: 3.5, max: 3.5, kind: 'acid' });
        this.sfx.play('splat', 0.4);
        continue;
      }
      spits.push(s);
    }
    this.spits = spits;
    // Puddles hurt over time
    let dps = 0;
    this.puddles = this.puddles.filter((pd) => {
      pd.life -= dt;
      if (Math.hypot(pd.x - p.x, pd.y - p.y) < pd.r + PLAYER_R * 0.5) dps = Math.max(dps, pd.kind === 'acid' ? 14 : 12);
      return pd.life > 0;
    });
    if (dps > 0 && this.dashT <= 0) {
      p.hp -= dps * dt * (1 - this.armor);
      this.hurtFlash = Math.max(this.hurtFlash, 0.08);
      if (p.hp <= 0) this.gameOver();
    }
    // Barrels with a lit fuse go off (this is how chain reactions ripple).
    for (const b of this.barrels) {
      if (b.dead || b.fuse <= 0) continue;
      b.fuse -= dt;
      if (b.fuse <= 0) {
        b.dead = true;
        this.explode(b.x, b.y, 240 * this.stats.damage, 150, 30, true);
      }
    }
  }

  private nearestZombie(x: number, y: number, range: number, exclude: number[] = []): Zombie | null {
    let best: Zombie | null = null;
    let bd = range;
    for (const z of this.zombies) {
      if (z.dead || exclude.includes(z.id)) continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  private damageZombie(z: Zombie, dmg: number, angle: number, crit: boolean, knock: number, quiet = false) {
    if (z.dead) return;
    // Mother Brood is shielded by her eggs.
    if (z.def.kind === 'brood' && this.countKind('egg') > 0) dmg *= 0.25;
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
      if (crit || dmg >= 20) this.addText(z.x + rand(-8, 8), z.y - z.r - 4, String(Math.round(dmg)), crit ? '#ffd23f' : '#ffffff', crit ? 18 : 12);
      this.sfx.play('hit');
    }
    if (z.hp <= 0) this.killZombie(z, angle);
  }

  private killZombie(z: Zombie, angle: number) {
    if (z.dead) return;
    z.dead = true;
    this.kills++;
    const kind = z.def.kind;
    const boss = isBoss(z);
    const rep = this.report;
    rep.killsByKind[kind] = (rep.killsByKind[kind] ?? 0) + 1;
    const wid = this.weapons[this.wi].def.id;
    rep.killsByWeapon[wid] = (rep.killsByWeapon[wid] ?? 0) + 1;
    if (this.nadeBlast) rep.grenadeKills++;
    if (boss) {
      rep.bosses++;
      this.gainBrains(25 + this.wave, z.x, z.y - z.r - 20);
    } else if (z.elite) {
      rep.elites++;
      this.gainBrains(3, z.x, z.y - z.r - 10);
    } else if (this.kills % 10 === 0) this.gainBrains(1);
    if (!boss && kind !== 'egg' && !z.mini) {
      this.corpses.push({ x: z.x, y: z.y });
      if (this.corpses.length > 40) this.corpses.shift();
    }
    if (z.elite === 'splitting' && kind !== 'egg')
      for (let i = 0; i < 2; i++) this.spawnZombie(kind, z.x + rand(-z.r, z.r), z.y + rand(-z.r, z.r), { mini: true }).flash = 0.2;
    if (z.frozenT > 0) {
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2);
        this.spawnParticle(z.x, z.y, Math.cos(a) * rand(100, 320), Math.sin(a) * rand(100, 320), rand(0.3, 0.6), rand(3, 7), i % 2 ? '#dff6ff' : '#7fd8ff', 4, false, true);
      }
      this.sfx.play('shatter');
    }
    if (z.elite === 'explosive') this.explode(z.x, z.y, 70 * this.stats.damage, 110, 22);
    const big = boss || kind === 'tank' || kind === 'shield';
    const n = boss ? 60 : big ? 22 : 12;
    for (let i = 0; i < n; i++) this.spawnBlood(z.x, z.y, angle + rand(-1.2, 1.2), i % 3 ? '#8a1414' : z.def.dark, rand(1, boss ? 3 : 1.8));
    // Gibs
    for (let i = 0; i < (boss ? 16 : big ? 8 : 4); i++) {
      const a = angle + rand(-1.4, 1.4);
      const s = rand(120, 380);
      this.spawnParticle(z.x, z.y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.6), rand(4, big ? 11 : 8), i % 2 ? z.def.body : z.def.dark, 5, true, false);
    }
    // A big splat on the floor.
    this.dctx.fillStyle = kind === 'bloater' ? 'rgba(80,110,10,0.5)' : 'rgba(90,10,10,0.55)';
    for (let i = 0; i < (boss ? 14 : 5); i++) {
      this.dctx.beginPath();
      this.dctx.arc((z.x + rand(-z.r, z.r)) / 2, (z.y + rand(-z.r, z.r)) / 2, rand(2, z.r / 2.5), 0, Math.PI * 2);
      this.dctx.fill();
    }

    // Combo
    this.combo++;
    this.comboT = COMBO_TIME;
    this.comboPop = 0.15;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    for (const [at, text] of COMBO_TIERS) {
      if (this.combo === at) {
        this.showShout(text, at >= 100 ? '#ff3bd0' : at >= 50 ? '#ff5a4a' : '#ffd23f');
        this.sfx.play('combo');
      }
    }

    const mult = (1 + Math.min(this.combo, 100) * 0.01) * (this.active.cash > 0 ? 2 : 1);
    const value = z.def.cash * this.stats.cash * (1 + 0.06 * (this.wave - 1)) * mult;
    const coins = boss ? 20 : kind === 'tank' || kind === 'shield' || z.elite ? 4 : 1;
    for (let i = 0; i < coins; i++) {
      const a = rand(0, Math.PI * 2);
      const s = coins > 1 ? rand(60, 220) : rand(20, 60);
      this.pickups.push({ x: z.x, y: z.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind: 'cash', value: value / coins, pulled: false });
    }
    const healthChance = boss ? 1 : kind === 'tank' || kind === 'shield' ? 0.25 : z.elite ? 0.3 : 0.025;
    if (Math.random() < healthChance) this.pickups.push({ x: z.x, y: z.y, vx: rand(-40, 40), vy: rand(-40, 40), kind: 'health', value: 25, pulled: false });
    if (this.state === 'playing' && (boss || (Math.random() < 0.022 && this.powers.length < 2))) {
      const kinds: PowerKind[] = boss ? ['rage'] : ['nuke', 'rage', 'freeze', 'ammo', 'cash'];
      this.powers.push({ x: z.x, y: z.y, kind: kinds[Math.floor(Math.random() * kinds.length)], life: 14 });
    }
    if (this.stats.lifesteal > 0) this.p.hp = Math.min(this.stats.maxHp, this.p.hp + this.stats.lifesteal);
    this.sfx.play('death', boss ? 2 : 1);
    this.addShake(boss ? 1 : big ? 0.3 : 0.06);
    if (big) this.hitstop = boss ? 0.12 : 0.05;
    if (kind === 'bloater') this.explode(z.x, z.y, 60 * this.stats.damage, 95, 18, false, 'toxic');
    if (boss) {
      this.slowT = 1.4;
      this.explode(z.x, z.y, 0, 160, 0);
      this.showBanner('BOSS DOWN', `${BOSS_NAMES[kind]} SLAIN`, BOSS_COLORS[kind] ?? '#c065ff');
      this.flash = { t: 0.4, color: '#ffffff', max: 0.4 };
      // Her unhatched eggs die with her.
      if (kind === 'brood') for (const e of this.zombies) if (e.def.kind === 'egg') this.killZombie(e, rand(0, Math.PI * 2));
    }
  }

  private explode(x: number, y: number, dmg: number, radius: number, playerDmg: number, barrel = false, style: 'fire' | 'toxic' = 'fire') {
    const toxic = style === 'toxic';
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
    if (toxic) this.puddles.push({ x, y, r: radius * 0.6, life: 4, max: 4, kind: 'toxic' });
    this.addShake(barrel ? 0.6 : Math.min(0.55, radius / 260));
    this.zoomKick = Math.max(this.zoomKick, barrel ? 0.06 : 0.03);
    if (radius >= 130) this.hitstop = Math.max(this.hitstop, 0.04);
    this.sfx.play(toxic ? 'splat' : 'explode', toxic ? 1 : Math.min(1, radius / 130));
    if (playerDmg > 0) {
      const d = Math.hypot(this.p.x - x, this.p.y - y);
      if (d < radius) this.hurtPlayer(playerDmg * (1 - d / radius / 2), { x, y });
    }
    for (const b of this.barrels) {
      if (b.dead || b.fuse > 0) continue;
      if (Math.hypot(b.x - x, b.y - y) < radius + 10) b.fuse = rand(0.08, 0.2);
    }
    if (dmg <= 0) return;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < radius + z.r) {
        if (!toxic) z.burn = Math.max(z.burn, 1.2);
        this.damageZombie(z, dmg * (1 - (d / (radius + z.r)) * 0.4), Math.atan2(z.y - y, z.x - x), false, 420);
      }
    }
  }

  private activatePower(kind: PowerKind) {
    const def = POWERUPS[kind];
    this.showBanner(def.name, '', def.color);
    this.sfx.play('power');
    this.flash = { t: 0.25, color: def.color, max: 0.25 };
    if (kind === 'nuke') {
      this.sfx.play('nuke');
      this.flash = { t: 0.9, color: '#ffffff', max: 0.9 };
      this.addShake(1);
      this.zoomKick = 0.1;
      for (const z of this.zombies) {
        if (z.dead) continue;
        if (isBoss(z)) this.damageZombie(z, z.maxHp * 0.2, 0, false, 0);
        else this.killZombie(z, Math.atan2(z.y - this.p.y, z.x - this.p.x));
      }
      return;
    }
    this.active[kind] = def.duration;
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
    const p = this.p;
    const range = 110 * this.stats.magnet;
    const keep: Pickup[] = [];
    for (const pk of this.pickups) {
      const dx = p.x - pk.x;
      const dy = p.y - pk.y;
      const d = Math.hypot(dx, dy) || 1;
      if (pk.pulled || d < range) {
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
        if (pk.kind === 'cash') {
          this.gainCash(pk.value);
          this.sfx.play('coin');
        } else {
          this.p.hp = Math.min(this.stats.maxHp, this.p.hp + pk.value);
          this.addText(p.x, p.y - 26, `+${pk.value}`, '#5dff7a', 15);
          this.sfx.play('buy');
        }
        continue;
      }
      keep.push(pk);
    }
    this.pickups = keep;
    this.powers = this.powers.filter((pw) => {
      pw.life -= dt;
      if (Math.hypot(pw.x - p.x, pw.y - p.y) < PLAYER_R + 18) {
        this.activatePower(pw.kind);
        return false;
      }
      return pw.life > 0;
    });
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
    this.trauma = Math.max(0, this.trauma - rawDt * 1.8);
    this.zoomKick = Math.max(0, this.zoomKick - rawDt * 0.4);
    if (this.banner.t > 0) this.banner.t -= rawDt;
    if (this.shout.t > 0) this.shout.t -= rawDt;
    if (this.cashPulse > 0) this.cashPulse -= rawDt;
    if (this.brainsPulse > 0) this.brainsPulse -= rawDt;
    if (this.comboPop > 0) this.comboPop -= rawDt;
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
    for (const w of WALLS) {
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
    for (const w of WALLS) if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) return true;
    return false;
  }

  private toScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.zoom + this.w / 2, y: (y - this.cam.y) * this.zoom + this.h / 2 };
  }

  // ---------------------------------------------------------------- render

  render(dt: number) {
    const ctx = this.ctx;
    const p = this.p;
    const playing = this.state !== 'menu';
    if (playing) {
      // Camera leads a little toward where you aim.
      const lead = this.state === 'playing' ? 60 : 0;
      const tx = p.x + Math.cos(p.angle) * lead;
      const ty = p.y + Math.sin(p.angle) * lead;
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
    this.drawPuddles();
    this.drawPickups();
    this.drawBarrels();
    for (const z of this.zombies) this.drawZombieShadow(z);
    for (const z of this.zombies) this.drawZombie(z);
    if (this.state !== 'over' && playing) this.drawPlayer();
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
    const tint = this.active.freeze > 0 ? '6,14,26' : this.active.rage > 0 ? '22,4,4' : '3,5,10';
    l.fillStyle = `rgba(${tint},${DARKNESS})`;
    l.fillRect(0, 0, this.light.width, this.light.height);
    l.globalCompositeOperation = 'destination-out';
    world(l, 0.5);
    const hole = (x: number, y: number, r: number, a: number) => {
      l.globalAlpha = clamp(a, 0, 1);
      l.drawImage(glowSprite('#000000'), x - r, y - r, r * 2, r * 2);
      l.globalAlpha = 1;
    };
    for (const lamp of LAMPS) {
      let a = 0.9;
      if (lamp.flicker) {
        const f = Math.sin(this.clock * 23 + lamp.x) + Math.sin(this.clock * 7.3 + lamp.y);
        a = f > 1.6 ? 0.15 : 0.85;
      }
      hole(lamp.x, lamp.y, 260, a);
    }
    for (const lt of this.lights) hole(lt.x, lt.y, lt.r * (0.6 + 0.4 * (lt.life / lt.max)), Math.min(1, (lt.life / lt.max) * 1.4));
    for (const pw of this.powers) hole(pw.x, pw.y, 90, 0.7);
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
      hole(p.x, p.y, 150, 0.85);
      cone(p.x, p.y, p.angle, FLASHLIGHT * 1.1, 0.75, 0.4);
      cone(p.x, p.y, p.angle, FLASHLIGHT, 0.42, 0.95);
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
    for (const lamp of LAMPS) glowDot(lamp.x, lamp.y, 120, '#ffcf7a', 0.12);
    ctx.globalAlpha = 1;

    // Zombie eyes glow in the dark
    for (const z of this.zombies) {
      const r = z.r;
      const c = Math.cos(z.face);
      const s = Math.sin(z.face);
      const ex = z.x + c * r * 0.6;
      const ey = z.y + s * r * 0.6;
      const ox = -s * r * 0.25;
      const oy = c * r * 0.25;
      if (this.crawlerAlpha(z) < 0.6) continue;
      ctx.fillStyle = this.active.freeze > 0 ? '#9fe8ff' : z.def.eye;
      const es = Math.max(2, r * 0.13);
      ctx.fillRect(ex + ox - es / 2, ey + oy - es / 2, es, es);
      ctx.fillRect(ex - ox - es / 2, ey - oy - es / 2, es, es);
      glowDot(ex, ey, r * 0.9, z.def.eye, 0.25);
      if (z.def.kind === 'bloater') glowDot(z.x, z.y, r * 1.8, '#9aff3a', 0.18 + 0.08 * Math.sin(this.clock * 6 + z.id));
      if (z.burn > 0) glowDot(z.x, z.y, r * 2, '#ff6a1f', 0.35);
      if (z.elite) glowDot(z.x, z.y, r * 2.2, ELITES[z.elite].color, 0.22);
      if (z.buff > 0) glowDot(z.x, z.y, r * 1.8, '#ff3050', 0.3 + 0.1 * Math.sin(this.clock * 14 + z.id));
      if (z.def.kind === 'necro') glowDot(z.x, z.y, r * 2.4, '#5dffb0', 0.2);
      if (z.def.kind === 'electric') glowDot(z.x, z.y, r * (z.zapT > 0 ? 3.2 : 2), '#8ad8ff', z.zapT > 0 ? 0.5 : 0.22);
      if (z.def.kind === 'juggernaut') glowDot(z.x - Math.cos(z.face) * r * 0.62, z.y - Math.sin(z.face) * r * 0.62, r * 0.9, '#ffa040', 0.5);
      if (z.frozenT > 0) glowDot(z.x, z.y, r * 2, '#9fe8ff', 0.25);
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
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(-9, -3, 16, 6);
        ctx.restore();
        glowDot(b.x - Math.cos(a) * 10, b.y - Math.sin(a) * 10, 22, '#ffb347', 0.8);
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

    // Spit
    for (const s of this.spits) glowDot(s.x, s.y, 14, '#c060ff', 0.9);

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
    if (this.state === 'playing') {
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
      const a = Math.atan2(this.p.y - z.y, this.p.x - z.x);
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
      ctx.lineTo(z.x + z.leap.dx * 300, z.y + z.leap.dy * 300);
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
    for (const g of GATES) {
      const horiz = g.y < BORDER * 2 || g.y > WORLD_H - BORDER * 2;
      ctx.fillStyle = '#120d0b';
      if (horiz) ctx.fillRect(g.x - 50, g.y - 22, 100, 24);
      else ctx.fillRect(g.x - 22, g.y - 50, 24, 100);
    }
  }

  private drawPuddles() {
    const ctx = this.ctx;
    for (const pd of this.puddles) {
      const a = Math.min(1, pd.life / 0.6) * 0.55;
      ctx.fillStyle = pd.kind === 'acid' ? `rgba(150,60,220,${a})` : `rgba(120,190,30,${a})`;
      ctx.beginPath();
      ctx.arc(pd.x, pd.y, pd.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pd.kind === 'acid' ? `rgba(220,150,255,${a})` : `rgba(200,255,90,${a})`;
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
    for (const w of WALLS) {
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
    for (const g of GATES) {
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
    for (const l of LAMPS) {
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
      ctx.fillStyle = '#3d5a2a';
      ctx.beginPath();
      ctx.arc(g.x, g.y - g.z * 0.6, 6, 0, Math.PI * 2);
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
    if (z.def.kind !== 'crawler' || this.state === 'menu') return 1;
    return clamp((260 - Math.hypot(z.x - this.p.x, z.y - this.p.y)) / 120, 0.1, 1);
  }

  private drawZombieShadow(z: Zombie) {
    const ctx = this.ctx;
    if (this.crawlerAlpha(z) < 1) return;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(z.x + 3, z.y + 5, z.r * 1.05, z.r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawZombie(z: Zombie) {
    const ctx = this.ctx;
    const r = z.r;
    if (z.def.kind === 'egg') {
      this.drawEgg(z);
      return;
    }
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.rotate(z.face);
    const hit = z.flash > 0;
    const frozen = this.active.freeze > 0;
    const windup = z.boss?.state === 'windup' || z.leap?.state === 'crouch' || (z.jug?.windup ?? 0) > 0 || z.zapT > 0;
    ctx.globalAlpha = this.crawlerAlpha(z);
    const icy = frozen || z.frozenT > 0;
    const body = hit ? '#ffffff' : windup ? (Math.floor(this.clock * 20) % 2 ? (z.zapT > 0 ? '#c8f8ff' : '#ff4040') : z.def.body) : icy || z.slow > 0 ? '#8fc4d9' : z.burn > 0 ? '#5a3a20' : z.def.body;
    const dark = hit ? '#ffffff' : icy ? '#4f7f99' : z.def.dark;
    const kind = z.def.kind;
    // Arms reaching forward, swinging as they walk.
    const swing = Math.sin(z.phase) * r * 0.25;
    if (kind === 'shield') {
      // Riot shield held out front.
      ctx.fillStyle = hit ? '#fff' : '#9aa8b4';
      ctx.beginPath();
      ctx.arc(r * 0.35, 0, r * 1.25, -1.05, 1.05);
      ctx.arc(r * 0.35, 0, r * 0.95, 1.05, -1.05, true);
      ctx.fill();
      ctx.fillStyle = 'rgba(30,40,50,0.6)';
      ctx.fillRect(r * 1.2, -r * 0.35, r * 0.18, r * 0.7);
    } else if (kind === 'dog') {
      // Four legs and a long body instead of reaching arms.
      ctx.fillStyle = dark;
      const step = Math.sin(z.phase * 1.6) * r * 0.35;
      ctx.fillRect(r * 0.3 + step, -r * 0.85, r * 0.25, r * 0.4);
      ctx.fillRect(r * 0.3 - step, r * 0.45, r * 0.25, r * 0.4);
      ctx.fillRect(-r * 0.8 - step, -r * 0.85, r * 0.25, r * 0.4);
      ctx.fillRect(-r * 0.8 + step, r * 0.45, r * 0.25, r * 0.4);
      ctx.fillRect(-r * 1.7, -r * 0.1, r * 0.6, r * 0.2);
    } else if (kind !== 'bloater') {
      ctx.fillStyle = dark;
      ctx.fillRect(r * 0.2, -r * 0.85 + swing * 0.3, r * 1.1 + swing, r * 0.36);
      ctx.fillRect(r * 0.2, r * 0.5 - swing * 0.3, r * 1.1 - swing, r * 0.36);
    }
    const crouch = z.leap?.state === 'crouch' ? 0.85 : 1;
    const pulse = (kind === 'bloater' ? 1 + Math.sin(this.clock * 6 + z.id) * 0.06 : kind === 'screamer' && z.abilityCd < 0.6 ? 1.12 : 1) * crouch;
    ctx.fillStyle = body;
    ctx.beginPath();
    if (kind === 'dog') ctx.ellipse(-r * 0.2, 0, r * 1.25, r * 0.7, 0, 0, Math.PI * 2);
    else ctx.arc(0, 0, r * pulse, 0, Math.PI * 2);
    ctx.fill();
    if (kind === 'bloater') {
      // Boils
      ctx.fillStyle = hit ? '#fff' : '#b6e04a';
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3 + z.id;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (kind === 'spitter') {
      ctx.fillStyle = hit ? '#fff' : '#b04aff';
      ctx.beginPath();
      ctx.arc(r * 0.75, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(r * 0.2, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (kind === 'soldier' && z.plates > 0) {
      // Armor plates, one per side and one on the back; they fall off as they break.
      ctx.fillStyle = hit ? '#fff' : '#8a9298';
      const spots = [
        [0, -r * 0.62],
        [0, r * 0.62],
        [-r * 0.62, 0],
      ];
      for (let i = 0; i < z.plates; i++) ctx.fillRect(spots[i][0] - r * 0.35, spots[i][1] - r * 0.22, r * 0.7, r * 0.44);
      ctx.fillStyle = '#3a4048';
      ctx.fillRect(r * 0.05, -r * 0.4, r * 0.55, r * 0.8);
    }
    if (kind === 'juggernaut') {
      // Front armor plate and a glowing weak spot on the back.
      ctx.fillStyle = hit ? '#fff' : '#8a9098';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.05, -1.1, 1.1);
      ctx.arc(0, 0, r * 0.7, 1.1, -1.1, true);
      ctx.fill();
      ctx.fillStyle = '#3a3e44';
      for (let i = -2; i <= 2; i++) ctx.fillRect(r * 0.75, i * r * 0.22 - 2, r * 0.25, 4);
      ctx.fillStyle = `rgba(255,${120 + Math.floor(60 * Math.sin(this.clock * 6))},40,1)`;
      ctx.beginPath();
      ctx.arc(-r * 0.62, 0, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
    if (kind === 'electric') {
      ctx.strokeStyle = '#a0f0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = this.clock * 9 + i * 2.1 + z.id;
        ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
        ctx.lineTo(Math.cos(a + 0.4) * r * 1.1, Math.sin(a + 0.4) * r * 1.1);
      }
      ctx.stroke();
    }
    if (kind === 'screamer') {
      // Gaping mouth
      ctx.fillStyle = '#1a0006';
      ctx.beginPath();
      ctx.ellipse(r * 0.55, 0, r * 0.28, r * (z.abilityCd < 0.6 ? 0.34 : 0.2), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (kind === 'leaper') {
      // Long back legs
      ctx.fillStyle = dark;
      ctx.fillRect(-r * 1.3, -r * 0.8, r * 0.9, r * 0.3);
      ctx.fillRect(-r * 1.3, r * 0.5, r * 0.9, r * 0.3);
    }
    if (kind === 'necro') {
      // Hood and a glowing staff
      ctx.fillStyle = hit ? '#fff' : '#26263a';
      ctx.beginPath();
      ctx.arc(-r * 0.15, 0, r * 0.8, Math.PI * 0.5, Math.PI * 1.5);
      ctx.fill();
      ctx.fillStyle = '#6a5a3a';
      ctx.fillRect(r * 0.3, r * 0.6, r * 1.4, r * 0.18);
      ctx.fillStyle = '#5dffb0';
      ctx.beginPath();
      ctx.arc(r * 1.75, r * 0.69, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    if (kind === 'brood') {
      // Egg sacs on her back
      ctx.fillStyle = hit ? '#fff' : '#e8d8a0';
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * 0.65 + (i / 5) * Math.PI * 0.7;
        const pr = r * (0.22 + 0.04 * Math.sin(this.clock * 5 + i));
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#3a2410';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.7, side * r * 0.3);
        ctx.lineTo(r * 1.35, side * r * 0.5);
        ctx.lineTo(r * 0.8, side * r * 0.55);
        ctx.fill();
      }
    }
    if (kind === 'tank') {
      ctx.fillStyle = hit ? '#fff' : '#3a4a44';
      ctx.fillRect(-r * 0.7, -r * 0.95, r * 1.1, r * 0.4);
      ctx.fillRect(-r * 0.7, r * 0.55, r * 1.1, r * 0.4);
    }
    if (kind === 'boss') {
      ctx.fillStyle = '#2a1030';
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * 0.6 + (i / 6) * Math.PI * 0.8;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.15) * r, Math.sin(a - 0.15) * r);
        ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
        ctx.lineTo(Math.cos(a + 0.15) * r, Math.sin(a + 0.15) * r);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (z.frozenT > 0) {
      // Ice block
      ctx.fillStyle = 'rgba(190,235,255,0.45)';
      ctx.strokeStyle = 'rgba(230,250,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(z.x - r * 1.2, z.y - r * 1.2, r * 2.4, r * 2.4, 4);
      ctx.fill();
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
    if (z.hp < z.maxHp && !isBoss(z) && this.crawlerAlpha(z) > 0.5) {
      const w = r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(z.x - w / 2, z.y - r - 10, w, 4);
      ctx.fillStyle = '#e0483e';
      ctx.fillRect(z.x - w / 2, z.y - r - 10, w * Math.max(0, z.hp / z.maxHp), 4);
    }
  }

  private drawEgg(z: Zombie) {
    const ctx = this.ctx;
    const ripe = 1 - clamp(z.abilityCd / 3.6, 0, 1);
    const wob = Math.sin(this.clock * (8 + ripe * 20) + z.id) * ripe * 0.12;
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.rotate(wob);
    ctx.fillStyle = z.flash > 0 ? '#fff' : '#d8c89a';
    ctx.beginPath();
    ctx.ellipse(0, 0, z.r * 0.85, z.r * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a7a4a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = `rgba(120,30,20,${0.2 + ripe * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(0, 2, z.r * 0.45, z.r * 0.6, 0, 0, Math.PI * 2);
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
      ctx.fillStyle = '#5a8cff';
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, 13, 17, g.a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(3, 5, 17, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(p.angle);
    const gl = w.def.length;
    const kind = w.def.id;
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(6, kind === 'minigun' || kind === 'rocket' ? -5 : -3.5, gl, kind === 'minigun' || kind === 'rocket' ? 10 : 7);
    if (kind === 'minigun') {
      ctx.fillStyle = '#555';
      const spinOff = (this.clock * 60 * this.spin) % 3;
      for (let i = -1; i <= 1; i++) ctx.fillRect(14, i * 3 - 1 + spinOff * 0.3, gl - 8, 1.5);
    } else if (kind === 'flamer') {
      ctx.fillStyle = '#8a2c1a';
      ctx.fillRect(-14, -6, 8, 12);
      ctx.fillStyle = '#ff8a2b';
      ctx.fillRect(gl + 3, -1.5, 3, 3);
    } else if (kind === 'rocket') {
      ctx.fillStyle = '#4a5a3a';
      ctx.fillRect(2, -6, gl + 2, 12);
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
    const hurt = this.hurtFlash > 0 && Math.floor(this.hurtFlash * 30) % 2 === 0;
    ctx.fillStyle = hurt ? '#ff6a5a' : '#3d5a3a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    // Backpack
    ctx.fillStyle = hurt ? '#ff8a7a' : '#2e4430';
    ctx.fillRect(-13, -8, 7, 16);
    ctx.fillStyle = hurt ? '#ffaaa0' : '#56784f';
    ctx.beginPath();
    ctx.arc(1, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    // Helmet lamp
    ctx.fillStyle = '#fff6cc';
    ctx.fillRect(8, -2.5, 3, 5);
    ctx.restore();
    this.drawOrbitals();
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

  private drawHud() {
    const ctx = this.ctx;
    const pad = 14;
    ctx.textBaseline = 'middle';

    // Health
    const hw = Math.min(200, this.w * 0.35);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(pad, pad, hw, 18);
    const frac = clamp(this.p.hp / this.stats.maxHp, 0, 1);
    ctx.fillStyle = frac > 0.3 ? '#4fbf4a' : '#e0483e';
    ctx.fillRect(pad + 2, pad + 2, (hw - 4) * frac, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.ceil(Math.max(0, this.p.hp))} / ${this.stats.maxHp}${this.armor > 0 ? `   🛡️${Math.round(this.armor * 100)}%` : ''}`, pad + 6, pad + 10);

    // Cash + grenades
    ctx.font = `${this.cashPulse > 0 ? 24 : 21}px ${FONT}`;
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`$${Math.floor(this.cash)}`, pad, pad + 40);
    const cashW = ctx.measureText(`$${Math.floor(this.cash)}`).width;
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`💣 ${this.grenadeCount}`, pad + cashW + 16, pad + 40);
    ctx.font = `${this.brainsPulse > 0 ? 17 : 15}px system-ui, sans-serif`;
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
    ctx.fillStyle = '#fff';
    ctx.font = `22px ${FONT}`;
    ctx.fillText(`WAVE ${this.wave}`, this.w / 2, pad + 10);
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = '#c9d1b8';
    ctx.fillText(`${this.toSpawn + this.zombies.length} zombies left`, this.w / 2, pad + 31);

    let rowY = pad + 50;
    const boss = this.zombies.find(isBoss);
    if (boss) {
      const bw = Math.min(360, this.w * 0.5);
      const bx = this.w / 2 - bw / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx, rowY - 6, bw, 12);
      const shielded = boss.def.kind === 'brood' && this.countKind('egg') > 0;
      ctx.fillStyle = BOSS_COLORS[boss.def.kind] ?? '#b05bd6';
      ctx.fillRect(bx + 2, rowY - 4, (bw - 4) * Math.max(0, boss.hp / boss.maxHp), 8);
      ctx.fillStyle = '#fff';
      ctx.font = `11px ${FONT}`;
      ctx.fillText(`${BOSS_NAMES[boss.def.kind]}${shielded ? '  (SHIELDED BY EGGS)' : ''}`, this.w / 2, rowY + 15);
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
    ctx.fillStyle = '#fff';
    ctx.font = `16px ${FONT}`;
    ctx.fillText(`${w.def.name}${w.level > 1 ? ` Lv${w.level}` : ''}`, this.w - 62, pad + 8);
    ctx.font = '700 13px system-ui, sans-serif';
    if (w.reloadT > 0) {
      const tot = w.def.reload * this.stats.reload;
      ctx.fillStyle = '#ffb347';
      ctx.fillText('RELOADING', this.w - 62, pad + 28);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(this.w - 142, pad + 38, 80, 4);
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(this.w - 142, pad + 38, 80 * (1 - w.reloadT / tot), 4);
    } else if (this.active.ammo > 0) {
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('∞ BOTTOMLESS', this.w - 62, pad + 28);
    } else {
      ctx.fillStyle = w.ammo === 0 ? '#e0483e' : '#c9d1b8';
      ctx.fillText(`${w.ammo} / ${this.weaponMag(w)}`, this.w - 62, pad + 28);
    }

    // Combo meter (left side, clear of the touch buttons)
    if (this.combo >= 3) {
      const cx = pad;
      const cy = Math.max(pad + 100, Math.min(this.h * 0.4, 170));
      const pop = 1 + Math.max(0, this.comboPop) * 2;
      ctx.textAlign = 'left';
      ctx.font = `${Math.round(30 * pop)}px ${FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText(`x${this.combo}`, cx + 2, cy + 2);
      ctx.fillStyle = this.combo >= 50 ? '#ff5a4a' : this.combo >= 25 ? '#ffb347' : '#ffd23f';
      ctx.fillText(`x${this.combo}`, cx, cy);
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`COMBO  +${Math.min(this.combo, 100)}% cash`, cx, cy + 22);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(cx, cy + 32, 90, 3);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(cx, cy + 32, 90 * (this.comboT / COMBO_TIME), 3);
    }

    // Buttons
    for (const b of this.input.buttons) {
      const held = this.input.heldButtons.has(b.id);
      ctx.fillStyle = held ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.45)';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.font = `800 ${b.label.length > 2 ? 11 : 15}px system-ui, sans-serif`;
      ctx.fillText(b.label, b.x, b.y + 1);
      if (b.id === 'nade') {
        ctx.font = '800 10px system-ui, sans-serif';
        ctx.fillText(String(this.grenadeCount), b.x, b.y + 13);
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
        ctx.font = '600 13px system-ui, sans-serif';
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
