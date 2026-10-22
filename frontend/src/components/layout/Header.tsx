import { clsx } from "clsx";
import {
  ArrowRight,
  CircleUserRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  ShieldCheck,
  ShoppingBag,
  UserRound,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Dialog, DropdownMenu, Popover } from "radix-ui";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { BagPanel } from "@/components/store/BagPanel";
import { useCart, useCategories } from "@/hooks/queries";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { onBagAdd } from "@/lib/bagCue";
import { initials } from "@/lib/format";
import { EASE_ENTRANCE, prefersReducedMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";

import { LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

// vaul is only needed on touch-sized screens, so it is not part of the desktop download.
const BagDrawer = lazy(() => import("@/components/store/BagDrawer"));

const iconButton =
  "relative flex size-11 items-center justify-center rounded-full text-fg/80 transition-colors hover:text-fg data-[state=open]:text-fg";
const panel =
  "z-50 rounded-[22px] border border-line bg-surface p-6 text-fg shadow-pop outline-none data-[state=open]:animate-slide-up";

function SearchForm({ onDone }: { onDone?: () => void }) {
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
    <form role="search" onSubmit={submit} className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-0 size-5 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        placeholder="Search SecureCart"
        aria-label="Search products"
        maxLength={100}
        className="h-12 w-full border-0 border-b border-line bg-transparent pr-2 pl-8 text-[20px] font-medium tracking-[-0.015em] text-fg placeholder:text-muted focus:border-brand focus:outline-none"
      />
    </form>
  );
}

function QuickLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { data: categories } = useCategories();
  const links = [
    { to: "/shop?featured=true", label: "Featured" },
    ...(categories ?? []).map((c) => ({ to: `/shop?category=${c.slug}`, label: c.name })),
    { to: "/protection", label: "How your order is protected" },
  ];
  return (
    <div className="mt-5">
      <p className="text-[12px] font-medium text-muted">Quick links</p>
      <ul className="mt-2 space-y-0.5">
        {links.map((link) => (
          <li key={link.to}>
            <Link
              to={link.to}
              onClick={onNavigate}
              className="group flex items-center gap-2 rounded-lg py-1.5 text-[15px] font-medium text-fg/85 transition-colors hover:text-brand"
            >
              <ArrowRight
                className="size-3.5 text-muted transition-colors group-hover:text-brand"
                aria-hidden
              />
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchButton() {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={iconButton} aria-label="Search">
        <Search className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className={clsx(panel, "w-[min(440px,calc(100vw-24px))]")}
          aria-label="Search SecureCart"
        >
          {/* Radix moves focus to the first field when the panel opens. */}
          <SearchForm
            onDone={() => {
              setOpen(false);
            }}
          />
          <QuickLinks
            onNavigate={() => {
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function useBagCount() {
  const { data } = useCart();
  const count = data?.item_count ?? 0;
  return {
    count,
    label: count ? `Bag, ${count} item${count === 1 ? "" : "s"}` : "Bag",
  };
}

/**
 * The add-to-bag cue. When the bag accepts an item, the icon takes the accent colour for a
 * moment (a state change, shown to everyone) and, unless reduced motion is preferred, gives
 * one small spring-like bump (transform only). The count beside it updates as well.
 */
function useBagCue() {
  const icon = useRef<HTMLSpanElement>(null);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    let timer = 0;
    const unsubscribe = onBagAdd(() => {
      setLit(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setLit(false);
      }, 1400);
      const el = icon.current;
      if (!el || prefersReducedMotion() || typeof el.animate !== "function") return;
      el.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.24)", offset: 0.35 },
          { transform: "scale(0.96)", offset: 0.7 },
          { transform: "scale(1)" },
        ],
        { duration: 480, easing: EASE_ENTRANCE },
      );
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
  return { icon, lit };
}

function BagIcon({ count }: { count: number }) {
  const { icon, lit } = useBagCue();
  return (
    <>
      <span
        ref={icon}
        className={clsx("flex", lit && "text-brand")}
        data-bag-cue={lit || undefined}
      >
        <ShoppingBag className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      {count > 0 && (
        <span className="absolute top-[22px] left-[22px] flex h-4 min-w-4 items-center justify-center rounded-full bg-fg px-1 text-[10px] font-semibold text-bg tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </>
  );
}

/** Popover on desktop, bottom drawer (vaul) on touch-sized screens. */
function BagButton() {
  const { count, label } = useBagCount();
  // Prerendered as the desktop popover trigger; phones swap in the drawer after hydration
  // (the button looks identical either way).
  const desktop = useMediaQuery("(min-width: 768px)", true);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };

  if (desktop) {
    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className={iconButton} aria-label={label}>
          <BagIcon count={count} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={4}
            collisionPadding={12}
            className={clsx(panel, "w-[380px]")}
            aria-label="Bag"
          >
            <BagPanel onNavigate={close} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }
  return (
    <Suspense
      fallback={
        // Same control while the drawer code loads; a tap opens it as soon as it arrives.
        <button
          type="button"
          className={iconButton}
          aria-label={label}
          onClick={() => {
            setOpen(true);
          }}
        >
          <BagIcon count={count} />
        </button>
      }
    >
      <BagDrawer open={open} onOpenChange={setOpen} triggerClassName={iconButton} label={label}>
        <BagIcon count={count} />
      </BagDrawer>
    </Suspense>
  );
}

function AccountMenu() {
  const { user, isAdmin, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  if (!user) return null;
  const item =
    "flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] text-fg outline-none select-none data-[highlighted]:bg-surface-2";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={iconButton} aria-label={`Account: ${user.full_name}`}>
        <CircleUserRound className="size-5" strokeWidth={1.6} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="z-50 w-64 rounded-[18px] border border-line bg-surface p-1.5 text-fg shadow-pop data-[state=open]:animate-fade-in"
        >
          <div className="flex items-center gap-3 px-3 pt-2 pb-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold"
              aria-hidden
            >
              {initials(user.full_name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{user.full_name}</p>
              <p className="truncate text-[13px] text-muted">{user.email}</p>
            </div>
          </div>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-line" />
          <DropdownMenu.Item asChild className={item}>
            <Link to="/orders">
              <Package className="size-4 text-muted" aria-hidden /> Orders
            </Link>
          </DropdownMenu.Item>
          {isAdmin && (
            <DropdownMenu.Item asChild className={item}>
              <Link to="/admin">
                <LayoutDashboard className="size-4 text-muted" aria-hidden /> Admin dashboard
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-3 pt-1.5 pb-1 text-[12px] text-muted">
            Appearance
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={preference}
            onValueChange={(value) => {
              setPreference(value as typeof preference);
            }}
          >
            {(["system", "light", "dark"] as const).map((value) => (
              <DropdownMenu.RadioItem key={value} value={value} className={item}>
                <span className="flex size-4 items-center justify-center" aria-hidden>
                  <DropdownMenu.ItemIndicator>
                    <span className="block size-1.5 rounded-full bg-brand" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {value === "system" ? "Match system" : value === "light" ? "Light" : "Dark"}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-line" />
          <DropdownMenu.Item
            className={item}
            onSelect={() => {
              void logout();
            }}
          >
            <LogOut className="size-4 text-muted" aria-hidden /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MobileMenu() {
  const { status, isAdmin, logout } = useAuth();
  const { data: categories } = useCategories();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOpen(false);
  }, [location.pathname, location.search]);

  const big =
    "block py-1.5 text-[28px] leading-tight font-semibold tracking-[-0.02em] text-fg/90 hover:text-fg";
  const small = "block py-1.5 text-[15px] font-medium text-fg/80 hover:text-fg";
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={clsx(iconButton, "md:hidden")} aria-label="Menu">
        <Menu className="size-5" strokeWidth={1.75} aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content className="fixed inset-0 z-50 overflow-y-auto bg-bg text-fg outline-none data-[state=open]:animate-fade-in">
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <Dialog.Description className="sr-only">
            Store sections and your account.
          </Dialog.Description>
          <div className="flex h-12 items-center justify-end px-2">
            <Dialog.Close className={iconButton} aria-label="Close menu">
              <X className="size-5" strokeWidth={1.75} aria-hidden />
            </Dialog.Close>
          </div>
          <nav aria-label="Mobile" className="px-8 pb-12">
            <Link to="/shop" className={big}>
              Shop all
            </Link>
            {categories?.map((c) => (
              <Link key={c.id} to={`/shop?category=${c.slug}`} className={big}>
                {c.name}
              </Link>
            ))}
            <Link to="/protection" className={big}>
              Protection
            </Link>
            <div className="mt-8 border-t border-line pt-6">
              <p className="text-[12px] font-medium text-muted">My profile</p>
              {status === "authenticated" ? (
                <>
                  <Link to="/orders" className={small}>
                    Orders
                  </Link>
                  {isAdmin && (
                    <Link to="/admin" className={small}>
                      Admin dashboard
                    </Link>
                  )}
                  <button
                    type="button"
                    className={small}
                    onClick={() => {
                      setOpen(false);
                      void logout();
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link to="/login" className={small}>
                  Sign in
                </Link>
              )}
              <div className="mt-2 -ml-3 flex items-center gap-1 text-[15px] text-fg/80">
                <ThemeToggle />
                <span>Appearance</span>
              </div>
            </div>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  clsx(
    "hit rounded-md text-[12px] whitespace-nowrap transition-colors",
    isActive ? "text-fg" : "text-fg/80 hover:text-fg",
  );

export function Header() {
  const { status } = useAuth();
  const { data: categories } = useCategories();
  const location = useLocation();
  const currentCategory = new URLSearchParams(location.search).get("category");

  return (
    <header className="glass sticky top-0 z-40 border-b border-line/60">
      <div className="mx-auto flex h-12 w-full max-w-[1024px] items-center gap-2 px-2 sm:px-4">
        <Link
          to="/"
          className="flex h-11 shrink-0 items-center gap-2 rounded-md px-2"
          aria-label="SecureCart home"
        >
          <LogoMark className="size-5.5" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-fg">SecureCart</span>
        </Link>
        <nav aria-label="Primary" className="ml-6 hidden min-w-0 items-center gap-7 md:flex">
          <NavLink
            to="/shop"
            end
            className={() =>
              navLink({ isActive: location.pathname === "/shop" && !currentCategory })
            }
          >
            Shop
          </NavLink>
          {categories?.map((c) => (
            <NavLink
              key={c.id}
              to={`/shop?category=${c.slug}`}
              className={() => navLink({ isActive: currentCategory === c.slug })}
            >
              {c.name}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center">
          {/* Sits with the controls so category links loading in never shift it (CLS). */}
          <NavLink
            to="/protection"
            className={(state) => clsx(navLink(state), "mr-2 hidden lg:inline-flex")}
          >
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" aria-hidden /> Protection
            </span>
          </NavLink>
          {/* Layout differences between phone and desktop are CSS, not script, so the
              prerendered nav is already in its final shape on either (no layout shift). */}
          <SearchButton />
          <ThemeToggle className="max-md:hidden" />
          <BagButton />
          {status === "authenticated" ? (
            <AccountMenu />
          ) : status === "anonymous" ? (
            <>
              <Link
                to="/login"
                className="hit ml-2 rounded-md px-1 text-[12px] text-fg/80 hover:text-fg max-md:hidden"
              >
                Sign in
              </Link>
              <Link to="/login" className={clsx(iconButton, "md:hidden")} aria-label="Sign in">
                <UserRound className="size-[18px]" strokeWidth={1.75} aria-hidden />
              </Link>
            </>
          ) : (
            <span className="size-11" aria-hidden />
          )}
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
