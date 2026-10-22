"""Generate small equirectangular planet bitmaps (stdlib only)."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "textures"
ROOT.mkdir(exist_ok=True)


def write_png(path: Path, w: int, h: int, rgb: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = b"".join(b"\x00" + rgb[y * w * 3 : (y + 1) * w * 3] for y in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def clamp(x: float) -> int:
    return max(0, min(255, int(x)))


def hash2(ix: int, iy: int, seed: int) -> float:
    n = (ix * 374761393 + iy * 668265263 + seed * 1274126177) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return (n & 0xFFFFFF) / 16777215.0


def noise(x: float, y: float, seed: int) -> float:
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    n00 = hash2(x0, y0, seed)
    n10 = hash2(x0 + 1, y0, seed)
    n01 = hash2(x0, y0 + 1, seed)
    n11 = hash2(x0 + 1, y0 + 1, seed)
    nx0 = n00 * (1 - fx) + n10 * fx
    nx1 = n01 * (1 - fx) + n11 * fx
    return nx0 * (1 - fy) + nx1 * fy


def fbm(x: float, y: float, seed: int, octaves: int = 5) -> float:
    amp, freq, total, norm = 1.0, 1.0, 0.0, 0.0
    for i in range(octaves):
        total += amp * noise(x * freq, y * freq, seed + i * 17)
        norm += amp
        amp *= 0.5
        freq *= 2.0
    return total / norm


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c0, c1, t):
    return [lerp(c0[i], c1[i], t) for i in range(3)]


def gen(w: int, h: int, fn) -> bytes:
    out = bytearray(w * h * 3)
    i = 0
    for y in range(h):
        v = y / (h - 1)
        lat = (0.5 - v) * math.pi
        for x in range(w):
            u = x / (w - 1)
            lon = (u - 0.5) * 2 * math.pi
            r, g, b = fn(u, v, lon, lat)
            out[i] = clamp(r)
            out[i + 1] = clamp(g)
            out[i + 2] = clamp(b)
            i += 3
    return bytes(out)


def sun_fn(u, v, lon, lat):
    n = fbm(u * 8, v * 4, 11)
    n2 = fbm(u * 18, v * 9, 3)
    hot = mix((255, 170, 40), (255, 240, 160), n)
    spot = 1.0 - 0.25 * n2
    return [c * spot for c in hot]


def mercury_fn(u, v, lon, lat):
    n = fbm(u * 14, v * 7, 21)
    crater = 1.0 if fbm(u * 30, v * 15, 4) > 0.72 else 0.0
    base = mix((90, 90, 95), (170, 160, 150), n)
    return mix(base, (50, 50, 52), crater * 0.6)


def venus_fn(u, v, lon, lat):
    n = fbm(u * 6, v * 3, 8)
    return mix((210, 170, 90), (240, 220, 160), n)


def earth_fn(u, v, lon, lat):
    n = fbm(u * 6, v * 3, 42)
    n2 = fbm(u * 14, v * 7, 7)
    ice = max(0.0, abs(v - 0.5) * 2 - 0.72) / 0.28
    land = 1.0 if n > 0.52 else 0.0
    ocean = mix((8, 40, 110), (20, 90, 170), n2)
    continent = mix((40, 110, 50), (140, 120, 70), n2)
    color = mix(ocean, continent, land)
    cloud = max(0.0, fbm(u * 10, v * 5, 99) - 0.62) / 0.38
    color = mix(color, (240, 245, 250), cloud * 0.45)
    return mix(color, (235, 245, 255), min(1.0, ice))


def moon_fn(u, v, lon, lat):
    n = fbm(u * 10, v * 5, 5)
    crater = max(0.0, fbm(u * 28, v * 14, 13) - 0.7) / 0.3
    base = mix((70, 70, 75), (190, 188, 180), n)
    return mix(base, (40, 40, 42), crater)


def mars_fn(u, v, lon, lat):
    n = fbm(u * 7, v * 3.5, 31)
    ice = max(0.0, abs(v - 0.5) * 2 - 0.82) / 0.18
    base = mix((120, 50, 30), (200, 110, 70), n)
    return mix(base, (230, 230, 235), ice)


def jupiter_fn(u, v, lon, lat):
    bands = 0.5 + 0.5 * math.sin(v * 28 + fbm(u * 4, v * 2, 2) * 2)
    n = fbm(u * 12, v * 6, 16)
    c0, c1 = (210, 160, 110), (160, 110, 70)
    spot = math.exp(-((u - 0.7) ** 2 * 80 + (v - 0.58) ** 2 * 220))
    color = mix(c0, c1, bands * 0.7 + n * 0.3)
    return mix(color, (200, 80, 50), spot)


def saturn_fn(u, v, lon, lat):
    bands = 0.5 + 0.5 * math.sin(v * 22 + fbm(u * 3, v * 2, 9))
    return mix((230, 210, 160), (190, 160, 110), bands)


def uranus_fn(u, v, lon, lat):
    n = fbm(u * 4, v * 2, 18)
    return mix((150, 210, 220), (90, 170, 190), n)


def neptune_fn(u, v, lon, lat):
    n = fbm(u * 5, v * 2.5, 27)
    return mix((40, 80, 190), (90, 140, 230), n)


def ring_rgba(w=512, h=64) -> None:
    """RGB ring; alpha encoded as darkness in unused channel via RGB only (shader uses luminance)."""
    out = bytearray(w * h * 3)
    i = 0
    for y in range(h):
        for x in range(w):
            u = x / (w - 1)
            gap = 1.0 if 0.62 < u < 0.70 else 0.0
            n = 0.55 + 0.45 * math.sin(u * 80)
            a = (1.0 - gap) * n
            col = mix((210, 190, 140), (90, 80, 60), u)
            out[i] = clamp(col[0] * a)
            out[i + 1] = clamp(col[1] * a)
            out[i + 2] = clamp(col[2] * a)
            i += 3
    write_png(ROOT / "saturn_ring.png", w, h, bytes(out))


BODIES = {
    "sun": sun_fn,
    "mercury": mercury_fn,
    "venus": venus_fn,
    "earth": earth_fn,
    "moon": moon_fn,
    "mars": mars_fn,
    "jupiter": jupiter_fn,
    "saturn": saturn_fn,
    "uranus": uranus_fn,
    "neptune": neptune_fn,
}


if __name__ == "__main__":
    for name, fn in BODIES.items():
        size = (512, 256) if name in ("sun", "earth", "moon", "jupiter") else (256, 128)
        write_png(ROOT / f"{name}.png", size[0], size[1], gen(*size, fn))
        print("wrote", name, size)
    ring_rgba()
    print("wrote saturn_ring")
