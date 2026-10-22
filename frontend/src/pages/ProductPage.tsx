import { ChevronRight, PackageX, ShieldCheck, ShoppingBag, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { ProductGrid } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { ProductImage, QuantityStepper, Skeleton, StockBadge } from "@/components/ui/misc";
import { useAddToCart, useProduct, useProducts } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";

const MAX_PER_ORDER = 10;

function Related({ product }: { product: Product }) {
  const { data, isLoading } = useProducts({ category: product.category.slug, page_size: 5 });
  const related = data?.results.filter((p) => p.id !== product.id).slice(0, 4);
  if (!isLoading && !related?.length) return null;
  return (
    <section className="mt-20" aria-labelledby="related-heading">
      <h2 id="related-heading" className="text-xl font-bold text-fg">
        More in {product.category.name}
      </h2>
      <div className="mt-6">
        <ProductGrid products={related} loading={isLoading} skeletons={4} />
      </div>
    </section>
  );
}

function PurchasePanel({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1);
  const { add, isPending } = useAddToCart();
  const max = Math.max(1, Math.min(product.stock, MAX_PER_ORDER));
  const soldOut = product.stock <= 0;

  return (
    <div className="flex flex-col">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted">
        <Link to="/shop" className="hover:text-fg">
          Shop
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link to={`/shop?category=${product.category.slug}`} className="hover:text-fg">
          {product.category.name}
        </Link>
      </nav>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">{product.name}</h1>
      <div className="mt-4 flex items-center gap-3">
        <p className="text-3xl font-bold tracking-tight text-fg">{formatMoney(product.price)}</p>
        <StockBadge stock={product.stock} />
      </div>
      <p className="mt-6 text-base leading-relaxed text-muted">{product.description}</p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <QuantityStepper
          label="Quantity"
          value={quantity}
          max={max}
          onChange={setQuantity}
          disabled={soldOut}
        />
        <Button
          size="lg"
          className="min-w-48 flex-1 sm:flex-none"
          disabled={soldOut}
          loading={isPending}
          icon={<ShoppingBag className="size-4" aria-hidden />}
          onClick={() => {
            add(product.id, quantity, product.name);
          }}
        >
          {soldOut ? "Sold out" : "Add to cart"}
        </Button>
      </div>
      {!soldOut && product.stock <= 5 && (
        <p className="mt-3 text-sm font-medium text-warning">
          Low stock: only {product.stock} left.
        </p>
      )}

      <dl className="mt-10 grid grid-cols-1 gap-4 border-t border-line pt-8 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <Truck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div>
            <dt className="font-semibold text-fg">Shipping</dt>
            <dd className="text-muted">Free over $75, otherwise $6.99 flat.</dd>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div>
            <dt className="font-semibold text-fg">Cancel any time before shipping</dt>
            <dd className="text-muted">Refunded and restocked instantly.</dd>
          </div>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-wider text-subtle uppercase">SKU</dt>
          <dd className="mt-1 font-mono text-fg">{product.sku}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-wider text-subtle uppercase">Category</dt>
          <dd className="mt-1 text-fg">{product.category.name}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ProductPage() {
  const { slug = "" } = useParams();
  const { data: product, isLoading, error, refetch } = useProduct(slug);

  if (error) {
    return (
      <div className="container-page py-16">
        {error instanceof ApiError && error.status === 404 ? (
          <EmptyState
            icon={PackageX}
            title="Product not found"
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
    <div className="container-page py-10">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="overflow-hidden rounded-3xl border border-line bg-surface-2 shadow-card">
          {isLoading || !product ? (
            <Skeleton className="aspect-square rounded-none" />
          ) : (
            <ProductImage
              src={product.image_url}
              alt={product.name}
              className="aspect-square w-full"
            />
          )}
        </div>
        {isLoading || !product ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-64" />
          </div>
        ) : (
          <PurchasePanel key={product.id} product={product} />
        )}
      </div>
      {product && <Related product={product} />}
    </div>
  );
}
