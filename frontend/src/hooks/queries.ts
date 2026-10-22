import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { cartApi, catalogApi, orderApi, type ProductQuery } from "@/lib/endpoints";
import type { Cart } from "@/lib/types";

export const keys = {
  categories: ["catalog", "categories"] as const,
  products: (params: ProductQuery) => ["catalog", "products", params] as const,
  product: (slug: string) => ["catalog", "product", slug] as const,
  cart: ["cart"] as const,
  orders: (page: number) => ["orders", page] as const,
  order: (id: string) => ["order", id] as const,
};

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: catalogApi.categories,
    staleTime: 5 * 60_000,
  });
}

export function useProducts(params: ProductQuery) {
  return useQuery({
    queryKey: keys.products(params),
    queryFn: ({ signal }) => catalogApi.products(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(slug: string) {
  return useQuery({ queryKey: keys.product(slug), queryFn: () => catalogApi.product(slug) });
}

export function useCart() {
  const { status } = useAuth();
  return useQuery({
    queryKey: keys.cart,
    queryFn: cartApi.get,
    enabled: status === "authenticated",
  });
}

function useCartMutation<TVars>(mutationFn: (vars: TVars) => Promise<Cart>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn,
    onSuccess: (cart) => {
      queryClient.setQueryData(keys.cart, cart);
    },
    onError: (error) => {
      toast.error("Couldn't update your cart", errorMessage(error));
    },
  });
}

/** Adds to cart, or sends anonymous shoppers to sign in and come back. */
export function useAddToCart() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const mutation = useCartMutation(
    ({ productId, quantity }: { productId: number; quantity: number; name: string }) =>
      cartApi.add(productId, quantity),
  );
  return {
    ...mutation,
    add: (productId: number, quantity: number, name: string) => {
      if (status !== "authenticated") {
        toast.show("info", "Sign in to start your cart", "Your cart is saved to your account.");
        void navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      mutation.mutate(
        { productId, quantity, name },
        {
          onSuccess: () => {
            toast.success("Added to cart", `${quantity} × ${name}`);
          },
        },
      );
    },
  };
}

export function useUpdateCartItem() {
  return useCartMutation(({ itemId, quantity }: { itemId: number; quantity: number }) =>
    cartApi.update(itemId, quantity),
  );
}

export function useRemoveCartItem() {
  return useCartMutation((itemId: number) => cartApi.remove(itemId));
}

export function useOrders(page: number) {
  return useQuery({
    queryKey: keys.orders(page),
    queryFn: () => orderApi.list(page),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: string) {
  return useQuery({ queryKey: keys.order(id), queryFn: () => orderApi.get(id) });
}
