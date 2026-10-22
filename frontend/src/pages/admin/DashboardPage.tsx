import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, PackageCheck, XCircle } from "lucide-react";
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
import { ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/misc";
import { adminApi } from "@/lib/endpoints";
import { STATUS_LABELS, formatMoney } from "@/lib/format";
import type { DashboardStats, OrderStatus } from "@/lib/types";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

/*
 * Chart conventions (dataviz skill): one series per chart in --series-1, validated against
 * both surfaces; 2px lines with a 10% wash; bars at most 24px thick with 4px rounded data
 * ends and square baselines; hairline recessive grid; text always in text tokens; a
 * crosshair tooltip on the line and per-bar tooltips; every value also reachable without
 * hovering (direct labels or the table view).
 */
/** Axis ticks in the store's own currency (the API reports it), never a hard-coded one. */
function compactMoney(currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  });
}
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const axisTick = { fill: "var(--text-muted)", fontSize: 12, fontVariantNumeric: "tabular-nums" };

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function Card({
  children,
  className = "",
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  labelledBy: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`rounded-[22px] border border-line bg-surface p-6 sm:p-7 ${className}`}
    >
      {children}
    </section>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[18px] bg-surface-2 p-5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1.5 text-[24px] leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">
        {value}
      </p>
      {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

function RevenueTooltip({
  active,
  payload,
  currency,
}: Partial<TooltipContentProps<number, string>> & { currency: string }) {
  const point = payload?.[0]?.payload as
    { date: string; revenue: number; orders: number } | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-[12px] border border-line bg-surface px-3.5 py-2.5 shadow-pop">
      <p className="text-[12px] text-muted">{shortDate.format(parseDay(point.date))}</p>
      <p className="mt-1 flex items-center gap-2">
        <span className="h-0.5 w-3 rounded-full bg-series-1" aria-hidden />
        <span className="text-[15px] font-semibold tabular-nums">
          {formatMoney(point.revenue, currency)}
        </span>
      </p>
      <p className="mt-0.5 text-[12px] text-muted">
        {point.orders} order{point.orders === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function RevenueChart({ stats }: { stats: DashboardStats }) {
  const data = stats.revenue_by_day.map((d) => ({ ...d, revenue: Number(d.revenue) }));
  const orders30 = data.reduce((sum, d) => sum + d.orders, 0);
  return (
    <Card labelledBy="revenue-heading">
      <h2 id="revenue-heading" className="text-[15px] font-medium text-muted">
        Revenue, last 30 days
      </h2>
      {/* The hero figure: the one number this dashboard leads with. */}
      <p className="mt-1 text-[48px] leading-none font-semibold tracking-[-0.03em] sm:text-[56px]">
        {formatMoney(stats.revenue_30d, stats.currency)}
      </p>
      <p className="mt-2 text-[14px] text-muted">
        Captured payments by day (paid, shipped and delivered) from {orders30} order
        {orders30 === 1 ? "" : "s"}.
      </p>
      <div
        className="mt-6 h-64"
        role="img"
        aria-label={`Area chart of daily revenue for the last 30 days, totalling ${formatMoney(stats.revenue_30d, stats.currency)}. The data table below lists every day.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => shortDate.format(parseDay(value))}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: "var(--line-strong)" }}
              interval="preserveStartEnd"
              minTickGap={40}
              tickMargin={8}
            />
            <YAxis
              tickFormatter={(value: number) => compactMoney(stats.currency).format(value)}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              content={<RevenueTooltip currency={stats.currency} />}
              cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="var(--series-1)"
              fillOpacity={0.1}
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
      <details className="group mt-5">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm text-[14px] text-brand hover:underline [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
          Show data table
        </summary>
        <div
          className="mt-3 max-h-64 overflow-auto rounded-[14px] border border-line"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard scrolling
          tabIndex={0}
          role="region"
          aria-label="Daily revenue table"
        >
          <table className="w-full text-left text-[14px]">
            <caption className="sr-only">Daily revenue and orders, last 30 days</caption>
            <thead className="sticky top-0 bg-surface-2 text-[12px] text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Orders
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((row) => (
                <tr key={row.date}>
                  <td className="px-3 py-1.5">{shortDate.format(parseDay(row.date))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.orders}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatMoney(row.revenue, stats.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
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
    <Card labelledBy="status-heading">
      <h2 id="status-heading" className="text-[15px] font-medium text-muted">
        Orders by status
      </h2>
      <p className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.02em]">
        {stats.orders_total.toLocaleString("en-US")}{" "}
        <span className="text-[17px] font-normal text-muted">orders in total</span>
      </p>
      <div
        className="mt-5 h-64"
        role="img"
        aria-label={`Bar chart of orders by status: ${data.map((d) => `${d.label} ${d.count}`).join(", ")}.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 36, bottom: 0, left: 0 }}
            barCategoryGap={10}
          >
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={132}
              tick={{ fill: "var(--text-muted)", fontSize: 13 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line-strong)" }}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const row = payload[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-[12px] border border-line bg-surface px-3.5 py-2.5 shadow-pop">
                    <p className="text-[15px] font-semibold tabular-nums">{row.count}</p>
                    <p className="text-[12px] text-muted">{row.label}</p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="count"
              fill="var(--series-1)"
              barSize={20}
              // A zero still gets a hairline mark, so its value label renders.
              minPointSize={2}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="count"
                position="right"
                offset={8}
                style={{ fill: "var(--text)", fontSize: 13, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function TopProducts({ stats }: { stats: DashboardStats }) {
  const maxUnits = Math.max(1, ...stats.top_products.map((p) => p.units));
  return (
    <Card labelledBy="top-heading">
      <h2 id="top-heading" className="text-[21px] font-semibold tracking-[-0.02em]">
        Top products
      </h2>
      <p className="text-[14px] text-muted">Units sold in captured orders</p>
      <ol className="mt-5 space-y-4">
        {stats.top_products.map((product) => (
          <li key={product.product_id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[15px] font-medium">
                {product.product_name}
              </span>
              <span className="shrink-0 text-[14px] tabular-nums">
                {formatMoney(product.revenue, stats.currency)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              {/* Meter: track is a lighter step of the same hue as the fill. */}
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--series-wash)]"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-series-1"
                  style={{ width: `${(product.units / maxUnits) * 100}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-[13px] text-muted tabular-nums">
                {product.units} sold
              </span>
            </div>
          </li>
        ))}
        {stats.top_products.length === 0 && (
          <li className="py-6 text-center text-[15px] text-muted">No sales yet.</li>
        )}
      </ol>
    </Card>
  );
}

function LowStock({ stats }: { stats: DashboardStats }) {
  return (
    <Card labelledBy="low-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="low-heading" className="text-[21px] font-semibold tracking-[-0.02em]">
            Low stock
          </h2>
          <p className="text-[14px] text-muted">Active products with 5 or fewer units</p>
        </div>
        <Link
          to="/admin/products?low_stock=5"
          className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-sm text-[14px] text-brand hover:underline"
        >
          Manage <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      {stats.low_stock.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 text-[15px] text-success">
          <PackageCheck className="size-4" aria-hidden /> Everything is well stocked.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {stats.low_stock.map((product) => {
            const out = product.stock === 0;
            const Icon = out ? XCircle : AlertTriangle;
            return (
              <li key={product.id} className="flex items-center gap-3 py-3">
                <Icon
                  className={`size-4 shrink-0 ${out ? "text-danger" : "text-warning"}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{product.name}</span>
                  <span className="font-mono text-[12px] text-muted">{product.sku}</span>
                </span>
                <span
                  className={`shrink-0 text-[14px] font-medium ${out ? "text-danger" : "text-warning"}`}
                >
                  {out ? "Out of stock" : `${product.stock} left`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-[22px] border border-line p-7">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-12 w-56" />
          <Skeleton className="mt-8 h-64 w-full" />
        </div>
        <div className="rounded-[22px] border border-line p-7">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-8 w-40" />
          <Skeleton className="mt-8 h-64 w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-[18px]" />
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  useDocumentTitle("Admin dashboard");
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
        <DashboardSkeleton />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <RevenueChart stats={stats} />
            <StatusChart stats={stats} />
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
          <div className="grid gap-4 lg:grid-cols-2">
            <TopProducts stats={stats} />
            <LowStock stats={stats} />
          </div>
        </div>
      )}
    </>
  );
}
