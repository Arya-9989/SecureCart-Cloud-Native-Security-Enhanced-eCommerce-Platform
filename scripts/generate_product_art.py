"""Generate the original SVG product illustrations used by the demo catalog.

Every image is drawn from primitives in this file (no third-party artwork), so the demo
store ships without any licensing questions. Run from the repository root:

    python scripts/generate_product_art.py

Output: frontend/public/products/<product-slug>.svg (800x600, 4:3).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "products"

# Soft studio backdrops per category: (top-left, bottom-right, accent)
BACKDROPS = {
    "audio": ("#eef0ff", "#c9cffb", "#6366f1"),
    "wearables": ("#fff1f1", "#fbcfd0", "#e11d48"),
    "home": ("#fff8e8", "#f6dfae", "#d97706"),
    "workspace": ("#ecfdf7", "#b5ecdc", "#0d9488"),
    "travel": ("#eef7ff", "#bfdcf7", "#0284c7"),
}


def lin(gid: str, c1: str, c2: str, x2: float = 0, y2: float = 1) -> str:
    return (
        f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2}" y2="{y2}">'
        f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>'
    )


def rad(gid: str, c1: str, c2: str, cx: float = 0.35, cy: float = 0.3) -> str:
    return (
        f'<radialGradient id="{gid}" cx="{cx}" cy="{cy}" r="0.75">'
        f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></radialGradient>'
    )


def frame(category: str, defs: str, body: str, shadow_rx: int = 190) -> str:
    c1, c2, _ = BACKDROPS[category]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
<defs>
{lin("bg", c1, c2, 1, 1)}
<radialGradient id="spot" cx="0.5" cy="0.42" r="0.55"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
<filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#1e1b4b" flood-opacity="0.18"/></filter>
{defs}
</defs>
<rect width="800" height="600" fill="url(#bg)"/>
<rect width="800" height="600" fill="url(#spot)"/>
<circle cx="660" cy="110" r="70" fill="#fff" opacity="0.28"/>
<circle cx="130" cy="500" r="110" fill="#fff" opacity="0.18"/>
<ellipse cx="400" cy="478" rx="{shadow_rx}" ry="20" fill="#1e1b4b" opacity="0.16" filter="url(#soft)"/>
<g filter="url(#lift)">
{body}
</g>
</svg>
"""


# --------------------------------------------------------------------------------------
# Audio
# --------------------------------------------------------------------------------------
def headphones() -> str:
    defs = lin("band", "#475569", "#1e293b") + lin("cup", "#334155", "#0f172a", 1, 1)
    defs += lin("ring", "#a5b4fc", "#6366f1")
    body = """
<path d="M262 330 C262 140 538 140 538 330" fill="none" stroke="url(#band)" stroke-width="30" stroke-linecap="round"/>
<path d="M300 236 C340 176 460 176 500 236" fill="none" stroke="#64748b" stroke-width="8" stroke-linecap="round" opacity="0.6"/>
<rect x="232" y="296" width="62" height="40" rx="12" fill="#94a3b8"/>
<rect x="506" y="296" width="62" height="40" rx="12" fill="#94a3b8"/>
<rect x="206" y="318" width="104" height="150" rx="50" fill="url(#cup)"/>
<rect x="490" y="318" width="104" height="150" rx="50" fill="url(#cup)"/>
<rect x="296" y="332" width="30" height="122" rx="15" fill="#1e293b"/>
<rect x="474" y="332" width="30" height="122" rx="15" fill="#1e293b"/>
<ellipse cx="258" cy="393" rx="30" ry="44" fill="none" stroke="url(#ring)" stroke-width="6"/>
<ellipse cx="542" cy="393" rx="30" ry="44" fill="none" stroke="url(#ring)" stroke-width="6"/>
<path d="M226 350 C230 336 240 328 252 326" stroke="#fff" stroke-opacity="0.35" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M510 350 C514 336 524 328 536 326" stroke="#fff" stroke-opacity="0.35" stroke-width="6" fill="none" stroke-linecap="round"/>
"""
    return frame("audio", defs, body, 210)


