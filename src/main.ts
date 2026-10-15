import './style.css';
import { Sfx } from './audio';
import { Game, RunSummary } from './game';
import { Input } from './input';
import { GUN_UNLOCK, LEVEL_REWARDS, MASTERY_MAX, masteryCost, meta, MISSIONS, RunResult, TRAINING, trainingCost, xpToNext } from './meta';
import { WEAPONS } from './data';
import { makeShareCard, shareCard } from './share';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
const input = new Input(canvas);
input.touchMode = window.matchMedia('(pointer: coarse)').matches;
const sfx = new Sfx();

const screens = ['menu', 'base', 'perks', 'shop', 'pause', 'over'];
function show(id: string | null) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  canvas.style.cursor = id === null && !input.touchMode ? 'none' : 'default';
}

const game = new Game(canvas, input, sfx, {
  onWaveCleared: () => showPerks(),
  onGameOver: (s) => setTimeout(() => showGameOver(s), 900),
  onPause: () => show('pause'),
});

function showPerks() {
  $('perks-title').textContent = `Wave ${game.wave} cleared!`;
  const wrap = $('perk-cards');
  wrap.innerHTML = '';
  for (const perk of game.rollPerks(3)) {
    const have = game.perkCounts.get(perk.id) ?? 0;
    const card = document.createElement('button');
    card.className = `card ${perk.rarity}`;
    card.innerHTML = `<div class="icon"></div><div class="name"></div><div class="desc"></div><div class="rarity"></div>`;
    (card.children[0] as HTMLElement).textContent = perk.icon;
    (card.children[1] as HTMLElement).textContent = perk.name + (have ? ` ${have + 1}` : '');
    (card.children[2] as HTMLElement).textContent = perk.desc;
    (card.children[3] as HTMLElement).textContent = perk.rarity;
    card.addEventListener('click', () => {
      game.pickPerk(perk);
      showShop();
    });
    wrap.appendChild(card);
  }
  show('perks');
}

function showShop() {
  $('shop-cash').textContent = `$${Math.floor(game.cash)}`;
  const wrap = $('shop-items');
  wrap.innerHTML = '';
  for (const item of game.shopItems()) {
    const b = document.createElement('button');
    b.className = 'shop-item';
    b.disabled = !item.enabled;
    b.innerHTML = `<div><div class="label"></div><div class="sub"></div></div><div class="price"></div>`;
    b.querySelector('.label')!.textContent = item.label;
    b.querySelector('.sub')!.textContent = item.sub;
    b.querySelector('.price')!.textContent = `$${item.price}`;
    b.addEventListener('click', () => {
      if (game.buy(item.id)) showShop();
    });
    wrap.appendChild(b);
  }
  show('shop');
}

let shareCanvas: HTMLCanvasElement | null = null;
let lastRun: RunSummary | null = null;

function showGameOver(s: RunSummary) {
  const scene = game.snapshot();
  const res = meta.finishRun(s.report);
  if (res.levelsGained.length) sfx.play('levelup');
  lastRun = s;
  const m = Math.floor(s.time / 60);
  const sec = Math.floor(s.time % 60)
    .toString()
    .padStart(2, '0');
  $('over-stats').innerHTML =
    `Reached <b>wave ${s.wave}</b>${res.newBest ? ' 🏆 new best!' : ` (best: wave ${meta.data.best})`}<br>` +
    `<b>${s.kills}</b> zombies killed<br>Best combo <b>x${s.bestCombo}</b><br><b>$${s.cash}</b> earned · survived <b>${m}:${sec}</b>`;
  $('over-rewards').innerHTML = rewardsHtml(res);
  shareCanvas = makeShareCard(s, scene, meta.data.level, res.newBest);
  $<HTMLImageElement>('share-img').src = shareCanvas.toDataURL('image/jpeg', 0.8);
  $('share-msg').textContent = '';
  refreshMenu();
  show('over');
}

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function rewardsHtml(r: RunResult) {
  const lines = [`<div class="gain"><span>+${r.xpGained} XP</span><span class="pink">+${r.brainsGained} 🧠</span></div>`];
  for (const lv of r.levelsGained) if (!r.rewards.some((x) => x.startsWith(`Level ${lv}:`))) lines.push(`<div class="lvup">LEVEL ${lv}!</div>`);
  for (const t of r.rewards) lines.push(`<div class="lvup">⬆ ${esc(t)}</div>`);
  for (const mi of r.missionsDone) lines.push(`<div class="mission-done">✔ ${esc(mi.text)} <span class="pink">+${mi.reward} 🧠</span></div>`);
  const d = meta.data;
  lines.push(`<div class="xpline">LV ${d.level} <div class="xpbar"><div style="width:${Math.round((d.xp / xpToNext(d.level)) * 100)}%"></div></div></div>`);
  return lines.join('');
}

