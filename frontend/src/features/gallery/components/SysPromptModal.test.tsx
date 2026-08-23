import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/gallery/api/captions";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";
import { SysPromptModal } from "./SysPromptModal";

function makeSyspromptItem(description: string): GalleryItem {
  return {
    name: ".sysprompt",
    path: `${HOME_PATH}\\.sysprompt`,
    description,
    has_description: description.length > 0,
    has_caption_file: true,
    issue_fixes: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    caption_status: "text",
    media_type: "sysprompt",
  };
}

describe("SysPromptModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps editor content and selection when folder echoes a save", async () => {
    vi.spyOn(api, "saveSysPrompt").mockImplementation(async (_path, text) => ({
      description: text.trim(),
      has_description: text.trim().length > 0,
      has_caption_file: true,
      caption_status: "text",
      path: `${HOME_PATH}\\.sysprompt`,
    }));

    const onSaved = vi.fn();
    const { rerender } = render(
      <SysPromptModal
        item={makeSyspromptItem("Initial prompt")}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "System prompt" }) as HTMLTextAreaElement;
    editor.focus();
    fireEvent.change(editor, { target: { value: "Initial !prompt" } });
    editor.setSelectionRange(9, 9);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    const selectionBeforeEcho = editor.selectionStart;
    expect(editor).toHaveValue("Initial !prompt");

    rerender(
      <SysPromptModal
        item={makeSyspromptItem("Initial !prompt")}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    expect(editor).toHaveValue("Initial !prompt");
    expect(editor.selectionStart).toBe(selectionBeforeEcho);
  });

  it("does not apply server-normalized folder text while the modal stays open", async () => {
    vi.spyOn(api, "saveSysPrompt").mockImplementation(async (_path, text) => ({
      description: text.trim(),
      has_description: text.trim().length > 0,
      has_caption_file: true,
      caption_status: "text",
      path: `${HOME_PATH}\\.sysprompt`,
    }));

    const onSaved = vi.fn();
    const { rerender } = render(
      <SysPromptModal item={makeSyspromptItem("Hello")} onClose={vi.fn()} onSaved={onSaved} />,
    );

    const editor = screen.getByRole("textbox", { name: "System prompt" });
    const user = userEvent.setup();

    await user.type(editor, "  ");

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    expect(editor).toHaveValue("Hello  ");

    rerender(
      <SysPromptModal item={makeSyspromptItem("Hello")} onClose={vi.fn()} onSaved={onSaved} />,
    );

    expect(editor).toHaveValue("Hello  ");
  });
});
