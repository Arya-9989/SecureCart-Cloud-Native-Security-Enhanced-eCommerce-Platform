import { formatMoney } from "@/lib/format";

export const FREE_SHIPPING_THRESHOLD = 75;

export function PriceSummary({
  subtotal,
  shipping,
  tax,
  total,
  currency = "USD",
  showFreeShippingHint = false,
}: {
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  currency?: string;
  showFreeShippingHint?: boolean;
}) {
  const sub = Number.parseFloat(subtotal);
  const remaining = FREE_SHIPPING_THRESHOLD - sub;
  const progress = Math.min(100, (sub / FREE_SHIPPING_THRESHOLD) * 100);
  return (
    <div>
      {showFreeShippingHint && sub > 0 && (
        <div className="mb-5 rounded-xl bg-surface-2 p-3.5">
          <p className="text-sm text-fg">
            {remaining > 0 ? (
              <>
                Add <span className="font-semibold">{formatMoney(remaining, currency)}</span> more
                for free shipping.
              </>
            ) : (
              <span className="font-semibold text-success">You've unlocked free shipping.</span>
            )}
          </p>
          <div
            className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Progress towards free shipping"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="font-medium text-fg tabular-nums">{formatMoney(subtotal, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Shipping</dt>
          <dd className="font-medium text-fg tabular-nums">
            {Number.parseFloat(shipping) === 0 && sub > 0 ? (
              <span className="text-success">Free</span>
            ) : (
              formatMoney(shipping, currency)
            )}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Estimated tax</dt>
          <dd className="font-medium text-fg tabular-nums">{formatMoney(tax, currency)}</dd>
        </div>
        <div className="flex justify-between border-t border-line pt-3 text-base">
          <dt className="font-semibold text-fg">Total</dt>
          <dd className="font-bold text-fg tabular-nums">{formatMoney(total, currency)}</dd>
        </div>
      </dl>
    </div>
  );
}
