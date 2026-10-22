import type { ReactNode } from "react";
import { Drawer } from "vaul";

import { BagPanel } from "./BagPanel";

/** The bag as a bottom drawer on touch-sized screens. Loaded only on those screens. */
export default function BagDrawer({
  open,
  onOpenChange,
  triggerClassName,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerClassName: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Trigger className={triggerClassName} aria-label={label}>
        {children}
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[22px] bg-surface text-fg outline-none">
          <div
            className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-line-strong"
            aria-hidden
          />
          <Drawer.Title className="sr-only">Bag</Drawer.Title>
          <Drawer.Description className="sr-only">
            Items in your bag and links to your profile.
          </Drawer.Description>
          <div className="overflow-y-auto px-6 pt-4 pb-[max(24px,env(safe-area-inset-bottom))]">
            <BagPanel
              onNavigate={() => {
                onOpenChange(false);
              }}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
