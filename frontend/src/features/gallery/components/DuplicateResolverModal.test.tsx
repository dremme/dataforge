import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDuplicateGroup } from "@/features/gallery/api/duplicates";
import type { DuplicateGroup } from "@/shared/types";
import { HOME_PATH, mediaItem } from "@/test/fixtures";
import { DuplicateResolverModal } from "./DuplicateResolverModal";

vi.mock("@/features/gallery/api/duplicates", () => ({
  resolveDuplicateGroup: vi.fn(),
}));

const resolveGroup = vi.mocked(resolveDuplicateGroup);

function member(name: string, overrides = {}) {
  return mediaItem(name, HOME_PATH, {
    has_duplicate_file: true,
    duplicate_group: "g1",
    width: 512,
    height: 512,
    size: 1000,
    ...overrides,
  });
}

function group(overrides: Partial<DuplicateGroup> = {}): DuplicateGroup {
  return {
    group: "g1",
    max_distance: 0,
    threshold: "exact",
    members: [member("small.png"), member("large.png", { width: 2048, height: 2048, size: 9000 })],
    ...overrides,
  };
}

function renderModal(overrides: Partial<Parameters<typeof DuplicateResolverModal>[0]> = {}) {
  const props = {
    groups: [group()],
    index: 0,
    onClose: vi.fn(),
    onIndexChange: vi.fn(),
    // Windows-like by default: the Recycle Bin path, where deleting is one click.
    deletesToTrash: true,
    onResolved: vi.fn(),
    ...overrides,
  };
  render(<DuplicateResolverModal {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveGroup.mockResolvedValue({ kept: "large.png", deleted: ["small.png"], failed: [] });
});

describe("DuplicateResolverModal", () => {
  it("shows both members side by side with their metadata", () => {
    renderModal();

    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(2);

    const large = cards.find((card) => card.textContent?.includes("large.png"));
    expect(large).toBeDefined();
    expect(large).toHaveTextContent("2048 × 2048");
    expect(large).toHaveTextContent("4.2 MP");
    expect(large).toHaveTextContent("8.8 KB");
  });

  it("counts groups rather than files", () => {
    renderModal({ groups: [group(), group({ group: "g2" })], index: 1 });

    expect(screen.getByText("Group 2 / 2")).toBeInTheDocument();
  });

  it("describes how alike the group is in words", () => {
    renderModal();

    expect(screen.getByText("Identical")).toBeInTheDocument();
  });

  it("pre-selects the highest resolution and says why", () => {
    renderModal();

    const large = screen.getAllByRole("radio").find((c) => c.textContent?.includes("large.png"));
    expect(large).toHaveAttribute("aria-checked", "true");
    expect(within(large as HTMLElement).getByText("Highest resolution")).toBeInTheDocument();
  });

  it("lets a different member be kept instead", async () => {
    const user = userEvent.setup();
    renderModal();

    const small = screen.getAllByRole("radio").find((c) => c.textContent?.includes("small.png"));
    await user.click(small as HTMLElement);

    expect(small).toHaveAttribute("aria-checked", "true");
    // Picking by hand drops the suggestion label - it is no longer the default.
    expect(screen.queryByText("Highest resolution")).not.toBeInTheDocument();
  });

  it("names how many files the button will delete", () => {
    renderModal();

    expect(screen.getByRole("button", { name: "Keep this, delete 1 other" })).toBeInTheDocument();
  });

  it("deletes the others and advances", async () => {
    const user = userEvent.setup();
    const props = renderModal({ groups: [group(), group({ group: "g2" })], index: 0 });

    await user.click(screen.getByRole("button", { name: /Keep this, delete/ }));

    await waitFor(() => {
      expect(resolveGroup).toHaveBeenCalledWith(`${HOME_PATH}\\large.png`, [
        `${HOME_PATH}\\small.png`,
      ]);
    });
    expect(props.onResolved).toHaveBeenCalled();
    expect(props.onIndexChange).toHaveBeenCalledWith(1);
  });

  it("closes after the last group", async () => {
    const user = userEvent.setup();
    const props = renderModal();

    await user.click(screen.getByRole("button", { name: /Keep this, delete/ }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("reports a partial failure instead of moving on", async () => {
    const user = userEvent.setup();
    resolveGroup.mockResolvedValue({ kept: "large.png", deleted: [], failed: ["small.png"] });
    const props = renderModal();

    await user.click(screen.getByRole("button", { name: /Keep this, delete/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete small.png.");
    expect(props.onIndexChange).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("lays a group of three out as three cards", () => {
    renderModal({
      groups: [group({ members: [member("a.png"), member("b.png"), member("c.png")] })],
    });

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Keep this, delete 2 others" })).toBeInTheDocument();
  });

  it("deletes without a dialog where the Recycle Bin catches the files", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /Keep this, delete/ }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(resolveGroup).toHaveBeenCalled());
  });

  it("confirms first where a delete is permanent", async () => {
    const user = userEvent.setup();
    renderModal({ deletesToTrash: false });

    await user.click(screen.getByRole("button", { name: /Keep this, delete/ }));

    // Nothing is deleted until the dialog is answered.
    expect(resolveGroup).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete 1 file?");
    expect(dialog).toHaveTextContent("small.png");
    expect(dialog).toHaveTextContent("cannot be undone");

    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(resolveGroup).toHaveBeenCalled());
  });

  it("deletes nothing when the permanent-delete confirmation is cancelled", async () => {
    const user = userEvent.setup();
    renderModal({ deletesToTrash: false });

    await user.click(screen.getByRole("button", { name: /Keep this, delete/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(resolveGroup).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // Back to the comparison, with the group still intact.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("renders nothing when the index is past the queue", () => {
    const { container } = render(
      <DuplicateResolverModal
        groups={[group()]}
        index={5}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        deletesToTrash
        onResolved={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