def speaker() -> str:
    defs = lin("shell", "#14b8a6", "#0f766e", 1, 1) + lin("cap", "#5eead4", "#14b8a6")
    dots = "".join(
        f'<circle cx="{x}" cy="{y}" r="4.5" fill="#0b4f49" opacity="0.55"/>'
        for y in range(268, 430, 18)
        for x in range(316 + (9 if (y // 18) % 2 else 0), 486, 18)
    )
    body = f"""
<path d="M372 170 C372 128 428 128 428 170" fill="none" stroke="#334155" stroke-width="12" stroke-linecap="round"/>
<rect x="292" y="196" width="216" height="268" rx="70" fill="url(#shell)"/>
<rect x="292" y="196" width="216" height="40" rx="20" fill="url(#cap)"/>
<clipPath id="grille"><rect x="304" y="250" width="192" height="196" rx="56"/></clipPath>
<g clip-path="url(#grille)">{dots}</g>
<rect x="372" y="208" width="56" height="12" rx="6" fill="#0f766e" opacity="0.7"/>
<path d="M316 280 C316 240 340 222 368 220" stroke="#fff" stroke-opacity="0.35" stroke-width="10" fill="none" stroke-linecap="round"/>
"""
    return frame("audio", defs, body, 150)


def earbuds() -> str:
    defs = lin("case", "#ffffff", "#d7dbf3", 1, 1) + lin("bud", "#ffffff", "#c7cbe6", 1, 1)
    body = """
<rect x="240" y="300" width="250" height="160" rx="70" fill="url(#case)"/>
<path d="M240 370 H490" stroke="#b8bde0" stroke-width="3"/>
<path d="M252 330 C262 250 470 250 480 330 Z" fill="#eceefb" transform="rotate(-18 250 330)"/>
<circle cx="365" cy="420" r="6" fill="#22c55e"/>
<g transform="translate(470 210) rotate(18)">
  <ellipse cx="40" cy="40" rx="40" ry="36" fill="url(#bud)"/>
  <ellipse cx="22" cy="40" rx="14" ry="16" fill="#334155"/>
  <rect x="44" y="52" width="26" height="120" rx="13" fill="url(#bud)"/>
</g>
<g transform="translate(520 300) rotate(-8)">
  <ellipse cx="40" cy="40" rx="40" ry="36" fill="url(#bud)"/>
  <ellipse cx="58" cy="40" rx="14" ry="16" fill="#334155"/>
  <rect x="10" y="52" width="26" height="120" rx="13" fill="url(#bud)"/>
</g>
"""
    return frame("audio", defs, body, 200)


def turntable() -> str:
    defs = lin("wood", "#b45309", "#78350f", 1, 1) + rad("vinyl", "#3f3f46", "#09090b", 0.4, 0.35)
    grooves = "".join(
        f'<circle cx="350" cy="330" r="{r}" fill="none" stroke="#52525b" stroke-width="1.2" opacity="0.7"/>'
        for r in range(46, 118, 9)
    )
    body = f"""
<rect x="196" y="214" width="408" height="236" rx="22" fill="url(#wood)"/>
<rect x="196" y="420" width="408" height="30" rx="12" fill="#5b2a0a" opacity="0.6"/>
<circle cx="350" cy="330" r="124" fill="#d4d4d8"/>
<circle cx="350" cy="330" r="118" fill="url(#vinyl)"/>
{grooves}
<circle cx="350" cy="330" r="34" fill="#ef4444"/>
<circle cx="350" cy="330" r="6" fill="#e4e4e7"/>
<path d="M300 260 A80 80 0 0 1 380 250" stroke="#fff" stroke-opacity="0.18" stroke-width="10" fill="none"/>
<circle cx="540" cy="256" r="20" fill="#e4e4e7"/><circle cx="540" cy="256" r="8" fill="#a1a1aa"/>
<path d="M540 256 L520 380 L452 396" fill="none" stroke="#e4e4e7" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="428" y="384" width="34" height="22" rx="4" fill="#27272a" transform="rotate(-14 445 395)"/>
<circle cx="560" cy="414" r="9" fill="#fbbf24"/>
<rect x="216" y="450" width="40" height="14" rx="4" fill="#3f1d06"/>
<rect x="544" y="450" width="40" height="14" rx="4" fill="#3f1d06"/>
"""
    return frame("audio", defs, body, 220)


# --------------------------------------------------------------------------------------
# Wearables
# --------------------------------------------------------------------------------------
def smartwatch() -> str:
    defs = lin("strap", "#475569", "#1e293b") + lin("case", "#f1f5f9", "#94a3b8", 1, 1)
    defs += rad("screen", "#1e293b", "#020617", 0.4, 0.3)
    body = """
<rect x="338" y="120" width="124" height="150" rx="26" fill="url(#strap)"/>
<rect x="338" y="330" width="124" height="160" rx="26" fill="url(#strap)"/>
<circle cx="400" cy="460" r="7" fill="#0f172a"/><circle cx="400" cy="434" r="7" fill="#0f172a"/>
<rect x="312" y="196" width="176" height="208" rx="54" fill="url(#case)"/>
<rect x="488" y="262" width="14" height="44" rx="7" fill="#cbd5e1"/>
<rect x="326" y="210" width="148" height="180" rx="44" fill="url(#screen)"/>
<circle cx="400" cy="300" r="58" fill="none" stroke="#3f1220" stroke-width="12"/>
<circle cx="400" cy="300" r="58" fill="none" stroke="#f43f5e" stroke-width="12" stroke-dasharray="270 400" stroke-linecap="round" transform="rotate(-90 400 300)"/>
<circle cx="400" cy="300" r="42" fill="none" stroke="#1a3b16" stroke-width="12"/>
<circle cx="400" cy="300" r="42" fill="none" stroke="#84cc16" stroke-width="12" stroke-dasharray="170 400" stroke-linecap="round" transform="rotate(-90 400 300)"/>
<circle cx="400" cy="300" r="26" fill="none" stroke="#0b3446" stroke-width="12"/>
<circle cx="400" cy="300" r="26" fill="none" stroke="#22d3ee" stroke-width="12" stroke-dasharray="120 400" stroke-linecap="round" transform="rotate(-90 400 300)"/>
<path d="M342 236 C352 222 370 216 390 216" stroke="#fff" stroke-opacity="0.25" stroke-width="6" fill="none" stroke-linecap="round"/>
"""
    return frame("wearables", defs, body, 150)


def fitness_band() -> str:
    defs = lin("band", "#fb7185", "#be123c", 1, 1)
    body = """
<ellipse cx="400" cy="330" rx="190" ry="110" fill="none" stroke="url(#band)" stroke-width="44"/>
<ellipse cx="400" cy="330" rx="190" ry="110" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="6" stroke-dasharray="40 30"/>
<g transform="rotate(-6 400 220)">
  <rect x="318" y="182" width="164" height="78" rx="38" fill="#0f172a"/>
  <rect x="330" y="194" width="140" height="54" rx="27" fill="#111827" stroke="#334155" stroke-width="2"/>
  <path d="M352 222 h14 l8 -14 l10 26 l8 -12 h20" fill="none" stroke="#4ade80" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="424" y="210" width="30" height="7" rx="3.5" fill="#4ade80" opacity="0.8"/>
  <rect x="424" y="224" width="20" height="7" rx="3.5" fill="#4ade80" opacity="0.5"/>
</g>
"""
    return frame("wearables", defs, body, 200)


def sunglasses() -> str:
    defs = lin("lens", "#334155", "#0f172a", 1, 1) + lin("frame", "#7c2d12", "#431407", 1, 1)
    defs += lin("shine", "#ffffff", "#ffffff00", 1, 1)
    body = """
<path d="M196 262 L150 236" stroke="url(#frame)" stroke-width="14" stroke-linecap="round"/>
<path d="M604 262 L650 236" stroke="url(#frame)" stroke-width="14" stroke-linecap="round"/>
<path d="M202 252 Q300 232 372 256 Q382 344 318 384 Q238 400 214 346 Q196 300 202 252 Z" fill="url(#lens)" stroke="url(#frame)" stroke-width="16" stroke-linejoin="round"/>
<path d="M598 252 Q500 232 428 256 Q418 344 482 384 Q562 400 586 346 Q604 300 598 252 Z" fill="url(#lens)" stroke="url(#frame)" stroke-width="16" stroke-linejoin="round"/>
<path d="M372 262 Q400 240 428 262" fill="none" stroke="url(#frame)" stroke-width="14" stroke-linecap="round"/>
<path d="M236 280 Q270 266 310 270 L250 350 Q228 320 236 280 Z" fill="url(#shine)" opacity="0.28"/>
<path d="M462 280 Q500 266 540 270 L476 350 Q454 320 462 280 Z" fill="url(#shine)" opacity="0.28"/>
"""
    return frame("wearables", defs, body, 230)


# --------------------------------------------------------------------------------------
# Home & living
# --------------------------------------------------------------------------------------
def lamp() -> str:
    defs = rad("globe", "#fffbea", "#fcd58a", 0.45, 0.4) + lin("brass", "#fcd34d", "#b45309", 1, 0)
    defs += '<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fde68a" stop-opacity="0.9"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient>'
    body = """
<circle cx="400" cy="236" r="170" fill="url(#halo)"/>
<circle cx="400" cy="236" r="104" fill="url(#globe)"/>
<ellipse cx="366" cy="196" rx="34" ry="22" fill="#fff" opacity="0.6"/>
<rect x="388" y="336" width="24" height="96" rx="8" fill="url(#brass)"/>
<rect x="370" y="326" width="60" height="18" rx="9" fill="url(#brass)"/>
<ellipse cx="400" cy="450" rx="96" ry="22" fill="#92400e"/>
<rect x="304" y="432" width="192" height="20" rx="10" fill="url(#brass)"/>
"""
    return frame("home", defs, body, 140)


def mug(x: int, color1: str, color2: str, gid: str, flip: bool = False) -> str:
    handle_x = x + 150 if not flip else x - 46
    return f"""
<path d="M{handle_x + 18} 300 C{handle_x + (64 if not flip else -28)} 300 {handle_x + (64 if not flip else -28)} 390 {handle_x + 18} 390" fill="none" stroke="url(#{gid})" stroke-width="22" stroke-linecap="round"/>
<path d="M{x} 250 h168 v168 q0 44 -44 44 h-80 q-44 0 -44 -44 Z" fill="url(#{gid})"/>
<ellipse cx="{x + 84}" cy="250" rx="84" ry="18" fill="{color2}"/>
<ellipse cx="{x + 84}" cy="252" rx="72" ry="12" fill="#3b1d0e"/>
<path d="M{x} 262 q20 30 40 4 q20 32 44 2 q24 30 44 0 q22 28 40 0 v-12 h-168 Z" fill="{color1}" opacity="0.9"/>
<path d="M{x + 20} 300 v110" stroke="#fff" stroke-opacity="0.25" stroke-width="10" stroke-linecap="round"/>
"""


def mug_set() -> str:
    defs = lin("terra", "#e07a4f", "#9a3412", 1, 1) + lin("sage", "#9cbf9b", "#4d7c55", 1, 1)
    body = mug(178, "#f5d0b8", "#c2603a", "terra", flip=True) + mug(452, "#e2efe1", "#6c9a70", "sage")
    return frame("home", defs, body, 240)


def planter() -> str:
    defs = lin("pot", "#e0855c", "#9a3412", 1, 0) + lin("leaf", "#4ade80", "#15803d", 1, 1)
    leaves = ""
    for angle, length in [(-62, 170), (-38, 200), (-14, 215), (12, 210), (36, 195), (60, 165), (-80, 130), (80, 130)]:
        leaflets = "".join(
            f'<ellipse cx="{side * 16}" cy="{-t}" rx="18" ry="7" fill="url(#leaf)" transform="rotate({side * -35} {side * 16} {-t})"/>'
            for t in range(36, length - 10, 22)
            for side in (-1, 1)
        )
        leaves += (
            f'<g transform="translate(400 300) rotate({angle})">'
            f'<path d="M0 0 V{-length}" stroke="#166534" stroke-width="4"/>{leaflets}</g>'
        )
    body = f"""
{leaves}
<path d="M300 300 h200 l-22 160 q-4 16 -20 16 h-116 q-16 0 -20 -16 Z" fill="url(#pot)"/>
<rect x="286" y="286" width="228" height="40" rx="10" fill="#c2410c"/>
<rect x="286" y="286" width="228" height="12" rx="6" fill="#fb923c" opacity="0.6"/>
<path d="M330 340 l14 110" stroke="#fff" stroke-opacity="0.2" stroke-width="12" stroke-linecap="round"/>
"""
    return frame("home", defs, body, 140)


def candle() -> str:
    defs = lin("jar", "#fbbf24cc", "#b45309dd", 1, 1) + lin("wax", "#fffbeb", "#fde68a")
    defs += '<radialGradient id="flame" cx="0.5" cy="0.7" r="0.6"><stop offset="0" stop-color="#fff7d6"/><stop offset="0.5" stop-color="#fbbf24"/><stop offset="1" stop-color="#f97316"/></radialGradient>'
    defs += '<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fde68a" stop-opacity="0.8"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient>'
    body = """
<circle cx="400" cy="220" r="110" fill="url(#glow)"/>
<path d="M400 168 C384 196 384 224 400 236 C416 224 416 196 400 168 Z" fill="url(#flame)"/>
<path d="M400 236 v26" stroke="#292524" stroke-width="4" stroke-linecap="round"/>
<rect x="296" y="250" width="208" height="214" rx="30" fill="url(#jar)"/>
<rect x="306" y="262" width="188" height="40" rx="18" fill="url(#wax)"/>
<rect x="320" y="330" width="160" height="92" rx="10" fill="#fffbeb"/>
<text x="400" y="370" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="#78350f">EMBER</text>
<text x="400" y="400" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" letter-spacing="3" fill="#a16207">CEDAR · AMBER</text>
<path d="M316 290 v150" stroke="#fff" stroke-opacity="0.3" stroke-width="10" stroke-linecap="round"/>
"""
    return frame("home", defs, body, 150)


# --------------------------------------------------------------------------------------
# Workspace
# --------------------------------------------------------------------------------------
def keyboard() -> str:
    defs = lin("case", "#334155", "#0f172a", 1, 1) + lin("key", "#f8fafc", "#cbd5e1")
    defs += lin("accent", "#2dd4bf", "#0d9488")
    keys = []
    rows = [(14, 0), (14, 6), (13, 12), (12, 20)]
    unit, gap, x0, y0 = 28, 6, 165, 234
    for r, (count, offset) in enumerate(rows):
        for c in range(count):
            fill = "url(#accent)" if (r == 0 and c == 0) or (r == 2 and c == count - 1) else "url(#key)"
            keys.append(
                f'<rect x="{x0 + offset + c * (unit + gap)}" y="{y0 + r * (unit + gap)}" '
                f'width="{unit}" height="{unit}" rx="7" fill="{fill}"/>'
            )
    bottom = y0 + 4 * (unit + gap)
    for c in range(3):
        keys.append(f'<rect x="{x0 + c * 34}" y="{bottom}" width="{unit}" height="{unit}" rx="7" fill="url(#key)"/>')
    keys.append(f'<rect x="{x0 + 102}" y="{bottom}" width="232" height="{unit}" rx="7" fill="url(#key)"/>')
    for c in range(4):
        keys.append(f'<rect x="{x0 + 340 + c * 34}" y="{bottom}" width="{unit}" height="{unit}" rx="7" fill="url(#key)"/>')
    body = f"""
<rect x="140" y="208" width="520" height="210" rx="26" fill="url(#case)"/>
<rect x="148" y="214" width="504" height="6" rx="3" fill="#fff" opacity="0.12"/>
{''.join(keys)}
<circle cx="636" cy="226" r="5" fill="#2dd4bf"/>
"""
    return frame("workspace", defs, body, 280)


def mouse() -> str:
    defs = lin("shell", "#f8fafc", "#cbd5e1", 1, 1) + lin("side", "#2dd4bf", "#0f766e", 1, 1)
    body = """
<path d="M400 150 C490 150 520 230 520 320 C520 420 470 470 400 470 C330 470 280 420 280 320 C280 230 310 150 400 150 Z" fill="url(#side)"/>
<path d="M400 158 C478 158 506 230 506 316 C506 410 462 456 400 456 C338 456 294 410 294 316 C294 230 322 158 400 158 Z" fill="url(#shell)"/>
<path d="M400 160 V286" stroke="#94a3b8" stroke-width="3"/>
<path d="M298 286 C340 296 460 296 502 286" fill="none" stroke="#cbd5e1" stroke-width="3"/>
<rect x="388" y="196" width="24" height="54" rx="12" fill="#334155"/>
<rect x="394" y="206" width="12" height="14" rx="6" fill="#64748b"/>
<path d="M326 220 C336 190 356 174 380 168" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.8"/>
"""
    return frame("workspace", defs, body, 130)


def notebook() -> str:
    defs = lin("cover", "#5f8f88", "#2f5d57", 1, 1)
    defs += (
        '<pattern id="linen" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
        '<rect width="8" height="8" fill="none"/><path d="M0 0 V8" stroke="#ffffff" stroke-opacity="0.08" stroke-width="3"/></pattern>'
    )
    body = """
<g transform="rotate(-6 400 320)">
  <rect x="270" y="166" width="276" height="326" rx="16" fill="#f5f5f4"/>
  <rect x="262" y="160" width="276" height="326" rx="16" fill="url(#cover)"/>
  <rect x="262" y="160" width="276" height="326" rx="16" fill="url(#linen)"/>
  <rect x="262" y="160" width="26" height="326" rx="10" fill="#1f4440" opacity="0.5"/>
  <rect x="486" y="160" width="14" height="326" fill="#111827" opacity="0.75"/>
  <rect x="330" y="230" width="140" height="56" rx="8" fill="#f8fafc" opacity="0.92"/>
  <rect x="348" y="248" width="104" height="6" rx="3" fill="#2f5d57" opacity="0.6"/>
  <rect x="348" y="264" width="70" height="6" rx="3" fill="#2f5d57" opacity="0.35"/>
  <path d="M440 486 v44 l14 -12 l14 12 v-44" fill="#f59e0b"/>
</g>
"""
    return frame("workspace", defs, body, 170)


def laptop_stand() -> str:
    defs = lin("alu", "#f1f5f9", "#94a3b8", 1, 1) + lin("base", "#e2e8f0", "#94a3b8")
    defs += lin("screen", "#2dd4bf", "#0f766e", 1, 1)
    body = """
<path d="M300 352 L272 462 H300 L330 352 Z" fill="url(#alu)"/>
<path d="M500 352 L528 462 H500 L470 352 Z" fill="url(#alu)"/>
<rect x="286" y="404" width="228" height="12" rx="6" fill="#94a3b8"/>
<rect x="256" y="458" width="76" height="12" rx="6" fill="#64748b"/>
<rect x="468" y="458" width="76" height="12" rx="6" fill="#64748b"/>
<rect x="262" y="336" width="276" height="20" rx="8" fill="url(#alu)"/>
<rect x="268" y="150" width="264" height="174" rx="14" fill="#1e293b"/>
<rect x="280" y="162" width="240" height="150" rx="6" fill="url(#screen)"/>
<path d="M280 262 C330 230 370 280 420 246 C460 220 492 236 520 222 V312 H280 Z" fill="#134e4a" opacity="0.55"/>
<circle cx="476" cy="200" r="16" fill="#ccfbf1" opacity="0.8"/>
<path d="M228 330 H572 L556 346 H244 Z" fill="url(#base)"/>
<rect x="372" y="330" width="56" height="5" rx="2.5" fill="#64748b" opacity="0.5"/>
"""
    return frame("workspace", defs, body, 200)


# --------------------------------------------------------------------------------------
# Travel & outdoor
# --------------------------------------------------------------------------------------
def daypack() -> str:
    defs = lin("body", "#38bdf8", "#0369a1", 1, 1) + lin("pocket", "#0ea5e9", "#075985", 1, 1)
    body = """
<path d="M372 140 C372 110 428 110 428 140" fill="none" stroke="#0c4a6e" stroke-width="14" stroke-linecap="round"/>
<path d="M290 220 C290 160 330 140 400 140 C470 140 510 160 510 220 V440 Q510 476 474 476 H326 Q290 476 290 440 Z" fill="url(#body)"/>
<path d="M300 200 C330 172 470 172 500 200" fill="none" stroke="#0c4a6e" stroke-width="5" stroke-dasharray="2 8" stroke-linecap="round"/>
<rect x="318" y="330" width="164" height="124" rx="30" fill="url(#pocket)"/>
<path d="M330 352 H470" stroke="#e0f2fe" stroke-width="4" stroke-linecap="round" opacity="0.8"/>
<rect x="452" y="344" width="10" height="26" rx="5" fill="#fbbf24"/>
<rect x="366" y="240" width="68" height="42" rx="10" fill="#0c4a6e"/>
<path d="M384 268 l12 -16 l10 10 l8 -8 l12 14" fill="none" stroke="#7dd3fc" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M306 236 V420" stroke="#fff" stroke-opacity="0.25" stroke-width="10" stroke-linecap="round"/>
"""
    return frame("travel", defs, body, 160)


def bottle() -> str:
    defs = lin("steel", "#0ea5e9", "#0c4a6e", 1, 0) + lin("cap", "#334155", "#0f172a", 1, 0)
    body = """
<rect x="366" y="114" width="68" height="20" rx="8" fill="#1e293b"/>
<path d="M372 112 C372 90 428 90 428 112" fill="none" stroke="#1e293b" stroke-width="10"/>
<rect x="348" y="128" width="104" height="64" rx="14" fill="url(#cap)"/>
<path d="M350 196 C350 216 330 222 330 250 V440 Q330 474 364 474 H436 Q470 474 470 440 V250 C470 222 450 216 450 196 Z" fill="url(#steel)"/>
<rect x="330" y="300" width="140" height="46" fill="#082f49" opacity="0.25"/>
<path d="M352 236 V440" stroke="#fff" stroke-opacity="0.35" stroke-width="12" stroke-linecap="round"/>
<path d="M444 246 V430" stroke="#fff" stroke-opacity="0.12" stroke-width="6" stroke-linecap="round"/>
"""
    return frame("travel", defs, body, 110)


def camera() -> str:
    defs = lin("shell", "#f8fafc", "#cbd5e1", 1, 1) + rad("lens", "#475569", "#020617", 0.38, 0.32)
    defs += lin("stripe", "#f97316", "#facc15", 1, 0)
    body = """
<rect x="350" y="150" width="190" height="72" rx="8" fill="#ffffff" stroke="#e2e8f0" stroke-width="2" transform="rotate(-8 445 186)"/>
<rect x="364" y="160" width="160" height="52" rx="4" fill="#7dd3fc" transform="rotate(-8 445 186)"/>
<path d="M376 206 l40 -30 l26 18 l30 -24 l44 30" fill="#0ea5e9" transform="rotate(-8 445 186)"/>
<rect x="230" y="200" width="340" height="250" rx="44" fill="url(#shell)"/>
<rect x="230" y="372" width="340" height="16" fill="url(#stripe)"/>
<rect x="268" y="226" width="64" height="40" rx="10" fill="#1e293b"/>
<rect x="276" y="234" width="48" height="24" rx="6" fill="#334155"/>
<rect x="470" y="226" width="64" height="30" rx="8" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="2"/>
<circle cx="400" cy="312" r="86" fill="#e2e8f0"/>
<circle cx="400" cy="312" r="72" fill="url(#lens)"/>
<circle cx="400" cy="312" r="44" fill="none" stroke="#64748b" stroke-width="3" opacity="0.6"/>
<circle cx="400" cy="312" r="22" fill="#0b1220"/>
<circle cx="378" cy="290" r="14" fill="#fff" opacity="0.35"/>
<circle cx="530" cy="420" r="12" fill="#ef4444"/>
"""
    return frame("travel", defs, body, 200)


ARTWORK: dict[str, Callable[[], str]] = {
    "aurora-wireless-headphones": headphones,
    "pulse-mini-speaker": speaker,
    "echo-studio-earbuds": earbuds,
    "groove-desk-turntable": turntable,
    "meridian-smartwatch": smartwatch,
    "stride-fitness-band": fitness_band,
    "horizon-sunglasses": sunglasses,
    "halo-table-lamp": lamp,
    "terra-ceramic-mug-set": mug_set,
    "fern-planter": planter,
    "ember-soy-candle": candle,
    "keystone-mechanical-keyboard": keyboard,
    "glide-wireless-mouse": mouse,
    "folio-linen-notebook": notebook,
    "arc-laptop-stand": laptop_stand,
    "summit-daypack": daypack,
    "tide-insulated-bottle": bottle,
    "nomad-instant-camera": camera,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, draw in ARTWORK.items():
        (OUT / f"{slug}.svg").write_text(draw(), encoding="utf-8")
    print(f"Wrote {len(ARTWORK)} illustrations to {OUT}")


if __name__ == "__main__":
    main()
