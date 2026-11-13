import './style.css';
import './tactical.css';
import { Sfx } from './audio';
import { Game, OpResult, RunSummary, SUITS } from './game';
import { Input } from './input';
import { Challenge, dailySetup, GUN_UNLOCK, LEVEL_REWARDS, MASTERY_MAX, masteryCost, meta, MISSIONS, MODES, MUTATORS, RunResult, today, TRAINING, trainingCost, xpToNext } from './meta';
import { MAPS, mapById } from './maps';
import { WEAPONS } from './data';
import { goalText, OPS, star3Text } from './campaign';
import { challengeCode, challengeLink, isFramed, LIVE_URL, makeShareCard, parseChallenge, SaveOutcome, shareCard, shareFile } from './share';
import { BadgeDef, BADGES } from './achievements';
import { Clip, ClipRecorder } from './clips';
import { gearDef, gearValue, RARITIES, RARITY_COLOR, SCRAP_VALUE } from './gear';
import { CRATE_COST } from './meta';
import { boardFor, cleanName, leaderboardsOn, postScore, Score, topScores } from './leaderboard';
import { NetMsg, Room } from './net';
import { ads, AdPlacement, AdResult } from './monetize/ads';
import { pay, PACKS } from './monetize/pay';
import { AD_DIAMONDS, BADGE_DIAMONDS, BRAIN_BUNDLE, LEVEL_DIAMONDS, DIAMOND_PRICE, missionDiamonds, REVIVE_TOKEN_MAX, SKINS, STASH_BONUS, XP_BOOST_RUNS } from './diamonds';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
const input = new Input(canvas);
input.touchMode = window.matchMedia('(pointer: coarse)').matches;
const sfx = new Sfx();

const screens = ['menu', 'modes', 'coop', 'base', 'perks', 'shop', 'pause', 'revive', 'over'];
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
  onGameOver: (s) => setTimeout(() => (game.op ? showOpOver({ op: game.op, won: false, time: game.opProgress().t, hits: s.report.hitsTaken, hpFrac: 0, summary: s }) : showGameOver(s)), 900),
  onOpEnd: (r) => setTimeout(() => showOpOver(r), 400),
  onPause: () => {
    clips.pause(true);
    show('pause');
  },
  onHighlight: (label) => clips.mark(label),
  onReviveOffer: () => {
    clips.pause(true);
    offerRevive();
  },
});

// Dev builds only: lets browser tests drive the game.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;

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
    const gun = /^(buy|up):/.test(item.id) ? WEAPONS.find((w) => w.id === item.id.split(':')[1]) : undefined;
    if (gun) b.firstElementChild!.insertAdjacentHTML('beforeend', gunStats(gun));
    b.addEventListener('click', () => {
      if (game.buy(item.id)) showShop();
    });
    wrap.appendChild(b);
  }
  show('shop');
}

let shareCanvas: HTMLCanvasElement | null = null;
let lastRes: RunResult | null = null;
let lastBadges: BadgeDef[] = [];
/** The 2x brains ad was already used on this game-over screen. */
let doubled = false;
let lastRun: RunSummary | null = null;

function showGameOver(s: RunSummary) {
  overMode(null);
  const scene = game.snapshot();
  clips.finish('Last stand');
  const res = meta.finishRun(s.report, game.mode, game.map.id, game.challenge);
  const badges = [...runBadges, ...res.badges];
  lastRes = res;
  lastBadges = badges;
  doubled = false;
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
  renderDoubleAd();
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
  renderPostScore(s);
  refreshMenu();
  $('challenge-btn').classList.toggle('hidden', !!game.net);
  coopOverButtons();
  show('over');
}

/** Bar chart of a gun's damage, fire rate, magazine and range, scaled against the whole arsenal. */
type Gun = (typeof WEAPONS)[number];
const GUN_STATS: [string, (w: Gun) => number][] = [
  ['DMG', (w) => w.damage * w.pellets],
  ['RATE', (w) => w.fireRate],
  ['MAG', (w) => w.mag],
  ['RNG', (w) => w.speed * w.life],
];
const GUN_MAX = GUN_STATS.map(([, f]) => Math.max(...WEAPONS.map(f)));
function gunStats(w: Gun) {
  const rows = GUN_STATS.map(([label, f], i) => {
    // Square root so one extreme gun (minigun rate, rocket damage) doesn't flatten everything else.
    const pct = Math.max(6, Math.round(Math.sqrt(f(w) / GUN_MAX[i]) * 100));
    return `<span>${label}</span><i><b style="width:${pct}%"></b></i>`;
  });
  return `<div class="wstats">${rows.join('')}</div>`;
}

// ------------------------------------------------------------------ story mode

/** The op picked on the modes screen (index into OPS). */
let opPick = Math.max(0, OPS.findIndex((o, i) => meta.opUnlocked(i) && !meta.data.campaign[o.id]));
if (opPick < 0 || !meta.opUnlocked(opPick)) opPick = 0;
/** What the PLAY AGAIN button does after an op: retry it, or go to the next one. */
let opAfter: { retry: number; next: number } | null = null;

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

function startOp(i: number) {
  const op = OPS[i];
  if (!op || !meta.opUnlocked(i)) return;
  opPick = i;
  sfx.unlock();
  goFullscreen();
  challenge = null;
  game.configureOp(op);
  game.modeLabel = 'STORY';
  runBadges = [];
  game.newRun();
  show(null);
  game.startOp();
  clips.start();
}

