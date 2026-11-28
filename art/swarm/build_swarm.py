"""Builds the original 'Swarm' alien bug enemies procedurally in Blender.

Run with Blender's python module (pip `bpy`) or `blender -b -P build_swarm.py -- ...`:
  python build_swarm.py sprites <outdir> [kind ...]     # top-down frames for the game
  python build_swarm.py showcase <outdir> <lineup>      # HD 3/4 studio render of a lineup
  python build_swarm.py turn <outdir> <kind> [angle]    # HD close-up of one creature

Every creature faces +X, Z up, feet on z=0, and is modelled in "R units": 1 Blender unit is
the enemy's collision radius in the game, so one model fits any radius. The look is a
chitinous hive swarm kept friendly on purpose: chunky rounded shell plates, big glossy eyes,
stubby rounded claws, soft colours and warm glowing sacs instead of gore.
"""
import bpy, bmesh, math, sys, os, json, random
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
MODE, OUT = argv[0], argv[1]
EXTRA = argv[2:]
os.makedirs(OUT, exist_ok=True)
TAU = math.pi * 2

# ------------------------------------------------------------------ scene helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()

def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob

def hexc(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # sRGB -> linear so palette hex codes match what we see.
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

def mixhex(a, b, t):
    a, b = a.lstrip('#'), b.lstrip('#')
    ca = [int(a[i:i + 2], 16) for i in (0, 2, 4)]
    cb = [int(b[i:i + 2], 16) for i in (0, 2, 4)]
    return '#' + ''.join('%02x' % round(x + (y - x) * t) for x, y in zip(ca, cb))

MATS = {}

def mat(name, color, rough=0.45, coat=0.0, coat_rough=0.12, sss=0.0, emit=None, emit_str=0.0,
        transmission=0.0, alpha=1.0, bands=None, mottle=None, bump=0.0, bump_scale=18.0, spec=0.5, rim=None, fine=0.0, pits=0.0):
    """Principled material. `bands` adds shell-plate grooves along X (scale, groove colour),
    `mottle` a soft two-tone pattern (scale, second colour)."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    col = hexc(color) if isinstance(color, str) else color
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = spec
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = coat_rough
    if sss:
        b.inputs['Subsurface Weight'].default_value = sss
        b.inputs['Subsurface Radius'].default_value = (0.25, 0.12, 0.08)
        b.inputs['Subsurface Scale'].default_value = 0.15
    if emit:
        b.inputs['Emission Color'].default_value = (*hexc(emit), 1)
        b.inputs['Emission Strength'].default_value = emit_str
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    tc = nt.nodes.new('ShaderNodeTexCoord')
    base_out = None
    if mottle:
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = mottle[0]
        nz.inputs['Detail'].default_value = 4
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.42
        ramp.color_ramp.elements[0].color = (*col, 1)
        ramp.color_ramp.elements[1].position = 0.62
        ramp.color_ramp.elements[1].color = (*hexc(mottle[1]), 1)
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        base_out = ramp.outputs['Color']
    if bands:
        # Grooves between shell plates: a wave texture along the body axis darkens and dents.
        wv = nt.nodes.new('ShaderNodeTexWave')
        wv.wave_type = 'BANDS'
        wv.bands_direction = 'X'
        wv.wave_profile = 'SIN'
        wv.inputs['Scale'].default_value = bands[0]
        wv.inputs['Distortion'].default_value = 0.6
        wv.inputs['Detail'].default_value = 1
        nt.links.new(tc.outputs['Object'], wv.inputs['Vector'])
        cr = nt.nodes.new('ShaderNodeValToRGB')
        cr.color_ramp.elements[0].position = 0.0
        cr.color_ramp.elements[0].color = (0, 0, 0, 1)
        cr.color_ramp.elements[1].position = 0.18
        cr.color_ramp.elements[1].color = (1, 1, 1, 1)
        nt.links.new(wv.outputs['Fac'], cr.inputs['Fac'])
        mx = nt.nodes.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        mx.inputs['Factor'].default_value = 1
        nt.links.new(cr.outputs['Color'], mx.inputs['Factor'])
        mx.inputs['A'].default_value = (*hexc(bands[1]), 1)
        if base_out:
            nt.links.new(base_out, mx.inputs['B'])
        else:
            mx.inputs['B'].default_value = (*col, 1)
        base_out = mx.outputs['Result']
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = 0.35
        nt.links.new(cr.outputs['Color'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
        nt.links.new(bp.outputs['Normal'], b.inputs['Coat Normal'])
    elif pits:
        vo = nt.nodes.new('ShaderNodeTexVoronoi')
        vo.feature = 'SMOOTH_F1'
        vo.inputs['Scale'].default_value = 14
        nt.links.new(tc.outputs['Object'], vo.inputs['Vector'])
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = pits
        nt.links.new(vo.outputs['Distance'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    elif bump:
        nz2 = nt.nodes.new('ShaderNodeTexNoise')
        nz2.inputs['Scale'].default_value = bump_scale
        nz2.inputs['Detail'].default_value = 6
        nt.links.new(tc.outputs['Object'], nz2.inputs['Vector'])
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump
        nt.links.new(nz2.outputs['Fac'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    if fine:
        # Fine value noise so big shells don't look like smooth plastic.
        nz3 = nt.nodes.new('ShaderNodeTexNoise')
        nz3.inputs['Scale'].default_value = 22
        nz3.inputs['Detail'].default_value = 8
        nt.links.new(tc.outputs['Object'], nz3.inputs['Vector'])
        mf = nt.nodes.new('ShaderNodeMix'); mf.data_type = 'RGBA'; mf.blend_type = 'MULTIPLY'
        mf.inputs['Factor'].default_value = fine
        if base_out:
            nt.links.new(base_out, mf.inputs['A'])
        else:
            mf.inputs['A'].default_value = (*col, 1)
        nt.links.new(nz3.outputs['Color'], mf.inputs['B'])
        base_out = mf.outputs['Result']
        rr = nt.nodes.new('ShaderNodeMapRange')
        rr.inputs['To Min'].default_value = rough * 0.6
        rr.inputs['To Max'].default_value = min(1, rough * 1.6)
        nt.links.new(nz3.outputs['Fac'], rr.inputs['Value'])
        nt.links.new(rr.outputs['Result'], b.inputs['Roughness'])
    if rim:
        # Iridescent sheen: grazing angles shift towards a second colour, like beetle shells.
        lw = nt.nodes.new('ShaderNodeLayerWeight')
        lw.inputs['Blend'].default_value = rim[1]
        mr = nt.nodes.new('ShaderNodeMix'); mr.data_type = 'RGBA'
        nt.links.new(lw.outputs['Facing'], mr.inputs['Factor'])
        if base_out:
            nt.links.new(base_out, mr.inputs['A'])
        else:
            mr.inputs['A'].default_value = (*col, 1)
        mr.inputs['B'].default_value = (*hexc(rim[0]), 1)
        base_out = mr.outputs['Result']
    if base_out:
        nt.links.new(base_out, b.inputs['Base Color'])
    MATS[name] = m
    return m

def assign(ob, m):
    ob.data.materials.clear()
    ob.data.materials.append(m)
    return ob

def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob

def ellipsoid(name, loc, rad, m, rot=(0, 0, 0), seg=40, sub=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = rad
    smooth(ob)
    if sub:
        s = ob.modifiers.new('sub', 'SUBSURF'); s.levels = sub; s.render_levels = sub
    return assign(ob, m)

def armor(name, loc, rad, m, cut=-0.25, thick=0.05, rot=(0, 0, 0), lumpy=0.0):
    """An armour plate: the top of an ellipsoid with real thickness, so its rim casts a
    shadow onto whatever is underneath. cut = where the shell stops (-1 bottom .. 1 top)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, cut), plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.location = loc; ob.scale = rad; ob.rotation_euler = rot
    smooth(ob)
    so = ob.modifiers.new('thick', 'SOLIDIFY'); so.thickness = thick / max(rad); so.offset = -1
    so.use_even_offset = True
    if lumpy:
        tex = bpy.data.textures.new(name + 'n', 'CLOUDS'); tex.noise_scale = 0.35
        dm = ob.modifiers.new('lump', 'DISPLACE'); dm.texture = tex; dm.strength = lumpy; dm.mid_level = 0.5
    ss = ob.modifiers.new('sub', 'SUBSURF'); ss.levels = 1; ss.render_levels = 2
    return assign(ob, m)

def skin(name, pts, radii, m, sub=2, edges=None):
    """Organic tube through points (skin modifier), radius per point."""
    me = bpy.data.meshes.new(name)
    if edges is None:
        edges = [(i, i + 1) for i in range(len(pts) - 1)]
    me.from_pydata([Vector(p) for p in pts], edges, [])
    me.update()
    ob = link(bpy.data.objects.new(name, me))
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.7
    for i, r in enumerate(radii):
        me.skin_vertices[0].data[i].radius = r if isinstance(r, tuple) else (r, r)
    me.skin_vertices[0].data[0].use_root = True
    ss = ob.modifiers.new('sub', 'SUBSURF'); ss.levels = sub; ss.render_levels = sub
    return assign(ob, m)

def cone(name, base, tip, r, m, tip_r=0.02):
    """A rounded horn / spine from base towards tip."""
    mid = [(b * 0.45 + t * 0.55) for b, t in zip(base, tip)]
    return skin(name, [base, mid, tip], [r, r * 0.6, tip_r], m, sub=2)

def v(*a):
    return Vector(a)

def lerp(a, b, t):
    return a + (b - a) * t

