// High-detail zombie art.
//
// Every zombie body is painted once, in detail, onto an offscreen canvas and
// then stamped with drawImage each frame. That keeps phones smooth: a stamp
// costs about the same as one plain circle, while the painting itself can use
// gradients, mottled skin, torn clothes, wounds, bones and outlines.
//
// Only the parts that move (feet, arms, shields, scythes, sparks...) are drawn
// live in game.ts. Sprites are painted lazily the first time a kind, look
// variant and color tint is needed, and are kept for the rest of the session.
//
// Coordinates while painting are in "R units": 1 = the zombie's radius, +x is
// the way it faces, y runs across its shoulders.

import type { ZombieDef } from './data';

export interface Sprite {
  c: HTMLCanvasElement;
  /** Bounds in R units, so drawing at radius r is drawImage(c, x0*r, y0*r, w*r, h*r). */
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** Color states a zombie can flash into. */
export const Tint = { None: 0, Hit: 1, Icy: 2, Burn: 3, Windup: 4, Zap: 5 } as const;
export type Tint = (typeof Tint)[keyof typeof Tint];

const TINTS: Record<number, [string, number]> = {
  [Tint.Hit]: ['#ffffff', 0.85],
  [Tint.Icy]: ['#9fd8f0', 0.55],
  [Tint.Burn]: ['#1e0e04', 0.55],
  [Tint.Windup]: ['#ff3030', 0.6],
  [Tint.Zap]: ['#d8fbff', 0.65],
};

/** How many different looks each regular zombie kind comes in. */
export const VARIANTS = 3;

type Ctx = CanvasRenderingContext2D;
type Rng = () => number;

// ---------------------------------------------------------------------------
// Small helpers

function rng(seed: number): Rng {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash(str: string) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (ch) => ch + ch) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes two hex colors; t=0 gives a, t=1 gives b. Optional alpha. */
function mix(a: string, b: string, t: number, alpha = 1) {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return alpha < 1 ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : `rgb(${c[0]},${c[1]},${c[2]})`;
}
const lite = (c: string, t: number) => mix(c, '#ffffff', t);
const shade = (c: string, t: number) => mix(c, '#000000', t);

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** An organic, slightly lumpy closed shape. */
function blobPath(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, r: Rng, amt = 0.08, n = 22, rot = 0) {
  ctx.beginPath();
  const pts: [number, number][] = [];
  const off = r() * 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (Math.sin(a * 3 + off) * 0.5 + (r() - 0.5)) * amt;
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  // Smooth through the midpoints.
  const mid = (i: number) => {
    const p = pts[i % n];
    const q = pts[(i + 1) % n];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  };
  const m0 = mid(n - 1);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}

/** Fills the current path with a domed gradient (lit from above). */
function dome(ctx: Ctx, cx: number, cy: number, rad: number, base: string, hi = 0.28, lo = 0.45) {
  const g = ctx.createRadialGradient(cx - rad * 0.12, cy - rad * 0.1, rad * 0.05, cx, cy, rad * 1.05);
  g.addColorStop(0, lite(base, hi));
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, lo));
  ctx.fillStyle = g;
  ctx.fill();
}

/** Blotchy skin: dark rot patches, pale spots and veins, inside the current clip. */
function mottle(ctx: Ctx, r: Rng, cx: number, cy: number, rx: number, ry: number, base: string, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const x = cx + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d;
    const s = (0.05 + r() * 0.12) * Math.max(rx, ry);
    ctx.fillStyle = r() < 0.6 ? mix(base, '#2a1a10', 0.5, 0.18 + r() * 0.2) : mix(base, '#f0f0c0', 0.4, 0.12 + r() * 0.12);
    blobPath(ctx, x, y, s, s * (0.6 + r() * 0.5), r, 0.3, 9, r() * 3);
    ctx.fill();
  }
  // Dark veins
  ctx.strokeStyle = mix(base, '#200818', 0.6, 0.35);
  ctx.lineWidth = 0.022;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    let x = cx + (r() - 0.5) * rx * 1.4;
    let y = cy + (r() - 0.5) * ry * 1.4;
    let a = r() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      a += (r() - 0.5) * 1.4;
      x += Math.cos(a) * 0.09;
      y += Math.sin(a) * 0.09;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** A wet wound: dark crater, raw red flesh and a glossy highlight. */