/** Switches the game over screen between a normal run and a story op. */
function overMode(r: { won: boolean; next: boolean } | null) {
  const h = document.querySelector('#over h2') as HTMLElement;
  h.textContent = r ? (r.won ? 'Mission complete' : 'Mission failed') : 'You got eaten';
  h.className = r?.won ? 'green' : 'red';
  $('again').textContent = r ? (r.won && r.next ? 'NEXT MISSION ▶' : r.won ? 'PLAY AGAIN' : 'RETRY') : 'PLAY AGAIN';
  if (!r) opAfter = null;
}

function showOpOver(r: OpResult) {
  if (!$('over').classList.contains('hidden')) return;
  const scene = game.snapshot();
  clips.finish(r.won ? `${r.op.name} complete` : 'Last stand');
  const i = OPS.findIndex((o) => o.id === r.op.id);
  const s3 = r.op.star3;
  const third = r.won && (s3.type === 'time' ? r.time <= s3.s : r.hits <= s3.n);
  const got = r.won ? 1 + (r.hpFrac >= 0.5 ? 1 : 0) + (third ? 1 : 0) : 0;
  const clear = r.won ? meta.clearOp(r.op.id, got) : { brains: 0, first: false, newStars: 0 };
  const res = meta.finishRun(r.summary.report, 'campaign', game.map.id, null);
  if (clear.brains) {
    res.rewards.unshift(clear.first ? `First clear: +${clear.brains} 🧠` : `New stars: +${clear.brains} 🧠`);
    res.brainsGained += clear.brains;
  }
  const badges = [...runBadges, ...res.badges];
  runBadges = [];
  if (res.levelsGained.length || r.won) sfx.play('levelup');
  lastRun = r.summary;
  const m = Math.floor(r.time / 60);
  const sec = Math.floor(r.time % 60)
    .toString()
    .padStart(2, '0');
  const row = (ok: boolean, text: string) => `<span class="${ok ? 'gold' : 'dim'}">${ok ? '★' : '☆'} ${esc(text)}</span>`;
  $('over-stats').innerHTML =
    `<b>Op ${i + 1}: ${esc(r.op.name)}</b> · ${esc(game.map.name)}<br>` +
    `<span class="op-stars">${stars(got)}</span>${(meta.data.campaign[r.op.id] ?? 0) > got ? ` <span class="dim">(best ${stars(meta.data.campaign[r.op.id])})</span>` : ''}<br>` +
    `${row(r.won, goalText(r.op.goal))}<br>${row(r.won && r.hpFrac >= 0.5, 'Finish with half your health or more')}<br>${row(third, star3Text(s3))}<br>` +
    `<span class="dim">${m}:${sec} · ${r.hits} hits taken · ${r.summary.kills} kills</span>`;
  $('over-rewards').innerHTML = rewardsHtml(res, badges);
  shareCanvas = makeShareCard(r.summary, scene, meta.data.level, false, `STORY · ${r.op.name.toUpperCase()} ${stars(got)}`, badges);
  $<HTMLImageElement>('share-img').src = shareCanvas.toDataURL('image/jpeg', 0.8);
  $('share-msg').textContent = '';
  $('challenge-out').classList.add('hidden');
  $('lb-box').classList.add('hidden');
  $('challenge-btn').classList.add('hidden');
  const hasNext = i + 1 < OPS.length && meta.opUnlocked(i + 1);
  overMode({ won: r.won, next: hasNext });
  opAfter = { retry: i, next: r.won && hasNext ? i + 1 : i };
  showing = null;
  renderClips();
  refreshMenu();
  show('over');
}

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function rewardsHtml(r: RunResult, badges: BadgeDef[]) {
  const dia = r.diamondsGained + badges.length * BADGE_DIAMONDS;
  const brains = r.brainsGained * (doubled ? 2 : 1) + badges.reduce((a, b) => a + b.reward, 0);
  const lines = [`<div class="gain"><span>+${r.xpGained} XP${r.xpBoosted ? ' (2x)' : ''}</span><span class="pink">+${brains} 🧠${doubled ? ' (2x)' : ''}</span>${dia ? `<span class="cyan">+${dia} 💎</span>` : ''}</div>`];
  for (const it of game.loot) {
    const g = gearDef(it.id)!;
    lines.push(`<div class="badge-got" style="color:${RARITY_COLOR[it.rarity]}">📦 Loot: ${g.icon} <b>${it.rarity} ${esc(g.name)}</b></div>`);
  }
  for (const b of badges) lines.push(`<div class="badge-got">${b.icon} Badge: <b>${esc(b.name)}</b> <span class="pink">+${b.reward} 🧠</span></div>`);
  for (const lv of r.levelsGained) if (!r.rewards.some((x) => x.startsWith(`Level ${lv}:`))) lines.push(`<div class="lvup">LEVEL ${lv}!</div>`);
  for (const t of r.rewards) lines.push(`<div class="lvup">⬆ ${esc(t)}</div>`);
  for (const mi of r.missionsDone) lines.push(`<div class="mission-done">✔ ${esc(mi.text)} <span class="pink">+${mi.reward} 🧠</span> <span class="cyan">+${mi.diamonds} 💎</span></div>`);
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
  $('m-diamonds').textContent = String(d.diamonds);
  $('b-diamonds').textContent = String(d.diamonds);
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

/** A plain button whose handler re-renders by itself (for async flows like ads and checkout). */
function abtn(label: string, onClick: (b: HTMLButtonElement) => void, cls = '') {
  const b = document.createElement('button');
  b.className = `buy ${cls}`;
  b.textContent = label;
  b.addEventListener('click', () => onClick(b));
  return b;
}

/** A buy button priced in diamonds. */
function dbtn(label: string, cost: number, onClick: () => void, cls = '') {
  const b = document.createElement('button');
  b.className = `buy dia-buy ${cls}`;
  b.innerHTML = `${esc(label)} <span>💎 ${cost}</span>`;
  if (meta.data.diamonds < cost) b.disabled = true;
  b.addEventListener('click', () => {
    onClick();
    refreshMenu();
    renderBase();
  });
  return b;
}

let storeMsg = '';

function storeCard(title: string, sub: string, cls = '') {
  const card = document.createElement('div');
  card.className = `meta-card store-card ${cls}`;
  card.innerHTML = `<div class="name"></div><div class="sub"></div>`;
  (card.children[0] as HTMLElement).innerHTML = title;
  (card.children[1] as HTMLElement).innerHTML = sub;
  return card;
}

function storeHead(text: string, note = '') {
  const h = document.createElement('h3');
  h.className = 'store-head';
  h.innerHTML = `${esc(text)}${note ? ` <span class="test-tag">${esc(note)}</span>` : ''}`;
  return h;
}

function renderStore(body: HTMLElement) {
  const d = meta.data;
  if (storeMsg) {
    const p = document.createElement('p');
    p.className = 'tag';
    p.innerHTML = `<b class="gold">${esc(storeMsg)}</b>`;
    body.appendChild(p);
    storeMsg = '';
  }
  // Free diamonds first: nobody should feel they have to pay.
  body.appendChild(storeHead('Free diamonds', ads.test ? 'TEST ADS' : ''));
  const free = document.createElement('div');
  free.className = 'meta-grid';
  const left = meta.adDiamondsLeft();
  const adCard = storeCard('📺 Watch an ad', left ? `+${AD_DIAMONDS} 💎 · ${left} left today` : 'Come back tomorrow for more');
  const adB = abtn(left ? `Watch +${AD_DIAMONDS} 💎` : 'All watched today', async () => {
    if (await watchAd('diamonds')) {
      const n = meta.rewardDiamondAd();
      storeMsg = n ? `+${n} 💎 Thanks for watching!` : '';
      sfx.play('power');
    }
    refreshMenu();
    renderBase();
  });
  adB.disabled = !left;
  adCard.appendChild(adB);
  free.appendChild(adCard);
  free.appendChild(storeCard('📋 Daily missions', 'Every mission pays 4 to 12 💎. Three new ones every day.'));
  free.appendChild(storeCard('⬆ Level ups & badges', `+${LEVEL_DIAMONDS} 💎 every level, +${BADGE_DIAMONDS} 💎 every badge.`));
  body.appendChild(free);

  body.appendChild(storeHead('Diamond packs', pay.test ? 'TEST MODE · NO REAL MONEY' : ''));
  const packs = document.createElement('div');
  packs.className = 'meta-grid packs';
  for (const pk of PACKS) {
    const card = storeCard(`💎 ${pk.diamonds.toLocaleString()}`, `${pk.bonus ? `<span class="green">${pk.bonus} bonus</span>` : 'Starter'}${pk.tag ? ` · <b class="gold">${pk.tag}</b>` : ''}`, 'pack');
    const b = abtn(pk.price, async (b) => {
      b.disabled = true;
      const r = await pay.buy(pk, d.buyer);
      if (r.ok) {
        meta.addDiamonds(r.diamonds);
        storeMsg = `+${r.diamonds.toLocaleString()} 💎 added. Thank you!`;
        sfx.play('levelup');
      } else if (r.redirecting) return;
      else if (r.error) storeMsg = r.error;
      refreshMenu();
      renderBase();
    }, 'price');
    card.appendChild(b);
    packs.appendChild(card);
  }
  body.appendChild(packs);

  body.appendChild(storeHead('Exclusive'));
  const ex = document.createElement('div');
  ex.className = 'meta-grid';
  const prism = WEAPONS.find((w) => w.id === 'prism')!;
  const ownPrism = d.unlocked.includes('prism');
  const pc = storeCard(`🔫 ${esc(prism.name)}`, 'Diamond-only gun. A laser that slices through 10 zombies in a line. Weaker against big crowds.', 'exclusive');
  if (ownPrism) pc.appendChild(btn('Owned · equip in Armory', null, () => (tab = 'armory'), 'on'));
  else pc.appendChild(dbtn('Unlock', DIAMOND_PRICE.prism, () => meta.buyPrism() && sfx.play('levelup')));
  ex.appendChild(pc);
  for (const sk of SKINS) {
    const own = d.skins.includes(sk.id);
    const on = d.skin === sk.id;
    const c = storeCard(`<span class="swatch" style="background:${sk.colors[0]};border-color:${sk.colors[2]}"></span> ${esc(sk.name)}`, 'Skin: your soldier wears it in every run.', 'exclusive');
    if (!own) c.appendChild(dbtn('Buy', sk.price, () => meta.buySkin(sk.id) && sfx.play('perk')));
    else c.appendChild(btn(on ? 'Wearing · take off' : 'Wear', null, () => meta.wearSkin(on ? '' : sk.id), on ? 'on' : ''));
    ex.appendChild(c);
  }
  const st = storeCard('🎒 Bigger stash', d.stash ? `Done: your stash holds ${meta.gearMax()} items.` : `+${STASH_BONUS} gear slots, forever.`);
  if (!d.stash) st.appendChild(dbtn('Expand', DIAMOND_PRICE.stash, () => meta.buyStash() && sfx.play('buy')));
  ex.appendChild(st);
  body.appendChild(ex);

  body.appendChild(storeHead('Boosts'));
  const bo = document.createElement('div');
  bo.className = 'meta-grid';
  const crate = storeCard('📦 Elite crate', 'One piece of gear, always epic, 1 in 5 legendary.');
  crate.appendChild(
    dbtn('Open', DIAMOND_PRICE.eliteCrate, () => {
      const it = meta.buyEliteCrate();
      if (it) {
        sfx.play('levelup');
        storeMsg = `You got: ${gearDef(it.id)!.icon} ${it.rarity} ${gearDef(it.id)!.name}`;
      } else if (d.gear.length >= meta.gearMax()) storeMsg = 'Your stash is full. Scrap something first.';
    }),
  );
  bo.appendChild(crate);
  const br = storeCard(`🧠 ${BRAIN_BUNDLE} brains`, 'Skip some grinding for guns and training.');
  br.appendChild(dbtn('Buy', DIAMOND_PRICE.brains, () => meta.buyBrains() && sfx.play('buy')));
  bo.appendChild(br);
  const rt = storeCard('✚ Revive token', `Get back up on the death screen. You have ${d.reviveTokens}/${REVIVE_TOKEN_MAX}.`);
  if (d.reviveTokens < REVIVE_TOKEN_MAX) rt.appendChild(dbtn('Buy', DIAMOND_PRICE.reviveToken, () => meta.buyReviveToken() && sfx.play('buy')));
  bo.appendChild(rt);
  const xp = storeCard('⭐ Double XP', `2x XP for your next ${XP_BOOST_RUNS} runs.${d.xpBoost ? ` ${d.xpBoost} runs left.` : ''}`);
  xp.appendChild(dbtn('Buy', DIAMOND_PRICE.xpBoost, () => meta.buyXpBoost() && sfx.play('buy')));
  bo.appendChild(xp);
  body.appendChild(bo);
  const fine = document.createElement('p');
  fine.className = 'sub';
  fine.textContent = 'Diamonds live in your save, like brains. Back it up with the Save tab before switching phones.';
  body.appendChild(fine);
}

// ------------------------------------------------------------------ rewarded ads

let adBusy = false;

/** Shows a rewarded ad. True only if the player watched it to the end. */
async function watchAd(place: AdPlacement): Promise<boolean> {
  if (adBusy) return false;
  adBusy = true;
  sfx.duck(true);
  let r: AdResult = 'unavailable';
  try {
    r = await ads.showRewarded(place);
  } finally {
    sfx.duck(false);
    adBusy = false;
  }
  if (r === 'unavailable') notice('No ad available right now. Try again in a minute.');
  return r === 'rewarded';
}

let noticeT = 0;
function notice(text: string) {
  const n = $('notice');
  n.textContent = text;
  n.classList.remove('hidden');
  clearTimeout(noticeT);
  noticeT = window.setTimeout(() => n.classList.add('hidden'), 3500);
}

/** Game-over offer: watch an ad to double the brains from this run. */
function renderDoubleAd() {
  const b = $<HTMLButtonElement>('over-ad');
  const n = lastRes?.brainsGained ?? 0;
  b.classList.toggle('hidden', doubled || n < 10);
  b.disabled = false;
  b.textContent = `📺 Watch an ad: double your brains (+${n} 🧠)`;
}

$('over-ad').addEventListener('click', async () => {
  if (!lastRes || doubled) return;
  const b = $<HTMLButtonElement>('over-ad');
  b.disabled = true;
  if (await watchAd('double')) {
    doubled = true;
    meta.addBrains(lastRes.brainsGained);
    sfx.play('levelup');
    $('over-rewards').innerHTML = rewardsHtml(lastRes, lastBadges);
    refreshMenu();
  }
  renderDoubleAd();
});

// ------------------------------------------------------------------ revive offer

const REVIVE_SECONDS = 10;
let rvLeft = 0;
let rvTimer = 0;

function offerRevive() {
  rvLeft = REVIVE_SECONDS;
  $('rv-msg').textContent = ads.test ? 'Test ads: no ad network connected yet.' : '';
  renderRevive();
  show('revive');
  clearInterval(rvTimer);
  rvTimer = window.setInterval(() => {
    if (adBusy) return; // the clock stops while an ad plays
    rvLeft -= 0.1;
    $('rv-bar').style.width = `${Math.max(0, (rvLeft / REVIVE_SECONDS) * 100)}%`;
    if (rvLeft <= 0) giveUp();
  }, 100);
}

function renderRevive() {
  const d = meta.data;
  const tok = $<HTMLButtonElement>('rv-token');
  tok.textContent = `✚ Use revive token (${d.reviveTokens})`;
  tok.disabled = d.reviveTokens <= 0;
  const dia = $<HTMLButtonElement>('rv-dia');
  dia.innerHTML = `Revive <span>💎 ${DIAMOND_PRICE.reviveNow}</span>`;
  dia.disabled = d.diamonds < DIAMOND_PRICE.reviveNow;
  $('rv-bar').style.width = `${(rvLeft / REVIVE_SECONDS) * 100}%`;
}

function revived() {
  clearInterval(rvTimer);
  refreshMenu();
  show(null);
  game.reviveNow();
  clips.pause(false);
}

function giveUp() {
  clearInterval(rvTimer);
  if (!game.awaitingRevive) return;
  show(null);
  game.endRun();
}

$('rv-ad').addEventListener('click', async () => {
  sfx.unlock();
  if (await watchAd('revive')) revived();
  else if (game.awaitingRevive) $('rv-msg').textContent = 'No reward without watching it all. You can still use a token or diamonds.';
});
$('rv-token').addEventListener('click', () => meta.useReviveToken() && revived());
$('rv-dia').addEventListener('click', () => meta.spendDiamonds(DIAMOND_PRICE.reviveNow) && revived());
$('rv-no').addEventListener('click', giveUp);
$('rv-back').addEventListener('click', giveUp);

function renderBase() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#base .tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('b-brains').textContent = String(meta.data.brains);
  $('base-title').textContent = tab[0].toUpperCase() + tab.slice(1);
  $('b-diamonds').textContent = String(meta.data.diamonds);
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
      card.innerHTML = `<div class="name">${esc(w.name)}</div><div class="sub">Mastery ${lv}/${MASTERY_MAX}</div><div class="pips">${'■'.repeat(lv)}${'□'.repeat(MASTERY_MAX - lv)}</div>${gunStats(w)}`;
      if (!owned && w.exclusive) card.appendChild(btn('💎 In the Shop', null, () => (tab = 'store')));
      else if (!owned) card.appendChild(btn('Unlock', GUN_UNLOCK[w.id], () => meta.unlockGun(w.id) && sfx.play('buy')));
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
      row.innerHTML = `<div class="mtext">${m.done ? '✔ ' : ''}${esc(def.text)}</div><div class="xpbar"><div style="width:${Math.round((m.progress / def.goal) * 100)}%"></div></div><div class="sub">${Math.floor(m.progress)} / ${def.goal} · <span class="pink">+${def.reward} 🧠</span> <span class="cyan">+${missionDiamonds(def.reward)} 💎</span></div>`;
      if (!m.done) row.appendChild(dbtn('🎲 Swap', DIAMOND_PRICE.reroll, () => meta.rerollMission(m.id) && sfx.play('buy'), 'reroll'));
      list.appendChild(row);
    }
    body.appendChild(list);
    const p = document.createElement('p');
    p.className = 'tag';
    const next = LEVEL_REWARDS.find((r) => r.level > d.level);
    p.innerHTML = `New missions every day. Progress counts across all your runs.<br>Level ${d.level}: ${d.xp} / ${xpToNext(d.level)} XP${next ? ` · next unlock at level ${next.level}: <b>${esc(next.text)}</b>` : ''}`;
    body.appendChild(p);
  } else if (tab === 'ranks') {
    void renderRanks(body);
  } else if (tab === 'store') {
    renderStore(body);
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
    p.innerHTML = gearMsg ? `<b class="gold">${esc(gearMsg)}</b>` : `Stash ${d.gear.length}/${meta.gearMax()}. Tap Equip to wear it, Scrap to turn it into brains.`;
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
  leaveCoop();
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

// ------------------------------------------------------------------ leaderboards

function scoreRows(rows: Score[], me = '') {
  if (!rows.length) return '<li class="sub">No scores yet. Be the first.</li>';
  return rows
    .map((r) => `<li${r.name.toLowerCase() === me.toLowerCase() ? ' class="me"' : ''}><b>${esc(r.name)}</b> <span class="sub">wave ${r.wave} · ${r.kills} kills · ${esc(mapById(r.map).name)}</span></li>`)
    .join('');
}

function renderPostScore(s: RunSummary) {
  const box = $('lb-box');
  const board = game.challenge ? '' : boardFor(game.mode, today());
  if (!leaderboardsOn() || !board || s.wave < 1) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const label = board === 'endless' ? 'the Endless leaderboard' : "today's Daily leaderboard";
  box.innerHTML = `<div class="lb-row"><input id="lb-name" maxlength="16" placeholder="Your name" autocomplete="off" /><button id="lb-post" class="buy">🏆 Post wave ${s.wave}</button></div><p id="lb-msg" class="tiny"></p><ol id="lb-list" class="records"></ol>`;
  const nameEl = $<HTMLInputElement>('lb-name');
  nameEl.value = meta.data.player;
  $('lb-post').addEventListener('click', async () => {
    const name = cleanName(nameEl.value);
    if (!name) {
      $('lb-msg').textContent = 'Pick a name first.';
      return;
    }
    meta.data.player = name;
    meta.save();
    const b = $<HTMLButtonElement>('lb-post');
    b.disabled = true;
    $('lb-msg').textContent = 'Posting…';
    try {
      await postScore(board, { name, wave: s.wave, kills: s.kills, map: game.map.id });
      const rows = await topScores(board, 50);
      const rank = rows.findIndex((r) => r.name.toLowerCase() === name.toLowerCase()) + 1;
      $('lb-msg').textContent = rank ? `You're #${rank} on ${label}.` : `Posted to ${label}.`;
      $('lb-list').innerHTML = scoreRows(rows.slice(0, 5), name);
      box.querySelector('.lb-row')!.classList.add('hidden');
    } catch {
      b.disabled = false;
      $('lb-msg').textContent = "Couldn't reach the leaderboard. Try again in a moment.";
    }
  });
}

async function renderRanks(body: HTMLElement) {
  const day = today();
  body.innerHTML = `<div class="ranks"><div><p class="tag"><b>♾️ Endless, all time</b></p><ol id="rk-endless" class="records"><li class="sub">Loading…</li></ol></div><div><p class="tag"><b>📅 Today's Daily</b></p><ol id="rk-daily" class="records"><li class="sub">Loading…</li></ol></div></div>`;
  for (const [id, board] of [
    ['rk-endless', 'endless'],
    ['rk-daily', `daily-${day}`],
  ]) {
    try {
      const rows = await topScores(board, 10);
      if (tab === 'ranks') $(id).innerHTML = scoreRows(rows, meta.data.player);
    } catch {
      if (tab === 'ranks') $(id).innerHTML = '<li class="sub">Couldn\'t reach the leaderboard.</li>';
    }
  }
}

if (!leaderboardsOn()) for (const b of document.querySelectorAll<HTMLElement>('[data-tab="ranks"]')) b.classList.add('hidden');

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
    if (m.hidden) continue;
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
  row.className = 'map-row';
  const info = $('mode-info');
  info.className = 'tag';
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
  } else if (d.mode === 'campaign') {
    if (!meta.opUnlocked(opPick)) opPick = 0;
    row.className = 'op-row';
    OPS.forEach((op, i) => {
      const open = meta.opUnlocked(i);
      const got = d.campaign[op.id] ?? 0;
      const b = document.createElement('button');
      b.className = `map-chip op-chip${opPick === i ? ' on' : ''}${got ? ' done' : ''}`;
      b.disabled = !open;
      b.innerHTML = `<b>${i + 1}. ${esc(op.name)}</b><span class="op-stars">${open ? stars(got) : '🔒'}</span>`;
      b.addEventListener('click', () => {
        opPick = i;
        renderModes();
      });
      row.appendChild(b);
    });
    const op = OPS[opPick];
    const guns = op.guns.map((g) => WEAPONS.find((w) => w.id === g)?.name ?? g).join(', ');
    info.className = 'tag op-brief';
    info.innerHTML =
      `<span class="op-head">OP ${opPick + 1} · ${esc(op.name.toUpperCase())} · ${esc(mapById(op.map).name)}</span>` +
      `<span class="op-text">“${esc(op.brief)}”</span>` +
      `<span class="op-goal">🎯 ${esc(goalText(op.goal))}  ·  ⭐ ${esc(star3Text(op.star3))}</span>` +
      `<span class="op-kit">🔫 Field issue: ${esc(guns)}${op.perks?.length ? ` · ${op.perks.length} perks` : ''} · First clear +${op.reward} 🧠</span>`;
    return;
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
  if (d.mode === 'campaign' && !challenge) {
    startOp(opPick);
    return;
  }
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


// ------------------------------------------------------------------ online co-op

let room: Room | null = null;
let squad: { id: string; name: string; slot: number }[] = [];
let coopMap = 'lot';
const ready = new Set<string>();
let hostReady = false;

function openCoop(code = '') {
  sfx.unlock();
  $<HTMLInputElement>('co-name').value = meta.data.player || '';
  if (code) $<HTMLInputElement>('co-code').value = code;
  setCoopMsg(isFramed() ? '' : code ? 'Pick a name and tap Join.' : '');
  renderCoop();
  show('coop');
}

function setCoopMsg(t: string) {
  $('co-msg').textContent = t;
}

function coopName() {
  const n = cleanName($<HTMLInputElement>('co-name').value) || 'Survivor';
  meta.data.player = n;
  meta.save();
  return n;
}

function renderCoop() {
  if (isFramed()) {
    // Embeds block the connection co-op needs, so point at the real site.
    $('co-pick').innerHTML = `<p class="tag">Co-op needs the full game. Open <a href="${LIVE_URL}" target="_blank" rel="noopener">${LIVE_URL.replace('https://', '')}</a> on each phone.</p>`;
    $('co-name').classList.add('hidden');
    return;
  }
  const r = room;
  $('co-pick').classList.toggle('hidden', !!r);
  $('co-room').classList.toggle('hidden', !r);
  $<HTMLInputElement>('co-name').disabled = !!r;
  $('co-back').querySelector('.back-label')!.textContent = r ? 'LEAVE' : 'BACK';
  if (!r) return;
  $('co-codeview').textContent = r.code;
  const list = $('co-players');
  list.innerHTML = '';
  for (const p of squad) {
    const li = document.createElement('li');
    li.style.borderLeftColor = SUITS[p.slot]?.[2] ?? '#888';
    li.textContent = p.name;
    const tag = document.createElement('span');
    const link = r.isHost && p.id !== r.me ? r.linkOf(p.id) : '';
    tag.textContent = [p.slot === 0 ? 'host' : '', p.id === r.me ? 'you' : '', link === 'relay' ? 'slow link' : ''].filter(Boolean).join(' · ');
    li.appendChild(tag);
    list.appendChild(li);
  }
  const maps = $('co-maps');
  maps.innerHTML = '';
  for (const mp of MAPS) {
    if (!r.isHost && mp.id !== coopMap) continue;
    const locked = r.isHost && meta.data.level < mp.unlock;
    const b = document.createElement('button');
    b.className = `map-chip${coopMap === mp.id ? ' on' : ''}`;
    b.disabled = locked;
    b.innerHTML = `<b>${esc(mp.name)}</b><span>${locked ? `Level ${mp.unlock}` : esc(mp.desc)}</span>`;
    if (r.isHost)
      b.addEventListener('click', () => {
        coopMap = mp.id;
        r.broadcast({ t: 'lobby', pl: squad, map: coopMap });
        renderCoop();
      });
    maps.appendChild(b);
  }
  const start = $<HTMLButtonElement>('co-start');
  start.classList.toggle('hidden', !r.isHost);
  start.disabled = squad.length < 2;
  start.textContent = squad.length < 2 ? 'WAITING FOR PLAYERS' : `START (${squad.length} PLAYERS)`;
}

function wireRoom(r: Room) {
  room = r;
  r.onmsg = onRoomMsg;
  r.onpeers = hostPeersChanged;
  r.onclose = (why) => {
    if (room !== r) return;
    room = null;
    squad = [];
    const midRun = game.net && (game.state === 'playing' || game.state === 'paused' || game.state === 'between');
    if (midRun) {
      game.toast(why || 'Disconnected');
      game.endRun();
    } else if (game.state === 'over') coopOverButtons();
    else {
      game.leaveSquad();
      setCoopMsg(why);
      renderCoop();
    }
  };
}

function leaveCoop() {
  const r = room;
  room = null;
  squad = [];
  r?.close();
  game.leaveSquad();
  ready.clear();
  hostReady = false;
}

function hostPeersChanged() {
  const r = room;
  if (!r?.isHost) return;
  const ids = [...r.peers.keys()];
  for (const p of squad) if (p.id !== r.me && !ids.includes(p.id) && game.net) game.dropAlly(p.id);
  squad = squad.filter((p) => p.id === r.me || ids.includes(p.id));
  for (const id of ids) {
    if (squad.some((p) => p.id === id)) continue;
    const used = new Set(squad.map((p) => p.slot));
    squad.push({ id, name: r.peers.get(id)!.name, slot: [1, 2, 3].find((s) => !used.has(s)) ?? 1 });
  }
  r.broadcast({ t: 'lobby', pl: squad, map: coopMap });
  if (!$('coop').classList.contains('hidden')) renderCoop();
  tryNextWave();
  if (game.state === 'over') coopOverButtons();
}

function onRoomMsg(from: string, m: NetMsg) {
  const r = room;
  if (!r) return;
  if (!r.isHost && (m.t === 'lobby' || m.t === 'start')) {
    squad = (m.pl as typeof squad) ?? [];
    coopMap = String(m.map ?? 'lot');
    if (m.t === 'start') beginCoopRun();
    else if (!$('coop').classList.contains('hidden')) renderCoop();
    return;
  }
  if (r.isHost && m.t === 'ready') {
    ready.add(from);
    tryNextWave();
    return;
  }
  game.netRecv(from, m);
  if (m.t === 'wave' && !r.isHost) {
    $<HTMLButtonElement>('next-wave').disabled = false;
    $('wait-msg').textContent = '';
    show(null);
    clips.pause(false);
  }
}

function tryNextWave() {
  if (!room?.isHost || !hostReady || game.state !== 'between') return;
  const waiting = game.allies.filter((a) => !ready.has(a.id));
  if (waiting.length) {
    $('wait-msg').textContent = `Waiting for ${waiting.map((a) => a.name).join(', ')}…`;
    return;
  }
  ready.clear();
  hostReady = false;
  $<HTMLButtonElement>('next-wave').disabled = false;
  $('wait-msg').textContent = '';
  show(null);
  game.startWave();
  clips.pause(false);
}

/** Host: everyone in the room starts a run together. */
function coopStart() {
  const r = room;
  if (!r?.isHost || !r.peers.size) return;
  r.open = false;
  r.broadcast({ t: 'start', pl: squad, map: coopMap });
  beginCoopRun();
}

function beginCoopRun() {
  const r = room;
  if (!r) return;
  sfx.unlock();
  goFullscreen();
  game.setSquad(r.isHost ? 'host' : 'client', r.me, squad);
  game.netSend = (to, m, fast) => {
    if (!room) return;
    if (to) room.send(to, m, fast);
    else room.broadcast(m, fast);
  };
  challenge = null;
  game.mode = 'coop';
  game.challenge = null;
  game.mutators = new Set();
  game.setMap(coopMap);
  game.modeLabel = `CO-OP · ${squad.length} PLAYERS`;
  runBadges = [];
  ready.clear();
  hostReady = false;
  $<HTMLButtonElement>('next-wave').disabled = false;
  $('wait-msg').textContent = '';
  game.newRun();
  show(null);
  if (r.isHost) game.startWave();
  else game.state = 'playing';
  clips.start();
}

function coopOverButtons() {
  const again = $<HTMLButtonElement>('again');
  again.disabled = false;
  if (!game.net) again.textContent = 'PLAY AGAIN';
  else if (room?.isHost && room.peers.size) again.textContent = 'PLAY AGAIN (SQUAD)';
  else if (room && !room.isHost) {
    again.textContent = 'WAITING FOR HOST…';
    again.disabled = true;
  } else again.textContent = 'BACK TO MENU';
}

$('coop-btn').addEventListener('click', () => openCoop());
$('co-host').addEventListener('click', async () => {
  const name = coopName();
  setCoopMsg('Opening a room…');
  $<HTMLButtonElement>('co-host').disabled = true;
  try {
    const r = await Room.host(name);
    wireRoom(r);
    squad = [{ id: r.me, name, slot: 0 }];
    coopMap = meta.data.level >= mapById(meta.data.map).unlock ? meta.data.map : 'lot';
    setCoopMsg('Send your friends the code, then start when everyone is in.');
  } catch {
    setCoopMsg("Couldn't reach the co-op server. Check your connection and try again.");
  }
  $<HTMLButtonElement>('co-host').disabled = false;
  renderCoop();
});
$('co-join').addEventListener('click', async () => {
  const code = $<HTMLInputElement>('co-code').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    setCoopMsg('Room codes are 4 letters.');
    return;
  }
  const name = coopName();
  setCoopMsg('Joining…');
  $<HTMLButtonElement>('co-join').disabled = true;
  try {
    const r = await Room.join(code, name);
    wireRoom(r);
    squad = [];
    setCoopMsg('You are in. Waiting for the host to start…');
  } catch (e) {
    const msg = (e as Error).message;
    setCoopMsg(/^(No game|That game)/.test(msg) ? msg : "Couldn't reach the co-op server. Check your connection and try again.");
  }
  $<HTMLButtonElement>('co-join').disabled = false;
  renderCoop();
});
$('co-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('co-join').click();
});
$('co-start').addEventListener('click', coopStart);
$('co-back').addEventListener('click', () => {
  if (room) {
    leaveCoop();
    setCoopMsg('');
    renderCoop();
  } else show('menu');
});
$('co-share').addEventListener('click', async () => {
  if (!room) return;
  const link = `${isFramed() ? LIVE_URL : location.origin + location.pathname}#join=${room.code}`;
  const text = `Join my Horde Mayhem co-op game 🧟 Room code ${room.code}: ${link}`;
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
    setCoopMsg('Invite copied. Paste it to your friends.');
  } catch {
    setCoopMsg(`Tell your friends the code: ${room.code}`);
  }
});
// The lobby shows who is on a slow (relayed) link; refresh it while it's open.
setInterval(() => {
  if (room && !$('coop').classList.contains('hidden')) renderCoop();
}, 1500);
// Opened from an invite link: go straight to the co-op screen with the code filled in.
{
  const m = location.hash.match(/join=([A-Za-z]{4})/);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    openCoop(m[1].toUpperCase());
  }
}

