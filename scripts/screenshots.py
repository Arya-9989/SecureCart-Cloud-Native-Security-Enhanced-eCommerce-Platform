"""Capture README screenshots from a running, seeded SecureCart instance.

Usage (with the stack running, e.g. `docker compose up`):

    pip install playwright && python -m playwright install chromium
    python scripts/screenshots.py --base-url http://localhost:8080

Images are written to docs/screenshots/. The script drives the real UI: it signs in with
the seed_demo accounts, adds items to the cart and places an order with the mock provider.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import Page, sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeout

OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
DESKTOP = {"width": 1440, "height": 900}
MOBILE = {"width": 390, "height": 844}


def settle(page: Page) -> None:
    page.wait_for_load_state("load")
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except PlaywrightTimeout:
        pass  # long-lived connections (e.g. a dev server's HMR socket) never go idle
    page.wait_for_timeout(500)


def shot(page: Page, name: str, *, full_page: bool = False) -> None:
    settle(page)
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=full_page)
    print(f"  saved {name}.png")


def login(page: Page, base: str, email: str, password: str) -> None:
    page.goto(f"{base}/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(lambda url: "/login" not in url)


def storefront(base: str, browser, dark: bool = False) -> None:  # type: ignore[no-untyped-def]
    scheme = "dark" if dark else "light"
    suffix = "-dark" if dark else ""
    ctx = browser.new_context(viewport=DESKTOP, color_scheme=scheme, device_scale_factor=1)
    page = ctx.new_page()
    page.goto(base)
    shot(page, f"home{suffix}")
    if dark:
        ctx.close()
        return
    page.goto(f"{base}/shop?category=audio")
    shot(page, "shop")
    page.goto(f"{base}/protection")
    shot(page, "protection", full_page=True)
    page.goto(f"{base}/products/aurora-wireless-headphones")
    shot(page, "product")
    page.goto(f"{base}/login")
    shot(page, "login")

    login(page, base, "maya@example.com", "SecureCart!Demo1")
    for slug in ("aurora-wireless-headphones", "halo-table-lamp"):
        page.goto(f"{base}/products/{slug}")
        page.get_by_role("button", name="Add to Bag").first.click()
        page.get_by_text("Added to bag").first.wait_for()
    page.goto(f"{base}/cart")
    shot(page, "cart")
    page.goto(f"{base}/checkout")
    page.get_by_label("Street address").fill("500 Congress Avenue")
    page.get_by_label("City").fill("Austin")
    page.get_by_label("Postal code").fill("78701")
    shot(page, "checkout")
    page.get_by_role("button", name="Place order", exact=False).click()
    page.wait_for_url("**/orders/**")
    shot(page, "order-confirmation")
    page.goto(f"{base}/orders")
    shot(page, "orders")
    ctx.close()


def mobile(base: str, browser) -> None:  # type: ignore[no-untyped-def]
    ctx = browser.new_context(viewport=MOBILE, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(base)
    shot(page, "mobile-home")
    page.goto(f"{base}/products/meridian-smartwatch")
    shot(page, "mobile-product")
    login(page, base, "admin@securecart.dev", "SecureCart!Admin1")
    page.goto(f"{base}/admin")
    shot(page, "mobile-admin")
    ctx.close()


def admin(base: str, browser, dark: bool = False) -> None:  # type: ignore[no-untyped-def]
    ctx = browser.new_context(viewport=DESKTOP, color_scheme="dark" if dark else "light")
    page = ctx.new_page()
    login(page, base, "admin@securecart.dev", "SecureCart!Admin1")
    page.goto(f"{base}/admin")
    page.get_by_text("Revenue, last 30 days").wait_for()
    shot(page, "admin-dashboard-dark" if dark else "admin-dashboard")
    if dark:
        ctx.close()
        return
    page.goto(f"{base}/admin/products")
    shot(page, "admin-products")
    page.get_by_role("button", name="Edit Keystone Mechanical Keyboard").click()
    shot(page, "admin-product-edit")
    # Real admin actions, so the audit log screenshot shows genuine entries.
    page.get_by_label("Stock").fill("18")
    page.get_by_role("button", name="Save changes").click()
    page.get_by_text("Product updated").first.wait_for()
    page.goto(f"{base}/admin/orders?status=paid")
    settle(page)
    page.locator("tbody button").first.click()
    page.get_by_role("button", name="Mark as shipped").wait_for()
    shot(page, "admin-order-detail")
    page.get_by_label("Note (optional, e.g. tracking number)").fill("UPS 1Z999AA10123456784")
    page.get_by_role("button", name="Mark as shipped").click()
    page.get_by_text("Shipped", exact=True).first.wait_for()
    page.keyboard.press("Escape")
    page.goto(f"{base}/admin/audit-log")
    shot(page, "admin-audit-log")
    ctx.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8080")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        storefront(base, browser)
        storefront(base, browser, dark=True)
        admin(base, browser)
        admin(base, browser, dark=True)
        mobile(base, browser)
        browser.close()


if __name__ == "__main__":
    main()
