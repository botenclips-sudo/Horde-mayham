// Global leaderboards on Supabase (plain REST, no SDK). The publishable key is public by design:
// the table's row-level security only lets anyone read scores and insert sane new ones.
// The table and its rules are in supabase/leaderboard.sql.

export const SUPABASE_URL = 'https://xmxxxetnjyyvkmvakzji.supabase.co';
// Supabase publishable key: safe in client code. Never put a secret (sb_secret_ / service_role) key here.
export const SUPABASE_KEY = 'sb_publishable_jsKS5CBD7kRKoTmoPATsZw_C1Uwyo5a';

export const leaderboardsOn = () => !!SUPABASE_KEY;

export interface Score {
  name: string;
  wave: number;
  kills: number;
  map: string;
}

/** Endless has one all-time board; the Daily Challenge gets a fresh board every day. */
export const boardFor = (mode: string, day: string) => (mode === 'daily' ? `daily-${day}` : mode === 'endless' ? 'endless' : '');

export const cleanName = (n: string) =>
  n
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);

/** A failed leaderboard call, with enough detail to tell setup problems apart from bad signal. */
export class LeaderboardError extends Error {
  constructor(
    readonly status: number, // 0 = no response at all (offline, blocked)
    readonly code = '',
  ) {
    super(`leaderboard ${status}${code ? ' ' + code : ''}`);
  }

  /** Short reason shown to the player (and to the owner when something isn't set up). */
  get hint() {
    if (this.status === 0) return 'no connection';
    if (this.status === 404 || this.code === 'PGRST205' || this.code === '42P01') return `error ${this.status}: scores table missing`;
    if (this.status === 401 || this.status === 403 || this.code === '42501') return `error ${this.status}: no permission`;
    if (this.code === '23514') return 'score rejected';
    return `error ${this.status}${this.code ? ' ' + this.code : ''}`;
  }
}

async function call(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new LeaderboardError(0);
  }
  if (!res.ok) {
    let code = '';
    try {
      code = String(((await res.json()) as { code?: string }).code ?? '');
    } catch {
      /* not JSON */
    }
    throw new LeaderboardError(res.status, code);
  }
  return res;
}

/** Why a leaderboard call failed, in a few words. */
export const lbHint = (e: unknown) => (e instanceof LeaderboardError ? e.hint : 'unexpected error');

// Publishable keys aren't JWTs, so they go in the apikey header only (no Authorization header).
const headers = () => ({ apikey: SUPABASE_KEY, 'Content-Type': 'application/json' });

/** Top scores on a board, one row per player name (their best). */
export async function topScores(board: string, n = 10): Promise<Score[]> {
  const q = `${SUPABASE_URL}/rest/v1/scores?select=name,wave,kills,map&board=eq.${encodeURIComponent(board)}&order=wave.desc,kills.desc&limit=200`;
  const res = await call(q, { headers: headers() });
  const rows = (await res.json()) as Score[];
  const seen = new Set<string>();
  const out: Score[] = [];
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

export async function postScore(board: string, s: Score): Promise<void> {
  await call(`${SUPABASE_URL}/rest/v1/scores`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ board, name: s.name, wave: s.wave, kills: s.kills, map: s.map }),
  });
}
