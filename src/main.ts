import './style.css';
import { Sfx } from './audio';
import { Game, RunSummary } from './game';
import { Input } from './input';
import { Challenge, dailySetup, GUN_UNLOCK, LEVEL_REWARDS, MASTERY_MAX, masteryCost, meta, MISSIONS, MODES, MUTATORS, RunResult, today, TRAINING, trainingCost, xpToNext } from './meta';
import { MAPS, mapById } from './maps';
import { WEAPONS } from './data';
import { challengeCode, challengeLink, makeShareCard, parseChallenge, SaveOutcome, shareCard, shareFile } from './share';
import { BadgeDef, BADGES } from './achievements';
import { Clip, ClipRecorder } from './clips';
import { gearDef, gearValue, RARITIES, RARITY_COLOR, SCRAP_VALUE } from './gear';
import { CRATE_COST, GEAR_MAX } from './meta';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
const input = new Input(canvas);
input.touchMode = window.matchMedia('(pointer: coarse)').matches;
const sfx = new Sfx();

const screens = ['menu', 'modes', 'base', 'perks', 'shop', 'pause', 'over'];
function show(id: string | null) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  canvas.style.cursor = id === null && !input.touchMode ? 'none' : 'default';
}

const clips = new ClipRecorder(canvas, () => sfx.recordStream());

const game = new Game(canvas, input, sfx, {
  onWaveCleared: () => {
    clips.pause(true);
    showPerks();
  },
  onGameOver: (s) => setTimeout(() => showGameOver(s), 900),
  onPause: () => {
    clips.pause(true);
    show('pause');
  },
  onHighlight: (label) => clips.mark(label),
});

clips.onClip = (c) => {
  if (game.state === 'playing') game.toast(`🎬 Clip saved: ${c.label}`);
  if (!$('over').classList.contains('hidden')) renderClips();
};

// Badges are checked live during a run so they pop the moment you earn them.
let runBadges: BadgeDef[] = [];
setInterval(() => {
  if (game.state !== 'playing') return;
  for (const b of meta.unlockBadges(game.summary().report, game.mode)) {
    runBadges.push(b);
    game.toast(`🏅 ${b.name}  +${b.reward} 🧠`);
    sfx.play('perk');
  }
}, 1000);

/** A friend's challenge waiting to be played (from a pasted code or a #c= link). */
let challenge: Challenge | null = null;

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
  clips.finish('Last stand');
  const res = meta.finishRun(s.report, game.mode, game.map.id, game.challenge);
  const badges = [...runBadges, ...res.badges];
  runBadges = [];
  if (res.levelsGained.length) sfx.play('levelup');
  lastRun = s;
  const m = Math.floor(s.time / 60);
  const sec = Math.floor(s.time % 60)
    .toString()
    .padStart(2, '0');
  $('over-stats').innerHTML =
    `${esc(runLabel())}<br>` +
    `Reached <b>wave ${s.wave}</b>${res.newBest ? ' 🏆 new best!' : ` (best: wave ${meta.data.bests[game.mode] ?? 0})`}<br>` +
    `<b>${s.kills}</b> zombies killed<br>Best combo <b>x${s.bestCombo}</b><br><b>$${s.cash}</b> earned · survived <b>${m}:${sec}</b>`;
  $('over-rewards').innerHTML = rewardsHtml(res, badges);
  shareCanvas = makeShareCard(s, scene, meta.data.level, res.newBest, runLabel().toUpperCase(), badges);
  $<HTMLImageElement>('share-img').src = shareCanvas.toDataURL('image/jpeg', 0.8);
  $('share-msg').textContent = '';
  $('challenge-out').classList.add('hidden');
  if (game.challenge) {
    const beat = res.challengeBeaten;
    $('over-stats').insertAdjacentHTML('afterbegin', `<span class="${beat ? 'green' : 'red'}">⚔ ${beat ? 'Challenge beaten!' : `Challenge failed: needed wave ${game.challenge.wave + 1}`}</span><br>`);
  }
  showing = null;
  renderClips();
  refreshMenu();
  show('over');
}

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function rewardsHtml(r: RunResult, badges: BadgeDef[]) {
  const lines = [`<div class="gain"><span>+${r.xpGained} XP</span><span class="pink">+${r.brainsGained + badges.reduce((a, b) => a + b.reward, 0)} 🧠</span></div>`];
  for (const it of game.loot) {
    const g = gearDef(it.id)!;
    lines.push(`<div class="badge-got" style="color:${RARITY_COLOR[it.rarity]}">📦 Loot: ${g.icon} <b>${it.rarity} ${esc(g.name)}</b></div>`);
  }
  for (const b of badges) lines.push(`<div class="badge-got">${b.icon} Badge: <b>${esc(b.name)}</b> <span class="pink">+${b.reward} 🧠</span></div>`);
  for (const lv of r.levelsGained) if (!r.rewards.some((x) => x.startsWith(`Level ${lv}:`))) lines.push(`<div class="lvup">LEVEL ${lv}!</div>`);
  for (const t of r.rewards) lines.push(`<div class="lvup">⬆ ${esc(t)}</div>`);
  for (const mi of r.missionsDone) lines.push(`<div class="mission-done">✔ ${esc(mi.text)} <span class="pink">+${mi.reward} 🧠</span></div>`);
  const d = meta.data;
  lines.push(`<div class="xpline">LV ${d.level} <div class="xpbar"><div style="width:${Math.round((d.xp / xpToNext(d.level)) * 100)}%"></div></div></div>`);
  return lines.join('');
}

