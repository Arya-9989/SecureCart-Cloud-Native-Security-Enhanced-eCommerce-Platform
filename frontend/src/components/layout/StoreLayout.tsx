import { ChevronDown } from "lucide-react";
import { Link, Outlet } from "react-router";

import { useCategories } from "@/hooks/queries";
import { FLAT_SHIPPING_FEE, FREE_SHIPPING_FROM, STORE_RULES } from "@/lib/storeRules";

import { Header } from "./Header";

const REPO_URL =
  "https://github.com/Arya-9989/SecureCart-Cloud-Native-Security-Enhanced-eCommerce-Platform";

/**
 * Footer column. Phones get Apple's pattern: each column is a 44px disclosure row, so every
 * link is a full-width touch target instead of a 15px line of text. Wider screens show the
 * columns open, with links spaced to at least 24px (WCAG 2.5.8).
 */
function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  const list = <ul className="pb-2 sm:mt-2 sm:pb-0">{children}</ul>;
  return (
    <div className="border-b border-line-strong/60 sm:border-0">
      <details className="group sm:hidden">
        <summary className="flex h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
          {title}
          <ChevronDown
            className="size-4 text-muted transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        {list}
      </details>
      <div className="hidden sm:block">
        <h2 className="text-[12px] font-semibold text-fg">{title}</h2>
        {list}
      </div>
    </div>
  );
}

const footerLink =
  "flex min-h-11 items-center text-[14px] text-muted transition-colors hover:text-fg hover:underline underline-offset-2 sm:inline-flex sm:min-h-7 sm:text-[12px]";

function Footer() {
  const { data: categories } = useCategories();
  return (
    <footer className="bg-surface-2 text-[12px] leading-[1.35] text-muted">
      <div className="container-text py-5">
        <div className="space-y-2 border-b border-line-strong/60 pb-4">
          <p>
            SecureCart is a portfolio demonstration store. Checkout uses a mock payment provider, so
            no card details are collected and no real money moves.
          </p>
          <p>
            Free shipping applies to orders of {FREE_SHIPPING_FROM} or more; below that, shipping is
            a flat {FLAT_SHIPPING_FEE}. Estimated tax is {STORE_RULES.taxPercent}% of the subtotal.
            Orders can be cancelled until they ship.
          </p>
        </div>
        <div className="py-2 sm:grid sm:grid-cols-4 sm:gap-8 sm:py-6">
          <FooterColumn title="Shop">
            <li>
              <Link className={footerLink} to="/shop">
                All products
              </Link>
            </li>
            {categories?.map((category) => (
              <li key={category.id}>
                <Link className={footerLink} to={`/shop?category=${category.slug}`}>
                  {category.name}
                </Link>
              </li>
            ))}
          </FooterColumn>
          <FooterColumn title="Account">
            <li>
              <Link className={footerLink} to="/orders">
                Orders
              </Link>
            </li>
            <li>
              <Link className={footerLink} to="/cart">
                Bag
              </Link>
            </li>
            <li>
              <Link className={footerLink} to="/login">
                Sign in
              </Link>
            </li>
          </FooterColumn>
          <FooterColumn title="Trust">
            <li>
              <Link className={footerLink} to="/protection">
                How your order is protected
              </Link>
            </li>
            <li>
              <a className={footerLink} href="/api/docs/">
                API documentation
              </a>
            </li>
          </FooterColumn>
          <FooterColumn title="About">
            <li>
              <a className={footerLink} href={REPO_URL} rel="noreferrer">
                Source code
              </a>
            </li>
            <li>
              <a className={footerLink} href={`${REPO_URL}/blob/main/LICENSE`} rel="noreferrer">
                MIT License
              </a>
            </li>
          </FooterColumn>
        </div>
        <p className="border-t border-line-strong/60 pt-4">
          Copyright © {new Date().getFullYear()} SecureCart. A portfolio project by Arya
          Mahindrakar.
        </p>
      </div>
    </footer>
  );
}

export function StoreLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-action text-[14px] font-medium text-brand-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <Header />
      {/* At least a viewport tall, so the footer never starts on screen and then jumps down
          when data arrives (layout shift). */}
      <main id="main" className="min-h-[calc(100svh-48px)] flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
