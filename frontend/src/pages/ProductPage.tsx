import { clsx } from "clsx";
import { Check, Lock, PackageX, RefreshCcw, Truck } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router";

import { Shelf, ShelfItem } from "@/components/store/Shelf";
import { useProductLink } from "@/components/store/useProductLink";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { ProductImage, QuantityStepper, Skeleton, StockBadge } from "@/components/ui/misc";
import { Reveal } from "@/components/ui/Reveal";
import { useAddToCart, useProduct, useProducts } from "@/hooks/queries";
import { useAddedFlash } from "@/hooks/useAddedFlash";
import { ApiError } from "@/lib/api";
import { relatedQuery } from "@/lib/catalogQueries";
import { NoIndex } from "@/lib/NoIndex";
import { formatMoney } from "@/lib/format";
import { FLAT_SHIPPING_FEE, FREE_SHIPPING_FROM, STORE_RULES } from "@/lib/storeRules";
import type { Product } from "@/lib/types";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const { freeShippingFrom, maxPerLine } = STORE_RULES;

/*
 * Gallery views. The catalog has one studio illustration per product, so the second view
 * is a true close-up of that same artwork rather than an invented angle.
 */
const VIEWS = [
  { id: "studio", label: "Studio view", scale: 1 },
  { id: "detail", label: "Close-up", scale: 1.65 },
] as const;

