import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { ...options, wrapper: NotificationsProvider });
}
