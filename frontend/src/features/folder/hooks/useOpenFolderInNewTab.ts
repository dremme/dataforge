import { useCallback, type MouseEvent } from "react";
import { useRouter } from "@tanstack/react-router";

const MIDDLE_BUTTON = 1;

/** Mouse handlers that open a folder in a new browser tab on a middle click, as a link would. */
export function useOpenFolderInNewTab() {
  const router = useRouter();

  return useCallback(
    (path: string) => ({
      // Chromium starts autoscroll on a middle press, which swallows the click that follows.
      onMouseDown: (event: MouseEvent) => {
        if (event.button === MIDDLE_BUTTON) event.preventDefault();
      },
      onAuxClick: (event: MouseEvent) => {
        if (event.button !== MIDDLE_BUTTON) return;
        event.preventDefault();
        const { href } = router.buildLocation({ to: "/", search: { path } });
        window.open(router.history.createHref(href), "_blank", "noopener");
      },
    }),
    [router],
  );
}
