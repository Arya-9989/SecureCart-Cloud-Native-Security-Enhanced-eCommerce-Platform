import { Lock, ShieldCheck, Truck } from "lucide-react";
import { Link, Outlet } from "react-router";

import { useCategories } from "@/hooks/queries";

import { Header } from "./Header";
import { Logo } from "./Logo";

function Footer() {
  const { data: categories } = useCategories();
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="container-page grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            A security-first storefront demo: JWT sessions with rotating httpOnly refresh cookies,
            role-based access control and oversell-proof checkout.
          </p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-1.5 text-xs font-medium text-warning">
            <Lock className="size-3.5" aria-hidden />
            Demo store: payments use a mock provider. No real charges.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-fg">Shop</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link className="text-muted hover:text-fg" to="/shop">
                All products
              </Link>
            </li>
            {categories?.map((category) => (
              <li key={category.id}>
                <Link className="text-muted hover:text-fg" to={`/shop?category=${category.slug}`}>
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-fg">Account</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link className="text-muted hover:text-fg" to="/orders">
                Order history
              </Link>
            </li>
            <li>
              <Link className="text-muted hover:text-fg" to="/cart">
                Cart
              </Link>
            </li>
            <li>
              <a className="text-muted hover:text-fg" href="/api/docs/">
                API documentation
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="container-page flex flex-col gap-3 py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} SecureCart. MIT licensed portfolio project.</p>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden /> RBAC-protected API
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Truck className="size-3.5" aria-hidden /> Free shipping over $75
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function StoreLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-brand px-4 py-2 font-semibold text-brand-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
