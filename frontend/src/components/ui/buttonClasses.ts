import { clsx } from "clsx";

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-fg shadow-sm hover:bg-brand-hover disabled:hover:bg-brand",
  secondary: "border border-line bg-surface-2 text-fg hover:bg-surface-3",
  outline: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white shadow-sm hover:opacity-90 dark:text-bg",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-12 gap-2 rounded-xl px-6 text-base",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition",
    "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100",
    variants[variant],
    sizes[size],
    extra,
  );
}