# ------------------------------------------------------------------ palettes
# Soft, friendly hive colours: each kind gets shell, groove (between plates), accent (top
# stripes / crest), skin (joints, belly, legs), glow (sacs, eyes) and eye (iris).
PAL = {
    'violet': dict(shell='#8a62c8', groove='#3e2a6a', accent='#c9a4ff', skin='#e8b8a8', glow='#ffd36a', eye='#ffc44a'),
    'plum':   dict(shell='#a0558e', groove='#4a2244', accent='#f0a0d0', skin='#f2c6b0', glow='#ff9ad8', eye='#ffe07a'),
    'teal':   dict(shell='#3f9a9a', groove='#1a4448', accent='#8ae8d8', skin='#e6c8a8', glow='#b6ff7a', eye='#fff07a'),
    'amber':  dict(shell='#c88a3a', groove='#5a3818', accent='#ffd08a', skin='#f0d0b0', glow='#ffef8a', eye='#7af0ff'),
    'moss':   dict(shell='#7aa04a', groove='#34481c', accent='#c8e88a', skin='#e8d8a8', glow='#d8ff6a', eye='#ffb04a'),
    'slate':  dict(shell='#5a6e8a', groove='#26303e', accent='#a8c0e0', skin='#d8c8c0', glow='#ffb84a', eye='#ffb84a'),
    'rose':   dict(shell='#c86a7a', groove='#5a2a34', accent='#ffb0b8', skin='#f6d0c0', glow='#ff8aa8', eye='#ffffff'),
    'sky':    dict(shell='#5a9ad8', groove='#203c60', accent='#b8e0ff', skin='#e0d8d0', glow='#9af6ff', eye='#e0ffff'),
    'frost':  dict(shell='#9ccbe8', groove='#3a6684', accent='#eaf8ff', skin='#d8e4ee', glow='#c8f6ff', eye='#2a6aa0'),
    'sand':   dict(shell='#b8946a', groove='#4e3a24', accent='#e8d0a8', skin='#f0dcc0', glow='#ffc860', eye='#ff9a3a'),
    'ink':    dict(shell='#4a4a7a', groove='#1c1c34', accent='#8a8ad0', skin='#c8b8d8', glow='#7affd0', eye='#7affd0'),
    'lime':   dict(shell='#8ac83a', groove='#3a5a14', accent='#e0ff9a', skin='#eef0b0', glow='#e8ff5a', eye='#ff8a3a'),
    'pearl':  dict(shell='#d8d0c4', groove='#7a6e62', accent='#fff6ea', skin='#f8dcd0', glow='#ff8ab8', eye='#ff6a8a'),
    'coral':  dict(shell='#e0886a', groove='#6a2e22', accent='#ffc8a8', skin='#f8d8c4', glow='#9aff7a', eye='#5aff9a'),
    'jelly':  dict(shell='#6ad8b8', groove='#2a7a6a', accent='#c0fff0', skin='#a8f0d8', glow='#f6ff8a', eye='#203040'),
    'lilac':  dict(shell='#b8a0d8', groove='#4e3a6e', accent='#f0e0ff', skin='#f0d8e8', glow='#e08aff', eye='#e08aff'),
    'ember':  dict(shell='#b86a48', groove='#4a2214', accent='#ffb070', skin='#f0c8a8', glow='#ff8a2a', eye='#ffe03a'),
    'dusk':   dict(shell='#3c3c58', groove='#16161e', accent='#7a7aa8', skin='#a8a0c0', glow='#7affea', eye='#7affea'),
    'queen':  dict(shell='#9a58b8', groove='#3a1a4e', accent='#e8b0ff', skin='#f6c8c0', glow='#ffd84a', eye='#ff5a8a'),
}

for _p in PAL.values():
    _p['shell'] = mixhex(_p['shell'], _p['groove'], 0.18)
    _p['skin'] = mixhex(_p['skin'], _p['shell'], 0.35)

class Kit:
    """Materials for one creature."""
    def __init__(self, p, glossy=True):
        self.p = p
        k = 0.9 if glossy else 0.4
        dark = mixhex(p['shell'], p['groove'], 0.7)
        self.shell = mat('shell', p['shell'], rough=0.42, coat=k * 0.6, coat_rough=0.2, sss=0.04, bands=(9.0, p['groove']), rim=(dark, 0.45), fine=0.3, pits=0.2)
        self.plate = mat('plate', mixhex(p['shell'], p['accent'], 0.12), rough=0.4, coat=k * 0.6, coat_rough=0.2, sss=0.04, rim=(dark, 0.5), fine=0.35, pits=0.25)
        self.accent = mat('accent', p['accent'], rough=0.38, coat=k * 0.5, sss=0.1, fine=0.2)
        self.skin = mat('skin', p['skin'], rough=0.55, sss=0.3, bump=0.12, bump_scale=30, fine=0.2, rim=(mixhex(p['skin'], p['groove'], 0.5), 0.5))
        self.groove = mat('groove', p['groove'], rough=0.4, coat=0.4, sss=0.05, fine=0.2)
        self.limb = mat('limb', mixhex(p['shell'], p['groove'], 0.45), rough=0.38, coat=0.5, rim=(p['groove'], 0.45), fine=0.25)
        self.claw = mat('claw', '#f0e2c8', rough=0.28, coat=0.7, sss=0.15, fine=0.1)
        self.mark = mat('mark', mixhex(p['accent'], p['glow'], 0.35), rough=0.35, coat=0.5, sss=0.2, emit=p['glow'], emit_str=0.15)
        self.bone = mat('bone', '#e6d2b0', rough=0.3, coat=0.6, sss=0.1, fine=0.15)
        self.eye = mat('eye', mixhex(p['eye'], '#000000', 0.45), rough=0.04, coat=1.0, coat_rough=0.02, spec=0.9, rim=('#0a0a12', 0.6), emit=p['eye'], emit_str=0.12)
        self.pupil = mat('pupil', '#06060c', rough=0.05, coat=1.0, coat_rough=0.02)
        self.shine = mat('shine', '#ffffff', rough=0.1, emit='#ffffff', emit_str=4.0)
        self.glow = mat('glow', p['glow'], rough=0.15, coat=1.0, sss=0.6, emit=p['glow'], emit_str=0.9, transmission=0.15, pits=0.4)
        self.mouth = mat('mouth', '#5a1e30', rough=0.4, sss=0.3)
        self.wing = mat('wing', p['accent'], rough=0.15, transmission=0.6, alpha=0.55, emit=p['accent'], emit_str=0.2)

# ------------------------------------------------------------------ body parts
def eyes(k, at, n=2, size=0.16, spread=0.6, up=0.38):
    """Big round glossy eyes with catchlights. `at` = head centre, eyes on the top front."""
    hx, hy, hz, hr = at
    out = []
    pairs = n // 2
    for i in range(pairs):
        for s in (-1, 1):
            a = s * spread * (1 - i * 0.25)
            sz = size * (1 - i * 0.35)
            x = hx + math.cos(a) * hr * (0.62 - i * 0.22)
            y = hy + math.sin(a) * hr * (0.75 + i * 0.1)
            z = hz + hr * (up + i * 0.18)
            out.append(ellipsoid(f'eye{i}{s}', (x, y, z), (sz, sz, sz * 0.9), k.eye, seg=32, sub=1))
            out.append(ellipsoid(f'pup{i}{s}', (x + sz * 0.3, y + s * sz * 0.05, z + sz * 0.45), (sz * 0.55, sz * 0.5, sz * 0.5), k.pupil, seg=24, sub=1))
            # Catchlight: a tiny bright dot towards the light, it sells "cute" more than anything.
            out.append(ellipsoid(f'shine{i}{s}', (x - sz * 0.15, y - sz * 0.25, z + sz * 0.78), (sz * 0.26,) * 3, k.shine, seg=12, sub=0))
            # Soft rim of skin around the eye.
            out.append(ellipsoid(f'lid{i}{s}', (x - sz * 0.25, y, z - sz * 0.2), (sz * 1.15, sz * 1.15, sz * 0.8), k.skin, seg=24, sub=1))
    if n % 2:
        out.append(ellipsoid('eyeC', (hx + hr * 0.5, hy, hz + hr * 0.5), (size * 1.2,) * 3, k.eye, seg=32))
        out.append(ellipsoid('shineC', (hx + hr * 0.45, hy - size * 0.3, hz + hr * 0.5 + size), (size * 0.3,) * 3, k.shine, seg=12, sub=0))
    return out

def mandibles(k, hx, hz, hr, size=0.5, open_=0.0):
    """Two short, rounded pincers at the front of the head. open_ 0..1 for the bite frame."""
    for s in (-1, 1):
        a = s * (0.35 + open_ * 0.55)
        base = v(hx + hr * 0.75, s * hr * 0.35, hz - hr * 0.3)
        mid = base + v(math.cos(a) * size * 0.55, math.sin(a) * size * 0.55, -0.02)
        tip = mid + v(math.cos(a - s * 1.1) * size * 0.4, math.sin(a - s * 1.1) * size * 0.4, -0.01)
        skin(f'mand{s}', [base, mid, tip], [size * 0.16, size * 0.12, size * 0.04], k.claw, sub=2)

