import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, PackageCheck } from "lucide-react";
import { Link } from "react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { AdminPageHeader } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/misc";
import { adminApi } from "@/lib/endpoints";
import { STATUS_LABELS, formatMoney } from "@/lib/format";
import type { DashboardStats, OrderStatus } from "@/lib/types";

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-fg sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 hidden text-xs text-subtle sm:block">{hint}</p>}
    </div>
  );
}

function RevenueTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const point = payload?.[0]?.payload as
    { date: string; revenue: number; orders: number } | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="font-semibold text-fg">{shortDate.format(parseDay(point.date))}</p>
      <p className="mt-1 flex items-center gap-2 text-muted">
        <span className="size-2 rounded-full bg-series-1" aria-hidden />
        <span className="font-semibold text-fg">{formatMoney(point.revenue)}</span> from{" "}
        {point.orders} order{point.orders === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function RevenueChart({ stats }: { stats: DashboardStats }) {
  const data = stats.revenue_by_day.map((d) => ({ ...d, revenue: Number(d.revenue) }));
  return (
    <section className="card p-5 sm:p-6" aria-labelledby="revenue-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="revenue-heading" className="text-base font-semibold text-fg">
            Revenue, last 30 days
          </h2>
          <p className="text-sm text-muted">Captured payments by day (paid, shipped, delivered)</p>
        </div>
        <p className="text-2xl font-semibold tracking-tight text-fg">
          {formatMoney(stats.revenue_30d, stats.currency)}
        </p>
      </div>
      <div
        className="mt-6 h-64"
        role="img"
        aria-label="Area chart of daily revenue for the last 30 days"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.14} />
                <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => shortDate.format(parseDay(value))}
              tick={{ fill: "var(--text-subtle)", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              interval="preserveStartEnd"
              minTickGap={32}
            />
            <YAxis
              tickFormatter={(value: number) => compactMoney.format(value)}
              tick={{ fill: "var(--text-subtle)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              content={<RevenueTooltip />}
              cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--series-1)"
              strokeWidth={2}
              fill="url(#revenue-fill)"
              activeDot={{
                r: 5,
                fill: "var(--series-1)",
                stroke: "var(--surface)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-medium text-muted hover:text-fg">
          Show data table
        </summary>
        <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 text-right font-semibold">Orders</th>
                <th className="px-3 py-2 text-right font-semibold">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((row) => (
                <tr key={row.date}>
                  <td className="px-3 py-1.5 text-fg">{shortDate.format(parseDay(row.date))}</td>
                  <td className="px-3 py-1.5 text-right text-fg tabular-nums">{row.orders}</td>
                  <td className="px-3 py-1.5 text-right text-fg tabular-nums">
                    {formatMoney(row.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

const STATUS_ORDER: OrderStatus[] = [
  "pending_payment",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
  "payment_failed",
];

function StatusChart({ stats }: { stats: DashboardStats }) {
  const data = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: stats.orders_by_status[status],
  }));
  return (
    <section className="card p-5 sm:p-6" aria-labelledby="status-heading">
      <h2 id="status-heading" className="text-base font-semibold text-fg">
        Orders by status
      </h2>
      <p className="text-sm text-muted">{stats.orders_total} orders in total</p>
      <div className="mt-4 h-64" role="img" aria-label="Bar chart of order counts by status">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 32, bottom: 0, left: 0 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--line)" strokeWidth={1} />
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={112}
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const row = payload[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
                    <span className="font-semibold text-fg">{row.label}</span>
                    <span className="text-muted">: {row.count} orders</span>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="count"
              fill="var(--series-1)"
              barSize={16}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="count"
                position="right"
                style={{ fill: "var(--text)", fontSize: 12, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const {
    data: stats,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: adminApi.dashboard,
  });

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="Store performance and inventory at a glance."
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading || !stats ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatTile
              label="Total revenue"
              value={formatMoney(stats.revenue_total, stats.currency)}
              hint="All captured, unrefunded orders"
            />
            <StatTile
              label="Average order value"
              value={formatMoney(stats.average_order_value, stats.currency)}
            />
            <StatTile label="Orders" value={stats.orders_total.toLocaleString("en-US")} />
            <StatTile
              label="Customers"
              value={stats.customers_total.toLocaleString("en-US")}
              hint={`${stats.products_active} active products`}
            />
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <RevenueChart stats={stats} />
            <StatusChart stats={stats} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card p-5 sm:p-6" aria-labelledby="top-heading">
              <h2 id="top-heading" className="text-base font-semibold text-fg">
                Top products
              </h2>
              <p className="text-sm text-muted">By units sold in captured orders</p>
              <ol className="mt-4 divide-y divide-line">
                {stats.top_products.map((product, index) => (
                  <li key={product.product_id} className="flex items-center gap-3 py-3">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold text-muted">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {product.product_name}
                    </span>
                    <span className="text-sm text-muted tabular-nums">{product.units} sold</span>
                    <span className="w-24 text-right text-sm font-semibold text-fg tabular-nums">
                      {formatMoney(product.revenue, stats.currency)}
                    </span>
                  </li>
                ))}
                {stats.top_products.length === 0 && (
                  <li className="py-6 text-center text-sm text-muted">No sales yet.</li>
                )}
              </ol>
            </section>
            <section className="card p-5 sm:p-6" aria-labelledby="low-heading">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="low-heading" className="text-base font-semibold text-fg">
                    Low stock
                  </h2>
                  <p className="text-sm text-muted">Active products with 5 or fewer units</p>
                </div>
                <Link
                  to="/admin/products?low_stock=5"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
                >
                  Manage <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
              {stats.low_stock.length === 0 ? (
                <div className="mt-6 flex items-center gap-2 text-sm text-success">
                  <PackageCheck className="size-4" aria-hidden /> Everything is well stocked.
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {stats.low_stock.map((product) => (
                    <li key={product.id} className="flex items-center gap-3 py-3">
                      <AlertTriangle
                        className={`size-4 shrink-0 ${product.stock === 0 ? "text-danger" : "text-warning"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                        {product.name}
                      </span>
                      <span className="font-mono text-xs text-subtle">{product.sku}</span>
                      <Badge tone={product.stock === 0 ? "danger" : "warning"}>
                        {product.stock === 0 ? "Out of stock" : `${product.stock} left`}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
