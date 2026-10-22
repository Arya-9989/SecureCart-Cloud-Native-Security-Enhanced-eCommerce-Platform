import { clsx } from "clsx";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { errorMessage } from "@/lib/api";

import { Button } from "./Button";

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
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
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
      className="flex flex-col items-center justify-center rounded-2xl border border-danger/25 bg-danger-soft/60 px-6 py-12 text-center"
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
