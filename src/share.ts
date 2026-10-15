// Game-over share card: a 1200x630 image of the death scene with the run's stats,
// shared through the phone's share sheet (or downloaded where that isn't available).

import type { RunSummary } from './game';
import type { BadgeDef } from './achievements';
import { MAPS } from './maps';
import { MODES, MUTATORS, type Challenge } from './meta';

/** Where the game lives when it is played inside the Claude artifact viewer. */
export const ARTIFACT_URL = 'https://claude.ai/artifact/Pdt7kjzTHAMnc3K6SJsWJU';

const FONT = "'Black Ops One', 'Arial Black', system-ui, sans-serif";

export function makeShareCard(s: RunSummary, scene: HTMLCanvasElement, level: number, newBest: boolean, label: string, badges: BadgeDef[] = []): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;

  // Background: the actual moment you died, cropped to fill.
  x.fillStyle = '#0d0f0c';
  x.fillRect(0, 0, W, H);
  if (scene.width && scene.height) {
    const k = Math.max(W / scene.width, H / scene.height);
    const sw = scene.width * k;
    const sh = scene.height * k;
    // The night scene is dark once the flashlight is gone, so lift it a little.
    x.filter = 'brightness(1.8) saturate(1.2)';
    x.drawImage(scene, (W - sw) / 2, (H - sh) / 2, sw, sh);
    x.filter = 'none';
  }
  const g = x.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.88)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0.15)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = '#e0483e';
  x.lineWidth = 10;
  x.strokeRect(5, 5, W - 10, H - 10);

  const text = (t: string, px: number, py: number, size: number, color: string, font = FONT) => {
    x.font = `${size}px ${font}`;
    x.fillStyle = '#000';
    x.fillText(t, px + 3, py + 3);
    x.fillStyle = color;
    x.fillText(t, px, py);
  };
  x.textBaseline = 'alphabetic';
  x.textAlign = 'left';
  text('HORDE', 60, 105, 64, '#e8ecd9');
  text('MAYHEM', 60, 165, 58, '#e0483e');

  text(label, 60, 212, 20, '#e8c547');
  text('I SURVIVED TO', 60, 255, 30, '#c9d1b8');
  text(`WAVE ${s.wave}`, 60, 350, 104, newBest ? '#ffd23f' : '#ffffff');
  if (newBest) text('NEW PERSONAL BEST!', 60, 395, 26, '#ffd23f');

  const stats: [string, string][] = [
    [`${s.kills}`, 'KILLS'],
    [`x${s.bestCombo}`, 'BEST COMBO'],
    [`${s.report.bosses}`, s.report.bosses === 1 ? 'BOSS' : 'BOSSES'],
    [`LV ${level}`, 'SURVIVOR'],
  ];
  stats.forEach(([v, label], i) => {
    const px = 60 + i * 175;
    text(v, px, 480, 44, '#ffffff');
    text(label, px, 512, 18, '#9aa58a');
  });

  if (s.perks.length) {
    x.font = '30px system-ui, sans-serif';
    x.fillText(s.perks.slice(0, 22).join(''), 60, 572);
  }
  // Badges earned this run, top right.
  badges.slice(0, 4).forEach((b, i) => {
    const by = 50 + i * 62;
    x.fillStyle = 'rgba(0,0,0,0.6)';
    x.fillRect(W - 360, by, 320, 52);
    x.strokeStyle = '#ffd23f';
    x.lineWidth = 2;
    x.strokeRect(W - 360, by, 320, 52);
    x.font = '30px system-ui, sans-serif';
    x.textAlign = 'left';
    x.fillStyle = '#fff';
    x.fillText(b.icon, W - 350, by + 37);
    let size = 17;
    x.font = `${size}px ${FONT}`;
    while (size > 11 && x.measureText(b.name.toUpperCase()).width > 255) x.font = `${--size}px ${FONT}`;
    text(b.name.toUpperCase(), W - 305, by + 23, size, '#ffd23f');
    text('BADGE UNLOCKED', W - 305, by + 43, 13, '#9aa58a');
  });
  x.textAlign = 'right';
  text('CAN YOU BEAT IT?', W - 50, H - 40, 30, '#ffd23f');
  return c;
}

/** Opens the share sheet with the card image; falls back to downloading the PNG. Returns what happened. */
export async function shareCard(card: HTMLCanvasElement, wave: number): Promise<SaveOutcome> {
  const blob: Blob | null = await new Promise((res) => card.toBlob(res, 'image/png'));
  if (!blob) return 'failed';
  return shareFile(blob, `horde-mayhem-wave-${wave}.png`, `I survived to wave ${wave} in Horde Mayhem. Can you beat it?`);
}

export type SaveOutcome = 'shared' | 'saved' | 'downloaded' | 'declined' | 'failed';

interface DownloadsCap {
  save(r: { filename: string; data: Blob }): Promise<unknown>;
}

let downloadsCap: Promise<DownloadsCap | null> | null = null;
/** The artifact viewer's save prompt, when the game runs inside it. */
export function downloads(): Promise<DownloadsCap | null> {
  if (!downloadsCap) downloadsCap = window.claude ? (window.claude.use('downloads') as Promise<DownloadsCap | null>).catch(() => null) : Promise.resolve(null);
  return downloadsCap;
}

/** Share sheet first (phones), then the artifact viewer's save prompt, then a plain download link. */
export async function shareFile(blob: Blob, filename: string, text: string): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'shared';
  }
  const dl = await downloads();
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined' || code === 'rate_limited') return 'declined';
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

// ------------------------------------------------------------------ challenges

const b64 = (t: string) => btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (t: string) => atob(t.replace(/-/g, '+').replace(/_/g, '/'));

/** A short code that carries the mode, map, mutators and wave to beat. */
export function challengeCode(c: Challenge) {
  return 'HM' + b64([c.mode, c.map, c.muts.join('+'), c.wave, c.kills].join('|'));
}

export function parseChallenge(code: string): Challenge | null {
  const m = code.trim().match(/HM([A-Za-z0-9_-]{6,})/);
  if (!m) return null;
  try {
    const [mode, map, muts, wave, kills] = unb64(m[1]).split('|');
    // A Daily Challenge from another day is replayed as an endless run with that day's setup.
    const md = mode === 'daily' ? 'endless' : mode;
    if (!MODES.some((x) => x.id === md) || !MAPS.some((x) => x.id === map)) return null;
    const w = Number(wave);
    if (!(w >= 1 && w < 1000)) return null;
    return { mode: md, map, muts: (muts ? muts.split('+') : []).filter((id) => MUTATORS.some((x) => x.id === id)), wave: w, kills: Number(kills) || 0 };
  } catch {
    return null;
  }
}

/** A link that opens the game; outside the artifact viewer it also carries the challenge. */
export function challengeLink(code: string) {
  let framed = true;
  try {
    framed = window.top !== window;
  } catch {
    framed = true;
  }
  if (!framed && /^https?:$/.test(location.protocol)) return `${location.origin}${location.pathname}#c=${code}`;
  return ARTIFACT_URL;
}
