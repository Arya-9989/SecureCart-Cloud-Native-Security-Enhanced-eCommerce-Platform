import { clsx } from "clsx";
import { Check, Plus } from "lucide-react";
import { Link } from "react-router";

import { ProductImage, Skeleton } from "@/components/ui/misc";
import { useAddToCart } from "@/hooks/queries";
import { useAddedFlash } from "@/hooks/useAddedFlash";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";

import { useProductLink } from "./useProductLink";

function StockNote({ stock }: { stock: number }) {
  if (stock <= 0) return <p className="text-[13px] text-muted">Sold out</p>;
  if (stock <= 5) return <p className="text-[13px] font-medium text-warning">Only {stock} left</p>;
  return <p className="text-[13px] text-muted">In stock</p>;
}

/** Studio tile, product first: art on the sweep, then name, price and one quiet action. */
export function ProductCard({ product }: { product: Product }) {
  const { add, isPending } = useAddToCart();
  const [added, flashAdded] = useAddedFlash();
  const { art, linkProps } = useProductLink(product);
  const soldOut = product.stock <= 0;
  return (
    <article className="group studio relative flex flex-col overflow-hidden rounded-[24px] transition-transform duration-300 ease-(--ease-apple) hover:-translate-y-0.5">
      <div ref={art} className="relative aspect-[4/3]" aria-hidden>
        <ProductImage
          src={product.image_url}
          alt=""
          className="size-full scale-[1.12] transition-transform duration-500 ease-(--ease-apple) group-hover:scale-[1.16]"
        />
      </div>
      <div className="flex flex-1 flex-col px-5 pb-5">
        <p className="text-[12px] font-medium text-muted">
          {product.is_featured ? "Featured · " : ""}
          {product.category.name}
        </p>
        <h3 className="mt-1 text-[17px] leading-snug font-semibold tracking-[-0.015em] text-fg">
          <Link
            to={`/products/${product.slug}`}
            {...linkProps}
            className="block rounded-sm py-0.5 after:absolute after:inset-0 after:rounded-[24px] after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
          >
            {product.name}
          </Link>
        </h3>
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <p className="text-[17px] tracking-[-0.015em] text-fg tabular-nums">
              {formatMoney(product.price)}
            </p>
            <StockNote stock={product.stock} />
          </div>
          <button
            type="button"
            onClick={() => {
              add(product, 1, { onAdded: flashAdded });
            }}
            disabled={soldOut || isPending}
            className={clsx(
              "hit relative z-10 inline-flex h-8 items-center gap-1 rounded-full px-3.5 text-[14px] font-medium transition-colors",
              soldOut
                ? "cursor-not-allowed bg-surface-3 text-muted"
                : "bg-brand-soft text-brand hover:bg-action hover:text-brand-fg disabled:opacity-60",
            )}
            aria-label={
              soldOut
                ? `${product.name} is sold out`
                : `${added ? "Added" : "Add"} ${product.name} to bag`
            }
          >
            {soldOut ? null : added ? (
              <Check className="size-3.5 animate-pop-in" strokeWidth={2.5} aria-hidden />
            ) : (
              <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
            )}
            {soldOut ? "Sold out" : added ? "Added" : "Add"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[24px] bg-surface-2" aria-hidden>
      <div className="aspect-[4/3]" />
      <div className="space-y-2.5 px-5 pb-5">
        <Skeleton className="h-3 w-20 bg-surface-3" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-end justify-between pt-4">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-8 w-16 rounded-full" />
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
    ? "min-[560px]:grid-cols-2 xl:grid-cols-3"
    : "min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  return (
    <div className={`grid grid-cols-1 gap-3 sm:gap-4 ${columns}`}>
      {loading && !products
        ? Array.from({ length: skeletons }, (_, i) => <ProductCardSkeleton key={i} />)
        : products?.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}
