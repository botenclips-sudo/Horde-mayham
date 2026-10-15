// Everything that survives between runs: brains (the meta currency), XP and levels,
// unlocked guns and their mastery, permanent training, and daily missions.

import { WEAPONS, ZombieKind } from './data';
import { MAPS } from './maps';

const SAVE_KEY = 'horde-save';
const SAVE_VERSION = 1;

export interface MissionState {
  id: string;
  progress: number;
  done: boolean;
}

export interface SaveData {
  v: number;
  brains: number;
  xp: number; // XP into the current level
  level: number;
  best: number;
  unlocked: string[]; // weapon ids you can start a run with
  mastery: Record<string, number>; // weapon id -> mastery level (0..10)
  training: Record<string, number>;
  loadout: string[];
  missionDay: string;
  missions: MissionState[];
  totals: { runs: number; kills: number; bosses: number };
  map: string;
  mode: string;
  daily: { day: string; best: number; runs: number };
  bests: Record<string, number>; // best wave per mode
}

// ------------------------------------------------------------------ training

export interface TrainingDef {
  id: string;
  name: string;
  icon: string;
  desc: (lv: number) => string;
  max: number;
  base: number; // cost of level 1
}

export const TRAINING: TrainingDef[] = [
  { id: 'hp', name: 'Toughness', icon: '❤️', desc: (l) => `+${l * 10} max HP`, max: 10, base: 30 },
  { id: 'dmg', name: 'Firepower', icon: '💥', desc: (l) => `+${l * 5}% damage`, max: 10, base: 40 },
  { id: 'speed', name: 'Cardio', icon: '👟', desc: (l) => `+${l * 3}% move speed`, max: 5, base: 35 },
  { id: 'crit', name: 'Sharpshooter', icon: '🎯', desc: (l) => `+${l * 2}% crit chance`, max: 5, base: 45 },
  { id: 'greed', name: 'Scavenger', icon: '💰', desc: (l) => `+${l * 8}% cash from kills`, max: 5, base: 35 },
  { id: 'cash', name: 'Savings', icon: '💵', desc: (l) => `Start runs with $${l * 75}`, max: 5, base: 30 },
  { id: 'armor', name: 'Kevlar', icon: '🛡️', desc: (l) => `Take ${l * 3}% less damage`, max: 5, base: 50 },
  { id: 'nades', name: 'Demolitions', icon: '💣', desc: (l) => `+${l} grenade${l === 1 ? '' : 's'} per wave`, max: 3, base: 60 },
  { id: 'revive', name: 'Second Wind', icon: '✚', desc: (l) => (l ? 'Once per run, get back up when you die' : 'Get back up once per run when you die'), max: 1, base: 400 },
];

export const trainingCost = (t: TrainingDef, lv: number) => Math.round(t.base * Math.pow(1.5, lv));

// ------------------------------------------------------------------ guns

export const GUN_UNLOCK: Record<string, number> = { pistol: 0, smg: 120, shotgun: 200, rifle: 380, flamer: 600, rocket: 850, launcher: 950, sniper: 1050, freeze: 1150, minigun: 1200, tesla: 1400 };
export const MASTERY_MAX = 10;
export const masteryCost = (lv: number) => Math.round(40 * Math.pow(1.45, lv));

// ------------------------------------------------------------------ modes

export interface ModeDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  unlock: number;
  brains: number; // multiplier on brains earned
}

export const MODES: ModeDef[] = [
  { id: 'endless', name: 'Endless', icon: '♾️', desc: 'Survive as long as you can. A boss every 10 waves.', unlock: 1, brains: 1 },
  { id: 'daily', name: 'Daily Challenge', icon: '📅', desc: 'Same map and twists for everyone today. First run of the day pays +50 🧠.', unlock: 1, brains: 1 },
  { id: 'bossrush', name: 'Boss Rush', icon: '💀', desc: 'Every wave is a boss. Brains x1.5.', unlock: 3, brains: 1.5 },
  { id: 'hardcore', name: 'Hardcore', icon: '☠️', desc: 'No medkits, no health drops, no Second Wind. Brains x2.', unlock: 5, brains: 2 },
];

