// Co-op sync test: a host and a guest in two tabs (?local, plus ?local&relay for the relay path).
// Fails if they disagree on the wave or zombie count, or if either page throws.
// Usage: npm run test:coop
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
let failed = false;
for (const relay of [false, true]) {
const url = server.resolvedUrls.local[0] + '?local' + (relay ? '&relay' : '');
const ctx = await browser.newContext({ viewport: { width: 860, height: 400 } });
const errs = [];
const mk = async (n) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(n + ': ' + e)); await p.goto(url); await p.waitForFunction(() => window.ui); return p; };
const host = await mk('host');
const guest = await mk('guest');
await host.click('#coop-btn'); await host.fill('#co-name', 'Host'); await host.click('#co-host');
await host.waitForFunction(() => /\w{4}/.test(document.getElementById('co-codeview')?.textContent || ''), null, { timeout: 10000 });
const code = (await host.textContent('#co-codeview')).replace(/[^A-Z0-9]/gi, '').slice(-4);
await guest.click('#coop-btn'); await guest.fill('#co-name', 'Guest'); await guest.fill('#co-code', code); await guest.click('#co-join');
await host.waitForTimeout(2500);
await host.click('#co-start').catch((e) => errs.push('start: ' + e));
await host.waitForTimeout(2000);
for (let i = 0; i < 6; i++) {
  await host.evaluate(() => { const g = window.game; g.p.hp = 9999; g.input.mouse.down = true; });
  await guest.evaluate(() => { const g = window.game; g.p.hp = 9999; g.input.mouse.down = true; });
  await host.waitForTimeout(2500);
  const h = await host.evaluate(() => ({ s: window.game.state, w: window.game.wave, z: window.game.zombies.filter((z) => !z.dead).length, allies: window.game.allies.length }));
  const g = await guest.evaluate(() => ({ s: window.game.state, w: window.game.wave, z: window.game.zombies.filter((z) => !z.dead).length, allies: window.game.allies.length }));
  // Allow a zombie or two of drift: snapshots are a few frames apart.
  const ok = h.s === g.s && h.w === g.w && Math.abs(h.z - g.z) <= 2 && h.allies === 1 && g.allies === 1;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${relay ? 'relay ' : 'direct'} host`, JSON.stringify(h), 'guest', JSON.stringify(g));
}
if (errs.length) {
  failed = true;
  console.log('errors', errs);
}
await ctx.close();
}
await browser.close();
await server.close();
console.log(failed ? 'COOP FAILED' : 'COOP PASSED');
process.exit(failed ? 1 : 0);
