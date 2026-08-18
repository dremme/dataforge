import type { ReactNode } from "react";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";

/**
 * The providers a component may assume are above it anywhere in the app.
 *
 * `ServerEventsProvider` is here because consuming push is not optional for the
 * components that do it - `useServerEvent` throws without it, and a stand-in context
 * would let a genuinely missing provider through. `setup.ts` supplies an inert
 * `EventSource`, so mounting it costs a test nothing.
 *
 * Its own file so `renderWithProviders` keeps exporting only a helper: a module that
 * exports both a component and something else loses fast refresh.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ServerEventsProvider>
      <NotificationsProvider>{children}</NotificationsProvider>
    </ServerEventsProvider>
  );
}
