import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import type { VideoEditorRequest } from "@/features/videoEditor/context/VideoEditorContext";
import {
  EDITOR_ROUTE,
  editorFolder,
  editorRequestAt,
  sameRequest,
} from "@/features/videoEditor/lib/editorLocation";
import { useLatestRef } from "@/shared/hooks/useLatestRef";

export interface VideoEditorRoute {
  /** What the open editor session was started on; null while the gallery shows. */
  request: VideoEditorRequest | null;
  open: (request: VideoEditorRequest) => void;
  /** The session's file moved, e.g. a new project's first save made a draft. */
  relocate: (request: VideoEditorRequest) => void;
  /**
   * Leaves once the editor has saved or the user chose to drop changes, so it passes the
   * editor's blocker. ``then`` runs back in the gallery.
   */
  close: (then?: () => void) => void;
}

/**
 * The editor as a route over the gallery: opening pushes an entry, so Back returns to the gallery
 * and Forward or a reload opens the editor again. The session keeps the request it started on
 * while its own saves move the address, so a relocation never reopens it.
 */
export function useVideoEditorRoute(onClosed: () => void): VideoEditorRoute {
  const router = useRouter();
  const location = useLocation();
  const atAddress = editorRequestAt(location.pathname, location.search);
  const [session, setSession] = useState(atAddress);
  const [moved, setMoved] = useState<VideoEditorRequest | null>(null);
  // ``moved`` only names an editor address; null there is the gallery, never a relocation.
  const relocatedHere = moved !== null && sameRequest(atAddress, moved);
  if (!sameRequest(atAddress, session) && !relocatedHere) {
    setSession(atAddress);
    setMoved(null);
  }

  const onClosedRef = useLatestRef(onClosed);
  const afterCloseRef = useRef<(() => void) | null>(null);
  const wasOpenRef = useRef(session !== null);
  useEffect(() => {
    if (wasOpenRef.current && !session) {
      onClosedRef.current();
      const after = afterCloseRef.current;
      afterCloseRef.current = null;
      after?.();
    }
    wasOpenRef.current = session !== null;
  }, [onClosedRef, session]);

  const open = useCallback(
    (request: VideoEditorRequest) => {
      void router.navigate({
        to: EDITOR_ROUTE,
        params: { kind: request.kind },
        search: { path: request.path },
        state: (current) => ({ entryKey: current.entryKey, editorOverGallery: true }),
      });
    },
    [router],
  );

  const relocate = useCallback(
    (request: VideoEditorRequest) => {
      setMoved(request);
      void router.navigate({
        to: EDITOR_ROUTE,
        params: { kind: request.kind },
        search: { path: request.path },
        replace: true,
        state: true,
      });
    },
    [router],
  );

  const close = useCallback(
    (then?: () => void) => {
      const { pathname, search, state } = router.history.location;
      const request = editorRequestAt(pathname, router.options.parseSearch(search));
      if (!request) {
        then?.();
        return;
      }
      afterCloseRef.current = then ?? null;
      if (state.editorOverGallery) {
        router.history.back({ ignoreBlocker: true });
      } else {
        // Opened by address, with no gallery entry under it: turn this entry into the gallery.
        void router.navigate({
          to: "/",
          search: { path: editorFolder(request) },
          replace: true,
          ignoreBlocker: true,
          state: (current) => ({ entryKey: current.entryKey }),
        });
      }
    },
    [router],
  );

  return { request: session, open, relocate, close };
}