def leg(k, name, hip, foot, thick=0.09, knee_up=0.45, out=0.25, tip=True, m=None):
    """Insect leg: armoured femur up to a raised knee, slim tibia down, dark tarsus, ivory claw."""
    hip = Vector(hip); foot = Vector(foot)
    side = 1 if foot.y > hip.y else -1
    knee = lerp(hip, foot, 0.42) + v(0, side * out * 0.3, knee_up)
    ankle = lerp(knee, foot, 0.75) + v(0, 0, 0.05)
    skin(name, [hip, lerp(hip, knee, 0.55), knee], [thick * 1.15, thick * 1.25, thick * 0.8], m or k.limb, sub=2)
    skin(name + 't', [knee, ankle], [thick * 0.8, thick * 0.55], m or k.limb, sub=2)
    skin(name + 'f', [ankle, foot], [thick * 0.5, thick * 0.38], k.groove, sub=2)
    ellipsoid(name + 'kn', knee, (thick * 0.85,) * 3, k.skin, seg=16)
    # A little spur at the knee: reads as "bug" from above.
    d = (knee - hip).normalized()
    cone(name + 'spur', knee, knee + d * thick * 1.4 + v(0, 0, thick * 0.6), thick * 0.4, k.bone, tip_r=thick * 0.1)
    if tip:
        d = (foot - ankle).normalized()
        cone(name + 'toe', foot, foot + d * thick * 1.5 + v(0, 0, -0.02), thick * 0.38, k.bone, tip_r=thick * 0.12)

def gait(t, i, side, pairs, stride, lift):
    """Tripod gait: neighbouring legs and opposite sides alternate. Returns (dx, dz)."""
    off = (i % 2) * math.pi + (0 if side < 0 else math.pi)
    if pairs == 2:
        off = (i % 2) * math.pi + (0 if side < 0 else math.pi)
    u = ((t + off) / TAU) % 1.0
    if u < 0.62:  # stance: foot pushes back along the ground
        s = u / 0.62
        return stride * (0.5 - s), 0.0
    s = (u - 0.62) / 0.38  # swing: foot lifts and comes forward
    return stride * (-0.5 + s), lift * math.sin(s * math.pi)

def legs(k, t, walking, pairs=3, xs=None, reach=1.25, hip_y=0.38, hip_z=0.42, thick=0.09,
         stride=0.45, lift=0.16, fan=0.55, knee_up=0.45, m=None, attack=False):
    xs = xs or [0.35 - i * (0.7 / max(1, pairs - 1)) for i in range(pairs)]
    for i, hx in enumerate(xs):
        for s in (-1, 1):
            dx, dz = gait(t, i, s, pairs, stride, lift) if walking else (0.0, 0.0)
            # Fan the feet out: front legs reach forward, back legs reach back.
            f = (hx / max(0.01, max(abs(x) for x in xs))) if len(xs) > 1 else 0
            fx = hx + f * fan * 0.6 + dx
            fy = s * reach
            if attack:
                fx += 0.05
            leg(k, f'leg{i}{s}', (hx, s * hip_y, hip_z), (fx, fy, 0.05 + dz), thick=thick, knee_up=knee_up, m=m)

def shell_body(k, segs, mat_=None):
    """Body as overlapping armour plates over a soft body. segs = [(x, rx, ry, rz, z)] from
    head to tail. Each plate is a real shell with a lip, a spine ridge and paired markings."""
    out = []
    for i, (x, rx, ry, rz, z) in enumerate(segs):
        if mat_:
            out.append(ellipsoid(f'seg{i}', (x, 0, z), (rx, ry, rz), mat_))
            continue
        # Soft body underneath (shows in the gaps between plates).
        ellipsoid(f'soft{i}', (x, 0, z - rz * 0.05), (rx * 0.98, ry * 0.92, rz * 0.92), k.skin, seg=32)
        m = k.plate if i == 0 else k.shell
        out.append(armor(f'seg{i}', (x + rx * 0.05, 0, z + rz * 0.04), (rx * 1.08, ry * 1.1, rz * 1.08), m, cut=-0.2, thick=0.06, rot=(0, 0.2, 0), lumpy=0.012))
        ellipsoid(f'ridge{i}', (x + rx * 0.05, 0, z + rz * 0.9), (rx * 0.72, ry * 0.15, rz * 0.2), k.accent, seg=24)
        if ry > 0.25:
            for s_ in (-1, 1):
                ellipsoid(f'mark{i}{s_}', (x + rx * 0.12, s_ * ry * 0.52, z + rz * 0.66), (rx * 0.36, ry * 0.16, rz * 0.2), k.mark, seg=20, rot=(s_ * 0.55, 0, s_ * 0.25))
        ellipsoid(f'belly{i}', (x, 0, z - rz * 0.4), (rx * 0.9, ry * 0.88, rz * 0.6), k.skin, seg=24)
    return out

def back_blades(k, x=0.0, z=0.8, length=0.9, spread=0.45, width=0.13, lift=0.3, m=None):
    """The swarm's signature: a pair of curved carapace blades sweeping back from the shoulders."""
    for s in (-1, 1):
        a = v(x, s * 0.22, z)
        b = a + v(-length * 0.35, s * spread * 0.55, lift * 0.8)
        c = b + v(-length * 0.45, s * spread * 0.45, lift * 0.2)
        d = c + v(-length * 0.25, s * spread * 0.05, -lift * 0.25)
        skin(f'bb{s}', [a, b, c, d], [(width, width * 0.55), (width * 0.9, width * 0.45), (width * 0.55, width * 0.3), (0.02, 0.02)], m or k.plate, sub=2)
        skin(f'bbe{s}', [b + v(0, 0, width * 0.35), c + v(0, 0, width * 0.25), d + v(0, 0, 0.01)], [width * 0.3, width * 0.22, 0.015], k.bone, sub=2)

def spines(k, pts, size=0.18, m=None, lean=-0.6):
    """Rounded nubs along the back. pts = [(x, y, z)], they lean towards the tail."""
    for i, p in enumerate(pts):
        p = Vector(p)
        tip = p + v(lean * size, p.y * 0.25 * size, size * 1.1)
        cone(f'sp{i}', p, tip, size * 0.42, m or k.bone, tip_r=size * 0.09)

def sac(k, name, loc, r, m=None):
    ellipsoid(name, loc, (r, r, r * 0.85), m or k.glow, seg=32)
    # Little ring of shell around the sac.
    ellipsoid(name + 'ring', (loc[0], loc[1], loc[2] - r * 0.45), (r * 1.18, r * 1.18, r * 0.45), k.groove, seg=24)

def scythes(k, t, attack, shoulder=(0.45, 0.42, 0.62), length=1.0, thick=0.08, blade=True, curl=1.0):
    """Two front arms ending in a rounded hooked blade. Raised and forward when attacking."""
    for s in (-1, 1):
        sh = v(shoulder[0], s * shoulder[1], shoulder[2])
        if attack:
            el = sh + v(length * 0.35, s * length * 0.38, length * 0.38)
            wr = el + v(length * 0.6, -s * length * 0.05, 0.05)
        else:
            sw = math.sin(t + (0 if s < 0 else math.pi)) * 0.08
            el = sh + v(length * 0.15 + sw, s * length * 0.42, 0.22)
            wr = el + v(length * 0.42, -s * length * 0.18, -0.08)
        skin(f'arm{s}', [sh, el, wr], [thick * 1.3, thick, thick * 0.8], k.limb, sub=2)
        skin(f'armcap{s}', [lerp(sh, el, 0.1), lerp(sh, el, 0.85)], [thick * 1.6, thick * 1.2], k.plate, sub=2)
        if blade:
            d = (wr - el).normalized()
            side = v(-d.y, d.x, 0) * (-s)
            b1 = wr + d * length * 0.18 + side * length * 0.12 * curl
            b2 = b1 + d * length * 0.14 + side * length * 0.22 * curl
            skin(f'blade{s}', [wr, b1, b2], [thick * 1.25, thick * 0.85, thick * 0.16], k.bone, sub=2)

def claw_arm(k, name, sh, el, wr, size, open_=0.25):
    """Crab-like rounded pincer."""
    sh, el, wr = Vector(sh), Vector(el), Vector(wr)
    skin(name, [sh, el, wr], [size * 0.22, size * 0.2, size * 0.24], k.limb, sub=2)
    skin(name + 'cap', [lerp(sh, el, 0.1), lerp(sh, el, 0.9)], [size * 0.3, size * 0.26], k.plate, sub=2)
    d = (wr - el).normalized()
    palm = wr + d * size * 0.3
    ellipsoid(name + 'palm', palm, (size * 0.42, size * 0.3, size * 0.26), k.plate, rot=(0, 0, math.atan2(d.y, d.x)))
    side = v(-d.y, d.x, 0)
    for j, s in enumerate((-1, 1)):
        a = s * open_
        dd = Vector((d.x * math.cos(a) - d.y * math.sin(a), d.x * math.sin(a) + d.y * math.cos(a), 0))
        base = palm + d * size * 0.3 + side * s * size * 0.1
        tip = base + dd * size * 0.55 - side * s * size * 0.1
        skin(name + f'f{j}', [base, lerp(base, tip, 0.5) + side * s * size * 0.06, tip], [size * 0.16, size * 0.12, size * 0.03], k.claw, sub=2)

def head(k, x, z, r, eyes_n=2, eye_size=None, mand=0.45, open_=0.0, crest=None):
    ellipsoid('head', (x, 0, z), (r * 1.05, r, r * 0.82), k.limb)
    # Brow ridge: a rounded shell cap that gives the face a friendly "helmet".
    ellipsoid('brow', (x - r * 0.15, 0, z + r * 0.35), (r * 0.85, r * 0.82, r * 0.45), k.accent)
    eyes(k, (x, 0, z, r), n=eyes_n, size=eye_size or r * 0.38)
    if mand:
        mandibles(k, x, z, r, size=mand, open_=open_)
    # Small smile-shaped mouth plate.
    ellipsoid('mouth', (x + r * 0.85, 0, z - r * 0.25), (r * 0.18, r * 0.32 + open_ * 0.1, r * 0.12 + open_ * 0.1), k.mouth, seg=20)

