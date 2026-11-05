// The diamond economy: what diamonds buy, and what you earn them from without paying.
// Rule of thumb: diamonds buy looks, convenience and time, never power you can't also earn.
// The one exception is the Prism Laser, a sidegrade (good at lines, weak at crowds) priced so a
// free player gets it in about two weeks of daily missions.

export interface SkinDef {
  id: string;
  name: string;
  colors: [string, string, string]; // body, backpack, helmet (same order as SUITS)
  price: number;
}

export const SKINS: SkinDef[] = [
  { id: 'arctic', name: 'Arctic Camo', colors: ['#c8d4dc', '#8a9aa6', '#eef4f8'], price: 120 },
  { id: 'neon', name: 'Neon Ghost', colors: ['#1a1a2a', '#0f0f1a', '#3affd0'], price: 180 },
  { id: 'blood', name: 'Blood Moon', colors: ['#6a1a1a', '#3e0e0e', '#d0302a'], price: 220 },
  { id: 'gold', name: 'Golden Commando', colors: ['#b08a2a', '#7a5e18', '#ffd84a'], price: 300 },
];

export const skinById = (id: string) => SKINS.find((s) => s.id === id);

/** Diamond prices for everything else in the diamond shop. */
export const DIAMOND_PRICE = {
  prism: 250, // exclusive gun
  stash: 100, // +12 gear stash slots, once
  eliteCrate: 60, // guaranteed epic, 20% legendary
  brains: 30, // -> BRAIN_BUNDLE brains
  reviveToken: 20, // a get-back-up you can use on the death screen
  reviveNow: 25, // revive straight from the death screen without a token
  xpBoost: 40, // double XP for XP_BOOST_RUNS runs
  reroll: 8, // swap a daily mission
};

export const BRAIN_BUNDLE = 300;
export const XP_BOOST_RUNS = 3;
export const REVIVE_TOKEN_MAX = 3;
export const STASH_BONUS = 12;

/** Free diamonds. Missions are the main faucet: about 20 a day for doing all three. */
export const missionDiamonds = (brainReward: number) => Math.max(4, Math.round(brainReward / 10));
export const LEVEL_DIAMONDS = 5;
export const BADGE_DIAMONDS = 3;
export const AD_DIAMONDS = 5;
export const AD_DIAMONDS_PER_DAY = 5;
