import { AlertCircle, ArrowRight, Lock, ShoppingBag, Trash2 } from "lucide-react";
import { Link } from "react-router";

import { PriceSummary } from "@/components/store/PriceSummary";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { ProductImage, QuantityStepper, Skeleton } from "@/components/ui/misc";
import { useCart, useRemoveCartItem, useUpdateCartItem } from "@/hooks/queries";
import { formatMoney } from "@/lib/format";
import type { CartItem } from "@/lib/types";

const MAX_PER_LINE = 10;

function CartLine({ item }: { item: CartItem }) {
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const busy = update.isPending || remove.isPending;
  const max = Math.max(1, Math.min(item.product.stock, MAX_PER_LINE));
  return (
    <li className="flex gap-4 py-5 sm:gap-5">
      <Link
        to={`/products/${item.product.slug}`}
        className="size-24 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2 sm:size-28"
      >
        <ProductImage src={item.product.image_url} alt={item.product.name} className="size-full" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              to={`/products/${item.product.slug}`}
              className="font-semibold text-fg hover:text-brand"
            >
              {item.product.name}
            </Link>
            <p className="mt-0.5 text-sm text-muted">{formatMoney(item.product.price)} each</p>
          </div>
          <p className="font-semibold text-fg tabular-nums">{formatMoney(item.line_total)}</p>
        </div>
        {!item.is_available && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-danger">
            <AlertCircle className="size-4" aria-hidden />
            {item.product.stock > 0 && item.product.is_active
              ? `Only ${item.product.stock} available. Reduce the quantity to continue.`
              : "No longer available. Remove it to continue."}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-3">
          <QuantityStepper
            size="sm"
            label={`Quantity of ${item.product.name}`}
            value={item.quantity}
            max={Math.max(max, item.quantity)}
            disabled={busy}
            onChange={(quantity) => {
              update.mutate({ itemId: item.id, quantity });
            }}
          />
          <button
            type="button"
            onClick={() => {
              remove.mutate(item.id);
            }}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-50"
            aria-label={`Remove ${item.product.name} from cart`}
          >
            <Trash2 className="size-4" aria-hidden />
            <span className="hidden sm:inline">Remove</span>
          </button>
        </div>
      </div>
    </li>
  );
}

export function CartPage() {
  const { data: cart, isLoading, error, refetch } = useCart();

  if (error) {
    return (
      <div className="container-page py-16">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (isLoading || !cart) {
    return (
      <div className="container-page py-10">
        <Skeleton className="h-9 w-48" />
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          description="Browse the collection and add something you love."
          action={
            <Link to="/shop" className={buttonClasses("primary")}>
              Start shopping
            </Link>
          }
        />
      </div>
    );
  }

  const blocked = cart.items.some((item) => !item.is_available);

  return (
    <div className="container-page py-10">
      <h1 className="text-3xl font-bold tracking-tight text-fg">Your cart</h1>
      <p className="mt-1 text-sm text-muted">
        {cart.item_count} item{cart.item_count === 1 ? "" : "s"}
      </p>
      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[1fr_380px]">
        <ul className="divide-y divide-line border-y border-line" aria-label="Cart items">
          {cart.items.map((item) => (
            <CartLine key={item.id} item={item} />
          ))}
        </ul>
        <aside className="card p-6 lg:sticky lg:top-24" aria-label="Order summary">
          <h2 className="mb-5 text-lg font-semibold text-fg">Order summary</h2>
          <PriceSummary
            subtotal={cart.subtotal}
            shipping={cart.shipping}
            tax={cart.tax}
            total={cart.total}
            currency={cart.currency}
            showFreeShippingHint
          />
          {blocked ? (
            <p className="mt-6 rounded-xl bg-danger-soft p-3 text-sm text-danger">
              Some items need attention before you can check out.
            </p>
          ) : null}
          <Link
            to="/checkout"
            aria-disabled={blocked}
            onClick={(event) => {
              if (blocked) event.preventDefault();
            }}
            className={buttonClasses(
              "primary",
              "lg",
              `mt-6 w-full ${blocked ? "pointer-events-none opacity-55" : ""}`,
            )}
          >
            Checkout <ArrowRight className="size-4" aria-hidden />
          </Link>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted">
            <Lock className="size-3.5" aria-hidden /> Stock is reserved only when you place the
            order.
          </p>
        </aside>
      </div>
    </div>
  );
}
