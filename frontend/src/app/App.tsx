import { AppContent } from "./AppContent";
import { JobsProvider } from "@/features/jobs/context/JobsContext";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";

export default function App() {
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
