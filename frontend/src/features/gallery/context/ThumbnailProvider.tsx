import { useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { ThumbnailStore } from "@/features/gallery/lib/thumbnailStore";
import { ThumbnailVisibility } from "@/features/gallery/lib/thumbnailVisibility";
import { ThumbnailContext } from "./thumbnailContext";

export function ThumbnailProvider({
  children,
  paused = false,
}: {
  children: ReactNode;
  paused?: boolean;
}) {
  const [runtime] = useState(() => {
    const store = new ThumbnailStore();
    store.setPaused(paused);
    return { store, visibility: new ThumbnailVisibility() };
  });
  useLayoutEffect(() => {
    runtime.store.setPaused(paused);
  }, [paused, runtime]);
  useLayoutEffect(
    () => () => {
      runtime.visibility.dispose();
      runtime.store.dispose();
    },
    [runtime],
  );
  return <ThumbnailContext value={runtime}>{children}</ThumbnailContext>;
}
