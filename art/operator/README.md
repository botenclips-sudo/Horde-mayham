# Operator player model (Blender)

The player character is modelled, textured and posed procedurally in Blender (tested with
Blender 5.3 via the `bpy` Python module; Blender 4.x CLI works too with `blender -b -P`).

```bash
python build_operator.py sprites out/ 8 all   # 8 walk frames + idle, colour + jacket masks
python build_operator.py down out/            # knocked-down pose
python build_operator.py showcase out/ -32    # HD studio render (RX/RY/SMP env vars set size/samples)
python pack_atlas.py out/ ../../src/assets/operator.png
```

Layers: `under` = legs, sneakers, jacket body, chest rig, hip pouch; `over` = sleeves,
gloves, head, hair, headset, glasses. The game draws under -> procedural gun -> over.
Masks mark the puffer jacket so `src/playerArt.ts` can tint it per co-op slot / suit skin.
1 game unit = 1.5 cm; a sprite cell covers 72 units (down pose: 130).
