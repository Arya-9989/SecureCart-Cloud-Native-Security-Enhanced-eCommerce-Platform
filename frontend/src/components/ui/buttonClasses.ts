import { clsx } from "clsx";

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "plain";
export type Size = "sm" | "md" | "lg";

/**
 * Apple-style pills: one filled primary (the accent, used only for action), an accent
 * outline secondary, and quiet neutrals. Only colour, opacity and transform transition.
 */
const variants: Record<Variant, string> = {
  primary: "bg-action text-brand-fg hover:bg-action-hover disabled:hover:bg-action",
  secondary: "border border-brand text-brand hover:bg-brand-soft",
  outline: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  plain: "text-brand hover:underline underline-offset-4",
  danger: "bg-danger text-white hover:opacity-90 dark:text-black",
};

const sizes: Record<Size, string> = {
  sm: "hit h-8 gap-1.5 px-3.5 text-[14px]",
  md: "h-11 gap-2 px-5 text-[17px]",
  lg: "h-12 gap-2 px-7 text-[17px]",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap",
    "transition-[background-color,color,opacity,transform] duration-200 ease-(--ease-apple)",
    "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
    variants[variant],
    sizes[size],
    extra,
  );
}
