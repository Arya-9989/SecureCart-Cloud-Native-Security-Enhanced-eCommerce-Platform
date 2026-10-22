"""Generate the original SVG product illustrations used by the demo catalog.

Every image is drawn from primitives in this file (no third-party artwork), so the demo
store ships without any licensing questions. Run from the repository root:

    python scripts/generate_product_art.py

Output: frontend/public/products/<product-slug>.svg (800x600, 4:3).

Studio model
------------
All eighteen pieces are lit and framed identically, as if shot in one session:

* **Transparent canvas.** No backdrop is baked in. The storefront tile supplies the seamless
  studio sweep (near-white in the light theme, graphite in the dark theme), so one file
  works on both.
* **One key light, upper left.** Materials use gradients that run light-to-dark from the
  upper left (flat faces) or left-to-right (cylinders), and every major surface also gets the
  shared ``#key`` overlay: a soft highlight top-left falling to a gentle core shadow
  bottom-right.
* **Shared silhouette filter** (``#studio``, a user-space region so strokes never clip): a crisp specular edge where the key light
  grazes the top-left of the silhouette, and a faint rim light on the bottom-right edge so
  dark objects still separate from a dark tile. It is built from offsets and composites
  only (no lighting primitives), so it is cheap to rasterise.
* **One ground.** Each drawing declares its bounding box; ``frame`` scales it to a common
  visual mass and seats it on the same ground line, over a two-layer neutral shadow (a tight
  contact shadow plus a broad ambient one).
* **One camera rule.** Things that stand (lamp, bottle, speaker, headphones, mugs...) are
  shown front-on at eye level. Things that lie on a desk (keyboard, mouse, turntable, fitness
  band) are shown from about 30 degrees above, as a buyer sees them on a table: their top is
  foreshortened to half height and their front edge shows its real thickness. ``from_above``
  applies that rule, so no tabletop object is ever drawn as a plan stood on its edge.
* **Materials over colour.** Anodised aluminium, matte graphite, ceramic, fabric, glass and
  wood in slightly desaturated tones. Each product keeps its identity colour family. No
  text, logos or brand marks.
"""

# ruff: noqa: E501 - SVG markup and path data read best unwrapped, one element per line.
from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "products"

# Canvas and framing.
CANVAS_W, CANVAS_H = 800, 600
CENTER_X = 400
GROUND_Y = 470  # every product rests on this line
MAX_W = 496  # ~62% of the canvas width
MAX_H = 330
TARGET_AREA = 124_000  # equal visual mass for wide, tall and square objects


# --------------------------------------------------------------------------------------
# Shared definitions
# --------------------------------------------------------------------------------------
def lin(gid: str, *stops: tuple[float, str], x2: float = 0, y2: float = 1) -> str:
    """Linear gradient from (0,0) to (x2,y2) in object-bounding-box units."""
    body = "".join(f'<stop offset="{o:g}" stop-color="{c}"/>' for o, c in stops)
    return (
        f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2:g}" y2="{y2:g}">{body}</linearGradient>'
    )


def rad(gid: str, *stops: tuple[float, str], cx: float = 0.36, cy: float = 0.3) -> str:
    """Radial gradient whose hot spot sits towards the key light (upper left)."""
    body = "".join(f'<stop offset="{o:g}" stop-color="{c}"/>' for o, c in stops)
    return f'<radialGradient id="{gid}" cx="{cx:g}" cy="{cy:g}" r="0.78">{body}</radialGradient>'


def cyl(gid: str, light: str, mid: str, dark: str) -> str:
    """Horizontal shading for cylinders lit from the left."""
    return lin(gid, (0, mid), (0.22, light), (0.62, mid), (1, dark), x2=1, y2=0)


def flat(gid: str, light: str, dark: str) -> str:
    """Diagonal shading for faces turned towards the key light."""
    return lin(gid, (0, light), (1, dark), x2=0.55, y2=1)


ALUMINIUM = lin(
    "alu", (0, "#f2f2f4"), (0.35, "#d4d5d9"), (0.55, "#e9e9ec"), (1, "#a9abb1"), x2=1, y2=1
)

SHARED_DEFS = f"""
<linearGradient id="key" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/>
<stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".24"/>
</linearGradient>
{ALUMINIUM}
<filter id="studio" filterUnits="userSpaceOnUse" x="60" y="40" width="680" height="520" color-interpolation-filters="sRGB">
<feOffset in="SourceAlpha" dx="2" dy="2" result="a"/>
<feComposite in="SourceAlpha" in2="a" operator="out" result="b"/>
<feGaussianBlur in="b" stdDeviation="0.9" result="c"/>
<feComposite in="c" in2="SourceAlpha" operator="in" result="d"/>
<feFlood flood-color="#fff" flood-opacity=".42"/>
<feComposite in2="d" operator="in" result="spec"/>
<feOffset in="SourceAlpha" dx="-2.5" dy="-2.5" result="e"/>
<feComposite in="SourceAlpha" in2="e" operator="out" result="f"/>
<feGaussianBlur in="f" stdDeviation="2" result="g"/>
<feComposite in="g" in2="SourceAlpha" operator="in" result="h"/>
<feFlood flood-color="#cdd3dd" flood-opacity=".2"/>
<feComposite in2="h" operator="in" result="rim"/>
<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="spec"/><feMergeNode in="rim"/></feMerge>
</filter>
<filter id="contact" x="-15%" y="-300%" width="130%" height="700%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="ambient" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="16"/></filter>
"""

