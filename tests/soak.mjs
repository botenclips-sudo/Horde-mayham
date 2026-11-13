// Headless soak test: plays every map through boss waves with a god-mode bot and
// fails on JS errors, NaN positions, or waves that never end.
// Usage: npm run test:soak   (starts its own Vite dev server)
import { createServer } from 'vite';
import { chromium } from 'playwright';

const MAPS = process.env.SOAK_MAPS?.split(',') ?? ['lot', 'gas', 'subway', 'graveyard', 'refinery', 'outpost', 'lab'];
const START_WAVES = process.env.SOAK_WAVES?.split(',').map(Number) ?? [1, 4, 9, 14, 19, 24, 29, 34]; // each run plays the next 2 waves (covers mini-bosses and every boss)
// The bot is a weak player, so after FIGHT_S seconds of a wave the test starts dealing huge damage to every
// zombie the game lets you hit. If the wave still hasn't ended CLEAR_S seconds later, something is unkillable
// or wedged somewhere (the "wave never ends" bug class).
const FIGHT_S = Number(process.env.SOAK_FIGHT ?? 60);
const CLEAR_S = Number(process.env.SOAK_CLEAR ?? 45);
const WAVE_LIMIT_S = FIGHT_S + CLEAR_S;

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => m.type() === 'error' && !/supabase|Failed to load resource|net::/i.test(m.text()) && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.game);

let failed = false;
for (const map of MAPS) {
  for (const start of START_WAVES) {
    const res = await page.evaluate(
      ({ map, start, limit, FIGHT_S }) => {
        const g = window.game;
        g.configure('classic');
        g.setMap(map);
        g.newRun();
        g.wave = start - 1;
        g.stats.damage *= 6; // the bot is a bad shot; keep waves moving so the test stays fast
        g.startWave();
        const out = { map, start, waves: [], nan: false, error: null };
        let t = 0;
        let waveT = 0;
        const home = { x: g.p.x, y: g.p.y };
        const ignore = new Map(); // zombie id -> time to stop ignoring it
        let focus = null;
        let focusHp = 0;
        let focusT = 0;
        let lastAlive = 0;
        let quietT = 0;
        const target = start + 1;
        try {
          while (g.wave <= target && t < limit * 2.5) {
            const p = g.p;
            p.hp = 99999;
            // Bot: aim at the nearest zombie and hold the trigger, drift toward the map center.
            let best = null;
            let bd = Infinity;
            for (const z of g.zombies) {
              if (z.dead || (ignore.get(z.id) ?? 0) > t) continue;
              const d = (z.x - p.x) ** 2 + (z.y - p.y) ** 2;
              if (d < bd) (bd = d), (best = z);
            }
            // A target that takes no damage for 3s (shield in the way, point-blank) gets skipped for a while.
            if (best !== focus) (focus = best), (focusHp = best?.hp ?? 0), (focusT = 0);
            else if (best && best.hp < focusHp - 1) (focusHp = best.hp), (focusT = 0);
            else if ((focusT += 1 / 60) > 3 && best) ignore.set(best.id, t + 5);
            // Nobody died for 25s: walk the bot back to its spawn point, like a player repositioning.
            const alive = g.zombies.filter((z) => !z.dead).length;
            if (alive !== lastAlive) (lastAlive = alive), (quietT = 0);
            else if ((quietT += 1 / 60) > 25) (p.x = home.x), (p.y = home.y), (quietT = 0);
            g.input.mouse.down = !!best;
            // Kite: back off when something is close, close in when everything is far away.
            const keys = g.input.keys;
            for (const k of ['w', 'a', 's', 'd']) keys.delete(k);
            if (best) {
              const d = Math.sqrt(bd);
              const sign = d < 170 ? -1 : d > 380 ? 1 : 0;
              // Right on top of us: step out toward the map center.
              const close = d < 40;
              const dx = close ? 1100 - p.x : (best.x - p.x) * sign;
              const dy = close ? 800 - p.y : (best.y - p.y) * sign;
              // Strafe sideways too so the bot doesn't pin itself in a corner.
              const sx = dx - (best.y - p.y) * 0.6;
              const sy = dy + (best.x - p.x) * 0.6;
              if (sign !== 0 || d < 260) {
                if (sx > 20) keys.add('d');
                if (sx < -20) keys.add('a');
                if (sy > 20) keys.add('s');
                if (sy < -20) keys.add('w');
              }
            }
            if (best) {
              const s = g.toScreen(best.x, best.y);
              g.input.mouse.x = s.x;
              g.input.mouse.y = s.y;
            }
            if (waveT > FIGHT_S) for (const z of g.zombies) if (!z.dead) g.damageZombie(z, 1e7, 0, false, 0, true);
            g.update(1 / 60);
            t += 1 / 60;
            waveT += 1 / 60;
            for (const z of g.zombies) if (!Number.isFinite(z.x) || !Number.isFinite(z.y) || !Number.isFinite(z.hp)) out.nan = true;
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) out.nan = true;
            if (g.state === 'between') {
              out.waves.push({ wave: g.wave, s: Math.round(waveT), forced: waveT > FIGHT_S });
              waveT = 0;
              if (g.wave >= target) break;
              g.startWave();
            }
            if (waveT > limit) {
              out.stuck = { wave: g.wave, player: [Math.round(g.p.x), Math.round(g.p.y)], alive: g.zombies.filter((z) => !z.dead).length, left: g.zombies.filter((z) => !z.dead).map((z) => `${z.def.kind}@${Math.round(z.x)},${Math.round(z.y)} v${Math.round(Math.hypot(z.vx ?? 0, z.vy ?? 0))} hp${Math.round(z.hp)}`).slice(0, 6), toSpawn: g.toSpawn };
              break;
            }
          }
        } catch (e) {
          out.error = String(e && e.stack ? e.stack : e);
        }
        g.state = 'menu';
        return out;
      },
      { map, start, limit: WAVE_LIMIT_S, FIGHT_S },
    );
    const bad = res.error || res.nan || res.stuck || res.waves.length < 2;
    if (bad) failed = true;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${map.padEnd(9)} waves ${start}-${start + 1}: ${res.waves.map((w) => `w${w.wave} ${w.s}s${w.forced ? "*" : ""}`).join(', ')}${res.nan ? ' NaN!' : ''}${res.stuck ? ' STUCK ' + JSON.stringify(res.stuck) : ''}${res.error ? '\n' + res.error : ''}`);
  }
}
if (errors.length) {
  failed = true;
  console.log('Page errors:\n' + [...new Set(errors)].slice(0, 10).join('\n'));
}
await browser.close();
await server.close();
console.log(failed ? 'SOAK FAILED' : 'SOAK PASSED');
process.exit(failed ? 1 : 0);
