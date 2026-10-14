import { Sfx } from './audio';
import { baseStats, PERKS, RARITY_WEIGHT, Stats, WEAPONS, WeaponDef, ZOMBIES, ZombieDef, ZombieKind, PerkDef } from './data';
import { Input, STICK_RADIUS, stickVec } from './input';

export const WORLD_W = 2200;
export const WORLD_H = 1600;
const PLAYER_R = 16;
const BORDER = 40;
const DASH_TIME = 0.18;
const DASH_COOLDOWN = 2.2;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  life: number;
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
  attackCd: number;
  bladeCd: number;
  phase: number;
  face: number;
  dead: boolean;
  boss?: { state: 'walk' | 'windup' | 'charge'; t: number; dx: number; dy: number; summon: number };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  decal: boolean;
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

interface Ring {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  color: string;
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
  best: number;
  newBest: boolean;
}

export interface Hooks {
  onWaveCleared: (wave: number) => void;
  onGameOver: (s: RunSummary) => void;
  onPause: () => void;
}

export type State = 'menu' | 'playing' | 'between' | 'paused' | 'over';

const WALLS: Rect[] = [
  // Arena border
  { x: 0, y: 0, w: WORLD_W, h: BORDER },
  { x: 0, y: WORLD_H - BORDER, w: WORLD_W, h: BORDER },
  { x: 0, y: 0, w: BORDER, h: WORLD_H },
  { x: WORLD_W - BORDER, y: 0, w: BORDER, h: WORLD_H },
  // Cover
  { x: 480, y: 330, w: 240, h: 56 },
  { x: 1480, y: 330, w: 240, h: 56 },
  { x: 480, y: 1214, w: 240, h: 56 },
  { x: 1480, y: 1214, w: 240, h: 56 },
  { x: 300, y: 680, w: 56, h: 240 },
  { x: 1844, y: 680, w: 56, h: 240 },
  { x: 1050, y: 520, w: 100, h: 70 },
  { x: 1050, y: 1010, w: 100, h: 70 },
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

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function loadBest(): number {
  try {
    return Number(localStorage.getItem('horde-best') ?? 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v: number) {
  try {
    localStorage.setItem('horde-best', String(v));
  } catch {
    /* storage unavailable */
  }
}

export class Game {
  state: State = 'menu';
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private zoom = 1;
  private cam = { x: WORLD_W / 2, y: WORLD_H / 2 };
  private floor: CanvasPattern | null = null;
  private decals: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;

  // Run state
  stats: Stats = baseStats();
  perkCounts = new Map<string, number>();
  weapons: OwnedWeapon[] = [];
  wi = 0;
  cash = 0;
  armor = 0;
  wave = 0;
  best = loadBest();
  private p = { x: 0, y: 0, hp: 100, angle: 0, vx: 0, vy: 0 };
  private fireCd = 0;
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
  private rings: Ring[] = [];
  private toSpawn = 0;
  private spawnT = 0;
  private clearT = -1;
  private kills = 0;
  private earned = 0;
  private runTime = 0;
  private trauma = 0;
  private slowT = 0;
  private nextId = 1;
  private bladeAngle = 0;
  private droneT: number[] = [];
  private banner = { text: '', sub: '', t: 0 };
  private emptyClickT = 0;
  private cashPulse = 0;
  private flow = new Int32Array(FLOW_W * FLOW_H);
  private flowT = 0;

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
    this.buildFloor();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.newRun();
    this.state = 'menu';
  }

  // ---------------------------------------------------------------- setup

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // Show roughly 460 world units across the short side of the screen.
    this.zoom = clamp(Math.min(this.w, this.h) / 460, 0.7, 1.8);
  }

  private buildFloor() {
    const t = document.createElement('canvas');
    t.width = t.height = 128;
    const c = t.getContext('2d')!;
    c.fillStyle = '#262b22';
    c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)';
      const s = rand(2, 9);
      c.fillRect(rand(0, 128), rand(0, 128), s, s);
    }
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = 2;
    c.strokeRect(0, 0, 64, 64);
    c.strokeRect(64, 64, 64, 64);
    c.strokeRect(64, 0, 64, 64);
    c.strokeRect(0, 64, 64, 64);
    this.floor = this.ctx.createPattern(t, 'repeat');
  }

  newRun() {
    this.stats = baseStats();
    this.perkCounts.clear();
    this.weapons = [this.makeWeapon(WEAPONS[0])];
    this.wi = 0;
    this.cash = 0;
    this.armor = 0;
    this.wave = 0;
    this.p = { x: WORLD_W / 2, y: WORLD_H / 2, hp: 100, angle: -Math.PI / 2, vx: 0, vy: 0 };
    this.cam = { x: this.p.x, y: this.p.y };
    this.zombies = [];
    this.bullets = [];
    this.particles = [];
    this.texts = [];
    this.pickups = [];
    this.rings = [];
    this.kills = 0;
    this.earned = 0;
    this.runTime = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.droneT = [];
    this.slowT = 0;
    this.trauma = 0;
    this.dctx.clearRect(0, 0, this.decals.width, this.decals.height);
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
    this.input.reset();
    // Fade old blood so the floor doesn't turn solid red.
    this.dctx.globalCompositeOperation = 'destination-out';
    this.dctx.fillStyle = 'rgba(0,0,0,0.35)';
    this.dctx.fillRect(0, 0, this.decals.width, this.decals.height);
    this.dctx.globalCompositeOperation = 'source-over';
    if (boss) {
      const g = this.farthestGate();
      this.spawnZombie('boss', g.x, g.y + (g.y < WORLD_H / 2 ? 40 : -40));
      this.showBanner(`WAVE ${this.wave}`, 'BOSS INCOMING');
      this.sfx.play('boss');
      this.addShake(0.5);
    } else {
      this.showBanner(`WAVE ${this.wave}`, this.wave === 1 ? 'Survive!' : '');
      this.sfx.play('wave');
    }
  }

  private showBanner(text: string, sub: string) {
    this.banner = { text, sub, t: 2.2 };
  }

  // ---------------------------------------------------------------- perks & shop

  weaponDamage(w: OwnedWeapon) {
    return w.def.damage * (1 + 0.25 * (w.level - 1)) * this.stats.damage;
  }
  private weaponRate(w: OwnedWeapon) {
    return w.def.fireRate * (1 + 0.08 * (w.level - 1)) * this.stats.fireRate;
  }
  private weaponMag(w: OwnedWeapon) {
    return Math.max(1, Math.round(w.def.mag * this.stats.mag));
  }

  rollPerks(n = 3): PerkDef[] {
    const pool = PERKS.filter((p) => (this.perkCounts.get(p.id) ?? 0) < p.max);
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
    const armorLvl = Math.round(this.armor / 0.08);
    if (armorLvl < 5) {
      const price = 150 * (armorLvl + 1);
      items.push({ id: 'armor', label: '🛡️ Armor plate', sub: `Take ${Math.round((this.armor + 0.08) * 100)}% less damage`, price, enabled: this.cash >= price });
    }
    for (const def of WEAPONS) {
      const owned = this.weapons.find((w) => w.def.id === def.id);
      if (!owned) {
        items.push({ id: `buy:${def.id}`, label: `🔫 ${def.name}`, sub: `${def.pellets > 1 ? `${def.pellets}x` : ''}${def.damage} dmg, ${def.fireRate}/s`, price: def.price, enabled: this.cash >= def.price });
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
    this.updateButtons();
    if (this.state !== 'playing') {
      this.input.clearPressed();
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
    for (let i = 0; i < 4; i++) if (inp.consume(String(i + 1)) && this.weapons[i]) this.setWeapon(i);
    if (inp.consume('r') || inp.consume('reload')) this.startReload();

    this.updatePlayer(dt);
    this.updateSpawning(dt);
    this.updateZombies(dt);
    this.updateBullets(dt);
    this.updateOrbitals(dt);
    this.updatePickups(dt);
    this.updateEffects(dt, rawDt);

    this.zombies = this.zombies.filter((z) => !z.dead);
    inp.clearPressed();

    if (this.clearT < 0 && this.toSpawn <= 0 && this.zombies.length === 0) {
      this.clearT = 1.4;
      this.showBanner('WAVE CLEARED', '');
      // Vacuum up any cash left on the floor.
      for (const pk of this.pickups) if (pk.kind === 'cash') pk.pulled = true;
    }
    if (this.clearT >= 0) {
      this.clearT -= rawDt;
      if (this.clearT < 0) {
        for (const pk of this.pickups) if (pk.kind === 'cash') this.gainCash(pk.value);
        this.pickups = [];
        this.bullets = [];
        this.state = 'between';
        this.input.reset();
        this.hooks.onWaveCleared(this.wave);
      }
    }
  }

  private updateButtons() {
    const inp = this.input;
    const btns = [{ id: 'pause', x: this.w - 30, y: 30, r: 20, label: 'II' }];
    if (inp.touchMode && this.state === 'playing') {
      const cy = clamp(this.h * 0.5, 150, this.h - 120);
      btns.push({ id: 'dash', x: this.w - 54, y: cy, r: 32, label: 'DASH' });
      btns.push({ id: 'swap', x: this.w - 54, y: cy - 82, r: 25, label: 'SWAP' });
      btns.push({ id: 'reload', x: this.w - 124, y: cy - 82, r: 25, label: 'R' });
    }
    inp.buttons = btns;
  }

  private switchWeapon(dir: number) {
    if (this.weapons.length < 2) return;
    this.setWeapon((this.wi + dir + this.weapons.length) % this.weapons.length);
  }

  private setWeapon(i: number) {
    if (i === this.wi) return;
    this.wi = i;
    this.fireCd = Math.max(this.fireCd, 0.15);
    this.sfx.play('reload');
  }

  private startReload() {
    const w = this.weapons[this.wi];
    if (w.reloadT > 0 || w.ammo >= this.weaponMag(w)) return;
    w.reloadT = w.def.reload * this.stats.reload;
    this.sfx.play('reload');
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

    // Dash
    this.dashCd -= dt;
    if ((inp.consume(' ') || inp.consume('shift') || inp.consume('dash')) && this.dashCd <= 0) {
      const m = Math.hypot(mv.x, mv.y);
      this.dashDir = m > 0.1 ? { x: mv.x / m, y: mv.y / m } : { x: Math.cos(p.angle), y: Math.sin(p.angle) };
      this.dashT = DASH_TIME;
      this.dashCd = DASH_COOLDOWN;
      this.sfx.play('dash');
    }

    const speed = 230 * this.stats.speed;
    if (this.dashT > 0) {
      this.dashT -= dt;
      p.vx = this.dashDir.x * speed * 3.6;
      p.vy = this.dashDir.y * speed * 3.6;
      this.spawnParticle(p.x, p.y, 0, 0, 0.25, PLAYER_R, 'rgba(120,170,255,0.35)', 0, false);
    } else {
      // Slight acceleration for a weightier feel.
      const k = 1 - Math.exp(-dt * 18);
      p.vx += (mv.x * speed - p.vx) * k;
      p.vy += (mv.y * speed - p.vy) * k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.collideWalls(p, PLAYER_R);

    // Weapon
    const w = this.weapons[this.wi];
    this.fireCd -= dt;
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) w.ammo = this.weaponMag(w);
    } else if (firing && this.fireCd <= 0) {
      if (w.ammo > 0) this.fire(w);
      else this.startReload();
    }
    if (this.emptyClickT > 0) this.emptyClickT -= dt;

    this.novaCd -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
  }

  private fire(w: OwnedWeapon) {
    const p = this.p;
    this.fireCd = 1 / this.weaponRate(w);
    w.ammo--;
    const dmg = this.weaponDamage(w);
    const n = w.def.pellets + this.stats.extraShots;
    const mx = p.x + Math.cos(p.angle) * 24;
    const my = p.y + Math.sin(p.angle) * 24;
    for (let i = 0; i < n; i++) {
      let a = p.angle + rand(-w.def.spread / 2, w.def.spread / 2);
      if (w.def.pellets === 1 && n > 1) a += (i - (n - 1) / 2) * 0.1;
      const sp = w.def.speed * rand(0.92, 1.05);
      this.bullets.push({
        x: mx,
        y: my,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        dmg,
        life: w.def.life,
        pierce: this.stats.pierce,
        ricochet: this.stats.ricochet,
        hits: [],
        color: w.def.color,
        width: w.def.id === 'shotgun' ? 2.5 : 3,
        canExplode: true,
      });
    }
    // Muzzle flash, smoke and a shell casing.
    for (let i = 0; i < 4; i++) {
      const a = p.angle + rand(-0.4, 0.4);
      this.spawnParticle(mx, my, Math.cos(a) * rand(80, 260), Math.sin(a) * rand(80, 260), 0.07, rand(3, 6), '#fff2b0', 8, false);
    }
    this.spawnParticle(mx, my, Math.cos(p.angle) * 40, Math.sin(p.angle) * 40, 0.5, 5, 'rgba(180,180,170,0.25)', 3, false);
    const side = p.angle + Math.PI / 2;
    this.spawnParticle(p.x, p.y, Math.cos(side) * rand(90, 150), Math.sin(side) * rand(90, 150), 0.4, 2.5, '#d4a24a', 6, false);
    this.addShake(w.def.shake * 0.5);
    // Recoil
    p.vx -= Math.cos(p.angle) * 40 * w.def.shake;
    p.vy -= Math.sin(p.angle) * 40 * w.def.shake;
    this.sfx.play(w.def.id as 'pistol');
    if (w.ammo <= 0) this.startReload();
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
    for (let i = 0; i < group; i++) {
      const roll = Math.random();
      let kind: ZombieKind = 'walker';
      const tankChance = this.wave >= 4 ? Math.min(0.12, 0.04 + (this.wave - 4) * 0.012) : 0;
      const runnerChance = this.wave >= 2 ? Math.min(0.4, 0.12 + (this.wave - 2) * 0.04) : 0;
      if (roll < tankChance) kind = 'tank';
      else if (roll < tankChance + runnerChance) kind = 'runner';
      const inward = { x: WORLD_W / 2 - gate.x, y: WORLD_H / 2 - gate.y };
      const d = Math.hypot(inward.x, inward.y);
      this.spawnZombie(kind, gate.x + (inward.x / d) * 30 + rand(-40, 40), gate.y + (inward.y / d) * 30 + rand(-40, 40));
      this.toSpawn--;
    }
  }

  private spawnZombie(kind: ZombieKind, x: number, y: number) {
    const def = ZOMBIES[kind];
    const hpScale = 1 + 0.16 * (this.wave - 1) + 0.006 * (this.wave - 1) ** 2;
    const spScale = Math.min(1.35, 1 + 0.02 * (this.wave - 1));
    const hp = def.hp * hpScale * (kind === 'boss' ? 1 + this.wave / 20 : 1);
    const z: Zombie = {
      id: this.nextId++,
      def,
      x: clamp(x, BORDER + def.radius, WORLD_W - BORDER - def.radius),
      y: clamp(y, BORDER + def.radius, WORLD_H - BORDER - def.radius),
      kx: 0,
      ky: 0,
      hp,
      maxHp: hp,
      speed: def.speed * spScale * rand(0.9, 1.1),
      dmg: def.damage * (1 + 0.05 * (this.wave - 1)),
      r: def.radius,
      flash: 0,
      slow: 0,
      attackCd: 0,
      bladeCd: 0,
      phase: Math.random() * 10,
      face: 0,
      dead: false,
    };
    if (kind === 'boss') z.boss = { state: 'walk', t: 3, dx: 0, dy: 0, summon: 6 };
    this.zombies.push(z);
  }

  private buildFlow() {
    const f = this.flow;
    f.fill(-1);
    const px = clamp(Math.floor(this.p.x / CELL), 0, FLOW_W - 1);
    const py = clamp(Math.floor(this.p.y / CELL), 0, FLOW_H - 1);
    const queue = new Int32Array(FLOW_W * FLOW_H);
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
    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.2;
      this.buildFlow();
    }
    for (const z of zs) {
      if (z.dead) continue;
      const dx = p.x - z.x;
      const dy = p.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      let sp = z.speed * (z.slow > 0 ? 0.5 : 1);
      const dir = d > 90 ? this.flowDir(z.x, z.y) : null;
      let vx = (dir ? dir.x : dx / d) * sp;
      let vy = (dir ? dir.y : dy / d) * sp;
      z.face = Math.atan2(vy, vx);

      if (z.boss) {
        const b = z.boss;
        b.t -= dt;
        b.summon -= dt;
        if (b.summon <= 0) {
          b.summon = 7;
          for (let i = 0; i < 3 + Math.floor(this.wave / 10); i++) this.spawnZombie('runner', z.x + rand(-60, 60), z.y + rand(-60, 60));
          this.rings.push({ x: z.x, y: z.y, r: 0, max: 120, life: 0.5, color: 'rgba(190,90,255,' });
        }
        if (b.state === 'walk' && b.t <= 0) {
          b.state = 'windup';
          b.t = 0.75;
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
          vx = b.dx * 520;
          vy = b.dy * 520;
          z.face = Math.atan2(b.dy, b.dx);
          if (b.t <= 0) {
            b.state = 'walk';
            b.t = rand(3, 4.5);
          }
        }
      }

      z.kx *= Math.exp(-dt * 9);
      z.ky *= Math.exp(-dt * 9);
      const ox = z.x;
      const oy = z.y;
      z.x += (vx + z.kx) * dt;
      z.y += (vy + z.ky) * dt;
      if (this.collideWalls(z, z.r)) {
        if (z.boss && z.boss.state === 'charge') {
          z.boss.state = 'walk';
          z.boss.t = rand(3, 4.5);
          this.addShake(0.6);
          this.sfx.play('explode', 0.6);
        }
      }
      z.phase += Math.hypot(z.x - ox, z.y - oy) * 0.08;
      if (z.flash > 0) z.flash -= dt;
      if (z.slow > 0) z.slow -= dt;
      if (z.attackCd > 0) z.attackCd -= dt;
      if (z.bladeCd > 0) z.bladeCd -= dt;

      if (d < z.r + PLAYER_R + 3 && z.attackCd <= 0) {
        z.attackCd = 0.8;
        this.hurtPlayer(z.dmg, z);
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

  private hurtPlayer(amount: number, from: Zombie | null) {
    if (this.dashT > 0 || this.state !== 'playing') return;
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
    this.p.hp = 0;
    this.state = 'over';
    this.addShake(1);
    for (let i = 0; i < 30; i++) this.spawnBlood(this.p.x, this.p.y, rand(0, Math.PI * 2), '#a0201a');
    const newBest = this.wave > this.best;
    if (newBest) {
      this.best = this.wave;
      saveBest(this.wave);
    }
    this.input.reset();
    this.hooks.onGameOver({ wave: this.wave, kills: this.kills, cash: Math.round(this.earned), time: this.runTime, best: this.best, newBest });
  }

  private updateBullets(dt: number) {
    const out: Bullet[] = [];
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) continue;
      if (this.pointInWall(b.x, b.y)) {
        for (let i = 0; i < 3; i++) this.spawnParticle(b.x - b.vx * dt, b.y - b.vy * dt, rand(-120, 120), rand(-120, 120), 0.15, 2, '#ffd27a', 6, false);
        continue;
      }
      let alive = true;
      for (const z of this.zombies) {
        if (z.dead || b.hits.includes(z.id)) continue;
        const dx = z.x - b.x;
        const dy = z.y - b.y;
        const rr = z.r + 4;
        if (dx * dx + dy * dy > rr * rr) continue;
        b.hits.push(z.id);
        let dmg = b.dmg;
        const crit = Math.random() < this.stats.crit;
        if (crit) dmg *= 2.5;
        this.damageZombie(z, dmg, Math.atan2(b.vy, b.vx), crit, 140);
        if (b.canExplode && Math.random() < this.stats.explode) this.explode(b.x, b.y, b.dmg * 1.4);
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

  private damageZombie(z: Zombie, dmg: number, angle: number, crit: boolean, knock: number) {
    if (z.dead) return;
    z.hp -= dmg;
    z.flash = 0.07;
    const k = knock / z.def.mass;
    z.kx += Math.cos(angle) * k;
    z.ky += Math.sin(angle) * k;
    if (this.stats.frost > 0) z.slow = 1.5;
    for (let i = 0; i < (crit ? 5 : 2); i++) this.spawnBlood(z.x, z.y, angle + rand(-0.6, 0.6), '#7a1010');
    this.addText(z.x + rand(-8, 8), z.y - z.r - 4, String(Math.round(dmg)), crit ? '#ffd23f' : '#ffffff', crit ? 17 : 12);
    this.sfx.play('hit');
    if (z.hp <= 0) this.killZombie(z, angle);
  }

  private killZombie(z: Zombie, angle: number) {
    z.dead = true;
    this.kills++;
    const boss = z.def.kind === 'boss';
    const n = boss ? 60 : z.def.kind === 'tank' ? 22 : 12;
    for (let i = 0; i < n; i++) this.spawnBlood(z.x, z.y, angle + rand(-1.2, 1.2), i % 3 ? '#8a1414' : z.def.dark, rand(1, boss ? 3 : 1.8));
    // A big splat on the floor.
    this.dctx.fillStyle = 'rgba(90,10,10,0.55)';
    for (let i = 0; i < (boss ? 14 : 5); i++) {
      this.dctx.beginPath();
      this.dctx.arc((z.x + rand(-z.r, z.r)) / 2, (z.y + rand(-z.r, z.r)) / 2, rand(2, z.r / 2.5), 0, Math.PI * 2);
      this.dctx.fill();
    }
    const value = z.def.cash * this.stats.cash * (1 + 0.06 * (this.wave - 1));
    const coins = boss ? 20 : z.def.kind === 'tank' ? 4 : 1;
    for (let i = 0; i < coins; i++) {
      const a = rand(0, Math.PI * 2);
      const s = coins > 1 ? rand(60, 220) : rand(20, 60);
      this.pickups.push({ x: z.x, y: z.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind: 'cash', value: value / coins, pulled: false });
    }
    const healthChance = boss ? 1 : z.def.kind === 'tank' ? 0.25 : 0.025;
    if (Math.random() < healthChance) this.pickups.push({ x: z.x, y: z.y, vx: rand(-40, 40), vy: rand(-40, 40), kind: 'health', value: 25, pulled: false });
    if (this.stats.lifesteal > 0) this.p.hp = Math.min(this.stats.maxHp, this.p.hp + this.stats.lifesteal);
    this.sfx.play('death', boss ? 2 : 1);
    this.addShake(boss ? 1 : z.def.kind === 'tank' ? 0.3 : 0.06);
    if (boss) {
      this.slowT = 1.2;
      this.explode(z.x, z.y, 0);
      this.showBanner('BOSS DOWN', '');
    }
  }

  private explode(x: number, y: number, dmg: number) {
    const radius = 80;
    this.rings.push({ x, y, r: 10, max: radius, life: 0.3, color: 'rgba(255,170,60,' });
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(80, 300);
      this.spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.2, 0.5), rand(3, 7), i % 2 ? '#ffb347' : '#ff6a2b', 4, false);
    }
    this.dctx.fillStyle = 'rgba(0,0,0,0.35)';
    this.dctx.beginPath();
    this.dctx.arc(x / 2, y / 2, radius / 3, 0, Math.PI * 2);
    this.dctx.fill();
    this.addShake(0.25);
    this.sfx.play('explode', 0.6);
    if (dmg <= 0) return;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < radius + z.r) this.damageZombie(z, dmg, Math.atan2(z.y - y, z.x - x), false, 300);
    }
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
      this.bullets.push({ x: d.x, y: d.y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, dmg: 16 * this.stats.damage, life: 0.6, pierce: 0, ricochet: 0, hits: [], color: '#7ef0ff', width: 2, canExplode: false });
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
          this.dctx.fillRect(q.x / 2 - q.size / 2, q.y / 2 - q.size / 2, q.size, q.size);
          this.dctx.globalAlpha = 1;
        }
        continue;
      }
      const k = Math.exp(-dt * q.drag);
      q.vx *= k;
      q.vy *= k;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      ps.push(q);
    }
    this.particles = ps.length > 900 ? ps.slice(ps.length - 900) : ps;
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
    this.trauma = Math.max(0, this.trauma - rawDt * 1.8);
    if (this.banner.t > 0) this.banner.t -= rawDt;
    if (this.cashPulse > 0) this.cashPulse -= rawDt;
  }

  private spawnParticle(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, drag: number, decal: boolean) {
    this.particles.push({ x, y, vx, vy, life, max: life, size, color, drag, decal });
  }

  private spawnBlood(x: number, y: number, angle: number, color: string, scale = 1) {
    const s = rand(60, 260) * scale;
    this.spawnParticle(x, y, Math.cos(angle) * s, Math.sin(angle) * s, rand(0.2, 0.5), rand(2, 5) * Math.min(scale, 1.6), color, 7, true);
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
    // Camera leads a little toward where you aim.
    const lead = this.state === 'playing' ? 60 : 0;
    const tx = p.x + Math.cos(p.angle) * lead;
    const ty = p.y + Math.sin(p.angle) * lead;
    const k = 1 - Math.exp(-dt * 6);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0c0a';
    ctx.fillRect(0, 0, this.w, this.h);

    const sh = this.trauma * this.trauma * 16;
    ctx.save();
    ctx.translate(this.w / 2 + rand(-sh, sh), this.h / 2 + rand(-sh, sh));
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    ctx.fillStyle = this.floor ?? '#262b22';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.drawImage(this.decals, 0, 0, WORLD_W, WORLD_H);
    this.drawGates();
    this.drawPickups();
    for (const z of this.zombies) this.drawZombie(z);
    if (this.state !== 'over') this.drawPlayer();
    this.drawBullets();
    this.drawOrbitals();
    for (const q of this.particles) {
      ctx.globalAlpha = Math.min(1, q.life / q.max + 0.3);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
    this.drawWalls();
    for (const r of this.rings) {
      ctx.strokeStyle = `${r.color}${Math.max(0, r.life * 2).toFixed(2)})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 3);
      ctx.font = `800 ${t.size}px system-ui, sans-serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(t.text, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.drawLighting();
    if (this.state !== 'menu') this.drawHud();
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

  private drawWalls() {
    const ctx = this.ctx;
    for (const w of WALLS) {
      ctx.fillStyle = '#1a1c18';
      ctx.fillRect(w.x + 6, w.y + 8, w.w, w.h);
      ctx.fillStyle = '#41463b';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = '#555c4c';
      ctx.fillRect(w.x + 4, w.y + 4, w.w - 8, w.h - 8);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x + 4, w.y + 4, w.w - 8, w.h - 8);
    }
    // Re-open the gate holes on top of the border walls.
    for (const g of GATES) {
      const horiz = g.y < BORDER * 2 || g.y > WORLD_H - BORDER * 2;
      ctx.fillStyle = '#0d0907';
      if (horiz) ctx.fillRect(g.x - 50, g.y < WORLD_H / 2 ? 0 : WORLD_H - BORDER, 100, BORDER);
      else ctx.fillRect(g.x < WORLD_W / 2 ? 0 : WORLD_W - BORDER, g.y - 50, BORDER, 100);
      ctx.fillStyle = 'rgba(140,30,20,0.35)';
      if (horiz) ctx.fillRect(g.x - 50, g.y < WORLD_H / 2 ? BORDER - 4 : WORLD_H - BORDER, 100, 4);
      else ctx.fillRect(g.x < WORLD_W / 2 ? BORDER - 4 : WORLD_W - BORDER, g.y - 50, 4, 100);
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

  private drawZombie(z: Zombie) {
    const ctx = this.ctx;
    const r = z.r;
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(3, 5, r * 1.05, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(z.face);
    const flash = z.flash > 0;
    const windup = z.boss?.state === 'windup';
    const body = flash ? '#ffffff' : windup ? (Math.floor(this.runTime * 20) % 2 ? '#ff4040' : z.def.body) : z.slow > 0 ? '#7fb4c9' : z.def.body;
    // Arms reaching forward, swinging as they walk.
    const swing = Math.sin(z.phase) * r * 0.25;
    ctx.fillStyle = flash ? '#fff' : z.def.dark;
    ctx.fillRect(r * 0.2, -r * 0.85 + swing * 0.3, r * 1.1 + swing, r * 0.36);
    ctx.fillRect(r * 0.2, r * 0.5 - swing * 0.3, r * 1.1 - swing, r * 0.36);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#fff' : z.def.dark;
    ctx.beginPath();
    ctx.arc(r * 0.2, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (z.def.kind === 'boss') {
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
    const eye = z.def.kind === 'walker' ? '#d8e070' : '#ff3b2f';
    ctx.fillStyle = eye;
    ctx.fillRect(r * 0.5, -r * 0.28, r * 0.18, r * 0.14);
    ctx.fillRect(r * 0.5, r * 0.14, r * 0.18, r * 0.14);
    ctx.restore();
    if (z.hp < z.maxHp && z.def.kind !== 'boss') {
      const w = r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(z.x - w / 2, z.y - r - 10, w, 4);
      ctx.fillStyle = '#e0483e';
      ctx.fillRect(z.x - w / 2, z.y - r - 10, w * Math.max(0, z.hp / z.maxHp), 4);
    }
  }

  private drawPlayer() {
    const ctx = this.ctx;
    const p = this.p;
    const w = this.weapons[this.wi];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(3, 5, 17, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(p.angle);
    const gl = w.def.id === 'shotgun' ? 30 : w.def.id === 'rifle' ? 34 : w.def.id === 'smg' ? 26 : 22;
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(6, -3.5, gl, 7);
    ctx.fillStyle = '#353535';
    ctx.fillRect(6, -2, gl - 6, 2);
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
    ctx.fillStyle = hurt ? '#ffaaa0' : '#56784f';
    ctx.beginPath();
    ctx.arc(1, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a3d28';
    ctx.fillRect(4, -5, 4, 10);
    ctx.restore();
  }

  private drawBullets() {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (const b of this.bullets) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
      ctx.stroke();
    }
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
      ctx.rotate(this.runTime * 20);
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

  private drawLighting() {
    const ctx = this.ctx;
    const s = this.toScreen(this.p.x, this.p.y);
    const R = Math.max(this.w, this.h);
    const g = ctx.createRadialGradient(s.x, s.y, R * 0.18, s.x, s.y, R * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    const low = this.p.hp / this.stats.maxHp;
    if (this.hurtFlash > 0 || (low < 0.3 && this.state === 'playing')) {
      const a = this.hurtFlash > 0 ? this.hurtFlash * 1.2 : (0.3 - low) * (0.6 + 0.4 * Math.sin(this.runTime * 6));
      const rg = ctx.createRadialGradient(this.w / 2, this.h / 2, R * 0.3, this.w / 2, this.h / 2, R * 0.7);
      rg.addColorStop(0, 'rgba(180,0,0,0)');
      rg.addColorStop(1, `rgba(180,0,0,${clamp(a, 0, 0.6).toFixed(2)})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawHud() {
    const ctx = this.ctx;
    const pad = 14;
    ctx.textBaseline = 'middle';

    // Health
    const hw = Math.min(200, this.w * 0.35);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(pad, pad, hw, 18);
    const frac = clamp(this.p.hp / this.stats.maxHp, 0, 1);
    ctx.fillStyle = frac > 0.3 ? '#4fbf4a' : '#e0483e';
    ctx.fillRect(pad + 2, pad + 2, (hw - 4) * frac, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.ceil(Math.max(0, this.p.hp))} / ${this.stats.maxHp}${this.armor > 0 ? `   🛡️${Math.round(this.armor * 100)}%` : ''}`, pad + 6, pad + 10);

    // Cash
    ctx.font = `800 ${this.cashPulse > 0 ? 22 : 19}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`$${Math.floor(this.cash)}`, pad, pad + 38);

    // Perks
    let px = pad;
    ctx.font = '15px system-ui, sans-serif';
    for (const perk of PERKS) {
      const c = this.perkCounts.get(perk.id);
      if (!c) continue;
      ctx.fillText(perk.icon, px, pad + 62);
      if (c > 1) {
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(String(c), px + 16, pad + 68);
        ctx.font = '15px system-ui, sans-serif';
      }
      px += c > 1 ? 30 : 24;
    }

    // Wave
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillText(`WAVE ${this.wave}`, this.w / 2, pad + 10);
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = '#c9d1b8';
    ctx.fillText(`${this.toSpawn + this.zombies.length} zombies left`, this.w / 2, pad + 30);

    const boss = this.zombies.find((z) => z.boss);
    if (boss) {
      const bw = Math.min(360, this.w * 0.5);
      const bx = this.w / 2 - bw / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx, pad + 44, bw, 12);
      ctx.fillStyle = '#b05bd6';
      ctx.fillRect(bx + 2, pad + 46, (bw - 4) * Math.max(0, boss.hp / boss.maxHp), 8);
      ctx.fillStyle = '#fff';
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.fillText('ABOMINATION', this.w / 2, pad + 64);
    }

    // Weapon + ammo (top right, left of the pause button)
    const w = this.weapons[this.wi];
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '800 15px system-ui, sans-serif';
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
    } else {
      ctx.fillStyle = w.ammo === 0 ? '#e0483e' : '#c9d1b8';
      ctx.fillText(`${w.ammo} / ${this.weaponMag(w)}`, this.w - 62, pad + 28);
    }

    // Buttons
    for (const b of this.input.buttons) {
      const held = this.input.heldButtons.has(b.id);
      ctx.fillStyle = held ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.4)';
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
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = `800 ${b.label.length > 2 ? 11 : 15}px system-ui, sans-serif`;
      ctx.fillText(b.label, b.x, b.y + 1);
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
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        if (!inp.move) ctx.fillText('drag here to move', this.w * 0.22, this.h - 50);
        if (!inp.aim) ctx.fillText('drag here to aim + shoot', this.w * 0.72, this.h - 50);
      }
    } else if (this.state === 'playing') {
      // Crosshair
      const m = inp.mouse;
      ctx.strokeStyle = '#ffffff';
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
      const a = Math.min(1, this.banner.t * 2);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.min(56, this.w / 9)}px system-ui, sans-serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(this.banner.text, this.w / 2 + 3, this.h * 0.32 + 3);
      ctx.fillStyle = this.banner.text.includes('BOSS') ? '#c065ff' : '#fff';
      ctx.fillText(this.banner.text, this.w / 2, this.h * 0.32);
      if (this.banner.sub) {
        ctx.font = '800 18px system-ui, sans-serif';
        ctx.fillStyle = '#e0483e';
        ctx.fillText(this.banner.sub, this.w / 2, this.h * 0.32 + 38);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }
}