_FILL = re.compile(r'fill="[^"]*"')
_STROKE = re.compile(r'stroke="[^"]*"')
_DROP = re.compile(r'\s(?:opacity|fill-opacity|stroke-opacity|stroke-dasharray)="[^"]*"')


def lit(element: str) -> str:
    """Return ``element`` plus a copy shaded by the shared key light.

    Filled shapes get the overlay as their fill; stroke-only shapes get it as their stroke.
    """
    overlay = _DROP.sub("", element)
    if 'fill="none"' in overlay:
        overlay = _STROKE.sub('stroke="url(#key)"', overlay)
    else:
        overlay = _STROKE.sub("", overlay)
        overlay = _FILL.sub('fill="url(#key)"', overlay)
    return element + overlay


@dataclass(frozen=True)
class Drawing:
    """A product drawn in its own coordinates, with the box it occupies."""

    defs: str
    body: str
    bbox: tuple[float, float, float, float]  # x0, y0, x1, y1 of the artwork
    footprint: float = 0.82  # share of the drawn width that touches the ground
    mass: float = 1.0  # visual mass relative to the set; < 1 for things that are small in life


FORESHORTEN = 0.5  # sin(30 deg): how much a top surface shrinks seen from ~30 degrees above


def from_above(plan: str, top: float, depth: float, slab: str) -> str:
    """Draw a tabletop object, given as a plan (top view) starting at ``top``, from ~30 degrees.

    The plan is foreshortened vertically about ``top``. ``slab`` is the object's outline in the
    same plan coordinates; drawn ``depth`` lower and underneath, it becomes the visible front
    and side faces, i.e. the object's thickness.
    """
    squash = f"translate(0 {_n(top * (1 - FORESHORTEN))}) scale(1 {FORESHORTEN})"
    return (
        f'<g transform="translate(0 {_n(depth)}) {squash}">{slab}</g>'
        f'<g transform="{squash}">{plan}</g>'
    )


def _n(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def frame(drawing: Drawing) -> str:
    """Seat a drawing on the shared ground line with the shared light and shadows."""
    x0, y0, x1, y1 = drawing.bbox
    w, h = x1 - x0, y1 - y0
    scale = min(MAX_W / w, MAX_H / h, math.sqrt(TARGET_AREA * drawing.mass / (w * h)))
    tx = CENTER_X - (x0 + w / 2) * scale
    ty = GROUND_Y - y1 * scale
    width = w * scale
    contact = width * drawing.footprint / 2
    ambient = width * 0.62
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS_W} {CANVAS_H}" '
        f'width="{CANVAS_W}" height="{CANVAS_H}">\n<defs>{SHARED_DEFS}{drawing.defs}</defs>\n'
        f'<ellipse cx="{CENTER_X}" cy="{GROUND_Y + 4}" rx="{_n(ambient)}" ry="16" '
        f'fill="#000" opacity=".13" filter="url(#ambient)"/>\n'
        f'<ellipse cx="{CENTER_X}" cy="{GROUND_Y + 1}" rx="{_n(contact)}" ry="6" '
        f'fill="#000" opacity=".24" filter="url(#contact)"/>\n'
        f'<g transform="translate({_n(tx)} {_n(ty)}) scale({_n(scale)})">'
        f'<g filter="url(#studio)">{drawing.body}</g></g>\n</svg>\n'
    )


# --------------------------------------------------------------------------------------
# Audio
# --------------------------------------------------------------------------------------
def headphones() -> Drawing:
    defs = lin("band", (0, "#5a5f6c"), (1, "#24272f"))
    defs += flat("cup", "#4a4f5d", "#16181e")
    defs += lin("ring", (0, "#c9d1e4"), (1, "#6f7b98"), x2=1, y2=1)
    defs += lin("slide", (0, "#d4d6db"), (0.5, "#a4a7ae"), (1, "#6f727a"), x2=0.6, y2=1)
    body = f"""
{lit('<path d="M262 330 C262 140 538 140 538 330" fill="none" stroke="url(#band)" stroke-width="30" stroke-linecap="round"/>')}
<path d="M298 232 C340 176 460 176 502 232" fill="none" stroke="#7b8090" stroke-width="7" stroke-linecap="round" opacity=".55"/>
{lit('<rect x="232" y="296" width="62" height="40" rx="12" fill="url(#slide)"/>')}
{lit('<rect x="506" y="296" width="62" height="40" rx="12" fill="url(#slide)"/>')}
{lit('<rect x="206" y="318" width="104" height="150" rx="50" fill="url(#cup)"/>')}
{lit('<rect x="490" y="318" width="104" height="150" rx="50" fill="url(#cup)"/>')}
<rect x="296" y="332" width="30" height="122" rx="15" fill="#1d1f25"/>
<rect x="474" y="332" width="30" height="122" rx="15" fill="#1d1f25"/>
<ellipse cx="258" cy="393" rx="30" ry="44" fill="none" stroke="url(#ring)" stroke-width="5"/>
<ellipse cx="542" cy="393" rx="30" ry="44" fill="none" stroke="url(#ring)" stroke-width="5"/>
<path d="M224 352 C228 336 240 328 254 326" stroke="#fff" stroke-opacity=".38" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M508 352 C512 336 524 328 538 326" stroke="#fff" stroke-opacity=".3" stroke-width="5" fill="none" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (206, 173, 594, 468), footprint=0.8)


def speaker() -> Drawing:
    defs = cyl("shell", "#86b2ab", "#5b8b84", "#2f5651") + lin(
        "cap", (0, "#a9cbc5"), (1, "#5f8f88")
    )
    dots = "".join(
        f'<circle cx="{x}" cy="{y}" r="4.2" fill="#1e3d3a" opacity=".5"/>'
        for y in range(268, 430, 18)
        for x in range(316 + (9 if (y // 18) % 2 else 0), 486, 18)
    )
    body = f"""
{lit('<path d="M372 170 C372 128 428 128 428 170" fill="none" stroke="#3a3d45" stroke-width="12" stroke-linecap="round"/>')}
{lit('<rect x="292" y="196" width="216" height="268" rx="70" fill="url(#shell)"/>')}
<rect x="292" y="196" width="216" height="40" rx="20" fill="url(#cap)"/>
<clipPath id="grille"><rect x="304" y="250" width="192" height="196" rx="56"/></clipPath>
<g clip-path="url(#grille)">{dots}</g>
<rect x="372" y="208" width="56" height="10" rx="5" fill="#2f5651" opacity=".6"/>
<path d="M314 284 C314 244 336 226 364 222" stroke="#fff" stroke-opacity=".3" stroke-width="9" fill="none" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (292, 133, 508, 464), footprint=0.78)


