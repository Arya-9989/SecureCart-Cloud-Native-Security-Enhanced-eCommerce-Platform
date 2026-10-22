import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";

import {
  DataTable,
  SearchInput,
  SkeletonRows,
  TableMessage,
  Td,
  Th,
} from "@/components/admin/Table";
import { AdminPageHeader } from "@/components/layout/AdminLayout";
import { OrderHistoryList, OrderProgress } from "@/components/store/OrderTimeline";
import { Button } from "@/components/ui/Button";
import { InvoiceButton } from "@/components/store/InvoiceButton";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/EmptyState";
import { OrderStatusBadge, Pagination, ProductImage } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { adminApi } from "@/lib/endpoints";
import { STATUS_LABELS, formatDateTime, formatMoney } from "@/lib/format";
import type { AdminOrder, OrderStatus } from "@/lib/types";

const PAGE_SIZE = 12;
const TABS: { value: "" | OrderStatus; label: string }[] = [
  { value: "", label: "All" },
  { value: "paid", label: "To ship" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "payment_failed", label: "Failed" },
];

const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  shipped: "Mark as shipped",
  delivered: "Mark as delivered",
  cancelled: "Cancel and refund",
};

function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const { data: order, isLoading } = useQuery({
    queryKey: ["admin", "order", orderId],
    queryFn: () => adminApi.order(orderId ?? ""),
    enabled: orderId !== null,
  });
  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      adminApi.transition(id, status, note),
    onSuccess: (updated) => {
      queryClient.setQueryData(["admin", "order", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      setNote("");
      toast.success(`Order ${updated.number} updated`, STATUS_LABELS[updated.status]);
    },
    onError: (err) => {
      toast.error("Couldn't update order", errorMessage(err));
    },
  });

  return (
    <Dialog
      open={orderId !== null}
      onClose={onClose}
      title={order ? `Order ${order.number}` : "Order"}
      description={order ? `${order.customer_name} · ${order.customer_email}` : undefined}
      size="lg"
    >
      {isLoading || !order ? (
        <div className="flex justify-center py-10">
          <Spinner label="Loading order" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-[18px] bg-surface-2 p-5">
            <OrderProgress order={order} />
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-[12px] font-medium text-muted">Items</h3>
              <ul className="mt-2 space-y-2">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 text-sm">
                    <div className="studio size-10 shrink-0 overflow-hidden rounded-[10px]">
                      <ProductImage src={item.image_url} alt="" className="size-full" sizes="sm" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-fg">
                      {item.quantity} × {item.product_name}
                    </span>
                    <span className="font-medium text-fg tabular-nums">
                      {formatMoney(item.line_total, order.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex justify-between border-t border-line pt-3 text-sm font-semibold text-fg">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(order.total, order.currency)}</span>
              </p>
            </div>
            <div className="space-y-4 text-sm">
              <div>
                <h3 className="text-[12px] font-medium text-muted">Ship to</h3>
                <p className="mt-1 text-fg">
                  {order.shipping_address.name}, {order.shipping_address.line1},{" "}
                  {order.shipping_address.city} {order.shipping_address.postal_code},{" "}
                  {order.shipping_address.country}
                </p>
              </div>
              <div>
                <h3 className="text-[12px] font-medium text-muted">Payment</h3>
                <p className="mt-1 font-mono text-xs break-all text-muted">
                  {order.payment_provider} · {order.payment_reference || "none"}
                </p>
                {order.paid_at && (
                  <div className="mt-2">
                    <InvoiceButton size="sm" path={`/admin/orders/${order.id}/invoice/`} />
                  </div>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-[12px] font-medium text-muted">History</h3>
                <OrderHistoryList order={order} />
              </div>
            </div>
          </div>
          {order.allowed_transitions.length > 0 && (
            <div className="rounded-[18px] border border-line p-5">
              <label htmlFor="transition-note" className="label">
                Note (optional, e.g. tracking number)
              </label>
              <input
                id="transition-note"
                className="field"
                maxLength={255}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {order.allowed_transitions.map((status) => (
                  <Button
                    key={status}
                    variant={status === "cancelled" ? "danger" : "primary"}
                    size="sm"
                    loading={transition.isPending && transition.variables.status === status}
                    disabled={transition.isPending}
                    onClick={() => {
                      transition.mutate({ id: order.id, status });
                    }}
                  >
                    {ACTION_LABELS[status] ?? STATUS_LABELS[status]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function AdminOrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "") as "" | OrderStatus;
  const search = params.get("search") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const [openId, setOpenId] = useState<string | null>(null);

  const query = { status, search, page, page_size: PAGE_SIZE };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "orders", query],
    queryFn: () => adminApi.orders(query),
    placeholderData: keepPreviousData,
  });

  const setParam = useCallback(
    (key: string, value: string) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        return next;
      });
    },
    [setParams],
  );
  const onSearch = useCallback(
    (value: string) => {
      setParam("search", value);
    },
    [setParam],
  );

  return (
    <>
      <AdminPageHeader title="Orders" description="Monitor payments and fulfil shipments." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          // Filters, not tabs: there are no tab panels and no arrow-key model to honour.
          role="group"
          aria-label="Filter by status"
          className="no-scrollbar flex gap-1 overflow-x-auto rounded-full bg-surface-2 p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={status === tab.value}
              onClick={() => {
                setParam("status", tab.value);
              }}
              className={clsx(
                "inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[14px] font-medium transition-colors",
                status === tab.value
                  ? "bg-surface text-fg shadow-card"
                  : "text-muted hover:text-fg",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <SearchInput value={search} onChange={onSearch} placeholder="Search order # or customer" />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable label="Orders">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Placed</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                <SkeletonRows cols={5} />
              ) : data?.results.length === 0 ? (
                <TableMessage colSpan={5}>No orders found.</TableMessage>
              ) : (
                data?.results.map((order: AdminOrder) => (
                  <tr key={order.id} className="transition-colors hover:bg-surface-2/60">
                    <Td>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center font-mono font-semibold text-brand hover:underline"
                        onClick={() => {
                          setOpenId(order.id);
                        }}
                      >
                        {order.number}
                      </button>
                    </Td>
                    <Td>
                      <p className="font-medium text-fg">{order.customer_name}</p>
                      <p className="text-xs text-muted">{order.customer_email}</p>
                    </Td>
                    <Td className="text-muted">{formatDateTime(order.created_at)}</Td>
                    <Td>
                      <OrderStatusBadge status={order.status} />
                    </Td>
                    <Td className="text-right font-semibold text-fg tabular-nums">
                      {formatMoney(order.total, order.currency)}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
          {data && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              count={data.count}
              onPage={(next) => {
                setParam("page", String(next));
              }}
            />
          )}
        </>
      )}
      <OrderDrawer
        orderId={openId}
        onClose={() => {
          setOpenId(null);
        }}
      />
    </>
  );
}
