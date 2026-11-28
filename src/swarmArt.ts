/**
 * "Swarm" enemy sprites rendered in Blender (see art/swarm/ for the build script).
 *
 * Every enemy kind has one strip: 6 walk frames then 1 attack frame, rendered straight down
 * with the creature facing +x. A frame covers `span` R units (R = the enemy's radius), so it
 * fits any radius. Strips load lazily the first time a kind is needed; until a strip is ready
 * (or if the player picks the classic look) the game falls back to the painted zombies.
 *
 * Recoloured copies (hit flash, frozen, burning...), the three look variants (small hue
 * shifts) and the wounded look (cracks and ichor) are baked once per frame and cached, so
 * drawing a bug is always a single drawImage.
 */
import { SWARM_FRAMES, SWARM_META } from './swarmMeta';
import { Tint, TINTS } from './zombieArt';

const urls = import.meta.glob('./assets/swarm/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const SWARM_WALK = SWARM_FRAMES - 1;
const STORE = 'horde-enemystyle';

interface Strip {
  img: HTMLImageElement;
  ready: boolean;
  frames: (HTMLCanvasElement | null)[];
}

const strips = new Map<string, Strip>();
const cache = new Map<string, HTMLCanvasElement>();

let on = true;
try {
  on = localStorage.getItem(STORE) !== 'classic';
} catch {
  /* storage blocked: default to the swarm */
}

/** True when enemies should be drawn as the Blender bug swarm. */
export function swarmOn() {
  return on;
}

export function setSwarm(v: boolean) {
  on = v;
  try {
    localStorage.setItem(STORE, v ? 'swarm' : 'classic');
  } catch {
    /* storage blocked */
  }
  if (v) for (const k of Object.keys(SWARM_META)) loadSwarm(k);
}

export function hasSwarm(kind: string) {
  return !!SWARM_META[kind] && !!urls[`./assets/swarm/${kind}.webp`];
}

/** Starts loading a kind's strip (no-op if already loading or missing). */
export function loadSwarm(kind: string) {
  if (strips.has(kind) || typeof Image === 'undefined' || !hasSwarm(kind)) return;
  const img = new Image();
  const s: Strip = { img, ready: false, frames: Array(SWARM_FRAMES).fill(null) };
  img.onload = () => {
    s.ready = true;
  };
  img.src = urls[`./assets/swarm/${kind}.webp`];
  strips.set(kind, s);
}

function canvas(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}

function rawFrame(kind: string, f: number): HTMLCanvasElement | null {
  const s = strips.get(kind);
  if (!s || !s.ready) return null;
  let c = s.frames[f];
  if (c) return c;
  const cell = SWARM_META[kind][1];
  c = canvas(cell);
  c.getContext('2d')!.drawImage(s.img, f * cell, 0, cell, cell, 0, 0, cell, cell);
  s.frames[f] = c;
  return c;
}

// Three looks per kind: as rendered, a touch warmer, a touch cooler. All get a small lift so
// the bugs still read under the game's darkness pass.
const LIFT = 'brightness(1.14) saturate(1.15)';
const LOOKS = [LIFT, `${LIFT} hue-rotate(-16deg)`, 'brightness(1.06) saturate(1.1) hue-rotate(18deg)'];

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Cracked shell and drips of glowing ichor, only where the creature is. */
function wound(c: HTMLCanvasElement, kind: string, level: number) {
  const g = c.getContext('2d')!;
  const n = c.width;
  const span = SWARM_META[kind][0];
  const R = n / span; // px per R unit
  const r = rng(kind.length * 131 + level * 7 + kind.charCodeAt(0));
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.translate(n / 2, n / 2);
  const spots = level === 1 ? 3 : 6;
  for (let i = 0; i < spots; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * R * 0.6;
    const x = Math.cos(a) * d - R * 0.15;
    const y = Math.sin(a) * d;
    // Crack: a short dark zig-zag
    g.strokeStyle = 'rgba(20,10,24,0.75)';
    g.lineWidth = Math.max(1, R * 0.035);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y);
    let px = x;
    let py = y;
    for (let k = 0; k < 3; k++) {
      px += (r() - 0.5) * R * 0.3;
      py += (r() - 0.5) * R * 0.3;
      g.lineTo(px, py);
    }
    g.stroke();
    // Ichor bead
    const s = R * (0.06 + r() * 0.07);
    const grd = g.createRadialGradient(x - s * 0.3, y - s * 0.3, s * 0.1, x, y, s);
    grd.addColorStop(0, 'rgba(230,255,180,0.95)');
    grd.addColorStop(0.5, 'rgba(120,230,90,0.85)');
    grd.addColorStop(1, 'rgba(40,120,50,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, s, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/**
 * One drawable frame. f = 0..SWARM_WALK-1 walk, SWARM_WALK = attack. Returns null until the
 * strip is loaded (caller then draws the classic art).
 */
export function swarmFrame(kind: string, f: number, variant: number, tint: Tint, hurt = 0): HTMLCanvasElement | null {
  const v = SWARM_META[kind] && SWARM_META[kind][1] > 300 ? 0 : variant % LOOKS.length;
  const h = tint === Tint.None ? hurt : 0;
  const key = `${kind}|${f}|${v}|${tint}|${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: HTMLCanvasElement | null;
  if (tint !== Tint.None) {
    const base = swarmFrame(kind, f, v, Tint.None);
    if (!base) return null;
    const [color, alpha] = TINTS[tint];
    out = canvas(base.width);
    const g = out.getContext('2d')!;
    g.drawImage(base, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fillRect(0, 0, out.width, out.height);
  } else if (h > 0) {
    const base = swarmFrame(kind, f, v, Tint.None);
    if (!base) return null;
    out = canvas(base.width);
    out.getContext('2d')!.drawImage(base, 0, 0);
    wound(out, kind, h);
  } else {
    const base = rawFrame(kind, f);
    if (!base) return null;
    out = canvas(base.width);
    const g = out.getContext('2d')!;
    if ('filter' in g) g.filter = LOOKS[v];
    g.drawImage(base, 0, 0);
  }
  cache.set(key, out);
  return out;
}

/** The width of a frame in R units. */
export function swarmSpan(kind: string) {
  return SWARM_META[kind][0];
}

/** Walk frame for a zombie's stride phase (2π per stride). */
export function swarmWalk(phase: number) {
  const t = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
  return Math.floor(t * SWARM_WALK) % SWARM_WALK;
}

// Where each bug's eyes sit (forward, sideways) in R units, from the head placement in
// art/swarm/build_swarm.py, so the eye-glow pass lands on the rendered eyes.
const EYES: Record<string, [number, number]> = {
  walker: [0.63, 0.15], runner: [0.6, 0.13], tank: [0.88, 0.14], bloater: [0.75, 0.11], spitter: [0.7, 0.13],
  screamer: [0.55, 0.14], shield: [0.66, 0.14], leaper: [0.64, 0.14], necro: [0.57, 0.13], crawler: [0.62, 0.1],
  dog: [1.01, 0.14], soldier: [0.66, 0.14], electric: [0.61, 0.14], bomber: [0.63, 0.13], burrower: [0.55, 0.11],
  wraith: [0.52, 0.12], webber: [0.61, 0.11], medic: [0.6, 0.13], sludger: [0.78, 0.11], icer: [0.61, 0.14],
  roller: [0.84, 0.1], mimic: [0.54, 0.14], parasite: [0.6, 0.1], mutant: [0.65, 0.13], blob: [0.57, 0.18],
  psyker: [0.7, 0.13], boss: [0.74, 0.16], juggernaut: [1.0, 0.13], brood: [0.72, 0.12], reaper: [0.85, 0.13],
  sludge: [0.78, 0.11], titan: [0.7, 0.13], zero: [0.73, 0.13],
};

export function swarmEyeSpot(kind: string): [number, number] | null {
  return EYES[kind] ?? null;
}
