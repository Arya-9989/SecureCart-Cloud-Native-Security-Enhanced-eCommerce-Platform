import { lazy, Suspense, type ReactNode } from "react";
import { Outlet, ScrollRestoration, type RouteObject } from "react-router";

import { RequireAdmin, RequireAuth } from "@/auth/guards";
import { StoreLayout } from "@/components/layout/StoreLayout";
import { PageSpinner } from "@/components/ui/Spinner";
import { CartPage } from "@/pages/CartPage";
import { HomePage } from "@/pages/HomePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { OrderDetailPage } from "@/pages/OrderDetailPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { ProductPage } from "@/pages/ProductPage";
import { ProtectionPage } from "@/pages/ProtectionPage";
import { ShopPage } from "@/pages/ShopPage";

// Pages with forms carry react-hook-form and zod, which the browsing pages never need, so
// they load on demand instead of sitting in every visitor's first download.
const LoginPage = lazy(() => import("@/pages/AuthPages").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import("@/pages/AuthPages").then((m) => ({ default: m.RegisterPage })),
);
const CheckoutPage = lazy(() =>
  import("@/pages/CheckoutPage").then((m) => ({ default: m.CheckoutPage })),
);

// The admin area (and its charting library) is code-split out of the storefront bundle.
const AdminLayout = lazy(() =>
  import("@/components/layout/AdminLayout").then((m) => ({ default: m.AdminLayout })),
);
const DashboardPage = lazy(() =>
  import("@/pages/admin/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const AdminProductsPage = lazy(() =>
  import("@/pages/admin/ProductsPage").then((m) => ({ default: m.AdminProductsPage })),
);
const AdminOrdersPage = lazy(() =>
  import("@/pages/admin/OrdersPage").then((m) => ({ default: m.AdminOrdersPage })),
);
const AdminUsersPage = lazy(() =>
  import("@/pages/admin/UsersPage").then((m) => ({ default: m.AdminUsersPage })),
);
const AdminAuditLogPage = lazy(() =>
  import("@/pages/admin/AuditLogPage").then((m) => ({ default: m.AdminAuditLogPage })),
);

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

const authed = (node: ReactNode) => <RequireAuth>{node}</RequireAuth>;
const lazyPage = (node: ReactNode) => <Suspense fallback={<PageSpinner />}>{node}</Suspense>;

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      {
        element: <StoreLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "shop", element: <ShopPage /> },
          { path: "products/:slug", element: <ProductPage /> },
          { path: "protection", element: <ProtectionPage /> },
          { path: "cart", element: authed(<CartPage />) },
          { path: "checkout", element: authed(lazyPage(<CheckoutPage />)) },
          { path: "orders", element: authed(<OrdersPage />) },
          { path: "orders/:id", element: authed(<OrderDetailPage />) },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
      { path: "login", element: lazyPage(<LoginPage />) },
      { path: "register", element: lazyPage(<RegisterPage />) },
      {
        path: "admin",
        element: <RequireAdmin>{lazyPage(<AdminLayout />)}</RequireAdmin>,
        children: [
          { index: true, element: lazyPage(<DashboardPage />) },
          { path: "products", element: lazyPage(<AdminProductsPage />) },
          { path: "orders", element: lazyPage(<AdminOrdersPage />) },
          { path: "users", element: lazyPage(<AdminUsersPage />) },
          { path: "audit-log", element: lazyPage(<AdminAuditLogPage />) },
        ],
      },
    ],
  },
];
