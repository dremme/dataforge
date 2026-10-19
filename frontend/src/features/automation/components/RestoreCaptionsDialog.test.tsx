import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewCaptionRestore } from "@/features/automation/api/jobs";
import { renderWithQueryClient } from "@/test/queryClient";
import type { CaptionBackupCompareSample, RestoreCaptionsPreviewResponse } from "@/shared/types";
import { RestoreCaptionsDialog } from "./RestoreCaptionsDialog";

vi.mock("@/features/automation/api/jobs", () => ({
  previewCaptionRestore: vi.fn<typeof previewCaptionRestore>(),
}));

const FOLDER = "C:/datasets/photos";

function sample(
  name: string,
  current: string | null,
  backup: string,
  error: string | null = null,
): CaptionBackupCompareSample {
  return { name, path: `${FOLDER}/${name}`, version: "1-1", current, backup, error };
}

function previewOf(
  samples: CaptionBackupCompareSample[],
  extra: Partial<RestoreCaptionsPreviewResponse> = {},
): RestoreCaptionsPreviewResponse {
  const missing = samples.filter((entry) => entry.current === null && !entry.error).length;
  return {
    total: samples.length,
    changed: samples.length - missing,
    missing,
    unchanged: 0,
    orphaned: 0,
    samples,
    ...extra,
  };
}

const MIXED = previewOf(
  [
    sample("dog.png", "a blue dog", "a red dog"),
    sample("lake.png", null, "a calm lake"),
    sample("tree.png", null, "an oak tree", "Could not read the current caption"),
  ],
  { total: 6, unchanged: 2, orphaned: 1 },
);

