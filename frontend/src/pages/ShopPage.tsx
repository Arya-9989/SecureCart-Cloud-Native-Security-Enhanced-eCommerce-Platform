import { clsx } from "clsx";
import { PackageSearch, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState, type SyntheticEvent } from "react";
import { useSearchParams } from "react-router";

import { ProductGrid } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/misc";
import { useCategories, useProducts } from "@/hooks/queries";
import type { ProductQuery } from "@/lib/endpoints";

const PAGE_SIZE = 12;

const SORTS = [
  { value: "", label: "Recommended" },
  { value: "-created_at", label: "Newest" },
  { value: "price", label: "Price: low to high" },
  { value: "-price", label: "Price: high to low" },
  { value: "name", label: "Name: A to Z" },
];

function useFilters() {
  const [params, setParams] = useSearchParams();
  const query: ProductQuery = {
    search: params.get("search") ?? undefined,
    category: params.get("category") ?? undefined,
    min_price: params.get("min_price") ?? undefined,
    max_price: params.get("max_price") ?? undefined,
    in_stock: params.get("in_stock") === "true" ? true : undefined,
    featured: params.get("featured") === "true" ? true : undefined,
    ordering: params.get("ordering") ?? undefined,
    page: Number(params.get("page") ?? "1") || 1,
    page_size: PAGE_SIZE,
  };
  const update = (changes: Record<string, string | null>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (!("page" in changes)) next.delete("page");
      return next;
    });
  };
  return { query, update };
}

