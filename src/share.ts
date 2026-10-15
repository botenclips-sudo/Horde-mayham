// Game-over share card: a 1200x630 image of the death scene with the run's stats,
// shared through the phone's share sheet (or downloaded where that isn't available).

import type { RunSummary } from './game';

const FONT = "'Black Ops One', 'Arial Black', system-ui, sans-serif";

export function makeShareCard(s: RunSummary, scene: HTMLCanvasElement, level: number, newBest: boolean): HTMLCanvasElement {
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
  x.textAlign = 'right';
  text('CAN YOU BEAT IT?', W - 50, H - 40, 30, '#ffd23f');
  return c;
}

/** Opens the share sheet with the card image; falls back to downloading the PNG. Returns what happened. */
export async function shareCard(card: HTMLCanvasElement, wave: number): Promise<'shared' | 'downloaded' | 'failed'> {
  const blob: Blob | null = await new Promise((res) => card.toBlob(res, 'image/png'));
  if (!blob) return 'failed';
  const file = new File([blob], `horde-mayhem-wave-${wave}.png`, { type: 'image/png' });
  const text = `I survived to wave ${wave} in Horde Mayhem. Can you beat it?`;
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'shared';
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
