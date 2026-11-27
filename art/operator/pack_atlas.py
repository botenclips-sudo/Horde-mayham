import sys, json
from PIL import Image
D, out = sys.argv[1], sys.argv[2]
C = 192
names = [f'walk{i}_under' for i in range(8)] + ['idle_under', 'idle_over', 'down']
cells = []
for n in names:
    cells.append((n, f'{D}/{n}.png', False))
    cells.append((n + '_mask', f'{D}/{n}_mask.png', True))
cols = 6
rows = (len(cells) + cols - 1) // cols
atlas = Image.new('RGBA', (cols * C, rows * C), (0, 0, 0, 0))
layout = {}
for i, (n, path, mask) in enumerate(cells):
    im = Image.open(path).convert('RGBA')
    if im.size != (C, C):
        im = im.resize((C, C), Image.LANCZOS)
    if mask:
        r, g, b, a = im.split()
        lum = Image.merge('RGB', (r, g, b)).convert('L')
        alpha = Image.eval(Image.merge('LA', (lum, a)).getchannel(0), lambda v: v)
        from PIL import ImageChops
        alpha = ImageChops.multiply(lum, a)
        white = Image.new('L', (C, C), 255)
        im = Image.merge('RGBA', (white, white, white, alpha))
    x, y = (i % cols) * C, (i // cols) * C
    atlas.paste(im, (x, y))
    layout[n] = [x, y]
atlas.save(out, optimize=True)
print(json.dumps(layout))
