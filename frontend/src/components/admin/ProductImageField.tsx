import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ProductImage } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { ApiError, errorMessage } from "@/lib/api";
import { adminApi } from "@/lib/endpoints";
import { checkImageFile, IMAGE_TYPES } from "@/lib/imageUpload";
import type { AdminProduct } from "@/lib/types";

/**
 * Upload control for the product editor. The file goes to the API, which checks its magic
 * bytes, refuses polyglots, strips metadata and stores a re-encoded WebP in object storage.
 * Uploads apply immediately; the form keeps the returned URL so saving does not undo them.
 */
export function ProductImageField({
  product,
  imageUrl,
  onUploaded,
}: {
  product: AdminProduct | null;
  imageUrl: string;
  onUploaded: (url: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const upload = useMutation({
    mutationFn: (file: File) => {
      if (!product) throw new Error("Save the product first.");
      return adminApi.uploadProductImage(product.id, file);
    },
    onSuccess: (saved) => {
      setProblem(null);
      onUploaded(saved.image_url);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      toast.success("Image uploaded", "Stored as WebP with its metadata removed.");
    },
    onError: (error) => {
      setProblem(
        (error instanceof ApiError ? error.fieldError("image") : undefined) ?? errorMessage(error),
      );
    },
  });

  return (
    <div className="flex gap-4 sm:col-span-2">
      <div className="studio size-24 shrink-0 overflow-hidden rounded-[16px]">
        <ProductImage src={imageUrl} alt="" className="size-full" sizes="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="label">Product image</p>
        <p id={hintId} className="text-[13px] text-muted">
          {product
            ? "JPEG, PNG or WebP up to 5 MB. Saved straight away, re-encoded as WebP, with camera and location data removed."
            : "Create the product first, then upload its image."}
        </p>
        <input
          ref={input}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = ""; // choosing the same file again still fires
            if (!file) return;
            const local = checkImageFile(file);
            if (local) {
              setProblem(local);
              return;
            }
            upload.mutate(file);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="mt-2.5"
          icon={<ImageUp className="size-4" aria-hidden />}
          disabled={!product}
          loading={upload.isPending}
          aria-describedby={hintId}
          onClick={() => input.current?.click()}
        >
          {imageUrl ? "Replace image" : "Upload image"}
        </Button>
        {problem && (
          <p role="alert" className="mt-2 text-[13px] font-medium text-danger">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
