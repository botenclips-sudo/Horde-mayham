// Map layouts: walls, gates zombies pour in from, lamps, explosive barrels,
// the baked ground texture and any map hazard.

export const WORLD_W = 2200;
export const WORLD_H = 1600;
export const BORDER = 40;

import type { ZombieKind } from './data';

export type WallKind = 'border' | 'concrete' | 'car' | 'crate' | 'brick' | 'pillar' | 'grave' | 'crypt' | 'tank' | 'pipe' | 'glass' | 'tube' | 'bench';

export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: WallKind;
  color?: string;
}

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  unlock: number; // player level needed
  walls: Wall[];
  gates: { x: number; y: number }[];
  lamps: { x: number; y: number; flicker: boolean }[];
  barrels: { x: number; y: number; big?: boolean }[];
  tracks?: number[]; // subway: y centers of the rail lines trains run along
  vents?: { x: number; y: number }[]; // refinery: steam vents that blast anything standing on them
  /** Lab: stand on a console to send a laser sweep across the whole map ('x' moves left/right). */
  consoles?: { x: number; y: number; axis: 'x' | 'y' }[];
  /** Lab: the power fails every so often (lamps out, consoles offline). */
  powercut?: boolean;
  /** Zombie kinds that show up earlier than usual here (kind -> first wave). */
  natives?: Partial<Record<ZombieKind, number>>;
  /** This map's own boss comes first in the boss rotation. */
  boss?: ZombieKind;
  ground: (c: CanvasRenderingContext2D) => void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const BORDER_WALLS: Wall[] = [
  { x: 0, y: 0, w: WORLD_W, h: BORDER, kind: 'border' },
  { x: 0, y: WORLD_H - BORDER, w: WORLD_W, h: BORDER, kind: 'border' },
  { x: 0, y: 0, w: BORDER, h: WORLD_H, kind: 'border' },
  { x: WORLD_W - BORDER, y: 0, w: BORDER, h: WORLD_H, kind: 'border' },
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

/** Speckle, stains and cracks shared by every ground. */
function grit(c: CanvasRenderingContext2D, stains: number) {
  for (let i = 0; i < 9000; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.09)';
    const s = rand(2, 7);
    c.fillRect(rand(0, WORLD_W), rand(0, WORLD_H), s, s);
  }
  for (let i = 0; i < stains; i++) {
    c.fillStyle = 'rgba(10,10,14,0.35)';
    c.beginPath();
    c.ellipse(rand(0, WORLD_W), rand(0, WORLD_H), rand(15, 45), rand(10, 30), rand(0, 3), 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = 'rgba(0,0,0,0.45)';
  c.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
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
}

function groundLot(c: CanvasRenderingContext2D) {
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
}

function groundGas(c: CanvasRenderingContext2D) {
  c.fillStyle = '#3a3c3f';
  c.fillRect(0, 0, WORLD_W, WORLD_H);
  // Concrete slabs
  c.strokeStyle = 'rgba(0,0,0,0.28)';
  c.lineWidth = 3;
  for (let x = 0; x < WORLD_W; x += 120) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, WORLD_H);
    c.stroke();
  }
  for (let y = 0; y < WORLD_H; y += 120) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(WORLD_W, y);
    c.stroke();
  }
  // Asphalt road down the left side
  c.fillStyle = '#26282b';
  c.fillRect(BORDER, 0, 300, WORLD_H);
  c.strokeStyle = 'rgba(232,197,71,0.45)';
  c.lineWidth = 8;
  c.setLineDash([60, 50]);
  c.beginPath();
  c.moveTo(BORDER + 150, 0);
  c.lineTo(BORDER + 150, WORLD_H);
  c.stroke();
  c.setLineDash([]);
  // Painted lanes by the pumps
  c.strokeStyle = 'rgba(240,240,240,0.25)';
  c.lineWidth = 5;
  for (const y of [700, 1100]) {
    c.beginPath();
    c.moveTo(600, y);
    c.lineTo(1200, y);
    c.stroke();
  }
  // Store floor
  c.fillStyle = '#4a4438';
  c.fillRect(1450, 180, 450, 340);
  c.strokeStyle = 'rgba(0,0,0,0.2)';
  c.lineWidth = 2;
  for (let x = 1450; x < 1900; x += 40)
    for (let y = 180; y < 520; y += 40) c.strokeRect(x, y, 40, 40);
  grit(c, 60);
}

