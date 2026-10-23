"""Crop full-res reference patches (strip coords at H=1024) for Gemini style refs.
usage: python -I tools/refcrop.py raw/qing_full.jpg out.jpg x0 y0 x1 y1 [x0 y0 x1 y1 ...]
Multiple boxes are stacked vertically."""
import sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
im = Image.open(sys.argv[1])
k = im.size[1] / 1024
vals = list(map(float, sys.argv[3:]))
crops = []
for i in range(0, len(vals), 4):
    x0, y0, x1, y1 = [round(v * k) for v in vals[i:i + 4]]
    crops.append(im.crop((x0, y0, x1, y1)))
W = max(c.size[0] for c in crops)
H = sum(c.size[1] for c in crops)
out = Image.new('RGB', (W, H), (235, 225, 200))
y = 0
for c in crops:
    out.paste(c, (0, y)); y += c.size[1]
out.save(sys.argv[2], quality=90)
print(out.size)
