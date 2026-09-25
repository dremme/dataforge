import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstructionKind } from "@/shared/api/folderInstructions";
import { HOME_PATH } from "@/test/fixtures";
import type { FolderInstructionsResponse, InstructionFileResponse } from "@/shared/types";
import { FolderInstructionsModal } from "./FolderInstructionsModal";

const fetchFolderInstructions = vi.fn();
const saveInstructionFile = vi.fn();

vi.mock("@/shared/api/folderInstructions", () => ({
  fetchFolderInstructions: (...args: unknown[]) => fetchFolderInstructions(...args),
  saveInstructionFile: (...args: unknown[]) => saveInstructionFile(...args),
}));

const PROMPT = "Caption every image with rich detail";
const TEMPLATE = "words:\n  min: 8\n";
const PARENT = "C:\\datasets";

const NO_FILE: InstructionFileResponse = {
  text: "",
  has_file: false,
  parent_folder: null,
  parent_relative_path: null,
  parent_text: "",
};

const LABELS: Record<InstructionKind, string> = {
  sysprompt: "System prompt",
  caption_rules: "Caption rules",
};

function file(overrides: Partial<InstructionFileResponse> = {}): InstructionFileResponse {
  return { ...NO_FILE, ...overrides };
}

function own(text: string): InstructionFileResponse {
  return file({ text, has_file: true });
}

function inherited(kind: InstructionKind, text: string): InstructionFileResponse {
  const filename = kind === "sysprompt" ? ".sysprompt" : ".captionrules";
  return file({
    parent_folder: PARENT,
    parent_relative_path: `..\\${filename}`,
    parent_text: text,
  });
}

function instructions(
  files: Partial<Record<InstructionKind, InstructionFileResponse>> = {},
): FolderInstructionsResponse {
  return {
    sysprompt: files.sysprompt ?? own(PROMPT),
    caption_rules: files.caption_rules ?? NO_FILE,
    caption_rules_template: TEMPLATE,
  };
}

function renderModal(
  overrides: {
    initialTab?: InstructionKind;
    onClose?: () => void;
    onSaved?: (kind: InstructionKind, saved: InstructionFileResponse) => void;
  } = {},
) {
  return render(
    <FolderInstructionsModal
      folderPath={HOME_PATH}
      initialTab={overrides.initialTab}
      onClose={overrides.onClose ?? vi.fn()}
      onSaved={overrides.onSaved ?? vi.fn()}
    />,
  );
}

function editor(kind: InstructionKind) {
  return screen.findByRole("textbox", { name: LABELS[kind] });
}

function closeButton() {
  const dialog = screen.getByRole("dialog", { name: "Folder instructions" });
  return within(dialog).getByRole("button", { name: "Close" });
}

