import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, PackageX } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { OrderHistoryList, OrderProgress } from "@/components/store/OrderTimeline";
import { PriceSummary } from "@/components/store/PriceSummary";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { OrderStatusBadge, ProductImage, Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { keys, useOrder } from "@/hooks/queries";
import { ApiError, errorMessage } from "@/lib/api";
import { orderApi } from "@/lib/endpoints";
import { formatDateTime, formatMoney } from "@/lib/format";

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const justPlaced = params.get("placed") === "1";
  const { data: order, isLoading, error, refetch } = useOrder(id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const cancel = useMutation({
    mutationFn: () => orderApi.cancel(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.order(id), updated);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      setConfirming(false);
      toast.success("Order cancelled", "Your payment has been refunded.");
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
      <div className="container-page max-w-5xl space-y-6 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  const address = order.shipping_address;

  return (
    <div className="container-page max-w-5xl py-10">
      <Link
        to="/orders"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden /> All orders
      </Link>

      {justPlaced && order.status === "paid" && (
        <div
          role="status"
          className="mt-6 flex items-start gap-3 rounded-2xl border border-success/30 bg-success-soft p-5"
        >
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
          <div>
            <p className="font-semibold text-fg">Thank you! Your order is confirmed.</p>
            <p className="mt-0.5 text-sm text-muted">
              Payment captured by the mock provider. We'll update this page as it ships.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-fg">{order.number}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-muted">Placed {formatDateTime(order.created_at)}</p>
        </div>
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

      <div className="card mt-6 p-6">
        <OrderProgress order={order} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <section className="card p-6" aria-labelledby="items-heading">
          <h2 id="items-heading" className="text-lg font-semibold text-fg">
            Items
          </h2>
          <ul className="mt-4 divide-y divide-line">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center gap-4 py-4">
                <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
                  <ProductImage src={item.image_url} alt="" className="size-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{item.product_name}</p>
                  <p className="text-sm text-muted">
                    {item.quantity} × {formatMoney(item.unit_price, order.currency)}
                  </p>
                </div>
                <p className="font-semibold text-fg tabular-nums">
                  {formatMoney(item.line_total, order.currency)}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-line pt-5">
            <PriceSummary
              subtotal={order.subtotal}
              shipping={order.shipping}
              tax={order.tax}
              total={order.total}
              currency={order.currency}
            />
          </div>
        </section>

        <div className="space-y-6">
          <section className="card p-6" aria-labelledby="ship-heading">
            <h2 id="ship-heading" className="text-sm font-semibold text-fg">
              Shipping to
            </h2>
            <address className="mt-2 text-sm leading-relaxed text-muted not-italic">
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
          <section className="card p-6" aria-labelledby="history-heading">
            <h2 id="history-heading" className="mb-4 text-sm font-semibold text-fg">
              History
            </h2>
            <OrderHistoryList order={order} />
          </section>
        </div>
      </div>

      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Cancel this order?"
        description="Items go back into stock and the payment is refunded. This can't be undone."
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
        <p className="text-sm text-muted">
          Order <span className="font-mono font-semibold text-fg">{order.number}</span> totalling{" "}
          <span className="font-semibold text-fg">{formatMoney(order.total, order.currency)}</span>
        </p>
      </Dialog>
    </div>
  );
}