export interface MutatorDef {
  id: string;
  name: string;
  desc: string;
}

export const MUTATORS: MutatorDef[] = [
  { id: 'horde', name: 'Double Horde', desc: '50% more zombies every wave' },
  { id: 'glass', name: 'Glass Cannon', desc: 'Double damage, half health' },
  { id: 'boom', name: 'Everything Explodes', desc: 'Every zombie blows up when it dies' },
  { id: 'fast', name: 'Fast Zombies', desc: 'Zombies move 25% faster' },
  { id: 'rich', name: 'Gold Rush', desc: 'Double cash from kills' },
  { id: 'dark', name: 'Blackout', desc: 'Your flashlight is much shorter' },
  { id: 'elites', name: 'Elite Squad', desc: 'Elite zombies from wave 1' },
];

function hashDay(day: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Today's challenge: a map and two mutators, the same for everyone on this date. */
export function dailySetup(day = today()) {
  const map = MAPS[hashDay(day, 1) % MAPS.length].id;
  const a = hashDay(day, 2) % MUTATORS.length;
  let b = hashDay(day, 3) % MUTATORS.length;
  if (b === a) b = (b + 1) % MUTATORS.length;
  return { map, mutators: [MUTATORS[a].id, MUTATORS[b].id] };
}

// ------------------------------------------------------------------ levels

/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level: number) => 120 + 110 * (level - 1);

export interface LevelReward {
  level: number;
  text: string;
  perk?: string;
  slot?: boolean;
}

/** What each level unlocks. Levels not listed give bonus brains. */
export const LEVEL_REWARDS: LevelReward[] = [
  { level: 2, text: 'Ricochet perk unlocked', perk: 'ricochet' },
  { level: 3, text: 'Second loadout slot', slot: true },
  { level: 4, text: 'Shockwave perk unlocked', perk: 'nova' },
  { level: 5, text: 'Explosive Rounds perk unlocked', perk: 'explode' },
  { level: 6, text: 'Gun Drone perk unlocked', perk: 'drone' },
  { level: 8, text: 'Saw Blades perk unlocked', perk: 'blades' },
  { level: 10, text: 'Multishot perk unlocked', perk: 'multi' },
];
export const LOCKED_PERKS = new Map(LEVEL_REWARDS.filter((r) => r.perk).map((r) => [r.perk!, r.level]));

// ------------------------------------------------------------------ missions

export interface RunReport {
  wave: number;
  kills: number;
  killsByKind: Partial<Record<ZombieKind, number>>;
  killsByWeapon: Record<string, number>;
  bosses: number;
  elites: number;
  bestCombo: number;
  grenadeKills: number;
  brains: number; // collected during the run
}

export interface MissionDef {
  id: string;
  text: string;
  goal: number;
  reward: number;
  /** How much a run adds. `max` missions keep the best single run instead of summing. */
  measure: (r: RunReport) => number;
  max?: boolean;
}

const kindKills = (k: ZombieKind) => (r: RunReport) => r.killsByKind[k] ?? 0;
const gunKills = (g: string) => (r: RunReport) => r.killsByWeapon[g] ?? 0;

