import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FolderInstructionsApi from "@/shared/api/folderInstructions";
import type { FolderInstructionsResponse, InstructionFileResponse } from "@/shared/types";
import { AutoCaptionDialog } from "./AutoCaptionDialog";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";

const FOLDER = "C:/datasets/photos";

const DEFAULTS: JobSettingsByType["auto_caption"] = emptyAutomationSettings(FOLDER).auto_caption;

const fetchFolderInstructions = vi.fn();

vi.mock("@/shared/api/folderInstructions", async (importOriginal) => ({
  ...(await importOriginal<typeof FolderInstructionsApi>()),
  fetchFolderInstructions: (...args: unknown[]) => fetchFolderInstructions(...args),
}));

const NO_FILE: InstructionFileResponse = {
  text: "",
  has_file: false,
  parent_folder: null,
  parent_relative_path: null,
  parent_text: "",
};

function instructionsResponse(
  sysprompt: Partial<InstructionFileResponse>,
): FolderInstructionsResponse {
  return {
    sysprompt: { ...NO_FILE, ...sysprompt },
    caption_rules: NO_FILE,
    caption_rules_template: "",
  };
}

beforeEach(() => {
  fetchFolderInstructions.mockReset();
  fetchFolderInstructions.mockResolvedValue(
    instructionsResponse({ has_file: true, text: "Describe the scene." }),
  );
});

function renderDialog(
  busy = false,
  onConfirm = vi.fn(),
  overrides: Partial<JobSettingsByType["auto_caption"]> = {},
) {
  render(
    <AutoCaptionDialog
      scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
      folderPath={FOLDER}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );

  return onConfirm;
}

function audioCheckbox() {
  return screen.getByRole("checkbox", { name: "Caption audio" });
}

function preserveThinkingCheckbox() {
  return screen.getByRole("checkbox", { name: "Preserve thinking" });
}

function footer() {
  return screen.getByRole("alertdialog").querySelector("footer") as HTMLElement;
}

function confirm(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Start auto-caption" }));
}

describe("AutoCaptionDialog", () => {
  it("starts in reasoning mode with audio off", () => {
    renderDialog();

    expect(screen.getByRole("radio", { name: /Reasoning/ })).toBeChecked();
    expect(audioCheckbox()).not.toBeChecked();
  });

  it("starts at medium effort with thinking preserved", () => {
    renderDialog();

    expect(screen.getByRole("radio", { name: /Medium/ })).toBeChecked();
    expect(preserveThinkingCheckbox()).toBeChecked();
  });

  it("submits the mode and leaves audio off by default", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("thinking", false, "medium", true);
  });

  it("submits the audio choice once it is checked", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(audioCheckbox());
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("thinking", true, "medium", true);
  });

  it("submits the reasoning choices once they are changed", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("radio", { name: /Extra high/ }));
    await user.click(preserveThinkingCheckbox());
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("thinking", false, "xhigh", false);
  });

  it("disables the reasoning controls in instruct mode", async () => {
    // Instruct turns reasoning off, so the backend sends neither value there. The
    // controls stay visible to say so rather than vanishing.
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("radio", { name: /Instruct/ }));

    expect(screen.getByRole("radio", { name: /Medium/ })).toBeDisabled();
    expect(preserveThinkingCheckbox()).toBeDisabled();
  });

  it("carries the audio choice alongside instruct mode", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("radio", { name: /Instruct/ }));
    await user.click(audioCheckbox());
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("instruct", true, "medium", true);
  });

  it("disables its controls while the job is starting", () => {
    renderDialog(true);

    expect(audioCheckbox()).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Reasoning/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
  });
});

describe("AutoCaptionDialog saved settings", () => {
  it("starts from the settings the last run used", () => {
    renderDialog(false, vi.fn(), {
      mode: "instruct",
      caption_audio: true,
      preserve_thinking: false,
    });

    expect(audioCheckbox()).toBeChecked();
    expect(screen.getByRole("radio", { name: /Instruct/ })).toBeChecked();
  });
});

describe("AutoCaptionDialog system prompt source", () => {
  it("names the folder's own system prompt at the bottom", async () => {
    renderDialog();

    expect(await within(footer()).findByText(".sysprompt")).toBeInTheDocument();
    expect(footer().querySelector(".instruction-file-source")).toHaveTextContent("Uses .sysprompt");
    expect(fetchFolderInstructions).toHaveBeenCalledWith(FOLDER, expect.anything());
  });

  it("names the parent folder an inherited system prompt lives in", async () => {
    fetchFolderInstructions.mockResolvedValue(
      instructionsResponse({
        parent_folder: "C:/datasets",
        parent_relative_path: "../.sysprompt",
        parent_text: "Describe the scene.",
      }),
    );
    renderDialog();

    expect(await within(footer()).findByText("../.sysprompt")).toHaveAttribute(
      "title",
      "C:/datasets",
    );
  });

  it("offers no way to edit the system prompt from the dialog", async () => {
    renderDialog();

    await within(footer()).findByText(".sysprompt");

    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("still starts when the system prompt cannot be read", async () => {
    const user = userEvent.setup();
    fetchFolderInstructions.mockRejectedValue(new Error("Failed to read the file"));
    const onConfirm = renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to read the file");
    expect(footer().querySelector(".instruction-file-source")).toBeNull();
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
