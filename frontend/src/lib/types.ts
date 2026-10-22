// Types mirror the backend serializers (see /api/docs/ for the OpenAPI schema).
// Money is transported as decimal strings to avoid floating-point rounding.

export type Role = "admin" | "customer";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  date_joined: string;
}

export interface TokenResponse {
  access: string;
  user: User;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface CategoryRef {
  id: number;
  name: string;
  slug: string;
}

export interface Category extends CategoryRef {
  description: string;
  product_count: number;
}

export interface Product {
  id: number;
  name: string;
  slug: string;
  sku: string;
  description: string;
  category: CategoryRef;
  price: string;
  stock: number;
  in_stock: boolean;
  image_url: string;
  is_featured: boolean;
  created_at: string;
}

export interface AdminProduct extends Product {
  is_active: boolean;
  updated_at: string;
}

export interface CartItem {
  id: number;
  product: Pick<Product, "id" | "name" | "slug" | "sku" | "price" | "stock" | "image_url"> & {
    is_active: boolean;
  };
  quantity: number;
  line_total: string;
  is_available: boolean;
}

export interface Cart {
  items: CartItem[];
  item_count: number;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  currency: string;
  updated_at: string;
}

export type OrderStatus =
  "pending_payment" | "paid" | "shipped" | "delivered" | "cancelled" | "payment_failed";

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postal_code: string;
  country: string;
}

export interface OrderItem {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  image_url: string;
  unit_price: string;
  quantity: number;
  line_total: string;
}

export interface OrderEvent {
  from_status: OrderStatus | "";
  to_status: OrderStatus;
  note: string;
  created_at: string;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  currency: string;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  shipping_address: ShippingAddress;
  payment_provider: string;
  failure_reason: string;
  items: OrderItem[];
  events: OrderEvent[];
  can_cancel: boolean;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
}

export interface AdminOrder extends Order {
  customer_email: string;
  customer_name: string;
  payment_reference: string;
  allowed_transitions: OrderStatus[];
}

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  currency: string;
  total: string;
  item_count: number;
  preview_images: string[];
  created_at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
  order_count: number;
}

export interface AuditLogEntry {
  id: number;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  target_repr: string;
  changes: Record<string, unknown>;
  ip_address: string | null;
  request_id: string;
  created_at: string;
}

export interface DashboardStats {
  currency: string;
  revenue_total: string;
  revenue_30d: string;
  average_order_value: string;
  orders_total: number;
  orders_by_status: Record<OrderStatus, number>;
  customers_total: number;
  products_active: number;
  revenue_by_day: { date: string; revenue: string; orders: number }[];
  top_products: { product_id: number; product_name: string; units: number; revenue: string }[];
  low_stock: { id: number; name: string; sku: string; stock: number }[];
}
