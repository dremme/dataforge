import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { AppContent } from "./AppContent";
import { JobsProvider } from "@/features/jobs/context/JobsContext";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import { createQueryClient } from "@/shared/query/queryClient";
import { useThemeSync } from "@/shared/theme/theme";

function ThemeSync() {
  useThemeSync();
  return null;
}

export default function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <ServerEventsProvider>
        <NotificationsProvider>
          <JobsProvider>
            <AppContent />
          </JobsProvider>
        </NotificationsProvider>
      </ServerEventsProvider>
    </QueryClientProvider>
  );
}
