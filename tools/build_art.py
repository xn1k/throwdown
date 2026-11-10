"""Turn the raw fal generations in assets/generated/ into game-ready files in assets/art/.

    python tools/build_art.py

Free and local. Needs Pillow + numpy and the fal-game-assets skill's sprite_tools.py.
"""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
GEN, ART = ROOT / 'assets' / 'generated', ROOT / 'assets' / 'art'
TOOLS = Path.home() / '.claude' / 'skills' / 'fal-game-assets' / 'scripts' / 'sprite_tools.py'
TMP = Path(tempfile.mkdtemp())


def tool(*args):
    subprocess.run([sys.executable, str(TOOLS), *map(str, args)], check=True, stdout=subprocess.DEVNULL)


def frames_of(folder):
    return [Image.open(f).convert('RGBA') for f in sorted((folder / 'frames').glob('*.png'))]


def trim(im):
    return im.crop(im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox())


manifest = {}
ART.mkdir(parents=True, exist_ok=True)

# ---- pieces: 4-frame strips (normal, squash, stretch, blink) -> static png + square-celled sheet
for hand in ('rock', 'paper', 'scissors'):
    out = TMP / hand
    # global keying: the scissors' handle loops enclose background
    tool('pipeline', GEN / f'anim_{hand}' / 'anim.png', out, '--expect', 4, '--mode', 'global')
    frames = [trim(f) for f in frames_of(out)]
    assert len(frames) == 4, (hand, len(frames))
    side = max(max(f.width for f in frames), max(f.height for f in frames))
    sheet = Image.new('RGBA', (side * 4, side))
    for k, f in enumerate(frames):            # bottom-centred so the squash/stretch stays on the ground
        sheet.paste(f, (k * side + (side - f.width) // 2, side - f.height), f)
    sheet.save(ART / f'{hand}_sheet.png', optimize=True)
    sheet.crop((0, 0, side, side)).save(ART / f'{hand}.png', optimize=True)
    manifest[hand] = f'assets/art/{hand}.png'
    manifest[hand + '_sheet'] = f'assets/art/{hand}_sheet.png'
    print(f'{hand}: cell {side}px, frames', [f.size for f in frames])

# ---- props: 2x2 sheet (tree, arrow, crown, sparkle)
out = TMP / 'props'
tool('pipeline', GEN / 'props' / 'props.png', out, '--grid', '2x2')
for name, f in zip(('block', 'arrow', 'crown', 'sparkle'), frames_of(out)):
    f = trim(f)
    f.save(ART / f'{name}.png', optimize=True)
    manifest[name] = f'assets/art/{name}.png'
    print(f'{name}: {f.size}')

# ---- floor tiles: crop the dark frame the model drew, snap to its pixel grid
raw = Image.open(GEN / 'tile' / 'tile.png').convert('RGB')
m = round(raw.width * 0.022)
raw.crop((m, m, raw.width - m, raw.height - m)).save(TMP / 'tile_crop.png')
tool('pixelate', TMP / 'tile_crop.png', TMP / 'tile_px.png', '--px', 'auto')
tile = Image.open(TMP / 'tile_px.png').convert('RGB')
tile.save(ART / 'tile.png', optimize=True)
ImageEnhance.Brightness(ImageEnhance.Color(tile).enhance(0.6)).enhance(0.78).save(ART / 'tile_fixed.png', optimize=True)
g = tile.convert('L').point(lambda v: v * 0.55)                     # mossy tile for the trees
Image.merge('RGB', (g.point(lambda v: v * 0.62), g, g.point(lambda v: v * 0.5))).save(ART / 'block_tile.png', optimize=True)
for k in ('tile', 'tile_fixed', 'block_tile'):
    manifest[k] = f'assets/art/{k}.png'
print('tile:', tile.size)

# ---- background and icon
bg = Image.open(GEN / 'bg' / 'bg.png').convert('RGB')
bg.resize((768, round(768 * bg.height / bg.width)), Image.NEAREST).save(ART / 'bg.jpg', quality=85)
manifest['bg'] = 'assets/art/bg.jpg'
icon = Image.open(GEN / 'icon' / 'icon.png').convert('RGB')
for size in (512, 192):
    icon.resize((size, size), Image.LANCZOS).save(ART / f'icon-{size}.png', optimize=True)

(ART / 'manifest.json').write_text(json.dumps(manifest, indent=1))
shutil.rmtree(TMP, ignore_errors=True)
print('wrote', len(manifest), 'entries')
