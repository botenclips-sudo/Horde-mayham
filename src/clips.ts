// Replay clips: the canvas (plus game audio) is recorded all the time by two overlapping
// recorders, so whenever something big happens the older one already holds the last
// 8 to 16 seconds. Grabbing a clip stops that recorder, keeps its video and restarts it.

export interface Clip {
  label: string;
  blob: Blob;
  ext: string;
  url: string;
}

const SEGMENT = 16; // seconds each recorder runs before restarting
const TYPES: [string, string][] = [
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
];

interface Slot {
  rec: MediaRecorder;
  started: number;
  chunks: Blob[];
  want: string | null;
}

export class ClipRecorder {
  clips: Clip[] = [];
  private stream: MediaStream | null = null;
  private slots: Slot[] = [];
  private type: [string, string] | null = null;
  private timer = 0;
  private second = 0;
  private ending = false;
  private pending = false;
  private lastMark = 0;
  enabled: boolean;
  onClip: ((c: Clip) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private audio: () => MediaStream | null,
  ) {
    let on = '1';
    try {
      on = localStorage.getItem('horde-clips') ?? '1';
    } catch {
      /* storage unavailable */
    }
    this.enabled = on === '1' && ClipRecorder.supported();
  }

  static supported() {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  setEnabled(on: boolean) {
    this.enabled = on && ClipRecorder.supported();
    try {
      localStorage.setItem('horde-clips', this.enabled ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (!this.enabled) this.stop();
  }

  /** Starts recording for a new run and forgets the previous run's clips. */
  start() {
    this.stop();
    for (const c of this.clips) URL.revokeObjectURL(c.url);
    this.clips = [];
    if (!this.enabled) return;
    try {
      this.type = this.type ?? TYPES.find(([t]) => MediaRecorder.isTypeSupported(t)) ?? null;
      if (!this.type) return;
      const s = this.canvas.captureStream(30);
      const a = this.audio();
      for (const t of a?.getAudioTracks() ?? []) s.addTrack(t);
      this.stream = s;
      this.ending = false;
      this.slots = [this.newSlot()];
      // The second recorder starts half a segment later so one is always at least 8s in.
      this.second = window.setTimeout(() => {
        if (this.stream && !this.ending) this.slots.push(this.newSlot());
      }, (SEGMENT / 2) * 1000);
      this.timer = window.setInterval(() => this.tick(), 500);
    } catch {
      this.stop();
    }
  }

  stop() {
    window.clearInterval(this.timer);
    window.clearTimeout(this.second);
    for (const s of this.slots) {
      s.want = null;
      s.rec.onstop = null;
      try {
        if (s.rec.state !== 'inactive') s.rec.stop();
      } catch {
        /* already stopped */
      }
    }
    this.slots = [];
    for (const t of this.stream?.getVideoTracks() ?? []) t.stop();
    this.stream = null;
    this.pending = false;
  }

  pause(on: boolean) {
    for (const s of this.slots) {
      try {
        if (on && s.rec.state === 'recording') s.rec.pause();
        else if (!on && s.rec.state === 'paused') s.rec.resume();
      } catch {
        /* ignore */
      }
    }
  }

  /** Something clip-worthy happened: keep recording a moment longer, then save the clip. */
  mark(label: string, delay = 1800) {
    if (!this.stream || this.pending) return;
    const now = performance.now();
    if (now - this.lastMark < 4000) return;
    this.lastMark = now;
    this.pending = true;
    window.setTimeout(() => this.grab(label), delay);
  }

  private grab(label: string) {
    this.pending = false;
    const live = this.slots.filter((s) => s.rec.state !== 'inactive' && !s.want);
    if (!live.length) return null;
    const oldest = live.reduce((a, b) => (a.started < b.started ? a : b));
    if (performance.now() - oldest.started < 2500) return null;
    oldest.want = label;
    try {
      oldest.rec.stop();
    } catch {
      /* ignore */
    }
    return oldest;
  }

  /** End of the run: keep the last moments as a clip and stop recording. */
  finish(label: string) {
    if (!this.stream) return;
    window.clearInterval(this.timer);
    window.clearTimeout(this.second);
    this.ending = true;
    const kept = this.grab(label);
    for (const s of this.slots) {
      if (s === kept) continue;
      s.rec.onstop = null;
      try {
        if (s.rec.state !== 'inactive') s.rec.stop();
      } catch {
        /* ignore */
      }
    }
    this.slots = kept ? [kept] : [];
    if (!kept) this.stop();
  }

  private newSlot(): Slot {
    const [mime] = this.type!;
    const rec = new MediaRecorder(this.stream!, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
    const slot: Slot = { rec, started: performance.now(), chunks: [], want: null };
    rec.ondataavailable = (e) => {
      if (e.data.size) slot.chunks.push(e.data);
    };
    rec.onstop = () => {
      if (slot.want && slot.chunks.length) {
        const blob = new Blob(slot.chunks, { type: mime.split(';')[0] });
        const clip = { label: slot.want, blob, ext: this.type![1], url: URL.createObjectURL(blob) };
        this.clips.push(clip);
        // Keep memory in check: the last 4 clips are plenty.
        while (this.clips.length > 4) URL.revokeObjectURL(this.clips.shift()!.url);
        this.onClip?.(clip);
      }
      const i = this.slots.indexOf(slot);
      if (this.ending) this.stop();
      else if (i >= 0 && this.stream) this.slots[i] = this.newSlot();
    };
    rec.start(1000);
    return slot;
  }

  private tick() {
    const now = performance.now();
    for (const s of this.slots) {
      if (s.want || s.rec.state === 'inactive') continue;
      if (s.rec.state === 'recording' && now - s.started > SEGMENT * 1000) {
        try {
          s.rec.stop();
        } catch {
          /* ignore */
        }
      }
    }
  }
}
