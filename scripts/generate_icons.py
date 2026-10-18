#!/usr/bin/env python3
"""Generate MeetNotes PWA icons (PNG, no dependencies): python scripts/generate_icons.py

Writes frontend/public/icons/{icon,maskable}-{192,512}.png, apple-touch-icon.png and favicon.svg.
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public"
TOP = (79, 70, 229)  # indigo-600
BOTTOM = (124, 58, 237)  # violet-600
WHITE = (255, 255, 255)
SUBSAMPLES = 3


def rounded_rect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1


def glyph(x, y):
    """Microphone in a 0..1 box centred at (0.5, 0.5)."""
    if rounded_rect(x, y, 0.40, 0.18, 0.60, 0.56, 0.10):  # capsule
        return True
    d = math.hypot(x - 0.5, y - 0.44)  # holder arc
    if 0.185 <= d <= 0.225 and y >= 0.44:
        return True
    if 0.48 <= x <= 0.52 and 0.64 <= y <= 0.76:  # stem
        return True
    return rounded_rect(x, y, 0.36, 0.74, 0.64, 0.79, 0.025)  # base


def render(size, maskable):
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter: none
        for px in range(size):
            bg = fg = 0
            for sy in range(SUBSAMPLES):
                for sx in range(SUBSAMPLES):
                    x = (px + (sx + 0.5) / SUBSAMPLES) / size
                    y = (py + (sy + 0.5) / SUBSAMPLES) / size
                    inside = True if maskable else rounded_rect(x, y, 0, 0, 1, 1, 0.22)
                    if not inside:
                        continue
                    bg += 1
                    # Maskable: keep the glyph inside the 80% safe zone.
                    gx, gy = ((x - 0.5) / 0.72 + 0.5, (y - 0.5) / 0.72 + 0.5) if maskable else (x, y)
                    if glyph(gx, gy):
                        fg += 1
            n = SUBSAMPLES * SUBSAMPLES
            t = py / max(1, size - 1)
            base = [round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)]
            if bg == 0:
                row += bytes([0, 0, 0, 0])
                continue
            mix = fg / bg
            color = [round(base[i] + (WHITE[i] - base[i]) * mix) for i in range(3)]
            row += bytes(color + [round(255 * bg / n)])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <rect x="40" y="18" width="20" height="38" rx="10" fill="#fff"/>
  <path d="M29.5 44a20.5 20.5 0 0 0 41 0" fill="none" stroke="#fff" stroke-width="4"/>
  <rect x="48" y="64" width="4" height="12" fill="#fff"/>
  <rect x="36" y="74" width="28" height="5" rx="2.5" fill="#fff"/>
</svg>
"""


def main():
    icons = OUT / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        (icons / f"icon-{size}.png").write_bytes(render(size, maskable=False))
        (icons / f"maskable-{size}.png").write_bytes(render(size, maskable=True))
        print(f"icons {size} done")
    (icons / "apple-touch-icon.png").write_bytes(render(180, maskable=True))  # iOS adds its own rounding
    (OUT / "favicon.svg").write_text(FAVICON, encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
