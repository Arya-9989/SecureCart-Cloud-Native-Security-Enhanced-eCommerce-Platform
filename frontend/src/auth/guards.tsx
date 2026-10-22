import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";

import { PageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

import { useAuth } from "./useAuth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <PageSpinner label="Checking your session" />;
  if (status === "anonymous") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/**
 * Client-side gate for admin screens. This is a UX nicety only: every admin endpoint is
 * independently protected by the API's IsAdminRole permission.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return (
    <RequireAuth>
      {isAdmin ? (
        children
      ) : (
        <div className="container-page py-20">
          <EmptyState
            icon={ShieldAlert}
            title="Administrator access required"
            description="Your account doesn't have permission to view this page."
            action={
              <Link to="/" className="font-semibold text-brand hover:underline">
                Back to the store
              </Link>
            }
          />
        </div>
      )}
    </RequireAuth>
  );
}
