import { AppContent } from "./AppContent";
import { JobsProvider } from "@/features/jobs/context/JobsContext";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";

export default function App() {
  return (
    <NotificationsProvider>
      <JobsProvider>
        <AppContent />
      </JobsProvider>
    </NotificationsProvider>
  );
}
