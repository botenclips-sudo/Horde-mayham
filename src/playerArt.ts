/**
 * Player character sprites rendered in Blender (see art/operator/ for the build script).
 *
 * The atlas holds top-down renders of an original tactical operator: 8 walk frames and an
 * idle frame for the lower layer (legs, jacket, chest rig, hip pouch), one upper layer
 * (arms, gloves, head, hair, headset) and a knocked-down pose. Guns stay procedural and are
 * drawn between the two layers so every weapon still reads in the operator's hands.
 *
 * Each colour frame has a matching jacket mask. The jacket is rendered mid grey and tinted at
 * runtime (multiply), so co-op slots and suit skins recolour the puffer jacket without
 * shipping extra art. Tinted frames are cached once per colour.
 */
import atlasUrl from './assets/operator.png';

const CELL = 192;
const COLS = 6;
/** World units covered by one cell (the render's ortho size: 72 units, 1 unit = 1.5 cm). */
export const CELL_UNITS = 72;
/** The knocked-down cell was rendered wider so the whole body fits. */
export const DOWN_UNITS = 130;
export const WALK_FRAMES = 8;
const ORDER = [...Array.from({ length: WALK_FRAMES }, (_, i) => `walk${i}_under`), 'idle_under', 'idle_over', 'down'];

/** Jacket colour for the solo player when no suit skin is equipped (charcoal puffer). */
export const DEFAULT_JACKET = '#3a3c42';

let img: HTMLImageElement | null = null;
let ready = false;
const cache = new Map<string, HTMLCanvasElement>();

export function loadPlayerArt() {
  if (img || typeof Image === 'undefined') return;
  img = new Image();
  img.onload = () => {
    ready = true;
  };
  img.src = atlasUrl;
}

export function playerArtReady() {
  return ready;
}

function cellXY(i: number) {
  return [(i % COLS) * CELL, Math.floor(i / COLS) * CELL];
}

/** One frame, jacket tinted to `tint` (a CSS colour). Cached per frame and colour. */
export function playerFrame(name: string, tint: string): HTMLCanvasElement | null {
  if (!ready || !img) return null;
  const key = name + '|' + tint;
  const hit = cache.get(key);
  if (hit) return hit;
  const idx = ORDER.indexOf(name);
  if (idx < 0) return null;
  const [cx, cy] = cellXY(idx * 2);
  const [mx, my] = cellXY(idx * 2 + 1);
  const c = document.createElement('canvas');
  c.width = c.height = CELL;
  const g = c.getContext('2d')!;
  // Tinted jacket mask on a scratch canvas.
  const m = document.createElement('canvas');
  m.width = m.height = CELL;
  const mg = m.getContext('2d')!;
  mg.drawImage(img, mx, my, CELL, CELL, 0, 0, CELL, CELL);
  mg.globalCompositeOperation = 'source-in';
  mg.fillStyle = tint;
  mg.fillRect(0, 0, CELL, CELL);
  g.drawImage(img, cx, cy, CELL, CELL, 0, 0, CELL, CELL);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(m, 0, 0);
  // Multiply can leave the transparent fringe coloured: clip back to the frame's own alpha.
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, cx, cy, CELL, CELL, 0, 0, CELL, CELL);
  // A faint cool rim so a black-jacketed operator still reads on dark floors.
  const out = document.createElement('canvas');
  out.width = out.height = CELL;
  const og = out.getContext('2d')!;
  og.shadowColor = 'rgba(185,205,230,0.6)';
  og.shadowBlur = 5;
  og.drawImage(c, 0, 0);
  og.shadowBlur = 0;
  og.shadowColor = 'transparent';
  og.drawImage(c, 0, 0);
  cache.set(key, out);
  return out;
}

/** Walk frame for a distance walked (world units). One full stride cycle ~ 64 units. */
export function walkFrame(dist: number) {
  const f = Math.floor((dist / 64) * WALK_FRAMES) % WALK_FRAMES;
  return `walk${(f + WALK_FRAMES) % WALK_FRAMES}_under`;
}
