import { clsx } from "clsx";
import { Moon, Sun } from "lucide-react";

import { useHydrated } from "@/hooks/useHydrated";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  // Prerendered HTML can't know the saved theme: render the light-mode control until
  // hydration has finished, then the real one (the page colours are already right, because
  // theme-init.js sets them before first paint).
  const hydrated = useHydrated();
  const dark = hydrated && resolved === "dark";
  const next = dark ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        setPreference(next);
      }}
      className={clsx(
        "flex size-11 items-center justify-center rounded-full text-fg/80 transition-colors hover:text-fg",
        className,
      )}
      aria-label={`Switch to ${next} appearance`}
    >
      {dark ? (
        <Sun className="size-[18px]" strokeWidth={1.75} aria-hidden />
      ) : (
        <Moon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}
