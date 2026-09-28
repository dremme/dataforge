import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SettingsModal } from "./SettingsModal";

let requests: ReturnType<typeof installMockBackend>["requestsTo"];

beforeEach(() => {
  ({ requestsTo: requests } = installMockBackend());
});

async function openAppearance(onClose = vi.fn()) {
  const user = userEvent.setup();
  const view = renderWithProviders(<SettingsModal onClose={onClose} />);
  await screen.findByRole("radiogroup", { name: "Color scheme" });
  return { ...view, onClose, user };
}

describe("SettingsModal: appearance", () => {
  it("previews a scheme live and drops the preview when closed unsaved", async () => {
    const { unmount, user } = await openAppearance();

    await user.click(screen.getByRole("radio", { name: /^Light/ }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    unmount();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ui-theme")).toBeNull();
  });

  it("saves the scheme as a UI preference, not a server setting", async () => {
    const { onClose, user } = await openAppearance();

    await user.click(screen.getByRole("radio", { name: /^Light/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(localStorage.getItem("ui-theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    await waitFor(() => expect(requests("/api/preferences/ui", "PUT")).toHaveLength(1));
    const [[, init]] = requests("/api/preferences/ui", "PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ theme: "light" });
    expect(requests("/api/settings", "PUT")).toHaveLength(0);
  });
});