def antenna(k, x, z, r, length=0.7, bulb=0.08, glow=True, droop=0.15):
    for s in (-1, 1):
        base = v(x + r * 0.2, s * r * 0.35, z + r * 0.6)
        mid = base + v(length * 0.45, s * length * 0.35, length * 0.25)
        tip = mid + v(length * 0.4, s * length * 0.25, -droop)
        skin(f'ant{s}', [base, mid, tip], [0.035, 0.028, 0.022], k.groove, sub=2)
        if bulb:
            ellipsoid(f'antb{s}', tip, (bulb,) * 3, k.glow if glow else k.accent, seg=20)

def wings(k, size=1.0, spread=0.6, x=0.0, z=0.95, flap=0.0):
    for s in (-1, 1):
        a = s * (spread + flap)
        rot = (0, -0.12, math.pi + a)
        cx = x - math.cos(a) * size * 0.55
        cy = math.sin(-a) * size * -0.55 * -1
        ellipsoid(f'wing{s}', (cx, s * abs(cy), z), (size * 0.7, size * 0.3, 0.02), k.wing, rot=rot, seg=32)

# ------------------------------------------------------------------ the swarm
# Each builder takes (k, t, walking, attack) and builds one pose. Spans (`span`) are the width
# of the square sprite in R units; `pal` names the palette; `cell` the sprite size in pixels.

def b_walker(k, t, w, a):
    # Drone: the everyday swarm beetle. Short, round and busy.
    legs(k, t, w, pairs=3, reach=1.05, thick=0.085, stride=0.42, attack=a)
    shell_body(k, [(-0.05, 0.5, 0.52, 0.38, 0.5), (-0.5, 0.48, 0.5, 0.36, 0.46), (-0.88, 0.32, 0.36, 0.26, 0.42)])
    head(k, 0.45, 0.52, 0.36, mand=0.4, open_=0.9 if a else 0.15)
    back_blades(k, x=0.0, z=0.82, length=0.95, spread=0.5, lift=0.35 + (0.15 if a else 0))
    spines(k, [(-0.6, 0, 0.82)], size=0.14)
    scythes(k, t, a, shoulder=(0.25, 0.36, 0.56), length=0.75, thick=0.06)

def b_runner(k, t, w, a):
    # Darter: slim, long legged, swept-back spines. Built for speed.
    legs(k, t, w, pairs=2, xs=[0.15, -0.45], reach=1.15, thick=0.07, stride=0.7, lift=0.22, knee_up=0.6)
    shell_body(k, [(0.0, 0.42, 0.36, 0.3, 0.55), (-0.45, 0.42, 0.32, 0.26, 0.52), (-0.85, 0.32, 0.22, 0.18, 0.5)])
    head(k, 0.45, 0.56, 0.3, mand=0.35, open_=0.9 if a else 0.1)
    spines(k, [(-0.1, 0.12, 0.8), (-0.1, -0.12, 0.8), (-0.5, 0, 0.76)], size=0.22, lean=-1.2)
    scythes(k, t, a, shoulder=(0.2, 0.3, 0.6), length=0.85, thick=0.05)

def b_tank(k, t, w, a):
    # Bulwark: a huge, round armoured beetle with heavy overlapping plates and a stubby horn.
    legs(k, t, w, pairs=3, xs=[0.3, -0.1, -0.5], reach=1.15, hip_y=0.6, thick=0.14, stride=0.25, lift=0.09, knee_up=0.35)
    shell_body(k, [(0.15, 0.55, 0.78, 0.5, 0.6), (-0.35, 0.55, 0.82, 0.52, 0.62), (-0.8, 0.42, 0.62, 0.42, 0.55)])
    for i, (x, y) in enumerate([(0.15, 0.62), (-0.35, 0.68), (-0.8, 0.5)]):
        for s in (-1, 1):
            cone(f'stud{i}{s}', (x, s * y, 0.8), (x - 0.1, s * (y + 0.18), 1.0), 0.1, k.bone, tip_r=0.03)
    head(k, 0.72, 0.45, 0.32, mand=0.45, open_=0.9 if a else 0.2)
    cone('horn', (0.8, 0, 0.7), (1.12 if a else 1.05, 0, 1.0), 0.13, k.bone, tip_r=0.035)

def b_bloater(k, t, w, a):
    # Puffer: a balloon of glowing gas with tiny legs. Pops when shot.
    legs(k, t, w, pairs=3, reach=0.85, hip_y=0.45, hip_z=0.3, thick=0.06, stride=0.3, lift=0.08, knee_up=0.25)
    ellipsoid('balloon', (-0.12, 0, 0.62), (0.82, 0.8, 0.62), mat('puff', k.p['shell'], rough=0.25, coat=1, sss=0.5, transmission=0.2))
    for i in range(7):
        ang = i / 7 * TAU + 0.3
        sac(k, f's{i}', (-0.12 + math.cos(ang) * 0.5, math.sin(ang) * 0.5, 0.98), 0.14)
    sac(k, 'top', (-0.12, 0, 1.22), 0.2)
    head(k, 0.62, 0.42, 0.26, mand=0.25, open_=0.6 if a else 0.1)

def b_spitter(k, t, w, a):
    # Spitter: rearing neck with a glowing throat sac, it lobs goo.
    legs(k, t, w, pairs=2, xs=[0.0, -0.55], reach=1.0, thick=0.075, stride=0.4)
    shell_body(k, [(-0.15, 0.42, 0.42, 0.32, 0.48), (-0.6, 0.46, 0.44, 0.32, 0.46), (-1.0, 0.3, 0.3, 0.22, 0.42)])
    skin('neck', [(-0.05, 0, 0.6), (0.2, 0, 0.82), (0.4, 0, 0.9)], [0.22, 0.2, 0.2], k.skin)
    sac(k, 'throat', (0.18, 0, 0.98), 0.22)
    head(k, 0.55 + (0.12 if a else 0), 0.88, 0.3, mand=0.3, open_=1.0 if a else 0.3)
    sac(k, 'back', (-0.6, 0, 0.85), 0.2)
    spines(k, [(-0.95, 0, 0.62)], size=0.15)

def b_screamer(k, t, w, a):
    # Howler: a fan of frill plates around the head that flare when it screams.
    legs(k, t, w, pairs=3, reach=1.0, thick=0.075)
    shell_body(k, [(-0.15, 0.48, 0.46, 0.34, 0.48), (-0.6, 0.42, 0.42, 0.3, 0.45)])
    head(k, 0.38, 0.55, 0.34, mand=0.3, open_=1.0 if a else 0.2)
    n = 7
    for i in range(n):
        ang = math.pi * 0.5 + (i / (n - 1)) * math.pi
        fl = 0.75 if a else 0.6
        base = v(0.18, 0, 0.75)
        tip = base + v(math.cos(ang) * fl * 0.5, math.sin(ang) * fl, 0.25)
        skin(f'frill{i}', [base, lerp(base, tip, 0.6), tip], [(0.07, 0.16), (0.08, 0.2), (0.05, 0.08)], k.accent if i % 2 else k.limb, sub=2)
        ellipsoid(f'frilldot{i}', tip, (0.07,) * 3, k.glow, seg=16)

def b_shield(k, t, w, a):
    # Bastion: carries its own bony face plate (the game draws the raised shield live).
    legs(k, t, w, pairs=3, reach=1.0, hip_y=0.5, thick=0.11, stride=0.3, lift=0.1)
    shell_body(k, [(-0.1, 0.6, 0.62, 0.42, 0.52), (-0.65, 0.5, 0.55, 0.38, 0.5)])
    head(k, 0.5, 0.48, 0.32, mand=0.35, open_=0.8 if a else 0.15)
    for s in (-1, 1):
        ellipsoid(f'pauldron{s}', (0.15, s * 0.48, 0.72), (0.32, 0.26, 0.2), k.accent)
    spines(k, [(-0.3, 0.2, 0.92), (-0.3, -0.2, 0.92), (-0.75, 0, 0.84)], size=0.15)

def b_leaper(k, t, w, a):
    # Hopper: big folded hind legs like a grasshopper.
    legs(k, t, w, pairs=2, xs=[0.35, 0.0], reach=0.85, thick=0.065, stride=0.35)
    shell_body(k, [(-0.05, 0.44, 0.38, 0.32, 0.5), (-0.5, 0.48, 0.36, 0.3, 0.48), (-0.95, 0.3, 0.24, 0.2, 0.45)])
    head(k, 0.48, 0.55, 0.32, mand=0.35, open_=0.9 if a else 0.15)
    for s in (-1, 1):
        kick = 0.25 if a else math.sin(t) * 0.05 if w else 0
        hip = v(-0.35, s * 0.32, 0.55)
        knee = v(-0.25 + kick, s * 0.85, 0.95)
        foot = v(-1.25 - kick, s * 0.75, 0.06)
        skin(f'hind{s}', [hip, lerp(hip, knee, 0.5), knee], [0.16, 0.2, 0.1], k.plate, sub=2)
        skin(f'shin{s}', [knee, foot], [0.08, 0.05], k.limb, sub=2)
        ellipsoid(f'hk{s}', knee, (0.1,) * 3, k.accent, seg=16)
        cone(f'hf{s}', foot, foot + v(-0.18, 0, -0.02), 0.05, k.claw)

