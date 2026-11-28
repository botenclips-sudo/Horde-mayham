# Swarm enemies (Blender)

Every enemy kind has an original alien-bug design, modelled, shaded and posed procedurally in
Blender (tested with Blender 5.3 via the `bpy` Python module). The look is a chitinous hive
swarm kept friendly: chunky rounded shell plates, big glossy eyes with catchlights, ivory claws
and spines, soft glowing sacs, no gore.

```bash
python build_swarm.py sprites out/            # all kinds: walk0..walk5 + attack, top-down
python build_swarm.py sprites out/ walker tank # just some kinds (CELL=, SMP=, ONLY= env vars)
python build_swarm.py showcase out/ drones    # HD 3/4 lineup: drones | specials | heavies | bosses
python build_swarm.py turn out/ reaper -35    # HD close-up of one creature (ATTACK=1 for the attack pose)
python pack_swarm.py out/ ../..               # -> src/assets/swarm/<kind>.webp + src/swarmMeta.ts
```

Models are built in R units (1 Blender unit = the enemy's collision radius), facing +X. Each
kind in `KINDS` has a builder, a palette, the sprite span in R units and a cell size in pixels.
The sun is nearly overhead on purpose: sprites rotate with the enemy, so the baked shadow must
stay a soft pool under the body.

Each frame also gets an emission-only `_glow` render (glowing sacs, bio-light markings,
crystals; everything else held out). The game adds it in its glow pass, after the flashlight
darkness, so the swarm stays readable in the dark (skipped in the low-fps lite mode).

In game (`src/swarmArt.ts`) a frame is one drawImage plus a soft cool rim baked around the body. Hit/frozen/burn tints, three hue
variants and the wounded look (cracks + ichor) are baked lazily per frame. The pause menu has
an "Enemies: Swarm / Classic" switch; classic is also the fallback while a strip loads.
