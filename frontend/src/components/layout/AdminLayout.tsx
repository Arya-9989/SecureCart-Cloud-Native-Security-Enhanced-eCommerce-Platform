import { clsx } from "clsx";
import {
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Package,
  ScrollText,
  Store,
  Users,
} from "lucide-react";
import { Link, NavLink, Outlet } from "react-router";

import { CommandPalette } from "@/components/admin/CommandPalette";
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
    <div className="min-h-screen bg-bg lg:grid lg:grid-cols-[240px_1fr]">
      <a
        href="#admin-main"
        className="sr-only z-50 rounded-full bg-action text-[14px] font-medium text-brand-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="z-20 border-b border-line bg-surface-2 lg:border-r lg:border-b-0">
        {/* The column fills the page; its content sticks to the viewport. */}
        <div className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <div className="flex h-14 items-center justify-between px-5">
            <Logo to="/admin" suffix="Admin" compact />
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
          </div>
          <nav
            aria-label="Admin"
            className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  clsx(
                    "flex shrink-0 items-center gap-3 rounded-[10px] px-3 py-2 text-[14px] transition-colors",
                    isActive
                      ? "bg-surface font-medium text-fg shadow-card"
                      : "text-fg/75 hover:bg-surface-3/60 hover:text-fg",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={clsx("size-[18px]", isActive ? "text-brand" : "text-muted")}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto hidden p-3 lg:block">
            <div className="flex items-center gap-3 rounded-[14px] p-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold text-fg">
                {initials(user?.full_name ?? "")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{user?.full_name}</p>
                <p className="truncate text-[12px] text-muted">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void logout();
                }}
                className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-fg"
                aria-label="Sign out"
              >
                <LogOut className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="glass sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line/60 px-4 sm:px-6 lg:px-10">
          <CommandPalette />
          <div className="ml-auto flex items-center">
            <Link
              to="/"
              className="hit hidden items-center gap-1.5 rounded-full px-3 py-2 text-[14px] text-fg/80 transition-colors hover:text-fg sm:inline-flex"
            >
              <Store className="size-4" aria-hidden /> Storefront
            </Link>
            <ThemeToggle className="hidden lg:flex" />
          </div>
        </div>
        <main
          id="admin-main"
          className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10"
        >
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
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.025em] sm:text-[40px]">
          {title}
        </h1>
        {description && <p className="mt-1.5 text-[17px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
