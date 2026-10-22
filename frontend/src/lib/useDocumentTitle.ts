import { useEffect } from "react";

/** Sets a unique, descriptive document title per page ("Bag · SecureCart"). */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    if (title) document.title = `${title} · SecureCart`;
  }, [title]);
}
