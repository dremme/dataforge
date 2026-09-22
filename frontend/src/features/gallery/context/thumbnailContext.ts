import { createContext, useContext } from "react";
import type { ThumbnailStore } from "@/features/gallery/lib/thumbnailStore";
import type { ThumbnailVisibility } from "@/features/gallery/lib/thumbnailVisibility";

export const ThumbnailContext = createContext<{
  store: ThumbnailStore;
  visibility: ThumbnailVisibility;
} | null>(null);

export function useThumbnailRuntime() {
  const runtime = useContext(ThumbnailContext);
  if (!runtime) throw new Error("ThumbnailProvider is required");
  return runtime;
}