def _bud(cx: float, cy: float, r: float, tip_side: int) -> str:
    """A stemless, pebble-shaped in-ear bud with its silicone ear tip on one side."""
    tx, ty = cx + tip_side * r * 0.78, cy - r * 0.5
    tilt = -12 * tip_side
    shell = (
        f'<ellipse cx="{cx}" cy="{cy}" rx="{r * 1.1:.1f}" ry="{r * 0.9:.1f}" '
        f'fill="url(#budshell)" transform="rotate({tilt} {cx} {cy})"/>'
    )
    tip = (
        f'<ellipse cx="{tx:.1f}" cy="{ty:.1f}" rx="{r * 0.5:.1f}" ry="{r * 0.42:.1f}" '
        f'fill="url(#tip)" transform="rotate({tilt * 2} {tx:.1f} {ty:.1f})"/>'
    )
    px, py = cx - tip_side * r * 0.06, cy + r * 0.02
    return f"""
{lit(tip)}
<ellipse cx="{tx + tip_side * r * 0.14:.1f}" cy="{ty - r * 0.06:.1f}" rx="{r * 0.17:.1f}" ry="{r * 0.13:.1f}" fill="#3a3c42"/>
{lit(shell)}
<ellipse cx="{px:.1f}" cy="{py:.1f}" rx="{r * 0.62:.1f}" ry="{r * 0.5:.1f}" fill="url(#pad)" stroke="#8a8d95" stroke-opacity=".35" stroke-width="1.5" transform="rotate({tilt} {px:.1f} {py:.1f})"/>
<path d="M{cx - r * 0.82:.1f} {cy - r * 0.1:.1f} A{r * 0.9:.1f} {r * 0.75:.1f} 0 0 1 {cx - r * 0.2:.1f} {cy - r * 0.74:.1f}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>
"""


def earbuds() -> Drawing:
    defs = flat("stone", "#f1eee9", "#b7b1a7") + flat("charcoal", "#55585f", "#24262b")
    defs += lin("tip", (0, "#b8bbc2"), (1, "#767981"))
    defs += flat("budshell", "#5d6068", "#1f2125") + flat("pad", "#4a4d55", "#2c2e33")
    defs += (
        '<pattern id="weave" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">'
        '<path d="M0 0 V5" stroke="#fff" stroke-opacity=".06" stroke-width="2"/></pattern>'
    )
    # A wide, low case: matte stone base with a fabric-wrapped charcoal lid.
    body = f"""
{lit('<rect x="186" y="328" width="320" height="134" rx="46" fill="url(#stone)"/>')}
<clipPath id="lidclip"><rect x="186" y="328" width="320" height="134" rx="46"/></clipPath>
<g clip-path="url(#lidclip)">
<rect x="186" y="328" width="320" height="58" fill="url(#charcoal)"/>
<rect x="186" y="328" width="320" height="58" fill="url(#weave)"/>
<rect x="186" y="384" width="320" height="3" fill="#1b1c20" opacity=".55"/>
</g>
<rect x="326" y="420" width="40" height="5" rx="2.5" fill="#8a857c" opacity=".55"/>
<circle cx="480" cy="422" r="3.5" fill="#6fbf86"/>
<path d="M214 352 C220 340 232 334 248 333" stroke="#fff" stroke-opacity=".35" stroke-width="4" fill="none" stroke-linecap="round"/>
{_bud(522, 422, 44, -1)}
{_bud(610, 431, 34, 1)}
"""
    return Drawing(defs, body, (186, 328, 654, 462), footprint=0.9)


