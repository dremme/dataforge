import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FolderInstructionsApi from "@/shared/api/folderInstructions";
import type { FolderInstructionsResponse, InstructionFileResponse } from "@/shared/types";
import { CheckCaptionRulesDialog } from "./CheckCaptionRulesDialog";

const fetchFolderInstructions = vi.fn();

vi.mock("@/shared/api/folderInstructions", async (importOriginal) => ({
  ...(await importOriginal<typeof FolderInstructionsApi>()),
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
  const onCancel = vi.fn();
  render(
    <CheckCaptionRulesDialog
      scope={{ itemCount: 12, folderLabel: "portraits", fromSelection: false }}
      folderPath={FOLDER}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

function footer() {
  return screen.getByRole("alertdialog").querySelector("footer") as HTMLElement;
}

describe("CheckCaptionRulesDialog", () => {
  beforeEach(() => {
    fetchFolderInstructions.mockReset();
  });

  it("names the folder's own rule file at the bottom and starts the check", async () => {
    const user = userEvent.setup();
    fetchFolderInstructions.mockResolvedValue(
      rulesResponse({ has_file: true, text: "trigger: x\n" }),
    );
    const { onConfirm } = renderDialog();

    expect(await within(footer()).findByText(".captionrules")).toBeInTheDocument();
    expect(footer().querySelector(".instruction-file-source")).toHaveTextContent(
      "Uses .captionrules",
    );
    expect(fetchFolderInstructions).toHaveBeenCalledWith(FOLDER, expect.anything());
    await user.click(screen.getByRole("button", { name: "Lint captions" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
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

    expect(await within(footer()).findByText("..\\.captionrules")).toHaveAttribute(
      "title",
      "C:\\datasets\\sample",
    );
    expect(screen.getByRole("button", { name: "Lint captions" })).toBeEnabled();
  });

  it("offers no way to edit the rules from the dialog", async () => {
    fetchFolderInstructions.mockResolvedValue(
      rulesResponse({ has_file: true, text: "trigger: x\n" }),
    );
    renderDialog();

    await within(footer()).findByText(".captionrules");

    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("cannot start without rules and names no file", async () => {
    fetchFolderInstructions.mockResolvedValue(rulesResponse());
    const { onConfirm } = renderDialog();

    expect(
      await screen.findByText(/No caption rules apply to this folder yet/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lint captions" })).toBeDisabled();
    expect(footer().querySelector(".instruction-file-source")).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reports a rule file that could not be loaded and cannot start", async () => {
    fetchFolderInstructions.mockRejectedValue(new Error("Failed to read the rule file"));
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to read the rule file");
    expect(screen.getByRole("button", { name: "Lint captions" })).toBeDisabled();
  });
});
