# Horde Mayhem

A top-down zombie horde shooter for the phone browser, inspired by SAS: Zombie Assault 4.

Survive escalating waves, pick a roguelite perk after every wave, spend your cash in the armory, and take down a boss every 10th wave (The Abomination, Mother Brood on every 20th, The Juggernaut on every 30th).

Between runs you keep **brains** 🧠 and XP: unlock and master guns, train permanent stats, level up to unlock perks and a second loadout slot, and clear three daily missions. Progress is saved on the device and can be moved with a save code. Special zombies (shield brutes, leapers, screamers, crawlers, dog packs, necromancers, armored soldiers, electric zombies) join from wave 5, and elite zombies with auras from wave 15. When you die you get a share card of your run.

Three maps (Parking Lot, Gas Station with exploding fuel pumps, Subway Yard with trains) and four modes: Endless, a Daily Challenge (same map and two mutators for everyone each day), Boss Rush and Hardcore.

Gear and loot: bosses (and rare elites) drop loot crates with an armor piece or trinket in four rarities; equip them on the Gear tab, scrap spares for brains, or buy supply crates. The in-run shop also sells deployables (auto-turret, land mines, sandbag wall, healing station) that you put down with the deploy button or F.

Built for sharing: 28 badges with silly names, multi-kill slow-mo and a boss kill cam, and the game records itself so a boss kill, a massacre or your last stand can be saved as a video clip from the game-over screen. "Challenge a friend" makes a code (or a `#c=` link when hosted) that loads the same map, mode and mutators with your wave as the target.

## Controls

- **Phone:** left thumb moves, right thumb aims and fires (drag anywhere on that half). Buttons for dash, swap weapon and reload.
- **PC:** WASD to move, mouse to aim, hold left click to fire, Space or right click to dash, Q / 1-4 / mouse wheel to swap, R to reload, P or Esc to pause.

## Develop

```sh
npm install
npm run dev          # local server, also reachable from your phone on the same Wi-Fi
npm run build        # production build in dist/ (installable PWA)
npm run build:single # whole game in one HTML file in dist-single/
```

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml` (set Settings → Pages → Source to "GitHub Actions" once).

## Leaderboards

Endless and Daily Challenge runs can be posted to global leaderboards on Supabase. One-time setup: run `supabase/leaderboard.sql` in the Supabase SQL editor, then put the project's publishable key in `SUPABASE_KEY` in `src/leaderboard.ts` (never a secret key). Leaderboards stay hidden while the key is empty.

## Co-op

Online co-op for 2 to 4 players: one phone hosts a room and the others join with its 4-letter code. Players find each other through Supabase Realtime broadcast (no database tables needed), then talk over direct WebRTC data channels; if a direct link can't be made, messages go through Supabase instead at a lower rate. The host runs the zombies; each player runs their own soldier, shooting and loadout and sends hits to the host. Downed players are revived by a teammate standing next to them; the run ends when everyone is down.

To test without the internet, open two tabs with `?local` (add `&relay` to force the slow path).

## Code map

- `src/game.ts` – game state, update loop, rendering and HUD
- `src/data.ts` – weapons, zombie types and perks (tweak balance here)
- `src/input.ts` – keyboard/mouse and twin touch joysticks
- `src/audio.ts` – synthesized sound effects
- `src/maps.ts` – map layouts, ground textures and train tracks
- `src/meta.ts` – save data, brains, XP and levels, training, gun mastery, daily missions
- `src/share.ts` – the game-over share card, file saving and challenge codes
- `src/achievements.ts` – badges
- `src/gear.ts` – armor and trinket loot with rarities
- `src/leaderboard.ts` – Supabase leaderboards (table and rules in `supabase/leaderboard.sql`)
- `src/clips.ts` – rolling replay recorder for video clips
- `src/net.ts` – co-op rooms: signaling, WebRTC data channels and the relay fallback
- `src/main.ts` – menus, base screen, perk picker, shop and the frame loop

## License

All rights reserved. The source is public to read, not to reuse; see [LICENSE](LICENSE).
