// Online co-op plumbing. Players find each other through a signaling channel (Supabase Realtime
// broadcast, or a BroadcastChannel between tabs when testing with ?local), then the host opens a
// WebRTC data connection to each guest. If a direct connection can't be made (some mobile networks
// block it), messages fall back to the signaling channel itself at a lower rate.

import { SUPABASE_KEY, SUPABASE_URL } from './leaderboard';

export type NetMsg = { t: string; [k: string]: unknown };

const params = new URLSearchParams(location.search);
/** ?local: tabs in one browser find each other without the internet (for testing). */
const LOCAL = params.has('local');
/** ?relay: skip direct connections and send everything through the signaling server. */
const FORCE_RELAY = params.has('relay');

const ICE: RTCIceServer[] = LOCAL ? [] : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const MAX_GUESTS = 3;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

interface Signal {
  send(m: Record<string, unknown>): void;
  onmsg: (m: Record<string, unknown>) => void;
  ondown: () => void;
  close(): void;
}

function localSignal(room: string): Promise<Signal> {
  const bc = new BroadcastChannel(`hm-room-${room}`);
  const s: Signal = { send: (m) => bc.postMessage(m), onmsg: () => {}, ondown: () => {}, close: () => bc.close() };
  bc.onmessage = (e) => s.onmsg(e.data);
  return Promise.resolve(s);
}

