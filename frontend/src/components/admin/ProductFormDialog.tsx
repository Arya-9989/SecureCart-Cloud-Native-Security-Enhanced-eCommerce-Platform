import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { ProductImageField } from "@/components/admin/ProductImageField";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { ApiError, errorMessage } from "@/lib/api";
import { adminApi, type ProductInput } from "@/lib/endpoints";
import type { AdminProduct } from "@/lib/types";
import { productSchema } from "@/lib/validation";

type FormInput = z.input<typeof productSchema>;
type FormOutput = z.output<typeof productSchema>;

const FIELDS = [
  "name",
  "sku",
  "description",
  "category_id",
  "price",
  "stock",
  "image_url",
] as const;

function toDefaults(product: AdminProduct | null): FormInput {
  return {
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    description: product?.description ?? "",
    category_id: product ? String(product.category.id) : "",
    price: product?.price ?? "",
    stock: product ? String(product.stock) : "0",
    image_url: product?.image_url ?? "",
    is_active: product?.is_active ?? true,
    is_featured: product?.is_featured ?? false,
  };
}

export function ProductFormDialog({
  open,
  product,
  onClose,
}: {
  open: boolean;
  product: AdminProduct | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: categories } = useQuery({
    queryKey: ["admin", "categories"],
    queryFn: adminApi.categories,
    enabled: open,
  });
  const { register, handleSubmit, reset, setError, setValue, watch, formState } = useForm<
    FormInput,
    unknown,
    FormOutput
  >({
    resolver: zodResolver(productSchema),
    defaultValues: toDefaults(product),
  });

  useEffect(() => {
    if (open) reset(toDefaults(product));
  }, [open, product, reset]);

  const save = useMutation({
    mutationFn: (values: ProductInput) =>
      product ? adminApi.updateProduct(product.id, values) : adminApi.createProduct(values),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      toast.success(product ? "Product updated" : "Product created", saved.name);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400) {
        let mapped = false;
        for (const field of FIELDS) {
          const message = error.fieldError(field);
          if (message) {
            setError(field, { message });
            mapped = true;
          }
        }
        if (mapped) return;
      }
      toast.error("Couldn't save product", errorMessage(error));
    },
  });

  const onSubmit = handleSubmit((values) => {
    save.mutate({ ...values, price: values.price, sku: values.sku.toUpperCase() });
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={product ? `Edit ${product.name}` : "New product"}
      description="Changes are recorded in the audit log."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" loading={save.isPending}>
            {product ? "Save changes" : "Create product"}
          </Button>
        </>
      }
    >
      {!categories ? (
        <div className="flex justify-center py-12">
          <Spinner label="Loading categories" />
        </div>
      ) : (
        <form
          id="product-form"
          noValidate
          onSubmit={(e) => void onSubmit(e)}
          className="grid gap-4 sm:grid-cols-2"
        >
          <TextField
            label="Name"
            wrapperClassName="sm:col-span-2"
            error={formState.errors.name?.message}
            {...register("name")}
          />
          <TextField label="SKU" error={formState.errors.sku?.message} {...register("sku")} />
          <SelectField
            label="Category"
            error={formState.errors.category_id?.message}
            {...register("category_id")}
          >
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Price (USD)"
            inputMode="decimal"
            error={formState.errors.price?.message}
            {...register("price")}
          />
          <TextField
            label="Stock"
            type="number"
            min={0}
            error={formState.errors.stock?.message}
            {...register("stock")}
          />
          <ProductImageField
            product={product}
            imageUrl={watch("image_url")}
            onUploaded={(url) => {
              setValue("image_url", url, { shouldDirty: true });
            }}
          />
          <TextField
            label="Image URL"
            wrapperClassName="sm:col-span-2"
            placeholder="/products/example.svg"
            error={formState.errors.image_url?.message}
            {...register("image_url")}
          />
          <TextAreaField
            label="Description"
            wrapperClassName="sm:col-span-2"
            rows={4}
            error={formState.errors.description?.message}
            {...register("description")}
          />
          <div className="flex flex-wrap gap-6 sm:col-span-2">
            <label className="flex items-center gap-2.5 text-sm font-medium text-fg">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                {...register("is_active")}
              />
              Active (visible in store)
            </label>
            <label className="flex items-center gap-2.5 text-sm font-medium text-fg">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)]"
                {...register("is_featured")}
              />
              Featured
            </label>
          </div>
        </form>
      )}
    </Dialog>
  );
}
