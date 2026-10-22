"""Demo catalog used by ``manage.py seed_demo``. Images are original SVGs in frontend/public."""

from __future__ import annotations

from typing import TypedDict


class DemoProduct(TypedDict):
    name: str
    sku: str
    category: str
    price: str
    stock: int
    featured: bool
    description: str


CATEGORIES: list[tuple[str, str, str]] = [
    ("Audio", "audio", "Headphones, earbuds and speakers tuned for everyday listening."),
    ("Wearables", "wearables", "Watches, bands and eyewear built for all-day comfort."),
    ("Home & Living", "home-living", "Lighting, ceramics and small comforts for your space."),
    ("Workspace", "workspace", "Tools for a focused, ergonomic desk setup."),
    ("Travel & Outdoor", "travel-outdoor", "Durable gear for commutes, trails and weekends away."),
]

PRODUCTS: list[DemoProduct] = [
    {
        "name": "Aurora Wireless Headphones",
        "sku": "AUD-AURORA",
        "category": "audio",
        "price": "189.00",
        "stock": 24,
        "featured": True,
        "description": "Over-ear headphones with adaptive noise cancellation, 40-hour battery "
        "life and memory-foam cushions wrapped in vegan leather.",
    },
    {
        "name": "Pulse Mini Speaker",
        "sku": "AUD-PULSE",
        "category": "audio",
        "price": "59.00",
        "stock": 40,
        "featured": False,
        "description": "A palm-sized Bluetooth speaker with surprisingly deep bass, IP67 water "
        "resistance and a braided carry loop.",
    },
    {
        "name": "Echo Studio Earbuds",
        "sku": "AUD-ECHO",
        "category": "audio",
        "price": "129.00",
        "stock": 3,
        "featured": False,
        "description": "True wireless earbuds with a pocketable charging case, multipoint "
        "pairing and a transparency mode for city walks.",
    },
    {
        "name": "Groove Desk Turntable",
        "sku": "AUD-GROOVE",
        "category": "audio",
        "price": "249.00",
        "stock": 8,
        "featured": False,
        "description": "Belt-driven turntable with a walnut plinth, built-in preamp and "
        "Bluetooth output for modern speakers.",
    },
    {
        "name": "Meridian Smartwatch",
        "sku": "WEA-MERIDIAN",
        "category": "wearables",
        "price": "229.00",
        "stock": 15,
        "featured": True,
        "description": "Always-on AMOLED display, heart-rate and sleep tracking, and a week of "
        "battery in a brushed aluminium case.",
    },
    {
        "name": "Stride Fitness Band",
        "sku": "WEA-STRIDE",
        "category": "wearables",
        "price": "49.00",
        "stock": 60,
        "featured": False,
        "description": "Lightweight activity band that counts steps, tracks workouts and "
        "nudges you to move, with a soft silicone strap.",
    },
    {
        "name": "Horizon Sunglasses",
        "sku": "WEA-HORIZON",
        "category": "wearables",
        "price": "89.00",
        "stock": 0,
        "featured": False,
        "description": "Polarised lenses in a lightweight acetate frame with UV400 protection "
        "and a recycled-felt case.",
    },
    {
        "name": "Halo Table Lamp",
        "sku": "HOM-HALO",
        "category": "home-living",
        "price": "74.00",
        "stock": 18,
        "featured": True,
        "description": "Dimmable LED lamp with a frosted glass globe and a warm 2700K glow, "
        "perfect for bedside or desk.",
    },
    {
        "name": "Terra Ceramic Mug Set",
        "sku": "HOM-TERRA",
        "category": "home-living",
        "price": "32.00",
        "stock": 50,
        "featured": False,
        "description": "Set of two stoneware mugs, hand-glazed in earthy tones. Dishwasher "
        "and microwave safe.",
    },
    {
        "name": "Fern Planter",
        "sku": "HOM-FERN",
        "category": "home-living",
        "price": "28.00",
        "stock": 4,
        "featured": False,
        "description": "Matte terracotta planter with a drainage tray, sized for ferns, "
        "pothos and other leafy friends.",
    },
    {
        "name": "Ember Soy Candle",
        "sku": "HOM-EMBER",
        "category": "home-living",
        "price": "22.00",
        "stock": 35,
        "featured": False,
        "description": "Hand-poured soy wax candle with notes of cedar, amber and smoked "
        "vanilla. Roughly 45 hours of burn time.",
    },
    {
        "name": "Keystone Mechanical Keyboard",
        "sku": "WRK-KEYSTONE",
        "category": "workspace",
        "price": "139.00",
        "stock": 20,
        "featured": True,
        "description": "75% hot-swappable keyboard with gasket mount, PBT keycaps and tactile "
        "switches. USB-C and Bluetooth.",
    },
    {
        "name": "Glide Wireless Mouse",
        "sku": "WRK-GLIDE",
        "category": "workspace",
        "price": "45.00",
        "stock": 30,
        "featured": False,
        "description": "Ergonomic mouse with a silent click, 4000 DPI sensor and a battery "
        "that lasts months on a single charge.",
    },
    {
        "name": "Folio Linen Notebook",
        "sku": "WRK-FOLIO",
        "category": "workspace",
        "price": "18.00",
        "stock": 80,
        "featured": False,
        "description": "A5 linen-bound notebook with 160 pages of dotted, fountain-pen "
        "friendly paper and a lay-flat binding.",
    },
    {
        "name": "Arc Laptop Stand",
        "sku": "WRK-ARC",
        "category": "workspace",
        "price": "64.00",
        "stock": 2,
        "featured": False,
        "description": "Anodised aluminium stand that lifts your screen to eye level and "
        "folds flat for travel.",
    },
    {
        "name": "Summit Daypack",
        "sku": "TRV-SUMMIT",
        "category": "travel-outdoor",
        "price": "98.00",
        "stock": 22,
        "featured": True,
        "description": "A 22L weather-resistant backpack with a padded laptop sleeve, hidden "
        "passport pocket and recycled nylon shell.",
    },
    {
        "name": "Tide Insulated Bottle",
        "sku": "TRV-TIDE",
        "category": "travel-outdoor",
        "price": "34.00",
        "stock": 45,
        "featured": False,
        "description": "Double-wall stainless steel bottle that keeps drinks cold for 24 hours "
        "or hot for 12. Leak-proof lid.",
    },
    {
        "name": "Nomad Instant Camera",
        "sku": "TRV-NOMAD",
        "category": "travel-outdoor",
        "price": "119.00",
        "stock": 9,
        "featured": False,
        "description": "Point-and-shoot instant camera with automatic exposure, a selfie "
        "mirror and a built-in flash.",
    },
]
