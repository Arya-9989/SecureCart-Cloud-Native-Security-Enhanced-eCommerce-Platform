import { CheckCircle2, Info, XCircle } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Toaster as Sonner, toast } from "sonner";

export type ToastTone = "success" | "error" | "info";
export type Announce = (tone: ToastTone, title: string, description?: string) => void;

const announce: Announce = (tone, title, description) => {
  const options = description ? { description } : undefined;
  if (tone === "success") toast.success(title, options);
  else if (tone === "error") toast.error(title, options);
  else toast.info(title, options);
};

/** Sonner, styled with the app's tokens. Loaded on demand by ToastProvider. */
export default function Toaster({
  theme,
  onReady,
}: {
  theme: "light" | "dark";
  onReady: (show: Announce) => void;
}) {
  const icons = useMemo(
    () => ({
      success: <CheckCircle2 className="size-5 text-success" aria-hidden />,
      error: <XCircle className="size-5 text-danger" aria-hidden />,
      info: <Info className="size-5 text-brand" aria-hidden />,
    }),
    [],
  );
  // Runs after Sonner's own mount effect (children first), so it is already subscribed.
  useEffect(() => {
    onReady(announce);
  }, [onReady]);
  return (
    <Sonner
      theme={theme}
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
  );
}
