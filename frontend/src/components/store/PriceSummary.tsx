import { clsx } from "clsx";

import { formatMoney } from "@/lib/format";

export const FREE_SHIPPING_THRESHOLD = 75;

export function PriceSummary({
  subtotal,
  shipping,
  tax,
  total,
  currency = "USD",
  showFreeShippingHint = false,
  large = false,
}: {
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  currency?: string;
  showFreeShippingHint?: boolean;
  large?: boolean;
}) {
  const sub = Number.parseFloat(subtotal);
  const remaining = FREE_SHIPPING_THRESHOLD - sub;
  const progress = Math.min(100, (sub / FREE_SHIPPING_THRESHOLD) * 100);
  const row = clsx("flex justify-between gap-6", large ? "text-[17px]" : "text-[15px]");
  return (
    <div>
      {showFreeShippingHint && sub > 0 && (
        <div className="mb-6">
          <p className="text-[15px] text-fg">
            {remaining > 0 ? (
              <>
                Add <span className="font-semibold">{formatMoney(remaining, currency)}</span> more
                for free shipping.
              </>
            ) : (
              <span className="font-medium text-success">Your order ships free.</span>
            )}
          </p>
          <div
            className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Progress towards free shipping"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div
              className="h-full origin-left rounded-full bg-action transition-transform duration-300 ease-(--ease-apple)"
              style={{ transform: `scaleX(${progress / 100})` }}
            />
          </div>
        </div>
      )}
      <dl className="space-y-2.5">
        <div className={row}>
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-fg tabular-nums">{formatMoney(subtotal, currency)}</dd>
        </div>
        <div className={row}>
          <dt className="text-muted">Shipping</dt>
          <dd className="text-fg tabular-nums">
            {Number.parseFloat(shipping) === 0 && sub > 0
              ? "Free"
              : formatMoney(shipping, currency)}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted">Estimated tax</dt>
          <dd className="text-fg tabular-nums">{formatMoney(tax, currency)}</dd>
        </div>
        <div
          className={clsx(
            "flex justify-between gap-6 border-t border-line pt-3.5 font-semibold",
            large ? "text-[24px] tracking-[-0.02em]" : "text-[17px]",
          )}
        >
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(total, currency)}</dd>
        </div>
      </dl>
    </div>
  );
}
