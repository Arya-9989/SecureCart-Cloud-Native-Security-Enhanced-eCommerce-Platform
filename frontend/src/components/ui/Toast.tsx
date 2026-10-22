import { CheckCircle2, Info, XCircle } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Toaster, toast } from "sonner";

import { useTheme } from "@/lib/theme";

type ToastTone = "success" | "error" | "info";

interface ToastApi {
  show: (tone: ToastTone, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const api: ToastApi = {
  show: (tone, title, description) => {
    const options = description ? { description } : undefined;
    if (tone === "success") toast.success(title, options);
    else if (tone === "error") toast.error(title, options);
    else toast.info(title, options);
  },
  success: (title, description) => {
    api.show("success", title, description);
  },
  error: (title, description) => {
    api.show("error", title, description);
  },
};

/** Sonner, styled with the app's tokens. Errors stay longer than confirmations. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  const icons = useMemo(
    () => ({
      success: <CheckCircle2 className="size-5 text-success" aria-hidden />,
      error: <XCircle className="size-5 text-danger" aria-hidden />,
      info: <Info className="size-5 text-brand" aria-hidden />,
    }),
    [],
  );
  return (
    <>
      {children}
      <Toaster
        theme={resolved}
        position="bottom-right"
        duration={4500}
        gap={10}
        icons={icons}
        closeButton
        containerAriaLabel="Notifications"
        toastOptions={{
          classNames: {
            toast:
              "!rounded-2xl !border-line !bg-surface !text-fg !shadow-pop !font-sans !text-[15px] !gap-3 !p-4",
            title: "!font-semibold !text-fg",
            description: "!text-muted !text-[14px]",
            closeButton: "!bg-surface !border-line !text-muted",
          },
        }}
      />
    </>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  return api;
}
