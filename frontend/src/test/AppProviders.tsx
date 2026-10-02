import { StrictMode, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import { createTestQueryClient } from "./queryClient";

/** StrictMode at the root: nested under a non-strict root it would not double-invoke effects. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());

  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ServerEventsProvider>
          <NotificationsProvider>{children}</NotificationsProvider>
        </ServerEventsProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
