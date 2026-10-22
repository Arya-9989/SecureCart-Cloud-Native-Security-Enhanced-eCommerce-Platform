import { clsx } from "clsx";
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  ShoppingBag,
  User as UserIcon,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { useCart } from "@/hooks/queries";
import { initials } from "@/lib/format";

import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

function SearchBox({ className, onDone }: { className?: string; onDone?: () => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [value, setValue] = useState(params.get("search") ?? "");
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const term = value.trim();
    void navigate(term ? `/shop?search=${encodeURIComponent(term)}` : "/shop");
    onDone?.();
  };
  return (
    <form role="search" onSubmit={submit} className={clsx("relative", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        placeholder="Search products"
        aria-label="Search products"
        maxLength={100}
        className="h-10 w-full rounded-xl border border-line bg-surface-2 pr-3 pl-10 text-sm text-fg transition placeholder:text-subtle focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/15 focus:outline-none"
      />
    </form>
  );
}

function AccountMenu() {
  const { user, isAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg transition hover:bg-surface-2";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-2 rounded-xl py-1.5 pr-2 pl-1.5 transition hover:bg-surface-2"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
          {initials(user.full_name)}
        </span>
        <span className="hidden max-w-28 truncate text-sm font-medium text-fg lg:block">
          {user.full_name.split(" ")[0]}
        </span>
        <ChevronDown className="size-4 text-subtle" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-60 animate-fade-in rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
          <div className="border-b border-line px-3 pt-2 pb-3">
            <p className="truncate text-sm font-semibold text-fg">{user.full_name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <div className="pt-1.5">
            <Link to="/orders" className={item}>
              <Package className="size-4 text-muted" aria-hidden /> My orders
            </Link>
            {isAdmin && (
              <Link to="/admin" className={item}>
                <LayoutDashboard className="size-4 text-muted" aria-hidden /> Admin dashboard
              </Link>
            )}
            <button
              type="button"
              className={item}
              onClick={() => {
                void logout();
              }}
            >
              <LogOut className="size-4 text-muted" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CartButton() {
  const { data } = useCart();
  const count = data?.item_count ?? 0;
  return (
    <Link
      to="/cart"
      className="relative flex size-10 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg"
      aria-label={count ? `Cart, ${count} items` : "Cart"}
    >
      <ShoppingBag className="size-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-fg ring-2 ring-surface">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  clsx(
    "rounded-lg px-3 py-2 text-sm font-medium transition",
    isActive ? "text-fg" : "text-muted hover:text-fg",
  );

export function Header() {
  const { status, isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md supports-[backdrop-filter]:bg-surface/75">
      <div className="container-page flex h-16 items-center gap-4">
        <button
          type="button"
          className="-ml-2 flex size-10 items-center justify-center rounded-xl text-muted hover:bg-surface-2 md:hidden"
          onClick={() => {
            setMobileOpen((v) => !v);
          }}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? (
            <X className="size-5" aria-hidden />
          ) : (
            <Menu className="size-5" aria-hidden />
          )}
        </button>
        <Logo />
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
          <NavLink to="/shop" className={navLink}>
            Shop
          </NavLink>
          <NavLink to="/shop?featured=true" className={() => navLink({ isActive: false })}>
            Featured
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={navLink}>
              Admin
            </NavLink>
          )}
        </nav>
        <SearchBox className="ml-auto hidden w-full max-w-xs md:block" />
        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <ThemeToggle />
          <CartButton />
          {status === "authenticated" ? (
            <AccountMenu />
          ) : status === "anonymous" ? (
            <Link
              to="/login"
              className="ml-1 inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold whitespace-nowrap text-brand-fg shadow-sm transition hover:bg-brand-hover sm:px-4"
            >
              <UserIcon className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Sign in</span>
            </Link>
          ) : (
            <span className="skeleton ml-1 h-10 w-24" aria-hidden />
          )}
        </div>
      </div>
      {mobileOpen && (
        <div id="mobile-nav" className="animate-fade-in border-t border-line md:hidden">
          <div className="container-page space-y-3 py-4">
            <SearchBox
              onDone={() => {
                setMobileOpen(false);
              }}
            />
            <nav aria-label="Mobile" className="grid gap-1">
              <Link
                to="/shop"
                className="rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-surface-2"
              >
                Shop all products
              </Link>
              <Link
                to="/shop?featured=true"
                className="rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-surface-2"
              >
                Featured
              </Link>
              {status === "authenticated" && (
                <Link
                  to="/orders"
                  className="rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-surface-2"
                >
                  My orders
                </Link>
              )}
              {isAdmin && (
                <Link
                  to="/admin"
                  className="rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-surface-2"
                >
                  Admin dashboard
                </Link>
              )}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
