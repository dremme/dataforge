import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewCaptionEdits } from "@/features/automation/api/jobs";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";
import { EditCaptionsDialog } from "./EditCaptionsDialog";
import { renderWithQueryClient } from "@/test/queryClient";

vi.mock("@/features/automation/api/jobs", () => ({ previewCaptionEdits: vi.fn() }));

const DEFAULTS: JobSettingsByType["edit_captions"] =
  emptyAutomationSettings("C:/datasets/photos").edit_captions;

function renderDialog(
  overrides: Partial<JobSettingsByType["edit_captions"]> = {},
  onConfirm = vi.fn(),
  selectedPaths?: string[],
) {
  renderWithQueryClient(
    <EditCaptionsDialog
      scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      folderPath="C:/datasets/photos"
      selectedPaths={selectedPaths}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );

  return onConfirm;
}

function instructionField() {
  return screen.getByLabelText("Edit instruction");
}

function backupCheckbox() {
  return screen.getByLabelText("Back up captions first");
}

function confirm(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Start edit captions" }));
}

describe("EditCaptionsDialog", () => {
  beforeEach(() => {
    vi.mocked(previewCaptionEdits).mockReset();
  });

  it("only previews on request with the current selection and model settings", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionEdits).mockResolvedValue({
      samples: [
        { name: "one.png", before: "a dog", after: "a cat", error: null },
        { name: "two.png", before: "a lake", after: "a lake", error: null },
      ],
    });
    const paths = ["C:/datasets/photos/one.png", "C:/datasets/photos/two.png"];
    const onConfirm = renderDialog(
      {
        instruction: "  Replace dog with cat.  ",
        mode: "thinking",
        reasoning_effort: "low",
        preserve_thinking: false,
      },
      vi.fn(),
      paths,
    );
    expect(previewCaptionEdits).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Dry run" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("one.png"));
    expect(screen.getByText("dog").tagName).toBe("DEL");
    expect(screen.getByText("cat").tagName).toBe("INS");
    expect(screen.getByRole("status")).toHaveTextContent("Unchanged:");
    expect(previewCaptionEdits).toHaveBeenCalledWith(
      "C:/datasets/photos",
      {
        instruction: "Replace dog with cat.",
        mode: "thinking",
        reasoning_effort: "low",
        preserve_thinking: false,
        paths,
      },
      expect.any(AbortSignal),
    );
    expect(onConfirm).not.toHaveBeenCalled();

    await user.clear(instructionField());
    await user.type(instructionField(), "Drop colours.");
    expect(screen.queryByText("one.png")).not.toBeInTheDocument();
    expect(previewCaptionEdits).toHaveBeenCalledTimes(1);
  });

  it("blocks starting a job while previewing and clears results when model settings change", async () => {
    const user = userEvent.setup();
    let finish!: (value: Awaited<ReturnType<typeof previewCaptionEdits>>) => void;
    vi.mocked(previewCaptionEdits).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onConfirm = renderDialog({ instruction: "Drop colours." });
    await user.click(screen.getByRole("button", { name: "Dry run" }));
    expect(screen.getByRole("button", { name: "Start edit captions" })).toBeDisabled();
    expect(instructionField()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => {
      finish({ samples: [{ name: "one.png", before: "a red dog", after: "a dog", error: null }] });
    });
    expect(await screen.findByText("one.png")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Reasoning/ }));
    expect(screen.queryByText("one.png")).not.toBeInTheDocument();
  });

  it("shows request failures, per-caption errors, and empty previews with a retry action", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionEdits)
      .mockRejectedValueOnce(new Error("Model unavailable."))
      .mockResolvedValueOnce({
        samples: [
          {
            name: "one.png",
            before: "a dog",
            after: null,
            error: "The model returned too little text.",
          },
        ],
      })
      .mockResolvedValueOnce({ samples: [] });
    renderDialog({ instruction: "Drop colours." });
    const previewButton = () => screen.getByRole("button", { name: "Dry run" });
    await user.click(previewButton());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Model unavailable."));
    await user.click(previewButton());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("too little text"));
    await user.click(previewButton());
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No readable captions found in this scope.",
      ),
    );
  });

  it("refuses to preview a blank instruction", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Dry run" }));
    expect(previewCaptionEdits).not.toHaveBeenCalled();
    expect(instructionField()).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an instruction for the edit.");
  });

  it("uses Enter on the dry run button to preview without starting the job", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionEdits).mockResolvedValue({ samples: [] });
    const onConfirm = renderDialog({ instruction: "Drop colours." });
    const clock = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 1000);
    try {
      screen.getByRole("button", { name: "Dry run" }).focus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(previewCaptionEdits).toHaveBeenCalledTimes(1));
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("starts from the settings the last run used", () => {
    renderDialog({
      mode: "thinking",
      reasoning_effort: "xhigh",
      preserve_thinking: false,
      instruction: "Rewrite in present tense.",
    });

    expect(instructionField()).toHaveValue("Rewrite in present tense.");
    expect(screen.getByLabelText("Preserve thinking")).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Reasoning/ })).toBeChecked();
  });

  it("ticks the backup box however the last run was started", () => {
    // The dangerous state is the unticked one, so it is never restored.
    renderDialog({ instruction: "Rewrite in present tense." });

    expect(backupCheckbox()).toBeChecked();
  });

  it("submits the instruction, the model controls and the backup choice", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog({
      mode: "thinking",
      reasoning_effort: "low",
      preserve_thinking: true,
      instruction: "Rewrite in present tense.",
    });

    await user.click(backupCheckbox());
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith(
      "thinking",
      "Rewrite in present tense.",
      "low",
      true,
      false,
    );
  });

  it("trims the instruction before starting", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog({ instruction: "  Drop the colours.  " });

    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("instruct", "Drop the colours.", "medium", true, true);
  });

  it("refuses a blank instruction", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog({ instruction: "   " });

    await confirm(user);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an instruction for the edit.");
  });

  it("clears the error once the instruction is typed", async () => {
    const user = userEvent.setup();
    renderDialog({ instruction: "" });

    await confirm(user);
    expect(screen.queryByRole("alert")).not.toBeNull();

    await user.type(instructionField(), "Rewrite in present tense.");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the reasoning controls in instruct mode", () => {
    renderDialog({ mode: "instruct" });

    expect(screen.getByLabelText("Preserve thinking")).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Medium/ })).toBeDisabled();
  });

  it("confirms without writing preferences of its own", async () => {
    // Starting the job is what stores these, exactly as it is for every other dialog.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    const onConfirm = renderDialog({ instruction: "Rewrite in present tense." });

    await confirm(user);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("/api/preferences"))).toEqual(
      [],
    );
    fetchSpy.mockRestore();
  });
});