function groundSubway(c: CanvasRenderingContext2D) {
  c.fillStyle = '#2f2c2a';
  c.fillRect(0, 0, WORLD_W, WORLD_H);
  // Platform tiles with a yellow safety edge along each track.
  c.fillStyle = '#3b3a38';
  c.fillRect(0, 560, WORLD_W, 480);
  c.strokeStyle = 'rgba(0,0,0,0.2)';
  c.lineWidth = 2;
  for (let x = 0; x < WORLD_W; x += 60) c.strokeRect(x, 560, 60, 480);
  for (const y of [470, 1130]) {
    // Gravel bed, sleepers, rails
    c.fillStyle = '#211e1c';
    c.fillRect(0, y - 55, WORLD_W, 110);
    for (let i = 0; i < 2500; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(120,110,100,0.25)' : 'rgba(0,0,0,0.3)';
      c.fillRect(rand(0, WORLD_W), y - 55 + rand(0, 110), 3, 3);
    }
    c.fillStyle = '#4a3a2a';
    for (let x = 0; x < WORLD_W; x += 34) c.fillRect(x, y - 40, 14, 80);
    c.fillStyle = '#9a9a9e';
    c.fillRect(0, y - 26, WORLD_W, 6);
    c.fillRect(0, y + 20, WORLD_W, 6);
    c.fillStyle = 'rgba(232,197,71,0.6)';
    c.fillRect(0, y < WORLD_H / 2 ? y + 60 : y - 66, WORLD_W, 6);
  }
  grit(c, 40);
}

function groundGraveyard(c: CanvasRenderingContext2D) {
  c.fillStyle = '#1f261d';
  c.fillRect(0, 0, WORLD_W, WORLD_H);
  // Patchy dead grass
  for (let i = 0; i < 14000; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(90,110,60,0.08)' : 'rgba(0,0,0,0.12)';
    c.fillRect(rand(0, WORLD_W), rand(0, WORLD_H), rand(1, 3), rand(3, 7));
  }
  for (let i = 0; i < 30; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.14)' : 'rgba(80,90,50,0.06)';
    c.beginPath();
    c.ellipse(rand(0, WORLD_W), rand(0, WORLD_H), rand(80, 240), rand(60, 180), rand(0, 3), 0, Math.PI * 2);
    c.fill();
  }
  // Gravel paths in a cross, plus a ring around the statue
  c.fillStyle = '#3a3630';
  c.fillRect(BORDER, WORLD_H / 2 - 55, WORLD_W - BORDER * 2, 110);
  c.fillRect(WORLD_W / 2 - 55, BORDER, 110, WORLD_H - BORDER * 2);
  c.beginPath();
  c.arc(WORLD_W / 2, WORLD_H / 2, 190, 0, Math.PI * 2);
  c.fill();
  for (let i = 0; i < 5000; i++) {
    const x = rand(0, WORLD_W);
    const y = rand(0, WORLD_H);
    const onPath = Math.abs(y - WORLD_H / 2) < 55 || Math.abs(x - WORLD_W / 2) < 55 || Math.hypot(x - WORLD_W / 2, y - WORLD_H / 2) < 190;
    if (!onPath) continue;
    c.fillStyle = Math.random() < 0.5 ? 'rgba(160,150,130,0.18)' : 'rgba(0,0,0,0.25)';
    c.fillRect(x, y, 3, 3);
  }
  // Dirt plots in front of each headstone
  c.fillStyle = 'rgba(70,50,30,0.55)';
  for (const g of GRAVES) c.fillRect(g.x - 6, g.y + g.h + 2, g.w + 12, 46);
  grit(c, 20);
}

