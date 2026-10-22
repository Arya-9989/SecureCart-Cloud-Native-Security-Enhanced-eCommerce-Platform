import { ChevronRight, Package } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { buttonClasses } from "@/components/ui/buttonClasses";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { OrderStatusBadge, Pagination, ProductImage, Skeleton } from "@/components/ui/misc";
import { useOrders } from "@/hooks/queries";
import { formatDate, formatMoney } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const PAGE_SIZE = 12;

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? "1") || 1;
  const { data, isLoading, error, refetch } = useOrders(page);
  useDocumentTitle("Orders");

  return (
    <div className="container-text pt-12 pb-24 sm:pt-16">
      <h1 className="type-headline">Your orders.</h1>
      <p className="mt-3 text-[17px] text-muted">Track deliveries and review past purchases.</p>

      <div className="mt-10">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-[22px]" />
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
            <ul className="divide-y divide-line border-y border-line">
              {data.results.map((order) => (
                <li key={order.id}>
                  <Link
                    to={`/orders/${order.id}`}
                    className="group flex items-center gap-4 py-5 sm:gap-6"
                  >
                    <div className="flex -space-x-3">
                      {order.preview_images.slice(0, 3).map((src, i) => (
                        <div
                          key={`${src}-${i}`}
                          className="studio size-14 overflow-hidden rounded-[14px] ring-2 ring-bg sm:size-16"
                        >
                          <ProductImage src={src} alt="" className="size-full" sizes="sm" />
                        </div>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="font-mono text-[15px] font-semibold text-fg group-hover:underline">
                          {order.number}
                        </p>
                        <OrderStatusBadge status={order.status} />
                      </div>
                      <p className="mt-1 text-[14px] text-muted">
                        {formatDate(order.created_at)} · {order.item_count} item
                        {order.item_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <p className="hidden text-[17px] text-fg tabular-nums sm:block">
                      {formatMoney(order.total, order.currency)}
                    </p>
                    <ChevronRight
                      className="size-5 text-muted transition-transform group-hover:translate-x-0.5"
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
