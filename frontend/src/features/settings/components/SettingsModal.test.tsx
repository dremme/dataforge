import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getThumbnailEpoch } from "@/features/gallery/lib/thumbnailEpoch";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SettingsModal } from "./SettingsModal";

let backend: ReturnType<typeof installMockBackend>;

beforeEach(() => {
  backend = installMockBackend();
});

const settingsRequests = (method: string) => backend.requestsTo("/api/settings", method);

async function openDialog(section = "Vision model", onClose = vi.fn()) {
  const user = userEvent.setup();
  renderWithProviders(<SettingsModal onClose={onClose} />);
  await screen.findByRole("textbox", { name: "Server URL", hidden: true });
  await user.click(screen.getByRole("tab", { name: new RegExp(`^${section}`) }));
  return { onClose, user };
}

describe("SettingsModal", () => {
  it("shows where each value comes from and saves nothing until edited", async () => {
    await openDialog();

    expect(screen.getByRole("textbox", { name: "Server URL" })).toHaveValue(
      "http://127.0.0.1:8888/v1",
    );
    expect(screen.getByRole("textbox", { name: "Server URL" })).toHaveAccessibleDescription(
      "Default",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves only the edited value and closes", async () => {
    const { onClose, user } = await openDialog("Integrations");

    const comfy = screen.getByRole("textbox", { name: "ComfyUI URL" });
    await user.clear(comfy);
    await user.type(comfy, "http://127.0.0.1:9100");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [[, init]] = settingsRequests("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ comfy_base_url: "http://127.0.0.1:9100" });
  });

  it("marks the section holding an unsaved change", async () => {
    const { user } = await openDialog();

    await user.type(screen.getByRole("textbox", { name: "Model" }), "-q4");

    expect(
      within(screen.getByRole("tab", { name: /Vision model/ })).getByLabelText("Unsaved"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Model" })).toHaveAccessibleDescription("Edited");
  });

  it("refuses a malformed number without asking the server", async () => {
    const { onClose, user } = await openDialog();

    await user.type(screen.getByRole("textbox", { name: "Timeout (seconds)" }), "s");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Timeout needs a number of seconds.",
    );
    expect(screen.getByRole("textbox", { name: "Timeout (seconds)" })).toBeInvalid();
    expect(settingsRequests("PUT")).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the server's reason when it refuses a value", async () => {
    const serve = backend.fetchMock.getMockImplementation()!;
    backend.fetchMock.mockImplementation(async (input, init) =>
      String(input) === "/api/settings" && init?.method === "PUT"
        ? new Response(JSON.stringify({ detail: "Server URL must use a port from 1 to 65535." }), {
            status: 422,
          })
        : serve(input, init),
    );
    const { onClose, user } = await openDialog();

    await user.type(screen.getByRole("textbox", { name: "Server URL" }), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server URL must use a port from 1 to 65535.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("resets a saved value back to its fallback", async () => {
    const serve = backend.fetchMock.getMockImplementation()!;
    await serve("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ vision_model: "model-b" }),
    });
    backend.fetchMock.mockClear();
    const { user } = await openDialog();

    const model = screen.getByRole("textbox", { name: "Model" });
    expect(model).toHaveValue("model-b");
    expect(model).toHaveAccessibleDescription("Saved Overrides default qwen38");

    await user.click(screen.getByRole("button", { name: "Reset Model" }));

    expect(model).toHaveValue("qwen38");
    expect(model).toHaveAccessibleDescription("Will reset Returns to the default on save");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(settingsRequests("PUT")).toHaveLength(1));
    const [[, init]] = settingsRequests("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ reset: ["vision_model"] });
  });

  it("clears the thumbnail cache and moves thumbnails to a new epoch", async () => {
    const { user } = await openDialog("Storage");
    const epoch = getThumbnailEpoch();

    const stats = await screen.findByRole("status");
    expect(await within(stats).findByText("1,200")).toBeInTheDocument();
    expect(within(stats).getByText("48.0 MB")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear cache" }));

    expect(await screen.findByText(/Cleared 1,200 thumbnails \(48\.0 MB\)/)).toBeInTheDocument();
    expect(within(stats).getByText("0")).toBeInTheDocument();
    expect(within(stats).getByText("0 B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear cache" })).toBeDisabled();
    expect(getThumbnailEpoch()).toBe(epoch + 1);
  });

  it("moves between sections with the arrow keys", async () => {
    const { user } = await openDialog();

    screen.getByRole("tab", { name: /^Vision model/ }).focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("tab", { name: /^Integrations/ })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "AI-Toolkit URL" })).toBeVisible();
  });
});