def b_necro(k, t, w, a):
    # Caller: a hunched mystic bug with long glowing antennae and orbs on its back.
    legs(k, t, w, pairs=3, reach=1.0, thick=0.075)
    shell_body(k, [(-0.1, 0.48, 0.46, 0.4, 0.55), (-0.6, 0.42, 0.42, 0.34, 0.5)])
    head(k, 0.42, 0.58, 0.3, mand=0.25, open_=0.5 if a else 0.1)
    antenna(k, 0.42, 0.58, 0.3, length=0.9, bulb=0.1)
    for i, (x, y) in enumerate([(-0.25, 0.25), (-0.25, -0.25), (-0.65, 0)]):
        sac(k, f'orb{i}', (x, y, 0.95), 0.13)

def b_crawler(k, t, w, a):
    # Skitter: a low, many-legged centipede, quick and flat.
    n = 5
    segs = [(0.2 - i * 0.32, 0.22, 0.34 - i * 0.02, 0.16, 0.26) for i in range(n)]
    shell_body(k, segs)
    for i, (x, rx, ry, rz, z) in enumerate(segs):
        for s in (-1, 1):
            dx, dz = gait(t * 1.2 + i * 1.2, 0, s, 2, 0.25, 0.08) if w else (0, 0)
            leg(k, f'l{i}{s}', (x, s * ry * 0.8, 0.22), (x + dx, s * 0.7, 0.04 + dz), thick=0.05, knee_up=0.18)
    head(k, 0.5, 0.28, 0.24, mand=0.35, open_=1.0 if a else 0.3)

def b_dog(k, t, w, a):
    # Hound: a long, four-legged pouncer with a rounded snout.
    legs(k, t, w, pairs=2, xs=[0.45, -0.75], reach=0.95, hip_y=0.35, thick=0.1, stride=0.8, lift=0.24, fan=0.25, knee_up=0.5)
    shell_body(k, [(0.25, 0.45, 0.46, 0.36, 0.62), (-0.25, 0.5, 0.44, 0.34, 0.6), (-0.75, 0.42, 0.38, 0.3, 0.58)])
    back_blades(k, x=0.2, z=0.85, length=0.8, spread=0.35, width=0.11, lift=0.3)
    head(k, 0.85, 0.66, 0.32, mand=0.4, open_=1.0 if a else 0.2)
    skin('tail', [(-1.05, 0, 0.6), (-1.35, 0, 0.68), (-1.6, 0.12 * math.sin(t), 0.62)], [0.16, 0.11, 0.05], k.limb)

def b_soldier(k, t, w, a):
    # Guard: broad armoured shoulders, a pair of heavy scythes.
    legs(k, t, w, pairs=3, reach=1.05, hip_y=0.45, thick=0.1, stride=0.35)
    shell_body(k, [(-0.05, 0.55, 0.55, 0.4, 0.55), (-0.55, 0.48, 0.5, 0.36, 0.52), (-0.92, 0.3, 0.34, 0.24, 0.48)])
    head(k, 0.5, 0.58, 0.32, mand=0.35, open_=0.9 if a else 0.15)
    scythes(k, t, a, shoulder=(0.3, 0.45, 0.68), length=1.0, thick=0.08)
    spines(k, [(-0.2, 0.25, 0.95), (-0.2, -0.25, 0.95)], size=0.2)

def b_electric(k, t, w, a):
    # Sparker: crystal spines along the back that crackle with light.
    legs(k, t, w, pairs=3, reach=1.0, thick=0.08)
    shell_body(k, [(-0.1, 0.5, 0.48, 0.36, 0.5), (-0.6, 0.45, 0.44, 0.32, 0.47)])
    head(k, 0.45, 0.54, 0.32, mand=0.3, open_=0.9 if a else 0.15)
    crys = mat('crystal', k.p['glow'], rough=0.05, transmission=0.7, emit=k.p['glow'], emit_str=3.0, coat=1)
    spines(k, [(0.0, 0.2, 0.85), (0.0, -0.2, 0.85), (-0.45, 0.22, 0.8), (-0.45, -0.22, 0.8), (-0.85, 0, 0.7)], size=0.24, m=crys, lean=-0.3)

def b_bomber(k, t, w, a):
    # Popper: carries one big glowing sac on its back. Runs at you and bursts (harmless glitter).
    legs(k, t, w, pairs=3, reach=0.95, thick=0.07, stride=0.5)
    shell_body(k, [(0.05, 0.42, 0.42, 0.3, 0.45), (-0.4, 0.4, 0.4, 0.28, 0.42)])
    head(k, 0.48, 0.48, 0.3, mand=0.3, open_=0.8 if a else 0.2)
    sac(k, 'bomb', (-0.3, 0, 0.88), 0.42)
    for i in range(4):
        ang = i / 4 * TAU + 0.78
        ellipsoid(f'vein{i}', (-0.3 + math.cos(ang) * 0.33, math.sin(ang) * 0.33, 1.0), (0.05, 0.05, 0.12), k.groove, seg=12)

def b_burrower(k, t, w, a):
    # Digger: a mole-beetle with a shovel face and broad digging claws.
    legs(k, t, w, pairs=2, xs=[-0.15, -0.55], reach=0.95, thick=0.09, stride=0.3)
    shell_body(k, [(0.0, 0.55, 0.55, 0.4, 0.5), (-0.5, 0.5, 0.5, 0.36, 0.48), (-0.9, 0.32, 0.34, 0.24, 0.44)])
    ellipsoid('shovel', (0.62, 0, 0.42), (0.36, 0.5, 0.18), k.accent, rot=(0, 0.25, 0))
    head(k, 0.42, 0.62, 0.26, mand=0, open_=0)
    for s in (-1, 1):
        o = 0.25 if a else 0.12 * math.sin(t + (s > 0) * math.pi)
        claw_arm(k, f'dig{s}', (0.3, s * 0.42, 0.45), (0.55 + o, s * 0.75, 0.3), (0.85 + o, s * 0.7, 0.18), 0.5, open_=0.5)

def b_wraith(k, t, w, a):
    # Moth: a pale fluttering moth bug with soft see-through wings. Phases in and out.
    flap = math.sin(t * 2) * 0.18 if w else 0
    wings(k, size=1.0, spread=0.75 + (0.3 if a else 0), x=-0.1, z=0.85, flap=flap)
    wings(k, size=0.7, spread=1.3 + (0.2 if a else 0), x=-0.3, z=0.8, flap=flap * 0.6)
    shell_body(k, [(0.0, 0.36, 0.34, 0.3, 0.6), (-0.42, 0.38, 0.3, 0.26, 0.58), (-0.8, 0.26, 0.2, 0.18, 0.55)], mat_=mat('fuzz', k.p['shell'], rough=0.8, sss=0.4, bump=0.3, bump_scale=60))
    head(k, 0.38, 0.62, 0.28, mand=0, eye_size=0.12)
    antenna(k, 0.38, 0.62, 0.28, length=0.6, bulb=0.06, droop=-0.05)
    legs(k, t, False, pairs=3, reach=0.7, thick=0.04, hip_z=0.45, knee_up=0.2)

def b_webber(k, t, w, a):
    # Weaver: a round spider-bug with eight legs and a glowing silk gland.
    legs(k, t, w, pairs=4, xs=[0.3, 0.1, -0.1, -0.3], reach=1.35, hip_y=0.3, thick=0.065, stride=0.4, fan=0.9, knee_up=0.55)
    ellipsoid('thorax', (0.1, 0, 0.5), (0.4, 0.38, 0.3), k.plate)
    ellipsoid('abdomen', (-0.6, 0, 0.6), (0.6, 0.55, 0.45), k.shell)
    for i in range(3):
        ellipsoid(f'stripe{i}', (-0.4 - i * 0.22, 0, 1.02 - i * 0.05), (0.06, 0.32 - i * 0.06, 0.04), k.accent, seg=16)
    sac(k, 'gland', (-1.08, 0, 0.55), 0.15)
    head(k, 0.48, 0.48, 0.26, eyes_n=4, eye_size=0.11, mand=0.3, open_=0.9 if a else 0.2)

def b_medic(k, t, w, a):
    # Mender: a pearly bug with a soft pink heart-shaped sac that heals its friends.
    legs(k, t, w, pairs=3, reach=1.0, thick=0.075)
    shell_body(k, [(-0.1, 0.5, 0.48, 0.38, 0.5), (-0.6, 0.44, 0.44, 0.32, 0.47)])
    head(k, 0.45, 0.55, 0.3, mand=0.25, open_=0.6 if a else 0.1)
    for s in (-1, 1):
        sac(k, f'heart{s}', (-0.32, s * 0.13, 0.92), 0.2)
    cone('heartTip', (-0.48, 0, 0.88), (-0.62, 0, 0.86), 0.12, k.glow, tip_r=0.03)
    antenna(k, 0.45, 0.55, 0.3, length=0.5, bulb=0.06)

