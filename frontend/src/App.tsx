import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";

import { AuthProvider } from "@/auth/AuthContext";
import { ToastProvider } from "@/components/ui/Toast";
import { createQueryClient } from "@/lib/queryClient";
import { ThemeProvider } from "@/lib/theme";
import { routes } from "@/routes";

export function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export function App() {
  const [client] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>
  );
}
