import { AlertCircle, Lock, ShoppingBag } from "lucide-react";
import { Link } from "react-router";

import { PriceSummary } from "@/components/store/PriceSummary";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { ProductImage, QuantityStepper, Skeleton } from "@/components/ui/misc";
import { useCart, useRemoveCartItem, useUpdateCartItem } from "@/hooks/queries";
import { formatMoney } from "@/lib/format";
import { STORE_RULES } from "@/lib/storeRules";
import type { CartItem } from "@/lib/types";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

function BagLine({ item }: { item: CartItem }) {
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const busy = update.isPending || remove.isPending;
  const max = Math.max(1, Math.min(item.product.stock, STORE_RULES.maxPerLine));
  return (
    <li className="grid grid-cols-[96px_1fr] gap-5 py-8 sm:grid-cols-[180px_1fr] sm:gap-8">
      <Link
        to={`/products/${item.product.slug}`}
        className="studio block overflow-hidden rounded-[18px]"
        tabIndex={-1}
        aria-hidden
      >
        <ProductImage src={item.product.image_url} alt="" className="aspect-[4/3] w-full" />
      </Link>
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <Link
              to={`/products/${item.product.slug}`}
              className="text-[21px] leading-tight font-semibold tracking-[-0.02em] hover:underline"
            >
              {item.product.name}
            </Link>
            <p className="mt-1 text-[14px] text-muted">{formatMoney(item.product.price)} each</p>
          </div>
          <p className="text-[21px] tracking-[-0.02em] tabular-nums sm:text-right">
            {formatMoney(item.line_total)}
          </p>
        </div>
        {!item.is_available && (
          <p className="mt-3 flex items-start gap-1.5 text-[14px] font-medium text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {item.product.stock > 0 && item.product.is_active
              ? `Only ${item.product.stock} available. Reduce the quantity to continue.`
              : "No longer available. Remove it to continue."}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-4 pt-5">
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
            className="inline-flex h-11 items-center rounded-sm text-[15px] text-brand hover:underline disabled:opacity-50"
            aria-label={`Remove ${item.product.name} from bag`}
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

export function CartPage() {
  const { data: cart, isLoading, error, refetch } = useCart();
  useDocumentTitle("Bag");

  if (error) {
    return (
      <div className="container-page py-16">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (isLoading || !cart) {
    return (
      <div className="container-text py-16" aria-busy="true">
        <Skeleton className="mx-auto h-12 w-96 max-w-full" />
        <Skeleton className="mx-auto mt-6 h-11 w-40 rounded-full" />
        <div className="mt-14 space-y-6">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="grid grid-cols-[96px_1fr] gap-5 sm:grid-cols-[180px_1fr]">
              <Skeleton className="aspect-[4/3] rounded-[18px]" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="container-text py-16">
        <EmptyState
          icon={ShoppingBag}
          pageHeading
          title="Your bag is empty."
          description="It's saved to your account, so anything you add shows up on every device you sign in on."
          action={
            <Link to="/shop" className={buttonClasses("primary")}>
              Continue shopping
            </Link>
          }
        />
      </div>
    );
  }

  const blocked = cart.items.some((item) => !item.is_available);
  const checkout = (
    <Link
      to="/checkout"
      aria-disabled={blocked}
      onClick={(event) => {
        if (blocked) event.preventDefault();
      }}
      className={buttonClasses("primary", "lg", `min-w-56 ${blocked ? "pointer-events-none" : ""}`)}
    >
      Check out
    </Link>
  );

  return (
    <div className="container-text pt-14 pb-24 sm:pt-20">
      <header className="text-center">
        <h1 className="type-headline">
          Your bag total is {formatMoney(cart.total, cart.currency)}.
        </h1>
        <p className="mt-3 text-[17px] text-muted">
          {cart.item_count} item{cart.item_count === 1 ? "" : "s"}. Stock is reserved only when you
          place the order.
        </p>
        <div className="mt-7 flex justify-center">{checkout}</div>
      </header>

      <ul className="mt-14 divide-y divide-line border-y border-line" aria-label="Bag items">
        {cart.items.map((item) => (
          <BagLine key={item.id} item={item} />
        ))}
      </ul>

      <section
        aria-label="Order summary"
        className="mt-10 ml-auto max-w-[480px] sm:max-w-none sm:pl-[212px] lg:pl-[300px]"
      >
        <PriceSummary
          subtotal={cart.subtotal}
          shipping={cart.shipping}
          tax={cart.tax}
          total={cart.total}
          currency={cart.currency}
          showFreeShippingHint
          large
        />
        {blocked && (
          <p
            role="status"
            className="mt-6 flex gap-2 rounded-2xl bg-danger-soft p-4 text-[15px] text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Some items need attention before you can check out.
          </p>
        )}
        <div className="mt-8 flex justify-end">{checkout}</div>
        <p className="mt-5 flex items-start justify-end gap-2 text-right text-[13px] text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Your bag is kept on our server and checked against live stock.{" "}
            <Link to="/protection#bag" className="link">
              How we protect it
            </Link>
          </span>
        </p>
      </section>
    </div>
  );
}
