import { clsx } from "clsx";
import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
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
      {resolved === "dark" ? (
        <Sun className="size-[18px]" strokeWidth={1.75} aria-hidden />
      ) : (
        <Moon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}
