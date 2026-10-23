"""Cut Gemini sprite sheets (white background, R x C grid) into a packed atlas.
usage: python -I tools/sprites.py tools/sprites.json
Spec: {"atlas":"assets/sprites/<name>", "cell":256, "sheets":[{"file":..., "grid":[R,C],
       "items":[[name, height_m, facing, kind], ...]}]}   (items in reading order, null = skip)
Writes <atlas>.webp + <atlas>.json  {w,h, items:{name:{u,v,w,h,px,py,hm,face,kind}}}"""
import sys, json, os
import numpy as np
from PIL import Image
from scipy import ndimage

spec = json.load(open(sys.argv[1], encoding='utf-8'))
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CELL = spec.get('cell', 256)
PAD = 4


def cut(path, R, C):
    im = np.asarray(Image.open(os.path.join(root, path)).convert('RGB')).astype(np.float32)
    H, W, _ = im.shape
    mn = im.min(axis=2); mx = im.max(axis=2)
    whiteish = (mn > 228) & (mx - mn < 22)
    lab, n = ndimage.label(whiteish)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    fg = ~bg
    fg = ndimage.binary_opening(fg, iterations=1)
    # soft alpha: distance from white for pixels near the background
    soft = np.clip((255 - mn) / 45.0, 0, 1)
    near_bg = ndimage.binary_dilation(bg, iterations=2)
    alpha = np.where(fg, np.where(near_bg, np.maximum(soft, 0.0), 1.0), 0.0)
    # un-premultiply the white
    a3 = np.maximum(alpha[..., None], 1e-3)
    col = np.clip((im - (1 - a3) * 255) / a3, 0, 255)
    col = np.where(alpha[..., None] > 0.02, col, im)
    rgba = np.dstack([col, alpha * 255]).astype(np.uint8)
    # group components by grid cell
    lab2, n2 = ndimage.label(ndimage.binary_dilation(fg, iterations=3))
    objs = ndimage.find_objects(lab2)
    cells = {}
    for i, sl in enumerate(objs):
        if sl is None:
            continue
        ys, xs = sl
        area = (lab2[sl] == i + 1).sum()
        if area < 300:
            continue
        cy = (ys.start + ys.stop) / 2; cx = (xs.start + xs.stop) / 2
        key = (min(R - 1, int(cy / (H / R))), min(C - 1, int(cx / (W / C))))
        b = cells.get(key)
        cells[key] = (min(b[0], ys.start), min(b[1], xs.start), max(b[2], ys.stop), max(b[3], xs.stop)) if b else (ys.start, xs.start, ys.stop, xs.stop)
    out = []
    for r in range(R):
        for c in range(C):
            b = cells.get((r, c))
            if not b:
                out.append(None); continue
            y0, x0, y1, x1 = b
            out.append(Image.fromarray(rgba[y0:y1, x0:x1]))
    return out


def cut_boxes(path, boxes):
    """explicit full-res boxes [x0,y0,x1,y1]: same keying, crop to the box then trim to content"""
    full = cut_rgba(path)
    out = []
    for b in boxes:
        c = full.crop(tuple(b))
        bb = c.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()
        out.append(c.crop(bb) if bb else None)
    return out


def cut_rgba(path):
    im = np.asarray(Image.open(os.path.join(root, path)).convert('RGB')).astype(np.float32)
    mn = im.min(axis=2); mx = im.max(axis=2)
    whiteish = (mn > 228) & (mx - mn < 22)
    lab, n = ndimage.label(whiteish)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    # big enclosed white holes inside foliage are background too
    sizes = ndimage.sum(np.ones_like(mn), lab, index=np.arange(n + 1))
    bg |= (lab > 0) & (sizes[lab] > 250)
    soft = np.clip((255 - mn) / 45.0, 0, 1)
    near_bg = ndimage.binary_dilation(bg, iterations=2)
    alpha = np.where(~bg, np.where(near_bg, soft, 1.0), 0.0)
    a3 = np.maximum(alpha[..., None], 1e-3)
    col = np.clip((im - (1 - a3) * 255) / a3, 0, 255)
    col = np.where(alpha[..., None] > 0.02, col, im)
    return Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8))


sprites = []
for sh in spec['sheets']:
    if 'boxes' in sh:
        imgs = cut_boxes(sh['file'], [it[1] for it in sh['boxes']])
        items = [[it[0]] + it[2:] for it in sh['boxes']]
    else:
        R, C = sh['grid']
        imgs = cut(sh['file'], R, C)
        items = sh['items']
    for it, img in zip(items, imgs):
        if it is None or img is None:
            continue
        name, hm, face, kind = it
        if hm < 0:      # negative = length in metres -> height from the crop's aspect
            hm = round(-hm * img.size[1] / img.size[0], 3)
        scale = sh.get('cell', CELL) / img.size[1]
        img = img.resize((max(1, round(img.size[0] * scale)), sh.get('cell', CELL)), Image.LANCZOS)
        sprites.append((name, hm, face, kind, img))

# shelf pack
AW = spec.get('width', 2048)
x = y = rowh = 0
pos = []
for s in sprites:
    w, h = s[4].size
    if x + w + PAD > AW:
        x = 0; y += rowh + PAD; rowh = 0
    pos.append((x, y)); x += w + PAD; rowh = max(rowh, h)
AH = y + rowh
AH2 = 1
while AH2 < AH:
    AH2 *= 2
atlas = Image.new('RGBA', (AW, AH2), (0, 0, 0, 0))
meta = {'w': AW, 'h': AH2, 'items': {}}
for s, (px, py) in zip(sprites, pos):
    name, hm, face, kind, img = s
    atlas.paste(img, (px, py))
    w, h = img.size
    meta['items'][name] = {'u': px / AW, 'v': py / AH2, 'w': w / AW, 'h': h / AH2, 'px': w, 'py': h,
                           'hm': hm, 'face': face, 'kind': kind}
# bleed opaque colours into the transparent texels so mipmaps don't fade figures toward white
arr = np.asarray(atlas).copy()
solid = arr[..., 3] > 128
_, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
arr[..., :3] = arr[iy, ix, :3]
atlas = Image.fromarray(arr)
out = os.path.join(root, spec['atlas'])
os.makedirs(os.path.dirname(out), exist_ok=True)
atlas.save(out + '.webp', quality=88, method=6, exact=True)
json.dump(meta, open(out + '.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
# preview on silk colour
prev = Image.new('RGBA', atlas.size, (226, 210, 170, 255))
prev.alpha_composite(atlas)
prev.convert('RGB').resize((AW // 2, AH2 // 2)).save(os.path.join(root, 'raw', os.path.basename(out) + '_preview.jpg'))
print(len(sprites), 'sprites', AW, 'x', AH2)