def turntable() -> Drawing:
    defs = flat("wood", "#9a6b48", "#4f3322") + rad("vinyl", (0, "#3a3a3e"), (1, "#0c0c0e"))
    defs += lin("plinth", (0, "#5e3d28"), (1, "#2e1d12"))
    grooves = "".join(
        f'<circle cx="350" cy="330" r="{r}" fill="none" stroke="#4a4a50" stroke-width="1" opacity=".7"/>'
        for r in range(46, 118, 9)
    )
    plan = f"""
{lit('<rect x="196" y="214" width="408" height="236" rx="22" fill="url(#wood)"/>')}
<circle cx="350" cy="330" r="124" fill="url(#alu)"/>
<circle cx="350" cy="330" r="118" fill="url(#vinyl)"/>
{grooves}
<circle cx="350" cy="330" r="34" fill="#b44a3f"/>
<circle cx="350" cy="330" r="5" fill="#e6e6ea"/>
<path d="M296 262 A82 82 0 0 1 384 250" stroke="#fff" stroke-opacity=".16" stroke-width="12" fill="none"/>
<circle cx="540" cy="256" r="20" fill="url(#alu)"/><circle cx="540" cy="256" r="7" fill="#8e9097"/>
<path d="M540 256 L520 380 L452 396" fill="none" stroke="#dcdde1" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="428" y="384" width="34" height="22" rx="4" fill="#2a2a2e" transform="rotate(-14 445 395)"/>
<circle cx="562" cy="414" r="8" fill="url(#alu)"/>
"""
    depth = 34
    slab = lit('<rect x="196" y="214" width="408" height="236" rx="22" fill="url(#plinth)"/>')
    base = 214 + 236 * FORESHORTEN + depth
    body = f"""
{from_above(plan, 214, depth, slab)}
<rect x="216" y="{_n(base - 4)}" width="40" height="12" rx="4" fill="#2b1a10"/>
<rect x="544" y="{_n(base - 4)}" width="40" height="12" rx="4" fill="#2b1a10"/>
"""
    return Drawing(defs, body, (196, 214, 604, base + 8), footprint=0.95)


# --------------------------------------------------------------------------------------
# Wearables
# --------------------------------------------------------------------------------------
def smartwatch() -> Drawing:
    defs = cyl("strap", "#575d6b", "#3a3f4b", "#1c1f26") + rad(
        "screen", (0, "#20232b"), (1, "#050507")
    )
    body = f"""
{lit('<rect x="338" y="120" width="124" height="150" rx="26" fill="url(#strap)"/>')}
{lit('<rect x="338" y="330" width="124" height="140" rx="26" fill="url(#strap)"/>')}
<circle cx="400" cy="440" r="6" fill="#121418"/><circle cx="400" cy="416" r="6" fill="#121418"/>
{lit('<rect x="312" y="196" width="176" height="208" rx="54" fill="url(#alu)"/>')}
<rect x="486" y="262" width="14" height="44" rx="7" fill="url(#alu)"/>
<rect x="326" y="210" width="148" height="180" rx="44" fill="url(#screen)"/>
{dial()}
<path d="M340 238 C350 224 368 216 388 215" stroke="#fff" stroke-opacity=".22" stroke-width="5" fill="none" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (312, 120, 500, 470), footprint=0.62)


def dial() -> str:
    """A plain analog watch face: twelve indices, two hands and a seconds hand."""
    ticks = "".join(
        f'<rect x="398.5" y="{232 if i % 3 == 0 else 236}" width="3" height="{14 if i % 3 == 0 else 8}" '
        f'rx="1.5" fill="#e9eaee" opacity="{1 if i % 3 == 0 else 0.55}" transform="rotate({i * 30} 400 300)"/>'
        for i in range(12)
    )
    return (
        f"{ticks}"
        '<rect x="397" y="262" width="6" height="42" rx="3" fill="#f2f2f4" transform="rotate(-50 400 300)"/>'
        '<rect x="397.5" y="244" width="5" height="60" rx="2.5" fill="#f2f2f4" transform="rotate(64 400 300)"/>'
        '<rect x="399.2" y="240" width="1.6" height="72" rx=".8" fill="#e07a4a" transform="rotate(152 400 300)"/>'
        '<circle cx="400" cy="300" r="5" fill="#f2f2f4"/><circle cx="400" cy="300" r="2.2" fill="#e07a4a"/>'
    )


def fitness_band() -> Drawing:
    """The loop seen from ~30 degrees above: a short open cylinder with its tracker in front."""
    cx, cy, rx, ry, height, wall = 400, 300, 200, 86, 46, 12
    irx, iry = rx - wall, ry - wall * ry / rx
    defs = cyl("bandw", "#e2a1aa", "#c46f7c", "#87394a")
    defs += lin("bandi", (0, "#7c3343"), (1, "#b0606f"))
    defs += flat("pod", "#43464f", "#121318")
    defs += (
        f'<clipPath id="toph"><ellipse cx="{cx}" cy="{cy}" rx="{irx}" ry="{iry:.1f}"/></clipPath>'
        f'<mask id="loop" maskUnits="userSpaceOnUse" x="0" y="0" width="800" height="600">'
        f'<rect width="800" height="600" fill="#fff"/>'
        f'<ellipse cx="{cx}" cy="{cy + height}" rx="{irx}" ry="{iry:.1f}" fill="#000" clip-path="url(#toph)"/>'
        f"</mask>"
    )
    silhouette = (
        f'<path d="M{cx - rx} {cy} A{rx} {ry} 0 0 1 {cx + rx} {cy} V{cy + height} '
        f'A{rx} {ry} 0 0 1 {cx - rx} {cy + height} Z" fill="url(#bandw)"/>'
    )
    body = f"""