def b_sludger(k, t, w, a):
    # Slurper: a glossy slug-snail with a spiral shell; leaves goo.
    slime = mat('slime', k.p['skin'], rough=0.12, coat=1, coat_rough=0.02, sss=0.6)
    sq = 1 + (math.sin(t) * 0.05 if w else 0)
    skin('foot', [(0.75, 0, 0.18), (0.2, 0, 0.24), (-0.4, 0, 0.24), (-1.0, 0, 0.14)], [(0.28, 0.2), (0.5 * sq, 0.3), (0.5, 0.28), (0.22, 0.14)], slime)
    for i in range(4):
        r = 0.55 - i * 0.12
        ellipsoid(f'whorl{i}', (-0.25 + i * 0.05, i * 0.06, 0.55 + i * 0.16), (r, r, r * 0.65), k.shell if i % 2 == 0 else k.plate)
    ellipsoid('headblob', (0.65, 0, 0.35), (0.3, 0.26, 0.22), slime)
    eyes(k, (0.65, 0, 0.35, 0.26), n=2, size=0.1)
    for s in (-1, 1):
        stalk = [(0.72, s * 0.1, 0.45), (0.85, s * 0.18, 0.7)]
        skin(f'stalk{s}', stalk, [0.04, 0.03], slime)
        ellipsoid(f'stalkeye{s}', stalk[1], (0.07,) * 3, k.eye, seg=16)
    mandibles(k, 0.6, 0.3, 0.26, size=0.25, open_=0.8 if a else 0.1)

def b_icer(k, t, w, a):
    # Frostling: a fluffy-frosted bug with blue ice crystals on its back.
    legs(k, t, w, pairs=3, reach=1.0, thick=0.08)
    shell_body(k, [(-0.1, 0.5, 0.5, 0.36, 0.5), (-0.6, 0.45, 0.45, 0.32, 0.47)])
    head(k, 0.45, 0.54, 0.32, mand=0.3, open_=0.9 if a else 0.15)
    ice = mat('ice', '#d8f4ff', rough=0.04, transmission=0.85, coat=1, emit='#9ae6ff', emit_str=0.6)
    spines(k, [(-0.05, 0.25, 0.82), (-0.05, -0.25, 0.82), (-0.35, 0, 0.88), (-0.65, 0.22, 0.78), (-0.65, -0.22, 0.78)], size=0.26, m=ice, lean=-0.2)

def b_roller(k, t, w, a):
    # Pillbug: a banded armadillo shell. The game curls it into a rolling ball.
    legs(k, t, w, pairs=4, xs=[0.35, 0.1, -0.15, -0.4], reach=0.85, hip_y=0.45, hip_z=0.25, thick=0.06, stride=0.3, knee_up=0.18)
    n = 6
    for i in range(n):
        x = 0.45 - i * 0.22
        rr = 0.62 - abs(i - 2.2) * 0.08
        ellipsoid(f'band{i}', (x, 0, 0.42), (0.17, rr, 0.42 - abs(i - 2.2) * 0.05), k.shell if i % 2 else k.plate)
        ellipsoid(f'bandrim{i}', (x - 0.1, 0, 0.42), (0.05, rr * 0.95, 0.38 - abs(i - 2.2) * 0.05), k.groove, seg=24)
    head(k, 0.72, 0.3, 0.24, mand=0.25, open_=0.8 if a else 0.1)
    antenna(k, 0.72, 0.3, 0.24, length=0.45, bulb=0.0)

def b_mimic(k, t, w, a):
    # Gobbler: a boxy bug with a big friendly underbite (it hides as a crate).
    legs(k, t, w, pairs=3, reach=1.0, thick=0.08, stride=0.5)
    ellipsoid('box', (-0.15, 0, 0.55), (0.7, 0.62, 0.42), k.shell, seg=8, sub=2)
    ellipsoid('lid', (-0.2, 0, 0.88), (0.62, 0.56, 0.12), k.plate, seg=8, sub=2)
    jaw = 0.25 if a else 0.08
    ellipsoid('jaw', (0.5, 0, 0.32 - jaw * 0.3), (0.3, 0.52, 0.16), k.accent)
    for i in range(5):
        y = -0.36 + i * 0.18
        cone(f'tooth{i}', (0.68, y, 0.42), (0.7, y, 0.56 + jaw), 0.05, k.claw, tip_r=0.015)
    eyes(k, (0.38, 0, 0.62, 0.32), n=2, size=0.13)

def b_parasite(k, t, w, a):
    # Tick: a tiny round hitchhiker with eight scrabbling legs.
    legs(k, t * 1.4, w, pairs=4, xs=[0.2, 0.05, -0.1, -0.25], reach=1.1, hip_y=0.3, hip_z=0.3, thick=0.07, stride=0.35, fan=0.9, knee_up=0.35)
    ellipsoid('body', (-0.15, 0, 0.45), (0.62, 0.58, 0.42), k.shell)
    ellipsoid('back', (-0.2, 0, 0.72), (0.42, 0.38, 0.18), k.accent)
    head(k, 0.48, 0.38, 0.24, mand=0.3, open_=1.0 if a else 0.3)

def b_mutant(k, t, w, a):
    # Crusher: one huge friendly-looking crab claw and one small one.
    legs(k, t, w, pairs=3, reach=1.05, thick=0.1, stride=0.32)
    shell_body(k, [(-0.1, 0.58, 0.58, 0.42, 0.55), (-0.62, 0.48, 0.5, 0.36, 0.5)])
    head(k, 0.5, 0.55, 0.3, mand=0.3, open_=0.8 if a else 0.15)
    o = 0.12 if a else 0
    claw_arm(k, 'big', (0.25, 0.48, 0.6), (0.6 + o * 0.5, 0.95, 0.55), (1.0 + o, 0.85, 0.45), 0.85, open_=0.7 if a else 0.3)
    claw_arm(k, 'small', (0.25, -0.45, 0.58), (0.55, -0.75, 0.5), (0.8, -0.7, 0.42), 0.45, open_=0.35)
    spines(k, [(-0.3, 0.3, 0.95), (-0.3, -0.3, 0.95), (-0.7, 0, 0.86)], size=0.18)

def b_blob(k, t, w, a):
    # Jelly: a wobbly translucent jelly bug with a glowing core. Splits when popped.
    jelly = mat('jelly', k.p['shell'], rough=0.05, coat=1, coat_rough=0.02, transmission=0.75, sss=0.3, alpha=0.92)
    sq = math.sin(t) * 0.06 if w else 0
    ellipsoid('jelly', (0, 0, 0.5), (0.85 + sq, 0.82 - sq, 0.5), jelly, seg=48)
    ellipsoid('core', (-0.1, 0, 0.45), (0.3, 0.3, 0.26), k.glow, seg=32)
    for i in range(5):
        ang = i / 5 * TAU
        ellipsoid(f'bub{i}', (math.cos(ang) * 0.45, math.sin(ang) * 0.45, 0.68), (0.07,) * 3, k.accent, seg=12)
    eyes(k, (0.35, 0, 0.55, 0.42), n=2, size=0.14)

def b_psyker(k, t, w, a):
    # Thinker: a floating big-brained bug with tiny tucked legs and glowing lobes.
    ellipsoid('thorax', (-0.25, 0, 0.6), (0.4, 0.35, 0.3), k.shell)
    brain = mat('brain', k.p['skin'], rough=0.3, coat=0.8, sss=0.6, bump=0.6, bump_scale=8)
    for s in (-1, 1):
        ellipsoid(f'lobe{s}', (0.2, s * 0.25, 0.88), (0.5, 0.3, 0.32), brain)
        # Brain folds: little curled ridges over each lobe.
        for j in range(5):
            x0 = -0.2 + j * 0.2
            pts = [(x0, s * 0.06, 1.14 - abs(x0 - 0.2) ** 2 * 0.9), (x0 + 0.07, s * 0.25, 1.2 - abs(x0 - 0.2) ** 2 * 0.9), (x0 - 0.02, s * 0.44, 1.04 - abs(x0 - 0.2) ** 2 * 0.9)]
            skin(f'fold{s}{j}', pts, [0.045, 0.055, 0.035], mat('brainfold', mixhex(k.p['skin'], k.p['groove'], 0.15), rough=0.3, coat=0.8, sss=0.6), sub=2)
    ellipsoid('fissure', (0.2, 0, 1.05), (0.48, 0.035, 0.12), k.groove, seg=24)
    ellipsoid('glowlobe', (0.62, 0, 0.95), (0.1, 0.16, 0.08), k.glow, seg=24)
    eyes(k, (0.55, 0, 0.65, 0.3), n=2, size=0.13)
    legs(k, t, False, pairs=3, reach=0.6, hip_z=0.5, thick=0.045, knee_up=0.1)

def b_egg(k, t, w, a):
    ellipsoid('egg', (0, 0, 0.6), (0.85, 0.75, 0.6), mat('eggshell', k.p['shell'], rough=0.3, coat=0.6, sss=0.5))
    for i in range(6):
        ang = i / 6 * TAU
        ellipsoid(f'spot{i}', (math.cos(ang) * 0.4, math.sin(ang) * 0.36, 1.0), (0.12, 0.1, 0.05), k.glow, seg=16)

