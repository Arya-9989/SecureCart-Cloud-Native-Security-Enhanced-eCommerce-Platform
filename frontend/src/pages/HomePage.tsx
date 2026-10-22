import { clsx } from "clsx";
import { ChevronRight, RefreshCcw, Smartphone, Truck } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router";

import { Shelf, ShelfItem } from "@/components/store/Shelf";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { ErrorState } from "@/components/ui/EmptyState";
import { ProductImage, Skeleton } from "@/components/ui/misc";
import { Reveal } from "@/components/ui/Reveal";
import { useCategories, useProducts } from "@/hooks/queries";
import { formatMoney } from "@/lib/format";
import { PROTECTIONS } from "@/lib/protection";
import type { Category, Product } from "@/lib/types";

// One request feeds the whole page: the catalog is small (the API caps a page at 100).
const CATALOG_QUERY = { page_size: 100 };

function Hero({ featured, loading }: { featured: Product[]; loading: boolean }) {
  const trio = featured.slice(0, 3);
  // Centre the hero product: [second, first, third].
  const ordered = trio.length === 3 ? [trio[1], trio[0], trio[2]] : trio;
  return (
    <section className="overflow-hidden bg-surface-2" aria-labelledby="hero-heading">
      <div className="container-text pt-14 text-center sm:pt-20">
        <p className="type-eyebrow text-muted">SecureCart Store</p>
        <h1 id="hero-heading" className="type-hero mt-2">
          Good things,
          <br />
          bought safely.
        </h1>
        <p className="type-lead mx-auto mt-4 max-w-[640px] text-muted">
          Audio, workspace and home essentials, with your session, stock and payment handled
          correctly.
        </p>
        <div className="relative z-20 mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/shop" className={buttonClasses("primary", "md")}>
            Shop now
          </Link>
          <Link to="/protection" className={buttonClasses("secondary", "md")}>
            How your order is protected
          </Link>
        </div>
      </div>
      <div className="mx-auto mt-10 grid max-w-[1240px] grid-cols-1 items-end px-6 sm:mt-16 sm:grid-cols-3">
        {loading
          ? Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className={clsx("aspect-[4/3]", i !== 1 && "hidden sm:block")}
                aria-hidden
              />
            ))
          : ordered.map((product, index) =>
              product ? (
                <Link
                  key={product.id}
                  to={`/products/${product.slug}`}
                  className={clsx(
                    "group block origin-bottom rounded-[28px] text-center",
                    // Phones show the lead product alone and large; wider screens a trio.
                    index === 1
                      ? "z-10 mx-auto w-[92%] scale-[1.12] sm:w-auto sm:scale-[1.38]"
                      : "hidden scale-[1.08] sm:block",
                  )}
                >
                  <ProductImage
                    src={product.image_url}
                    alt={product.name}
                    eager
                    className="aspect-[4/3] w-full transition-transform duration-500 ease-(--ease-apple) group-hover:-translate-y-1"
                  />
                  <span className="sr-only">
                    {product.name}, {formatMoney(product.price)}
                  </span>
                </Link>
              ) : null,
            )}
      </div>
      <div className="h-12 sm:h-20" aria-hidden />
    </section>
  );
}