<g mask="url(#loop)">
{lit(silhouette)}
<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#e6b0b8"/>
<ellipse cx="{cx}" cy="{cy}" rx="{irx}" ry="{iry:.1f}" fill="url(#bandi)"/>
<path d="M{cx - rx + 2} {cy + height / 2} A{rx - 2} {ry} 0 0 0 {cx + rx - 2} {cy + height / 2}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2" stroke-dasharray="30 22"/>
</g>
{lit('<rect x="326" y="368" width="148" height="70" rx="32" fill="url(#pod)"/>')}
<rect x="338" y="380" width="124" height="46" rx="23" fill="#0d0e12" stroke="#3a3d46" stroke-width="2"/>
<path d="M356 404 h12 l7 -12 l9 22 l7 -10 h16" fill="none" stroke="#6fd093" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="418" y="394" width="26" height="5" rx="2.5" fill="#6fd093" opacity=".8"/>
<rect x="418" y="406" width="17" height="5" rx="2.5" fill="#6fd093" opacity=".45"/>
<path d="M342 376 C352 371 364 370 378 370" stroke="#fff" stroke-opacity=".35" stroke-width="3.5" fill="none" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (200, 214, 600, 438), footprint=0.78)


def sunglasses() -> Drawing:
    defs = lin("lens", (0, "#4a5262"), (0.55, "#20242d"), (1, "#0e1015"), x2=0.4, y2=1)
    defs += flat("frame", "#8a5634", "#3a2114")
    body = f"""
<path d="M196 262 L150 236" stroke="#4d2c1a" stroke-width="13" stroke-linecap="round"/>
<path d="M604 262 L650 236" stroke="#4d2c1a" stroke-width="13" stroke-linecap="round"/>
{lit('<path d="M202 252 Q300 232 372 256 Q382 344 318 384 Q238 400 214 346 Q196 300 202 252 Z" fill="url(#lens)" stroke="url(#frame)" stroke-width="15" stroke-linejoin="round"/>')}
{lit('<path d="M598 252 Q500 232 428 256 Q418 344 482 384 Q562 400 586 346 Q604 300 598 252 Z" fill="url(#lens)" stroke="url(#frame)" stroke-width="15" stroke-linejoin="round"/>')}
<path d="M372 262 Q400 240 428 262" fill="none" stroke="url(#frame)" stroke-width="13" stroke-linecap="round"/>
<path d="M232 278 Q268 264 306 268 L248 346 Q226 318 232 278 Z" fill="#fff" opacity=".13"/>
<path d="M458 278 Q496 264 536 268 L476 346 Q454 318 458 278 Z" fill="#fff" opacity=".13"/>
<path d="M214 258 Q290 240 360 258" stroke="#d7a27a" stroke-opacity=".55" stroke-width="3" fill="none" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (143, 229, 657, 395), footprint=0.66)


# --------------------------------------------------------------------------------------
# Home & living
# --------------------------------------------------------------------------------------
def lamp() -> Drawing:
    defs = rad("globe", (0, "#fffdf7"), (0.55, "#f8ebcd"), (1, "#dcc08a"), cx=0.4, cy=0.36)
    defs += cyl("brass", "#f0d89c", "#c9a560", "#8a6430")
    defs += lin("base", (0, "#e2c482"), (1, "#7c5a2a"))
    body = f"""
{lit('<circle cx="400" cy="236" r="104" fill="url(#globe)"/>')}
<ellipse cx="364" cy="194" rx="30" ry="19" fill="#fff" opacity=".7"/>
<rect x="388" y="336" width="24" height="98" rx="8" fill="url(#brass)"/>
<rect x="370" y="326" width="60" height="18" rx="9" fill="url(#brass)"/>
{lit('<ellipse cx="400" cy="452" rx="96" ry="20" fill="url(#base)"/>')}
{lit('<rect x="304" y="432" width="192" height="20" rx="10" fill="url(#brass)"/>')}
"""
    return Drawing(defs, body, (296, 132, 504, 472), footprint=0.85)


def _mug(x: int, gid: str, glaze: str, rim: str, *, flip: bool = False) -> str:
    # The handle springs from the mug wall: the right wall, or the left one when flipped.
    wall = x + 4 if flip else x + 164
    reach = wall - 62 if flip else wall + 62
    handle = (
        f'<path d="M{wall} 300 C{reach} 300 {reach} 390 {wall} 390" '
        f'fill="none" stroke="url(#{gid})" stroke-width="22" stroke-linecap="round"/>'
    )
    body = f'<path d="M{x} 250 h168 v168 q0 44 -44 44 h-80 q-44 0 -44 -44 Z" fill="url(#{gid})"/>'
    return f"""
{lit(handle)}
{lit(body)}
<path d="M{x} 262 q20 28 40 4 q20 30 44 2 q24 28 44 0 q22 26 40 0 v-12 h-168 Z" fill="{glaze}" opacity=".92"/>
<ellipse cx="{x + 84}" cy="250" rx="84" ry="17" fill="{rim}"/>
<ellipse cx="{x + 84}" cy="252" rx="72" ry="11" fill="#2f1d12"/>
<path d="M{x + 18} 298 v110" stroke="#fff" stroke-opacity=".22" stroke-width="9" stroke-linecap="round"/>
"""


def mug_set() -> Drawing:
    defs = cyl("terra", "#d9906e", "#bb6a49", "#7f3a22") + cyl(
        "sage", "#bcd0b9", "#93b190", "#5a7a5d"
    )
    body = _mug(178, "terra", "#f1d9c8", "#b9694a", flip=True) + _mug(
        452, "sage", "#eef3ec", "#88a586"
    )
    return Drawing(defs, body, (125, 233, 674, 462), footprint=0.9)


def planter() -> Drawing:
    defs = cyl("pot", "#d78c69", "#b8673f", "#7d3a1d")
    defs += lin("leaf", (0, "#8db884"), (1, "#3f6a3d"), x2=1, y2=1)
    defs += '<ellipse id="lf" rx="18" ry="7" fill="url(#leaf)"/>'
    leaves = ""
    stems = [
        (-62, 170),
        (-38, 200),
        (-14, 215),
        (12, 210),
        (36, 195),
        (60, 165),
        (-80, 130),
        (80, 130),
    ]
    for angle, length in stems:
        leaflets = "".join(
            f'<use href="#lf" transform="translate({side * 16} {-t}) rotate({side * -35})"/>'
            for t in range(36, length - 10, 22)
            for side in (-1, 1)
        )
        leaves += (
            f'<g transform="translate(400 300) rotate({angle})">'
            f'<path d="M0 0 V{-length}" stroke="#3f6a3a" stroke-width="4"/>{leaflets}</g>'
        )
    body = f"""
{leaves}
{lit('<path d="M300 300 h200 l-22 160 q-4 16 -20 16 h-116 q-16 0 -20 -16 Z" fill="url(#pot)"/>')}
{lit('<rect x="286" y="286" width="228" height="40" rx="10" fill="url(#pot)"/>')}
<rect x="290" y="288" width="220" height="9" rx="4.5" fill="#f0b496" opacity=".45"/>
<path d="M326 340 l12 108" stroke="#fff" stroke-opacity=".18" stroke-width="11" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (232, 80, 562, 476), footprint=0.42)