# --- bosses -----------------------------------------------------------------------------
def b_boss(k, t, w, a):
    # THE BROOD QUEEN: a regal hive queen with a crown of plates and two big scythes.
    legs(k, t, w, pairs=3, xs=[0.15, -0.25, -0.65], reach=1.25, hip_y=0.5, thick=0.1, stride=0.3, lift=0.1)
    shell_body(k, [(0.0, 0.55, 0.58, 0.42, 0.6), (-0.5, 0.55, 0.62, 0.45, 0.58), (-0.95, 0.42, 0.5, 0.36, 0.52), (-1.25, 0.25, 0.3, 0.2, 0.45)])
    head(k, 0.55, 0.66, 0.38, mand=0.45, open_=1.0 if a else 0.2)
    for i in range(5):
        ang = -0.8 + i * 0.4
        cone(f'crown{i}', (0.42, math.sin(ang) * 0.3, 0.92), (0.2, math.sin(ang) * 0.55, 1.35), 0.1, k.accent, tip_r=0.04)
        ellipsoid(f'gem{i}', (0.2, math.sin(ang) * 0.55, 1.35), (0.06,) * 3, k.glow, seg=16)
    scythes(k, t, a, shoulder=(0.35, 0.5, 0.75), length=1.15, thick=0.09)
    back_blades(k, x=0.05, z=0.95, length=1.2, spread=0.75, width=0.16, lift=0.4)
    spines(k, [(-0.95, 0.3, 0.8), (-0.95, -0.3, 0.8), (-1.25, 0, 0.6)], size=0.16)
    for i, (x, y) in enumerate([(-0.5, 0.3), (-0.5, -0.3), (-0.95, 0.0)]):
        sac(k, f'egg{i}', (x, y, 1.0), 0.14)

def b_juggernaut(k, t, w, a):
    # THE GOLIATH: a rhino beetle colossus with a huge rounded horn. Weak spot on its back.
    legs(k, t, w, pairs=3, reach=1.05, hip_y=0.6, thick=0.15, stride=0.22, lift=0.07, knee_up=0.35)
    ellipsoid('shellL', (-0.25, 0.3, 0.6), (0.85, 0.45, 0.48), k.shell, rot=(0.12, 0, 0))
    ellipsoid('shellR', (-0.25, -0.3, 0.6), (0.85, 0.45, 0.48), k.shell, rot=(-0.12, 0, 0))
    ellipsoid('seam', (-0.25, 0, 0.92), (0.82, 0.05, 0.12), k.groove, seg=24)
    ellipsoid('pronotum', (0.45, 0, 0.62), (0.45, 0.62, 0.42), k.plate)
    for i in range(4):
        for s in (-1, 1):
            x = 0.2 - i * 0.3
            cone(f'jstud{i}{s}', (x, s * 0.62, 0.78), (x - 0.12, s * 0.85, 0.98), 0.09, k.bone, tip_r=0.03)
    for i in range(3):
        ellipsoid(f'jmark{i}{s}', (-0.1 - i * 0.3, 0.3, 1.0), (0.1, 0.06, 0.04), k.mark, seg=16)
        ellipsoid(f'jmarkb{i}', (-0.1 - i * 0.3, -0.3, 1.0), (0.1, 0.06, 0.04), k.mark, seg=16)
    head(k, 0.85, 0.45, 0.3, mand=0.35, open_=0.8 if a else 0.15)
    lift = 0.2 if a else 0
    skin('horn', [(0.7, 0, 0.85), (1.05, 0, 1.0 + lift), (1.3, 0, 1.25 + lift), (1.28, 0, 1.45 + lift)], [0.18, 0.14, 0.09, 0.03], k.claw)

def b_brood(k, t, w, a):
    # THE NEST MOTHER: a huge spider-bug carrying glowing egg sacs.
    legs(k, t, w, pairs=4, xs=[0.4, 0.15, -0.1, -0.35], reach=1.4, hip_y=0.35, thick=0.08, stride=0.35, fan=0.9, knee_up=0.6)
    ellipsoid('thorax', (0.15, 0, 0.55), (0.45, 0.42, 0.34), k.plate)
    ellipsoid('abdomen', (-0.6, 0, 0.65), (0.65, 0.6, 0.48), k.shell)
    for i, (x, y) in enumerate([(-0.4, 0.25), (-0.4, -0.25), (-0.75, 0.3), (-0.75, -0.3), (-0.6, 0), (-1.0, 0)]):
        sac(k, f'egg{i}', (x, y, 1.08 if i != 4 else 1.15), 0.14)
    head(k, 0.58, 0.52, 0.28, eyes_n=4, eye_size=0.12, mand=0.35, open_=1.0 if a else 0.2)
    for i in range(8):
        ang = i / 8 * TAU
        cone(f'bspine{i}', (-0.6 + math.cos(ang) * 0.55, math.sin(ang) * 0.5, 0.75), (-0.6 + math.cos(ang) * 0.75, math.sin(ang) * 0.7, 0.95), 0.07, k.bone, tip_r=0.02)

def b_reaper(k, t, w, a):
    # THE HARVESTER: a tall mantis with huge folded scythes.
    legs(k, t, w, pairs=2, xs=[-0.2, -0.6], reach=1.0, thick=0.07, stride=0.35, knee_up=0.6)
    shell_body(k, [(0.15, 0.35, 0.32, 0.28, 0.75), (-0.35, 0.5, 0.4, 0.32, 0.6), (-0.85, 0.45, 0.36, 0.28, 0.55)])
    skin('neck', [(0.3, 0, 0.8), (0.55, 0, 0.95)], [0.14, 0.12], k.skin)
    head(k, 0.7, 1.0, 0.3, mand=0.3, open_=1.0 if a else 0.2)
    scythes(k, t, a, shoulder=(0.35, 0.3, 0.85), length=1.45, thick=0.09, curl=1.4)
    wings(k, size=0.8, spread=0.2, x=-0.35, z=0.95)

def b_sludge(k, t, w, a):
    # THE GOO KING: a giant snail-slug with a crowned spiral shell.
    b_sludger(k, t, w, a)
    for i in range(5):
        ang = i / 5 * TAU
        cone(f'crown{i}', (-0.1 + math.cos(ang) * 0.18, 0.18 + math.sin(ang) * 0.18, 1.1), (-0.1 + math.cos(ang) * 0.28, 0.18 + math.sin(ang) * 0.28, 1.35), 0.07, mat('gold', '#ffd060', rough=0.25, coat=1, emit='#ffb020', emit_str=0.3), tip_r=0.03)
    for i in range(3):
        sac(k, f'bub{i}', (-0.7 + i * 0.3, (i - 1) * 0.35, 0.35), 0.1)

def b_titan(k, t, w, a):
    # THE GLACIER CRAB: a colossal crab with icy shell and two big claws.
    legs(k, t, w, pairs=3, xs=[0.0, -0.35, -0.7], reach=1.2, hip_y=0.6, thick=0.12, stride=0.25, lift=0.08, knee_up=0.4)
    ellipsoid('carapace', (-0.25, 0, 0.6), (0.85, 0.95, 0.45), k.shell)
    ellipsoid('cap', (-0.25, 0, 0.82), (0.6, 0.7, 0.25), k.plate)
    ice = mat('ice', '#d8f4ff', rough=0.04, transmission=0.85, coat=1, emit='#9ae6ff', emit_str=0.6)
    spines(k, [(-0.1, 0.4, 0.92), (-0.1, -0.4, 0.92), (-0.45, 0, 1.02), (-0.6, 0.45, 0.85), (-0.6, -0.45, 0.85)], size=0.28, m=ice, lean=-0.2)
    head(k, 0.55, 0.55, 0.3, mand=0.3, open_=0.8 if a else 0.15)
    o = 0.12 if a else 0
    for s in (-1, 1):
        claw_arm(k, f'claw{s}', (0.3, s * 0.65, 0.6), (0.75 + o * 0.5, s * 1.0, 0.5), (1.1 + o, s * 0.75, 0.4), 0.7, open_=0.7 if a else 0.3)

def b_zero(k, t, w, a):
    # THE HIVE HEART: the first of the swarm, a pulsing brain-bug with tendrils.
    for i in range(7):
        base = math.pi * 0.6 + i / 6 * math.pi * 0.8
        pts, rad = [], []
        for j in range(5):
            u = j / 4
            ang = base + math.sin(t + i * 1.7 + u * 3) * 0.25 * u
            d = 0.5 + u * 0.85
            pts.append((math.cos(ang) * d, math.sin(ang) * d, 0.35 - u * 0.25))
            rad.append(0.13 * (1 - u * 0.75))
        skin(f'tendril{i}', pts, rad, k.skin)
        ellipsoid(f'tip{i}', pts[-1], (0.05,) * 3, k.glow, seg=12)
    legs(k, t, w, pairs=2, xs=[0.2, -0.2], reach=1.05, hip_y=0.45, thick=0.09)
    ellipsoid('body', (-0.1, 0, 0.55), (0.62, 0.62, 0.42), k.shell)
    brain = mat('brain', k.p['skin'], rough=0.3, coat=0.8, sss=0.6, bump=0.6, bump_scale=8)
    for s in (-1, 1):
        ellipsoid(f'lobe{s}', (-0.05, s * 0.24, 0.92), (0.5, 0.3, 0.32), brain)
    sac(k, 'heart', (-0.05, 0, 1.18), 0.16)
    head(k, 0.58, 0.58, 0.3, eyes_n=3, eye_size=0.12, mand=0.35, open_=1.0 if a else 0.2)

