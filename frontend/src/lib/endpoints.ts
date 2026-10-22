import { apiFetch } from "./api";
import type {
  AdminOrder,
  AdminProduct,
  AdminUser,
  AuditLogEntry,
  Cart,
  Category,
  DashboardStats,
  Order,
  OrderStatus,
  OrderSummary,
  Paginated,
  PaymentConfig,
  Product,
  ShippingAddress,
  TokenResponse,
  User,
} from "./types";

type Query = Record<string, string | number | boolean | undefined | null>;

export function toQuery(params: Query): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

const CSRF = { "X-CSRF-Protection": "1" };

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<TokenResponse>("/auth/login/", {
      method: "POST",
      body: { email, password },
      noRetry: true,
    }),
  register: (body: { email: string; full_name: string; password: string }) =>
    apiFetch<TokenResponse>("/auth/register/", { method: "POST", body, noRetry: true }),
  logout: () =>
    apiFetch<undefined>("/auth/logout/", { method: "POST", headers: CSRF, noRetry: true }),
  me: () => apiFetch<User>("/auth/me/"),
  forgotPassword: (email: string) =>
    apiFetch<{ detail: string }>("/auth/password/forgot/", {
      method: "POST",
      body: { email },
      noRetry: true,
    }),
  resetPassword: (token: string, newPassword: string) =>
    apiFetch<{ detail: string }>("/auth/password/reset/", {
      method: "POST",
      body: { token, new_password: newPassword },
      noRetry: true,
    }),
  verifyEmail: (token: string) =>
    apiFetch<{ detail: string }>("/auth/email/verify/", {
      method: "POST",
      body: { token },
      noRetry: true,
    }),
  resendVerification: () => apiFetch<{ detail: string }>("/auth/email/resend/", { method: "POST" }),
};

export interface ProductQuery extends Query {
  search?: string;
  category?: string;
  min_price?: string;
  max_price?: string;
  in_stock?: boolean;
  featured?: boolean;
  ordering?: string;
  page?: number;
  page_size?: number;
}

/** API paths of the public catalog reads (also the keys of the prerender snapshot). */
export const catalogPaths = {
  products: (params: ProductQuery = {}) => `/products/${toQuery(params)}`,
  product: (slug: string) => `/products/${encodeURIComponent(slug)}/`,
  categories: "/categories/",
};

export const catalogApi = {
  products: (params: ProductQuery = {}, signal?: AbortSignal) =>
    apiFetch<Paginated<Product>>(catalogPaths.products(params), { signal }),
  product: (slug: string) => apiFetch<Product>(catalogPaths.product(slug)),
  categories: () => apiFetch<Category[]>(catalogPaths.categories),
};

export const cartApi = {
  get: () => apiFetch<Cart>("/cart/"),
  add: (productId: number, quantity: number) =>
    apiFetch<Cart>("/cart/items/", { method: "POST", body: { product_id: productId, quantity } }),
  update: (itemId: number, quantity: number) =>
    apiFetch<Cart>(`/cart/items/${itemId}/`, { method: "PATCH", body: { quantity } }),
  remove: (itemId: number) => apiFetch<Cart>(`/cart/items/${itemId}/`, { method: "DELETE" }),
};

export const paymentsApi = {
  config: () => apiFetch<PaymentConfig>("/payments/config/"),
};

export const orderApi = {
  checkout: (body: { shipping_address: ShippingAddress; payment_token: string }, key: string) =>
    apiFetch<Order>("/checkout/", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": key },
    }),
  list: (page = 1) => apiFetch<Paginated<OrderSummary>>(`/orders/${toQuery({ page })}`),
  get: (id: string) => apiFetch<Order>(`/orders/${encodeURIComponent(id)}/`),
  cancel: (id: string) =>
    apiFetch<Order>(`/orders/${encodeURIComponent(id)}/cancel/`, { method: "POST" }),
};

export interface ProductInput {
  name: string;
  sku: string;
  description: string;
  category_id: number;
  price: string;
  stock: number;
  image_url: string;
  is_active: boolean;
  is_featured: boolean;
}

export const adminApi = {
  dashboard: () => apiFetch<DashboardStats>("/admin/dashboard/"),
  products: (params: Query) =>
    apiFetch<Paginated<AdminProduct>>(`/admin/products/${toQuery(params)}`),
  createProduct: (body: ProductInput) =>
    apiFetch<AdminProduct>("/admin/products/", { method: "POST", body }),
  updateProduct: (id: number, body: Partial<ProductInput>) =>
    apiFetch<AdminProduct>(`/admin/products/${id}/`, { method: "PATCH", body }),
  deleteProduct: (id: number) =>
    apiFetch<undefined>(`/admin/products/${id}/`, { method: "DELETE" }),
  categories: () => apiFetch<Category[]>("/admin/categories/"),
  orders: (params: Query) => apiFetch<Paginated<AdminOrder>>(`/admin/orders/${toQuery(params)}`),
  order: (id: string) => apiFetch<AdminOrder>(`/admin/orders/${id}/`),
  transition: (id: string, status: OrderStatus, note = "") =>
    apiFetch<AdminOrder>(`/admin/orders/${id}/transition/`, {
      method: "POST",
      body: { status, note },
    }),
  users: (params: Query) => apiFetch<Paginated<AdminUser>>(`/admin/users/${toQuery(params)}`),
  updateUser: (id: number, body: Partial<Pick<AdminUser, "role" | "is_active">>) =>
    apiFetch<AdminUser>(`/admin/users/${id}/`, { method: "PATCH", body }),
  auditLogs: (params: Query) =>
    apiFetch<Paginated<AuditLogEntry>>(`/admin/audit-logs/${toQuery(params)}`),
};