describe("FolderInstructionsModal", () => {
  beforeEach(() => {
    fetchFolderInstructions.mockReset();
    saveInstructionFile.mockReset();
    fetchFolderInstructions.mockResolvedValue(instructions());
    saveInstructionFile.mockImplementation(async (_kind, _folder, text: string) =>
      own(`${text.trim()}\n`),
    );
  });

  it("reports the prompt in characters and estimated tokens, not words", async () => {
    renderModal();
    await editor("sysprompt");

    const stats = screen.getByLabelText("Prompt statistics");
    expect(stats).toHaveTextContent("36 characters");
    // 36 characters over 6 words, so the character rule sets the estimate.
    expect(stats).toHaveTextContent("~9 tokens");
    expect(fetchFolderInstructions).toHaveBeenCalledWith(HOME_PATH, expect.anything());
  });

  it("saves only when asked, then closes", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSaved, onClose });

    await user.type(await editor("sysprompt"), " more");
    expect(saveInstructionFile).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveInstructionFile).toHaveBeenCalledWith("sysprompt", HOME_PATH, `${PROMPT} more`);
    expect(onSaved).toHaveBeenCalledWith("sysprompt", own(`${PROMPT} more\n`));
  });

  it("keeps Save and Reset inert until something changes", async () => {
    const user = userEvent.setup();
    renderModal();
    const prompt = await editor("sysprompt");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();

    await user.type(prompt, "!");

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
  });

  it("restores the saved text on Reset", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(await editor("sysprompt"), " and then some");
    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(await editor("sysprompt")).toHaveValue(PROMPT);
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("closes straight away when nothing was edited", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await editor("sysprompt");

    await user.click(closeButton());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before throwing away edits", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.type(await editor("sysprompt"), " edited");
    await user.click(closeButton());
    const confirm = await screen.findByRole("alertdialog", { name: "Discard changes?" });
    expect(confirm).toHaveTextContent("system prompt");

    await user.click(within(confirm).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await editor("sysprompt")).toHaveValue(`${PROMPT} edited`);

    await user.click(closeButton());
    const reopened = await screen.findByRole("alertdialog", { name: "Discard changes?" });
    await user.click(within(reopened).getByRole("button", { name: "Discard" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saveInstructionFile).not.toHaveBeenCalled();
  });

  it("routes Escape through the same discard confirm", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    const prompt = await editor("sysprompt");

    await user.type(prompt, " edited");
    fireEvent.keyDown(prompt, { key: "Escape" });

    expect(
      await screen.findByRole("alertdialog", { name: "Discard changes?" }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the draft on screen when the save fails", async () => {
    const user = userEvent.setup();
    saveInstructionFile.mockRejectedValue(new Error("disk is read-only"));
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.type(await editor("sysprompt"), " edited");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk is read-only");
    expect(onClose).not.toHaveBeenCalled();
    expect(await editor("sysprompt")).toHaveValue(`${PROMPT} edited`);

    await user.type(await editor("sysprompt"), "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports folder instructions that could not be loaded", async () => {
    fetchFolderInstructions.mockRejectedValue(new Error("Failed to read .sysprompt"));
    renderModal();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to read .sysprompt");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  describe("tabs", () => {
    it("shows each file behind its own tab", async () => {
      const user = userEvent.setup();
      fetchFolderInstructions.mockResolvedValue(
        instructions({ caption_rules: own("repeated_phrases: 4\n") }),
      );
      renderModal();

      expect(screen.getByRole("tab", { name: "System prompt" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await user.click(screen.getByRole("tab", { name: "Caption rules" }));

      expect(await editor("caption_rules")).toHaveValue("repeated_phrases: 4\n");
      expect(screen.queryByRole("textbox", { name: "System prompt" })).not.toBeInTheDocument();
    });

    it("opens on the requested tab", async () => {
      renderModal({ initialTab: "caption_rules" });

      expect(screen.getByRole("tab", { name: "Caption rules" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(await editor("caption_rules")).toHaveValue("");
    });

    it("moves between tabs with the arrow keys", async () => {
      const user = userEvent.setup();
      renderModal();

      screen.getByRole("tab", { name: "System prompt" }).focus();
      await user.keyboard("{ArrowRight}");

      const rulesTab = screen.getByRole("tab", { name: "Caption rules" });
      expect(rulesTab).toHaveFocus();
      expect(rulesTab).toHaveAttribute("aria-selected", "true");
    });

    it("keeps the title and the explanation of both files through a tab switch", async () => {
      const user = userEvent.setup();
      renderModal();

      const dialog = screen.getByRole("dialog", { name: "Folder instructions" });
      const heading = within(dialog).getByRole("heading", { name: "Folder instructions" });
      const explanation = heading.nextElementSibling?.textContent;
      expect(explanation).toMatch(/system prompt/i);
      expect(explanation).toMatch(/caption rules/i);

      await user.click(screen.getByRole("tab", { name: "Caption rules" }));
      await editor("caption_rules");

      expect(heading.nextElementSibling?.textContent).toBe(explanation);
    });
  });

  describe.each(["sysprompt", "caption_rules"] as const)("the %s file", (kind) => {
    it("names a parent's file without loading it into the folder's own editor", async () => {
      fetchFolderInstructions.mockResolvedValue(
        instructions({ [kind]: inherited(kind, "From the parent.\n") }),
      );
      renderModal({ initialTab: kind });

      expect(await editor(kind)).toHaveValue("");
      const path = screen.getByText(/^\.\.\\\./);
      expect(path).toHaveAttribute("title", PARENT);
      expect(path.parentElement).toHaveTextContent(/until this folder has its own/);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("copies a parent's file into a new file of the folder's own", async () => {
      const user = userEvent.setup();
      const onSaved = vi.fn();
      fetchFolderInstructions.mockResolvedValue(
        instructions({ [kind]: inherited(kind, "From the parent.\n") }),
      );
      renderModal({ initialTab: kind, onSaved });
      await editor(kind);

      await user.click(screen.getByRole("button", { name: "Copy from parent" }));
      expect(await editor(kind)).toHaveValue("From the parent.\n");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(saveInstructionFile).toHaveBeenCalledWith(kind, HOME_PATH, "From the parent.\n"),
      );
      expect(onSaved).toHaveBeenCalledWith(kind, own("From the parent.\n"));
    });

    it("says when the folder's own file replaces a parent's", async () => {
      fetchFolderInstructions.mockResolvedValue(
        instructions({
          [kind]: { ...inherited(kind, "From the parent.\n"), text: "Own.\n", has_file: true },
        }),
      );
      renderModal({ initialTab: kind });

      expect(await editor(kind)).toHaveValue("Own.\n");
      expect(screen.getByText(/^\.\.\\\./).parentElement).toHaveTextContent(/replacing/);
    });

    it("sends blank text so the backend removes the file", async () => {
      const user = userEvent.setup();
      fetchFolderInstructions.mockResolvedValue(instructions({ [kind]: own("Own.\n") }));
      renderModal({ initialTab: kind });

      await user.clear(await editor(kind));
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(saveInstructionFile).toHaveBeenCalledWith(kind, HOME_PATH, ""));
    });
  });

  it("offers the template only for caption rules with nothing to inherit", async () => {
    const user = userEvent.setup();
    fetchFolderInstructions.mockResolvedValue(instructions({ sysprompt: NO_FILE }));
    renderModal();

    expect(await editor("sysprompt")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Use template" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Caption rules" }));
    await user.click(await screen.findByRole("button", { name: "Use template" }));

    expect(await editor("caption_rules")).toHaveValue(TEMPLATE);
    expect(screen.queryByRole("button", { name: "Use template" })).not.toBeInTheDocument();
  });

  it("saves the rules before the prompt when both changed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.type(await editor("sysprompt"), " more");
    await user.click(screen.getByRole("tab", { name: "Caption rules" }));
    await user.type(await editor("caption_rules"), "trigger: x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveInstructionFile.mock.calls.map(([kind]) => kind)).toEqual([
      "caption_rules",
      "sysprompt",
    ]);
  });

  it("stays on the rules tab and keeps the prompt unsaved when the rules are refused", async () => {
    const user = userEvent.setup();
    saveInstructionFile.mockRejectedValue(new Error("colour: unknown setting"));
    const onClose = vi.fn();
    renderModal({ onClose });

    await user.type(await editor("sysprompt"), " more");
    await user.click(screen.getByRole("tab", { name: "Caption rules" }));
    await user.type(await editor("caption_rules"), "colour: blue");
    await user.click(screen.getByRole("tab", { name: "System prompt" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("colour: unknown setting");
    expect(screen.getByRole("tab", { name: "Caption rules" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(saveInstructionFile).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
