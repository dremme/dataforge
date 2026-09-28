import { AppContent } from "./AppContent";
import { JobsProvider } from "@/features/jobs/context/JobsContext";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import { useThemeSync } from "@/shared/theme/theme";

export default function App() {
  useThemeSync();

  return (
    <ServerEventsProvider>
      <NotificationsProvider>
        <JobsProvider>
          <AppContent />
        </JobsProvider>
      </NotificationsProvider>
    </ServerEventsProvider>
  );
}
