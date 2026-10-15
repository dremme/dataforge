import type { ReactNode } from "react";
import { Matches, RouterContextProvider } from "@tanstack/react-router";
import type { AppRouter } from "@/app/router";

/** Mounts ``children`` inside ``router`` the way App does. */
export function RouterHarness({ router, children }: { router: AppRouter; children: ReactNode }) {
  return (
    <RouterContextProvider router={router}>
      <Matches />
      {children}
    </RouterContextProvider>
  );
}
