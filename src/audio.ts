// Tiny synthesized sound effects, so the game needs no audio files.

type Kind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'hit' | 'death' | 'coin' | 'hurt' | 'reload' | 'explode' | 'wave' | 'perk' | 'buy' | 'dash' | 'boss' | 'empty';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last: Partial<Record<Kind, number>> = {};
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  play(kind: Kind, volume = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    // Rate-limit so 40 zombies dying at once doesn't clip.
    const now = ctx.currentTime;
    const gap = kind === 'hit' ? 0.03 : kind === 'coin' ? 0.04 : 0.015;
    if (now - (this.last[kind] ?? -1) < gap) return;
    this.last[kind] = now;

    switch (kind) {
      case 'pistol':
        this.burst(now, 0.09, 1800, 0.5 * volume, 'lowpass');
        this.tone(now, 0.06, 180, 60, 0.25 * volume, 'square');
        break;
      case 'smg':
        this.burst(now, 0.06, 2400, 0.35 * volume, 'lowpass');
        this.tone(now, 0.04, 200, 90, 0.15 * volume, 'square');
        break;
      case 'rifle':
        this.burst(now, 0.08, 2800, 0.45 * volume, 'lowpass');
        this.tone(now, 0.05, 240, 70, 0.2 * volume, 'sawtooth');
        break;
      case 'shotgun':
        this.burst(now, 0.22, 1200, 0.8 * volume, 'lowpass');
        this.tone(now, 0.15, 120, 40, 0.4 * volume, 'square');
        break;
      case 'hit':
        this.burst(now, 0.04, 900, 0.18 * volume, 'bandpass');
        break;
      case 'death':
        this.tone(now, 0.18, 160, 50, 0.22 * volume, 'sawtooth');
        this.burst(now, 0.12, 600, 0.2 * volume, 'lowpass');
        break;
      case 'coin':
        this.tone(now, 0.06, 1200, 1200, 0.08 * volume, 'square');
        this.tone(now + 0.05, 0.08, 1800, 1800, 0.08 * volume, 'square');
        break;
      case 'hurt':
        this.tone(now, 0.2, 300, 120, 0.35 * volume, 'square');
        break;
      case 'reload':
        this.burst(now, 0.03, 3000, 0.2, 'highpass');
        this.burst(now + 0.12, 0.04, 2500, 0.25, 'highpass');
        break;
      case 'empty':
        this.burst(now, 0.02, 4000, 0.15, 'highpass');
        break;
      case 'explode':
        this.burst(now, 0.5, 500, 0.9 * volume, 'lowpass');
        this.tone(now, 0.4, 90, 30, 0.5 * volume, 'sine');
        break;
      case 'wave':
        this.tone(now, 0.5, 110, 110, 0.3, 'sawtooth');
        this.tone(now + 0.25, 0.7, 82, 82, 0.3, 'sawtooth');
        break;
      case 'perk':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(now + i * 0.07, 0.12, f, f, 0.15, 'triangle'));
        break;
      case 'buy':
        this.tone(now, 0.08, 880, 880, 0.15, 'triangle');
        this.tone(now + 0.08, 0.12, 1320, 1320, 0.15, 'triangle');
        break;
      case 'dash':
        this.burst(now, 0.15, 1500, 0.25, 'bandpass');
        break;
      case 'boss':
        this.tone(now, 1.2, 60, 40, 0.5, 'sawtooth');
        this.tone(now, 1.2, 63, 42, 0.4, 'sawtooth');
        break;
    }
  }

  private tone(t: number, dur: number, f0: number, f1: number, vol: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.3);
    s.stop(t + dur + 0.02);
  }
}
