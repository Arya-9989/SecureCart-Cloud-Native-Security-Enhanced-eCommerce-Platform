import { z } from "./zod";

export const COUNTRIES = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["IN", "India"],
  ["AU", "Australia"],
  ["JP", "Japan"],
] as const;

export const checkoutSchema = z.object({
  name: z.string().trim().min(2, "Enter the recipient's full name").max(120),
  line1: z.string().trim().min(3, "Enter a street address").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, "Enter a city").max(100),
  postal_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 -]{3,10}$/, "Enter a valid postal code"),
  country: z.enum(COUNTRIES.map(([code]) => code) as [string, ...string[]]),
  payment_token: z.enum(["tok_mock_approve", "tok_mock_decline"]),
});

export const productSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  sku: z
    .string()
    .trim()
    .min(1, "SKU is required")
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only"),
  description: z.string().max(4000),
  category_id: z.coerce.number<string>().int().positive("Choose a category"),
  price: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter a price like 49.99")
    .refine((v) => Number(v) > 0, "Price must be greater than zero"),
  stock: z.coerce.number<string>().int("Whole numbers only").min(0, "Stock cannot be negative"),
  image_url: z
    .string()
    .trim()
    .regex(/^$|^\/(?!\/)[A-Za-z0-9._~/-]*$|^https:\/\/\S+$/, "Use /path.svg or an https:// URL"),
  is_active: z.boolean(),
  is_featured: z.boolean(),
});