export const MISSIONS: MissionDef[] = [
  { id: 'crawlers', text: 'Kill 40 crawlers', goal: 40, reward: 50, measure: kindKills('crawler') },
  { id: 'dogs', text: 'Kill 60 dogs', goal: 60, reward: 50, measure: kindKills('dog') },
  { id: 'soldiers', text: 'Kill 15 armored soldiers', goal: 15, reward: 60, measure: kindKills('soldier') },
  { id: 'tesla', text: 'Kill 250 zombies holding the Tesla Gun', goal: 250, reward: 60, measure: gunKills('tesla') },
  { id: 'sniper', text: 'Kill 150 zombies holding the Sniper Rifle', goal: 150, reward: 55, measure: gunKills('sniper') },
  { id: 'kill500', text: 'Kill 500 zombies', goal: 500, reward: 40, measure: (r) => r.kills },
  { id: 'kill1500', text: 'Kill 1,500 zombies', goal: 1500, reward: 90, measure: (r) => r.kills },
  { id: 'runners', text: 'Kill 120 runners', goal: 120, reward: 40, measure: kindKills('runner') },
  { id: 'tanks', text: 'Kill 15 tanks', goal: 15, reward: 50, measure: kindKills('tank') },
  { id: 'bloaters', text: 'Pop 30 bloaters', goal: 30, reward: 45, measure: kindKills('bloater') },
  { id: 'shields', text: 'Kill 12 shield brutes', goal: 12, reward: 60, measure: kindKills('shield') },
  { id: 'leapers', text: 'Kill 25 leapers', goal: 25, reward: 55, measure: kindKills('leaper') },
  { id: 'screamers', text: 'Kill 15 screamers', goal: 15, reward: 55, measure: kindKills('screamer') },
  { id: 'necros', text: 'Kill 6 necromancers', goal: 6, reward: 70, measure: kindKills('necro') },
  { id: 'elites', text: 'Kill 10 elite zombies', goal: 10, reward: 80, measure: (r) => r.elites },
  { id: 'boss', text: 'Kill a boss', goal: 1, reward: 70, measure: (r) => r.bosses },
  { id: 'wave12', text: 'Reach wave 12 in one run', goal: 12, reward: 60, measure: (r) => r.wave, max: true },
  { id: 'wave20', text: 'Reach wave 20 in one run', goal: 20, reward: 120, measure: (r) => r.wave, max: true },
  { id: 'combo50', text: 'Chain a x50 combo', goal: 50, reward: 50, measure: (r) => r.bestCombo, max: true },
  { id: 'combo100', text: 'Chain a x100 combo', goal: 100, reward: 90, measure: (r) => r.bestCombo, max: true },
  { id: 'nades', text: 'Kill 60 zombies with grenades', goal: 60, reward: 45, measure: (r) => r.grenadeKills },
  { id: 'pistol', text: 'Kill 250 zombies holding the Pistol', goal: 250, reward: 45, measure: gunKills('pistol') },
  { id: 'shotgun', text: 'Kill 300 zombies holding the Shotgun', goal: 300, reward: 50, measure: gunKills('shotgun') },
  { id: 'flamer', text: 'Kill 300 zombies holding the Flamethrower', goal: 300, reward: 60, measure: gunKills('flamer') },
  { id: 'minigun', text: 'Kill 400 zombies holding the Minigun', goal: 400, reward: 60, measure: gunKills('minigun') },
];

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Deterministic pick of 3 missions per calendar day. */
function rollMissions(day: string): MissionState[] {
  let h = 2166136261;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const pool = [...MISSIONS];
  const out: MissionState[] = [];
  while (out.length < 3) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const m = pool.splice(h % pool.length, 1)[0];
    // Never two "kill N zombies" missions on the same day.
    if (out.some((o) => o.id.startsWith('kill')) && m.id.startsWith('kill')) continue;
    out.push({ id: m.id, progress: 0, done: false });
  }
  return out;
}

function fresh(): SaveData {
  let best = 0;
  try {
    best = Number(localStorage.getItem('horde-best') ?? 0) || 0;
  } catch {
    /* storage unavailable */
  }
  return {
    v: SAVE_VERSION,
    brains: 0,
    xp: 0,
    level: 1,
    best,
    unlocked: ['pistol'],
    mastery: {},
    training: {},
    loadout: ['pistol'],
    missionDay: '',
    missions: [],
    totals: { runs: 0, kills: 0, bosses: 0 },
    map: 'lot',
    mode: 'endless',
    daily: { day: '', best: 0, runs: 0 },
    bests: {},
  };
}

