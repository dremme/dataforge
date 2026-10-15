import { createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter, type AppRouter } from "@/app/router";

/** The app's routes over an in-memory history, starting at ``url``. */
export function createTestRouter(url = "/"): AppRouter {
  return createAppRouter(createMemoryHistory({ initialEntries: [url] }));
}