// ------------------------------------------------------------------ base screen

let tab = 'armory';

function refreshMenu() {
  const d = meta.data;
  $('m-level').textContent = String(d.level);
  $('m-xp').style.width = `${Math.round((d.xp / xpToNext(d.level)) * 100)}%`;
  $('m-brains').textContent = String(d.brains);
  $('b-brains').textContent = String(d.brains);
  $('best').textContent = `wave ${d.best}`;
  // A dot on the Missions button when today's missions are untouched.
  $('m-missions').classList.toggle('hidden', d.missions.some((m) => m.progress > 0));
}

function openBase(t: string) {
  tab = t;
  meta.refreshMissions();
  renderBase();
  show('base');
}

function btn(label: string, cost: number | null, onClick: () => void, cls = '') {
  const b = document.createElement('button');
  b.className = `buy ${cls}`;
  b.innerHTML = cost === null ? esc(label) : `${esc(label)} <span>🧠 ${cost}</span>`;
  if (cost !== null && meta.data.brains < cost) b.disabled = true;
  b.addEventListener('click', () => {
    onClick();
    refreshMenu();
    renderBase();
  });
  return b;
}

function renderBase() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#base .tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('b-brains').textContent = String(meta.data.brains);
  const body = $('base-body');
  body.innerHTML = '';
  const d = meta.data;
  if (tab === 'armory') {
    const lo = document.createElement('p');
    lo.className = 'tag';
    lo.innerHTML =
      `Start every run with: <b>${d.loadout.slice(0, meta.slots()).map((id) => esc(WEAPONS.find((w) => w.id === id)!.name)).join(' + ')}</b>` +
      (meta.slots() < 2 ? ' · second slot unlocks at level 3' : '') +
      '<br>Mastery is permanent: +6% damage and +4% magazine per level, even when you buy the gun mid-run.';
    body.appendChild(lo);
    const grid = document.createElement('div');
    grid.className = 'meta-grid';
    for (const w of WEAPONS) {
      const owned = d.unlocked.includes(w.id);
      const lv = meta.mastery(w.id);
      const card = document.createElement('div');
      card.className = `meta-card${owned ? '' : ' locked'}${d.loadout.includes(w.id) && owned ? ' equipped' : ''}`;
      card.innerHTML = `<div class="name">${esc(w.name)}</div><div class="sub">Mastery ${lv}/${MASTERY_MAX}</div><div class="pips">${'■'.repeat(lv)}${'□'.repeat(MASTERY_MAX - lv)}</div>`;
      if (!owned) card.appendChild(btn('Unlock', GUN_UNLOCK[w.id], () => meta.unlockGun(w.id) && sfx.play('buy')));
      else {
        const inLo = d.loadout.slice(0, meta.slots()).includes(w.id);
        card.appendChild(btn(inLo ? 'Equipped' : 'Equip', null, () => meta.equip(w.id), inLo ? 'on' : ''));
        if (lv < MASTERY_MAX) card.appendChild(btn('Master', masteryCost(lv), () => meta.upgradeGun(w.id) && sfx.play('buy')));
      }
      grid.appendChild(card);
    }
    body.appendChild(grid);
  } else if (tab === 'training') {
    const grid = document.createElement('div');
    grid.className = 'meta-grid';
    for (const t of TRAINING) {
      const lv = meta.train(t.id);
      const card = document.createElement('div');
      card.className = 'meta-card';
      const next = lv < t.max ? `Next: ${t.desc(lv + 1)}` : 'Maxed out';
      card.innerHTML = `<div class="name">${t.icon} ${esc(t.name)} <small>${lv}/${t.max}</small></div><div class="sub">${lv ? esc(t.desc(lv)) : 'Not trained yet'}</div><div class="sub dim">${esc(next)}</div>`;
      if (lv < t.max) card.appendChild(btn('Train', trainingCost(t, lv), () => meta.buyTraining(t.id) && sfx.play('perk')));
      grid.appendChild(card);
    }
    body.appendChild(grid);
  } else if (tab === 'missions') {
    const list = document.createElement('div');
    list.className = 'missions';
    for (const m of d.missions) {
      const def = MISSIONS.find((x) => x.id === m.id)!;
      const row = document.createElement('div');
      row.className = `mission${m.done ? ' done' : ''}`;
      row.innerHTML = `<div class="mtext">${m.done ? '✔ ' : ''}${esc(def.text)}</div><div class="xpbar"><div style="width:${Math.round((m.progress / def.goal) * 100)}%"></div></div><div class="sub">${Math.floor(m.progress)} / ${def.goal} · <span class="pink">+${def.reward} 🧠</span></div>`;
      list.appendChild(row);
    }
    body.appendChild(list);
    const p = document.createElement('p');
    p.className = 'tag';
    const next = LEVEL_REWARDS.find((r) => r.level > d.level);
    p.innerHTML = `New missions every day. Progress counts across all your runs.<br>Level ${d.level}: ${d.xp} / ${xpToNext(d.level)} XP${next ? ` · next unlock at level ${next.level}: <b>${esc(next.text)}</b>` : ''}`;
    body.appendChild(p);
  } else {
    const t = d.totals;
    body.innerHTML = `<p class="tag">${t.runs} runs · ${t.kills.toLocaleString()} kills · ${t.bosses} bosses · best wave ${d.best}</p>
      <p class="sub">Your progress is saved on this device. Copy this code somewhere safe to move it to another browser or phone.</p>
      <textarea id="save-code" readonly rows="2"></textarea>
      <div class="row"><button id="save-copy" class="buy">Copy code</button></div>
      <p class="sub">Paste a code here to load it (this replaces your current progress):</p>
      <textarea id="load-code" rows="2"></textarea>
      <div class="row"><button id="save-load" class="buy">Load code</button><span id="save-msg" class="sub"></span></div>`;
    const code = $<HTMLTextAreaElement>('save-code');
    code.value = meta.exportCode();
    $('save-copy').addEventListener('click', () => {
      code.select();
      navigator.clipboard?.writeText(code.value).catch(() => document.execCommand('copy'));
      $('save-msg').textContent = 'Copied.';
    });
    $('save-load').addEventListener('click', () => {
      const ok = meta.importCode($<HTMLTextAreaElement>('load-code').value);
      refreshMenu();
      if (ok) renderBase();
      else $('save-msg').textContent = "That code didn't work.";
    });
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>('.base-btn, #base .tabs button'))
  b.addEventListener('click', () => {
    sfx.unlock();
    if ($('base').classList.contains('hidden')) openBase(b.dataset.tab!);
    else {
      tab = b.dataset.tab!;
      renderBase();
    }
  });