function ProtectionBand() {
  return (
    <section
      className="bg-black text-[#f5f5f7] dark:bg-[#0b0b0c]"
      aria-labelledby="protection-heading"
    >
      <div className="container-page py-20 sm:py-28">
        <Reveal className="mx-auto max-w-[760px] text-center">
          <p className="type-eyebrow text-[#a1a1a6]">Protection, built in</p>
          <h2 id="protection-heading" className="type-headline mt-2">
            Every order, protected.
          </h2>
          <p className="type-body-lg mx-auto mt-4 max-w-[600px] text-[#a1a1a6]">
            Not a badge on the checkout page. Real mechanisms in the code that runs this store, from
            the moment you sign in to the day your order arrives.
          </p>
        </Reveal>
        <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROTECTIONS.map((p, index) => {
            const Icon = p.icon;
            return (
              <Reveal as="li" key={p.id} delay={index * 0.05} className="flex">
                <Link
                  to={`/protection#${p.id}`}
                  className="group flex w-full flex-col rounded-[24px] bg-[#1d1d1f] p-7 transition-colors hover:bg-[#232326] focus-visible:outline-[#4c9bff]"
                >
                  <Icon className="size-7 text-[#4c9bff]" strokeWidth={1.5} aria-hidden />
                  <p className="mt-6 text-[13px] font-medium text-[#a1a1a6]">{p.stage}</p>
                  <h3 className="mt-1 text-[21px] leading-tight font-semibold tracking-[-0.02em]">
                    {p.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-[#a1a1a6]">{p.summary}</p>
                  <span className="mt-auto inline-flex items-center gap-0.5 pt-6 text-[15px] text-[#4c9bff] group-hover:underline">
                    How it works <ChevronRight className="size-4" aria-hidden />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function CategoryTiles({ categories, products }: { categories: Category[]; products: Product[] }) {
  return (
    <section className="py-20 sm:py-28" aria-labelledby="categories-heading">
      <Reveal className="container-page">
        <h2 id="categories-heading" className="type-section">
          Shop by category.
        </h2>
      </Reveal>
      <ul className="container-page mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {categories.map((category, index) => {
          const cover =
            products.find((p) => p.category.slug === category.slug && p.is_featured) ??
            products.find((p) => p.category.slug === category.slug);
          return (
            <Reveal
              as="li"
              key={category.id}
              delay={(index % 3) * 0.05}
              className={index < 3 ? "lg:col-span-2" : "lg:col-span-3"}
            >
              <Link
                to={`/shop?category=${category.slug}`}
                className="group studio flex h-full flex-col overflow-hidden rounded-[28px] p-7 pb-0"
              >
                <h3 className="type-tile text-[28px] sm:text-[32px]">{category.name}</h3>
                <p className="mt-1 text-[15px] text-muted">
                  {category.product_count} product{category.product_count === 1 ? "" : "s"}
                </p>
                <span className="mt-3 inline-flex items-center gap-0.5 text-[15px] text-brand group-hover:underline">
                  Shop {category.name} <ChevronRight className="size-4" aria-hidden />
                </span>
                <div className="mx-auto mt-auto w-full max-w-[440px] overflow-hidden">
                  {cover ? (
                    <ProductImage
                      src={cover.image_url}
                      alt=""
                      className="aspect-[4/3] w-full scale-[1.18] transition-transform duration-500 ease-(--ease-apple) group-hover:scale-[1.22]"
                    />
                  ) : (
                    <div className="aspect-[4/3]" />
                  )}
                </div>
              </Link>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

function Latest({ products }: { products: Product[] }) {
  const latest = [...products].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
  return (
    <section className="bg-surface-2 pt-20 pb-12 sm:pt-28" aria-labelledby="latest-heading">
      <Reveal className="container-page">
        <h2 id="latest-heading" className="type-section">
          The latest. <span className="text-muted">The newest additions to the store.</span>
        </h2>
      </Reveal>
      <div className="mt-8">
        <Shelf label="Latest products">
          {latest.map((product) => (
            <ShelfItem key={product.id} className="w-[78vw] max-w-[340px] sm:w-[340px]">
              <Link
                to={`/products/${product.slug}`}
                className="group flex h-[440px] flex-col rounded-[24px] bg-surface p-7 shadow-card transition-shadow duration-300 hover:shadow-lift"
              >
                <p className="text-[13px] font-medium text-muted">{product.category.name}</p>
                <h3 className="mt-1 text-[24px] leading-tight font-semibold tracking-[-0.02em]">
                  {product.name}
                </h3>
                <p className="mt-2 text-[15px] text-fg tabular-nums">
                  {formatMoney(product.price)}
                  {product.stock > 0 && product.stock <= 5 && (
                    <span className="ml-2 font-medium text-warning">Only {product.stock} left</span>
                  )}
                </p>
                <div className="mt-auto">
                  <ProductImage
                    src={product.image_url}
                    alt=""
                    className="aspect-[4/3] w-full scale-[1.15] transition-transform duration-500 ease-(--ease-apple) group-hover:scale-[1.2]"
                  />
                </div>
              </Link>
            </ShelfItem>
          ))}
        </Shelf>
      </div>
    </section>
  );
}

const PROMISES = [
  {
    icon: Truck,
    title: "Free shipping over $75.",
    text: "A flat $6.99 below that, shown in your bag before you check out.",
  },
  {
    icon: RefreshCcw,
    title: "Cancel until it ships.",
    text: "Cancelling restocks the items and refunds the payment automatically.",
  },
  {
    icon: Smartphone,
    title: "Your bag goes where you go.",
    text: "It is saved to your account, so it's there on any device you sign in on.",
  },
];

function Promises() {
  return (
    <section className="py-20 sm:py-28" aria-labelledby="promises-heading">
      <Reveal className="container-page">
        <h2 id="promises-heading" className="type-section">
          Shop with confidence.
        </h2>
      </Reveal>
      <ul className="container-page mt-10 grid gap-3 md:grid-cols-3">
        {PROMISES.map(({ icon: Icon, title, text }, index) => (
          <Reveal as="li" key={title} delay={index * 0.05} className="tile p-8">
            <Icon className="size-8 text-brand" strokeWidth={1.5} aria-hidden />
            <h3 className="mt-6 text-[21px] leading-tight font-semibold tracking-[-0.02em]">
              {title}
            </h3>
            <p className="mt-2 text-[17px] text-muted">{text}</p>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="container-page py-20" aria-hidden>
      <Skeleton className="h-12 w-72" />
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[420px] rounded-[28px]" />
        ))}
      </div>
    </div>
  );
}

export function HomePage() {
  const { data, isLoading, error, refetch } = useProducts(CATALOG_QUERY);
  const { data: categories } = useCategories();
  const products = data?.results ?? [];
  const featured = products.filter((p) => p.is_featured);

  useEffect(() => {
    document.title = "SecureCart: everyday essentials, bought safely";
  }, []);

  return (
    <>
      <Hero featured={featured.length ? featured : products} loading={isLoading} />
      <ProtectionBand />
      {error ? (
        <div className="container-page py-20">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : isLoading || !categories ? (
        <HomeSkeleton />
      ) : (
        <>
          <CategoryTiles categories={categories} products={products} />
          <Latest products={products} />
          <Promises />
        </>
      )}
    </>
  );
}