function groundRefinery(c: CanvasRenderingContext2D) {
  c.fillStyle = '#26292a';
  c.fillRect(0, 0, WORLD_W, WORLD_H);
  // Riveted steel deck plates
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = 2;
  for (let x = 0; x < WORLD_W; x += 120)
    for (let y = 0; y < WORLD_H; y += 120) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)';
      c.fillRect(x, y, 120, 120);
      c.strokeRect(x, y, 120, 120);
      c.fillStyle = 'rgba(160,160,150,0.18)';
      for (const [ox, oy] of [[8, 8], [112, 8], [8, 112], [112, 112]]) c.fillRect(x + ox - 2, y + oy - 2, 4, 4);
    }
  // Toxic run-off channel across the middle, with a yellow hazard edge
  c.fillStyle = '#1a2410';
  c.fillRect(BORDER, WORLD_H / 2 - 36, WORLD_W - BORDER * 2, 72);
  for (let i = 0; i < 3000; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(150,230,40,0.16)' : 'rgba(0,0,0,0.25)';
    c.fillRect(rand(BORDER, WORLD_W - BORDER), WORLD_H / 2 - 36 + rand(0, 72), rand(2, 6), rand(2, 4));
  }
  for (const y of [WORLD_H / 2 - 44, WORLD_H / 2 + 36]) {
    for (let x = BORDER; x < WORLD_W - BORDER; x += 40) {
      c.fillStyle = (x / 40) % 2 ? '#c8a020' : '#1a1a1a';
      c.fillRect(x, y, 40, 8);
    }
  }
  // Rusty stains and oil spills
  for (let i = 0; i < 40; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(120,60,20,0.12)' : 'rgba(0,0,0,0.22)';
    c.beginPath();
    c.ellipse(rand(0, WORLD_W), rand(0, WORLD_H), rand(30, 120), rand(20, 80), rand(0, 3), 0, Math.PI * 2);
    c.fill();
  }
  grit(c, 30);
}