// ------------------------------------------------------------------ base screen

let tab = 'armory';
let gearMsg = '';

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
  } else if (tab === 'gear') {
    const slots = document.createElement('div');
    slots.className = 'gear-slots';
    for (const slot of ['armor', 'trinket'] as const) {
      const it = d.gear.find((g) => g.uid === d.equipped[slot]);
      const el = document.createElement('div');
      el.className = 'gear-slot';
      el.innerHTML = it
        ? `<div class="sub">${slot.toUpperCase()}</div><div class="name" style="color:${RARITY_COLOR[it.rarity]}">${gearDef(it.id)!.icon} ${esc(gearDef(it.id)!.name)}</div><div class="sub">${esc(gearDef(it.id)!.desc(gearValue(it)))}</div>`
        : `<div class="sub">${slot.toUpperCase()}</div><div class="name dim">Empty</div><div class="sub">Kill bosses for loot crates</div>`;
      slots.appendChild(el);
    }
    const crate = document.createElement('div');
    crate.className = 'gear-slot';
    crate.innerHTML = `<div class="sub">SUPPLY CRATE</div><div class="name">📦 Random gear</div>`;
    crate.appendChild(
      btn('Open', CRATE_COST, () => {
        const it = meta.buyCrate();
        if (it) {
          sfx.play(it.rarity === 'legendary' || it.rarity === 'epic' ? 'levelup' : 'power');
          gearMsg = `You got: ${gearDef(it.id)!.icon} ${it.rarity} ${gearDef(it.id)!.name}`;
        }
      }),
    );
    slots.appendChild(crate);
    body.appendChild(slots);
    const p = document.createElement('p');
    p.className = 'tag';
    p.innerHTML = gearMsg ? `<b class="gold">${esc(gearMsg)}</b>` : `Stash ${d.gear.length}/${GEAR_MAX}. Tap Equip to wear it, Scrap to turn it into brains.`;
    gearMsg = '';
    body.appendChild(p);
    const grid = document.createElement('div');
    grid.className = 'meta-grid';
    const sorted = [...d.gear].sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
    for (const it of sorted) {
      const g = gearDef(it.id)!;
      const on = d.equipped[g.slot] === it.uid;
      const card = document.createElement('div');
      card.className = `meta-card${on ? ' equipped' : ''}`;
      card.style.borderColor = RARITY_COLOR[it.rarity];
      card.innerHTML = `<div class="name" style="color:${RARITY_COLOR[it.rarity]}">${g.icon} ${esc(g.name)}</div><div class="sub">${it.rarity} ${g.slot}</div><div class="sub">${esc(g.desc(gearValue(it)))}</div>`;
      card.appendChild(btn(on ? 'Equipped' : 'Equip', null, () => meta.equipGear(it.uid), on ? 'on' : ''));
      if (!on) card.appendChild(btn(`Scrap +${SCRAP_VALUE[it.rarity]} 🧠`, null, () => meta.scrapGear(it.uid)));
      grid.appendChild(card);
    }
    body.appendChild(grid);
  } else if (tab === 'badges') {
    const have = new Set(d.badges);
    const p = document.createElement('p');
    p.className = 'tag';
    p.textContent = `${have.size} of ${BADGES.length} badges. Each one pays brains once and shows on your share card the run you earn it.`;
    body.appendChild(p);
    const grid = document.createElement('div');
    grid.className = 'badge-grid';
    for (const b of BADGES) {
      const el = document.createElement('div');
      el.className = `badge${have.has(b.id) ? ' got' : ''}`;
      el.innerHTML = `<div class="bi">${have.has(b.id) ? b.icon : '🔒'}</div><div><div class="name">${esc(b.name)}</div><div class="sub">${esc(b.desc)} · <span class="pink">${b.reward} 🧠</span></div></div>`;
      grid.appendChild(el);
    }
    body.appendChild(grid);
    const h = document.createElement('p');
    h.className = 'tag';
    h.innerHTML = '<b>Your top runs</b>';
    body.appendChild(h);
    const list = document.createElement('ol');
    list.className = 'records';
    if (!d.records.length) list.innerHTML = '<li class="sub">No runs yet. Go get eaten.</li>';
    for (const r of d.records) {
      const li = document.createElement('li');
      li.innerHTML = `<b>Wave ${r.wave}</b> <span class="sub">${r.kills} kills · ${esc(MODES.find((m) => m.id === r.mode)?.name ?? r.mode)} · ${esc(mapById(r.map).name)} · ${esc(r.day)}</span>`;
      list.appendChild(li);
    }
    body.appendChild(list);
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
  let r: SaveOutcome;
  if (showing) {
    const name = showing.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    r = await shareFile(showing.blob, `horde-mayhem-${name}.${showing.ext}`, `${showing.label} in Horde Mayhem 🧟 wave ${lastRun.wave}. Can you beat it?`);
  } else r = await shareCard(shareCanvas, lastRun.wave);
  $('share-msg').textContent = saveMessage(r, !!showing);
});

