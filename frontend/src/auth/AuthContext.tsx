import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { hasSession, mayHaveSession, onSessionChange, refreshSession, setSession } from "@/lib/api";
import { authApi } from "@/lib/endpoints";
import type { TokenResponse, User } from "@/lib/types";

import { AuthContext, type AuthContextValue, type AuthStatus } from "./context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const apply = useCallback((next: User | null) => {
    setUser(next);
    setStatus(next ? "authenticated" : "anonymous");
  }, []);

  useEffect(() => {
    let active = true;
    // Restore the session from the httpOnly refresh cookie on page load. Browsers that have
    // never signed in skip the request, which could only answer 401.
    if (mayHaveSession()) {
      void refreshSession().then((restored) => {
        if (active) apply(restored);
      });
    } else {
      apply(null);
    }
    const unsubscribe = onSessionChange((next) => {
      apply(next);
      if (!next) queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "catalog" });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [apply, queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await authApi.login(email, password);
      setSession(data.access);
      apply(data.user);
      return data.user;
    },
    [apply],
  );

  const register = useCallback(
    async (input: { email: string; full_name: string; password: string }) => {
      const data = await authApi.register(input);
      setSession(data.access);
      apply(data.user);
      return data.user;
    },
    [apply],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setSession(null);
      apply(null);
      queryClient.clear();
    }
  }, [apply, queryClient]);

  const reloadUser = useCallback(async () => {
    if (!hasSession()) return;
    apply(await authApi.me());
  }, [apply]);

  const adopt = useCallback(
    (data: TokenResponse) => {
      setSession(data.access);
      apply(data.user);
    },
    [apply],
  );

  const forget = useCallback(() => {
    setSession(null);
    apply(null);
    queryClient.clear();
  }, [apply, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAdmin: user?.role === "admin",
      login,
      register,
      logout,
      reloadUser,
      adopt,
      forget,
    }),
    [status, user, login, register, logout, reloadUser, adopt, forget],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