// Back from Stripe Checkout (or just opening the game): add any diamonds the server says are paid for.
async function claimPurchases() {
  const n = await pay.claim(meta.data.buyer);
  if (!n) return;
  meta.addDiamonds(n);
  refreshMenu();
  if (!$('base').classList.contains('hidden')) renderBase();
  notice(`+${n.toLocaleString()} 💎 from your purchase. Thank you!`);
  sfx.play('levelup');
}
{
  const q = new URLSearchParams(location.search);
  if (q.has('paid') || q.has('canceled')) {
    if (q.has('canceled')) notice('Purchase cancelled. No money was taken.');
    q.delete('paid');
    q.delete('canceled');
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
  }
  void claimPurchases();
  setTimeout(() => void claimPurchases(), 6000); // the webhook can land a few seconds after the redirect
}

refreshMenu();
$('play').addEventListener('click', openModes);
$('start').addEventListener('click', startRun);
$('modes-back').addEventListener('click', () => show('menu'));
$('again').addEventListener('click', () => {
  if (game.net) {
    if (room?.isHost && room.peers.size) coopStart();
    else {
      leaveCoop();
      game.newRun();
      game.state = 'menu';
      refreshMenu();
      show('menu');
    }
    return;
  }
  if (opAfter) {
    startOp(opAfter.next);
    return;
  }
  startRun();
});
$('next-wave').addEventListener('click', () => {
  sfx.unlock();
  if (room && game.net) {
    // Co-op: the next wave starts once the whole squad is ready.
    $<HTMLButtonElement>('next-wave').disabled = true;
    if (room.isHost) {
      hostReady = true;
      tryNextWave();
    } else {
      room.broadcast({ t: 'ready' });
      $('wait-msg').textContent = 'Waiting for the squad…';
    }
    return;
  }
  show(null);
  game.startWave();
  clips.pause(false);
});
/** Screen the pause menu was opened from between waves (perks or shop), so Resume goes back there. */
let pausedFrom: string | null = null;
for (const id of ['perks', 'shop'])
  $(`${id}-back`).addEventListener('click', () => {
    pausedFrom = id;
    show('pause');
  });