function sanitize(raw: unknown): SaveData {
  const d = fresh();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  const num = (v: unknown, f: number) => (typeof v === 'number' && isFinite(v) ? v : f);
  d.brains = Math.max(0, num(r.brains, 0));
  d.xp = Math.max(0, num(r.xp, 0));
  d.level = Math.max(1, Math.floor(num(r.level, 1)));
  d.best = Math.max(d.best, num(r.best, 0));
  const ids = new Set(WEAPONS.map((w) => w.id));
  if (Array.isArray(r.unlocked)) d.unlocked = Array.from(new Set(['pistol', ...r.unlocked.filter((x) => ids.has(x))]));
  if (r.mastery && typeof r.mastery === 'object') for (const [k, v] of Object.entries(r.mastery)) if (ids.has(k)) d.mastery[k] = Math.min(MASTERY_MAX, Math.max(0, num(v, 0)));
  if (r.training && typeof r.training === 'object')
    for (const t of TRAINING) d.training[t.id] = Math.min(t.max, Math.max(0, num((r.training as Record<string, unknown>)[t.id], 0)));
  if (Array.isArray(r.loadout)) d.loadout = r.loadout.filter((x) => d.unlocked.includes(x)).slice(0, 2);
  if (!d.loadout.length) d.loadout = ['pistol'];
  if (typeof r.missionDay === 'string') d.missionDay = r.missionDay;
  if (Array.isArray(r.missions)) d.missions = r.missions.filter((m) => m && MISSIONS.some((x) => x.id === m.id)).map((m) => ({ id: m.id, progress: num(m.progress, 0), done: !!m.done }));
  if (r.totals) d.totals = { runs: num(r.totals.runs, 0), kills: num(r.totals.kills, 0), bosses: num(r.totals.bosses, 0) };
  if (typeof r.map === 'string' && MAPS.some((m) => m.id === r.map)) d.map = r.map;
  if (typeof r.mode === 'string' && MODES.some((m) => m.id === r.mode)) d.mode = r.mode;
  if (r.daily && typeof r.daily.day === 'string') d.daily = { day: r.daily.day, best: num(r.daily.best, 0), runs: num(r.daily.runs, 0) };
  if (r.bests && typeof r.bests === 'object') for (const [k, v] of Object.entries(r.bests)) if (MODES.some((m) => m.id === k)) d.bests[k] = num(v, 0);
  d.bests.endless = Math.max(d.bests.endless ?? 0, d.best);
  return d;
}

export interface RunResult {
  xpGained: number;
  brainsGained: number;
  levelsGained: number[];
  rewards: string[];
  missionsDone: { text: string; reward: number }[];
  newBest: boolean;
}

class Meta {
  data: SaveData;

