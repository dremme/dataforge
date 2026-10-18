import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { EDITOR_ROUTE, isEditorKind } from "@/features/videoEditor/lib/editorLocation";
import { installHistoryPopGate } from "@/shared/lib/historyPopGate";

/**
 * The app's two places: the gallery of a folder, and the video editor over the folder of what it
 * edits. Both name a path in the query string, so a reload or a shared link reopens either one.
 * The routes render nothing: the app shell is always mounted and reads the location itself, so
 * the first render needs no route load.
 */

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
  interface HistoryState {
    /** The folder view's scroll memory key; the editor's entry copies its gallery's. */
    entryKey?: string;
    /** The editor's entry was pushed over the gallery, so leaving it can step back. */
    editorOverGallery?: boolean;
  }
}

export interface GallerySearch {
  /** The folder shown; the server's default folder when absent. */
  path?: string;
}

export interface EditorSearch {
  /** The video or draft edited, or for a new project the folder it is made in. */
  path: string;
}

function pathParam(search: Record<string, unknown>): string | undefined {
  return typeof search.path === "string" && search.path ? search.path : undefined;
}

export function createAppRouter(history?: RouterHistory) {
  if (!history && typeof window !== "undefined") installHistoryPopGate();
  const rootRoute = createRootRoute();
  const galleryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    validateSearch: (search): GallerySearch => {
      const path = pathParam(search);
      return path ? { path } : {};
    },
  });
  const editorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: EDITOR_ROUTE,
    validateSearch: (search): EditorSearch => ({ path: pathParam(search) ?? "" }),
    beforeLoad: ({ params, search }) => {
      if (!isEditorKind(params.kind) || !search.path) throw redirect({ to: "/", replace: true });
    },
  });
  // Any other address opens the gallery rather than an empty page.
  const fallbackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    beforeLoad: () => {
      throw redirect({ to: "/", replace: true });
    },
  });

  return createRouter({
    routeTree: rootRoute.addChildren([galleryRoute, editorRoute, fallbackRoute]),
    history,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
