import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { useTheme } from "@/lib/theme";

import type { Announce, ToastTone } from "./Toaster";

interface ToastApi {
  show: (tone: ToastTone, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

interface Pending {
  tone: ToastTone;
  title: string;
  description?: string;
}

/*
 * Sonner is only needed once something is announced, so it is not part of the first
 * download. The first toast loads it; toasts raised meanwhile wait in a queue and are shown
 * as soon as the toaster has mounted (and subscribed), so none is lost.
 */
const queue: Pending[] = [];
let announce: Announce | null = null;
let requestMount: (() => void) | null = null;

const api: ToastApi = {
  show: (tone, title, description) => {
    if (announce) {
      announce(tone, title, description);
      return;
    }
    queue.push({ tone, title, description });
    requestMount?.();
  },
  success: (title, description) => {
    api.show("success", title, description);
  },
  error: (title, description) => {
    api.show("error", title, description);
  },
};

const LazyToaster = lazy(() => import("./Toaster"));

export function ToastProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  const [mounted, setMounted] = useState(() => queue.length > 0);

  useEffect(() => {
    requestMount = () => {
      setMounted(true);
    };
    if (queue.length > 0) setMounted(true);
    return () => {
      requestMount = null;
      announce = null;
    };
  }, []);

  return (
    <>
      {children}
      {mounted && (
        <Suspense fallback={null}>
          <LazyToaster
            theme={resolved}
            onReady={(show) => {
              announce = show;
              for (const item of queue.splice(0)) show(item.tone, item.title, item.description);
            }}
          />
        </Suspense>
      )}
    </>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  return api;
}
