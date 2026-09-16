#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
期货终端 App 图标生成器（程序化绘制，超采样抗锯齿）
主题：深色底 + K 线走势 + 上升箭头（红涨绿跌的中国期货配色）
按 APP-TEMPLATE-GITHUB-ACTIONS.md「App 图标规范」生成 5 档 mipmap + 预览大图。
"""
import os
from PIL import Image, ImageDraw

# ── 配色（对齐网页深色主题 #0d1117）──
BG_TOP    = (13, 17, 23)      # 深蓝黑
BG_BOTTOM = (22, 32, 48)      # 稍亮
GRID      = (38, 50, 70)
UP        = (255, 82, 82)     # 中国期货：红涨
DOWN      = (46, 204, 113)    # 绿跌
LINE      = (255, 200, 60)    # 金色均线
SHADOW    = (0, 0, 0, 90)

SS = 8  # 超采样倍数

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def draw_icon(size):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # ── 圆角方底 + 垂直渐变 ──
    radius = int(S * 0.22)
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bg)
    for y in range(S):
        bd.line([(0, y), (S, y)], fill=lerp(BG_TOP, BG_BOTTOM, y / S) + (255,))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    img.paste(bg, (0, 0), mask)

    # ── 网格线 ──
    for i in range(1, 4):
        y = int(S * (0.25 + i * 0.18))
        d.line([(int(S * 0.14), y), (int(S * 0.86), y)], fill=GRID + (140,), width=max(1, S // 220))

    # ── K 线（5 根，前 2 跌后 3 涨，体现趋势）──
    candles = [
        (0.22, 0.62, 0.70, 0.56, 0.72, False),  # (x, open, close, low, high, 涨?)
        (0.36, 0.56, 0.64, 0.50, 0.68, False),
        (0.50, 0.64, 0.52, 0.48, 0.70, True),
        (0.64, 0.52, 0.42, 0.38, 0.58, True),
        (0.78, 0.42, 0.32, 0.28, 0.48, True),
    ]
    w = S * 0.055
    for (x, o, c, lo, hi, up) in candles:
        color = UP if up else DOWN
        cx = int(S * x)
        # 影线
        d.line([(cx, int(S * hi)), (cx, int(S * lo))], fill=color + (255,), width=max(2, int(w * 0.22)))
        # 实体
        top, bot = int(S * min(o, c)), int(S * max(o, c))
        d.rectangle([cx - int(w / 2), top, cx + int(w / 2), bot], fill=color + (255,))

    # ── 金色均线（穿 K 线下方，上升）──
    pts = [(int(S * 0.18), int(S * 0.68)), (int(S * 0.36), int(S * 0.60)),
           (int(S * 0.52), int(S * 0.54)), (int(S * 0.68), int(S * 0.42)),
           (int(S * 0.84), int(S * 0.30))]
    d.line(pts, fill=LINE + (235,), width=max(2, S // 90), joint='curve')

    # ── 右上角上升箭头 ──
    ax, ay = int(S * 0.74), int(S * 0.24)
    arrow = [(ax, ay), (int(S * 0.86), int(S * 0.14))]
    d.line(arrow, fill=LINE + (255,), width=max(2, S // 80))
    tri = [(int(S * 0.88), int(S * 0.12)), (int(S * 0.80), int(S * 0.15)), (int(S * 0.86), int(S * 0.21))]
    d.polygon(tri, fill=LINE + (255,))

    return img.resize((size, size), Image.LANCZOS)

def main():
    out = '/workspace/finance-app/app/src/main/res'
    sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for dpi, px in sizes.items():
        d = os.path.join(out, f'mipmap-{dpi}')
        os.makedirs(d, exist_ok=True)
        icon = draw_icon(px)
        icon.save(os.path.join(d, 'ic_launcher.png'))
        # 圆形版：加圆遮罩
        r = icon.size[0]
        circ = Image.new('L', (r * SS, r * SS), 0)
        ImageDraw.Draw(circ).ellipse([0, 0, r * SS - 1, r * SS - 1], fill=255)
        circ = circ.resize((r, r), Image.LANCZOS)
        round_icon = Image.new('RGBA', (r, r), (0, 0, 0, 0))
        round_icon.paste(icon, (0, 0), circ)
        round_icon.save(os.path.join(d, 'ic_launcher_round.png'))
        print(f'{dpi}: {px}px ok')

    # 预览大图
    pv = '/workspace/finance-app/preview'
    os.makedirs(pv, exist_ok=True)
    big = draw_icon(512)
    canvas = Image.new('RGBA', (620, 620), (30, 34, 42, 255))
    canvas.paste(big, (54, 54), big)
    canvas.convert('RGB').save(os.path.join(pv, 'icon-preview.png'))
    print('preview: icon-preview.png ok')

if __name__ == '__main__':
    main()
