import { useMutation } from "@tanstack/react-query";
import { FileDown } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiDownload, errorMessage, saveBlob } from "@/lib/api";

/** Downloads an order's invoice PDF (owner or admin route), with the session's token. */
export function InvoiceButton({ path, size = "md" }: { path: string; size?: "sm" | "md" }) {
  const toast = useToast();
  const download = useMutation({
    mutationFn: () => apiDownload(path),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename);
    },
    onError: (error) => {
      toast.error("Couldn't download the invoice", errorMessage(error));
    },
  });
  return (
    <Button
      variant="outline"
      size={size}
      icon={<FileDown className="size-4" aria-hidden />}
      loading={download.isPending}
      onClick={() => {
        download.mutate();
      }}
    >
      Download invoice
    </Button>
  );
}
