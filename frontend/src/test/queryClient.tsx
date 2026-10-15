import { StrictMode, type ReactElement, type ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  render,
  renderHook,
  type RenderHookOptions,
  type RenderOptions,
} from "@testing-library/react";
import { createQueryClient } from "@/shared/query/queryClient";
import { RouterHarness } from "./RouterHarness";
import { createTestRouter } from "./router";

/** The app's own client, so retry and cache rules under test are the shipped ones. */
export function createTestQueryClient({ retry = true }: { retry?: boolean } = {}): QueryClient {
  const client = createQueryClient();
  if (!retry) {
    // For tests of what an unreachable backend looks like once the retries are spent.
    const defaults = client.getDefaultOptions();
    client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  }
  return client;
}

/**
 * A `renderHook`/`render` wrapper around a fresh client and router; reuse `client` to seed or
 * inspect, and `router` to move through history.
 * StrictMode sits at the root: nested under a non-strict root it would not double-invoke effects.
 */
export function queryWrapper(
  client: QueryClient = createTestQueryClient(),
  router = createTestRouter(),
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StrictMode>
        <QueryClientProvider client={client}>
          <RouterHarness router={router}>{children}</RouterHarness>
        </QueryClientProvider>
      </StrictMode>
    );
  }

  return { client, router, wrapper: Wrapper };
}

/** `render` under a fresh query client, for components that read server state. */
export function renderWithQueryClient(
  ui: ReactElement,
  options: Omit<RenderOptions, "wrapper"> = {},
) {
  const { client, router, wrapper } = queryWrapper();
  return { client, router, ...render(ui, { ...options, wrapper }) };
}

/** `renderHook` under a fresh query client, for hooks that read server state. */
export function renderHookWithQueryClient<Result, Props>(
  callback: (props: Props) => Result,
  options: Omit<RenderHookOptions<Props>, "wrapper"> = {},
) {
  const { client, router, wrapper } = queryWrapper();
  return { client, router, ...renderHook(callback, { ...options, wrapper }) };
}
