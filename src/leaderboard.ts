// Global leaderboards on Supabase (plain REST, no SDK). The anon key is public by design:
// the table's row-level security only lets anyone read scores and insert sane new ones.
// The table and its rules are in supabase/leaderboard.sql.

const URL = 'https://xmxxxetnjyyvkmvakzji.supabase.co';
const KEY = ''; // Supabase anon (public) key; leaderboards stay hidden until it is set

export const leaderboardsOn = () => !!KEY;

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

const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });

/** Top scores on a board, one row per player name (their best). */
export async function topScores(board: string, n = 10): Promise<Score[]> {
  const q = `${URL}/rest/v1/scores?select=name,wave,kills,map&board=eq.${encodeURIComponent(board)}&order=wave.desc,kills.desc&limit=200`;
  const res = await fetch(q, { headers: headers() });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
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
  const res = await fetch(`${URL}/rest/v1/scores`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ board, name: s.name, wave: s.wave, kills: s.kills, map: s.map }),
  });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
}
