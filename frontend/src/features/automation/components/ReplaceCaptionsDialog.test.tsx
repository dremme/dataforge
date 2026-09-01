import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewCaptionReplacements } from "@/features/automation/api/jobs";
import { ReplaceCaptionsDialog } from "./ReplaceCaptionsDialog";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";

const DEFAULTS: JobSettingsByType["replace_captions"] =
  emptyAutomationSettings("C:/datasets/photos").replace_captions;

vi.mock("@/features/automation/api/jobs", () => ({
  previewCaptionReplacements: vi.fn(),
}));

const preview = vi.mocked(previewCaptionReplacements);

function renderDialog(
  onConfirm = vi.fn(),
  overrides: Partial<JobSettingsByType["replace_captions"]> = {},
) {
  render(
    <ReplaceCaptionsDialog
      scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      folderPath="C:/datasets/photos"
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return onConfirm;
}

describe("ReplaceCaptionsDialog", () => {
  beforeEach(() => {
    preview.mockResolvedValue({ folder: "C:/datasets/photos", total: 0, matched: 0, samples: [] });
  });

  it("focuses the search field on open", () => {
    renderDialog();

    expect(screen.getByLabelText("Search for")).toHaveFocus();
  });

  it("submits the edit", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Search for"), "dog");
    await user.type(screen.getByLabelText("Replace with"), "cat");
    await user.click(screen.getByRole("checkbox", { name: "Match case" }));
    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "replace",
      search: "dog",
      replacement: "cat",
      useRegex: false,
      caseSensitive: true,
    });
  });

  it("refuses to submit without a search term", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the text to search for.");
  });

  it("asks for the added text instead of a search term in append mode", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("radio", { name: /Append/ }));

    // The search term is unusable in append mode, and says so rather than vanishing.
    expect(screen.getByLabelText("Search for")).toBeDisabled();

    await user.type(screen.getByLabelText("Text to add"), ", high quality");
    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "append",
      search: "",
      replacement: ", high quality",
      useRegex: false,
      caseSensitive: false,
    });
  });

  it("shows how many captions would change", async () => {
    const user = userEvent.setup();
    preview.mockResolvedValue({
      folder: "C:/datasets/photos",
      total: 10,
      matched: 3,
      samples: [{ name: "one.png", before: "a dog", after: "a cat" }],
    });
    renderDialog();

    await user.type(screen.getByLabelText("Search for"), "dog");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("3 of 10 captions would change.");
    });
    // The sample shows only what the edit touches, not the caption twice over.
    expect(screen.getByText("dog")).toBeInTheDocument();
    expect(screen.getByText("cat")).toBeInTheDocument();
    // 3 matched, 1 sampled.
    expect(screen.getByText("and 2 more")).toBeInTheDocument();
  });

  it("explains dollar capture groups once regex is on", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.queryByText(/capture groups/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Regular expression" }));

    const hint = screen.getByText(/capture groups/);
    expect(hint).toHaveTextContent("$1");
    expect(hint).toHaveTextContent("$2");
    expect(hint).toHaveTextContent("$0");
  });

  it("blocks submitting an edit the backend rejected", async () => {
    const user = userEvent.setup();
    preview.mockResolvedValue({
      folder: "C:/datasets/photos",
      total: 10,
      matched: 0,
      samples: [],
      error: "Invalid regular expression: missing ), unterminated subpattern",
    });
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("checkbox", { name: "Regular expression" }));
    await user.type(screen.getByLabelText("Search for"), "(unclosed");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Invalid regular expression");
    });

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