$('base-back').addEventListener('click', () => {
  refreshMenu();
  show('menu');
});
$('to-base').addEventListener('click', () => {
  game.newRun();
  game.state = 'menu';
  openBase('armory');
});
$('share').addEventListener('click', async () => {
  if (!shareCanvas || !lastRun) return;
  const r = await shareCard(shareCanvas, lastRun.wave);
  $('share-msg').textContent = r === 'downloaded' ? 'Saved the image. Post it anywhere!' : r === 'failed' ? 'Sharing is blocked here. Long-press the image to save it.' : '';
});

function goFullscreen() {
  if (!input.touchMode) return;
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen()
        .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
    }
  } catch {
    /* not allowed here, play windowed */
  }
}

function startRun() {
  sfx.unlock();
  goFullscreen();
  game.newRun();
  show(null);
  game.startWave();
}

refreshMenu();
$('play').addEventListener('click', startRun);
$('again').addEventListener('click', startRun);
$('next-wave').addEventListener('click', () => {
  sfx.unlock();
  show(null);
  game.startWave();
});
$('resume').addEventListener('click', () => {
  sfx.unlock();
  show(null);
  game.state = 'playing';
});
$('quit').addEventListener('click', () => {
  // Quitting still banks XP, brains and mission progress.
  if (game.wave > 0) meta.finishRun(game.summary().report);
  refreshMenu();
  game.newRun();
  game.state = 'menu';
  show('menu');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') {
    game.state = 'paused';
    input.reset();
    show('pause');
  }
});
function syncSoundLabels() {
  for (const id of ['sound', 'sound2']) $(id).textContent = sfx.muted ? '🔇 Sound off' : '🔊 Sound on';
}
for (const id of ['sound', 'sound2'])
  $(id).addEventListener('click', () => {
    sfx.unlock();
    sfx.toggleMute();
    syncSoundLabels();
  });
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm') {
    sfx.toggleMute();
    syncSoundLabels();
  }
});
syncSoundLabels();
// Any first touch anywhere unlocks audio on mobile browsers.
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (__PWA__ && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