function wound(ctx: Ctx, r: Rng, x: number, y: number, s: number) {
  ctx.fillStyle = 'rgba(70,0,6,0.55)';
  blobPath(ctx, x, y, s * 1.35, s * 1.1, r, 0.35, 12, r() * 3);
  ctx.fill();
  ctx.fillStyle = '#7a0d12';
  blobPath(ctx, x, y, s, s * 0.8, r, 0.3, 12, r() * 3);
  ctx.fill();
  ctx.fillStyle = '#b51e22';
  blobPath(ctx, x - s * 0.15, y - s * 0.1, s * 0.6, s * 0.45, r, 0.3, 10, r() * 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,190,180,0.55)';
  ctx.beginPath();
  ctx.ellipse(x - s * 0.3, y - s * 0.25, s * 0.2, s * 0.1, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Blood splatter: a main drop plus satellite droplets. */
function splat(ctx: Ctx, r: Rng, x: number, y: number, s: number, a = 0.6) {
  ctx.fillStyle = `rgba(110,8,12,${a})`;
  blobPath(ctx, x, y, s, s * 0.8, r, 0.5, 12, r() * 3);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const ang = r() * Math.PI * 2;
    const d = s * (1.2 + r() * 0.9);
    ctx.beginPath();
    ctx.arc(x + Math.cos(ang) * d, y + Math.sin(ang) * d, s * (0.1 + r() * 0.15), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Exposed ribs on a torn-open back. */
function ribs(ctx: Ctx, r: Rng, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#4a0a0e';
  blobPath(ctx, x, y, w, h, r, 0.25, 14);
  ctx.fill();
  ctx.fillStyle = '#8a1a1e';
  blobPath(ctx, x, y, w * 0.82, h * 0.85, r, 0.2, 14);
  ctx.fill();
  ctx.strokeStyle = '#e8dcc0';
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.05;
  // Spine down the middle (front-to-back runs along x)
  ctx.beginPath();
  ctx.moveTo(x - w * 0.9, y);
  ctx.lineTo(x + w * 0.9, y);
  ctx.stroke();
  ctx.lineWidth = 0.035;
  for (let i = -2; i <= 2; i++) {
    const rx = x + i * w * 0.3;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(rx, y);
      ctx.quadraticCurveTo(rx - w * 0.05, y + side * h * 0.5, rx - w * 0.22, y + side * h * 0.85);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * w * 0.3 - 0.02, y - 0.02, 0.04, 0.04);
}

/** Torn cloth over the torso, with folds, holes, stains and a ragged hem. */
function cloth(ctx: Ctx, r: Rng, color: string, cx: number, cy: number, rx: number, ry: number, holes = 3) {
  ctx.save();
  blobPath(ctx, cx, cy, rx, ry, r, 0.06);
  dome(ctx, cx, cy, Math.max(rx, ry), color, 0.22, 0.5);
  ctx.clip();
  // Folds
  ctx.strokeStyle = shade(color, 0.45);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.03;
  for (let i = 0; i < 6; i++) {
    const y = cy + (r() - 0.5) * ry * 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - rx, y);
    ctx.bezierCurveTo(cx - rx * 0.3, y + (r() - 0.5) * 0.3, cx + rx * 0.3, y + (r() - 0.5) * 0.3, cx + rx, y + (r() - 0.5) * 0.2);
    ctx.stroke();
  }
  ctx.strokeStyle = lite(color, 0.3);
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 0.018;
  for (let i = 0; i < 4; i++) {
    const y = cy + (r() - 0.5) * ry * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.8, y);
    ctx.quadraticCurveTo(cx, y + (r() - 0.5) * 0.25, cx + rx * 0.8, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Grime
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(30,20,10,${0.08 + r() * 0.14})`;
    blobPath(ctx, cx + (r() - 0.5) * rx * 1.6, cy + (r() - 0.5) * ry * 1.6, 0.08 + r() * 0.14, 0.06 + r() * 0.1, r, 0.4, 9);
    ctx.fill();
  }
  ctx.restore();
  // Holes torn through to the rotting skin beneath (painted after so they sit on top)
  for (let i = 0; i < holes; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.25 + r() * 0.55;
    const x = cx + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d;
    const s = 0.08 + r() * 0.09;
    ctx.fillStyle = shade(color, 0.6);
    blobPath(ctx, x, y, s * 1.25, s, r, 0.45, 10, r() * 3);
    ctx.fill();
    if (r() < 0.6) wound(ctx, r, x, y, s * 0.8);
    else {
      ctx.fillStyle = '#5a3a2a';
      blobPath(ctx, x, y, s * 0.9, s * 0.7, r, 0.45, 10, r() * 3);
      ctx.fill();
    }
  }
  splat(ctx, r, cx + (r() - 0.3) * rx, cy + (r() - 0.5) * ry, 0.1 + r() * 0.06, 0.55);
}

// ---------------------------------------------------------------------------
// Heads

interface HeadOpts {
  x: number;
  rad: number;
  skin: string;
  hair?: string | null;
  hairStyle?: 'patchy' | 'long' | 'mohawk' | 'buzz' | 'none';
  skull?: boolean; // exposed, cracked skull
  jaw?: 'teeth' | 'gape' | 'none';
  ears?: boolean;
  brow?: boolean;
}

function head(ctx: Ctx, r: Rng, o: HeadOpts) {
  const { x, rad, skin } = o;
  // Neck shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x - rad * 0.25, 0, rad * 1.05, rad * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();
  // Ears
  if (o.ears !== false) {
    for (const side of [-1, 1]) {
      ctx.fillStyle = shade(skin, 0.15);
      ctx.beginPath();
      ctx.ellipse(x - rad * 0.05, side * rad * 0.95, rad * 0.2, rad * 0.13, 0.2 * side, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(skin, 0.5);
      ctx.beginPath();
      ctx.ellipse(x - rad * 0.05, side * rad * 0.98, rad * 0.1, rad * 0.06, 0.2 * side, 0, Math.PI * 2);
      ctx.fill();
    }
    // One ear bitten off sometimes
    if (r() < 0.4) {
      const side = r() < 0.5 ? -1 : 1;
      wound(ctx, r, x - rad * 0.05, side * rad * 0.9, rad * 0.14);
    }
  }
  // Skull shape: a bit longer front-to-back
  ctx.save();
  blobPath(ctx, x, 0, rad * 1.08, rad, r, 0.05, 20);
  dome(ctx, x, 0, rad, skin, 0.32, 0.55);
  ctx.clip();
  mottle(ctx, r, x, 0, rad, rad, skin, 10);
  // Hair
  const hair = o.hair;
  const style = o.hairStyle ?? 'patchy';
  if (hair && style !== 'none') {
    ctx.strokeStyle = hair;
    ctx.lineCap = 'round';
    if (style === 'buzz') {
      ctx.fillStyle = mix(hair, skin, 0.25, 0.85);
      blobPath(ctx, x - rad * 0.2, 0, rad * 0.85, rad * 0.95, r, 0.06, 16);
      ctx.fill();
    } else if (style === 'mohawk') {
      ctx.fillStyle = hair;
      blobPath(ctx, x - rad * 0.1, 0, rad * 1.0, rad * 0.22, r, 0.15, 14);
      ctx.fill();
      ctx.strokeStyle = lite(hair, 0.35);
      ctx.lineWidth = 0.02;
      for (let i = 0; i < 9; i++) {
        const hx = x - rad * 0.9 + i * rad * 0.22;
        ctx.beginPath();
        ctx.moveTo(hx, -rad * 0.12);
        ctx.lineTo(hx - rad * 0.12, rad * 0.12);
        ctx.stroke();
      }
    } else {
      // A matted cap of hair over the back of the scalp, combed backwards,
      // with bald, rotting patches torn out of it.
      const long = style === 'long';
      ctx.save();
      blobPath(ctx, x - rad * (long ? 0.35 : 0.3), 0, rad * (long ? 1.05 : 0.85), rad * (long ? 1.08 : 1.0), r, 0.12, 18);
      const hg = ctx.createRadialGradient(x - rad * 0.2, -rad * 0.15, rad * 0.05, x - rad * 0.3, 0, rad * 1.1);
      hg.addColorStop(0, lite(hair, 0.25));
      hg.addColorStop(0.6, hair);
      hg.addColorStop(1, shade(hair, 0.5));
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.clip();
      ctx.lineWidth = 0.014;
      for (let i = 0; i < 40; i++) {
        const sy = (r() - 0.5) * rad * 2;
        const sx = x + rad * (0.3 - r() * 0.4);
        ctx.strokeStyle = r() < 0.5 ? lite(hair, 0.35) : shade(hair, 0.45);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx - rad * 0.5, sy * 1.15 + (r() - 0.5) * 0.06, sx - rad * (0.9 + r() * 0.4), sy * 1.25);
        ctx.stroke();
      }
      ctx.restore();
      if (style === 'patchy')
        for (let i = 0; i < 2; i++) {
          const px = x - rad * (0.1 + r() * 0.5);
          const py = (r() - 0.5) * rad * 1.1;
          ctx.fillStyle = shade(skin, 0.1);
          blobPath(ctx, px, py, rad * 0.22, rad * 0.16, r, 0.35, 10, r() * 3);
          ctx.fill();
        }
    }
  }
  // Exposed skull with cracks
  if (o.skull) {
    const sx = x - rad * (0.1 + r() * 0.3);
    const sy = (r() - 0.5) * rad * 0.8;
    ctx.fillStyle = '#5a0a0e';
    blobPath(ctx, sx, sy, rad * 0.42, rad * 0.34, r, 0.3, 12, r() * 3);
    ctx.fill();
    ctx.fillStyle = '#e4d8bc';
    blobPath(ctx, sx, sy, rad * 0.33, rad * 0.26, r, 0.25, 12, r() * 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(sx - rad * 0.08, sy - rad * 0.06, rad * 0.12, rad * 0.06, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6a5a40';
    ctx.lineWidth = 0.018;
    ctx.beginPath();
    ctx.moveTo(sx - rad * 0.25, sy);
    ctx.lineTo(sx - rad * 0.05, sy + rad * 0.05);
    ctx.lineTo(sx + rad * 0.05, sy - rad * 0.1);
    ctx.lineTo(sx + rad * 0.22, sy - rad * 0.04);
    ctx.stroke();
  }
  ctx.restore();
  // Brow ridge, cheek hollows and eye sockets at the front
  if (o.brow !== false) {
    ctx.fillStyle = shade(skin, 0.55);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + rad * 0.68, side * rad * 0.36, rad * 0.2, rad * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0a0606';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + rad * 0.74, side * rad * 0.36, rad * 0.12, rad * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = lite(skin, 0.2);
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(x + rad * 0.58, -rad * 0.55);
    ctx.quadraticCurveTo(x + rad * 0.7, 0, x + rad * 0.58, rad * 0.55);
    ctx.stroke();
    // Nose (rotted to a stub)
    ctx.fillStyle = shade(skin, 0.3);
    ctx.beginPath();
    ctx.ellipse(x + rad * 0.95, 0, rad * 0.13, rad * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0a08';
    ctx.fillRect(x + rad * 0.96, -rad * 0.05, rad * 0.06, rad * 0.035);
    ctx.fillRect(x + rad * 0.96, rad * 0.015, rad * 0.06, rad * 0.035);
  }
  if (o.jaw === 'teeth' || o.jaw === 'gape') {
    const gape = o.jaw === 'gape';
    ctx.fillStyle = '#1a0406';
    ctx.beginPath();
    ctx.ellipse(x + rad * 1.0, 0, rad * (gape ? 0.2 : 0.1), rad * (gape ? 0.38 : 0.3), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8dcb0';
    for (let i = -2; i <= 2; i++) {
      if (r() < 0.25) continue;
      ctx.fillRect(x + rad * 1.04, i * rad * 0.11 - rad * 0.035, rad * 0.08, rad * 0.07);
    }
  }
}

// ---------------------------------------------------------------------------
// Body painters. Each paints at the origin in R units.

interface Look {
  v: number;
  r: Rng;
  def: ZombieDef;
  skin: string;
  dark: string;
}

const CLOTHES = ['#4a5560', '#6a4a3a', '#3e4a3a', '#5a3a4a', '#6a6250', '#34405a'];
const HAIR = ['#2a1e14', '#4a3420', '#1a1a1a', '#6a5a3a', '#7a2a14'];

function humanoid(ctx: Ctx, L: Look, o: { torso?: [number, number]; clothes?: string | null; holes?: number; ribs?: boolean; head?: Partial<HeadOpts> } = {}) {
  const { r, v, skin } = L;
  const [rx, ry] = o.torso ?? [0.5, 0.95];
  // Shoulders and torso skin underneath everything
  ctx.save();
  blobPath(ctx, -0.12, 0, rx, ry, r, 0.06);
  dome(ctx, -0.12, 0, ry, skin, 0.25, 0.55);
  ctx.clip();
  mottle(ctx, r, -0.12, 0, rx, ry, skin, 12);
  ctx.restore();
  // Collar bones and shoulder blades
  ctx.strokeStyle = shade(skin, 0.4);
  ctx.lineWidth = 0.03;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0.05, side * 0.18);
    ctx.quadraticCurveTo(0.12, side * 0.5, -0.02, side * ry * 0.82);
    ctx.stroke();
  }
  const clothes = o.clothes === undefined ? mix(CLOTHES[(v + hash(L.def.kind)) % CLOTHES.length], L.dark, 0.2) : o.clothes;
  if (clothes) cloth(ctx, r, clothes, -0.16, 0, rx * 0.98, ry * 0.97, o.holes ?? 3);
  if (o.ribs ?? v === 1) ribs(ctx, r, -0.36, (r() - 0.5) * 0.3, 0.26, 0.26);
  // Bloody bite on the shoulder
  if (v === 2) wound(ctx, r, -0.05, (r() < 0.5 ? -1 : 1) * ry * 0.62, 0.12);
  const hairColor = HAIR[(v * 2 + hash(L.def.kind)) % HAIR.length];
  head(ctx, r, { x: 0.16, rad: 0.4, skin, hair: hairColor, skull: v === 0, jaw: 'teeth', ...o.head });
}

const shell = (ctx: Ctx, r: Rng, color: string, cx: number, cy: number, rx: number, ry: number, rot = 0) => {
  ctx.save();
  blobPath(ctx, cx, cy, rx, ry, r, 0.05, 18, rot);
  dome(ctx, cx, cy, Math.max(rx, ry), color, 0.4, 0.55);
  ctx.restore();
};

function bolts(ctx: Ctx, pts: [number, number][], s = 0.045) {
  for (const [x, y] of pts) {
    ctx.fillStyle = '#20242a';
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8c0c8';
    ctx.beginPath();
    ctx.arc(x - s * 0.25, y - s * 0.25, s * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function stitches(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, n = 6) {
  ctx.strokeStyle = '#2a1410';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 0.06;
  const ny = (dx / len) * 0.06;
  ctx.strokeStyle = '#d8c8a0';
  ctx.lineWidth = 0.022;
  for (let i = 0; i <= n; i++) {
    const x = x1 + (dx * i) / n;
    const y = y1 + (dy * i) / n;
    ctx.beginPath();
    ctx.moveTo(x - nx, y - ny);
    ctx.lineTo(x + nx, y + ny);
    ctx.stroke();
  }
}

function glowDot(ctx: Ctx, x: number, y: number, rad: number, color: string, a = 0.8) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, mix(color, '#ffffff', 0.5, a));
  g.addColorStop(0.35, mix(color, color, 0, a * 0.7));
  g.addColorStop(1, mix(color, color, 0, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fill();
}

const BODY: Record<string, (ctx: Ctx, L: Look) => void> = {
  walker: (ctx, L) => humanoid(ctx, L),
  runner: (ctx, L) =>
    humanoid(ctx, L, {
      torso: [0.5, 0.82],
      clothes: L.v === 1 ? null : mix(['#8a2a20', '#2a4a6a', '#5a5a5a'][L.v], L.dark, 0.25),
      holes: 2,
      ribs: L.v === 1,
      head: { hairStyle: L.v === 2 ? 'mohawk' : 'long', jaw: 'gape' },
    }),
  tank: (ctx, L) => {
    const { r, skin } = L;
    // Hulking, swollen muscle with metal braces bolted into the flesh.
    for (const side of [-1, 1]) {
      ctx.save();
      blobPath(ctx, -0.05, side * 0.6, 0.48, 0.42, r, 0.1);
      dome(ctx, -0.05, side * 0.6, 0.48, skin, 0.3, 0.55);
      ctx.clip();
      mottle(ctx, r, -0.05, side * 0.6, 0.45, 0.4, skin, 8);
      ctx.strokeStyle = shade(skin, 0.45);
      ctx.lineWidth = 0.025;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(-0.05, side * 0.6, 0.15 + i * 0.08, side * 0.3, side * 0.3 + Math.PI * 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }
    humanoid(ctx, L, { torso: [0.62, 0.86], clothes: null, ribs: false, head: { rad: 0.4, x: 0.3, hairStyle: 'none', skull: false, jaw: 'gape' } });
    stitches(ctx, -0.5, -0.4, 0.05, -0.2, 7);
    stitches(ctx, -0.55, 0.45, -0.1, 0.25, 6);
    // Steel straps over the shoulders
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#4a5258';
      ctx.save();
      ctx.translate(-0.15, side * 0.62);
      ctx.rotate(side * 0.25);
      ctx.fillRect(-0.4, -0.08, 0.7, 0.16);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-0.4, -0.08, 0.7, 0.04);
      bolts(ctx, [
        [-0.32, 0],
        [0, 0],
        [0.22, 0],
      ]);
      ctx.restore();
    }
    // Rusty collar
    ctx.strokeStyle = '#6a4a2a';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(0.18, 0, 0.42, Math.PI * 0.55, Math.PI * 1.45);
    ctx.stroke();
    bolts(ctx, [
      [-0.2, 0.15],
      [-0.2, -0.15],
    ]);
  },
  bloater: (ctx, L) => {
    const { r, skin } = L;
    // Huge tight gas belly, stretched skin, veins, weeping pustules.
    ctx.save();
    blobPath(ctx, -0.05, 0, 1.0, 0.98, r, 0.05, 26);
    const g = ctx.createRadialGradient(-0.2, -0.15, 0.05, -0.05, 0, 1.05);
    g.addColorStop(0, lite(skin, 0.45));
    g.addColorStop(0.5, skin);
    g.addColorStop(0.85, shade(skin, 0.35));
    g.addColorStop(1, shade(skin, 0.6));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    mottle(ctx, r, 0, 0, 0.9, 0.9, skin, 18);
    // Stretch marks
    ctx.strokeStyle = mix(skin, '#ffd0d0', 0.4, 0.5);
    ctx.lineWidth = 0.02;
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 0.55, Math.sin(a) * 0.55);
      ctx.lineTo(Math.cos(a + 0.05) * 0.85, Math.sin(a + 0.05) * 0.85);
      ctx.stroke();
    }
    // Purple veins spidering out
    ctx.strokeStyle = 'rgba(80,20,90,0.55)';
    ctx.lineWidth = 0.03;
    for (let i = 0; i < 7; i++) {
      let a = r() * Math.PI * 2;
      let d = 0.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
      for (let k = 0; k < 6; k++) {
        a += (r() - 0.5) * 0.6;
        d += 0.12;
        ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
      }
      ctx.stroke();
    }
    ctx.restore();
    // Pustules
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7 + r() * 0.4;
      const d = 0.3 + r() * 0.5;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      const s = 0.1 + r() * 0.09;
      ctx.fillStyle = shade(skin, 0.4);
      ctx.beginPath();
      ctx.arc(x + 0.02, y + 0.02, s * 1.15, 0, Math.PI * 2);
      ctx.fill();
      const pg = ctx.createRadialGradient(x - s * 0.3, y - s * 0.3, 0, x, y, s);
      pg.addColorStop(0, '#fbffb0');
      pg.addColorStop(0.5, '#d6f04a');
      pg.addColorStop(1, '#7a9a1a');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x - s * 0.35, y - s * 0.35, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    // Navel split open
    wound(ctx, r, -0.3, 0.05, 0.13);
    head(ctx, r, { x: 0.62, rad: 0.36, skin: shade(skin, 0.05), hair: null, hairStyle: 'none', jaw: 'teeth' });
  },
  spitter: (ctx, L) => {
    humanoid(ctx, L, { torso: [0.52, 0.84], head: { hairStyle: 'none', jaw: 'gape' } });
    const { r } = L;
    // Swollen glowing acid sac under the jaw, dribbling
    const g = ctx.createRadialGradient(0.68, 0, 0.02, 0.72, 0, 0.32);
    g.addColorStop(0, '#f4c8ff');
    g.addColorStop(0.45, '#b04aff');
    g.addColorStop(1, '#4a1a6a');
    ctx.fillStyle = g;
    blobPath(ctx, 0.72, 0, 0.3, 0.27, r, 0.1, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,10,80,0.7)';
    ctx.lineWidth = 0.02;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(0.72, 0);
      ctx.lineTo(0.72 + Math.cos(i * 1.25) * 0.26, Math.sin(i * 1.25) * 0.24);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(208,107,255,0.75)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(-0.2 + r() * 0.5, (r() - 0.5) * 1.1, 0.03 + r() * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  screamer: (ctx, L) =>
    humanoid(ctx, L, {
      torso: [0.5, 0.82],
      clothes: mix(['#d8d0c8', '#8a3a4a', '#3a3a4a'][L.v], L.dark, 0.2),
      ribs: false,
      head: { hairStyle: 'long', hair: ['#1a1a1a', '#e8e0d0', '#5a2a14'][L.v], skull: false, jaw: 'none' },
    }),
  shield: (ctx, L) => {
    const { r } = L;
    humanoid(ctx, L, { torso: [0.6, 0.94], clothes: '#2a3036', holes: 1, ribs: false, head: { hairStyle: 'none', skull: false, jaw: 'none', ears: false } });
    // Riot vest panels
    ctx.fillStyle = '#1e2328';
    ctx.beginPath();
    ctx.roundRect(-0.62, -0.62, 0.62, 1.24, 0.12);
    ctx.fill();
    ctx.strokeStyle = '#3a424a';
    ctx.lineWidth = 0.03;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.55 + i * 0.2, -0.55);
      ctx.lineTo(-0.55 + i * 0.2, 0.55);
      ctx.stroke();
    }
    ctx.fillStyle = '#c8c8b0';
    ctx.font = 'bold 0.16px sans-serif';
    ctx.save();
    ctx.translate(-0.32, 0);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POLICE', 0, 0);
    ctx.restore();
    splat(ctx, r, -0.2, 0.3, 0.1);
    // Riot helmet
    const g = ctx.createRadialGradient(0.1, -0.1, 0.02, 0.2, 0, 0.55);
    g.addColorStop(0, '#6a7a88');
    g.addColorStop(0.6, '#2a333c');
    g.addColorStop(1, '#14191e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0.2, 0, 0.5, 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,180,220,0.45)';
    ctx.beginPath();
    ctx.ellipse(0.52, 0, 0.18, 0.4, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.arc(0.2, 0, 0.36, Math.PI * 1.1, Math.PI * 1.5);
    ctx.stroke();
    // Crack across the helmet
    ctx.strokeStyle = '#0a0d10';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(-0.15, 0.2);
    ctx.lineTo(0.05, 0.05);
    ctx.lineTo(0.0, -0.1);
    ctx.lineTo(0.2, -0.25);
    ctx.stroke();
  },
  leaper: (ctx, L) => {
    const { r, skin } = L;
    humanoid(ctx, L, { torso: [0.6, 0.72], clothes: null, ribs: false, head: { hairStyle: 'none', jaw: 'gape', x: 0.32, rad: 0.4 } });
    // Hunched spine ridge with bony spurs
    ctx.fillStyle = shade(skin, 0.35);
    ctx.beginPath();
    ctx.ellipse(-0.25, 0, 0.5, 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const x = -0.65 + i * 0.15;
      ctx.fillStyle = '#e0d4b4';
      ctx.beginPath();
      ctx.moveTo(x - 0.05, -0.05);
      ctx.lineTo(x - 0.16, 0);
      ctx.lineTo(x - 0.05, 0.05);
      ctx.fill();
      ctx.fillStyle = '#8a7a5a';
      ctx.beginPath();
      ctx.arc(x, 0, 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    wound(ctx, r, -0.3, 0.4, 0.1);
    wound(ctx, r, -0.1, -0.45, 0.08);
  },
  necro: (ctx, L) => {
    const { r } = L;
    humanoid(ctx, L, { clothes: null, ribs: false, head: { hairStyle: 'none', skull: true, jaw: 'teeth' } });
    // Heavy hooded robe with runes stitched in
    const robe = '#24243a';
    ctx.save();
    blobPath(ctx, -0.15, 0, 0.72, 0.98, r, 0.07, 22);
    dome(ctx, -0.15, 0, 0.98, robe, 0.25, 0.6);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.035;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.9, -0.9 + i * 0.3);
      ctx.quadraticCurveTo(-0.3, -0.75 + i * 0.3, 0.4, -0.9 + i * 0.3);
      ctx.stroke();
    }
    ctx.restore();
    // Hood around a skull face
    ctx.fillStyle = '#16162a';
    ctx.beginPath();
    ctx.ellipse(0.12, 0, 0.56, 0.54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8d0b8';
    blobPath(ctx, 0.3, 0, 0.36, 0.32, r, 0.05, 14);
    ctx.fill();
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.ellipse(0.5, -0.13, 0.09, 0.08, 0, 0, Math.PI * 2);
    ctx.ellipse(0.5, 0.13, 0.09, 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16162a';
    ctx.beginPath();
    ctx.ellipse(0.0, 0, 0.32, 0.5, 0, Math.PI * 0.5, Math.PI * 1.5);
    ctx.fill();
    // Glowing runes on the back of the robe
    ctx.strokeStyle = '#5dffb0';
    ctx.lineWidth = 0.03;
    ctx.shadowColor = '#5dffb0';
    ctx.shadowBlur = 6;
    const rune = (x: number, y: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y - 0.1);
      ctx.lineTo(x - 0.06, y);
      ctx.lineTo(x + 0.06, y);
      ctx.lineTo(x, y + 0.1);
      ctx.moveTo(x - 0.08, y - 0.06);
      ctx.lineTo(x + 0.08, y + 0.06);
      ctx.stroke();
    };
    rune(-0.55, -0.35);
    rune(-0.6, 0.05);
    rune(-0.5, 0.42);
    ctx.shadowBlur = 0;
  },
  crawler: (ctx, L) => {
    const { r, skin } = L;
    // Legless torso dragging its guts behind it.
    ctx.strokeStyle = '#8a2a30';
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = 0.16 - i * 0.03;
      ctx.strokeStyle = ['#7a1a22', '#a83a3a', '#c86a6a'][i];
      ctx.beginPath();
      ctx.moveTo(-0.55, (i - 1) * 0.15);
      ctx.bezierCurveTo(-0.9, (i - 1) * 0.4 + 0.2, -1.1, (i - 1) * 0.1 - 0.3, -1.35, (i - 1) * 0.3);
      ctx.stroke();
    }
    splat(ctx, r, -1.0, 0.1, 0.18, 0.5);
    humanoid(ctx, L, { torso: [0.5, 0.82], ribs: true, head: { hairStyle: 'patchy', jaw: 'gape' } });
    // Ragged waist where the legs used to be
    ctx.fillStyle = '#5a0a10';
    blobPath(ctx, -0.6, 0, 0.14, 0.5, r, 0.35, 14);
    ctx.fill();
    ctx.fillStyle = '#e4d8bc';
    ctx.beginPath();
    ctx.ellipse(-0.62, 0, 0.06, 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    void skin;
  },
  dog: (ctx, L) => {
    const { r, skin, dark } = L;
    // Tail
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-1.2, 0);
    ctx.quadraticCurveTo(-1.6, 0.15, -1.85, -0.05);
    ctx.stroke();
    // Long lean body with ribs showing through mangy fur
    ctx.save();
    blobPath(ctx, -0.25, 0, 1.25, 0.6, r, 0.05, 24);
    dome(ctx, -0.25, 0, 1.0, skin, 0.25, 0.55);
    ctx.clip();
    ctx.strokeStyle = shade(skin, 0.35);
    ctx.lineWidth = 0.02;
    for (let i = 0; i < 70; i++) {
      const x = -1.4 + r() * 2.3;
      const y = (r() - 0.5) * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 0.12, y + (r() - 0.5) * 0.06);
      ctx.stroke();
    }
    ribs(ctx, r, -0.25, 0.22 * (L.v === 1 ? -1 : 1), 0.38, 0.2);
    mottle(ctx, r, -0.3, 0, 1.0, 0.5, skin, 8);
    // Darker saddle along the spine
    ctx.fillStyle = mix(dark, skin, 0.2, 0.6);
    blobPath(ctx, -0.4, 0, 0.9, 0.18, r, 0.15, 16);
    ctx.fill();
    ctx.restore();
    // Head with snout, ears and bared teeth
    ctx.save();
    blobPath(ctx, 0.95, 0, 0.42, 0.36, r, 0.05, 16);
    dome(ctx, 0.95, 0, 0.42, skin, 0.3, 0.55);
    ctx.restore();
    ctx.fillStyle = shade(skin, 0.15);
    blobPath(ctx, 1.35, 0, 0.28, 0.2, r, 0.05, 12);
    ctx.fill();
    ctx.fillStyle = '#1a0808';
    ctx.beginPath();
    ctx.ellipse(1.6, 0, 0.07, 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e0c0';
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) ctx.fillRect(1.25 + i * 0.1, side * 0.19 - 0.02, 0.06, 0.045);
    for (const side of [-1, 1]) {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(0.85, side * 0.2);
      ctx.lineTo(0.62, side * 0.5);
      ctx.lineTo(0.95, side * 0.38);
      ctx.fill();
    }
    ctx.fillStyle = '#0a0606';
    ctx.beginPath();
    ctx.ellipse(1.15, -0.17, 0.07, 0.06, 0, 0, Math.PI * 2);
    ctx.ellipse(1.15, 0.17, 0.07, 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    wound(ctx, r, -0.7, -0.25, 0.1);
    // Torn collar
    ctx.strokeStyle = '#8a2020';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(0.75, 0, 0.36, Math.PI * 0.6, Math.PI * 1.4);
    ctx.stroke();
    ctx.fillStyle = '#d8b84a';
    ctx.beginPath();
    ctx.arc(0.4, 0, 0.06, 0, Math.PI * 2);
    ctx.fill();
  },
  soldier: (ctx, L) => {
    const { r } = L;
    const camo = '#4a5638';
    humanoid(ctx, L, { torso: [0.6, 0.92], clothes: camo, holes: 2, ribs: false, head: { hairStyle: 'none', skull: false, jaw: 'none' } });
    // Camo blotches
    ctx.save();
    blobPath(ctx, -0.16, 0, 0.58, 0.9, r, 0.06);
    ctx.clip();
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = ['#2e3622', '#6a7448', '#3a2e1e'][i % 3];
      blobPath(ctx, -0.6 + r() * 0.9, (r() - 0.5) * 1.8, 0.1 + r() * 0.1, 0.06 + r() * 0.08, r, 0.4, 9, r() * 3);
      ctx.fill();
    }
    ctx.restore();
    // Webbing straps and pouches
    ctx.strokeStyle = '#2a2a1e';
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(-0.6, -0.55);
    ctx.lineTo(0.05, 0.6);
    ctx.stroke();
    for (const y of [-0.3, 0.3]) {
      ctx.fillStyle = '#3a3a28';
      ctx.fillRect(-0.7, y - 0.12, 0.22, 0.24);
      ctx.fillStyle = '#5a5a40';
      ctx.fillRect(-0.7, y - 0.12, 0.22, 0.06);
    }
    // Helmet with chin strap and a bullet dent
    const g = ctx.createRadialGradient(0.12, -0.1, 0.02, 0.2, 0, 0.55);
    g.addColorStop(0, '#7a8460');
    g.addColorStop(0.6, '#4a5236');
    g.addColorStop(1, '#262c1a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0.18, 0, 0.52, 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2e1e';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.ellipse(0.18, 0, 0.44, 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#1a1c12';
    ctx.beginPath();
    ctx.arc(0.05, 0.2, 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(0.05, -0.18, 0.18, 0.08, -0.6, 0, Math.PI * 2);
    ctx.fill();
  },
  electric: (ctx, L) => {
    const { r } = L;
    humanoid(ctx, L, { clothes: mix('#2a3a4a', L.dark, 0.3), holes: 3, ribs: false, head: { hairStyle: 'buzz', hair: '#0a1420', skull: true, jaw: 'teeth' } });
    // Glowing veins of current under the skin
    ctx.strokeStyle = '#a0f0ff';
    ctx.shadowColor = '#7ad8ff';
    ctx.shadowBlur = 5;
    ctx.lineWidth = 0.03;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      let x = -0.3 + (r() - 0.5) * 0.4;
      let y = (r() - 0.5) * 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (r() - 0.5) * 0.25;
        y += (r() - 0.5) * 0.25;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // Battery pack and coils on the back
    ctx.fillStyle = '#2a2e36';
    ctx.beginPath();
    ctx.roundRect(-0.85, -0.3, 0.38, 0.6, 0.06);
    ctx.fill();
    ctx.fillStyle = '#c8a040';
    for (let i = 0; i < 5; i++) ctx.fillRect(-0.82 + i * 0.065, -0.36, 0.035, 0.72);
    ctx.fillStyle = '#e0e8f0';
    ctx.beginPath();
    ctx.arc(-0.66, 0, 0.09, 0, Math.PI * 2);
    ctx.fill();
    glowDot(ctx, -0.66, 0, 0.22, '#a0f0ff', 0.9);
  },
  bomber: (ctx, L) => {
    const { r } = L;
    humanoid(ctx, L, { torso: [0.56, 0.88], holes: 2, head: { hairStyle: 'patchy' } });
    // Dynamite vest: red sticks, tape, wires and a detonator box
    for (let i = -3; i <= 3; i++) {
      const y = i * 0.2;
      const g = ctx.createLinearGradient(0, y - 0.08, 0, y + 0.08);
      g.addColorStop(0, '#ff6a50');
      g.addColorStop(0.5, '#c0301a');
      g.addColorStop(1, '#6a1008');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(-0.62, y - 0.08, 0.5, 0.16, 0.06);
      ctx.fill();
      ctx.fillStyle = '#e8d8a0';
      ctx.fillRect(-0.6, y - 0.02, 0.06, 0.04);
    }
    ctx.fillStyle = '#5a5a50';
    ctx.fillRect(-0.48, -0.66, 0.1, 1.32);
    ctx.fillRect(-0.3, -0.66, 0.1, 1.32);
    ctx.strokeStyle = '#d02020';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(-0.4, -0.5);
    ctx.bezierCurveTo(-0.1, -0.4, -0.2, 0.1, 0.0, 0.05);
    ctx.stroke();
    ctx.strokeStyle = '#2060e0';
    ctx.beginPath();
    ctx.moveTo(-0.4, 0.5);
    ctx.bezierCurveTo(-0.1, 0.4, -0.2, -0.1, 0.0, -0.05);
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.roundRect(-0.12, -0.14, 0.24, 0.28, 0.04);
    ctx.fill();
    void r;
  },
  burrower: (ctx, L) => {
    const { r, skin } = L;
    // Digging claws out front
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const base = side * (0.2 + k * 0.16);
        ctx.fillStyle = shade('#c8b89a', k * 0.12);
        ctx.beginPath();
        ctx.moveTo(0.75, base - 0.07);
        ctx.quadraticCurveTo(1.35, base + side * 0.1, 1.75, base + side * 0.25);
        ctx.quadraticCurveTo(1.3, base + side * 0.02, 0.75, base + 0.07);
        ctx.fill();
      }
    }
    humanoid(ctx, L, { torso: [0.6, 0.86], clothes: null, ribs: false, head: { hairStyle: 'none', jaw: 'gape' } });
    // Armored, plated back covered in dirt
    ctx.save();
    blobPath(ctx, -0.3, 0, 0.62, 0.82, r, 0.08);
    dome(ctx, -0.3, 0, 0.8, '#5a4632', 0.35, 0.55);
    ctx.clip();
    ctx.strokeStyle = '#2a1e12';
    ctx.lineWidth = 0.04;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0.25, 0, 0.45 + i * 0.2, Math.PI * 0.6, Math.PI * 1.4);
      ctx.stroke();
    }
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = ['#3a2a1a', '#7a6248', '#4a3a26'][i % 3];
      ctx.beginPath();
      ctx.arc(-0.3 + (r() - 0.5) * 1.0, (r() - 0.5) * 1.4, 0.03 + r() * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    void skin;
  },
  wraith: (ctx, L) => {
    const { r } = L;
    // Gaunt, translucent spirit body with a glowing core.
    ctx.globalAlpha = 0.9;
    humanoid(ctx, L, { torso: [0.5, 0.8], clothes: '#9ab0c0', holes: 4, ribs: true, head: { hairStyle: 'long', hair: '#d8e4ec', skull: true, jaw: 'gape' } });
    ctx.globalAlpha = 1;
    glowDot(ctx, -0.2, 0, 0.5, '#7affea', 0.5);
    ctx.strokeStyle = 'rgba(200,255,250,0.5)';
    ctx.lineWidth = 0.02;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.2, 0);
      ctx.lineTo(-0.2 + Math.cos(i * 1.3 + r()) * 0.5, Math.sin(i * 1.3 + r()) * 0.6);
      ctx.stroke();
    }
  },
  webber: (ctx, L) => {
    const { r, skin } = L;
    humanoid(ctx, L, { torso: [0.55, 0.82], clothes: null, ribs: false, head: { hairStyle: 'none', jaw: 'gape' } });
    // Bulbous abdomen and a silk egg sac on its back
    ctx.save();
    blobPath(ctx, -0.6, 0, 0.6, 0.5, r, 0.06);
    dome(ctx, -0.6, 0, 0.6, shade(skin, 0.3), 0.3, 0.55);
    ctx.clip();
    ctx.fillStyle = '#8a1a1a';
    ctx.beginPath();
    ctx.moveTo(-0.6, -0.2);
    ctx.lineTo(-0.48, 0);
    ctx.lineTo(-0.6, 0.2);
    ctx.lineTo(-0.72, 0);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#e8e8f0';
    blobPath(ctx, -0.95, 0, 0.42, 0.34, r, 0.1, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,160,190,0.8)';
    ctx.lineWidth = 0.015;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.moveTo(-1.35, (r() - 0.5) * 0.6);
      ctx.quadraticCurveTo(-0.95, (r() - 0.5) * 0.8, -0.55, (r() - 0.5) * 0.6);
      ctx.stroke();
    }
    // Extra eyes clustered on the forehead
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#0a0a14';
      ctx.beginPath();
      ctx.arc(0.42 + (i % 2) * 0.1, (i < 2 ? -1 : 1) * (0.08 + (i % 2) * 0.08), 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(224,224,255,0.8)';
      ctx.beginPath();
      ctx.arc(0.41 + (i % 2) * 0.1, (i < 2 ? -1 : 1) * (0.08 + (i % 2) * 0.08) - 0.015, 0.015, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fangs
    ctx.fillStyle = '#20202a';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0.62, side * 0.12);
      ctx.quadraticCurveTo(0.85, side * 0.16, 0.9, side * 0.04);
      ctx.lineTo(0.65, side * 0.05);
      ctx.fill();
    }
  },
  medic: (ctx, L) => {
    const { r } = L;
    humanoid(ctx, L, { torso: [0.58, 0.9], clothes: '#e8e8de', holes: 3, ribs: false, head: { hairStyle: L.v === 1 ? 'buzz' : 'patchy', jaw: 'none' } });
    // Blood all down the lab coat
    for (let i = 0; i < 4; i++) splat(ctx, r, -0.6 + r() * 0.6, (r() - 0.5) * 1.3, 0.07 + r() * 0.06, 0.65);
    // Red cross on the back
    ctx.fillStyle = '#e02a2a';
    ctx.fillRect(-0.62, -0.13, 0.5, 0.26);
    ctx.fillRect(-0.5, -0.25, 0.26, 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(-0.62, -0.13, 0.5, 0.06);
    // Surgical mask and head mirror
    ctx.fillStyle = '#9ad0c8';
    ctx.beginPath();
    ctx.ellipse(0.55, 0, 0.18, 0.36, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = '#d8e8e4';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(0.55, -0.36);
    ctx.lineTo(0.2, -0.45);
    ctx.moveTo(0.55, 0.36);
    ctx.lineTo(0.2, 0.45);
    ctx.stroke();
    // Stethoscope
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(0.0, -0.4);
    ctx.quadraticCurveTo(-0.3, 0, 0.0, 0.4);
    ctx.stroke();
    ctx.fillStyle = '#b8c0c8';
    ctx.beginPath();
    ctx.arc(-0.12, 0.05, 0.06, 0, Math.PI * 2);
    ctx.fill();
  },
  sludger: (ctx, L) => {
    const { r } = L;
    humanoid(ctx, L, { torso: [0.62, 0.94], clothes: mix('#4a5a2a', L.dark, 0.3), holes: 2, ribs: false, head: { hairStyle: 'none', jaw: 'gape' } });
    sludgeCoat(ctx, r, 0.95, 12);
  },
  // Bosses
  boss: (ctx, L) => {
    const { r, skin } = L;
    // The Abomination: stitched-together mass with extra heads and spines.
    ctx.save();
    blobPath(ctx, -0.05, 0, 1.0, 1.0, r, 0.1, 30);
    dome(ctx, -0.05, 0, 1.0, skin, 0.3, 0.6);
    ctx.clip();
    mottle(ctx, r, 0, 0, 0.95, 0.95, skin, 30);
    // Different patches of skin sewn together
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = mix(skin, ['#c89a8a', '#6a8a5a', '#8a6a9a', '#a07050', '#5a5a7a'][i], 0.45, 0.8);
      blobPath(ctx, (r() - 0.6) * 1.2, (r() - 0.5) * 1.4, 0.25 + r() * 0.15, 0.2 + r() * 0.12, r, 0.3, 12, r() * 3);
      ctx.fill();
    }
    ctx.restore();
    stitches(ctx, -0.7, -0.5, 0.2, -0.6, 10);
    stitches(ctx, -0.8, 0.3, 0.1, 0.65, 10);
    stitches(ctx, -0.3, -0.2, -0.4, 0.5, 8);
    ribs(ctx, r, -0.45, -0.1, 0.3, 0.28);
    wound(ctx, r, 0.1, 0.4, 0.12);
    wound(ctx, r, -0.6, 0.55, 0.1);
    // Extra heads growing out of the shoulders
    head(ctx, r, { x: -0.1, rad: 0.18, skin: lite(skin, 0.1), hair: '#2a1a14', hairStyle: 'patchy', jaw: 'gape' });
    ctx.save();
    ctx.translate(0.0, -0.62);
    ctx.rotate(-0.7);
    head(ctx, r, { x: 0, rad: 0.2, skin: shade(skin, 0.05), hair: null, hairStyle: 'none', jaw: 'gape' });
    ctx.restore();
    ctx.save();
    ctx.translate(0.0, 0.62);
    ctx.rotate(0.7);
    head(ctx, r, { x: 0, rad: 0.2, skin: shade(skin, 0.05), hair: null, hairStyle: 'none', skull: true, jaw: 'teeth' });
    ctx.restore();
    head(ctx, r, { x: 0.45, rad: 0.36, skin, hair: null, hairStyle: 'none', skull: true, jaw: 'gape' });
    // Bone spines along the back
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.6 + (i / 6) * Math.PI * 0.8;
      const g = ctx.createLinearGradient(Math.cos(a) * 0.85, Math.sin(a) * 0.85, Math.cos(a) * 1.4, Math.sin(a) * 1.4);
      g.addColorStop(0, '#5a2a4a');
      g.addColorStop(1, '#f0e4c8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.13) * 0.9, Math.sin(a - 0.13) * 0.9);
      ctx.lineTo(Math.cos(a) * 1.42, Math.sin(a) * 1.42);
      ctx.lineTo(Math.cos(a + 0.13) * 0.9, Math.sin(a + 0.13) * 0.9);
      ctx.fill();
    }
  },
  juggernaut: (ctx, L) => {
    const { r, skin } = L;
    humanoid(ctx, L, { torso: [0.75, 0.98], clothes: null, ribs: false, head: { hairStyle: 'none', rad: 0.38, x: 0.25, skull: false, jaw: 'none', ears: false } });
    // Full plate armour: layered segments with rivets and scratches
    const plate = (x: number, y: number, w: number, h: number, rot: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      g.addColorStop(0, '#b8c0c8');
      g.addColorStop(0.45, '#6a727a');
      g.addColorStop(1, '#2a2e34');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 0.06);
      ctx.fill();
      ctx.strokeStyle = '#1a1c20';
      ctx.lineWidth = 0.025;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.012;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const sx = (r() - 0.5) * w;
        const sy = (r() - 0.5) * h;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (r() - 0.5) * 0.2, sy + (r() - 0.5) * 0.2);
        ctx.stroke();
      }
      bolts(
        ctx,
        [
          [-w / 2 + 0.06, -h / 2 + 0.06],
          [w / 2 - 0.06, -h / 2 + 0.06],
          [-w / 2 + 0.06, h / 2 - 0.06],
          [w / 2 - 0.06, h / 2 - 0.06],
        ],
        0.03,
      );
      ctx.restore();
    };
    for (const side of [-1, 1]) {
      plate(-0.1, side * 0.62, 0.62, 0.36, side * 0.15);
      plate(-0.42, side * 0.3, 0.36, 0.3, side * 0.1);
    }
    // Front breastplate arc
    ctx.beginPath();
    ctx.arc(0, 0, 1.05, -1.1, 1.1);
    ctx.arc(0, 0, 0.7, 1.1, -1.1, true);
    const g = ctx.createRadialGradient(0.5, -0.3, 0.1, 0.6, 0, 1.1);
    g.addColorStop(0, '#d8e0e8');
    g.addColorStop(0.5, '#7a828a');
    g.addColorStop(1, '#3a3e44');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#1a1c20';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    bolts(
      ctx,
      [-0.8, -0.4, 0, 0.4, 0.8].map((a) => [Math.cos(a) * 0.88, Math.sin(a) * 0.88] as [number, number]),
      0.035,
    );
    // Visor helm
    const hg = ctx.createRadialGradient(0.15, -0.1, 0.02, 0.25, 0, 0.45);
    hg.addColorStop(0, '#c8d0d8');
    hg.addColorStop(0.6, '#5a6068');
    hg.addColorStop(1, '#22262a');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(0.25, 0, 0.42, 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0.5, -0.24, 0.08, 0.48);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = '#3a3e44';
      ctx.fillRect(0.5, -0.22 + i * 0.1, 0.08, 0.025);
    }
    // Weak spot: exposed pulsing flesh on the back (glow is added live)
    ctx.fillStyle = '#5a1a0a';
    blobPath(ctx, -0.62, 0, 0.3, 0.3, r, 0.2, 14);
    ctx.fill();
    ctx.fillStyle = shade(skin, 0.2);
    void skin;
  },
  brood: (ctx, L) => {
    const { r, skin, dark } = L;
    // Insect-like mother: segmented abdomen, chitin plates, mandibles.
    ctx.save();
    blobPath(ctx, -0.45, 0, 0.75, 0.82, r, 0.06, 24);
    dome(ctx, -0.45, 0, 0.82, shade(skin, 0.15), 0.3, 0.6);
    ctx.clip();
    ctx.strokeStyle = shade(dark, 0.3);
    ctx.lineWidth = 0.04;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(0.1, 0, 0.25 + i * 0.16, Math.PI * 0.55, Math.PI * 1.45);
      ctx.stroke();
    }
    mottle(ctx, r, -0.45, 0, 0.7, 0.7, skin, 12);
    ctx.restore();
    // Egg sacs on her back, translucent with shapes inside
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 0.65 + (i / 5) * Math.PI * 0.7;
      const x = Math.cos(a) * 0.72;
      const y = Math.sin(a) * 0.72;
      const s = 0.22 + r() * 0.05;
      const g = ctx.createRadialGradient(x - s * 0.3, y - s * 0.3, 0, x, y, s);
      g.addColorStop(0, '#fff8d8');
      g.addColorStop(0.6, '#e8d8a0');
      g.addColorStop(1, '#8a7a4a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,30,20,0.45)';
      ctx.beginPath();
      ctx.ellipse(x + s * 0.1, y, s * 0.45, s * 0.3, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,40,40,0.5)';
      ctx.lineWidth = 0.015;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.8, y);
      ctx.quadraticCurveTo(x, y - s * 0.6, x + s * 0.8, y);
      ctx.stroke();
    }
    // Thorax and head
    shell(ctx, r, skin, 0.15, 0, 0.5, 0.58);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(-0.3, 0);
    ctx.lineTo(0.6, 0);
    ctx.stroke();
    shell(ctx, r, lite(skin, 0.05), 0.65, 0, 0.32, 0.36);
    // Compound eyes
    for (const side of [-1, 1]) {
      const g = ctx.createRadialGradient(0.78, side * 0.2, 0, 0.78, side * 0.2, 0.12);
      g.addColorStop(0, '#fff8a0');
      g.addColorStop(0.5, '#c8a020');
      g.addColorStop(1, '#3a2a08');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0.78, side * 0.2, 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mandibles
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#2a1608';
      ctx.beginPath();
      ctx.moveTo(0.85, side * 0.15);
      ctx.quadraticCurveTo(1.35, side * 0.45, 1.4, side * 0.08);
      ctx.quadraticCurveTo(1.2, side * 0.25, 0.9, side * 0.05);
      ctx.fill();
    }
  },
  reaper: (ctx, L) => {
    const { r } = L;
    // Black robe, bone hands live, skull in a deep hood.
    const robe = '#1c1c28';
    ctx.save();
    blobPath(ctx, -0.12, 0, 0.9, 0.98, r, 0.08, 26);
    dome(ctx, -0.12, 0, 1.0, robe, 0.22, 0.6);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.04;
    for (let i = 0; i < 9; i++) {
      const y = -0.95 + i * 0.24;
      ctx.beginPath();
      ctx.moveTo(-1.0, y);
      ctx.quadraticCurveTo(-0.4, y + 0.12, 0.4, y - 0.05);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(122,255,234,0.18)';
    ctx.lineWidth = 0.02;
    for (let i = 0; i < 6; i++) {
      const y = -0.9 + i * 0.36;
      ctx.beginPath();
      ctx.moveTo(-0.95, y);
      ctx.quadraticCurveTo(-0.5, y + 0.1, 0.1, y);
      ctx.stroke();
    }
    ctx.restore();
    // Hood
    ctx.fillStyle = '#0c0c14';
    ctx.beginPath();
    ctx.ellipse(0.15, 0, 0.52, 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#26263a';
    ctx.beginPath();
    ctx.ellipse(0.0, 0, 0.42, 0.5, 0, Math.PI * 0.5, Math.PI * 1.5);
    ctx.fill();
    // Skull peering out
    ctx.fillStyle = '#d8d4c4';
    blobPath(ctx, 0.36, 0, 0.27, 0.25, r, 0.04, 14);
    ctx.fill();
    ctx.fillStyle = '#0a0a10';
    ctx.beginPath();
    ctx.ellipse(0.5, -0.1, 0.07, 0.065, 0, 0, Math.PI * 2);
    ctx.ellipse(0.5, 0.1, 0.07, 0.065, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e4d4';
    for (let i = -2; i <= 2; i++) ctx.fillRect(0.6, i * 0.045 - 0.015, 0.04, 0.03);
    // Bone chain over the shoulders
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.6 + (i / 8) * Math.PI * 0.8;
      ctx.fillStyle = i % 2 ? '#c8c0a8' : '#8a8270';
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.06, 0.04, a, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  sludge: (ctx, L) => {
    const { r, skin } = L;
    // The Sludge King: a hulking mound of toxic waste in a crown of pipes.
    ctx.save();
    blobPath(ctx, -0.05, 0, 1.0, 1.0, r, 0.12, 30);
    dome(ctx, -0.05, 0, 1.0, skin, 0.3, 0.6);
    ctx.clip();
    mottle(ctx, r, 0, 0, 0.9, 0.9, skin, 20);
    ctx.restore();
    sludgeCoat(ctx, r, 1.0, 18);
    // Embedded junk: barrel lid, tire, warning sign
    ctx.fillStyle = '#d0a020';
    ctx.beginPath();
    ctx.arc(-0.45, -0.4, 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.45, -0.4);
      ctx.arc(-0.45, -0.4, 0.14, i * 2.09, i * 2.09 + 1.05);
      ctx.fill();
    }
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(-0.5, 0.45, 0.17, 0, Math.PI * 2);
    ctx.stroke();
    head(ctx, r, { x: 0.42, rad: 0.36, skin: lite(skin, 0.05), hair: null, hairStyle: 'none', jaw: 'gape' });
    sludgeCoat(ctx, r, 0.5, 6);
    // Crown of rusty pipes
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (i - 2) * 0.42;
      ctx.save();
      ctx.translate(Math.cos(a) * 0.55, Math.sin(a) * 0.55);
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, -0.1, 0, 0.1);
      g.addColorStop(0, '#c88a4a');
      g.addColorStop(0.5, '#8a5a2a');
      g.addColorStop(1, '#4a2a10');
      ctx.fillStyle = g;
      ctx.fillRect(-0.12, -0.1, 0.42, 0.2);
      ctx.fillStyle = '#c8a020';
      ctx.fillRect(0.24, -0.13, 0.08, 0.26);
      ctx.fillStyle = '#1a1a10';
      ctx.beginPath();
      ctx.ellipse(0.32, 0, 0.02, 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
};

function sludgeCoat(ctx: Ctx, r: Rng, rad: number, n: number) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = (0.3 + r() * 0.6) * rad;
    const x = Math.cos(a) * d - 0.1;
    const y = Math.sin(a) * d;
    const s = (0.1 + r() * 0.12) * Math.max(0.6, rad);
    const g = ctx.createRadialGradient(x - s * 0.3, y - s * 0.3, 0, x, y, s);
    g.addColorStop(0, '#e8ff7a');
    g.addColorStop(0.4, '#9ac030');
    g.addColorStop(1, '#3a5a10');
    ctx.fillStyle = g;
    blobPath(ctx, x, y, s, s * 0.85, r, 0.25, 12, r() * 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,220,0.6)';
    ctx.beginPath();
    ctx.arc(x - s * 0.35, y - s * 0.35, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Arms (painted along +x from the shoulder at 0,0; length ~1.25)

export type ArmStyle = 'human' | 'big' | 'bone' | 'claw' | 'sludge' | 'none';

export function armStyle(kind: string): ArmStyle {
  switch (kind) {
    case 'bloater':
    case 'dog':
    case 'brood':
    case 'egg':
      return 'none';
    case 'tank':
    case 'boss':
    case 'juggernaut':
      return 'big';
    case 'reaper':
    case 'necro':
      return 'bone';
    case 'leaper':
    case 'burrower':
    case 'webber':
      return 'claw';
    case 'sludger':
    case 'sludge':
      return 'sludge';
    default:
      return 'human';
  }
}

/** Whether a kind shuffles on two visible feet. */
export function hasFeet(kind: string) {
  return !['bloater', 'dog', 'crawler', 'wraith', 'reaper', 'brood', 'sludge', 'egg', 'webber'].includes(kind);
}

function paintArm(ctx: Ctx, def: ZombieDef, style: ArmStyle, r: Rng) {
  const skin = def.body;
  const sleeve = style === 'bone' ? (def.kind === 'necro' ? '#24243a' : '#1c1c28') : def.kind === 'medic' ? '#e8e8de' : def.kind === 'soldier' ? '#4a5638' : def.kind === 'shield' ? '#2a3036' : style === 'human' ? mix(CLOTHES[hash(def.kind) % CLOTHES.length], def.dark, 0.35) : null;
  const thick = style === 'big' ? 0.22 : 0.15;
  // Sleeve / upper arm
  if (sleeve) {
    const g = ctx.createLinearGradient(0, -thick, 0, thick);
    g.addColorStop(0, lite(sleeve, 0.2));
    g.addColorStop(0.5, sleeve);
    g.addColorStop(1, shade(sleeve, 0.5));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-0.05, -thick * 1.15);
    ctx.lineTo(0.5, -thick * 1.05);
    // Ragged cuff
    for (let i = 0; i <= 4; i++) ctx.lineTo(0.5 + (i % 2) * 0.07 + r() * 0.03, -thick * 1.05 + (i / 4) * thick * 2.1);
    ctx.lineTo(-0.05, thick * 1.15);
    ctx.closePath();
    ctx.fill();
  }
  if (style === 'bone') {
    // Skeletal forearm and long finger bones
    ctx.strokeStyle = '#d8d0b8';
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(0.45, -0.04);
    ctx.lineTo(1.0, -0.03);
    ctx.moveTo(0.45, 0.05);
    ctx.lineTo(1.0, 0.04);
    ctx.stroke();
    ctx.fillStyle = '#e8e0c8';
    ctx.beginPath();
    ctx.arc(1.02, 0, 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.035;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(1.05, i * 0.03);
      ctx.lineTo(1.22, i * 0.07);
      ctx.lineTo(1.32, i * 0.08 + 0.03);
      ctx.stroke();
    }
    return;
  }
  const flesh = style === 'sludge' ? '#6a8a2a' : skin;
  // Forearm, tapering, with shading along its length
  const g = ctx.createLinearGradient(0, -thick, 0, thick);
  g.addColorStop(0, lite(flesh, 0.3));
  g.addColorStop(0.45, flesh);
  g.addColorStop(1, shade(flesh, 0.55));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(sleeve ? 0.45 : 0, -thick * (sleeve ? 0.85 : 1.1));
  ctx.quadraticCurveTo(0.75, -thick * 1.05, 1.0, -thick * 0.75);
  ctx.lineTo(1.0, thick * 0.75);
  ctx.quadraticCurveTo(0.75, thick * 1.05, sleeve ? 0.45 : 0, thick * (sleeve ? 0.85 : 1.1));
  ctx.closePath();
  ctx.fill();
  // Rot and a gash on the forearm
  ctx.fillStyle = mix(flesh, '#2a1a10', 0.5, 0.35);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0.55 + r() * 0.4, (r() - 0.5) * thick, 0.05, 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (style !== 'sludge') {
    ctx.strokeStyle = '#7a0d12';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(0.6, -thick * 0.3);
    ctx.lineTo(0.8, thick * 0.2);
    ctx.stroke();
  }
  // Hand: palm plus grasping fingers with dark nails
  const hand = shade(flesh, 0.05);
  const hs = thick * 1.1;
  ctx.fillStyle = hand;
  ctx.beginPath();
  ctx.ellipse(1.05, 0, hs * 0.85, hs, 0, 0, Math.PI * 2);
  ctx.fill();
  const fingers = style === 'claw' ? 3 : 4;
  for (let i = 0; i < fingers; i++) {
    const fy = (i / (fingers - 1) - 0.5) * hs * 1.5;
    const len = (style === 'claw' ? 0.3 : 0.15) + (i === 1 || i === 2 ? 0.03 : 0);
    ctx.strokeStyle = hand;
    ctx.lineCap = 'round';
    ctx.lineWidth = hs * 0.42;
    ctx.beginPath();
    ctx.moveTo(1.1, fy);
    ctx.quadraticCurveTo(1.1 + len * 0.7, fy * 1.15, 1.1 + len, fy * 1.05 + 0.02);
    ctx.stroke();
    ctx.fillStyle = style === 'claw' ? '#e8dcc0' : '#2a1e14';
    ctx.beginPath();
    ctx.moveTo(1.1 + len, fy - hs * 0.15);
    ctx.lineTo(1.1 + len + (style === 'claw' ? 0.14 : 0.06), fy + 0.02);
    ctx.lineTo(1.1 + len, fy + hs * 0.2);
    ctx.fill();
  }
  // Thumb
  ctx.strokeStyle = hand;
  ctx.lineWidth = hs * 0.45;
  ctx.beginPath();
  ctx.moveTo(1.0, -hs * 0.7);
  ctx.lineTo(1.12, -hs * 1.25);
  ctx.stroke();
  if (style === 'sludge') {
    ctx.fillStyle = 'rgba(200,255,60,0.75)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0.2 + r() * 0.9, (r() - 0.5) * thick * 2, 0.04 + r() * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Sprite building and caching

const cache = new Map<string, Sprite>();

/** Pixels per R unit for a zombie of this base radius. */
function density(radius: number) {
  // ~3.2 px per world unit covers the sharpest zoom on a phone, capped for the big bosses.
  return Math.min(radius * 3.2, 190);
}

/** Paints with a dark outline around everything so zombies pop off busy floors. */
function build(x0: number, y0: number, w: number, h: number, radius: number, paint: (ctx: Ctx) => void, outline = 0.06): Sprite {
  const d = density(radius);
  const pw = w * d;
  const ph = h * d;
  const art = canvas(pw, ph);
  const a = art.getContext('2d')!;
  a.setTransform(d, 0, 0, d, -x0 * d, -y0 * d);
  paint(a);
  if (outline <= 0) return { c: art, x0, y0, w, h };
  // Dark silhouette stamped around the art makes a crisp outline.
  const sil = canvas(pw, ph);
  const s = sil.getContext('2d')!;
  s.drawImage(art, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = 'rgba(8,6,6,0.85)';
  s.fillRect(0, 0, pw, ph);
  const out = canvas(pw, ph);
  const o = out.getContext('2d')!;
  const t = outline * d;
  for (let i = 0; i < 8; i++) {
    const a2 = (i / 8) * Math.PI * 2;
    o.drawImage(sil, Math.cos(a2) * t, Math.sin(a2) * t);
  }
  o.drawImage(art, 0, 0);
  return { c: out, x0, y0, w, h };
}

/** Trims fully transparent margins so each stamp touches as few pixels as possible. */
function crop(sp: Sprite): Sprite {
  const { c } = sp;
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width;
  let minY = c.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (data[(y * c.width + x) * 4 + 3] > 6) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return sp;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w * h > c.width * c.height * 0.9) return sp;
  const out = canvas(w, h);
  out.getContext('2d')!.drawImage(c, -minX, -minY);
  const d = c.width / sp.w;
  return { c: out, x0: sp.x0 + minX / d, y0: sp.y0 + minY / d, w: w / d, h: h / d };
}

/** Bakes a soft contact shadow under a sprite, so it costs nothing per frame. */
function withShadow(sp: Sprite, rx: number, ry: number, cx = 0.1): Sprite {
  const c = sp.c;
  const o = c.getContext('2d')!;
  const d = c.width / sp.w;
  o.save();
  o.globalCompositeOperation = 'destination-over';
  o.setTransform(d, 0, 0, d, -sp.x0 * d, -sp.y0 * d);
  o.translate(-cx, 0);
  o.scale(rx, ry);
  const g = o.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = g;
  o.beginPath();
  o.arc(0, 0, 1, 0, Math.PI * 2);
  o.fill();
  o.restore();
  return sp;
}

/** The same sprite washed with a flat color (hit flash, frost, burns...). */
function tinted(base: Sprite, tint: Tint): Sprite {
  const [color, alpha] = TINTS[tint];
  const c = canvas(base.c.width, base.c.height);
  const x = c.getContext('2d')!;
  x.drawImage(base.c, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = alpha;
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return { ...base, c };
}

function cached(key: string, tint: Tint, make: () => Sprite): Sprite {
  const k = `${key}|${tint}`;
  let s = cache.get(k);
  if (s) return s;
  if (tint === Tint.None) s = make();
  else s = tinted(cached(key, Tint.None, make), tint);
  cache.set(k, s);
  return s;
}

const BOUNDS: Record<string, [number, number, number, number]> = {
  dog: [-2.0, -0.75, 3.75, 1.5],
  crawler: [-1.5, -1.05, 2.7, 2.1],
  burrower: [-1.05, -1.1, 2.95, 2.2],
  webber: [-1.45, -1.05, 2.6, 2.1],
  brood: [-1.35, -1.05, 2.9, 2.1],
  boss: [-1.55, -1.55, 3.1, 3.1],
  bloater: [-1.15, -1.15, 2.3, 2.3],
  sludge: [-1.2, -1.2, 2.4, 2.4],
};

const kindKey = (def: ZombieDef) => (BODY[def.kind] ? def.kind : `x-${def.kind}-${def.body}`);

/**
 * The body sprite. `hurt` (0, 1 or 2) bakes in progressively more gore, so a
 * wounded zombie still costs a single stamp.
 */
export function bodySprite(def: ZombieDef, variant: number, tint: Tint, hurt = 0): Sprite {
  const boss = def.radius >= 40;
  const v = boss ? 0 : variant % VARIANTS;
  if (hurt > 0 && tint === Tint.None && def.kind !== 'wraith') {
    return cached(`h|${kindKey(def)}|${v}|${hurt}`, Tint.None, () => {
      const base = bodySprite(def, v, Tint.None);
      const gore = damageSprite(def, v);
      const c = canvas(base.c.width, base.c.height);
      const x = c.getContext('2d')!;
      x.drawImage(base.c, 0, 0);
      x.globalAlpha = hurt === 1 ? 0.5 : 1;
      const d = base.c.width / base.w;
      x.drawImage(gore.c, (gore.x0 - base.x0) * d, (gore.y0 - base.y0) * d, gore.w * d, gore.h * d);
      return { ...base, c };
    });
  }
  return cached(`b|${kindKey(def)}|${v}`, tint, () => {
    const [x0, y0, w, h] = BOUNDS[def.kind] ?? [-1.1, -1.1, 2.3, 2.2];
    const sp = build(x0, y0, w, h, def.radius, (ctx) => {
      const L: Look = { v, r: rng(hash(def.kind) + v * 977 + 13), def, skin: def.body, dark: def.dark };
      (BODY[def.kind] ?? humanoid)(ctx, L);
    }, boss ? 0.03 : 0.055);
    if (def.kind === 'wraith') return crop(sp);
    return crop(def.kind === 'dog' ? withShadow(sp, 1.6, 0.85, 0.3) : withShadow(sp, Math.min(1.25, -x0), Math.min(1.25, -y0)));
  });
}

/** Swing frames baked for each kind's pair of arms. */
export const ARM_FRAMES = 6;

/**
 * Both arms in one sprite, posed for one step of the shamble. Baking the pair
 * turns two transformed draws per zombie into a single stamp.
 */
export function armsSprite(def: ZombieDef, frame: number, tint: Tint): Sprite | null {
  const arm = armSprite(def, Tint.None);
  if (!arm) return null;
  const f = ((frame % ARM_FRAMES) + ARM_FRAMES) % ARM_FRAMES;
  return cached(`p|${kindKey(def)}|${f}`, tint, () => {
    const swing = Math.sin((f / ARM_FRAMES) * Math.PI * 2);
    const kind = def.kind;
    const big = def.radius >= 40 || kind === 'tank';
    const crawl = kind === 'crawler';
    // Arms are thin, so big bosses get away with a coarser bake (keeps memory down).
    const d = Math.min(density(def.radius), 110);
    const x0 = -0.3;
    const y0 = -1.45;
    const w = 1.95;
    const h = 2.9;
    const c = canvas(w * d, h * d);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(d, 0, 0, d, -x0 * d, -y0 * d);
    const put = (side: number, rot: number, reach: number, y: number) => {
      ctx.save();
      ctx.translate(crawl ? 0.2 : 0.02, side * y);
      ctx.rotate(rot);
      ctx.drawImage(arm.c, arm.x0 * reach, arm.y0, arm.w * reach, arm.h);
      ctx.restore();
    };
    for (const side of [-1, 1]) {
      if ((kind === 'necro' || kind === 'reaper') && side === 1) {
        put(1, 0.35, 0.8, 0.66); // the hand gripping the staff / scythe
        continue;
      }
      const rot = -side * (crawl ? 0.55 + swing * side * 0.35 : big ? 0.16 : 0.26) + swing * side * 0.08;
      put(side, rot, (big ? 0.95 : 0.86) + swing * side * 0.12, big ? 0.78 : 0.66);
    }
    return crop({ c, x0, y0, w, h });
  });
}

export function armSprite(def: ZombieDef, tint: Tint): Sprite | null {
  const style = armStyle(def.kind);
  if (style === 'none') return null;
  return cached(`a|${kindKey(def)}`, tint, () =>
    build(-0.12, -0.42, 1.65, 0.84, def.radius, (ctx) => paintArm(ctx, def, style, rng(hash(def.kind) + 5)), def.radius >= 40 ? 0.03 : 0.05),
  );
}

/** Extra gore that fades in as a zombie takes damage, clipped to its body. */
export function damageSprite(def: ZombieDef, variant: number): Sprite {
  const v = variant % VARIANTS;
  return cached(`d|${kindKey(def)}|${v}`, Tint.None, () => {
    const base = bodySprite(def, v, Tint.None);
    const { x0, y0, w, h } = base;
    const s = build(x0, y0, w, h, def.radius, (ctx) => {
      const r = rng(hash(def.kind) * 3 + v * 31 + 7);
      for (let i = 0; i < 7; i++) {
        const x = x0 + w * (0.2 + r() * 0.6);
        const y = y0 + h * (0.2 + r() * 0.6);
        if (i % 2) wound(ctx, r, x, y, 0.08 + r() * 0.08);
        else splat(ctx, r, x, y, 0.08 + r() * 0.08, 0.75);
      }
    }, 0);
    // Keep the gore on the body only.
    const x = s.c.getContext('2d')!;
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(base.c, 0, 0, s.c.width, s.c.height);
    return s;
  });
}

export function eggSprite(def: ZombieDef, tint: Tint): Sprite {
  return cached('egg', tint, () =>
    build(-1.0, -1.25, 2.0, 2.5, def.radius, (ctx) => {
      const r = rng(99);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.85, 1.1, 0, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(-0.25, -0.35, 0.05, 0, 0, 1.1);
      g.addColorStop(0, '#fff8e0');
      g.addColorStop(0.5, '#d8c89a');
      g.addColorStop(1, '#6a5a32');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.clip();
      // Something curled up inside
      ctx.fillStyle = 'rgba(110,30,30,0.35)';
      blobPath(ctx, 0.05, 0.15, 0.45, 0.6, r, 0.2, 14, 0.3);
      ctx.fill();
      // Veins over the shell
      ctx.strokeStyle = 'rgba(140,40,40,0.55)';
      ctx.lineWidth = 0.035;
      for (let i = 0; i < 6; i++) {
        let x = (r() - 0.5) * 1.2;
        let y = -1.0;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += (r() - 0.5) * 0.3;
          y += 0.35;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Slime sheen
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(-0.35, -0.5, 0.18, 0.32, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#6a5a2a';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.85, 1.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }, 0.05),
  );
}

/** Stamps a sprite centered on the current origin for a zombie of radius r. */
export function stamp(ctx: Ctx, s: Sprite, r: number, sx = 1, sy = 1) {
  ctx.drawImage(s.c, s.x0 * r * sx, s.y0 * r * sy, s.w * r * sx, s.h * r * sy);
}

/** Paints the sprites for every kind up front so the first wave doesn't stutter. */
export function warmZombieArt(defs: ZombieDef[]) {
  for (const def of defs) {
    if (def.kind === 'egg') {
      eggSprite(def, Tint.None);
      continue;
    }
    const n = def.radius >= 40 ? 1 : VARIANTS;
    for (let v = 0; v < n; v++) bodySprite(def, v, Tint.None);
    for (let f = 0; f < ARM_FRAMES; f++) armsSprite(def, f, Tint.None);
  }
}

/** Where the eyes sit (forward, sideways) in R units, for the glow pass. */
export function eyeSpot(kind: string): [number, number] {
  switch (kind) {
    case 'bloater':
      return [0.89, 0.13];
    case 'dog':
      return [1.15, 0.17];
    case 'tank':
    case 'leaper':
      return [0.61, 0.15];
    case 'necro':
    case 'reaper':
      return [0.5, 0.1];
    case 'brood':
      return [0.78, 0.2];
    case 'boss':
      return [0.72, 0.13];
    case 'juggernaut':
      return [0.54, 0.12];
    case 'sludge':
      return [0.69, 0.13];
    default:
      return [0.56, 0.17];
  }
}
