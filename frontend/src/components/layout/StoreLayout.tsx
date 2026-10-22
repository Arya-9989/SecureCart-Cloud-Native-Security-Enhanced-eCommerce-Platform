import { Link, Outlet } from "react-router";

import { useCategories } from "@/hooks/queries";

import { Header } from "./Header";

const REPO_URL =
  "https://github.com/Arya-9989/SecureCart-Cloud-Native-Security-Enhanced-eCommerce-Platform";

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[12px] font-semibold text-fg">{title}</h2>
      <ul className="mt-2.5 space-y-2 text-[12px]">{children}</ul>
    </div>
  );
}

const footerLink = "text-muted transition-colors hover:text-fg hover:underline underline-offset-2";

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
            Free shipping applies to orders of $75 or more; below that, shipping is a flat $6.99.
            Estimated tax is 8% of the subtotal. Orders can be cancelled until they ship.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 py-6 sm:grid-cols-4">
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
          Copyright © {new Date().getFullYear()} SecureCart. A portfolio project by Arya Shrikant
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
        className="sr-only z-50 rounded-full bg-action px-4 py-2 text-[14px] font-medium text-brand-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
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