function saveMessage(r: SaveOutcome, video: boolean) {
  if (r === 'shared' || r === 'saved') return r === 'saved' ? 'Saved.' : '';
  if (r === 'declined') return '';
  // Some embeds block both the share sheet and downloads, so point at what still works.
  return video ? "This browser didn't save the clip. Try the game in Chrome on your phone." : 'If nothing downloaded, long-press the image to save it, then post it anywhere.';
}

// ------------------------------------------------------------------ clips on the game-over screen

let showing: Clip | null = null;

function renderClips() {
  const row = $('clip-row');
  row.innerHTML = '';
  const img = $<HTMLImageElement>('share-img');
  const vid = $<HTMLVideoElement>('share-vid');
  if (!clips.clips.length) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');
  const chip = (label: string, on: boolean, click: () => void) => {
    const b = document.createElement('button');
    b.className = `chip${on ? ' on' : ''}`;
    b.textContent = label;
    b.addEventListener('click', click);
    row.appendChild(b);
  };
  chip('🖼 Card', !showing, () => {
    showing = null;
    renderClips();
  });
  for (const c of clips.clips)
    chip(`🎬 ${c.label}`, showing === c, () => {
      showing = c;
      renderClips();
    });
  img.classList.toggle('hidden', !!showing);
  vid.classList.toggle('hidden', !showing);
  if (showing && vid.src !== showing.url) {
    vid.src = showing.url;
    void vid.play().catch(() => {});
  } else if (!showing) vid.pause();
  $('share').textContent = showing ? '📤 Share this clip' : '📤 Share your run';
  $('share-msg').textContent = '';
}