$('resume').addEventListener('click', () => {
  sfx.unlock();
  if (pausedFrom) {
    show(pausedFrom);
    pausedFrom = null;
    return;
  }
  show(null);
  game.state = 'playing';
  clips.pause(false);
});
$('pause-back').addEventListener('click', () => $('resume').click());
$('over-back').addEventListener('click', () => {
  leaveCoop();
  game.newRun();
  game.state = 'menu';
  refreshMenu();
  show('menu');
});
// Escape works like the on-screen back button of whichever screen is open.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = screens.find((s) => !$(s).classList.contains('hidden'));
  if (!open) return;
  $(open).querySelector<HTMLButtonElement>('.topbar .back-btn')?.click();
  input.clearPressed(); // so the game does not also read this Escape as "pause" right after resuming
});
$('quit').addEventListener('click', () => {
  pausedFrom = null;
  clips.stop();
  // Quitting still banks XP, brains and mission progress.
  if (game.wave > 0) meta.finishRun(game.summary().report, game.mode, game.map.id, game.challenge);
  leaveCoop();
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
// Touch aim assist, remembered per device.
try {
  game.aimAssist = localStorage.getItem('horde-aimassist') !== '0';
} catch {
  /* storage blocked: keep the default */
}
function syncAimLabel() {
  $('aimassist').textContent = game.aimAssist ? '🎯 Aim assist on' : '🎯 Aim assist off';
}
syncAimLabel();
$('aimassist').addEventListener('click', () => {
  game.aimAssist = !game.aimAssist;
  try {
    localStorage.setItem('horde-aimassist', game.aimAssist ? '1' : '0');
  } catch {
    /* storage blocked */
  }
  syncAimLabel();
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
// A tiny buzz on every menu button press so taps feel solid on phones.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  const b = (e.target as HTMLElement).closest('button');
  if (b && !b.disabled) navigator.vibrate?.(8);
});
// Any first touch anywhere unlocks audio on mobile browsers.
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.netTick(dt);
  game.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (__PWA__ && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

if (import.meta.env.DEV) Object.assign(window, { game, clips, coop: () => room, ui: { show, showPerks, showShop, openBase, openModes, openCoop } });
