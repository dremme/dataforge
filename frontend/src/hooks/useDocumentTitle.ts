import { useEffect } from "react";
import type { Breadcrumb } from "../types";

const DEFAULT_TITLE = "DataForge";

export function useDocumentTitle(folderPath: string | undefined, breadcrumbs: Breadcrumb[]): void {
  useEffect(() => {
    if (!folderPath) {
      document.title = DEFAULT_TITLE;
      return;
    }

    const folderName = breadcrumbs[breadcrumbs.length - 1]?.name ?? folderPath;
    document.title = `${DEFAULT_TITLE} — ${folderName}`;
  }, [breadcrumbs, folderPath]);
}
