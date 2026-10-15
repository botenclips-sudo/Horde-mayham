import './style.css';
import { Sfx } from './audio';
import { Game, RunSummary } from './game';
import { Input } from './input';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
const input = new Input(canvas);
input.touchMode = window.matchMedia('(pointer: coarse)').matches;
const sfx = new Sfx();

const screens = ['menu', 'perks', 'shop', 'pause', 'over'];
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

function showGameOver(s: RunSummary) {
  const m = Math.floor(s.time / 60);
  const sec = Math.floor(s.time % 60)
    .toString()
    .padStart(2, '0');
  $('over-stats').innerHTML =
    `Reached <b>wave ${s.wave}</b>${s.newBest ? ' 🏆 new best!' : ` (best: wave ${s.best})`}<br>` +
    `<b>${s.kills}</b> zombies killed<br>Best combo <b>x${s.bestCombo}</b><br><b>$${s.cash}</b> earned<br>Survived <b>${m}:${sec}</b>`;
  $('best').textContent = `wave ${s.best}`;
  show('over');
}

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

$('best').textContent = `wave ${game.best}`;
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
