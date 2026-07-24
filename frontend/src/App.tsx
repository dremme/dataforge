import { AppContent } from "./AppContent";
import { JobsProvider } from "./context/JobsContext";
import { NotificationsProvider } from "./context/notifications/NotificationsProvider";

export default function App() {
  return (
    <NotificationsProvider>
      <JobsProvider>
        <AppContent />
      </JobsProvider>
    </NotificationsProvider>
  );
}
