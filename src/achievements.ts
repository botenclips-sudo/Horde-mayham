// Badges: one-off achievements with silly names. Each pays brains once and shows on the share card.

import type { RunReport } from './meta';

export interface BadgeCtx {
  r: RunReport;
  mode: string;
  totals: { runs: number; kills: number; bosses: number };
  challengeBeaten: boolean;
}

export interface BadgeDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  reward: number;
  check: (c: BadgeCtx) => boolean;
}

const onlyGun = (r: RunReport, id: string) => Object.keys(r.killsByWeapon).every((k) => k === id);

export const BADGES: BadgeDef[] = [
  { id: 'first', icon: '🩸', name: 'First Blood', desc: 'Kill your first zombie', reward: 10, check: (c) => c.r.kills >= 1 },
  { id: 'w5', icon: '🐣', name: 'Warm-Up Lap', desc: 'Reach wave 5', reward: 15, check: (c) => c.r.wave >= 5 },
  { id: 'w10', icon: '🔟', name: 'Double Digits', desc: 'Reach wave 10', reward: 30, check: (c) => c.r.wave >= 10 },
  { id: 'w20', icon: '🥈', name: 'Twenty Questions', desc: 'Reach wave 20', reward: 60, check: (c) => c.r.wave >= 20 },
  { id: 'w30', icon: '🥇', name: 'Dirty Thirty', desc: 'Reach wave 30', reward: 100, check: (c) => c.r.wave >= 30 },
  { id: 'w50', icon: '👑', name: 'Half Century', desc: 'Reach wave 50', reward: 200, check: (c) => c.r.wave >= 50 },
  { id: 'fast10', icon: '⏱️', name: 'Speedrunner', desc: 'Reach wave 10 in under 5 minutes', reward: 60, check: (c) => c.r.wave >= 10 && c.r.time < 300 },
  { id: 'boss', icon: '🎯', name: 'Big Game Hunter', desc: 'Kill a boss', reward: 30, check: (c) => c.r.bosses >= 1 },
  { id: 'boss3', icon: '🍖', name: 'Boss Buffet', desc: 'Kill 3 bosses in one run', reward: 80, check: (c) => c.r.bosses >= 3 },
  { id: 'c50', icon: '⛓️', name: 'Chain Reaction', desc: 'Chain a x50 combo', reward: 30, check: (c) => c.r.bestCombo >= 50 },
  { id: 'c100', icon: '💯', name: 'Combo Breaker? Never', desc: 'Chain a x100 combo', reward: 60, check: (c) => c.r.bestCombo >= 100 },
  { id: 'c250', icon: '🥩', name: 'Meat Grinder', desc: 'Chain a x250 combo', reward: 120, check: (c) => c.r.bestCombo >= 250 },
  { id: 'm10', icon: '🎳', name: 'Ten Pin Bowling', desc: 'Kill 10 zombies at once', reward: 40, check: (c) => c.r.bestBurst >= 10 },
  { id: 'm25', icon: '🌪️', name: 'Weapon of Mass Digestion', desc: 'Kill 25 zombies at once', reward: 100, check: (c) => c.r.bestBurst >= 25 },
  { id: 'train', icon: '🚆', name: 'Mind the Gap', desc: 'Let trains flatten 10 zombies in one run', reward: 40, check: (c) => c.r.trainKills >= 10 },
  { id: 'barrel', icon: '🛢️', name: 'Barrel of Laughs', desc: 'Kill 15 zombies with barrels and pumps in one run', reward: 40, check: (c) => c.r.barrelKills >= 15 },
  { id: 'nade', icon: '🍍', name: 'Pineapple Express', desc: 'Kill 50 zombies with grenades in one run', reward: 50, check: (c) => c.r.grenadeKills >= 50 },
  { id: 'flawless', icon: '🕊️', name: 'Untouchable', desc: 'Clear 5 waves without a scratch in one run', reward: 50, check: (c) => c.r.flawlessWaves >= 5 },
  { id: 'revive', icon: '🧟', name: 'Not Today', desc: 'Get back up with Second Wind', reward: 20, check: (c) => c.r.revives >= 1 },
  { id: 'pistol', icon: '🔫', name: 'Pea Shooter Pro', desc: 'Reach wave 15 killing only with the pistol', reward: 80, check: (c) => c.r.wave >= 15 && onlyGun(c.r, 'pistol') },
  { id: 'elite', icon: '💀', name: 'Elite Beat Down', desc: 'Kill 10 elite zombies in one run', reward: 40, check: (c) => c.r.elites >= 10 },
  { id: 'necro', icon: '✝️', name: 'Exorcist', desc: 'Kill 5 necromancers in one run', reward: 40, check: (c) => (c.r.killsByKind.necro ?? 0) >= 5 },
  { id: 'hard15', icon: '🦾', name: 'Iron Stomach', desc: 'Reach wave 15 in Hardcore', reward: 100, check: (c) => c.mode === 'hardcore' && c.r.wave >= 15 },
  { id: 'rush5', icon: '🚨', name: 'Boss Rush Hour', desc: 'Kill 5 bosses in one Boss Rush', reward: 80, check: (c) => c.mode === 'bossrush' && c.r.bosses >= 5 },
  { id: 'daily', icon: '📅', name: 'Daily Grind', desc: 'Play a Daily Challenge', reward: 15, check: (c) => c.mode === 'daily' && c.r.wave >= 1 },
  { id: 'challenge', icon: '⚔️', name: 'Called Out', desc: "Beat a friend's challenge", reward: 50, check: (c) => c.challengeBeaten },
  { id: 'runs25', icon: '🔁', name: 'Glutton for Punishment', desc: 'Play 25 runs', reward: 50, check: (c) => c.totals.runs >= 25 },
  { id: 'k10k', icon: '🧮', name: 'Zombie Accountant', desc: 'Kill 10,000 zombies in total', reward: 150, check: (c) => c.totals.kills >= 10000 },
];

export const badgeById = (id: string) => BADGES.find((b) => b.id === id);
