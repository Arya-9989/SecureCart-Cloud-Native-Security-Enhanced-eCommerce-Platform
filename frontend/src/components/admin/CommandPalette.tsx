import { Command } from "cmdk";
import {
  AlertTriangle,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Plus,
  ScrollText,
  Search,
  Store,
  Sun,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { useTheme } from "@/lib/theme";

interface Action {
  id: string;
  label: string;
  icon: LucideIcon;
  group: "Go to" | "Actions";
  keywords?: string[];
  run: () => void;
}

/** ⌘K / Ctrl+K palette for the admin console: navigation and the common actions. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { resolved, setPreference } = useTheme();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const shortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";
  const go = (to: string) => () => void navigate(to);
  const actions: Action[] = [
    { id: "dash", label: "Dashboard", icon: LayoutDashboard, group: "Go to", run: go("/admin") },
    {
      id: "products",
      label: "Products",
      icon: Package,
      group: "Go to",
      run: go("/admin/products"),
    },
    {
      id: "orders",
      label: "Orders",
      icon: ClipboardList,
      group: "Go to",
      run: go("/admin/orders"),
    },
    { id: "users", label: "Users", icon: Users, group: "Go to", run: go("/admin/users") },
    {
      id: "audit",
      label: "Audit log",
      icon: ScrollText,
      group: "Go to",
      keywords: ["security", "history"],
      run: go("/admin/audit-log"),
    },
    { id: "store", label: "Storefront", icon: Store, group: "Go to", run: go("/") },
    {
      id: "new-product",
      label: "New product",
      icon: Plus,
      group: "Actions",
      keywords: ["create", "add"],
      run: go("/admin/products?new=1"),
    },
    {
      id: "to-ship",
      label: "Orders to ship",
      icon: Truck,
      group: "Actions",
      keywords: ["paid", "fulfil"],
      run: go("/admin/orders?status=paid"),
    },
    {
      id: "low-stock",
      label: "Low-stock products",
      icon: AlertTriangle,
      group: "Actions",
      keywords: ["inventory"],
      run: go("/admin/products?low_stock=5"),
    },
    {
      id: "theme",
      label: resolved === "dark" ? "Switch to light appearance" : "Switch to dark appearance",
      icon: resolved === "dark" ? Sun : Moon,
      group: "Actions",
      keywords: ["theme", "dark", "light"],
      run: () => {
        setPreference(resolved === "dark" ? "light" : "dark");
      },
    },
    {
      id: "sign-out",
      label: "Sign out",
      icon: LogOut,
      group: "Actions",
      keywords: ["logout"],
      run: () => void logout(),
    },
  ];

  const item =
    "flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-fg outline-none select-none data-[selected=true]:bg-surface-2";
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="hit flex h-9 w-full max-w-[280px] items-center gap-2 rounded-full bg-surface-2 px-3.5 text-[14px] text-muted transition-colors hover:bg-surface-3">
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="hidden rounded-md bg-surface px-1.5 py-0.5 font-sans text-[11px] text-muted sm:inline">
          {shortcut}
        </kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="fixed top-[14vh] left-1/2 z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[22px] border border-line bg-surface text-fg shadow-pop outline-none data-[state=open]:animate-slide-up"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command label="Command palette" loop>
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search className="size-5 text-muted" aria-hidden />
              <Command.Input
                placeholder="Search pages and actions"
                className="h-14 flex-1 bg-transparent text-[17px] text-fg placeholder:text-muted focus:outline-none"
              />
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[15px] text-muted">
                No matches.
              </Command.Empty>
              {(["Go to", "Actions"] as const).map((group) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
                >
                  {actions
                    .filter((a) => a.group === group)
                    .map(({ id, label, icon: Icon, keywords, run }) => (
                      <Command.Item
                        key={id}
                        value={label}
                        keywords={keywords}
                        className={item}
                        onSelect={() => {
                          setOpen(false);
                          run();
                        }}
                      >
                        <Icon className="size-4 text-muted" aria-hidden />
                        {label}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
