import { Compass } from "lucide-react";
import { Link } from "react-router";

import { buttonClasses } from "@/components/ui/buttonClasses";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <div className="container-text py-20">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Link to="/" className={buttonClasses("primary")}>
            Go to the store
          </Link>
        }
      />
    </div>
  );
}
