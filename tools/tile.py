"""Slice the full Qing Court scroll into web tiles + overview strips.
usage: python -I tools/tile.py raw/qing_full.jpg
Writes assets/scroll/t_<i>.webp (height H, width TW) and scratch previews."""
import sys, os, json
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

src = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'assets', 'scroll')
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert('RGB')
W, H0 = im.size
H = 1024                      # tile height on the web
scale = H / H0
W2 = round(W * scale)
im2 = im.resize((W2, H), Image.LANCZOS)
TW = 2048
n = (W2 + TW - 1) // TW
for i in range(n):
    x0 = i * TW
    t = im2.crop((x0, 0, min(W2, x0 + TW), H))
    t.save(os.path.join(out, f't_{i:02d}.webp'), quality=82, method=6)
# low-res whole strip for instant first paint + minimap
lo = im2.resize((W2 // 8, H // 8), Image.LANCZOS)
lo.save(os.path.join(out, 'overview.webp'), quality=80)
json.dump({'w': W2, 'h': H, 'tw': TW, 'n': n}, open(os.path.join(out, 'meta.json'), 'w'))
# previews for inspection: 12 segments
prev = os.path.join(root, 'raw', 'prev')
os.makedirs(prev, exist_ok=True)
seg = W2 // 12
for k in range(12):
    p = im2.crop((k * seg, 0, (k + 1) * seg, H)).resize((seg // 2, H // 2))
    p.save(os.path.join(prev, f'seg_{k:02d}.jpg'), quality=85)
print(W2, H, n)