def candle() -> Drawing:
    defs = lin(
        "jar", (0, "#e7b06a"), (0.25, "#f2c88a"), (0.65, "#c88843"), (1, "#7d4a1d"), x2=1, y2=0
    )
    defs += lin("wax", (0, "#fffaf0"), (1, "#f0dfb8"))
    defs += (
        '<radialGradient id="flame" cx="0.5" cy="0.72" r="0.6"><stop offset="0" stop-color="#fffbe9"/>'
        '<stop offset="0.5" stop-color="#f9cf6a"/><stop offset="1" stop-color="#ec8a3a"/></radialGradient>'
    )
    body = f"""
<path d="M400 168 C384 196 384 224 400 236 C416 224 416 196 400 168 Z" fill="url(#flame)"/>
<path d="M400 236 v24" stroke="#2a2522" stroke-width="4" stroke-linecap="round"/>
{lit('<rect x="296" y="250" width="208" height="214" rx="30" fill="url(#jar)" opacity=".96"/>')}
<rect x="306" y="262" width="188" height="38" rx="17" fill="url(#wax)"/>
<rect x="322" y="330" width="156" height="90" rx="8" fill="#f3ebdc"/>
<rect x="346" y="358" width="108" height="5" rx="2.5" fill="#a88b62" opacity=".55"/>
<rect x="364" y="374" width="72" height="4" rx="2" fill="#a88b62" opacity=".35"/>
<rect x="346" y="390" width="108" height="1.5" fill="#a88b62" opacity=".4"/>
<path d="M316 292 v150" stroke="#fff" stroke-opacity=".32" stroke-width="10" stroke-linecap="round"/>
<path d="M484 300 v130" stroke="#fff" stroke-opacity=".12" stroke-width="5" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (296, 168, 504, 464), footprint=0.82)


# --------------------------------------------------------------------------------------
# Workspace
# --------------------------------------------------------------------------------------
def keyboard() -> Drawing:
    defs = flat("case", "#62666f", "#25272c") + lin("kc", (0, "#fbfbfc"), (1, "#d3d5db"))
    defs += lin("acc", (0, "#80b8af"), (1, "#3f7b72"))
    defs += (
        '<filter id="keyshade" x="-2%" y="-2%" width="104%" height="108%">'
        '<feDropShadow dx="0" dy="2.5" stdDeviation="0.6" flood-color="#000" flood-opacity=".45"/></filter>'
    )
    keys = []
    rows = [(14, 0), (14, 6), (13, 12), (12, 20)]
    unit, gap, x0, y0 = 28, 6, 165, 234
    for r, (count, offset) in enumerate(rows):
        for c in range(count):
            accent = (r == 0 and c == 0) or (r == 2 and c == count - 1)
            keys.append(
                f'<rect x="{x0 + offset + c * (unit + gap)}" y="{y0 + r * (unit + gap)}" '
                f'width="{unit}" height="{unit}" rx="6" fill="url(#{"acc" if accent else "kc"})"/>'
            )
    bottom = y0 + 4 * (unit + gap)
    for c in range(3):
        keys.append(
            f'<rect x="{x0 + c * 34}" y="{bottom}" width="{unit}" height="{unit}" rx="6" fill="url(#kc)"/>'
        )
    keys.append(
        f'<rect x="{x0 + 102}" y="{bottom}" width="232" height="{unit}" rx="6" fill="url(#kc)"/>'
    )
    for c in range(4):
        keys.append(
            f'<rect x="{x0 + 340 + c * 34}" y="{bottom}" width="{unit}" height="{unit}" rx="6" fill="url(#kc)"/>'
        )
    plan = f"""
{lit('<rect x="140" y="208" width="520" height="210" rx="24" fill="url(#case)"/>')}
<rect x="150" y="213" width="500" height="4" rx="2" fill="#fff" opacity=".22"/>
<g filter="url(#keyshade)">{"".join(keys)}</g>
<circle cx="636" cy="224" r="4" fill="#80b8af"/>
"""
    defs += lin("caseside", (0, "#3b3e45"), (1, "#16171b"))
    slab = '<rect x="140" y="208" width="520" height="210" rx="24" fill="url(#caseside)"/>'
    depth = 26
    body = from_above(plan, 208, depth, lit(slab))
    return Drawing(defs, body, (140, 208, 660, 208 + 210 * FORESHORTEN + depth), footprint=0.95)


def mouse() -> Drawing:
    defs = flat("shell", "#ffffff", "#d3d6dd") + cyl("side", "#a9cdc7", "#6fa199", "#3f6e67")
    outline = (
        "M400 150 C490 150 520 230 520 320 C520 420 470 470 400 470 "
        "C330 470 280 420 280 320 C280 230 310 150 400 150 Z"
    )
    plan = f"""
{lit(f'<path d="{outline}" fill="url(#side)"/>')}
{lit('<path d="M400 158 C478 158 506 230 506 316 C506 410 462 456 400 456 C338 456 294 410 294 316 C294 230 322 158 400 158 Z" fill="url(#shell)"/>')}
<path d="M400 160 V286" stroke="#a7abb5" stroke-width="2.5"/>
<path d="M298 286 C340 296 460 296 502 286" fill="none" stroke="#c9ccd4" stroke-width="2.5"/>
<rect x="388" y="196" width="24" height="54" rx="12" fill="#30333b"/>
<rect x="394" y="206" width="12" height="14" rx="6" fill="#5c606b"/>
<path d="M324 222 C334 192 354 176 378 170" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round" opacity=".85"/>
"""
    # Seen from the front and above: a low teal skirt shows below the white shell. A mouse is
    # small in life, so it carries less visual mass than the keyboard beside it in the store.
    depth = 24
    body = from_above(plan, 150, depth, lit(f'<path d="{outline}" fill="url(#side)"/>'))
    return Drawing(
        defs, body, (280, 150, 520, 150 + 320 * FORESHORTEN + depth), footprint=0.72, mass=0.62
    )


def notebook() -> Drawing:
    defs = flat("cover", "#7ea39d", "#3a5e59")
    defs += (
        '<pattern id="linen" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
        '<path d="M0 0 V6" stroke="#fff" stroke-opacity=".07" stroke-width="2"/></pattern>'
    )
    body = f"""
