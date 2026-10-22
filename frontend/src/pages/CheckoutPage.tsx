import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AlertCircle, CreditCard, Lock, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router";
import type { z } from "zod";

import { useAuth } from "@/auth/useAuth";
import { PriceSummary } from "@/components/store/PriceSummary";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/EmptyState";
import { SelectField, TextField } from "@/components/ui/Field";
import { PageSpinner } from "@/components/ui/Spinner";
import { ProductImage } from "@/components/ui/misc";
import { keys, useCart } from "@/hooks/queries";
import { ApiError, errorMessage } from "@/lib/api";
import { orderApi } from "@/lib/endpoints";
import { formatMoney, newIdempotencyKey } from "@/lib/format";
import { COUNTRIES, checkoutSchema } from "@/lib/validation";

const PAYMENT_METHODS = [
  {
    token: "tok_mock_approve",
    label: "Test card: approve",
    description: "The mock provider captures the payment.",
  },
  {
    token: "tok_mock_decline",
    label: "Test card: decline",
    description: "Simulates a declined card so you can see stock being released.",
  },
] as const;

type CheckoutForm = z.infer<typeof checkoutSchema>;

interface StockProblem {
  product_id: number;
  name: string;
  requested: number;
  available: number;
}

export function CheckoutPage() {
  const { user } = useAuth();
  const { data: cart, isLoading, error, refetch } = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKey = useRef(newIdempotencyKey());
  const [problem, setProblem] = useState<{ message: string; items?: StockProblem[] } | null>(null);

  const form = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      name: user?.full_name ?? "",
      line1: "",
      line2: "",
      city: "",
      postal_code: "",
      country: "US",
      payment_token: "tok_mock_approve",
    },
  });

  const placeOrder = useMutation({
    mutationFn: ({ payment_token, ...address }: CheckoutForm) =>
      orderApi.checkout({ shipping_address: address, payment_token }, idempotencyKey.current),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: keys.cart });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.setQueryData(keys.order(order.id), order);
      void navigate(`/orders/${order.id}?placed=1`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && [402, 409].includes(err.status)) {
        // The server reached a final decision for this key; the next attempt needs a new one.
        idempotencyKey.current = newIdempotencyKey();
        const items = (err.body as { error?: { items?: StockProblem[] } }).error?.items;
        setProblem({ message: err.message, items: items?.length ? items : undefined });
        void queryClient.invalidateQueries({ queryKey: keys.cart });
      } else if (!(err instanceof ApiError && err.status === 400)) {
        setProblem({ message: errorMessage(err) });
      }
    },
  });

  if (error) {
    return (
      <div className="container-page py-16">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isLoading || !cart) return <PageSpinner label="Loading checkout" />;
  if (cart.items.length === 0 && !placeOrder.isSuccess) return <Navigate to="/cart" replace />;

  const { register, handleSubmit, formState, watch } = form;
  const serverError = (field: string) =>
    placeOrder.error instanceof ApiError
      ? placeOrder.error.fieldError(`shipping_address.${field}`)
      : undefined;
  const fieldError = (name: keyof CheckoutForm) =>
    formState.errors[name]?.message ?? serverError(name);
  const selectedToken = watch("payment_token");

  return (
    <div className="container-page py-10">
      <h1 className="text-3xl font-bold tracking-tight text-fg">Checkout</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <Lock className="size-3.5" aria-hidden /> Signed in as {user?.email}
      </p>

      <form
        noValidate
        onSubmit={(event) => {
          setProblem(null);
          void handleSubmit((values) => {
            placeOrder.mutate(values);
          })(event);
        }}
        className="mt-8 grid items-start gap-10 lg:grid-cols-[1fr_400px]"
      >
        <div className="space-y-8">
          {problem && (
            <div
              role="alert"
              className="flex gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm"
            >
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
              <div>
                <p className="font-semibold text-danger">{problem.message}</p>
                {problem.items ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-fg">
                    {problem.items.map((item) => (
                      <li key={item.product_id}>
                        {item.name}: requested {item.requested}, {item.available} available
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-fg">Nothing was charged and your cart is unchanged.</p>
                )}
                {problem.items && (
                  <Link to="/cart" className="mt-2 inline-block font-semibold text-brand">
                    Review your cart
                  </Link>
                )}
              </div>
            </div>
          )}

          <section className="card p-6" aria-labelledby="shipping-heading">
            <h2 id="shipping-heading" className="text-lg font-semibold text-fg">
              Shipping address
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <TextField
                label="Full name"
                autoComplete="name"
                wrapperClassName="sm:col-span-2"
                error={fieldError("name")}
                {...register("name")}
              />
              <TextField
                label="Street address"
                autoComplete="address-line1"
                wrapperClassName="sm:col-span-2"
                error={fieldError("line1")}
                {...register("line1")}
              />
              <TextField
                label="Apartment, suite (optional)"
                autoComplete="address-line2"
                wrapperClassName="sm:col-span-2"
                error={fieldError("line2")}
                {...register("line2")}
              />
              <TextField
                label="City"
                autoComplete="address-level2"
                error={fieldError("city")}
                {...register("city")}
              />
              <TextField
                label="Postal code"
                autoComplete="postal-code"
                error={fieldError("postal_code")}
                {...register("postal_code")}
              />
              <SelectField
                label="Country"
                autoComplete="country"
                wrapperClassName="sm:col-span-2"
                error={fieldError("country")}
                {...register("country")}
              >
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </SelectField>
            </div>
          </section>

          <section className="card p-6" aria-labelledby="payment-heading">
            <div className="flex items-center justify-between gap-4">
              <h2 id="payment-heading" className="text-lg font-semibold text-fg">
                Payment
              </h2>
              <span className="rounded-md bg-warning-soft px-2 py-1 text-xs font-semibold text-warning">
                Mock provider
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              No card details are collected. The client sends an opaque payment token, just as it
              would after tokenising a card with a real provider.
            </p>
            <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">Payment method</legend>
              {PAYMENT_METHODS.map((method) => (
                <label
                  key={method.token}
                  className={clsx(
                    "flex cursor-pointer gap-3 rounded-xl border p-4 transition",
                    selectedToken === method.token
                      ? "border-brand bg-brand-soft/60 ring-4 ring-brand/10"
                      : "border-line-strong hover:border-brand/40",
                  )}
                >
                  <input
                    type="radio"
                    value={method.token}
                    className="mt-1 accent-[var(--brand)]"
                    {...register("payment_token")}
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                      <CreditCard className="size-4 text-muted" aria-hidden />
                      {method.label}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{method.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>
        </div>

        <aside className="card p-6 lg:sticky lg:top-24" aria-label="Order summary">
          <h2 className="text-lg font-semibold text-fg">Order summary</h2>
          <ul className="mt-5 space-y-4">
            {cart.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
                  <ProductImage src={item.product.image_url} alt="" className="size-full" />
                  <span className="absolute -top-0 -right-0 flex size-5 items-center justify-center rounded-bl-lg bg-fg text-[10px] font-bold text-bg">
                    {item.quantity}
                  </span>
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                  {item.product.name}
                </p>
                <p className="text-sm font-medium text-fg tabular-nums">
                  {formatMoney(item.line_total)}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-6 border-t border-line pt-6">
            <PriceSummary
              subtotal={cart.subtotal}
              shipping={cart.shipping}
              tax={cart.tax}
              total={cart.total}
              currency={cart.currency}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="mt-6 w-full"
            loading={placeOrder.isPending}
            icon={<ShieldCheck className="size-4" aria-hidden />}
          >
            Place order · {formatMoney(cart.total, cart.currency)}
          </Button>
          <p className="mt-3 text-center text-xs text-muted">
            Retrying is safe: each attempt carries an idempotency key, so you are never charged
            twice.
          </p>
        </aside>
      </form>
    </div>
  );
}
