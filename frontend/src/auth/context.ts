import { createContext } from "react";

import type { User } from "@/lib/types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { email: string; full_name: string; password: string }) => Promise<User>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
