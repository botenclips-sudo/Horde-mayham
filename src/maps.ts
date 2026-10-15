// Map layouts: walls, gates zombies pour in from, lamps, explosive barrels,
// the baked ground texture and any map hazard.

export const WORLD_W = 2200;
export const WORLD_H = 1600;
export const BORDER = 40;

export type WallKind = 'border' | 'concrete' | 'car' | 'crate' | 'brick' | 'pillar';

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
];

export const mapById = (id: string) => MAPS.find((m) => m.id === id) ?? MAPS[0];
