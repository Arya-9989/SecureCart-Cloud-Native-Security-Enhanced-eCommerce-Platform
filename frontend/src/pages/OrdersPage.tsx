import { ChevronRight, Package } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { buttonClasses } from "@/components/ui/buttonClasses";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { OrderStatusBadge, Pagination, ProductImage, Skeleton } from "@/components/ui/misc";
import { useOrders } from "@/hooks/queries";
import { formatDate, formatMoney } from "@/lib/format";

const PAGE_SIZE = 12;

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? "1") || 1;
  const { data, isLoading, error, refetch } = useOrders(page);

  return (
    <div className="container-page max-w-4xl py-10">
      <h1 className="text-3xl font-bold tracking-tight text-fg">Your orders</h1>
      <p className="mt-1 text-sm text-muted">Track deliveries and review past purchases.</p>

      <div className="mt-8">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : data.results.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No orders yet"
            description="When you place an order it will show up here."
            action={
              <Link to="/shop" className={buttonClasses("primary")}>
                Start shopping
              </Link>
            }
          />
        ) : (
          <>
            <ul className="space-y-3">
              {data.results.map((order) => (
                <li key={order.id}>
                  <Link
                    to={`/orders/${order.id}`}
                    className="card group flex items-center gap-4 p-4 transition hover:border-brand/40 hover:shadow-lift sm:gap-6 sm:p-5"
                  >
                    <div className="flex -space-x-3">
                      {order.preview_images.slice(0, 3).map((src, i) => (
                        <div
                          key={`${src}-${i}`}
                          className="size-12 overflow-hidden rounded-xl border-2 border-surface bg-surface-2 sm:size-14"
                        >
                          <ProductImage src={src} alt="" className="size-full" sizes="sm" />
                        </div>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="font-mono text-sm font-semibold text-fg">{order.number}</p>
                        <OrderStatusBadge status={order.status} />
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {formatDate(order.created_at)} · {order.item_count} item
                        {order.item_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <p className="hidden font-semibold text-fg tabular-nums sm:block">
                      {formatMoney(order.total, order.currency)}
                    </p>
                    <ChevronRight
                      className="size-5 text-subtle transition group-hover:translate-x-0.5 group-hover:text-brand"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              count={data.count}
              onPage={(next) => {
                setParams({ page: String(next) });
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