function groundLab(c: CanvasRenderingContext2D) {
  c.fillStyle = '#1f2828';
  c.fillRect(0, 0, WORLD_W, WORLD_H);
  // Clinical floor tiles, some cracked, stained or missing.
  const T = 60;
  for (let x = 0; x < WORLD_W; x += T)
    for (let y = 0; y < WORLD_H; y += T) {
      const r = Math.random();
      c.fillStyle = r < 0.04 ? '#141a1a' : r < 0.5 ? 'rgba(200,235,230,0.035)' : 'rgba(0,0,0,0.05)';
      c.fillRect(x + 1, y + 1, T - 2, T - 2);
      if (r < 0.04) {
        // Missing tile: bare concrete with rubble.
        for (let i = 0; i < 6; i++) {
          c.fillStyle = 'rgba(120,130,125,0.25)';
          c.fillRect(x + rand(4, T - 8), y + rand(4, T - 8), rand(2, 6), rand(2, 5));
        }
      } else if (r > 0.93) {
        c.strokeStyle = 'rgba(0,0,0,0.5)';
        c.lineWidth = 1.5;
        c.beginPath();
        let cx = x + rand(5, T - 5);
        let cy = y + rand(5, T - 5);
        c.moveTo(cx, cy);
        for (let k = 0; k < 4; k++) {
          cx += rand(-18, 18);
          cy += rand(-18, 18);
          c.lineTo(cx, cy);
        }
        c.stroke();
      }
    }
  c.strokeStyle = 'rgba(0,0,0,0.4)';
  c.lineWidth = 2;
  for (let x = 0; x <= WORLD_W; x += T) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, WORLD_H);
    c.stroke();
  }
  for (let y = 0; y <= WORLD_H; y += T) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(WORLD_W, y);
    c.stroke();
  }
  // Containment zone: hazard band around the central chamber and a big biohazard mark.
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  c.save();
  c.beginPath();
  c.rect(790, 560, 620, 480);
  c.rect(860, 630, 480, 340);
  c.clip('evenodd');
  for (let i = -700; i < 700; i += 36) {
    c.fillStyle = (i / 36) % 2 ? 'rgba(220,180,30,0.32)' : 'rgba(10,10,10,0.35)';
    c.beginPath();
    c.moveTo(cx + i, 540);
    c.lineTo(cx + i + 18, 540);
    c.lineTo(cx + i + 18 + 520, 1060);
    c.lineTo(cx + i + 520, 1060);
    c.fill();
  }
  c.restore();
  c.strokeStyle = 'rgba(255,60,200,0.16)';
  c.lineWidth = 10;
  c.beginPath();
  c.arc(cx, cy, 120, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = 'rgba(255,60,200,0.12)';
  c.font = 'bold 150px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('☣', cx, cy + 8);
  c.fillStyle = 'rgba(230,240,235,0.16)';
  c.font = 'bold 34px sans-serif';
  c.fillText('ZONE 0', cx, cy + 128);
  // Painted lanes and arrows toward the exits.
  c.fillStyle = 'rgba(230,200,60,0.22)';
  for (const [x, y, a] of [
    [cx, 360, -Math.PI / 2],
    [cx, 1240, Math.PI / 2],
    [500, cy, Math.PI],
    [1700, cy, 0],
  ] as const) {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.beginPath();
    c.moveTo(40, 0);
    c.lineTo(0, -26);
    c.lineTo(0, -10);
    c.lineTo(-40, -10);
    c.lineTo(-40, 10);
    c.lineTo(0, 10);
    c.lineTo(0, 26);
    c.fill();
    c.restore();
  }
  // Drain grates
  for (const [x, y] of [
    [420, 620],
    [1780, 980],
    [700, 1300],
    [1500, 300],
  ]) {
    c.fillStyle = '#0e1212';
    c.fillRect(x - 26, y - 26, 52, 52);
    c.strokeStyle = '#3a4646';
    c.lineWidth = 3;
    for (let i = -18; i <= 18; i += 9) {
      c.beginPath();
      c.moveTo(x + i, y - 22);
      c.lineTo(x + i, y + 22);
      c.stroke();
    }
  }
  // Blood drag marks and pink mutagen spills.
  for (let i = 0; i < 14; i++) {
    let x = rand(150, WORLD_W - 150);
    let y = rand(150, WORLD_H - 150);
    const a = rand(0, Math.PI * 2);
    c.strokeStyle = 'rgba(90,10,14,0.4)';
    c.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      c.lineWidth = rand(4, 9);
      c.beginPath();
      c.moveTo(x, y);
      const l = rand(80, 200);
      c.lineTo(x + Math.cos(a) * l + rand(-10, 10), y + Math.sin(a) * l + rand(-10, 10));
      c.stroke();
      x += rand(-6, 6);
      y += rand(-6, 6);
    }
  }
  for (let i = 0; i < 18; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(255,70,200,0.1)' : 'rgba(120,255,160,0.07)';
    c.beginPath();
    c.ellipse(rand(0, WORLD_W), rand(0, WORLD_H), rand(20, 70), rand(14, 50), rand(0, 3), 0, Math.PI * 2);
    c.fill();
  }
  // Scattered papers
  for (let i = 0; i < 60; i++) {
    c.save();
    c.translate(rand(60, WORLD_W - 60), rand(60, WORLD_H - 60));
    c.rotate(rand(0, Math.PI));
    c.fillStyle = 'rgba(225,228,215,0.28)';
    c.fillRect(-7, -9, 14, 18);
    c.fillStyle = 'rgba(40,40,40,0.25)';
    for (let k = -5; k < 6; k += 3) c.fillRect(-5, k, 10, 1);
    c.restore();
  }
  grit(c, 20);
}

/** Specimen tubes in pairs, a flow cell apart. */
const TUBES: Wall[] = (() => {
  const out: Wall[] = [];
  for (const [x0, y0] of [
    [300, 250],
    [1740, 250],
    [300, 1290],
    [1740, 1290],
  ])
    for (let i = 0; i < 2; i++) out.push({ x: x0 + i * 110, y: y0, w: 56, h: 56, kind: 'tube' });
  return out;
})();

