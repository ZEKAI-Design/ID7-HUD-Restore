#!/usr/bin/env python3
"""Bake the instrument font atlases. Requires Pillow with FreeType."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import zlib

from PIL import Image, ImageDraw, ImageFont


FACES = {
    "instrument_regular": (450, [16, 24, 32, 40]),
    "instrument_medium": (560, [16, 24, 32]),
    "instrument_bold": (660, [16, 24, 32, 44, 56, 72]),
}
CHARS = "".join(chr(code) for code in range(32, 127)) + "°×·–—…"
FONT_DIR = Path(__file__).resolve().parents[1] / "runtime" / "fonts"


def bake(source, size, weight):
    font = ImageFont.truetype(str(source), size)
    font.set_variation_by_axes([weight])
    ascent, descent = font.getmetrics()
    digit_advance = max(font.getlength(ch) for ch in "0123456789")
    width = 512 if size <= 32 else 1024
    glyphs = {}
    positions = []
    x, y, row_height = 1, 1, 0
    for ch in CHARS:
        left, top, right, bottom = font.getbbox(ch, anchor="ls")
        w, h = right - left, bottom - top
        advance = font.getlength(ch)
        pad = (digit_advance - advance) / 2 if ch.isdigit() else 0
        if x + w + 1 > width:
            x, y, row_height = 1, y + row_height + 1, 0
        positions.append((ch, x - left, y - top))
        glyphs[str(ord(ch))] = [x, y, w, h, round(left + pad, 3), top,
                                round(digit_advance if ch.isdigit() else advance, 3)]
        x += w + 1
        row_height = max(row_height, h)

    height = y + row_height + 1
    image = Image.new("L", (width, height))
    draw = ImageDraw.Draw(image)
    for ch, px, py in positions:
        draw.text((px, py), ch, font=font, fill=255, anchor="ls")

    return {
        "size": size, "ascent": ascent, "descent": descent,
        "atlasW": width, "atlasH": height,
        "alpha": base64.b64encode(zlib.compress(image.tobytes(), 9)).decode("ascii"),
        "glyphs": glyphs,
    }


def write_atlas(family, path, sizes, weight):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    data = {
        "family": family,
        "source": "Hanken Grotesk (SIL OFL 1.1)",
        "cacheKey": f"hanken-grotesk-{weight}-{digest[:12]}",
        "sizes": [bake(path, size, weight) for size in sizes],
    }
    (FONT_DIR / (family + ".json")).write_text(json.dumps(data, separators=(",", ":")) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hanken_grotesk_ttf", type=Path)
    args = parser.parse_args()
    for family, (weight, sizes) in FACES.items():
        write_atlas(family, args.hanken_grotesk_ttf, sizes, weight)


if __name__ == "__main__":
    main()
