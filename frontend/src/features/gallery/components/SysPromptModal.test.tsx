import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/gallery/api/captions";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";
import { SysPromptModal } from "./SysPromptModal";

const SYSPROMPT_PATH = `${HOME_PATH}\\.sysprompt`;

function makeSyspromptItem(description: string): GalleryItem {
  return {
    name: ".sysprompt",
    path: SYSPROMPT_PATH,
    description,
    has_description: description.length > 0,
    has_caption_file: true,
    issue_fixes: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    has_candidate: false,
    caption_status: "text",
    media_type: "sysprompt",
  };
}

function mockSave() {
  return vi.spyOn(api, "saveSysPrompt").mockImplementation(async (_path, text) => ({
    description: text.trim(),
    has_description: text.trim().length > 0,
    has_caption_file: true,
    caption_status: "text",
    path: SYSPROMPT_PATH,
  }));
}

function getEditor() {
  return screen.getByRole("textbox", { name: "System prompt" }) as HTMLTextAreaElement;
}

function renderModal(description: string, overrides: { onClose?: () => void } = {}) {
  return render(
    <SysPromptModal
      item={makeSyspromptItem(description)}
      onClose={overrides.onClose ?? vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

describe("SysPromptModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the prompt in characters and estimated tokens, not words", async () => {
    renderModal("Caption every image with rich detail");

    const stats = await screen.findByLabelText("Prompt statistics");

    expect(stats).toHaveTextContent("36 characters");
    // 36 characters over 6 words, so the character rule sets the estimate.
    expect(stats).toHaveTextContent("~9 tokens");

    // Words are not a unit anyone budgets in; they were replaced, not supplemented.
    expect(stats).not.toHaveTextContent("Words");
  });

  it("saves only when asked, then closes", async () => {
    const user = userEvent.setup();
    const save = mockSave();
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <SysPromptModal
        item={makeSyspromptItem("Initial prompt")}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    await user.type(getEditor(), " more");

    // Typing alone must not reach the backend; that was the autosave behaviour.
    expect(save).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(SYSPROMPT_PATH, "Initial prompt more");
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps Save and Reset inert until something changes", async () => {
    const user = userEvent.setup();
    renderModal("Initial prompt");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();

    await user.type(getEditor(), "!");

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
  });

  it("restores the opened-with text on Reset", async () => {
    const user = userEvent.setup();
    renderModal("Initial prompt");

    await user.type(getEditor(), " and then some");
    expect(getEditor()).toHaveValue("Initial prompt and then some");

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(getEditor()).toHaveValue("Initial prompt");
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("closes straight away when nothing was edited", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderModal("Initial prompt", { onClose });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before throwing away an edited prompt", async () => {
    const user = userEvent.setup();
    const save = mockSave();
    const onClose = vi.fn();

    renderModal("Initial prompt", { onClose });

    await user.type(getEditor(), " edited");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const confirm = await screen.findByRole("alertdialog", { name: "Discard changes?" });
    expect(onClose).not.toHaveBeenCalled();

    // Backing out of the confirm returns to the editor with the draft untouched.
    await user.click(within(confirm).getByRole("button", { name: "Keep editing" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(getEditor()).toHaveValue("Initial prompt edited");
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const reopened = await screen.findByRole("alertdialog", { name: "Discard changes?" });
    await user.click(within(reopened).getByRole("button", { name: "Discard" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("routes Escape through the same discard confirm", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderModal("Initial prompt", { onClose });

    await user.type(getEditor(), " edited");
    fireEvent.keyDown(getEditor(), { key: "Escape" });

    expect(
      await screen.findByRole("alertdialog", { name: "Discard changes?" }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the draft on screen when the save fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "saveSysPrompt").mockRejectedValue(new Error("disk is read-only"));
    const onClose = vi.fn();

    renderModal("Initial prompt", { onClose });

    await user.type(getEditor(), " edited");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(getEditor()).toHaveValue("Initial prompt edited");

    // The next keystroke clears the complaint.
    await user.type(getEditor(), "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the draft when the folder echoes new text for the same file", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal("Initial prompt");

    await user.type(getEditor(), " edited");

    rerender(
      <SysPromptModal
        item={makeSyspromptItem("Something the server normalized")}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(getEditor()).toHaveValue("Initial prompt edited");
  });

  it("keeps the caret where it was through a folder echo", () => {
    const { rerender } = renderModal("Initial prompt");

    const editor = getEditor();
    editor.focus();
    fireEvent.change(editor, { target: { value: "Initial !prompt" } });
    editor.setSelectionRange(9, 9);
    const selectionBeforeEcho = editor.selectionStart;

    rerender(
      <SysPromptModal
        item={makeSyspromptItem("Initial !prompt")}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(editor).toHaveValue("Initial !prompt");
    expect(editor.selectionStart).toBe(selectionBeforeEcho);
  });
});
