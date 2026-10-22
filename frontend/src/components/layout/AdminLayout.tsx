import { clsx } from "clsx";
import {
  ArrowLeft,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Package,
  ScrollText,
  Store,
  Users,
} from "lucide-react";
import { Link, NavLink, Outlet } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { initials } from "@/lib/format";

import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/products", label: "Products", icon: Package, end: false },
  { to: "/admin/orders", label: "Orders", icon: ClipboardList, end: false },
  { to: "/admin/users", label: "Users", icon: Users, end: false },
  { to: "/admin/audit-log", label: "Audit log", icon: ScrollText, end: false },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <a
        href="#admin-main"
        className="sr-only z-50 rounded-lg bg-brand px-4 py-2 font-semibold text-brand-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 z-20 border-b border-line bg-surface lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center justify-between px-5">
          <Logo to="/admin" suffix="Admin" />
          <div className="lg:hidden">
            <ThemeToggle />
          </div>
        </div>
        <nav
          aria-label="Admin"
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-brand-soft text-brand"
                    : "text-muted hover:bg-surface-2 hover:text-fg",
                )
              }
            >
              <Icon className="size-4.5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 hidden border-t border-line p-4 lg:block">
          <Link
            to="/"
            className="mb-3 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted hover:text-fg"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to store
          </Link>
          <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
              {initials(user?.full_name ?? "")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg">{user?.full_name}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-fg"
              aria-label="Sign out"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="hidden h-16 items-center justify-end gap-2 border-b border-line bg-surface/70 px-8 backdrop-blur lg:flex">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <Store className="size-4" aria-hidden /> View storefront
          </Link>
          <ThemeToggle />
        </div>
        <main id="admin-main" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
