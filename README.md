# Horde Mayhem

A top-down zombie horde shooter for the phone browser, inspired by SAS: Zombie Assault 4.

Survive escalating waves, pick a roguelite perk after every wave, spend your cash in the armory, and take down the boss every 10th wave.

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

## Code map

- `src/game.ts` – game state, update loop, rendering and HUD
- `src/data.ts` – weapons, zombie types and perks (tweak balance here)
- `src/input.ts` – keyboard/mouse and twin touch joysticks
- `src/audio.ts` – synthesized sound effects
- `src/main.ts` – menus, perk picker, shop and the frame loop
