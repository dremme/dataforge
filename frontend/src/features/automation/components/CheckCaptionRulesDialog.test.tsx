import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderInstructionsResponse, InstructionFileResponse } from "@/shared/types";
import { CheckCaptionRulesDialog } from "./CheckCaptionRulesDialog";

const fetchFolderInstructions = vi.fn();

vi.mock("@/shared/api/folderInstructions", () => ({
  fetchFolderInstructions: (...args: unknown[]) => fetchFolderInstructions(...args),
}));

const FOLDER = "C:\\datasets\\sample\\portraits";

const NO_FILE: InstructionFileResponse = {
  text: "",
  has_file: false,
  parent_folder: null,
  parent_relative_path: null,
  parent_text: "",
};

function rulesResponse(rules: Partial<InstructionFileResponse> = {}): FolderInstructionsResponse {
  return {
    sysprompt: NO_FILE,
    caption_rules: { ...NO_FILE, ...rules },
    caption_rules_template: "",
  };
}

function renderDialog() {
  const onConfirm = vi.fn();
  const onEditRules = vi.fn();
  const onCancel = vi.fn();
  render(
    <CheckCaptionRulesDialog
      scope={{ itemCount: 12, folderLabel: "portraits", fromSelection: false }}
      folderPath={FOLDER}
      onConfirm={onConfirm}
      onEditRules={onEditRules}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onEditRules, onCancel };
}

describe("CheckCaptionRulesDialog", () => {
  beforeEach(() => {
    fetchFolderInstructions.mockReset();
  });

  it("names the folder's own rule file and starts the check", async () => {
    const user = userEvent.setup();
    fetchFolderInstructions.mockResolvedValue(
      rulesResponse({ has_file: true, text: "trigger: x\n" }),
    );
    const { onConfirm, onEditRules } = renderDialog();

    expect(await screen.findByText(/Uses this folder's/)).toBeInTheDocument();
    expect(fetchFolderInstructions).toHaveBeenCalledWith(FOLDER, expect.anything());
    await user.click(screen.getByRole("button", { name: "Lint captions" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onEditRules).not.toHaveBeenCalled();
  });

  it("names the parent folder an inherited rule file lives in", async () => {
    fetchFolderInstructions.mockResolvedValue(
      rulesResponse({
        parent_folder: "C:\\datasets\\sample",
        parent_relative_path: "..\\.captionrules",
        parent_text: "trigger: x\n",
      }),
    );
    renderDialog();

    expect(await screen.findByText("..\\.captionrules")).toHaveAttribute(
      "title",
      "C:\\datasets\\sample",
    );
    expect(screen.getByRole("button", { name: "Lint captions" })).toBeEnabled();
  });

  it("offers to edit rules that exist without starting the check", async () => {
    const user = userEvent.setup();
    fetchFolderInstructions.mockResolvedValue(
      rulesResponse({ has_file: true, text: "trigger: x\n" }),
    );
    const { onConfirm, onEditRules } = renderDialog();

    await user.click(await screen.findByRole("button", { name: "Edit rules" }));

    expect(onEditRules).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sends a folder without rules to the rules editor instead of starting", async () => {
    const user = userEvent.setup();
    fetchFolderInstructions.mockResolvedValue(rulesResponse());
    const { onConfirm, onEditRules } = renderDialog();

    expect(
      await screen.findByText(/No caption rules apply to this folder yet/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lint captions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit rules" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit caption rules" }));

    expect(onEditRules).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reports a rule file that could not be loaded and cannot start", async () => {
    fetchFolderInstructions.mockRejectedValue(new Error("Failed to read the rule file"));
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to read the rule file");
    expect(screen.getByRole("button", { name: "Lint captions" })).toBeDisabled();
  });
});
