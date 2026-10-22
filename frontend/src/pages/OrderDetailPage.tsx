import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  CircleCheck,
  Clock,
  EyeOff,
  History,
  Loader2,
  Lock,
  PackageX,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { OrderHistoryList, OrderProgress } from "@/components/store/OrderTimeline";
import { InvoiceButton } from "@/components/store/InvoiceButton";
import { PriceSummary } from "@/components/store/PriceSummary";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { OrderStatusBadge, ProductImage, Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { keys, PENDING_POLL_LIMIT, useOrder } from "@/hooks/queries";
import { ApiError, errorMessage } from "@/lib/api";
import { orderApi } from "@/lib/endpoints";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Order } from "@/lib/types";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/** What actually protected this order, stated plainly. Each line maps to real code paths. */
const RECEIPT = [
  {
    icon: RotateCcw,
    title: "Charged exactly once",
    text: "The order was placed with an idempotency key, so a retry could never charge you twice.",
  },
  {
    icon: Lock,
    title: "Stock reserved before payment",
    text: "Every item was locked and reserved together before the charge was attempted.",
  },
  {
    icon: History,
    title: "On the record",
    text: "Each status change is written to this order's history, shown below.",
  },
  {
    icon: EyeOff,
    title: "Yours alone",
    text: "This page answers only to your account. Anyone else gets “not found”.",
  },
];

function providerName(provider: string): string {
  return provider === "stripe" ? "Stripe (test mode)" : "the mock provider";
}

/** Shown while an asynchronous provider (Stripe) has not reported the outcome yet. */
function Confirming({ order, stalled }: { order: Order; stalled: boolean }) {
  return (
    <section
      role="status"
      aria-labelledby="confirming-heading"
      className="rounded-[22px] bg-surface-2 px-6 py-10 text-center"
    >
      {stalled ? (
        <Clock className="mx-auto size-10 text-muted" strokeWidth={1.5} aria-hidden />
      ) : (
        <Loader2 className="mx-auto size-10 animate-spin text-brand" aria-hidden />
      )}
      <h1 id="confirming-heading" className="type-headline mt-5">
        {stalled ? "Still confirming your payment." : "Confirming your payment."}
      </h1>
      <p className="mx-auto mt-3 max-w-[560px] text-[17px] text-pretty text-muted">
        {providerName(order.payment_provider)} is confirming the charge for order{" "}
        <span className="font-mono font-medium text-fg">{order.number}</span>. Your items are
        reserved meanwhile.{" "}
        {stalled
          ? "This is taking longer than usual. You can leave this page: the order updates on its own, and if the payment doesn't go through the reservation is released."
          : "This page updates by itself."}
      </p>
    </section>
  );
}