function renderDialog(selectedPaths?: string[]) {
  const onConfirm = vi.fn<() => void>();
  const onCancel = vi.fn<() => void>();
  renderWithQueryClient(
    <RestoreCaptionsDialog
      scope={{ itemCount: 4, folderLabel: "Photos", kind: "folder" as const }}
      folderPath={FOLDER}
      selectedPaths={selectedPaths}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

function pressEnter(target: Element) {
  // Past the grace period that ignores the Enter which opened the dialog.
  const clock = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 1000);
  try {
    fireEvent.keyDown(target, { key: "Enter" });
  } finally {
    clock.mockRestore();
  }
}

function rows() {
  return within(screen.getByRole("list", { name: "Captions that differ from the backup" }))
    .getAllByRole("listitem")
    .map((row) => row.getAttribute("aria-label"));
}

describe("RestoreCaptionsDialog", () => {
  beforeEach(() => {
    vi.mocked(previewCaptionRestore).mockReset();
    localStorage.clear();
  });

  it("reviews every differing caption for the files in scope", async () => {
    vi.mocked(previewCaptionRestore).mockResolvedValue(MIXED);
    renderDialog([`${FOLDER}/dog.png`]);

    const dog = await screen.findByRole("listitem", { name: "dog.png" });
    expect(previewCaptionRestore).toHaveBeenCalledWith(
      FOLDER,
      [`${FOLDER}/dog.png`],
      expect.any(AbortSignal),
    );
    expect(dog.querySelector("del")).toHaveTextContent("blue");
    expect(dog.querySelector("ins")).toHaveTextContent("red");
    expect(within(dog).getByTitle("1 word removed, 1 word restored")).toHaveTextContent("−1+1");
    expect(dog.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent(`${FOLDER}/dog.png`)),
    );

    const lake = screen.getByRole("listitem", { name: "lake.png" });
    expect(within(lake).getByText("New caption")).toBeInTheDocument();
    expect(lake.querySelector("del")).toBeNull();

    const tree = screen.getByRole("listitem", { name: "tree.png" });
    expect(within(tree).getByText("Unreadable")).toBeInTheDocument();
    expect(tree).toHaveTextContent("Could not read the current caption");

    expect(
      screen.getByText("2 captions already match · 1 backup has no media and will be skipped."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore 3 captions" })).toBeEnabled();
  });

  it("narrows the list by kind and by text, and says when nothing matches", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionRestore).mockResolvedValue(MIXED);
    renderDialog();
    await screen.findByRole("listitem", { name: "dog.png" });

    const show = screen.getByRole("radiogroup", { name: "Show" });
    expect(
      within(show)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["All3", "Changed1", "New1", "Unreadable1"]);

    await user.click(within(show).getByRole("radio", { name: /New/ }));
    expect(rows()).toEqual(["lake.png"]);
    expect(screen.getByText(/Showing 1 of 3/)).toBeInTheDocument();

    await user.click(within(show).getByRole("radio", { name: /All/ }));
    await user.type(screen.getByRole("searchbox", { name: /Filter by file name/ }), "OAK");
    expect(rows()).toEqual(["tree.png"]);

    await user.type(screen.getByRole("searchbox"), "s");
    expect(screen.getByText(/No differing caption matches/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rows()).toEqual(["dog.png", "lake.png", "tree.png"]);
  });

  it("keeps Enter and Escape in the search box from confirming or closing", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionRestore).mockResolvedValue(MIXED);
    const { onConfirm, onCancel } = renderDialog();
    const search = await screen.findByRole("searchbox");

    await user.type(search, "dog");
    pressEnter(search);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("switches to a side-by-side diff and remembers the choice", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionRestore).mockResolvedValue(
      previewOf([sample("dog.png", "a blue dog", "a red dog")]),
    );
    renderDialog();
    const row = await screen.findByRole("listitem", { name: "dog.png" });
    expect(row.querySelectorAll("p.caption-diff")).toHaveLength(1);
    expect(screen.getByText(/only in the current caption/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Side by side" }));

    const [current, restored] = screen
      .getByRole("listitem", { name: "dog.png" })
      .querySelectorAll("p.caption-diff");
    expect(current).toHaveTextContent("a blue dog");
    expect(current.querySelector("ins")).toBeNull();
    expect(restored).toHaveTextContent("a red dog");
    expect(restored.querySelector("del")).toBeNull();
    expect(screen.getByText("After restore")).toBeInTheDocument();
    expect(localStorage.getItem("restore-captions-diff-layout")).toBe("split");
  });

  it("fills both sides of the side-by-side view for new and unreadable captions", async () => {
    const user = userEvent.setup();
    localStorage.setItem("restore-captions-diff-layout", "split");
    vi.mocked(previewCaptionRestore).mockResolvedValue(MIXED);
    renderDialog();

    const lake = await screen.findByRole("listitem", { name: "lake.png" });
    const [before, after] = lake.querySelectorAll("p.caption-diff");
    expect(before).toHaveTextContent("No caption");
    // A side with nothing in common is left unmarked; its panel already says what it is.
    expect(after).toHaveTextContent("a calm lake");
    expect(after.querySelector("ins")).toBeNull();

    const [unreadable, restored] = screen
      .getByRole("listitem", { name: "tree.png" })
      .querySelectorAll("p.caption-diff");
    expect(unreadable).toHaveTextContent("Could not read the current caption.");
    expect(restored).toHaveTextContent("an oak tree");

    expect(screen.getByText("Current caption")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Inline" }));
    expect(screen.queryByText("Current caption")).toBeNull();
  });

  it("refuses to start a restore that would change nothing, by button or Enter", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionRestore).mockResolvedValue(previewOf([], { total: 2, unchanged: 2 }));
    const { onConfirm } = renderDialog();

    expect(await screen.findByText("Every caption matches the backup")).toBeInTheDocument();
    expect(screen.getByText("2 captions already match.")).toBeInTheDocument();
    const restore = screen.getByRole("button", { name: "Restore captions" });
    expect(restore).toBeDisabled();

    await user.click(restore);
    pressEnter(screen.getByRole("alertdialog"));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("starts the restore on Enter once something would change", async () => {
    vi.mocked(previewCaptionRestore).mockResolvedValue(
      previewOf([sample("dog.png", "a cat", "a dog")]),
    );
    const { onConfirm } = renderDialog();
    await screen.findByRole("button", { name: "Restore 1 caption" });

    pressEnter(screen.getByRole("alertdialog"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state, then still allows a restore after the comparison fails", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionRestore)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(previewOf([sample("dog.png", "a cat", "a dog")]));
    const { onConfirm } = renderDialog();

    expect(
      screen.getByRole("status", { name: "Comparing with the backup..." }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Could not compare with the backup")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore captions" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("listitem", { name: "dog.png" })).toBeInTheDocument();
  });

  it("closes on Cancel without asking to discard anything", async () => {
    const user = userEvent.setup();
    vi.mocked(previewCaptionRestore).mockResolvedValue(MIXED);
    const { onCancel } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog", { name: "Discard changes?" })).toBeNull();
  });
});