KINDS = {
    # kind: (builder, palette, span in R units, cell px)
    'walker': (b_walker, 'violet', 3.0, 128),
    'runner': (b_runner, 'amber', 3.2, 112),
    'tank': (b_tank, 'slate', 2.8, 224),
    'bloater': (b_bloater, 'lime', 2.7, 160),
    'spitter': (b_spitter, 'plum', 3.0, 128),
    'screamer': (b_screamer, 'rose', 3.0, 128),
    'shield': (b_shield, 'sand', 2.9, 176),
    'leaper': (b_leaper, 'coral', 3.5, 136),
    'necro': (b_necro, 'ink', 3.0, 144),
    'crawler': (b_crawler, 'ember', 3.2, 104),
    'dog': (b_dog, 'amber', 3.8, 136),
    'soldier': (b_soldier, 'moss', 3.4, 176),
    'electric': (b_electric, 'sky', 3.0, 136),
    'bomber': (b_bomber, 'ember', 2.9, 120),
    'burrower': (b_burrower, 'sand', 3.4, 160),
    'wraith': (b_wraith, 'lilac', 3.2, 136),
    'webber': (b_webber, 'dusk', 3.4, 144),
    'medic': (b_medic, 'pearl', 3.0, 144),
    'sludger': (b_sludger, 'moss', 2.9, 160),
    'icer': (b_icer, 'frost', 3.0, 144),
    'roller': (b_roller, 'frost', 2.8, 144),
    'mimic': (b_mimic, 'sand', 2.9, 128),
    'parasite': (b_parasite, 'coral', 3.0, 80),
    'mutant': (b_mutant, 'coral', 4.1, 208),
    'blob': (b_blob, 'jelly', 2.6, 160),
    'psyker': (b_psyker, 'lilac', 2.6, 128),
    'boss': (b_boss, 'queen', 3.8, 448),
    'juggernaut': (b_juggernaut, 'slate', 3.0, 400),
    'brood': (b_brood, 'amber', 3.4, 400),
    'reaper': (b_reaper, 'plum', 4.4, 448),
    'sludge': (b_sludge, 'lime', 2.9, 384),
    'titan': (b_titan, 'frost', 4.0, 480),
    'zero': (b_zero, 'queen', 3.4, 400),
}
WALK = 6

def build(kind, t=0.0, walking=False, attack=False):
    fn, pal, span, cell = KINDS[kind]
    k = Kit(PAL[pal])
    fn(k, t, walking, attack)
    return k

# ------------------------------------------------------------------ render setup
def cycles(rx, ry, samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = rx, ry
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 8
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = os.environ.get('LOOK', 'AgX - Punchy')
    except Exception:
        pass
    return sc

def light(kind_, name, loc, target, energy, size=1.0, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, kind_)
    ld.energy = energy
    ld.color = color
    if kind_ == 'AREA':
        ld.size = size
    elif kind_ == 'SUN':
        ld.angle = size
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

def shadow_floor(size=20):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    fl = bpy.context.active_object
    fl.is_shadow_catcher = True
    return fl

def sprite_scene(span, cell, samples):
    cycles(cell, cell, samples)
    world((0.5, 0.52, 0.6), 0.3)
    # Moonlight from the upper left plus a soft top light: same direction as the player art.
    # Sprites rotate with the enemy, so the sun sits almost overhead: the baked shadow stays a
    # soft pool under the body instead of pointing a different way for every facing.
    light('SUN', 'sun', (-0.5, -0.4, 6), (0, 0, 0), 3.0, size=math.radians(30), color=(1.0, 0.96, 0.9))
    light('AREA', 'side', (-2.5, -2.0, 2.5), (0, 0, 0.4), 70, size=2.5, color=(0.9, 0.92, 1.0))
    light('AREA', 'top', (0.5, 0.6, 5), (0, 0, 0), 45, size=4, color=(0.85, 0.9, 1.0))
    # A warm kicker from behind-right so rounded shells get a rim on dark floors.
    light('AREA', 'rim', (-3, 3, 1.6), (0, 0, 0.5), 60, size=2, color=(1.0, 0.8, 0.6))
    shadow_floor()
    camera((0, 0, 10), (0, 0, 0), ortho=span)

def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

# ------------------------------------------------------------------ modes
def sprites():
    kinds = EXTRA or list(KINDS)
    samples = int(os.environ.get('SMP', 40))
    for kind in kinds:
        fn, pal, span, cell = KINDS[kind]
        cell = int(os.environ.get('CELL', cell))
        jobs = [(f'walk{i}', i / WALK * TAU, True, False) for i in range(WALK)] + [('attack', 0.0, False, True)]
        only = os.environ.get('ONLY')
        for name, t, walking, attack in jobs:
            if only and name not in only.split(','):
                continue
            reset()
            build(kind, t, walking, attack)
            sprite_scene(span, cell, samples)
            render(os.path.join(OUT, kind, f'{name}.png'))

LINEUPS = {
    'drones': ['walker', 'runner', 'crawler', 'dog', 'leaper', 'parasite', 'bomber'],
    'specials': ['spitter', 'screamer', 'necro', 'electric', 'webber', 'medic', 'wraith', 'psyker'],
    'heavies': ['tank', 'shield', 'soldier', 'mutant', 'burrower', 'sludger', 'icer', 'roller', 'blob', 'mimic'],
    'bosses': ['boss', 'juggernaut', 'brood', 'reaper', 'sludge', 'titan', 'zero'],
}
RADIUS = {'walker': 15, 'runner': 12, 'tank': 27, 'bloater': 20, 'spitter': 14, 'screamer': 14, 'shield': 22, 'leaper': 13,
          'necro': 16, 'crawler': 11, 'dog': 12, 'soldier': 18, 'electric': 15, 'bomber': 14, 'burrower': 16, 'wraith': 14,
          'webber': 14, 'medic': 16, 'sludger': 18, 'icer': 16, 'roller': 17, 'mimic': 15, 'parasite': 9, 'mutant': 19,
          'blob': 20, 'psyker': 15, 'boss': 48, 'juggernaut': 56, 'brood': 54, 'reaper': 46, 'sludge': 52, 'titan': 58, 'zero': 54}

def place_creature(kind, loc, rot, scale, prefix):
    """Builds a creature and moves all its new objects under an empty at loc."""
    before = set(bpy.data.objects)
    build(kind, 0.8, True, False)
    MATS.clear()
    new = [o for o in bpy.data.objects if o not in before]
    root = link(bpy.data.objects.new(prefix, None))
    for o in new:
        o.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, rot)
    root.scale = (scale,) * 3
    return root

def studio(rx, ry, samples, floor_col=(0.025, 0.027, 0.032)):
    sc = cycles(rx, ry, samples)
    sc.render.film_transparent = False
    world((0.03, 0.035, 0.05), 1.0)
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    fl = bpy.context.active_object
    fm = mat('floor', floor_col, rough=0.6, bump=0.15, bump_scale=3)
    assign(fl, fm)
    return sc

def showcase():
    name = EXTRA[0] if EXTRA else 'drones'
    kinds = LINEUPS[name]
    reset()
    sc = studio(int(os.environ.get('RX', 1920)), int(os.environ.get('RY', 1080)), int(os.environ.get('SMP', 128)))
    boss = name == 'bosses'
    x = 0.0
    gap = 0.4 if boss else 0.35
    positions = []
    for i, kd in enumerate(kinds):
        s = RADIUS[kd] / (50 if boss else 15)
        x += s * (1.3 if i else 0)
        positions.append((kd, x, s))
        x += s * 1.3 + gap
    width = x
    mid = (positions[0][1] + positions[-1][1]) / 2
    for i, (kd, px, s) in enumerate(positions):
        y = (0.7 if i % 2 else -0.3) * (2.0 if boss else 1.0)
        place_creature(kd, (px - mid, y, 0), math.radians(-90 + (px - mid) / width * 50 + (i % 2) * 10), s, f'c{i}')
    # Frame the whole row: 50mm lens, ~33 degrees above the floor.
    dist = width * 1.45 + 1.0
    el = math.radians(30)
    cam = Vector((0, -math.cos(el) * dist, math.sin(el) * dist))
    tz = 0.45 * (2.2 if boss else 1)
    camera(tuple(cam), (0, 0.3, tz), lens=float(os.environ.get('LENS', 50)))
    e = dist ** 2
    light('AREA', 'key', (dist * 0.45, -dist * 0.55, dist * 0.6), (0, 0, tz), 16 * e, size=dist * 0.35, color=(1.0, 0.95, 0.88))
    light('AREA', 'fill', (-dist * 0.6, -dist * 0.35, dist * 0.3), (0, 0, tz), 5 * e, size=dist * 0.5, color=(0.7, 0.82, 1.0))
    light('AREA', 'rim', (0, dist * 0.5, dist * 0.35), (0, 0, tz), 18 * e, size=dist * 0.4, color=(1.0, 0.75, 0.55))
    render(os.path.join(OUT, f'lineup_{name}.png'))

def turn():
    kd = EXTRA[0]
    ang = math.radians(float(EXTRA[1])) if len(EXTRA) > 1 else math.radians(-35)
    reset()
    studio(int(os.environ.get('RX', 1600)), int(os.environ.get('RY', 1200)), int(os.environ.get('SMP', 160)))
    build(kd, 0.8, True, os.environ.get('ATTACK') == '1')
    d = float(os.environ.get('DIST', 5.0))
    light('AREA', 'key', (2.5, -3.0, 4.0), (0, 0, 0.5), 700, size=2.5, color=(1.0, 0.95, 0.88))
    light('AREA', 'fill', (-3.0, -2.0, 2.0), (0, 0, 0.5), 220, size=3, color=(0.7, 0.82, 1.0))
    light('AREA', 'rim', (-1.0, 3.5, 2.5), (0, 0, 0.6), 600, size=1.5, color=(1.0, 0.75, 0.55))
    camera((math.cos(ang) * d, math.sin(ang) * d, d * 0.62), (0.05, 0, 0.5), lens=60)
    render(os.path.join(OUT, f'turn_{kd}.png'))

def meta():
    print(json.dumps({k: {'span': v[2], 'cell': v[3], 'frames': WALK + 1} for k, v in KINDS.items()}))

{'sprites': sprites, 'showcase': showcase, 'turn': turn, 'meta': meta}[MODE]()
