import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SettingsDialog } from "./SettingsDialog";

let requests: ReturnType<typeof installMockBackend>["requestsTo"];

beforeEach(() => {
  ({ requestsTo: requests } = installMockBackend());
});

async function openAppearance(onClose = vi.fn<() => void>()) {
  const user = userEvent.setup();
  const view = renderWithProviders(<SettingsDialog onClose={onClose} />);
  await screen.findByRole("radiogroup", { name: "Color scheme" });
  return { ...view, onClose, user };
}

describe("SettingsDialog: appearance", () => {
  it("keeps a preview when dismissal is cancelled and closes directly after undoing the edit", async () => {
    const { user, onClose } = await openAppearance();
    const original = screen.getByRole("radio", { checked: true });

    await user.click(screen.getByRole("radio", { name: /^Light/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("radio", { name: /^Light/ })).toBeChecked();

    await user.click(original);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog", { name: "Discard changes?" })).not.toBeInTheDocument();
  });

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

  it("saves the gallery card options together as a UI preference", async () => {
    const { onClose, user } = await openAppearance();

    await user.click(screen.getByRole("tab", { name: "Gallery" }));
    await user.selectOptions(screen.getByLabelText("Large card caption"), "6 lines");
    await user.selectOptions(screen.getByLabelText("Small card caption"), "Off");
    await user.click(screen.getByRole("checkbox", { name: "Show megapixels" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Show the aspect ratio on large cards" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Show tags on large cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Show a caption preview" }));

    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(requests("/api/preferences/ui", "PUT")).toHaveLength(1));
    const [[, init]] = requests("/api/preferences/ui", "PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      gallery_cards: {
        small_caption_lines: 0,
        large_caption_lines: 6,
        megapixels: false,
        large_aspect_ratio: false,
        large_tags: false,
        list_caption_preview: true,
        card_actions: ["open", "copy_caption", "delete"],
      },
    });
  });

  it("saves the card actions a card shows, in catalog order", async () => {
    const { onClose, user } = await openAppearance();

    await user.click(screen.getByRole("tab", { name: "Gallery" }));
    const group = within(screen.getByRole("region", { name: "Card actions" }));
    expect(group.getByRole("checkbox", { name: "Open" })).toBeChecked();
    expect(group.getByRole("checkbox", { name: "Rename file" })).not.toBeChecked();
    await user.click(group.getByRole("checkbox", { name: "Rename file" }));
    await user.click(group.getByRole("checkbox", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(requests("/api/preferences/ui", "PUT")).toHaveLength(1));
    const [[, init]] = requests("/api/preferences/ui", "PUT");
    expect(JSON.parse(init?.body as string).gallery_cards.card_actions).toEqual([
      "open",
      "copy_caption",
      "rename_file",
    ]);
  });

  it("does not count card actions put back as they were", async () => {
    const { user } = await openAppearance();

    await user.click(screen.getByRole("tab", { name: "Gallery" }));
    const delete_ = screen.getByRole("checkbox", { name: "Delete" });
    await user.click(delete_);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(delete_);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("does not count gallery options put back as they were", async () => {
    const { user } = await openAppearance();

    await user.click(screen.getByRole("tab", { name: "Gallery" }));
    const large = screen.getByLabelText("Large card caption");
    await user.selectOptions(large, "Off");
    await user.selectOptions(large, "4 lines");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves the editor preferences as a UI preference", async () => {
    const { onClose, user } = await openAppearance();

    await user.click(screen.getByRole("tab", { name: "Editor" }));
    await user.click(screen.getByRole("checkbox", { name: "Wrap long lines" }));
    await user.click(screen.getByRole("checkbox", { name: "Show line numbers" }));
    await user.selectOptions(screen.getByLabelText("Spelling language"), "German");
    await user.click(screen.getByRole("checkbox", { name: "Suggest words while typing" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(requests("/api/preferences/ui", "PUT")).toHaveLength(1));
    const [[, init]] = requests("/api/preferences/ui", "PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      editor: {
        line_wrap: false,
        line_numbers: false,
        caption_spellcheck: true,
        caption_spellcheck_language: "de",
        caption_suggestions: false,
      },
    });
  });

  it("disables the spelling language while spelling is off", async () => {
    const { user } = await openAppearance();

    await user.click(screen.getByRole("tab", { name: "Editor" }));
    await user.click(screen.getByRole("checkbox", { name: "Check spelling" }));

    expect(screen.getByLabelText("Spelling language")).toBeDisabled();
  });
});