/** A tiny Phoenix-protocol client for one Supabase Realtime broadcast channel. */
function supabaseSignal(room: string): Promise<Signal> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_KEY)}&vsn=1.0.0`);
    const topic = `realtime:horde-${room}`;
    let ref = 1;
    let joined = false;
    let beat = 0;
    const out = (event: string, payload: unknown, t = topic) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ topic: t, event, payload, ref: String(++ref), join_ref: t === topic ? '1' : undefined }));
    };
    const s: Signal = {
      send: (m) => joined && out('broadcast', { type: 'broadcast', event: 'm', payload: m }),
      onmsg: () => {},
      ondown: () => {},
      close: () => {
        window.clearInterval(beat);
        out('phx_leave', {});
        ws.close();
      },
    };
    const fail = (why: string) => {
      window.clearTimeout(timer);
      window.clearInterval(beat);
      if (!joined) reject(new Error(why));
      else s.ondown();
    };
    const timer = window.setTimeout(() => {
      fail('timeout');
      ws.close();
    }, 9000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '', enabled: false }, postgres_changes: [], private: false } }, ref: '1', join_ref: '1' }));
      beat = window.setInterval(() => out('heartbeat', {}, 'phoenix'), 25000);
    };
    ws.onmessage = (e) => {
      let m: { topic?: string; event?: string; ref?: string; payload?: { status?: string; payload?: Record<string, unknown> } };
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.topic !== topic) return;
      if (m.event === 'phx_reply' && m.ref === '1') {
        if (m.payload?.status === 'ok') {
          joined = true;
          window.clearTimeout(timer);
          resolve(s);
        } else fail('join refused');
      } else if (m.event === 'broadcast' && m.payload?.payload) s.onmsg(m.payload.payload);
      else if (m.event === 'phx_error' || m.event === 'phx_close') fail('channel closed');
    };
    ws.onerror = () => fail('socket error');
    ws.onclose = () => fail('socket closed');
  });
}

const connectSignal = (room: string) => (LOCAL ? localSignal(room) : supabaseSignal(room));

export class Peer {
  pc: RTCPeerConnection | null = null;
  rel: RTCDataChannel | null = null;
  fast: RTCDataChannel | null = null;
  lastSeen = performance.now();
  private lastRelay = 0;
  private iceQueue: RTCIceCandidateInit[] = [];

  constructor(
    public id: string,
    public name: string,
    private room: Room,
  ) {}

  get direct() {
    return this.rel?.readyState === 'open';
  }

  send(m: NetMsg, fast = false) {
    const json = JSON.stringify(m);
    if (fast && this.fast?.readyState === 'open') {
      // Drop snapshots rather than queue them up behind a slow link.
      if (this.fast.bufferedAmount < 64000) this.fast.send(json);
      return;
    }
    if (this.rel?.readyState === 'open') {
      this.rel.send(json);
      return;
    }
    // No direct link: go through the signaling server, with frequent updates thinned out.
    if (fast) {
      const now = performance.now();
      if (now - this.lastRelay < 120) return;
      this.lastRelay = now;
    }
    this.room.signal({ k: 'relay', to: this.id, d: m });
  }

  setup(initiator: boolean) {
    if (FORCE_RELAY) return;
    const pc = (this.pc = new RTCPeerConnection({ iceServers: ICE }));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.room.signal({ k: 'ice', to: this.id, c: e.candidate.toJSON() });
    };
    const wire = (ch: RTCDataChannel) => {
      ch.onmessage = (e) => {
        this.lastSeen = performance.now();
        try {
          this.room.deliver(this.id, JSON.parse(e.data));
        } catch {
          /* ignore garbage */
        }
      };
      if (ch.label === 'rel') this.rel = ch;
      else this.fast = ch;
    };
    if (initiator) {
      wire(pc.createDataChannel('rel'));
      wire(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      void pc
        .createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.room.signal({ k: 'offer', to: this.id, sdp: pc.localDescription!.toJSON() }))
        .catch(() => {});
    } else pc.ondatachannel = (e) => wire(e.channel);
  }

  async onSignal(m: Record<string, unknown>) {
    if (FORCE_RELAY) return;
    if (m.k === 'offer') {
      if (!this.pc) this.setup(false);
      const pc = this.pc!;
      await pc.setRemoteDescription(m.sdp as RTCSessionDescriptionInit);
      await pc.setLocalDescription(await pc.createAnswer());
      this.room.signal({ k: 'answer', to: this.id, sdp: pc.localDescription!.toJSON() });
      this.flushIce();
    } else if (m.k === 'answer' && this.pc) {
      await this.pc.setRemoteDescription(m.sdp as RTCSessionDescriptionInit);
      this.flushIce();
    } else if (m.k === 'ice') {
      this.iceQueue.push(m.c as RTCIceCandidateInit);
      this.flushIce();
    }
  }

  private flushIce() {
    const pc = this.pc;
    if (!pc?.remoteDescription) return;
    for (const c of this.iceQueue.splice(0)) pc.addIceCandidate(c).catch(() => {});
  }

  close() {
    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }
  }
}

/** One co-op room: the host plus up to three guests, each guest talking only to the host. */
export class Room {
  readonly me = Math.random().toString(36).slice(2, 10);
  peers = new Map<string, Peer>();
  /** Guests can still join (closed once the host starts a run). */
  open = true;
  onmsg: (from: string, m: NetMsg) => void = () => {};
  onpeers: () => void = () => {};
  onclose: (why: string) => void = () => {};
  private sig: Signal | null = null;
  private alive = 0;
  private closed = false;

  private constructor(
    public code: string,
    public isHost: boolean,
    public name: string,
  ) {}

  static async host(name: string): Promise<Room> {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const room = new Room(code, true, name);
    await room.connect();
    return room;
  }

  static async join(code: string, name: string): Promise<Room> {
    const room = new Room(code.toUpperCase(), false, name);
    await room.connect();
    await new Promise<void>((resolve, reject) => {
      const done = (err?: string) => {
        window.clearTimeout(timer);
        window.clearInterval(knock);
        room.welcomed = null;
        if (err) {
          room.close();
          reject(new Error(err));
        } else resolve();
      };
      room.welcomed = done;
      const hello = () => room.signal({ k: 'hello', name });
      hello();
      // Knock a few times in case the first one is lost.
      const knock = window.setInterval(hello, 1500);
      const timer = window.setTimeout(() => done('No game with that code. Check it and try again.'), 7000);
    });
    return room;
  }

  /** Set while a guest waits for the host to answer its hello. */
  private welcomed: ((err?: string) => void) | null = null;

  private async connect() {
    this.sig = await connectSignal(this.code);
    this.sig.onmsg = (m) => void this.onSignal(m);
    this.sig.ondown = () => this.close('Lost the connection to the co-op server.');
    this.alive = window.setInterval(() => this.tick(), 1000);
  }

  signal(m: Record<string, unknown>) {
    this.sig?.send({ ...m, from: this.me });
  }

  /** Called by peers when a message arrives over a direct link. */
  deliver(from: string, m: NetMsg) {
    if (m.t === 'ping') return;
    if (m.t === 'bye') {
      this.drop(from);
      return;
    }
    this.onmsg(from, m);
  }

  private async onSignal(m: Record<string, unknown>) {
    const from = String(m.from ?? '');
    if (!from || from === this.me || (m.to && m.to !== this.me)) return;
    if (this.isHost && m.k === 'hello') {
      const known = this.peers.get(from);
      if (known) {
        // A repeated knock from a guest we already let in.
        this.signal({ k: 'welcome', to: from });
        return;
      }
      if (!this.open) return this.signal({ k: 'nope', to: from, why: 'That game has already started.' });
      if (this.peers.size >= MAX_GUESTS) return this.signal({ k: 'nope', to: from, why: 'That game is full (4 players).' });
      const p = new Peer(from, String(m.name ?? 'Player').slice(0, 16), this);
      this.peers.set(from, p);
      this.signal({ k: 'welcome', to: from });
      p.setup(true);
      this.onpeers();
      return;
    }
    if (!this.isHost && m.k === 'welcome') {
      if (!this.peers.has(from)) this.peers.set(from, new Peer(from, 'Host', this));
      this.welcomed?.();
      return;
    }
    if (!this.isHost && m.k === 'nope') {
      this.welcomed?.(String(m.why));
      return;
    }
    const peer = this.peers.get(from);
    if (!peer) return;
    peer.lastSeen = performance.now();
    if (m.k === 'relay') this.deliver(from, m.d as NetMsg);
    else if (m.k === 'bye') this.drop(from);
    else if (m.k === 'offer' || m.k === 'answer' || m.k === 'ice') await peer.onSignal(m).catch(() => {});
  }

  private tick() {
    const now = performance.now();
    for (const p of [...this.peers.values()]) {
      p.send({ t: 'ping' }, true);
      if (now - p.lastSeen > 12000) this.drop(p.id);
    }
  }

  private drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.close();
    this.peers.delete(id);
    if (!this.isHost) this.close('The host left the game.');
    else this.onpeers();
  }

  /** How each guest is connected, for the lobby list. */
  linkOf(id: string) {
    const p = this.peers.get(id);
    return !p ? '' : p.direct ? 'direct' : 'relay';
  }

  send(to: string, m: NetMsg, fast = false) {
    this.peers.get(to)?.send(m, fast);
  }

  broadcast(m: NetMsg, fast = false) {
    for (const p of this.peers.values()) p.send(m, fast);
  }

  close(why = '') {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.alive);
    for (const p of this.peers.values()) {
      p.send({ t: 'bye' });
      p.close();
    }
    this.signal({ k: 'bye' });
    this.peers.clear();
    window.setTimeout(() => this.sig?.close(), 200);
    this.onclose(why);
  }
}
