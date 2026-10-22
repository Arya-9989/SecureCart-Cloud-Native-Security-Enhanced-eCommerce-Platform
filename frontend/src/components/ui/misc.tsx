import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus } from "lucide-react";
import { useState } from "react";

import { STATUS_LABELS } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

import { Badge, type Tone } from "./Badge";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

export function ProductImage({
  src,
  alt,
  className,
  sizes = "md",
}: {
  src: string;
  alt: string;
  className?: string;
  sizes?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    return (
      <div
        className={clsx(
          "flex items-center justify-center bg-gradient-to-br from-surface-2 to-surface-3 text-subtle",
          className,
        )}
        role="img"
        aria-label={alt}
      >
        <ImageOff className={sizes === "sm" ? "size-4" : "size-8"} aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
      className={clsx("object-cover", className)}
    />
  );
}

const STATUS_TONES: Record<OrderStatus, Tone> = {
  pending_payment: "warning",
  paid: "brand",
  shipped: "info",
  delivered: "success",
  cancelled: "neutral",
  payment_failed: "danger",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  disabled,
  label,
  size = "md",
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
  size?: "sm" | "md";
}) {
  const button = clsx(
    "flex items-center justify-center text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent",
    size === "sm" ? "size-8" : "size-10",
  );
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center overflow-hidden rounded-xl border border-line-strong bg-surface"
    >
      <button
        type="button"
        className={button}
        onClick={() => {
          onChange(value - 1);
        }}
        disabled={disabled ?? value <= min}
        aria-label="Decrease quantity"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <output
        className={clsx(
          "text-center text-sm font-semibold tabular-nums",
          size === "sm" ? "w-8" : "w-10",
        )}
        aria-live="polite"
      >
        {value}
      </output>
      <button
        type="button"
        className={button}
        onClick={() => {
          onChange(value + 1);
        }}
        disabled={disabled ?? value >= max}
        aria-label="Increase quantity"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  count,
  onPage,
}: {
  page: number;
  pageSize: number;
  count: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-6">
      <p className="text-sm text-muted">
        Showing <span className="font-semibold text-fg">{from}</span>–
        <span className="font-semibold text-fg">{to}</span> of{" "}
        <span className="font-semibold text-fg">{count}</span>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-fg transition hover:bg-surface-2 disabled:opacity-40"
          onClick={() => {
            onPage(page - 1);
          }}
          disabled={page <= 1}
        >
          <ChevronLeft className="size-4" aria-hidden /> Previous
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-fg transition hover:bg-surface-2 disabled:opacity-40"
          onClick={() => {
            onPage(page + 1);
          }}
          disabled={page >= pages}
        >
          Next <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}

export function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) return <Badge tone="neutral">Sold out</Badge>;
  if (stock <= 5) return <Badge tone="warning">Only {stock} left</Badge>;
  return (
    <Badge tone="success" dot>
      In stock
    </Badge>
  );
}
