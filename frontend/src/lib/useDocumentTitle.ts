import { useEffect } from "react";

/** The home page's title (every other page is "<page> · SecureCart"). */
export const HOME_TITLE = "SecureCart: everyday essentials, bought safely";

export function pageTitle(title: string): string {
  return `${title} · SecureCart`;
}

/** Sets a unique, descriptive document title per page ("Bag · SecureCart"). */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    if (title) document.title = pageTitle(title);
  }, [title]);
}
