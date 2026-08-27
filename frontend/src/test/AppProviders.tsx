import type { ReactNode } from "react";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ServerEventsProvider>
      <NotificationsProvider>{children}</NotificationsProvider>
    </ServerEventsProvider>
  );
}