function Filters({
  query,
  update,
  onApplied,
}: {
  query: ProductQuery;
  update: (changes: Record<string, string | null>) => void;
  onApplied?: () => void;
}) {
  const { data: categories } = useCategories();
  const [min, setMin] = useState(query.min_price ?? "");
  const [max, setMax] = useState(query.max_price ?? "");

  useEffect(() => {
    setMin(query.min_price ?? "");
    setMax(query.max_price ?? "");
  }, [query.min_price, query.max_price]);

  const applyPrice = (event: SyntheticEvent) => {
    event.preventDefault();
    update({ min_price: min || null, max_price: max || null });
    onApplied?.();
  };

  const categoryButton = (slug: string | null, label: string, count?: number) => {
    const active = (query.category ?? null) === slug;
    return (
      <li key={slug ?? "all"}>
        <button
          type="button"
          onClick={() => {
            update({ category: slug });
            onApplied?.();
          }}
          aria-pressed={active}
          className={clsx(
            "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition",
            active
              ? "bg-brand-soft font-semibold text-brand"
              : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          <span>{label}</span>
          {count !== undefined && <span className="text-xs tabular-nums">{count}</span>}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-7">
      <div>
        <h2 className="mb-2 px-3 text-xs font-semibold tracking-wider text-subtle uppercase">
          Category
        </h2>
        <ul className="space-y-0.5">
          {categoryButton(null, "All products")}
          {categories?.map((c) => categoryButton(c.slug, c.name, c.product_count))}
        </ul>
      </div>
      <form onSubmit={applyPrice} className="px-3">
        <h2 className="mb-3 text-xs font-semibold tracking-wider text-subtle uppercase">Price</h2>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="min-price">
            Minimum price
          </label>
          <input
            id="min-price"
            inputMode="decimal"
            placeholder="Min"
            value={min}
            onChange={(e) => {
              setMin(e.target.value.replace(/[^\d.]/g, ""));
            }}
            className="field py-2"
          />
          <span className="text-subtle" aria-hidden>
            –
          </span>
          <label className="sr-only" htmlFor="max-price">
            Maximum price
          </label>
          <input
            id="max-price"
            inputMode="decimal"
            placeholder="Max"
            value={max}
            onChange={(e) => {
              setMax(e.target.value.replace(/[^\d.]/g, ""));
            }}
            className="field py-2"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm" className="mt-3 w-full">
          Apply price
        </Button>
      </form>
      <div className="px-3">
        <h2 className="mb-3 text-xs font-semibold tracking-wider text-subtle uppercase">
          Availability
        </h2>
        <label className="flex cursor-pointer items-center gap-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={query.in_stock === true}
            onChange={(e) => {
              update({ in_stock: e.target.checked ? "true" : null });
              onApplied?.();
            }}
            className="size-4 rounded border-line-strong accent-[var(--brand)]"
          />
          In stock only
        </label>
        <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={query.featured === true}
            onChange={(e) => {
              update({ featured: e.target.checked ? "true" : null });
              onApplied?.();
            }}
            className="size-4 rounded border-line-strong accent-[var(--brand)]"
          />
          Featured only
        </label>
      </div>
    </div>
  );
}

export function ShopPage() {
  const { query, update } = useFilters();
  const { data, isLoading, isFetching, error, refetch } = useProducts(query);
  const { data: categories } = useCategories();
  const [showFilters, setShowFilters] = useState(false);

  const categoryName = categories?.find((c) => c.slug === query.category)?.name;
  const heading = query.search
    ? `Results for "${query.search}"`
    : (categoryName ?? (query.featured ? "Featured products" : "All products"));

  const activeChips = [
    query.search && { key: "search", label: `"${query.search}"` },
    categoryName && { key: "category", label: categoryName },
    (query.min_price ?? query.max_price) && {
      key: "price",
      label: `$${query.min_price ?? "0"} – ${query.max_price ? `$${query.max_price}` : "any"}`,
    },
    query.in_stock && { key: "in_stock", label: "In stock" },
    query.featured && { key: "featured", label: "Featured" },
  ].filter(Boolean) as { key: string; label: string }[];

  const clearChip = (key: string) => {
    if (key === "price") update({ min_price: null, max_price: null });
    else update({ [key]: null });
  };

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">{heading}</h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {data ? `${data.count} product${data.count === 1 ? "" : "s"}` : "Loading products"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="lg:hidden"
            icon={<SlidersHorizontal className="size-4" aria-hidden />}
            onClick={() => {
              setShowFilters((v) => !v);
            }}
            aria-expanded={showFilters}
            aria-controls="mobile-filters"
          >
            Filters
          </Button>
          <label htmlFor="sort" className="sr-only">
            Sort products
          </label>
          <select
            id="sort"
            value={query.ordering ?? ""}
            onChange={(e) => {
              update({ ordering: e.target.value || null });
            }}
            className="field h-10 w-auto py-0 pr-8"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => {
                clearChip(chip.key);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-fg transition hover:border-danger/40 hover:text-danger"
              aria-label={`Remove filter ${chip.label}`}
            >
              {chip.label}
              <X className="size-3.5" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            className="text-xs font-semibold text-brand hover:underline"
            onClick={() => {
              update({
                search: null,
                category: null,
                min_price: null,
                max_price: null,
                in_stock: null,
                featured: null,
              });
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {showFilters && (
        <div id="mobile-filters" className="card mt-4 animate-fade-in p-4 lg:hidden">
          <Filters
            query={query}
            update={update}
            onApplied={() => {
              setShowFilters(false);
            }}
          />
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block" aria-label="Product filters">
          <div className="sticky top-24">
            <Filters query={query} update={update} />
          </div>
        </aside>
        <section
          aria-label="Products"
          className={clsx(isFetching && data && "opacity-60 transition")}
        >
          {error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : data?.results.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="No products match"
              description="Try a different search term or loosen your filters."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    update({
                      search: null,
                      category: null,
                      min_price: null,
                      max_price: null,
                      in_stock: null,
                      featured: null,
                    });
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <>
              <ProductGrid products={data?.results} loading={isLoading} skeletons={6} withSidebar />
              {data && (
                <Pagination
                  page={query.page ?? 1}
                  pageSize={PAGE_SIZE}
                  count={data.count}
                  onPage={(page) => {
                    update({ page: String(page) });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