$('challenge-btn').addEventListener('click', async () => {
  if (!lastRun) return;
  const c: Challenge = { mode: game.challenge?.mode ?? game.mode, map: game.map.id, muts: [...game.mutators], wave: lastRun.wave, kills: lastRun.kills };
  const code = challengeCode(c);
  const link = challengeLink(code);
  const where = `${mapById(c.map).name}${c.mode === 'endless' ? '' : ` (${MODES.find((m) => m.id === c.mode)!.name})`}`;
  const text = link.includes('#c=')
    ? `I reached wave ${c.wave} on ${where} in Horde Mayhem 🧟 Beat it: ${link}`
    : `I reached wave ${c.wave} on ${where} in Horde Mayhem 🧟 Beat it: open ${link} and enter challenge code ${code}`;
  $('challenge-out').classList.remove('hidden');
  $<HTMLInputElement>('challenge-code').value = code;
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    $('share-msg').textContent = 'Challenge copied. Paste it to a friend.';
  } catch {
    $('share-msg').textContent = 'Send your friend this code:';
  }
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

function runLabel() {
  const m = MODES.find((x) => x.id === game.mode)!;
  const muts = [...game.mutators].map((id) => MUTATORS.find((x) => x.id === id)!.name);
  return [m.name, game.map.name, ...muts].join(' · ');
}

// ------------------------------------------------------------------ mode & map picker

function openModes() {
  sfx.unlock();
  renderModes();
  show('modes');
}

function renderModes() {
  const d = meta.data;
  const cards = $('mode-cards');
  cards.innerHTML = '';
  for (const m of MODES) {
    const locked = d.level < m.unlock;
    const b = document.createElement('button');
    b.className = `mode-card${d.mode === m.id ? ' on' : ''}`;
    b.disabled = locked;
    const best = d.bests[m.id] ? `Best: wave ${d.bests[m.id]}` : 'Not played yet';
    b.innerHTML = `<div class="mi">${m.icon}</div><div class="name">${esc(m.name)}</div><div class="sub">${locked ? `Unlocks at level ${m.unlock}` : esc(m.desc)}</div><div class="sub dim">${locked ? '' : best}</div>`;
    b.addEventListener('click', () => {
      challenge = null;
      d.mode = m.id;
      meta.save();
      game.configure(m.id);
      renderModes();
    });
    cards.appendChild(b);
  }
  const row = $('map-row');
  row.innerHTML = '';
  const info = $('mode-info');
  for (const b of cards.querySelectorAll('button')) if (challenge) b.classList.remove('on');
  if (challenge) {
    const c = challenge;
    const muts = c.muts.map((id) => MUTATORS.find((x) => x.id === id)!.name);
    info.innerHTML = `<span class="gold">⚔ Challenge: beat wave ${c.wave}</span> on <b>${esc(mapById(c.map).name)}</b> · ${esc(MODES.find((m) => m.id === c.mode)!.name)}${muts.length ? ` · ${esc(muts.join(', '))}` : ''} <button id="ch-clear" class="link">cancel</button>`;
    $('ch-clear').addEventListener('click', () => {
      challenge = null;
      game.configure(d.mode);
      renderModes();
    });
  } else if (d.mode === 'daily') {
    const ds = dailySetup();
    const muts = ds.mutators.map((id) => MUTATORS.find((x) => x.id === id)!);
    const played = d.daily.day === today() ? d.daily : { best: 0, runs: 0 };
    info.innerHTML = `Today: <b>${esc(mapById(ds.map).name)}</b> with ${muts.map((x) => `<b>${esc(x.name)}</b> (${esc(x.desc.toLowerCase())})`).join(' and ')}.<br>${played.runs ? `Your best today: wave ${played.best}` : 'First run today pays +50 🧠'}`;
  } else {
    info.textContent = '';
    for (const mp of MAPS) {
      const locked = d.level < mp.unlock;
      const b = document.createElement('button');
      b.className = `map-chip${d.map === mp.id ? ' on' : ''}`;
      b.disabled = locked;
      b.innerHTML = `<b>${esc(mp.name)}</b><span>${locked ? `Level ${mp.unlock}` : esc(mp.desc)}</span>`;
      b.addEventListener('click', () => {
        challenge = null;
        d.map = mp.id;
        meta.save();
        game.configure(d.mode);
        renderModes();
      });
      row.appendChild(b);
    }
  }
}

function startRun() {
  sfx.unlock();
  goFullscreen();
  const d = meta.data;
  // Fall back if a saved choice is no longer unlocked (e.g. after loading a save code).
  if (d.level < (MODES.find((m) => m.id === d.mode)?.unlock ?? 1)) d.mode = 'endless';
  if (d.level < mapById(d.map).unlock) d.map = 'lot';
  if (challenge) {
    game.configure(challenge.mode, challenge);
    game.modeLabel = `CHALLENGE · ${MODES.find((m) => m.id === challenge!.mode)!.name.toUpperCase()}`;
  } else {
    game.configure(d.mode);
    game.modeLabel = d.mode === 'endless' ? '' : MODES.find((m) => m.id === d.mode)!.name.toUpperCase();
  }
  runBadges = [];
  game.newRun();
  show(null);
  game.startWave();
  clips.start();
}

function acceptChallenge(code: string) {
  const c = parseChallenge(code);
  if (!c) return false;
  challenge = c;
  game.configure(c.mode, c);
  return true;
}

$('ch-go').addEventListener('click', () => {
  const ok = acceptChallenge($<HTMLInputElement>('ch-code').value);
  $<HTMLInputElement>('ch-code').value = '';
  if (ok) renderModes();
  else $('mode-info').textContent = "That challenge code didn't work.";
});

// Opened from a challenge link: go straight to the fight picker.
{
  const m = location.hash.match(/c=(HM[A-Za-z0-9_-]+)/);
  if (m && acceptChallenge(m[1])) {
    history.replaceState(null, '', location.pathname + location.search);
    renderModes();
    show('modes');
  }
}

refreshMenu();
$('play').addEventListener('click', openModes);
$('start').addEventListener('click', startRun);
$('modes-back').addEventListener('click', () => show('menu'));
$('again').addEventListener('click', startRun);
$('next-wave').addEventListener('click', () => {
  sfx.unlock();
  show(null);
  game.startWave();
  clips.pause(false);
});
$('resume').addEventListener('click', () => {
  sfx.unlock();
  show(null);
  game.state = 'playing';
  clips.pause(false);
});
$('quit').addEventListener('click', () => {
  clips.stop();
  // Quitting still banks XP, brains and mission progress.
  if (game.wave > 0) meta.finishRun(game.summary().report, game.mode, game.map.id, game.challenge);
  refreshMenu();
  game.newRun();
  game.state = 'menu';
  show('menu');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') {
    game.state = 'paused';
    input.reset();
    clips.pause(true);
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
function syncClipLabel() {
  $('clips-toggle').textContent = clips.enabled ? '🎬 Clips on' : '🎬 Clips off';
}
if (!ClipRecorder.supported()) $('clips-wrap').classList.add('hidden');
$('clips-toggle').addEventListener('click', () => {
  clips.setEnabled(!clips.enabled);
  syncClipLabel();
});
syncClipLabel();
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

if (import.meta.env.DEV) Object.assign(window, { game, clips });
