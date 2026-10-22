import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { ProductFormDialog } from "@/components/admin/ProductFormDialog";
import {
  DataTable,
  SearchInput,
  SkeletonRows,
  TableMessage,
  Td,
  Th,
} from "@/components/admin/Table";
import { AdminPageHeader } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/EmptyState";
import { Pagination, ProductImage } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { adminApi } from "@/lib/endpoints";
import { formatMoney } from "@/lib/format";
import type { AdminProduct } from "@/lib/types";

const PAGE_SIZE = 12;

export function AdminProductsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "";
  const lowStock = params.get("low_stock") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);

  // "New product" from the command palette arrives as ?new=1.
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    setEditing(null);
    setFormOpen(true);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }, [wantsNew, setParams]);

  const query = {
    search,
    page,
    page_size: PAGE_SIZE,
    is_active: status === "" ? undefined : status === "active",
    low_stock: lowStock || undefined,
  };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "products", query],
    queryFn: () => adminApi.products(query),
    placeholderData: keepPreviousData,
  });

  const setParam = useCallback(
    (key: string, value: string) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        return next;
      });
    },
    [setParams],
  );
  const onSearch = useCallback(
    (value: string) => {
      setParam("search", value);
    },
    [setParam],
  );

  const toggleActive = useMutation({
    mutationFn: (product: AdminProduct) =>
      adminApi.updateProduct(product.id, { is_active: !product.is_active }),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      toast.success(product.is_active ? "Product activated" : "Product hidden", product.name);
    },
    onError: (err) => {
      toast.error("Update failed", errorMessage(err));
    },
  });

  const remove = useMutation({
    mutationFn: (product: AdminProduct) => adminApi.deleteProduct(product.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      toast.success("Product deleted");
      setDeleting(null);
    },
    onError: (err) => {
      toast.error("Couldn't delete product", errorMessage(err));
      setDeleting(null);
    },
  });

  return (
    <>
      <AdminPageHeader
        title="Products"
        description="Manage the catalog, pricing and inventory."
        actions={
          <Button
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            New product
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={onSearch} placeholder="Search name or SKU" />
        <label htmlFor="status-filter" className="sr-only">
          Filter by status
        </label>
        <select
          id="status-filter"
          className="field h-10 w-full rounded-full px-4 text-[15px] sm:w-44"
          value={status}
          onChange={(e) => {
            setParam("status", e.target.value);
          }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Hidden</option>
        </select>
        {lowStock && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setParam("low_stock", "");
            }}
          >
            Low stock only ×
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable label="Products">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th className="text-right">Price</Th>
                <Th className="text-right">Stock</Th>
                <Th>Status</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                <SkeletonRows cols={6} />
              ) : data?.results.length === 0 ? (
                <TableMessage colSpan={6}>No products match these filters.</TableMessage>
              ) : (
                data?.results.map((product) => (
                  <tr key={product.id} className="transition-colors hover:bg-surface-2/60">
                    <Td>
                      <div className="flex items-center gap-3">
                        <div className="studio size-11 shrink-0 overflow-hidden rounded-[10px]">
                          <ProductImage
                            src={product.image_url}
                            alt=""
                            className="size-full"
                            sizes="sm"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">{product.name}</p>
                          <p className="font-mono text-xs text-subtle">{product.sku}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-muted">{product.category.name}</Td>
                    <Td className="text-right font-medium text-fg tabular-nums">
                      {formatMoney(product.price)}
                    </Td>
                    <Td className="text-right">
                      <span
                        className={`font-semibold tabular-nums ${
                          product.stock === 0
                            ? "text-danger"
                            : product.stock <= 5
                              ? "text-warning"
                              : "text-fg"
                        }`}
                      >
                        {product.stock}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            toggleActive.mutate(product);
                          }}
                          className="rounded-full"
                          aria-label={`${product.is_active ? "Hide" : "Activate"} ${product.name}`}
                          title={product.is_active ? "Click to hide" : "Click to activate"}
                        >
                          {product.is_active ? (
                            <Badge tone="success" dot>
                              Active
                            </Badge>
                          ) : (
                            <Badge tone="neutral" dot>
                              Hidden
                            </Badge>
                          )}
                        </button>
                        {product.is_featured && <Badge tone="brand">Featured</Badge>}
                      </div>
                    </Td>
                    <Td className="text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-fg"
                          aria-label={`Edit ${product.name}`}
                          onClick={() => {
                            setEditing(product);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                          aria-label={`Delete ${product.name}`}
                          onClick={() => {
                            setDeleting(product);
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
          {data && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              count={data.count}
              onPage={(next) => {
                setParam("page", String(next));
              }}
            />
          )}
        </>
      )}

      <ProductFormDialog
        open={formOpen}
        product={editing}
        onClose={() => {
          setFormOpen(false);
        }}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title="Delete product?"
        description="Products that appear in past orders can't be deleted; hide them instead."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleting(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (deleting) remove.mutate(deleting);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          <span className="font-semibold text-fg">{deleting?.name}</span> will be removed from the
          catalog permanently.
        </p>
      </Dialog>
    </>
  );
}
