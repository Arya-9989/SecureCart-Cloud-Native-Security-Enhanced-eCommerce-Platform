import { Plus } from "lucide-react";
import { Link } from "react-router";

import { ProductImage, Skeleton } from "@/components/ui/misc";
import { useAddToCart } from "@/hooks/queries";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";

export function ProductCard({ product }: { product: Product }) {
  const { add, isPending } = useAddToCart();
  const soldOut = product.stock <= 0;
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-lift">
      <Link
        to={`/products/${product.slug}`}
        className="relative block aspect-[4/3] overflow-hidden bg-surface-2"
        tabIndex={-1}
        aria-hidden
      >
        <ProductImage
          src={product.image_url}
          alt=""
          className="size-full transition duration-500 group-hover:scale-[1.04]"
        />
        <div className="absolute top-3 left-3 flex gap-1.5">
          {product.is_featured && (
            <span className="rounded-full bg-surface/90 px-2.5 py-1 text-[11px] font-semibold text-fg shadow-sm backdrop-blur">
              Featured
            </span>
          )}
          {soldOut ? (
            <span className="rounded-full bg-fg/85 px-2.5 py-1 text-[11px] font-semibold text-bg backdrop-blur">
              Sold out
            </span>
          ) : product.stock <= 5 ? (
            <span className="rounded-full bg-warning-soft/95 px-2.5 py-1 text-[11px] font-semibold text-warning backdrop-blur">
              Only {product.stock} left
            </span>
          ) : null}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-medium tracking-wide text-subtle uppercase">
          {product.category.name}
        </p>
        <h3 className="mt-1 text-[15px] leading-snug font-semibold text-fg">
          <Link
            to={`/products/${product.slug}`}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>
        <div className="mt-auto flex items-center justify-between pt-4">
          <p className="text-lg font-bold tracking-tight text-fg">{formatMoney(product.price)}</p>
          <button
            type="button"
            onClick={() => {
              add(product.id, 1, product.name);
            }}
            disabled={soldOut || isPending}
            className="relative z-10 inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-soft px-3 text-sm font-semibold text-brand transition hover:bg-brand hover:text-brand-fg disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-subtle"
            aria-label={soldOut ? `${product.name} is sold out` : `Add ${product.name} to cart`}
          >
            <Plus className="size-4" aria-hidden />
            {soldOut ? "Sold out" : "Add"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center justify-between pt-3">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-9 w-16 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function ProductGrid({
  products,
  loading,
  skeletons = 8,
  withSidebar = false,
}: {
  products: Product[] | undefined;
  loading: boolean;
  skeletons?: number;
  withSidebar?: boolean;
}) {
  const columns = withSidebar
    ? "min-[480px]:grid-cols-2 xl:grid-cols-3"
    : "min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  return (
    <div className={`grid grid-cols-1 gap-5 ${columns}`}>
      {loading && !products
        ? Array.from({ length: skeletons }, (_, i) => <ProductCardSkeleton key={i} />)
        : products?.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}
