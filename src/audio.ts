// Synthesized sound effects and a procedural soundtrack, so the game needs no audio files.

export type SfxKind =
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'rifle'
  | 'minigun'
  | 'flamer'
  | 'rocket'
  | 'hit'
  | 'death'
  | 'coin'
  | 'hurt'
  | 'reload'
  | 'explode'
  | 'wave'
  | 'perk'
  | 'buy'
  | 'dash'
  | 'boss'
  | 'empty'
  | 'throw'
  | 'power'
  | 'combo'
  | 'nuke'
  | 'spit'
  | 'splat'
  | 'heart'
  | 'pounce'
  | 'scream'
  | 'raise'
  | 'clank'
  | 'levelup'
  | 'launcher'
  | 'sniper'
  | 'freeze'
  | 'tesla'
  | 'zap'
  | 'slam'
  | 'shatter'
  | 'plate';

export type MusicMood = 'menu' | 'calm' | 'fight' | 'boss' | 'off';

// E minor-ish riffs, one note per 8th. 0 = rest.
const BASS_FIGHT = [40, 40, 52, 40, 43, 40, 47, 45, 40, 40, 52, 40, 50, 48, 47, 43];
const BASS_BOSS = [38, 38, 50, 38, 41, 38, 44, 43, 38, 38, 50, 38, 46, 45, 44, 41];
const LEAD = [64, 0, 67, 0, 71, 0, 69, 67, 64, 0, 62, 0, 64, 0, 0, 0];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last: Partial<Record<SfxKind, number>> = {};
  private mood: MusicMood = 'menu';
  private intensity = 0;
  private step = 0;
  private nextStepTime = 0;
  private drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('horde-muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(comp);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.55;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      const len = this.ctx.sampleRate * 3;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startDrone();
      this.nextStepTime = this.ctx.currentTime + 0.1;
      window.setInterval(() => this.schedule(), 25);
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem('horde-muted', this.muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  setMusic(mood: MusicMood, intensity = 0) {
    this.mood = mood;
    this.intensity = intensity;
    if (this.drone && this.ctx) {
      const v = mood === 'off' ? 0 : mood === 'menu' ? 0.22 : mood === 'boss' ? 0.2 : 0.12;
      this.drone.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.6);
      const base = mood === 'boss' ? midi(26) : midi(28);
      this.drone.osc[0].frequency.setTargetAtTime(base, this.ctx.currentTime, 0.5);
      this.drone.osc[1].frequency.setTargetAtTime(base * 1.007, this.ctx.currentTime, 0.5);
    }
  }

  private startDrone() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 380;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain).connect(filt.frequency);
    lfo.start();
    const osc = [ctx.createOscillator(), ctx.createOscillator()];
    for (const o of osc) {
      o.type = 'sawtooth';
      o.frequency.value = midi(28);
      o.connect(filt);
      o.start();
    }
    filt.connect(gain).connect(this.musicBus!);
    this.drone = { osc, gain };
    this.setMusic(this.mood, this.intensity);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.currentTime > this.nextStepTime + 1) this.nextStepTime = ctx.currentTime + 0.05;
    while (this.nextStepTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextStepTime);
      const bpm = this.mood === 'boss' ? 150 : this.mood === 'fight' ? 128 + this.intensity * 14 : 110;
      this.nextStepTime += 60 / bpm / 2;
      this.step = (this.step + 1) % 16;
    }
  }

  private playStep(s: number, t: number) {
    const mood = this.mood;
    if (mood === 'off' || mood === 'menu') {
      if (mood === 'menu' && s % 8 === 0) this.kick(t, 0.35);
      return;
    }
    const fight = mood === 'fight' || mood === 'boss';
    const hot = this.intensity > 0.45 || mood === 'boss';
    if (s % 4 === 0) this.kick(t, fight ? 0.8 : 0.5);
    if (fight && hot && s % 4 === 2 && Math.random() < 0.5) this.kick(t, 0.45);
    if (fight && (s === 4 || s === 12)) this.snare(t);
    if (fight && (s % 2 === 1 || hot)) this.hat(t, s % 2 ? 0.12 : 0.06);
    if (mood === 'calm') {
      if (s % 2 === 0) this.bass(t, midi(BASS_FIGHT[s] - 12), 0.18);
      return;
    }
    const line = mood === 'boss' ? BASS_BOSS : BASS_FIGHT;
    this.bass(t, midi(line[s] - 12), 0.28);
    if (hot && LEAD[s]) this.lead(t, midi(LEAD[s] - (mood === 'boss' ? 2 : 0)));
  }

  private kick(t: number, v: number) {
    this.tone(t, 0.25, 140, 38, v, 'sine', this.musicBus!);
  }

  private snare(t: number) {
    this.burst(t, 0.16, 1800, 0.35, 'bandpass', this.musicBus!);
    this.tone(t, 0.08, 220, 160, 0.15, 'triangle', this.musicBus!);
  }

  private hat(t: number, v: number) {
    this.burst(t, 0.04, 7000, v, 'highpass', this.musicBus!);
  }

  private bass(t: number, f: number, v: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    filt.type = 'lowpass';
    filt.Q.value = 6;
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(140, t + 0.18);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(filt).connect(g).connect(this.musicBus!);
    o.start(t);
    o.stop(t + 0.25);
  }

  private lead(t: number, f: number) {
    this.tone(t, 0.2, f, f, 0.06, 'square', this.musicBus!);
  }

  play(kind: SfxKind, volume = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || this.muted) return;
    // Rate-limit so 40 zombies dying at once doesn't clip.
    const now = ctx.currentTime;
    const gap = kind === 'hit' ? 0.035 : kind === 'coin' ? 0.04 : kind === 'flamer' ? 0.07 : kind === 'death' ? 0.03 : kind === 'clank' ? 0.05 : kind === 'freeze' ? 0.08 : kind === 'shatter' ? 0.04 : 0.015;
    if (now - (this.last[kind] ?? -1) < gap) return;
    this.last[kind] = now;
    const bus = this.sfxBus;
    const v = volume;

    switch (kind) {
      case 'pistol':
        this.burst(now, 0.09, 1800, 0.5 * v, 'lowpass', bus);
        this.tone(now, 0.06, 180, 60, 0.25 * v, 'square', bus);
        break;
      case 'smg':
        this.burst(now, 0.06, 2400, 0.35 * v, 'lowpass', bus);
        this.tone(now, 0.04, 200, 90, 0.15 * v, 'square', bus);
        break;
      case 'minigun':
        this.burst(now, 0.05, 2600, 0.3 * v, 'lowpass', bus);
        this.tone(now, 0.03, 260, 120, 0.1 * v, 'square', bus);
        break;
      case 'rifle':
        this.burst(now, 0.08, 2800, 0.45 * v, 'lowpass', bus);
        this.tone(now, 0.05, 240, 70, 0.2 * v, 'sawtooth', bus);
        break;
      case 'shotgun':
        this.burst(now, 0.25, 1200, 0.85 * v, 'lowpass', bus);
        this.tone(now, 0.15, 120, 40, 0.45 * v, 'square', bus);
        break;
      case 'flamer':
        this.burst(now, 0.12, 700, 0.3 * v, 'lowpass', bus);
        break;
      case 'rocket':
        this.burst(now, 0.4, 900, 0.5 * v, 'bandpass', bus);
        this.tone(now, 0.3, 300, 80, 0.25 * v, 'sawtooth', bus);
        break;
      case 'throw':
        this.burst(now, 0.12, 2000, 0.2, 'bandpass', bus);
        break;
      case 'hit':
        this.burst(now, 0.04, 900, 0.18 * v, 'bandpass', bus);
        break;
      case 'splat':
        this.burst(now, 0.15, 400, 0.35 * v, 'lowpass', bus);
        this.tone(now, 0.12, 90, 50, 0.2 * v, 'sine', bus);
        break;
      case 'death':
        this.tone(now, 0.18, 160, 50, 0.22 * v, 'sawtooth', bus);
        this.burst(now, 0.12, 600, 0.2 * v, 'lowpass', bus);
        break;
      case 'coin':
        this.tone(now, 0.06, 1200, 1200, 0.07 * v, 'square', bus);
        this.tone(now + 0.05, 0.08, 1800, 1800, 0.07 * v, 'square', bus);
        break;
      case 'hurt':
        this.tone(now, 0.2, 300, 120, 0.35 * v, 'square', bus);
        break;
      case 'heart':
        this.tone(now, 0.12, 70, 40, 0.5, 'sine', bus);
        this.tone(now + 0.16, 0.1, 60, 35, 0.35, 'sine', bus);
        break;
      case 'reload':
        this.burst(now, 0.03, 3000, 0.2, 'highpass', bus);
        this.burst(now + 0.12, 0.04, 2500, 0.25, 'highpass', bus);
        break;
      case 'empty':
        this.burst(now, 0.02, 4000, 0.15, 'highpass', bus);
        break;
      case 'explode':
        this.burst(now, 0.7, 450, 1.0 * v, 'lowpass', bus);
        this.tone(now, 0.5, 100, 28, 0.6 * v, 'sine', bus);
        break;
      case 'nuke':
        this.burst(now, 2.2, 300, 1.2, 'lowpass', bus);
        this.tone(now, 2, 80, 20, 0.8, 'sine', bus);
        this.tone(now, 0.6, 1600, 200, 0.2, 'sawtooth', bus);
        break;
      case 'spit':
        this.burst(now, 0.1, 1200, 0.2, 'bandpass', bus);
        this.tone(now, 0.1, 500, 200, 0.1, 'triangle', bus);
        break;
      case 'wave':
        this.tone(now, 0.5, 110, 110, 0.3, 'sawtooth', bus);
        this.tone(now + 0.25, 0.8, 82, 82, 0.3, 'sawtooth', bus);
        break;
      case 'perk':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(now + i * 0.07, 0.12, f, f, 0.15, 'triangle', bus));
        break;
      case 'power':
        [392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(now + i * 0.05, 0.14, f, f, 0.14, 'square', bus));
        break;
      case 'combo':
        [659, 784, 988].forEach((f, i) => this.tone(now + i * 0.06, 0.1, f, f * 1.01, 0.13, 'sawtooth', bus));
        break;
      case 'buy':
        this.tone(now, 0.08, 880, 880, 0.15, 'triangle', bus);
        this.tone(now + 0.08, 0.12, 1320, 1320, 0.15, 'triangle', bus);
        break;
      case 'dash':
        this.burst(now, 0.15, 1500, 0.25, 'bandpass', bus);
        break;
      case 'boss':
        this.tone(now, 1.4, 60, 36, 0.55, 'sawtooth', bus);
        this.tone(now, 1.4, 63, 38, 0.45, 'sawtooth', bus);
        break;
      case 'pounce':
        this.burst(now, 0.2, 1100, 0.3 * v, 'bandpass', bus);
        this.tone(now, 0.25, 220, 520, 0.18 * v, 'sawtooth', bus);
        break;
      case 'scream':
        this.tone(now, 0.7, 900, 1400, 0.16, 'sawtooth', bus);
        this.tone(now, 0.7, 940, 1300, 0.12, 'square', bus);
        this.burst(now, 0.6, 3000, 0.18, 'bandpass', bus);
        break;
      case 'raise':
        this.tone(now, 0.9, 110, 220, 0.25, 'triangle', bus);
        this.tone(now + 0.1, 0.8, 165, 330, 0.15, 'sine', bus);
        break;
      case 'clank':
        this.tone(now, 0.08, 2400, 1900, 0.12 * v, 'square', bus);
        this.burst(now, 0.04, 5000, 0.12 * v, 'highpass', bus);
        break;
      case 'launcher':
        this.burst(now, 0.15, 600, 0.45 * v, 'lowpass', bus);
        this.tone(now, 0.12, 160, 70, 0.3 * v, 'sine', bus);
        break;
      case 'sniper':
        this.burst(now, 0.35, 3200, 0.8 * v, 'lowpass', bus);
        this.tone(now, 0.25, 300, 45, 0.45 * v, 'sawtooth', bus);
        break;
      case 'freeze':
        this.burst(now, 0.1, 5000, 0.12 * v, 'highpass', bus);
        break;
      case 'tesla':
      case 'zap':
        this.tone(now, 0.12, 1800, 300, 0.12 * v, 'sawtooth', bus);
        this.burst(now, 0.1, 4000, 0.18 * v, 'bandpass', bus);
        break;
      case 'slam':
        this.burst(now, 0.6, 250, 1.0, 'lowpass', bus);
        this.tone(now, 0.5, 70, 25, 0.7, 'sine', bus);
        break;
      case 'shatter':
        this.burst(now, 0.2, 6000, 0.25 * v, 'highpass', bus);
        this.tone(now, 0.1, 2600, 1800, 0.06 * v, 'triangle', bus);
        break;
      case 'plate':
        this.tone(now, 0.15, 900, 500, 0.2, 'square', bus);
        this.burst(now, 0.1, 3000, 0.25, 'bandpass', bus);
        break;
      case 'levelup':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(now + i * 0.09, 0.22, f, f, 0.16, 'triangle', bus));
        break;
    }
  }

  private tone(t: number, dur: number, f0: number, f1: number, vol: number, type: OscillatorType, bus: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType, bus: AudioNode) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 0.4);
    s.stop(t + dur + 0.02);
  }
}
