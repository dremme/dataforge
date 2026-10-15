import { StrictMode, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import { createTestQueryClient } from "./queryClient";
import { RouterHarness } from "./RouterHarness";
import { createTestRouter } from "./router";

/** StrictMode at the root: nested under a non-strict root it would not double-invoke effects. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  const [router] = useState(() => createTestRouter());

  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ServerEventsProvider>
          <NotificationsProvider>
            <RouterHarness router={router}>{children}</RouterHarness>
          </NotificationsProvider>
        </ServerEventsProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
