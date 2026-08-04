from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "public" / "icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)

BG_TOP = (16, 17, 19)
BG = (5, 6, 7)
GOLD = (255, 176, 0)
GOLD_HI = (255, 211, 106)
MINT = (60, 207, 145)
MINT_HI = (159, 255, 199)


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size
            color = tuple(lerp(BG_TOP[i], BG[i], min(1, t)) for i in range(3)) + (255,)
            px[x, y] = color
    return img


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_icon(path: Path, size: int) -> None:
    scale = size / 512
    ss = 4
    canvas = gradient(size * ss)
    mask = rounded_mask(size * ss, round(116 * scale * ss))
    canvas.putalpha(mask)
    d = ImageDraw.Draw(canvas)
    s = scale * ss

    def box(x1, y1, x2, y2):
        return tuple(round(v * s) for v in (x1, y1, x2, y2))

    # rings
    d.ellipse(box(50, 50, 462, 462), outline=(*GOLD, 62), width=round(18 * s))
    d.ellipse(box(94, 94, 418, 418), outline=(*MINT, 46), width=round(10 * s))

    # wings
    for left in [True, False]:
        sign = 1 if left else -1
        points1 = [(119, 210), (207, 210), (175, 240), (105, 240), (88, 233), (93, 213)]
        points2 = [(108, 270), (195, 270), (165, 300), (95, 300), (78, 293), (83, 273)]
        if not left:
            points1 = [(512 - x, y) for x, y in points1]
            points2 = [(512 - x, y) for x, y in points2]
        d.polygon([(round(x * s), round(y * s)) for x, y in points1], fill=(*MINT_HI, 236))
        d.polygon([(round(x * s), round(y * s)) for x, y in points2], fill=(*MINT, 184))

    # glow under H
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle(box(178, 134, 246, 378), radius=round(22 * s), fill=(*GOLD, 120))
    gd.rounded_rectangle(box(266, 134, 334, 378), radius=round(22 * s), fill=(*GOLD, 120))
    gd.rounded_rectangle(box(205, 232, 307, 288), radius=round(24 * s), fill=(*GOLD, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(round(7 * s)))
    canvas.alpha_composite(glow)

    # H
    for rect in [(178, 134, 246, 378), (266, 134, 334, 378), (205, 232, 307, 288)]:
        d.rounded_rectangle(box(*rect), radius=round(22 * s), fill=GOLD_HI if rect[1] < 150 else GOLD)
    d.rounded_rectangle(box(205, 242, 307, 280), radius=round(19 * s), fill=(5, 6, 7, 188))
    d.rounded_rectangle(box(222, 253, 290, 269), radius=round(8 * s), fill=GOLD)

    # agent/spark dot
    d.ellipse(box(320, 321, 388, 389), fill=BG, outline=MINT, width=round(12 * s))
    d.polygon([(round(x * s), round(y * s)) for x, y in [(348, 356), (335, 343), (347, 331), (372, 356), (347, 381), (335, 369)]], fill=MINT_HI)

    canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
    canvas.save(path)


for filename, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180), ("favicon-32.png", 32), ("favicon-16.png", 16)]:
    draw_icon(ICON_DIR / filename, size)
    print(ICON_DIR / filename)
