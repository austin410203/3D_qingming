"""Grid overlay previews of the strip for hand annotation.
usage: python -I tools/gridimg.py x0 x1 [scale] [out]  (strip coords, H=1024)"""
import sys, os
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
x0, x1 = int(sys.argv[1]), int(sys.argv[2])
sc = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
out = sys.argv[4] if len(sys.argv) > 4 else os.path.join(root, 'raw', 'grid', f'g_{x0}.jpg')
os.makedirs(os.path.dirname(out), exist_ok=True)
TW = 2048
tiles = []
for i in range(x0 // TW, (x1 - 1) // TW + 1):
    tiles.append((i * TW, Image.open(os.path.join(root, 'assets', 'scroll', f't_{i:02d}.webp')).convert('RGB')))
W = x1 - x0
im = Image.new('RGB', (W, 1024))
for tx, t in tiles:
    im.paste(t, (tx - x0, 0))
im = im.resize((round(W * sc), round(1024 * sc)), Image.LANCZOS)
d = ImageDraw.Draw(im)
for gx in range((x0 // 100) * 100, x1 + 1, 100):
    if gx < x0:
        continue
    px = (gx - x0) * sc
    major = gx % 500 == 0
    d.line([(px, 0), (px, im.size[1])], fill=(255, 0, 0) if major else (255, 120, 120), width=2 if major else 1)
    if gx % 200 == 0 or major:
        d.text((px + 2, 2), str(gx), fill=(200, 0, 0))
for gy in range(0, 1025, 100):
    py = gy * sc
    d.line([(0, py), (im.size[0], py)], fill=(0, 0, 255) if gy % 500 == 0 else (120, 120, 255), width=1)
    d.text((2, py + 2), str(gy), fill=(0, 0, 200))
im.save(out, quality=85)
print(out, im.size)
