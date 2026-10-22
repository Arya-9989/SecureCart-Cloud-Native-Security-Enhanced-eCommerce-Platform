import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { STATUS_LABELS } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

import { Badge, type Tone } from "./Badge";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

/**
 * Product art is transparent and drawn for a studio backdrop, so callers wrap it in a
 * `.studio` tile; the image is contained, never cropped. Width/height attributes reserve
 * the 4:3 box before the SVG arrives (no layout shift).
 */
export function ProductImage({
  src,
  alt,
  className,
  sizes = "md",
  eager = false,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  sizes?: "sm" | "md" | "lg";
  eager?: boolean;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    return (
      <div
        className={clsx("flex items-center justify-center text-muted", className)}
        role="img"
        aria-label={alt || "Image unavailable"}
      >
        <ImageOff className={sizes === "sm" ? "size-4" : "size-8"} aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={800}
      height={600}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      draggable={false}
      onError={() => {
        setFailed(true);
      }}
      className={clsx("object-contain", className)}
      style={style}
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
    "flex items-center justify-center rounded-full text-fg transition-colors hover:bg-surface-3 disabled:text-muted disabled:opacity-50 disabled:hover:bg-transparent",
    size === "sm" ? "hit size-8" : "size-11",
  );
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        "inline-flex items-center rounded-full bg-surface-2",
        size === "sm" ? "p-0.5" : "p-0.5",
      )}
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
          "text-center font-medium tabular-nums",
          size === "sm" ? "w-7 text-[14px]" : "w-9 text-[17px]",
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
  const button =
    "inline-flex h-9 items-center gap-1 rounded-full border border-line-strong bg-surface px-4 text-[14px] font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-surface";
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-8">
      <p className="text-[14px] text-muted">
        <span className="font-medium text-fg tabular-nums">
          {from}–{to}
        </span>{" "}
        of <span className="font-medium text-fg tabular-nums">{count}</span>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className={clsx(button, "hit")}
          onClick={() => {
            onPage(page - 1);
          }}
          disabled={page <= 1}
        >
          <ChevronLeft className="size-4" aria-hidden /> Previous
        </button>
        <button
          type="button"
          className={clsx(button, "hit")}
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
