"""把 screenshots/frames/*.png 合成 10 秒漫游 GIF（60 帧 × 166ms）。"""
import glob
import os
import sys

from PIL import Image

FRAMES = sorted(glob.glob(os.path.join("screenshots", "frames", "f*.png")))
if not FRAMES:
    sys.exit("no frames found")

W, H = 864, 540
imgs = [Image.open(f).convert("RGB").resize((W, H), Image.LANCZOS) for f in FRAMES]

out = os.path.join("screenshots", "tour-10s.gif")
imgs[0].save(
    out,
    save_all=True,
    append_images=imgs[1:],
    duration=166,  # 60 帧 × 166ms ≈ 10 s
    loop=0,
    optimize=True,
    colors=128,
    disposal=2,
)
print("wrote", out, f"{len(imgs)} frames, {os.path.getsize(out) / 1e6:.1f} MB")