<g transform="rotate(-6 400 320)">
<rect x="270" y="166" width="276" height="326" rx="14" fill="#efede8"/>
<path d="M546 180 v296" stroke="#d6d2c9" stroke-width="2"/>
{lit('<rect x="262" y="160" width="276" height="326" rx="14" fill="url(#cover)"/>')}
<rect x="262" y="160" width="276" height="326" rx="14" fill="url(#linen)"/>
<rect x="262" y="160" width="24" height="326" rx="10" fill="#1f3b37" opacity=".38"/>
<rect x="486" y="160" width="13" height="326" fill="#17191d" opacity=".8"/>
<rect x="330" y="230" width="140" height="56" rx="6" fill="#f6f4ef" opacity=".94"/>
<rect x="348" y="248" width="104" height="5" rx="2.5" fill="#3a5e59" opacity=".5"/>
<rect x="348" y="263" width="70" height="5" rx="2.5" fill="#3a5e59" opacity=".3"/>
<path d="M440 486 v22 l13 -9 l13 9 v-22" fill="#c99543"/>
</g>
"""
    return Drawing(defs, body, (246, 146, 567, 516), footprint=0.62)


def laptop_stand() -> Drawing:
    defs = lin("screen", (0, "#7fb4b4"), (1, "#2f6870"), x2=1, y2=1) + flat(
        "lid", "#4b4f58", "#1f2126"
    )
    body = f"""
{lit('<path d="M300 352 L272 462 H300 L330 352 Z" fill="url(#alu)"/>')}
{lit('<path d="M500 352 L528 462 H500 L470 352 Z" fill="url(#alu)"/>')}
<rect x="286" y="404" width="228" height="11" rx="5.5" fill="#a3a6ad"/>
<rect x="256" y="458" width="76" height="12" rx="6" fill="#7c8088"/>
<rect x="468" y="458" width="76" height="12" rx="6" fill="#7c8088"/>
{lit('<rect x="262" y="336" width="276" height="20" rx="8" fill="url(#alu)"/>')}
{lit('<rect x="268" y="150" width="264" height="174" rx="14" fill="url(#lid)"/>')}
<rect x="280" y="162" width="240" height="150" rx="5" fill="url(#screen)"/>
<path d="M280 262 C330 232 370 280 420 248 C460 222 492 238 520 224 V312 H280 Z" fill="#163f45" opacity=".5"/>
<path d="M280 290 C340 270 400 300 460 282 C488 274 506 280 520 276 V312 H280 Z" fill="#0f2e33" opacity=".45"/>
<path d="M290 166 L400 166 L300 306 L290 306 Z" fill="#fff" opacity=".07"/>
{lit('<path d="M228 330 H572 L556 346 H244 Z" fill="url(#alu)"/>')}
<rect x="372" y="330" width="56" height="4" rx="2" fill="#7c8088" opacity=".5"/>
"""
    return Drawing(defs, body, (228, 150, 572, 470), footprint=0.85)


# --------------------------------------------------------------------------------------
# Travel & outdoor
# --------------------------------------------------------------------------------------
def daypack() -> Drawing:
    defs = cyl("pack", "#7ea4c4", "#4f7ca3", "#284d6c") + cyl(
        "pocket", "#6d94b6", "#456f94", "#223f58"
    )
    body = f"""
