"""Builds the original 'Operator' player character procedurally in Blender.

Run: blender -b --factory-startup -P operator.py -- <mode> <outdir>
mode: showcase | sprites
Faces +X, Z up, feet on z=0. 1 game unit = 0.015 m.
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
MODE, OUT = argv[0], argv[1]
EXTRA = argv[2:] if len(argv) > 2 else []
os.makedirs(OUT, exist_ok=True)

U = 0.015  # metres per game unit
HZ = 1.60  # head centre height

# ------------------------------------------------------------------ helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj

MATS = {}
def mat(name, color, rough=0.5, metal=0.0, emit=None, emit_str=0.0, bump=0.0, bump_scale=60.0,
        noise_col=None, sheen=0.0, coat=0.0, transmission=0.0, ior=1.45, wave=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
        b.inputs['IOR'].default_value = ior
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_str
    tc = nt.nodes.new('ShaderNodeTexCoord')
    if noise_col:
        # Camo / mottled colour: noise -> colour ramp with several stops.
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = noise_col.get('scale', 6)
        nz.inputs['Detail'].default_value = 6
        nz.inputs['Distortion'].default_value = noise_col.get('distort', 1.5)
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        cr = ramp.color_ramp
        cr.interpolation = 'CONSTANT' if noise_col.get('hard') else 'LINEAR'
        stops = noise_col['stops']
        cr.elements[0].position = stops[0][0]; cr.elements[0].color = (*stops[0][1], 1)
        cr.elements[1].position = stops[1][0]; cr.elements[1].color = (*stops[1][1], 1)
        for pos, c in stops[2:]:
            e = cr.elements.new(pos); e.color = (*c, 1)
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    if bump or wave:
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump or 0.4
        if wave:
            wt = nt.nodes.new('ShaderNodeTexWave')
            wt.wave_type = 'BANDS'
            wt.bands_direction = wave.get('dir', 'Z')
            wt.inputs['Scale'].default_value = wave.get('scale', 40)
            wt.inputs['Distortion'].default_value = wave.get('distort', 2)
            wt.inputs['Detail'].default_value = 4
            nt.links.new(tc.outputs['Object'], wt.inputs['Vector'])
            nt.links.new(wt.outputs['Fac'], bp.inputs['Height'])
        else:
            nz2 = nt.nodes.new('ShaderNodeTexNoise')
            nz2.inputs['Scale'].default_value = bump_scale
            nz2.inputs['Detail'].default_value = 8
            nt.links.new(tc.outputs['Object'], nz2.inputs['Vector'])
            nt.links.new(nz2.outputs['Fac'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    MATS[name] = m
    return m

def assign(obj, m):
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return obj

def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj

def skin_obj(name, verts, edges, radii, m, sub=2, displace=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([Vector(v) for v in verts], edges, [])
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for i, r in enumerate(radii):
        d = me.skin_vertices[0].data[i]
        d.radius = r if isinstance(r, tuple) else (r, r)
    me.skin_vertices[0].data[0].use_root = True
    ss = ob.modifiers.new('sub', 'SUBSURF')
    ss.levels = sub; ss.render_levels = sub
    if displace:
        tex = bpy.data.textures.new(name + 'tex', 'WOOD')
        tex.wood_type = 'BANDS'
        tex.noise_basis_2 = 'SIN'
        tex.noise_scale = displace.get('scale', 0.05)
        tex.turbulence = 0.5
        dm = ob.modifiers.new('puff', 'DISPLACE')
        dm.texture = tex
        dm.texture_coords = 'OBJECT' if False else 'LOCAL'
        dm.strength = displace.get('strength', 0.012)
        dm.direction = 'NORMAL'
        dm.mid_level = 0.5
    assign(ob, m)
    return ob

def bake(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = me
    return ob

def quilt(ob, origin, axis, period, amp, sharp=0.6):
    """Puffer-jacket baffles: push vertices out in rounded bands along an axis."""
    bake(ob)
    o = Vector(origin); ax = Vector(axis).normalized()
    me = ob.data
    for v in me.vertices:
        t = (v.co - o).dot(ax) / period
        f = abs(math.sin(t * math.pi)) ** sharp
        v.co += v.normal * (amp * (f - 0.5))
    s = ob.modifiers.new('sub', 'SUBSURF'); s.levels = 1; s.render_levels = 1
    smooth(ob)
    return ob

def prim_box(name, loc, size, m, rot=(0, 0, 0), bevel=0.01, sub=1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        bv = ob.modifiers.new('bev', 'BEVEL')
        bv.width = bevel; bv.segments = 3
    if sub:
        s = ob.modifiers.new('sub', 'SUBSURF'); s.levels = sub; s.render_levels = sub
        if bevel:
            pass
    smooth(ob)
    return assign(ob, m)

def prim_cyl(name, loc, r, depth, m, rot=(0, 0, 0), verts=32, bevel=0.003):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    if bevel:
        bv = ob.modifiers.new('bev', 'BEVEL'); bv.width = bevel; bv.segments = 2
    smooth(ob)
    return assign(ob, m)

def prim_sphere(name, loc, r, m, scale=(1, 1, 1), seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    smooth(ob)
    return assign(ob, m)

def tube(name, pts, r, m, res=12):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 4
    cu.resolution_u = res
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bpt, p in zip(sp.bezier_points, pts):
        bpt.co = p
        bpt.handle_left_type = bpt.handle_right_type = 'AUTO'
    ob = link(bpy.data.objects.new(name, cu))
    cu.materials.append(m)
    return ob

def strap(name, pts, w, t, m):
    """Flat nylon strap along a path (bevel with a rectangle profile)."""
    ob = tube(name, pts, 0.0, m)
    prof = bpy.data.curves.new(name + 'prof', 'CURVE')
    sp = prof.splines.new('POLY')
    sp.points.add(3)
    for p, c in zip(sp.points, [(-w / 2, -t / 2), (w / 2, -t / 2), (w / 2, t / 2), (-w / 2, t / 2)]):
        p.co = (c[0], c[1], 0, 1)
    sp.use_cyclic_u = True
    po = link(bpy.data.objects.new(name + 'prof', prof))
    po.hide_render = True
    ob.data.bevel_mode = 'OBJECT'
    ob.data.bevel_object = po
    ob.data.use_fill_caps = True
    return ob

# ------------------------------------------------------------------ materials
def make_mats(sprite):
    jacket = 0.42 if sprite else 0.014
    mat('jacket', (jacket, jacket, jacket * 1.04), rough=0.38, sheen=0.25, bump=0.35, bump_scale=90)
    mat('jeans', (0.028, 0.028, 0.032), rough=0.85, bump=0.5, wave={'dir': 'X', 'scale': 260, 'distort': 6})
    jm = MATS['jeans']; nt = jm.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 11; nz.inputs['Detail'].default_value = 3
    nz.inputs['Roughness'].default_value = 0.75
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
    cr.elements[0].position = 0.7; cr.elements[0].color = (0, 0, 0, 1)
    cr.elements[1].position = 0.72; cr.elements[1].color = (1, 1, 1, 1)
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(ramp.outputs['Color'], mix.inputs['Factor'])
    mix.inputs['A'].default_value = (0.03, 0.03, 0.034, 1)
    mix.inputs['B'].default_value = (0.78, 0.64, 0.55, 1)
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    mat('rip', (0.85, 0.82, 0.78), rough=0.9, bump=0.8, bump_scale=300)
    mat('skin', (0.7, 0.48, 0.38), rough=0.45, sheen=0.1)
    sb = MATS['skin'].node_tree.nodes['Principled BSDF']
    sb.inputs['Subsurface Weight'].default_value = 0.25
    sb.inputs['Subsurface Radius'].default_value = (0.01, 0.004, 0.002)
    sb.inputs['Subsurface Scale'].default_value = 0.03
    mat('lip', (0.72, 0.42, 0.40), rough=0.35)
    mat('sclera', (0.9, 0.88, 0.86), rough=0.15, coat=1.0)
    mat('iris', (0.06, 0.05, 0.05), rough=0.1, coat=1.0)
    mat('brow', (0.2, 0.2, 0.22), rough=0.7)
    mat('blush', (0.92, 0.55, 0.5), rough=0.5)
    mat('hair', (0.42, 0.43, 0.46), rough=0.32, sheen=0.4, coat=0.2)
    hm = MATS['hair']; nt = hm.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    gr = nt.nodes.new('ShaderNodeTexGradient'); gr.gradient_type = 'RADIAL'
    nt.links.new(tc.outputs['Object'], gr.inputs['Vector'])
    mth = nt.nodes.new('ShaderNodeMath'); mth.operation = 'MULTIPLY'; mth.inputs[1].default_value = 140
    nt.links.new(gr.outputs['Fac'], mth.inputs[0])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 22; nz.inputs['Distortion'].default_value = 1.5
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'MULTIPLY_ADD'; add.inputs[1].default_value = 6
    nt.links.new(nz.outputs['Fac'], add.inputs[0]); nt.links.new(mth.outputs[0], add.inputs[2])
    sn = nt.nodes.new('ShaderNodeMath'); sn.operation = 'SINE'
    nt.links.new(add.outputs[0], sn.inputs[0])
    bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.25
    nt.links.new(sn.outputs[0], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
    cr.elements[0].color = (0.22, 0.225, 0.24, 1); cr.elements[1].color = (0.4, 0.41, 0.44, 1)
    nt.links.new(sn.outputs[0], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    mat('tan', (0.36, 0.28, 0.17), rough=0.55, bump=0.15, bump_scale=200)
    mat('tan_dark', (0.17, 0.13, 0.08), rough=0.6)
    mat('rubber', (0.02, 0.02, 0.02), rough=0.6)
    mat('glove', (0.012, 0.012, 0.013), rough=0.7, bump=0.3, bump_scale=200)
    mat('lens', (1.0, 0.35, 0.08), rough=0.03, transmission=0.92, ior=1.2, coat=1.0, emit=(1.0, 0.3, 0.04), emit_str=0.15)
    mat('frame', (0.05, 0.05, 0.05), rough=0.3)
    mat('nylon', (0.07, 0.075, 0.068), rough=0.92, bump=0.7, wave={'dir': 'X', 'scale': 420, 'distort': 0.5})
    mat('pouch', (0.15, 0.165, 0.15), rough=0.93, bump=0.55, bump_scale=420)
    mat('glow', (1.0, 0.45, 0.05), rough=0.3, emit=(1.0, 0.42, 0.04), emit_str=25)
    mat('sneaker', (0.85, 0.85, 0.84), rough=0.45, bump=0.12, bump_scale=200)
    mat('sole', (0.92, 0.91, 0.88), rough=0.7)
    mat('metal', (0.06, 0.06, 0.065), rough=0.35, metal=0.9)
    mat('camo', (0.3, 0.25, 0.2), rough=0.55, noise_col={'scale': 9, 'distort': 2.5, 'hard': True, 'stops': [
        (0.0, (0.26, 0.21, 0.14)), (0.42, (0.15, 0.13, 0.09)), (0.55, (0.35, 0.31, 0.22)), (0.7, (0.08, 0.07, 0.06))]})
    mat('suppressor', (0.09, 0.07, 0.07), rough=0.35, metal=0.6, coat=0.5)
    mat('patch', (0.85, 0.42, 0.06), rough=0.6)
    mat('teal', (0.2, 0.9, 0.85), emit=(0.2, 0.9, 0.85), emit_str=2)

# ------------------------------------------------------------------ character parts
HIP_Y = 0.095
STRIDE_SMALL = MODE != 'showcase'
THIGH, SHIN = 0.41, 0.39

def leg_pose(phase, side, walking):
    """Hip, knee, ankle, toe positions for one leg. side: +1 left, -1 right."""
    if walking:
        ph = phase + (0 if side > 0 else math.pi)
        a1 = (0.27 if STRIDE_SMALL else 0.42) * math.sin(ph)                      # thigh swing (+ forward)
        bend = 0.12 + 0.75 * max(0.0, math.cos(ph)) ** 2 * (1 if math.sin(ph) > -0.3 else 0.4)
        a2 = a1 - bend
        lift = 0.0
    else:
        a1 = 0.05 * side
        a2 = a1 - 0.08
    hip = Vector((0.0, side * HIP_Y, 0.0))
    knee = hip + Vector((math.sin(a1) * THIGH, 0, -math.cos(a1) * THIGH))
    ankle = knee + Vector((math.sin(a2) * SHIN, side * 0.01, -math.cos(a2) * SHIN))
    return hip, knee, ankle, a2

def build_character(phase=0.0, walking=False, rifle=True, sprite=False):
    coll = bpy.context.scene.collection
    parts = {'under': [], 'over': [], 'gun': []}
    # Legs: solve both, then lift the pelvis so the lowest heel touches the floor.
    legs = {s: leg_pose(phase, s, walking) for s in (1, -1)}
    lowest = min(l[2].z for l in legs.values())
    pelvis_z = 0.085 - lowest + (0.012 * math.cos(phase * 2) if walking else 0)
    for side, (hip, knee, ankle, a2) in legs.items():
        off = Vector((0, 0, pelvis_z))
        h, k, a = hip + off, knee + off, ankle + off
        mid1 = h.lerp(k, 0.5) + Vector((0.01, 0, 0))
        mid2 = k.lerp(a, 0.5)
        leg = skin_obj(f'jeans{side}', [h + Vector((0, -side * 0.02, 0.06)), mid1, k, mid2, a + Vector((0, 0, 0.04))],
                       [(0, 1), (1, 2), (2, 3), (3, 4)],
                       [(0.095, 0.095), (0.085, 0.085), (0.066, 0.068), (0.06, 0.06), (0.058, 0.058)], MATS['jeans'])
        parts['under'].append(leg)
        # Sneaker: foot points along X, flat on the floor (or tipped while swinging).
        foot_pitch = 0.0
        if walking:
            ph = phase + (0 if side > 0 else math.pi)
            foot_pitch = 0.35 * min(0.0, math.cos(ph)) if a.z > 0.1 else 0.0
        fc = a + Vector((0.055, 0, -0.04))
        rot = (0, -foot_pitch, 0)
        R = Matrix.Rotation(-foot_pitch, 3, 'Y')
        heel = a + Vector((-0.06, 0, -0.045)); ball = a + R @ Vector((0.11, 0, -0.06)); toe = a + R @ Vector((0.175, 0, -0.065))
        up = skin_obj(f'shoe{side}', [a + Vector((0, 0, 0.02)), heel, a + R @ Vector((0.05, 0, -0.03)), ball, toe],
                      [(0, 1), (0, 2), (2, 3), (3, 4)], [(0.072, 0.072), (0.062, 0.062), (0.066, 0.066), (0.062, 0.062), (0.05, 0.05)], MATS['sneaker'])
        sole = prim_box(f'sole{side}', a + R @ Vector((0.055, 0, -0.088)), (0.27, 0.105, 0.036), MATS['sole'], rot=rot, bevel=0.016)
        strapo = prim_box(f'velcro{side}', a + Vector((0.035, 0, 0.005)), (0.06, 0.118, 0.035), MATS['sneaker'], rot=rot, bevel=0.008)
        collar = prim_cyl(f'collar{side}', a + Vector((0, 0, 0.03)), 0.058, 0.07, MATS['sneaker'])
        lace = prim_box(f'lace{side}', fc + Vector((0.06, 0, 0.06)), (0.09, 0.04, 0.008), MATS['sole'], rot=rot, bevel=0.002, sub=0)
        parts['under'] += [up, sole, strapo, collar, lace]

    pz = pelvis_z
    # Torso: puffer jacket with a tall collar. Wide, boxy, quilted.
    torso = skin_obj('jacket', [(0, 0, pz - 0.15), (0, 0, pz - 0.02), (0.0, 0, pz + 0.12), (0.0, 0, pz + 0.26), (0.0, 0, pz + 0.4), (-0.005, 0, pz + 0.52),
                                (-0.01, 0, pz + 0.66), (0.005, 0.2, pz + 0.53), (0.005, -0.2, pz + 0.53)],
                     [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (5, 7), (5, 8)],
                     [(0.19, 0.17), (0.19, 0.165), (0.185, 0.16), (0.19, 0.16), (0.195, 0.158), (0.165, 0.14), (0.08, 0.082), (0.105, 0.105), (0.105, 0.105)],
                     MATS['jacket'], sub=3)
    quilt(torso, (0, 0, pz + 0.03), (0, 0, 1), 0.072, 0.017, sharp=0.22)
    parts['under'].append(torso)
    # Front zip
    zp = prim_box('zip', (0.158, 0.0, pz + 0.2), (0.012, 0.014, 0.5), MATS['metal'], bevel=0.003, sub=0)
    parts['under'].append(zp)

    # Chest rig: front panel, shoulder straps crossing to the back, side pouch with an orange light.
    sz = pz + 0.42
    panel = prim_box('rigpanel', (0.15, 0.0, sz - 0.04), (0.07, 0.28, 0.17), MATS['nylon'], bevel=0.015)
    parts['under'].append(panel)
    for yy in (-0.08, 0.0, 0.08):
        mg = prim_box(f'magp{yy}', (0.19, yy, sz - 0.02), (0.035, 0.07, 0.12), MATS['pouch'], bevel=0.008)
        parts['under'].append(mg)
    radio = prim_box('radio', (0.175, 0.1, sz + 0.09), (0.04, 0.05, 0.08), MATS['rubber'], bevel=0.006)
    parts['under'].append(radio)
    for side in (1, -1):
        st = strap(f'strap{side}', [(0.165, side * 0.1, sz + 0.03), (0.135, side * 0.12, pz + 0.55), (0.03, side * 0.135, pz + 0.63),
                                    (-0.11, side * 0.12, pz + 0.55), (-0.155, side * 0.08, pz + 0.3)], 0.045, 0.008, MATS['nylon'])
        parts['under'].append(st)
        bk = prim_box(f'buckle{side}', (0.155, side * 0.105, pz + 0.55), (0.025, 0.05, 0.03), MATS['rubber'], bevel=0.004, sub=0)
        parts['under'].append(bk)
    # Waist belt and the big grey dump pouch on the right hip.
    parts['under'] += build_pouch(Vector((0.02, -0.225, pz - 0.15)), pz)
    # Orange unit patch on the left shoulder (original 'HM' horde badge).
    patch = prim_box('patch', (0.03, 0.262, pz + 0.48), (0.07, 0.012, 0.06), MATS['patch'], bevel=0.006, rot=(0.25, 0, 0))
    parts['over'].append(patch)

    # Arms: puffy sleeves in a two-handed rifle hold. Hands match the game's grip points.
    sh = {1: Vector((0.0, 0.195, pz + 0.53)), -1: Vector((0.0, -0.195, pz + 0.53))}
    hand_r = Vector((0.2, -0.055 if STRIDE_SMALL else -0.03, pz + 0.3))   # trigger hand (right)
    hand_l = Vector((0.36, 0.012 if STRIDE_SMALL else -0.03, pz + 0.32))  # support hand (left)
    elbow_r = Vector((0.03, -0.27, pz + 0.3))
    elbow_l = Vector((0.2, 0.15, pz + 0.28))
    for side, hand, elbow in ((1, hand_l, elbow_l), (-1, hand_r, elbow_r)):
        wrist = hand - (hand - elbow).normalized() * 0.07
        sl = skin_obj(f'sleeve{side}', [sh[side], sh[side].lerp(elbow, 0.5), elbow, elbow.lerp(wrist, 0.5), wrist],
                      [(0, 1), (1, 2), (2, 3), (3, 4)],
                      [(0.078, 0.078), (0.072, 0.072), (0.064, 0.064), (0.058, 0.058), (0.05, 0.05)],
                      MATS['jacket'], sub=3)
        quilt(sl, sh[side], elbow - sh[side], 0.062, 0.014, sharp=0.22)
        parts['over'].append(sl)
        cuff = prim_cyl(f'cuff{side}', wrist, 0.043, 0.03, MATS['nylon'])
        cuff.rotation_euler = Euler((0, math.pi / 2, 0)).to_matrix().to_euler()
        d = (hand - wrist).normalized()
        cuff.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        parts['over'].append(cuff)
        parts['over'] += build_glove(side, hand, wrist)

    # Head, face, hair, headset, glasses.
    hz = pz + 0.72
    neck = prim_cyl('neck', (0, 0, hz - 0.12), 0.05, 0.1, MATS['skin'])
    parts['over'].append(neck)
    head = prim_sphere('head', (0.0, 0, hz), 0.1, MATS['skin'], scale=(1.0, 0.86, 1.12), seg=64)
    # Shape the skull into a face: tapered jaw, pointed chin, flatter cheeks, eye sockets.
    for v in head.data.vertices:
        c = v.co - Vector((0, 0, hz))
        low = max(0.0, -c.z) / 0.112           # 0 at eye line .. 1 at chin
        front = max(0.0, c.x) / 0.1
        c.y *= 1 - 0.38 * low ** 1.3 * (0.5 + 0.5 * front)
        c.x *= 1 - 0.12 * low * (1 - front)
        if c.z < -0.06:
            c.x += 0.012 * front * (low - 0.5)
        # Shallow eye sockets
        for ey in (0.034, -0.034):
            d = math.hypot(c.y - ey, c.z - 0.004)
            if c.x > 0.06 and d < 0.026:
                c.x -= 0.006 * (1 - d / 0.026)
        v.co = c + Vector((0, 0, hz))
    parts['over'].append(head)
    # Nose: bridge + tip + nostrils.
    nose = skin_obj('nose', [(0.094, 0, hz + 0.0), (0.103, 0, hz - 0.03), (0.099, 0, hz - 0.04)], [(0, 1), (1, 2)],
                    [(0.0045, 0.0045), (0.0062, 0.0062), (0.005, 0.005)], MATS['skin'])
    parts['over'].append(nose)
    for side in (1, -1):
        nst = prim_sphere(f'nostril{side}', (0.096, side * 0.0065, hz - 0.04), 0.0045, MATS['skin'], scale=(1, 1, 0.7), seg=16)
        parts['over'].append(nst)
    # Lips: upper and lower, slightly parted in a calm half smile.
    ul = tube('lipup', [(0.088, 0.016, hz - 0.064), (0.095, 0.0, hz - 0.062), (0.088, -0.016, hz - 0.063)], 0.0028, MATS['lip'])
    ll = tube('liplow', [(0.086, 0.012, hz - 0.069), (0.092, 0.0, hz - 0.0705), (0.086, -0.012, hz - 0.069)], 0.0034, MATS['lip'])
    parts['over'] += [ul, ll]
    # Eyes (visible through the tinted lenses), brows, faint blush.
    for side in (1, -1):
        ey = side * 0.034
        sc = prim_sphere(f'eye{side}', (0.086, ey, hz + 0.004), 0.016, MATS['sclera'], scale=(0.7, 1, 0.75), seg=24)
        ir = prim_sphere(f'iris{side}', (0.0955, ey * 0.95, hz + 0.004), 0.0075, MATS['iris'], scale=(0.5, 1, 1.05), seg=16)
        lid = tube(f'lid{side}', [(0.091, ey + 0.015, hz + 0.008), (0.098, ey, hz + 0.0145), (0.091, ey - 0.015, hz + 0.009)], 0.0018, MATS['iris'])
        brow = tube(f'brow{side}', [(0.094, ey + 0.02, hz + 0.034), (0.1, ey, hz + 0.039), (0.096, ey - 0.018, hz + 0.036)], 0.0025, MATS['brow'])
        parts['over'] += [sc, ir, lid, brow]
    # Ears peek out under the cups.
    for side in (1, -1):
        ear = prim_sphere(f'ear{side}', (-0.005, side * 0.088, hz - 0.02), 0.022, MATS['skin'], scale=(0.8, 0.35, 1.2), seg=24)
        parts['over'].append(ear)
    # Hair: a bob cut. Shell around the skull with a face opening and blunt bangs.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=0.118, location=(-0.008, 0, hz + 0.012))
    hair = bpy.context.active_object; hair.name = 'hair'
    hair.scale = (1.02, 0.95, 1.08); bpy.ops.object.transform_apply(scale=True)
    bm = bmesh.new(); bm.from_mesh(hair.data)
    kill = []
    for v in bm.verts:
        lx, ly, lz = v.co.x - 0.0, v.co.y, v.co.z
        rel = lz - (hz + 0.012)
        face_open = lx > 0.0 and rel < 0.028 + 0.006 * math.sin(ly * 260) and abs(ly) < 0.082
        ang = math.atan2(ly, lx)
        too_low = rel < -0.125 + 0.035 * (lx > 0.05) + 0.012 * math.sin(ang * 23) + 0.008 * math.sin(ang * 41 + 1)
        if face_open or too_low:
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(hair.data); bm.free()
    so = hair.modifiers.new('solid', 'SOLIDIFY'); so.thickness = 0.014; so.offset = 1
    ss = hair.modifiers.new('sub', 'SUBSURF'); ss.levels = 2; ss.render_levels = 2
    smooth(hair); assign(hair, MATS['hair']); parts['over'].append(hair)
    # Strands: a few hundred tapered curves combed from the crown down over the shell.
    import random
    rnd = random.Random(7)
    cu = bpy.data.curves.new('strands', 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = 0.0042; cu.bevel_resolution = 2; cu.resolution_u = 6
    hc = Vector((-0.008, 0, hz + 0.012)); RX, RY, RZ = 0.118 * 1.02 + 0.016, 0.118 * 0.95 + 0.016, 0.118 * 1.08 + 0.016
    N = 260
    for i in range(N):
        ang = (i / N) * math.pi * 2 + rnd.uniform(-0.01, 0.01)
        ca, sa = math.cos(ang), math.sin(ang)
        front = ca > 0 and abs(sa * RY) < 0.082
        if front:
            rel = 0.028 + 0.006 * math.sin(sa * RY * 260) + rnd.uniform(-0.006, 0.004)
        else:
            rel = -0.125 + 0.035 * (ca * RX > 0.05) + 0.012 * math.sin(ang * 23) + 0.008 * math.sin(ang * 41 + 1) + rnd.uniform(-0.008, 0.004)
        e_end = math.asin(max(-0.99, min(0.99, rel / RZ)))
        e0 = math.radians(78) + rnd.uniform(-0.05, 0.05)
        sp = cu.splines.new('BEZIER'); K = 6
        sp.bezier_points.add(K - 1)
        for k, bpt in enumerate(sp.bezier_points):
            t = k / (K - 1)
            e = e0 + (e_end - e0) * t
            a = ang + 0.12 * t * (1 if sa > 0 else -1) * (0 if front else 1)
            bulge = 1.0 + 0.05 * math.sin(t * math.pi) - (0.06 * t * t if not front else 0)
            pt = hc + Vector((math.cos(e) * math.cos(a) * RX, math.cos(e) * math.sin(a) * RY, math.sin(e) * RZ)) * bulge
            bpt.co = pt
            bpt.handle_left_type = bpt.handle_right_type = 'AUTO'
            bpt.radius = 1.0 - 0.75 * t
    so = link(bpy.data.objects.new('strands', cu)); cu.materials.append(MATS['hair'])
    parts['over'].append(so)
    # Side locks that frame the face and sweep forward at the chin (bob tips).
    for side in (1, -1):
        lk = tube(f'lock{side}', [(0.03, side * 0.1, hz + 0.05), (0.06, side * 0.1, hz - 0.03), (0.075, side * 0.085, hz - 0.11)], 0.018, MATS['hair'])
        lk.data.taper_radius_mode = 'MULTIPLY'
        parts['over'].append(lk)
    # Headset: tan ear cups, a padded band over the crown, mic boom on the left.
    for side in (1, -1):
        cup = prim_cyl(f'cup{side}', (-0.005, side * 0.118, hz - 0.005), 0.05, 0.045, MATS['tan'], rot=(math.pi / 2, 0, 0))
        ring = prim_cyl(f'cupring{side}', (-0.005, side * 0.142, hz - 0.005), 0.036, 0.012, MATS['tan_dark'], rot=(math.pi / 2, 0, 0))
        knob = prim_cyl(f'knob{side}', (0.02, side * 0.15, hz + 0.01), 0.008, 0.012, MATS['rubber'], rot=(math.pi / 2, 0, 0))
        parts['over'] += [cup, ring, knob]
    band = tube('headband', [(-0.01, 0.12, hz + 0.03), (-0.01, 0.09, hz + 0.115), (-0.01, 0, hz + 0.145),
                             (-0.01, -0.09, hz + 0.115), (-0.01, -0.12, hz + 0.03)], 0.014, MATS['tan'])
    band.scale = (1, 1, 1)
    parts['over'].append(band)
    mic = tube('micboom', [(0.0, 0.14, hz - 0.03), (0.06, 0.12, hz - 0.07), (0.1, 0.05, hz - 0.075)], 0.004, MATS['rubber'])
    micball = prim_sphere('mic', (0.105, 0.045, hz - 0.075), 0.013, MATS['rubber'], seg=16)
    parts['over'] += [mic, micball]
    # Wraparound shooting glasses with orange lenses.
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.108, depth=0.034, location=(0, 0, hz + 0.008), end_fill_type='NOTHING')
    gl = bpy.context.active_object; gl.name = 'glasses'
    gl.scale = (1.0, 0.92, 1); bpy.ops.object.transform_apply(scale=True)
    bm = bmesh.new(); bm.from_mesh(gl.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x < 0.035], context='VERTS')
    bm.to_mesh(gl.data); bm.free()
    so = gl.modifiers.new('solid', 'SOLIDIFY'); so.thickness = 0.004
    ss = gl.modifiers.new('sub', 'SUBSURF'); ss.levels = 1
    smooth(gl); assign(gl, MATS['lens']); parts['over'].append(gl)
    for side in (1, -1):
        arm = tube(f'glassarm{side}', [(0.04, side * 0.1, hz + 0.012), (-0.03, side * 0.105, hz + 0.01)], 0.003, MATS['frame'])
        parts['over'].append(arm)

    if rifle:
        parts['gun'] = build_rifle(hand_r, hand_l)
    return parts, pz

def build_pouch(c, pz):
    """Grey dump pouch on the right hip: soft rounded body, curved lid, zipper with pulls,
    MOLLE webbing, a hanger strap to the belt and a small strobe with an orange glow."""
    out = []
    body = prim_box('pouchbody', c, (0.2, 0.1, 0.21), MATS['pouch'], bevel=0.035, sub=2)
    # Soft bulge: push the outer face out a little.
    bake(body)
    for v in body.data.vertices:
        if v.co.y < c.y - 0.02:
            k = max(0.0, 1 - ((v.co.x - c.x) / 0.1) ** 2) * max(0.0, 1 - ((v.co.z - c.z) / 0.105) ** 2)
            v.co.y -= 0.014 * k
    out.append(body)
    lid = prim_box('pouchlid', c + Vector((0, -0.004, 0.105)), (0.205, 0.112, 0.035), MATS['pouch'], bevel=0.016, sub=2)
    lip = prim_box('pouchlidlip', c + Vector((0, -0.058, 0.078)), (0.17, 0.012, 0.05), MATS['pouch'], bevel=0.006, sub=1)
    out += [lid, lip]
    # Vertical zipper on the outer face, with two pulls.
    zp = tube('pouchzip', [c + Vector((0.065, -0.066, 0.06)), c + Vector((0.072, -0.068, -0.0)), c + Vector((0.065, -0.066, -0.085))], 0.0035, MATS['metal'])
    out.append(zp)
    for zz in (0.04, -0.07):
        pull = prim_box(f'zpull{zz}', c + Vector((0.073, -0.072, zz)), (0.008, 0.004, 0.03), MATS['rubber'], bevel=0.002, sub=0)
        out.append(pull)
    # Chevron stitching panel (a nod to the reference's tape) and MOLLE rows.
    for i in range(3):
        for sgn in (1, -1):
            st = prim_box(f'chev{i}{sgn}', c + Vector((-0.03 + sgn * 0.012, -0.068, 0.03 - i * 0.025)), (0.026, 0.003, 0.004), MATS['nylon'],
                          rot=(0, sgn * 0.6, 0), bevel=0, sub=0)
            out.append(st)
    for i in range(3):
        mo = prim_box(f'molle{i}', c + Vector((0, 0.0, -0.05 + i * 0.035)), (0.012, 0.106, 0.012), MATS['nylon'], bevel=0.003, sub=0)
        mo.location.x = c.x - 0.101
        out.append(mo)
    hanger = strap('pouchhanger', [c + Vector((-0.04, 0.0, 0.12)), c + Vector((-0.04, 0.03, 0.16)), c + Vector((-0.04, 0.07, 0.2))], 0.035, 0.006, MATS['nylon'])
    out.append(hanger)
    # Strobe on the front edge: housing, bezel, glowing element and a real light.
    sc = c + Vector((0.108, -0.01, 0.03))
    house = prim_box('strobe', sc, (0.026, 0.05, 0.068), MATS['rubber'], bevel=0.006, sub=1)
    glow = prim_box('strobeglow', sc + Vector((0.013, 0, 0.004)), (0.006, 0.034, 0.046), MATS['glow'], bevel=0.003, sub=0)
    for zz in (-0.012, 0.0, 0.012):
        bar = prim_box(f'strobebar{zz}', sc + Vector((0.0165, 0, 0.004 + zz)), (0.002, 0.036, 0.003), MATS['rubber'], bevel=0, sub=0)
        out.append(bar)
    clip = prim_box('strobeclip', sc + Vector((-0.016, 0, 0.0)), (0.008, 0.02, 0.06), MATS['metal'], bevel=0.002, sub=0)
    out += [house, glow, clip]
    ld = bpy.data.lights.new('strobelight', 'POINT'); ld.energy = 1.2; ld.color = (1.0, 0.45, 0.05); ld.shadow_soft_size = 0.01
    lo = link(bpy.data.objects.new('strobelight', ld)); lo.location = sc + Vector((0.03, 0, 0.004))
    # Tall radio pouch next to it, like a second piece of kit.
    rp = prim_box('radiopouch', c + Vector((0.13, -0.035, 0.0)), (0.045, 0.06, 0.15), MATS['pouch'], bevel=0.012, sub=1)
    ant = tube('antenna', [c + Vector((0.13, -0.035, 0.07)), c + Vector((0.128, -0.036, 0.13)), c + Vector((0.12, -0.04, 0.17))], 0.004, MATS['rubber'])
    out += [rp, ant]
    return out

def build_glove(side, hand, wrist):
    """Tactical glove wrapped round a vertical grip under the hand: palm, 4 curled fingers,
    thumb over the top, padded knuckle strip and a velcro wrist tab."""
    out = []
    gc = Vector((hand.x, hand.y, hand.z - 0.01))       # grip axis (vertical)
    u = Vector((wrist.x - gc.x, wrist.y - gc.y, 0)).normalized()  # from grip toward the wrist (palm side)
    w = Vector((-u.y, u.x, 0)) * side                  # around the grip
    rg = 0.02
    palm = skin_obj(f'palm{side}', [wrist, gc + u * (rg + 0.03) + Vector((0, 0, 0.012)), gc + u * (rg + 0.012) + Vector((0, 0, 0.005))],
                    [(0, 1), (1, 2)], [(0.032, 0.026), (0.036, 0.022), (0.032, 0.02)], MATS['glove'])
    out.append(palm)
    for i in range(4):
        z = 0.022 - i * 0.017
        r0 = 0.0105 - i * 0.0008
        pts = []
        for k, th in enumerate((0.0, 0.9, 1.8, 2.6)):
            dirv = u * math.cos(th) + w * math.sin(th)
            pts.append(gc + dirv * (rg + 0.012) + Vector((0, 0, z - k * 0.002)))
        f = skin_obj(f'finger{side}{i}', pts, [(0, 1), (1, 2), (2, 3)], [(r0, r0), (r0 * 0.95, r0 * 0.95), (r0 * 0.9, r0 * 0.9), (r0 * 0.8, r0 * 0.8)], MATS['glove'], sub=1)
        out.append(f)
        kn = prim_box(f'knuckle{side}{i}', gc + (u * math.cos(1.2) + w * math.sin(1.2)) * (rg + 0.022) + Vector((0, 0, z)), (0.012, 0.012, 0.012), MATS['rubber'], bevel=0.004)
        out.append(kn)
    th = [gc + u * (rg + 0.02) - w * 0.012 + Vector((0, 0, 0.03)), gc - w * (rg + 0.006) + Vector((0, 0, 0.034)), gc - w * (rg + 0.004) + u * -0.012 + Vector((0, 0, 0.03))]
    out.append(skin_obj(f'thumb{side}', th, [(0, 1), (1, 2)], [(0.011, 0.011), (0.0095, 0.0095), (0.008, 0.008)], MATS['glove'], sub=1))
    tab = prim_box(f'gtab{side}', wrist + u * 0.004 + Vector((0, 0, 0.022)), (0.03, 0.035, 0.008), MATS['nylon'], bevel=0.003)
    out.append(tab)
    return out

def build_rifle(hand_r, hand_l):
    """Compact suppressed carbine with a camo finish. Bore along +X."""
    parts = []
    by = (hand_r.y + hand_l.y) / 2
    bz = hand_r.z + 0.06
    x0 = hand_r.x - 0.2
    rc = prim_box('receiver', (x0 + 0.24, by, bz), (0.26, 0.05, 0.07), MATS['camo'], bevel=0.008)
    hg = prim_box('handguard', (x0 + 0.5, by, bz + 0.004), (0.28, 0.055, 0.06), MATS['camo'], bevel=0.01)
    for i in range(6):
        sl = prim_box(f'slot{i}', (x0 + 0.4 + i * 0.035, by + 0.029, bz), (0.018, 0.004, 0.022), MATS['metal'], bevel=0.002, sub=0)
        parts.append(sl)
    rail = prim_box('rail', (x0 + 0.33, by, bz + 0.043), (0.5, 0.025, 0.014), MATS['metal'], bevel=0.002, sub=0)
    optic = prim_box('optic', (x0 + 0.22, by, bz + 0.08), (0.11, 0.045, 0.055), MATS['metal'], bevel=0.008)
    optl = prim_cyl('opticlens', (x0 + 0.28, by, bz + 0.08), 0.016, 0.004, MATS['lens'], rot=(0, math.pi / 2, 0))
    mag = prim_box('mag', (x0 + 0.27, by, bz - 0.1), (0.06, 0.035, 0.15), MATS['rubber'], rot=(0, -0.18, 0), bevel=0.006)
    tag = prim_box('magtag', (x0 + 0.27, by + 0.019, bz - 0.11), (0.03, 0.002, 0.06), MATS['teal'], rot=(0, -0.18, 0), bevel=0, sub=0)
    grip = prim_box('grip', (hand_r.x - 0.005, hand_r.y, bz - 0.07), (0.035, 0.03, 0.09), MATS['rubber'], rot=(0, 0.3, 0), bevel=0.006)
    stock = prim_box('stock', (x0 - 0.02, by, bz - 0.01), (0.2, 0.04, 0.075), MATS['camo'], bevel=0.01)
    pad = prim_box('buttpad', (x0 - 0.125, by, bz - 0.01), (0.02, 0.045, 0.09), MATS['rubber'], bevel=0.005)
    sup = prim_cyl('suppressor', (x0 + 0.78, by, bz + 0.004), 0.024, 0.24, MATS['suppressor'], rot=(0, math.pi / 2, 0))
    lamp = prim_cyl('weaponlight', (x0 + 0.58, by - 0.04, bz - 0.005), 0.014, 0.07, MATS['metal'], rot=(0, math.pi / 2, 0))
    vfg = prim_cyl('foregrip', (hand_l.x, hand_l.y, bz - 0.05), 0.014, 0.06, MATS['rubber'])
    parts += [rc, hg, rail, optic, optl, mag, tag, grip, stock, pad, sup, lamp, vfg]
    return parts

# ------------------------------------------------------------------ render setup
def setup_cycles(res_x, res_y, samples=96):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.render.resolution_x = res_x
    sc.render.resolution_y = res_y
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [v for v in ('AgX',)] else 'Filmic'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        sc.view_settings.view_transform = 'Filmic'
    sc.cycles.max_bounces = 6
    return sc

def area(name, loc, target, energy, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy; ld.size = size; ld.color = color
    lo = link(bpy.data.objects.new(name, ld))
    lo.location = loc
    lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return lo

def world(color, strength):
    w = bpy.data.worlds.new('w')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength

def camera(loc, target, lens=85, ortho=None):
    cd = bpy.data.cameras.new('cam')
    if ortho:
        cd.type = 'ORTHO'; cd.ortho_scale = ortho
    else:
        cd.lens = lens
    co = link(bpy.data.objects.new('cam', cd))
    co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = co
    return co

# ------------------------------------------------------------------ modes
def showcase():
    reset()
    make_mats(sprite=False)
    parts, pz = build_character(phase=0.0, walking=False, rifle=True)
    setup_cycles(int(os.environ.get("RX",1400)), int(os.environ.get("RY",1800)), samples=int(os.environ.get("SMP",160)))
    sc = bpy.context.scene
    sc.render.film_transparent = False
    world((0.02, 0.022, 0.025), 1.0)
    # Studio backdrop
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    fl = bpy.context.active_object
    assign(fl, mat('floor', (0.05, 0.052, 0.055), rough=0.8))
    area('key', (2.2, -2.0, 2.6), (0, 0, 1.1), 300, 1.8, (1.0, 0.95, 0.88))
    area('fill', (1.6, 2.4, 1.4), (0, 0, 1.0), 120, 2.5, (0.75, 0.85, 1.0))
    area('rim', (-2.0, 0.6, 2.4), (0, 0, 1.3), 380, 1.0, (1.0, 0.7, 0.45))
    angle = float(EXTRA[0]) if EXTRA else -32
    a = math.radians(angle)
    d = float(os.environ.get('DIST', 4.3))
    tz = float(os.environ.get('TZ', 0.88))
    camera((math.cos(a) * d, math.sin(a) * d, tz + 0.17 * d / 4.3), (0.05, -0.02, tz), lens=62)
    sc.render.filepath = os.path.join(OUT, f'showcase_{int(angle)}{os.environ.get("TAG", "")}.png')
    bpy.ops.render.render(write_still=True)

def sprite_scene(ortho_units=72, res=192, samples=48):
    setup_cycles(res, res, samples=samples)
    world((0.5, 0.52, 0.55), 0.35)
    # Light from above, slightly ahead and to the left, like a helmet lamp + moonlight.
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 2.4; sun.angle = math.radians(25)
    so = link(bpy.data.objects.new('sun', sun)); so.rotation_euler = Euler((math.radians(25), math.radians(-18), 0))
    area('top', (0.6, 0.4, 4), (0, 0, 1), 140, 3)
    camera((0, 0, 6), (0, 0, 0), ortho=ortho_units * U)

def set_layer(parts, layer, mask):
    """Show only one layer to the camera. Others still cast shadows. Mask = jacket white, rest black."""
    black = bpy.data.materials.get('maskblack') or mat('maskblack', (0, 0, 0), emit=(0, 0, 0))
    white = bpy.data.materials.get('maskwhite') or mat('maskwhite', (0, 0, 0), emit=(1, 1, 1), emit_str=1)
    for key, objs in parts.items():
        for o in objs:
            o.visible_camera = (key == layer)
            if not hasattr(o, '_orig'):
                pass
            if o.get('orig') is None:
                o['orig'] = o.data.materials[0].name if o.data.materials else ''
            name = o['orig']
            m = (white if name == 'jacket' else black) if mask else bpy.data.materials[name]
            o.data.materials.clear(); o.data.materials.append(m)

def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

def sprites():
    frames = int(EXTRA[0]) if EXTRA else 8
    which = EXTRA[1] if len(EXTRA) > 1 else 'all'
    jobs = []
    if which in ('all', 'walk'):
        jobs += [('walk%d' % i, i / frames * math.pi * 2, True) for i in range(frames)]
    if which in ('all', 'idle'):
        jobs.append(('idle', 0.0, False))
    for name, ph, walking in jobs:
        reset()
        make_mats(sprite=True)
        parts, pz = build_character(phase=ph, walking=walking, rifle=False, sprite=True)
        sprite_scene()
        layers = ['under'] + (['over'] if name == 'idle' else [])
        for layer in layers:
            for mask in (False, True):
                set_layer(parts, layer, mask)
                bpy.context.scene.cycles.samples = 8 if mask else 48
                bpy.context.scene.cycles.use_denoising = not mask
                bpy.context.scene.view_settings.view_transform = 'Standard' if mask else 'AgX'
                if not mask:
                    try:
                        bpy.context.scene.view_settings.look = 'AgX - Medium High Contrast'
                    except Exception:
                        pass
                else:
                    bpy.context.scene.view_settings.look = 'None'
                render_to(os.path.join(OUT, f'{name}_{layer}{"_mask" if mask else ""}.png'))

def down():
    """Knocked-down pose: lying on the back, seen from above."""
    reset()
    make_mats(sprite=True)
    parts, pz = build_character(phase=0, walking=False, rifle=False, sprite=True)
    root = link(bpy.data.objects.new('root', None))
    for objs in parts.values():
        for o in objs:
            o.parent = root
    # Lie on the back with the head toward +X, then sit the body on the floor.
    root.rotation_euler = (0, math.radians(-90), math.pi)
    root.location = (-0.8, 0, 0.22)
    sprite_scene(ortho_units=130, res=256)
    for mask in (False, True):
        set_layer(parts, 'under', mask)
        for o in parts['over']:
            o.visible_camera = True
        bpy.context.scene.cycles.samples = 8 if mask else 48
        bpy.context.scene.view_settings.view_transform = 'Standard' if mask else 'AgX'
        render_to(os.path.join(OUT, f'down{"_mask" if mask else ""}.png'))

def gun_sprite():
    reset()
    make_mats(sprite=True)
    pz = 0.0
    hand_r = Vector((0.2, -0.055, 0.3)); hand_l = Vector((0.36, 0.012, 0.32))
    parts = build_rifle(hand_r, hand_l)
    sprite_scene()
    render_to(os.path.join(OUT, 'rifle.png'))

{'showcase': showcase, 'sprites': sprites, 'down': down, 'gun': gun_sprite}[MODE]()