/** Headstone rows, kept a flow-field cell apart so zombies can weave between them. */
const GRAVES: Wall[] = (() => {
  const out: Wall[] = [];
  for (const y of [520, 1010])
    for (let x = 620; x <= 1600; x += 130) {
      if (Math.abs(x + 12 - WORLD_W / 2) < 120) continue;
      out.push({ x, y, w: 26, h: 18, kind: 'grave' });
    }
  for (const x of [250, 1924])
    for (let y = 560; y <= 1000; y += 130) out.push({ x, y, w: 26, h: 18, kind: 'grave' });
  return out;
})();

export const MAPS: MapDef[] = [
  {
    id: 'lot',
    name: 'Parking Lot',
    desc: 'Cars, crates and a dark open lot.',
    unlock: 1,
    walls: [
      ...BORDER_WALLS,
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
    ],
    gates: GATES,
    lamps: [
      { x: 260, y: 240, flicker: false },
      { x: 1940, y: 240, flicker: true },
      { x: 260, y: 1360, flicker: true },
      { x: 1940, y: 1360, flicker: false },
      { x: 1100, y: 250, flicker: false },
      { x: 1100, y: 1350, flicker: true },
    ],
    barrels: [
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
    ],
    ground: groundLot,
  },
  {
    id: 'gas',
    name: 'Gas Station',
    desc: 'Fuel pumps make huge explosions. A store to hold out in.',
    unlock: 2,
    walls: [
      ...BORDER_WALLS,
      // Store with a doorway at the bottom
      { x: 1450, y: 180, w: 450, h: 40, kind: 'brick' },
      { x: 1450, y: 180, w: 40, h: 340, kind: 'brick' },
      { x: 1860, y: 180, w: 40, h: 340, kind: 'brick' },
      { x: 1450, y: 480, w: 160, h: 40, kind: 'brick' },
      { x: 1750, y: 480, w: 150, h: 40, kind: 'brick' },
      { x: 1560, y: 290, w: 44, h: 44, kind: 'crate' },
      // Pump islands
      { x: 680, y: 790, w: 440, h: 30, kind: 'concrete' },
      { x: 680, y: 990, w: 440, h: 30, kind: 'concrete' },
      // Parked cars and a dumpster
      { x: 450, y: 300, w: 130, h: 60, kind: 'car', color: '#c0c4c8' },
      { x: 480, y: 1260, w: 130, h: 60, kind: 'car', color: '#8a2c2c' },
      { x: 1640, y: 1150, w: 130, h: 60, kind: 'car', color: '#2c4f8a' },
      { x: 1960, y: 760, w: 70, h: 110, kind: 'crate' },
      { x: 1250, y: 1330, w: 240, h: 40, kind: 'concrete' },
    ],
    gates: GATES,
    lamps: [
      { x: 760, y: 900, flicker: false },
      { x: 1040, y: 900, flicker: false },
      { x: 1675, y: 350, flicker: true },
      { x: 300, y: 700, flicker: false },
      { x: 1900, y: 1300, flicker: true },
      { x: 500, y: 1400, flicker: false },
    ],
    barrels: [
      { x: 800, y: 760, big: true },
      { x: 1000, y: 760, big: true },
      { x: 800, y: 1050, big: true },
      { x: 1000, y: 1050, big: true },
      { x: 1250, y: 520 },
      { x: 620, y: 1180 },
      { x: 1500, y: 900 },
      { x: 1980, y: 560 },
    ],
    ground: groundGas,
  },
  {
    id: 'subway',
    name: 'Subway Yard',
    desc: 'Trains thunder through and flatten anything on the tracks, you included.',
    unlock: 4,
    walls: [
      ...BORDER_WALLS,
      { x: 380, y: 780, w: 44, h: 44, kind: 'pillar' },
      { x: 800, y: 780, w: 44, h: 44, kind: 'pillar' },
      { x: 1356, y: 780, w: 44, h: 44, kind: 'pillar' },
      { x: 1776, y: 780, w: 44, h: 44, kind: 'pillar' },
      { x: 960, y: 220, w: 280, h: 64, kind: 'car', color: '#9aa2aa' },
      { x: 300, y: 1290, w: 52, h: 52, kind: 'crate' },
      { x: 356, y: 1300, w: 44, h: 44, kind: 'crate' },
      { x: 1700, y: 1300, w: 240, h: 40, kind: 'concrete' },
      { x: 1700, y: 240, w: 40, h: 120, kind: 'concrete' },
    ],
    gates: GATES,
    lamps: [
      { x: 300, y: 800, flicker: false },
      { x: 1100, y: 800, flicker: true },
      { x: 1900, y: 800, flicker: false },
      { x: 600, y: 250, flicker: true },
      { x: 1500, y: 1350, flicker: false },
    ],
    barrels: [
      { x: 500, y: 640 },
      { x: 1700, y: 640 },
      { x: 1100, y: 960 },
      { x: 420, y: 1250 },
      { x: 1900, y: 300 },
      { x: 1300, y: 300 },
    ],
    tracks: [470, 1130],
    ground: groundSubway,
  },
  {
    id: 'graveyard',
    name: 'Graveyard',
    desc: 'Open graves inside the walls. The dead climb out right next to you.',
    unlock: 6,
    walls: [
      ...BORDER_WALLS,
      // Four crypts in the corners
      { x: 330, y: 230, w: 170, h: 120, kind: 'crypt' },
      { x: 1700, y: 230, w: 170, h: 120, kind: 'crypt' },
      { x: 330, y: 1250, w: 170, h: 120, kind: 'crypt' },
      { x: 1700, y: 1250, w: 170, h: 120, kind: 'crypt' },
      // Angel statue in the middle
      { x: WORLD_W / 2 - 32, y: WORLD_H / 2 - 32, w: 64, h: 64, kind: 'pillar' },
      ...GRAVES,
    ],
    gates: [
      ...GATES,
      // Open graves (inside the walls)
      { x: 760, y: 800 },
      { x: 1440, y: 800 },
      { x: 1100, y: 330 },
      { x: 1100, y: 1270 },
    ],
    lamps: [
      { x: 560, y: 290, flicker: true },
      { x: 1640, y: 290, flicker: false },
      { x: 560, y: 1310, flicker: false },
      { x: 1640, y: 1310, flicker: true },
      { x: 1100, y: 690, flicker: true },
    ],
    barrels: [
      { x: 520, y: 400 },
      { x: 1680, y: 400 },
      { x: 520, y: 1200 },
      { x: 1680, y: 1200 },
      { x: 900, y: 690 },
      { x: 1300, y: 910 },
    ],
    ground: groundGraveyard,
  },
  {
    id: 'refinery',
    name: 'Toxic Refinery',
    desc: 'Steam vents blast anything standing on them. Lure the horde in.',
    unlock: 8,
    walls: [
      ...BORDER_WALLS,
      // Four storage tanks
      { x: 380, y: 260, w: 200, h: 200, kind: 'tank' },
      { x: 1620, y: 260, w: 200, h: 200, kind: 'tank' },
      { x: 380, y: 1140, w: 200, h: 200, kind: 'tank' },
      { x: 1620, y: 1140, w: 200, h: 200, kind: 'tank' },
      // Pipe runs (gaps left so the horde can squeeze through)
      { x: 760, y: 540, w: 240, h: 26, kind: 'pipe' },
      { x: 1200, y: 540, w: 240, h: 26, kind: 'pipe' },
      { x: 760, y: 1034, w: 240, h: 26, kind: 'pipe' },
      { x: 1200, y: 1034, w: 240, h: 26, kind: 'pipe' },
      { x: 1087, y: 180, w: 26, h: 220, kind: 'pipe' },
      { x: 1087, y: 1200, w: 26, h: 220, kind: 'pipe' },
      // Control boxes
      { x: 240, y: 700, w: 60, h: 44, kind: 'crate' },
      { x: 1900, y: 856, w: 60, h: 44, kind: 'crate' },
    ],
    gates: GATES,
    lamps: [
      { x: 700, y: 300, flicker: false },
      { x: 1500, y: 300, flicker: true },
      { x: 700, y: 1300, flicker: true },
      { x: 1500, y: 1300, flicker: false },
      { x: 1100, y: 800, flicker: false },
    ],
    barrels: [
      { x: 640, y: 420 },
      { x: 1560, y: 420 },
      { x: 640, y: 1180 },
      { x: 1560, y: 1180 },
      { x: 1100, y: 460 },
      { x: 1100, y: 1140 },
    ],
    vents: [
      { x: 700, y: 800 },
      { x: 1500, y: 800 },
      { x: 880, y: 360 },
      { x: 1320, y: 1240 },
      { x: 300, y: 980 },
      { x: 1900, y: 620 },
    ],
    ground: groundRefinery,
  },
  {
    id: 'lab',
    name: 'Hive Lab',
    desc: 'Stand on a console to sweep a laser across the map. Watch for power cuts.',
    unlock: 9,
    walls: [
      ...BORDER_WALLS,
      // Zone 0: the glass containment chamber you start in, one door per side.
      { x: 840, y: 610, w: 180, h: 20, kind: 'glass' },
      { x: 1180, y: 610, w: 180, h: 20, kind: 'glass' },
      { x: 840, y: 970, w: 180, h: 20, kind: 'glass' },
      { x: 1180, y: 970, w: 180, h: 20, kind: 'glass' },
      { x: 840, y: 630, w: 20, h: 110, kind: 'glass' },
      { x: 840, y: 860, w: 20, h: 110, kind: 'glass' },
      { x: 1340, y: 630, w: 20, h: 110, kind: 'glass' },
      { x: 1340, y: 860, w: 20, h: 110, kind: 'glass' },
      ...TUBES,
      // Lab benches
      { x: 520, y: 430, w: 200, h: 40, kind: 'bench' },
      { x: 1480, y: 430, w: 200, h: 40, kind: 'bench' },
      { x: 520, y: 1130, w: 200, h: 40, kind: 'bench' },
      { x: 1480, y: 1130, w: 200, h: 40, kind: 'bench' },
      { x: 250, y: 560, w: 40, h: 160, kind: 'bench' },
      { x: 1910, y: 880, w: 40, h: 160, kind: 'bench' },
      { x: 680, y: 220, w: 40, h: 130, kind: 'bench' },
      { x: 1480, y: 1250, w: 40, h: 130, kind: 'bench' },
    ],
    gates: GATES,
    lamps: [
      { x: 1100, y: 800, flicker: false },
      { x: 560, y: 320, flicker: false },
      { x: 1640, y: 320, flicker: true },
      { x: 560, y: 1280, flicker: true },
      { x: 1640, y: 1280, flicker: false },
      { x: 400, y: 900, flicker: false },
      { x: 1800, y: 700, flicker: false },
    ],
    barrels: [
      { x: 760, y: 520 },
      { x: 1440, y: 1080 },
      { x: 320, y: 420 },
      { x: 1880, y: 1180 },
      { x: 1100, y: 300 },
    ],
    consoles: [
      { x: 600, y: 800, axis: 'x' },
      { x: 1600, y: 800, axis: 'y' },
    ],
    powercut: true,
    natives: { parasite: 2, mutant: 5, blob: 7, psyker: 9 },
    boss: 'zero',
    ground: groundLab,
  },
];

/** Gates in the middle of the map (open graves) rather than gaps in the outer wall. */
export const isInnerGate = (g: { x: number; y: number }) => g.x > BORDER * 3 && g.x < WORLD_W - BORDER * 3 && g.y > BORDER * 3 && g.y < WORLD_H - BORDER * 3;

export const mapById = (id: string) => MAPS.find((m) => m.id === id) ?? MAPS[0];
