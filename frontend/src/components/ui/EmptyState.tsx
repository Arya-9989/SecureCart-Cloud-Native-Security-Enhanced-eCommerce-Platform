import { clsx } from "clsx";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { errorMessage } from "@/lib/api";

import { Button } from "./Button";

/** Designed empty state: quiet icon, one declarative headline, one action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "tile flex flex-col items-center justify-center px-6 py-16 text-center sm:py-20",
        className,
      )}
    >
      <Icon className="size-10 text-muted" strokeWidth={1.5} aria-hidden />
      <h2 className="mt-5 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-fg sm:text-[28px]">
        {title}
      </h2>
      {description && <p className="mt-2 max-w-md text-[17px] text-muted">{description}</p>}
      {action && <div className="mt-7">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "We couldn't load this",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className="tile flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <AlertTriangle className="size-10 text-danger" strokeWidth={1.5} aria-hidden />
      <h2 className="mt-5 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-fg">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-[17px] text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-7" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