  constructor() {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    } catch {
      raw = null;
    }
    this.data = sanitize(raw);
    this.refreshMissions();
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      localStorage.setItem('horde-best', String(this.data.best));
    } catch {
      /* storage unavailable: progress lasts this session only */
    }
  }

  refreshMissions() {
    const day = today();
    if (this.data.missionDay !== day || this.data.missions.length !== 3) {
      this.data.missionDay = day;
      this.data.missions = rollMissions(day);
      this.save();
    }
  }

  train(id: string) {
    return this.data.training[id] ?? 0;
  }

  mastery(id: string) {
    return this.data.mastery[id] ?? 0;
  }

  slots() {
    return this.data.level >= 3 ? 2 : 1;
  }

  perkUnlocked(id: string) {
    const lv = LOCKED_PERKS.get(id);
    return lv === undefined || this.data.level >= lv;
  }

  spend(cost: number) {
    if (this.data.brains < cost) return false;
    this.data.brains -= cost;
    return true;
  }

  buyTraining(id: string) {
    const t = TRAINING.find((x) => x.id === id);
    if (!t) return false;
    const lv = this.train(id);
    if (lv >= t.max || !this.spend(trainingCost(t, lv))) return false;
    this.data.training[id] = lv + 1;
    this.save();
    return true;
  }

  unlockGun(id: string) {
    if (this.data.unlocked.includes(id) || !this.spend(GUN_UNLOCK[id] ?? 0)) return false;
    this.data.unlocked.push(id);
    if (this.data.loadout.length < this.slots()) this.data.loadout.push(id);
    this.save();
    return true;
  }

  upgradeGun(id: string) {
    const lv = this.mastery(id);
    if (!this.data.unlocked.includes(id) || lv >= MASTERY_MAX || !this.spend(masteryCost(lv))) return false;
    this.data.mastery[id] = lv + 1;
    this.save();
    return true;
  }

  /** Puts a gun in the loadout; with two slots full, it replaces the second one. */
  equip(id: string) {
    const lo = this.data.loadout;
    if (!this.data.unlocked.includes(id)) return;
    const i = lo.indexOf(id);
    if (i >= 0) {
      if (lo.length > 1) lo.splice(i, 1);
    } else if (lo.length < this.slots()) lo.push(id);
    else lo[lo.length - 1] = id;
    this.save();
  }

  finishRun(r: RunReport, mode = 'endless'): RunResult {
    const d = this.data;
    this.refreshMissions();
    const mdef = MODES.find((m) => m.id === mode) ?? MODES[0];
    const res: RunResult = { xpGained: 0, brainsGained: Math.round(r.brains * mdef.brains), levelsGained: [], rewards: [], missionsDone: [], newBest: false };
    d.totals.runs++;
    d.totals.kills += r.kills;
    d.totals.bosses += r.bosses;
    // The headline "best wave" is for normal runs; every mode also keeps its own best.
    if ((mode === 'endless' || mode === 'hardcore') && r.wave > d.best) d.best = r.wave;
    if (r.wave > (d.bests[mode] ?? 0)) {
      d.bests[mode] = r.wave;
      res.newBest = true;
    }
    if (mode === 'daily') {
      const day = today();
      if (d.daily.day !== day) d.daily = { day, best: 0, runs: 0 };
      if (d.daily.runs === 0) {
        res.brainsGained += 50;
        res.rewards.push('First daily run today: +50 🧠');
      }
      d.daily.runs++;
      d.daily.best = Math.max(d.daily.best, r.wave);
    }
    for (const m of d.missions) {
      if (m.done) continue;
      const def = MISSIONS.find((x) => x.id === m.id)!;
      const v = def.measure(r);
      m.progress = def.max ? Math.max(m.progress, v) : m.progress + v;
      if (m.progress >= def.goal) {
        m.progress = def.goal;
        m.done = true;
        res.brainsGained += def.reward;
        res.missionsDone.push({ text: def.text, reward: def.reward });
      }
    }
    res.xpGained = Math.round(r.kills + r.wave * 15 + r.bosses * 120 + r.elites * 10);
    d.xp += res.xpGained;
    while (d.xp >= xpToNext(d.level)) {
      d.xp -= xpToNext(d.level);
      d.level++;
      res.levelsGained.push(d.level);
      const rw = LEVEL_REWARDS.find((x) => x.level === d.level);
      if (rw) res.rewards.push(`Level ${d.level}: ${rw.text}`);
      else {
        const bonus = 25 + d.level * 5;
        res.brainsGained += bonus;
        res.rewards.push(`Level ${d.level}: +${bonus} 🧠`);
      }
    }
    d.brains += res.brainsGained;
    this.save();
    return res;
  }

  exportCode() {
    return btoa(unescape(encodeURIComponent(JSON.stringify(this.data))));
  }

  importCode(code: string) {
    try {
      const raw = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      if (!raw || typeof raw !== 'object' || (raw as SaveData).v !== SAVE_VERSION) return false;
      this.data = sanitize(raw);
      this.refreshMissions();
      this.save();
      return true;
    } catch {
      return false;
    }
  }
}

export const meta = new Meta();
