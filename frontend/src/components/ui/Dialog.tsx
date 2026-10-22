import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Accessible modal built on the native <dialog> element, which provides focus trapping,
 * Escape-to-close and an inert background for free.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // jsdom lacks showModal(); fall back to the attribute so tests can still render it.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" }[size];

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${width} animate-slide-up rounded-[22px] border border-line bg-surface p-0 text-fg shadow-pop`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
            <div>
              <h2
                id={titleId}
                className="text-[21px] leading-tight font-semibold tracking-[-0.02em]"
              >
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-[15px] text-muted">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mt-1 -mr-2 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
              aria-label="Close dialog"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <div className="overflow-y-auto px-6 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-3 px-6 pt-2 pb-6">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