<path d="M372 140 C372 110 428 110 428 140" fill="none" stroke="#24384b" stroke-width="13" stroke-linecap="round"/>
{lit('<path d="M290 220 C290 160 330 140 400 140 C470 140 510 160 510 220 V440 Q510 476 474 476 H326 Q290 476 290 440 Z" fill="url(#pack)"/>')}
<path d="M300 200 C330 172 470 172 500 200" fill="none" stroke="#1d3347" stroke-width="4" stroke-dasharray="2 7" stroke-linecap="round"/>
{lit('<rect x="318" y="330" width="164" height="124" rx="30" fill="url(#pocket)"/>')}
<path d="M332 352 H468" stroke="#d5e2ee" stroke-width="3" stroke-linecap="round" opacity=".7"/>
<rect x="452" y="344" width="9" height="24" rx="4.5" fill="#c99a4b"/>
<rect x="368" y="242" width="64" height="40" rx="9" fill="#5a4636"/>
<rect x="374" y="248" width="52" height="28" rx="6" fill="none" stroke="#c9b49a" stroke-width="1.5" stroke-dasharray="3 3" opacity=".7"/>
<path d="M306 236 V420" stroke="#fff" stroke-opacity=".2" stroke-width="10" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (290, 111, 510, 476), footprint=0.82)


def bottle() -> Drawing:
    defs = cyl("coat", "#7aa6c6", "#47789c", "#22455f") + cyl(
        "cap", "#6a6e78", "#3b3e46", "#16171b"
    )
    body = f"""
<path d="M372 112 C372 90 428 90 428 112" fill="none" stroke="#2a2c32" stroke-width="10"/>
<rect x="366" y="112" width="68" height="20" rx="8" fill="#2a2c32"/>
{lit('<rect x="348" y="128" width="104" height="64" rx="14" fill="url(#cap)"/>')}
<rect x="350" y="188" width="100" height="10" rx="3" fill="url(#alu)"/>
{lit('<path d="M350 198 C350 216 330 222 330 250 V440 Q330 474 364 474 H436 Q470 474 470 440 V250 C470 222 450 216 450 198 Z" fill="url(#coat)"/>')}
<path d="M352 238 V440" stroke="#fff" stroke-opacity=".3" stroke-width="11" stroke-linecap="round"/>
<path d="M446 248 V430" stroke="#fff" stroke-opacity=".1" stroke-width="5" stroke-linecap="round"/>
"""
    return Drawing(defs, body, (330, 91, 470, 474), footprint=0.82)


def camera() -> Drawing:
    defs = flat("body", "#ffffff", "#d2d5dc") + rad(
        "lens", (0, "#4b5160"), (1, "#05060a"), cx=0.38, cy=0.32
    )
    defs += lin("stripe", (0, "#d9844e"), (1, "#dcb85a"), x2=1, y2=0)
    defs += lin("photo", (0, "#bcd6e6"), (1, "#7fa7c0"))
    body = f"""
<g transform="rotate(-8 445 186)">
<rect x="350" y="150" width="190" height="72" rx="6" fill="#fbfbfc" stroke="#dfe1e6" stroke-width="2"/>
<rect x="364" y="160" width="160" height="52" rx="3" fill="url(#photo)"/>
<path d="M376 206 l40 -28 l26 16 l30 -22 l44 30 v4 h-140 Z" fill="#4f7d98" opacity=".75"/>
</g>
{lit('<rect x="230" y="200" width="340" height="250" rx="44" fill="url(#body)"/>')}
<rect x="230" y="372" width="340" height="14" fill="url(#stripe)"/>
<rect x="268" y="226" width="64" height="40" rx="10" fill="#22252c"/>
<rect x="276" y="234" width="48" height="24" rx="6" fill="#3a3e48"/>
<rect x="470" y="226" width="64" height="30" rx="8" fill="#e6e8ec" stroke="#cdd0d7" stroke-width="2"/>
<circle cx="400" cy="312" r="86" fill="url(#alu)"/>
<circle cx="400" cy="312" r="72" fill="url(#lens)"/>
<circle cx="400" cy="312" r="44" fill="none" stroke="#5c6270" stroke-width="2.5" opacity=".6"/>
<circle cx="400" cy="312" r="22" fill="#07080c"/>
<ellipse cx="378" cy="290" rx="14" ry="11" fill="#fff" opacity=".3"/>
<circle cx="532" cy="420" r="10" fill="#c9503f"/>
<path d="M248 236 C254 220 266 210 282 206" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" opacity=".9"/>
"""
    return Drawing(defs, body, (230, 137, 570, 450), footprint=0.9)


ARTWORK: dict[str, Callable[[], Drawing]] = {
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
        (OUT / f"{slug}.svg").write_text(frame(draw()), encoding="utf-8")
    print(f"Wrote {len(ARTWORK)} illustrations to {OUT}")


if __name__ == "__main__":
    main()
