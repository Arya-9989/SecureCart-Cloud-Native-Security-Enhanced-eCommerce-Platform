import {
  ArrowRight,
  Briefcase,
  Headphones,
  Lamp,
  Lock,
  Mountain,
  RefreshCcw,
  ShieldCheck,
  Truck,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import { ProductGrid } from "@/components/store/ProductCard";
import { ErrorState } from "@/components/ui/EmptyState";
import { ProductImage, Skeleton } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { useCategories, useProducts } from "@/hooks/queries";
import { formatMoney } from "@/lib/format";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  audio: Headphones,
  wearables: Watch,
  "home-living": Lamp,
  workspace: Briefcase,
  "travel-outdoor": Mountain,
};

const PROMISES = [
  { icon: Truck, title: "Free shipping over $75", text: "Flat $6.99 below that." },
  { icon: ShieldCheck, title: "Protected accounts", text: "Argon2 hashing and rotating sessions." },
  { icon: Lock, title: "Oversell-proof checkout", text: "Stock is reserved atomically." },
  { icon: RefreshCcw, title: "Cancel before it ships", text: "Instant restock and refund." },
];

function Hero() {
  const { data, isLoading } = useProducts({ featured: true, page_size: 3 });
  const featured = data?.results ?? [];
  return (
    <section className="relative overflow-hidden border-b border-line bg-surface">
      <div
        className="pointer-events-none absolute inset-0 opacity-70 dark:opacity-40"
        style={{
          background:
            "radial-gradient(60rem 30rem at 85% -10%, color-mix(in oklab, var(--brand) 22%, transparent), transparent 60%), radial-gradient(40rem 24rem at -10% 110%, color-mix(in oklab, #14b8a6 16%, transparent), transparent 60%)",
        }}
        aria-hidden
      />
      <div className="container-page relative grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[1.05fr_1fr]">
        <div className="animate-slide-up">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1 text-xs font-semibold text-muted shadow-xs backdrop-blur">
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            New season essentials are in
          </p>
          <h1 className="mt-5 text-4xl leading-[1.08] font-extrabold tracking-tight text-fg sm:text-5xl lg:text-[3.5rem]">
            Thoughtful gear,
            <br />
            <span className="bg-gradient-to-r from-brand to-teal-500 bg-clip-text text-transparent">
              secured end to end.
            </span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
            Headphones, workspace tools and home comforts, sold through a storefront that treats
            your account and your order like they matter.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/shop" className={buttonClasses("primary", "lg")}>
              Shop the collection <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to="/shop?featured=true" className={buttonClasses("outline", "lg")}>
              View featured
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4" aria-label="Featured products">
          {isLoading
            ? Array.from({ length: 3 }, (_, i) => (
                <Skeleton
                  key={i}
                  className={
                    i === 0 ? "row-span-2 aspect-[3/4] rounded-3xl" : "aspect-square rounded-3xl"
                  }
                />
              ))
            : featured.map((product, index) => (
                <Link
                  key={product.id}
                  to={`/products/${product.slug}`}
                  className={`group relative overflow-hidden rounded-3xl border border-line bg-surface-2 shadow-lift ${
                    index === 0 ? "row-span-2" : ""
                  }`}
                >
                  <ProductImage
                    src={product.image_url}
                    alt={product.name}
                    className={`size-full transition duration-500 group-hover:scale-105 ${
                      index === 0 ? "aspect-[3/4]" : "aspect-square"
                    }`}
                  />
                  <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-xl bg-surface/90 px-3 py-2 shadow-sm backdrop-blur sm:inset-x-3 sm:bottom-3 sm:rounded-2xl sm:px-3.5 sm:py-2.5">
                    <span className="truncate text-xs font-semibold text-fg sm:text-sm">
                      {product.name}
                    </span>
                    <span className="hidden text-sm font-bold text-brand sm:inline">
                      {formatMoney(product.price)}
                    </span>
                  </div>
                </Link>
              ))}
        </div>
      </div>
    </section>
  );
}

function Categories() {
  const { data, isLoading } = useCategories();
  return (
    <section className="container-page mt-16" aria-labelledby="categories-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="categories-heading" className="text-2xl font-bold text-fg">
            Shop by category
          </h2>
          <p className="mt-1 text-sm text-muted">Five collections, curated for everyday use.</p>
        </div>
        <Link
          to="/shop"
          className="hidden text-sm font-semibold text-brand hover:underline sm:block"
        >
          View all products
        </Link>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {isLoading
          ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
          : data?.map((category) => {
              const Icon = CATEGORY_ICONS[category.slug] ?? ShieldCheck;
              return (
                <Link
                  key={category.id}
                  to={`/shop?category=${category.slug}`}
                  className="group card flex flex-col justify-between p-5 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lift"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand transition group-hover:bg-brand group-hover:text-brand-fg">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="mt-5">
                    <span className="block font-semibold text-fg">{category.name}</span>
                    <span className="text-xs text-muted">
                      {category.product_count} product{category.product_count === 1 ? "" : "s"}
                    </span>
                  </span>
                </Link>
              );
            })}
      </div>
    </section>
  );
}

function Featured() {
  const { data, isLoading, error, refetch } = useProducts({
    ordering: "-created_at",
    page_size: 8,
  });
  return (
    <section className="container-page mt-16" aria-labelledby="new-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="new-heading" className="text-2xl font-bold text-fg">
            Fresh arrivals
          </h2>
          <p className="mt-1 text-sm text-muted">The latest additions to the catalog.</p>
        </div>
        <Link to="/shop" className="text-sm font-semibold text-brand hover:underline">
          Shop all
        </Link>
      </div>
      <div className="mt-6">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <ProductGrid products={data?.results} loading={isLoading} />
        )}
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <Hero />
      <section className="border-b border-line bg-surface-2/50" aria-label="Store promises">
        <div className="container-page grid grid-cols-1 gap-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
          {PROMISES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-brand shadow-card ring-1 ring-line">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-fg">{title}</p>
                <p className="text-sm text-muted">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <Categories />
      <Featured />
    </>
  );
}