function Gallery({ product }: { product: Product }) {
  const [index, setIndex] = useState(0);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") setIndex((i) => (i + 1) % VIEWS.length);
    if (event.key === "ArrowLeft") setIndex((i) => (i - 1 + VIEWS.length) % VIEWS.length);
  };
  return (
    <div>
      {/* The view-transition target for P7: a pressed product card morphs into this box. */}
      <div
        className="studio relative aspect-[4/3] overflow-hidden rounded-[28px]"
        data-vt="product-art"
        data-product-gallery=""
      >
        {/* Both views stay mounted and cross-fade (opacity only, 320ms, Apple's ease). */}
        {VIEWS.map((v, i) => (
          <div
            key={v.id}
            className={clsx(
              "absolute inset-0 transition-opacity duration-[320ms] ease-(--ease-apple)",
              i === index ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={i !== index}
          >
            <ProductImage
              src={product.image_url}
              alt={i === index ? `${product.name}, ${v.label.toLowerCase()}` : ""}
              eager={i === 0}
              className="size-full"
              // Close-up: scale the same art around its optical centre.
              style={{ transform: `scale(${v.scale})`, transformOrigin: "50% 62%" }}
            />
          </div>
        ))}
      </div>
      <div
        role="radiogroup"
        aria-label="Product views"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="mt-4 flex justify-center"
      >
        <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
          {VIEWS.map((v, i) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={i === index}
              tabIndex={i === index ? 0 : -1}
              onClick={() => {
                setIndex(i);
              }}
              className={clsx(
                "hit rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors",
                i === index ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrustList({ product }: { product: Product }) {
  const freeOnItsOwn = Number.parseFloat(product.price) >= freeShippingFrom;
  const rows = [
    {
      icon: Truck,
      title: freeOnItsOwn ? "Ships free" : `Free shipping from ${FREE_SHIPPING_FROM}`,
      text: freeOnItsOwn
        ? `This item alone clears the ${FREE_SHIPPING_FROM} free-shipping threshold.`
        : `Below that, shipping is a flat ${FLAT_SHIPPING_FEE}.`,
    },
    {
      icon: Lock,
      title: "Never oversold",
      text: "Stock is locked and reserved the moment you place your order, all lines together.",
    },
    {
      icon: RefreshCcw,
      title: "Cancel until it ships",
      text: "Cancelling puts the stock back and refunds the payment automatically.",
    },
  ];
  return (
    <ul className="mt-8 divide-y divide-line rounded-[18px] border border-line">
      {rows.map(({ icon: Icon, title, text }) => (
        <li key={title} className="flex gap-3.5 p-4">
          <Icon className="mt-0.5 size-5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
          <div>
            <p className="text-[15px] font-semibold">{title}</p>
            <p className="text-[14px] text-muted">{text}</p>
          </div>
        </li>
      ))}
      <li className="p-4 text-[14px]">
        <Link to="/protection#checkout" className="link inline-block py-1">
          How your order is protected
        </Link>
      </li>
    </ul>
  );
}

function PurchasePanel({
  product,
  buyRef,
}: {
  product: Product;
  buyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [quantity, setQuantity] = useState(1);
  const { add, isPending } = useAddToCart();
  const [added, flashAdded] = useAddedFlash();
  const max = Math.max(1, Math.min(product.stock, maxPerLine));
  const soldOut = product.stock <= 0;

  return (
    <div className="flex flex-col">
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link to="/shop" className="inline-block py-1 hover:text-fg hover:underline">
              Shop
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link
              to={`/shop?category=${product.category.slug}`}
              className="inline-block py-1 hover:text-fg hover:underline"
            >
              {product.category.name}
            </Link>
          </li>
        </ol>
      </nav>
      {product.is_featured && <p className="type-eyebrow mt-4 text-muted">Featured</p>}
      <h1 className={clsx("type-headline", product.is_featured ? "mt-1" : "mt-4")}>
        {product.name}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-[24px] tracking-[-0.02em] tabular-nums">{formatMoney(product.price)}</p>
        <StockBadge stock={product.stock} />
      </div>
      <p className="type-body-lg mt-6 text-muted">{product.description}</p>

      <div ref={buyRef} className="mt-8 flex flex-wrap items-center gap-3">
        <QuantityStepper
          label="Quantity"
          value={quantity}
          max={max}
          onChange={setQuantity}
          disabled={soldOut}
        />
        <Button
          size="lg"
          className="min-w-44 flex-1 sm:flex-none"
          disabled={soldOut}
          loading={isPending}
          icon={added ? <AddedIcon /> : undefined}
          onClick={() => {
            add(product, quantity, { onAdded: flashAdded });
          }}
        >
          {soldOut ? "Sold out" : added ? "Added" : "Add to Bag"}
        </Button>
      </div>
      {!soldOut && product.stock <= 5 && (
        <p className="mt-3 text-[14px] font-medium text-warning">
          Only {product.stock} left. Stock is checked again when you place the order.
        </p>
      )}
      <TrustList product={product} />
      <dl className="mt-6 flex gap-8 text-[13px]">
        <div>
          <dt className="text-muted">SKU</dt>
          <dd className="mt-0.5 font-mono text-fg">{product.sku}</dd>
        </div>
        <div>
          <dt className="text-muted">Category</dt>
          <dd className="mt-0.5 text-fg">{product.category.name}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Appears under the global nav once the main Add to Bag button scrolls out of view. */
function StickyBuyBar({
  product,
  buyRef,
}: {
  product: Product;
  buyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [visible, setVisible] = useState(false);
  const { add, isPending } = useAddToCart();
  const [added, flashAdded] = useAddedFlash();
  const soldOut = product.stock <= 0;

  useEffect(() => {
    const el = buyRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { rootMargin: "-48px 0px 0px 0px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [buyRef]);

  return (
    <div
      // Out of view it is display:none, not just transparent, so no invisible text lingers;
      // it slides in from @starting-style and slides out before display flips (discrete).
      className={clsx(
        "glass fixed inset-x-0 top-12 z-30 border-b border-line/60 transition-[opacity,transform,display] transition-discrete duration-[240ms] ease-(--ease-apple)",
        visible
          ? "block translate-y-0 opacity-100 starting:-translate-y-3 starting:opacity-0"
          : "pointer-events-none hidden -translate-y-3 opacity-0",
      )}
      // Hidden from assistive tech and the tab order until it slides in.
      inert={!visible}
      aria-hidden={!visible}
    >
      <div className="container-page flex h-[52px] items-center gap-4">
        <p className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.02em]">
          {product.name}
        </p>
        <p className="ml-auto hidden text-[14px] text-muted tabular-nums sm:block">
          {formatMoney(product.price)}
        </p>
        <Button
          size="sm"
          className="ml-auto sm:ml-0"
          disabled={soldOut}
          loading={isPending}
          icon={added ? <AddedIcon /> : undefined}
          onClick={() => {
            add(product, 1, { onAdded: flashAdded });
          }}
        >
          {soldOut ? "Sold out" : added ? "Added" : "Add to Bag"}
        </Button>
      </div>
    </div>
  );
}

function AddedIcon() {
  return <Check className="size-4 animate-pop-in" strokeWidth={2.5} aria-hidden />;
}

function availability(stock: number): string {
  if (stock <= 0) return "Sold out";
  if (stock <= 5) return `Only ${stock} left`;
  return "In stock";
}

function Compare({ product, others }: { product: Product; others: Product[] }) {
  const columns = [product, ...others.slice(0, 2)];
  if (columns.length < 2) return null;
  const rows: { label: string; value: (p: Product) => string }[] = [
    { label: "Price", value: (p) => formatMoney(p.price) },
    { label: "Availability", value: (p) => availability(p.stock) },
    {
      label: "Free shipping on its own",
      value: (p) => (Number.parseFloat(p.price) >= freeShippingFrom ? "Yes" : "No"),
    },
    {
      label: "Most per bag line",
      value: (p) => (p.stock > 0 ? String(Math.min(p.stock, maxPerLine)) : "—"),
    },
    { label: "SKU", value: (p) => p.sku },
  ];
  return (
    <section className="py-20 sm:py-24" aria-labelledby="compare-heading">
      <Reveal className="container-page">
        <h2 id="compare-heading" className="type-section">
          Compare {product.category.name}.
        </h2>
      </Reveal>
      <div
        className="container-page mt-10 overflow-x-auto"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard scrolling
        tabIndex={0}
        role="region"
        aria-label="Comparison table"
      >
        <table className="w-full min-w-[560px] table-fixed text-left">
          <caption className="sr-only">
            {product.name} compared with other {product.category.name} products
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-[28%] pb-6">
                <span className="sr-only">Detail</span>
              </th>
              {columns.map((p) => (
                <th key={p.id} scope="col" className="px-3 pb-6 align-top font-normal">
                  <Link to={`/products/${p.slug}`} className="group block">
                    <span className="studio block overflow-hidden rounded-[20px]">
                      <ProductImage src={p.image_url} alt="" className="aspect-[4/3] w-full" />
                    </span>
                    <span className="mt-3 block text-[17px] font-semibold tracking-[-0.015em] group-hover:underline">
                      {p.name}
                    </span>
                    <span className="block h-5 text-[13px] text-muted">
                      {p.id === product.id ? "This product" : ""}
                    </span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line">
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-4 pr-3 text-[14px] font-medium text-muted">
                  {row.label}
                </th>
                {columns.map((p) => (
                  <td
                    key={p.id}
                    className={clsx(
                      "px-3 py-4 text-[15px] tabular-nums",
                      row.label === "SKU" && "font-mono text-[13px]",
                    )}
                  >
                    {row.value(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RelatedCard({ product }: { product: Product }) {
  const { art, linkProps } = useProductLink(product);
  return (
    <Link
      to={`/products/${product.slug}`}
      {...linkProps}
      className="studio group block rounded-[24px] p-5"
    >
      <div ref={art}>
        <ProductImage
          src={product.image_url}
          alt=""
          className="aspect-[4/3] w-full transition-transform duration-500 ease-(--ease-apple) group-hover:scale-[1.04]"
        />
      </div>
      <span className="mt-3 block text-[17px] font-semibold tracking-[-0.015em]">
        {product.name}
      </span>
      <span className="text-[15px] text-muted tabular-nums">{formatMoney(product.price)}</span>
    </Link>
  );
}

function Related({ product }: { product: Product }) {
  const { data, isLoading } = useProducts(relatedQuery(product.category.slug));
  const others = data?.results.filter((p) => p.id !== product.id) ?? [];
  if (isLoading) {
    return (
      <div className="container-page py-20" aria-hidden>
        <Skeleton className="h-10 w-72" />
      </div>
    );
  }
  if (others.length === 0) return null;
  return (
    <>
      <div className="bg-surface-2">
        <Compare product={product} others={others} />
      </div>
      <section className="pt-20 pb-12 sm:pt-24" aria-labelledby="related-heading">
        <Reveal className="container-page">
          <h2 id="related-heading" className="type-section">
            More in {product.category.name}.
          </h2>
        </Reveal>
        <div className="mt-8">
          <Shelf label={`More in ${product.category.name}`}>
            {others.map((p) => (
              <ShelfItem key={p.id} className="w-[70vw] max-w-[280px] sm:w-[280px]">
                <RelatedCard product={p} />
              </ShelfItem>
            ))}
          </Shelf>
        </div>
      </section>
    </>
  );
}

export function ProductPage() {
  const { slug = "" } = useParams();
  const { data: product, isLoading, error, refetch } = useProduct(slug);
  const buyRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(product?.name ?? (error ? "Product not found" : undefined));

  if (error) {
    return (
      <div className="container-page py-16">
        {error instanceof ApiError && error.status === 404 && <NoIndex />}
        {error instanceof ApiError && error.status === 404 ? (
          <EmptyState
            icon={PackageX}
            title="Product not found"
            pageHeading
            description="It may have been removed or is no longer available."
            action={
              <Link to="/shop" className={buttonClasses("primary")}>
                Browse products
              </Link>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="container-page pt-8 pb-16 sm:pt-12">
        <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          <div className="lg:sticky lg:top-20">
            {isLoading || !product ? (
              <Skeleton className="aspect-[4/3] rounded-[28px]" />
            ) : (
              <Gallery key={product.id} product={product} />
            )}
          </div>
          {isLoading || !product ? (
            <div className="space-y-4 pt-8" aria-hidden>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-12 w-64 rounded-full" />
            </div>
          ) : (
            <PurchasePanel key={product.id} product={product} buyRef={buyRef} />
          )}
        </div>
      </div>
      {product && <StickyBuyBar product={product} buyRef={buyRef} />}
      {product && <Related product={product} />}
    </>
  );
}
