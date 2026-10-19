import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Matches, RouterContextProvider } from "@tanstack/react-router";
import { AppContent } from "./AppContent";
import { createAppRouter } from "./router";
import { BackendUnavailable } from "@/app/components/BackendUnavailable";
import { JobsProvider } from "@/features/jobs/context/JobsContext";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import { EditorOptionsContext } from "@/shared/preferences/editorPreferences";
import { useUiSettings } from "@/shared/preferences/uiPreferences";
import { createQueryClient } from "@/shared/query/queryClient";
import { useThemeSync } from "@/shared/theme/theme";
import { DialogNavigationProvider } from "@/shared/ui/DialogNavigationProvider";

function ThemeSync() {
  useThemeSync();
  return null;
}

function EditorOptionsProvider({ children }: { children: ReactNode }) {
  const { editor } = useUiSettings();
  return <EditorOptionsContext value={editor}>{children}</EditorOptionsContext>;
}

export default function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <EditorOptionsProvider>
        <ServerEventsProvider>
          <NotificationsProvider>
            <JobsProvider>
              <RouterContextProvider router={router}>
                <DialogNavigationProvider>
                  {/* Resolves each new location; the routes render nothing of their own. */}
                  <Matches />
                  <AppContent />
                  <BackendUnavailable />
                </DialogNavigationProvider>
              </RouterContextProvider>
            </JobsProvider>
          </NotificationsProvider>
        </ServerEventsProvider>
      </EditorOptionsProvider>
    </QueryClientProvider>
  );
}
