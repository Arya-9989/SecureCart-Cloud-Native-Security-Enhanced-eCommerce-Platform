import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AlertCircle, CreditCard, KeyRound, Lock, RotateCcw } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router";
import type { z } from "zod";

import { useAuth } from "@/auth/useAuth";
import { PriceSummary } from "@/components/store/PriceSummary";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/EmptyState";
import { SelectField, TextField } from "@/components/ui/Field";
import { ProductImage, Skeleton } from "@/components/ui/misc";
import { keys, useCart } from "@/hooks/queries";
import { ApiError, errorMessage } from "@/lib/api";
import { orderApi } from "@/lib/endpoints";
import { formatMoney, newIdempotencyKey } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
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

function Step({
  number,
  id,
  title,
  aside,
  children,
}: {
  number: number;
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="border-t border-line py-10 first:border-t-0 first:pt-0"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id={id}
          className="flex items-baseline gap-3 text-[24px] leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]"
        >
          <span className="text-muted tabular-nums" aria-hidden>
            {number}.
          </span>
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function TrustNote({ icon: Icon, children }: { icon: typeof Lock; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-[14px] leading-snug text-muted">
      <Icon className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function CheckoutPage() {
  const { user } = useAuth();
  const { data: cart, isLoading, error, refetch } = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKey = useRef(newIdempotencyKey());
  const [problem, setProblem] = useState<{ message: string; items?: StockProblem[] } | null>(null);
  useDocumentTitle("Checkout");

  const form = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    // Inline validation: a field is checked when you leave it, then live as you fix it.
    mode: "onTouched",
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
  if (isLoading || !cart) {
    return (
      <div className="container-page py-14" aria-busy="true" aria-label="Loading checkout">
        <Skeleton className="h-12 w-56" />
        <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-[22px]" />
        </div>
      </div>
    );
  }
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
    <div className="container-page pt-12 pb-24 sm:pt-16">
      <header>
        <h1 className="type-headline">Checkout.</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted">
          <Lock className="size-4 text-brand" strokeWidth={1.75} aria-hidden />
          Signed in as <span className="font-medium text-fg">{user?.email}</span>
          <span aria-hidden>·</span>
          <Link to="/protection#checkout" className="link">
            How this checkout is protected
          </Link>
        </p>
      </header>

      <form
        noValidate
        onSubmit={(event) => {
          setProblem(null);
          void handleSubmit((values) => {
            placeOrder.mutate(values);
          })(event);
        }}
        className="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16"
      >
        <div className="min-w-0">
          {problem && (
            <div
              role="alert"
              className="mb-10 flex gap-3 rounded-[18px] bg-danger-soft p-5 text-[15px]"
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
                  <p className="mt-1 text-fg">Nothing was charged and your bag is unchanged.</p>
                )}
                {problem.items && (
                  <Link to="/cart" className="link mt-2 inline-block">
                    Review your bag
                  </Link>
                )}
              </div>
            </div>
          )}

          <Step number={1} id="shipping-heading" title="Where should we send it?">
            <div className="grid gap-5 sm:grid-cols-2">
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
          </Step>

          <Step
            number={2}
            id="payment-heading"
            title="How would you like to pay?"
            aside={
              <span className="shrink-0 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-warning">
                Mock provider
              </span>
            }
          >
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">Payment method</legend>
              {PAYMENT_METHODS.map((method) => (
                <label
                  key={method.token}
                  className={clsx(
                    "flex cursor-pointer gap-3 rounded-[18px] border p-5 transition-colors",
                    selectedToken === method.token
                      ? "border-brand ring-1 ring-brand"
                      : "border-line-strong hover:border-muted",
                  )}
                >
                  <input
                    type="radio"
                    value={method.token}
                    className="mt-1 size-4 accent-[var(--action)]"
                    {...register("payment_token")}
                  />
                  <span>
                    <span className="flex items-center gap-2 text-[17px] font-semibold">
                      <CreditCard className="size-4 text-muted" aria-hidden />
                      {method.label}
                    </span>
                    <span className="mt-1 block text-[14px] text-muted">{method.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="mt-5">
              <TrustNote icon={KeyRound}>
                No card details are collected. Your browser sends an opaque payment token, just as
                it would after a real provider tokenised your card.
              </TrustNote>
            </div>
          </Step>

          <Step number={3} id="review-heading" title="Review and place your order.">
            <ul className="divide-y divide-line" aria-label="Items in this order">
              {cart.items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 py-3">
                  <div className="studio size-16 shrink-0 overflow-hidden rounded-[14px]">
                    <ProductImage
                      src={item.product.image_url}
                      alt=""
                      className="size-full"
                      sizes="sm"
                    />
                  </div>
                  <p className="min-w-0 flex-1 text-[15px]">
                    <span className="font-medium">{item.product.name}</span>
                    <span className="block text-[13px] text-muted">Qty {item.quantity}</span>
                  </p>
                  <p className="text-[15px] tabular-nums">{formatMoney(item.line_total)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-8 space-y-3">
              <TrustNote icon={Lock}>
                When you place the order, stock for every item is locked and reserved together, then
                your payment is taken. If anything is short, nothing is charged.
              </TrustNote>
              <TrustNote icon={RotateCcw}>
                Retrying is safe: each attempt carries an idempotency key, so you are never charged
                twice.
              </TrustNote>
            </div>
            <Button
              type="submit"
              size="lg"
              className="mt-8 w-full sm:w-auto sm:min-w-72"
              loading={placeOrder.isPending}
            >
              Place order · {formatMoney(cart.total, cart.currency)}
            </Button>
          </Step>
        </div>

        <aside
          className="rounded-[22px] bg-surface-2 p-6 sm:p-7 lg:sticky lg:top-20"
          aria-label="Order summary"
        >
          <h2 className="text-[21px] font-semibold tracking-[-0.02em]">Order summary</h2>
          <p className="mt-1 text-[14px] text-muted">
            {cart.item_count} item{cart.item_count === 1 ? "" : "s"}
          </p>
          <div className="mt-6">
            <PriceSummary
              subtotal={cart.subtotal}
              shipping={cart.shipping}
              tax={cart.tax}
              total={cart.total}
              currency={cart.currency}
            />
          </div>
          <Link to="/cart" className="link mt-6 inline-block text-[15px]">
            Edit bag
          </Link>
        </aside>
      </form>
    </div>
  );
}