function Confirmation({ order }: { order: Order }) {
  return (
    <section role="status" aria-labelledby="confirmed-heading" className="text-center">
      <CircleCheck className="mx-auto size-14 text-success" strokeWidth={1.5} aria-hidden />
      <h1 id="confirmed-heading" className="type-headline mt-5">
        Thank you. Your order is confirmed.
      </h1>
      <p className="mt-3 text-[17px] text-muted">
        Order <span className="font-mono font-medium text-fg">{order.number}</span> · payment
        captured by {providerName(order.payment_provider)}. This page updates as your order ships.
      </p>
      <div className="mx-auto mt-10 grid max-w-[880px] gap-3 text-left sm:grid-cols-2">
        {RECEIPT.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3.5 rounded-[18px] bg-surface-2 p-5">
            <Icon className="mt-0.5 size-5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
            <div>
              <p className="text-[15px] font-semibold">{title}</p>
              <p className="mt-0.5 text-[14px] text-muted">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const justPlaced = params.get("placed") === "1";
  // dataUpdatedAt is read so that every poll re-renders, even when the order is unchanged.
  const { data: order, isLoading, error, refetch, dataUpdatedAt } = useOrder(id);
  const queryClient = useQueryClient();
  const updates = dataUpdatedAt
    ? (queryClient.getQueryState(keys.order(id))?.dataUpdateCount ?? 0)
    : 0;
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  useDocumentTitle(order ? `Order ${order.number}` : error ? "Order not found" : undefined);

  const cancel = useMutation({
    mutationFn: () => orderApi.cancel(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.order(id), updated);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      setConfirming(false);
      toast.success(
        "Order cancelled",
        updated.paid_at ? "The items are back in stock and your payment was refunded." : undefined,
      );
    },
    onError: (err) => {
      setConfirming(false);
      toast.error("Couldn't cancel this order", errorMessage(err));
    },
  });

  if (error) {
    return (
      <div className="container-page py-16">
        {error instanceof ApiError && error.status === 404 ? (
          <EmptyState
            icon={PackageX}
            title="Order not found"
            pageHeading
            description="This order doesn't exist or belongs to another account."
            action={
              <Link to="/orders" className={buttonClasses("primary")}>
                View your orders
              </Link>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  if (isLoading || !order) {
    return (
      <div className="container-text space-y-6 py-14" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full rounded-[22px]" />
        <Skeleton className="h-72 w-full rounded-[22px]" />
      </div>
    );
  }

  const address = order.shipping_address;
  const confirmed = justPlaced && order.status === "paid";
  const awaitingPayment = justPlaced && order.status === "pending_payment";

  return (
    <div className="container-text pt-10 pb-24 sm:pt-14">
      {confirmed ? (
        <Confirmation order={order} />
      ) : awaitingPayment ? (
        <Confirming order={order} stalled={updates >= PENDING_POLL_LIMIT} />
      ) : (
        <Link
          to="/orders"
          className="inline-flex h-11 items-center gap-0.5 rounded-sm text-[15px] text-brand hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden /> Orders
        </Link>
      )}

      <div className={confirmed || awaitingPayment ? "mt-16 border-t border-line pt-12" : "mt-6"}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              {confirmed ? (
                <h2 className="font-mono text-[24px] font-semibold tracking-tight">
                  {order.number}
                </h2>
              ) : (
                <h1 className="font-mono text-[28px] font-semibold tracking-tight sm:text-[32px]">
                  {order.number}
                </h1>
              )}
              <OrderStatusBadge status={order.status} />
            </div>
            <p className="mt-1 text-[15px] text-muted">Placed {formatDateTime(order.created_at)}</p>
          </div>
          {(order.paid_at ?? order.can_cancel) && (
            <div className="flex flex-wrap gap-3">
              {order.paid_at && (
                <InvoiceButton path={`/orders/${encodeURIComponent(order.id)}/invoice/`} />
              )}
              {order.can_cancel && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirming(true);
                  }}
                >
                  Cancel order
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="mt-8 rounded-[22px] bg-surface-2 p-6 sm:p-8">
          <OrderProgress order={order} />
        </div>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1fr_300px]">
          <section aria-labelledby="items-heading">
            <h2 id="items-heading" className="text-[21px] font-semibold tracking-[-0.02em]">
              Items
            </h2>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 py-4">
                  <div className="studio size-20 shrink-0 overflow-hidden rounded-[16px]">
                    <ProductImage src={item.image_url} alt="" className="size-full" sizes="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[17px] font-medium">{item.product_name}</p>
                    <p className="text-[14px] text-muted">
                      {item.quantity} × {formatMoney(item.unit_price, order.currency)}
                    </p>
                  </div>
                  <p className="text-[17px] tabular-nums">
                    {formatMoney(item.line_total, order.currency)}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-6 sm:ml-auto sm:max-w-[360px]">
              <PriceSummary
                subtotal={order.subtotal}
                shipping={order.shipping}
                tax={order.tax}
                total={order.total}
                currency={order.currency}
              />
            </div>
          </section>

          <div className="space-y-8">
            <section aria-labelledby="ship-heading">
              <h2 id="ship-heading" className="text-[15px] font-semibold">
                Shipping to
              </h2>
              <address className="mt-2 text-[15px] leading-relaxed text-muted not-italic">
                {address.name}
                <br />
                {address.line1}
                {address.line2 ? (
                  <>
                    <br />
                    {address.line2}
                  </>
                ) : null}
                <br />
                {address.city} {address.postal_code}
                <br />
                {address.country}
              </address>
            </section>
            <section aria-labelledby="history-heading">
              <h2 id="history-heading" className="mb-4 text-[15px] font-semibold">
                History
              </h2>
              <OrderHistoryList order={order} />
            </section>
          </div>
        </div>
      </div>

      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Cancel this order?"
        description={
          order.paid_at
            ? "The items go back into stock and your payment is refunded. This can't be undone."
            : "The items go back into stock. This can't be undone."
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep order
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() => {
                cancel.mutate();
              }}
            >
              Cancel order
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-muted">
          Order <span className="font-mono font-medium text-fg">{order.number}</span> totalling{" "}
          <span className="font-medium text-fg">{formatMoney(order.total, order.currency)}</span>
        </p>
      </Dialog>
    </div>
  );
}
