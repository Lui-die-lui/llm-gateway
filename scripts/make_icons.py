"""Draw the extension's icons (a white shield with a check on blue) without any image library.

    python scripts/make_icons.py        -> extension/icons/icon16.png, icon48.png, icon128.png

The Chrome Web Store needs a 128px icon and Chrome wants 16 and 48 for the toolbar and the extensions page. The shape is the
one the popup already draws (popup.html), so the toolbar and the page look alike. Rerun only when the design changes.
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
BLUE = (37, 99, 235)  # --accent
SHIELD = [(12, 2), (20, 6), (20, 12), (19, 16), (16.5, 19.5), (12, 22), (7.5, 19.5), (5, 16), (4, 12), (4, 6)]  # 24x24 grid
CHECK = [(9, 12), (11, 14), (15, 10)]
SS = 4  # samples per pixel side (anti-aliasing)


def inside_polygon(x: float, y: float, poly: list[tuple[float, float]]) -> bool:
    hit = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def near_polyline(x: float, y: float, line: list[tuple[float, float]], half_width: float) -> bool:
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        if math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= half_width:
            return True
    return False


def in_rounded_square(x: float, y: float, radius: float) -> bool:
    cx, cy = min(max(x, radius), 24 - radius), min(max(y, radius), 24 - radius)
    return math.hypot(x - cx, y - cy) <= radius


def render(size: int) -> bytes:
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter type: none
        for px in range(size):
            cover = {"bg": 0, "white": 0, "blue": 0}
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) * 24 / size
                    y = (py + (sy + 0.5) / SS) * 24 / size
                    if not in_rounded_square(x, y, 5.0):
                        continue
                    if near_polyline(x, y, CHECK, 1.15):
                        cover["blue"] += 1
                    elif inside_polygon(x, y, SHIELD):
                        cover["white"] += 1
                    else:
                        cover["bg"] += 1
            n = SS * SS
            solid = cover["bg"] + cover["white"] + cover["blue"]
            if not solid:
                row += bytes([0, 0, 0, 0])
                continue
            rgb = [(BLUE[i] * (cover["bg"] + cover["blue"]) + 255 * cover["white"]) // solid for i in range(3)]
            row += bytes([*rgb, solid * 255 // n])
        rows.append(bytes(row))
    return b"".join(rows)


def png(size: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(render(size), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        path = OUT / f"icon{size}.png"
        path.write_bytes(png(size))
        print(path.relative_to(OUT.parent.parent), path.stat().st_size, "bytes")
