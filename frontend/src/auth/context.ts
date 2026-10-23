import { createContext } from "react";

import type { TokenResponse, User } from "@/lib/types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { email: string; full_name: string; password: string }) => Promise<User>;
  logout: () => Promise<void>;
  /** Re-read the profile (e.g. after the email address was confirmed in another tab). */
  reloadUser: () => Promise<void>;
  /** Adopt a fresh session the server issued (after a password change). */
  adopt: (data: TokenResponse) => void;
  /** Forget the session locally after the server already ended it (sign out everywhere). */
  forget: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
