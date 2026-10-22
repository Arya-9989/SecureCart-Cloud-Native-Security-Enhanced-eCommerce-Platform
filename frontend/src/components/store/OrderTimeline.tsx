import { clsx } from "clsx";
import { Check, CircleDollarSign, Package, Truck, XCircle } from "lucide-react";

import { STATUS_LABELS, formatDateTime } from "@/lib/format";
import type { Order, OrderStatus } from "@/lib/types";

const HAPPY_PATH: { status: OrderStatus; label: string; icon: typeof Check }[] = [
  { status: "pending_payment", label: "Placed", icon: Package },
  { status: "paid", label: "Paid", icon: CircleDollarSign },
  { status: "shipped", label: "Shipped", icon: Truck },
  { status: "delivered", label: "Delivered", icon: Check },
];

/** Horizontal progress tracker for the normal lifecycle, with terminal failure states. */
export function OrderProgress({ order }: { order: Order }) {
  if (order.status === "cancelled" || order.status === "payment_failed") {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-4">
        <XCircle className="size-5 shrink-0 text-danger" aria-hidden />
        <p className="text-sm text-fg">
          <span className="font-semibold">{STATUS_LABELS[order.status]}.</span>{" "}
          {order.status === "cancelled"
            ? "Reserved stock was released and any payment was refunded."
            : (order.failure_reason || "The payment was declined.") + " Nothing was charged."}
        </p>
      </div>
    );
  }
  const reached = HAPPY_PATH.findIndex((step) => step.status === order.status);
  return (
    <ol className="grid grid-cols-4" aria-label="Order progress">
      {HAPPY_PATH.map((step, index) => {
        const done = index <= reached;
        const Icon = step.icon;
        return (
          <li key={step.status} className="relative flex flex-col items-center text-center">
            {index > 0 && (
              <span
                className={clsx(
                  "absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2",
                  index <= reached ? "bg-brand" : "bg-line-strong",
                )}
                aria-hidden
              />
            )}
            <span
              className={clsx(
                "relative z-10 flex size-8 items-center justify-center rounded-full ring-4 ring-surface",
                done ? "bg-brand text-brand-fg" : "bg-surface-3 text-subtle",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className={clsx("mt-2 text-xs font-semibold", done ? "text-fg" : "text-subtle")}>
              {step.label}
            </span>
            <span className="sr-only">{done ? "completed" : "pending"}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderHistoryList({ order }: { order: Order }) {
  return (
    <ol className="space-y-4">
      {[...order.events].reverse().map((event, index) => (
        <li key={`${event.created_at}-${index}`} className="flex gap-3">
          <span
            className={clsx(
              "mt-1.5 size-2 shrink-0 rounded-full",
              index === 0 ? "bg-brand" : "bg-line-strong",
            )}
            aria-hidden
          />
          <div>
            <p className="text-sm font-medium text-fg">{STATUS_LABELS[event.to_status]}</p>
            {event.note && <p className="text-sm text-muted">{event.note}</p>}
            <p className="text-xs text-subtle">{formatDateTime(event.created_at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
