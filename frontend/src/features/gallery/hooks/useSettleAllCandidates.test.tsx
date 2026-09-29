import { StrictMode, type ReactNode } from "react";
import { act, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptCandidates, rejectCandidates } from "@/features/gallery/api/comfyCandidates";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import type { ComfyCandidateBatchResponse } from "@/shared/types";
import {
  useSettleAllCandidates,
  type UseSettleAllCandidatesOptions,
} from "./useSettleAllCandidates";

vi.mock("@/features/gallery/api/comfyCandidates", () => ({
  acceptCandidates: vi.fn(),
  rejectCandidates: vi.fn(),
}));

const acceptCandidatesMock = vi.mocked(acceptCandidates);
const rejectCandidatesMock = vi.mocked(rejectCandidates);

const LAKE = "C:\\Photos\\lake.png";
const RIDGE = "C:\\Photos\\ridge.png";
const FIELD = "C:\\Photos\\field.png";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <NotificationsProvider>{children}</NotificationsProvider>
    </StrictMode>
  );
}

function batchResult(
  overrides: Partial<ComfyCandidateBatchResponse> = {},
): ComfyCandidateBatchResponse {
  return { settled: [LAKE, RIDGE], skipped: [], failed: [], ...overrides };
}

type Props = Omit<UseSettleAllCandidatesOptions, "onSettled" | "folderLabel">;

function renderSettleAll(props: Partial<Props> = {}, onSettled = vi.fn()) {
  const initialProps: Props = {
    folderItemCount: 5,
    candidatePaths: [LAKE, RIDGE],
    selectedPaths: null,
    ...props,
  };
  return renderHook(
    (current: Props) => useSettleAllCandidates({ ...current, folderLabel: "Photos", onSettled }),
    { wrapper, initialProps },
  );
}

async function confirm(
  result: { current: ReturnType<typeof useSettleAllCandidates> },
  action: "accept" | "delete" = "accept",
) {
  act(() => result.current.openConfirm(action));
  await act(async () => {
    await result.current.overlay.onConfirm();
  });
}

describe("useSettleAllCandidates", () => {
  afterEach(() => {
    acceptCandidatesMock.mockReset();
    rejectCandidatesMock.mockReset();
  });

  describe("with nothing selected", () => {
    it("scopes the whole folder and says how many of its files are staged", () => {
      const { result } = renderSettleAll();

      act(() => result.current.openConfirm("accept"));

      expect(result.current.overlay.action).toBe("accept");
      expect(result.current.overlay.scope).toEqual({
        itemCount: 5,
        folderLabel: "Photos",
        fromSelection: false,
        note: "2 of them have a staged candidate.",
      });
    });

    it("accepts every candidate in the folder", async () => {
      acceptCandidatesMock.mockResolvedValue(batchResult());
      const { result } = renderSettleAll();

      await confirm(result);

      expect(acceptCandidatesMock).toHaveBeenCalledWith([LAKE, RIDGE]);
    });
  });

  describe("with files selected", () => {
    it("accepts only the selected files' candidates", async () => {
      acceptCandidatesMock.mockResolvedValue(batchResult({ settled: [RIDGE] }));
      const { result } = renderSettleAll({ selectedPaths: new Set([RIDGE, FIELD]) });

      expect(result.current.count).toBe(1);
      expect(result.current.fromSelection).toBe(true);

      await confirm(result);

      expect(acceptCandidatesMock).toHaveBeenCalledWith([RIDGE]);
    });

    it("scopes the selection, not the folder", () => {
      const { result } = renderSettleAll({ selectedPaths: new Set([RIDGE, FIELD]) });

      act(() => result.current.openConfirm("accept"));

      expect(result.current.overlay.scope).toEqual({
        itemCount: 2,
        folderLabel: "Photos",
        fromSelection: true,
        note: "1 of them has a staged candidate.",
      });
    });

    it("drops the note when every selected file has a candidate", () => {
      const { result } = renderSettleAll({ selectedPaths: new Set([LAKE, RIDGE]) });

      expect(result.current.overlay.scope.note).toBeUndefined();
    });

    it("does not open when no selected file has a candidate", () => {
      const { result } = renderSettleAll({ selectedPaths: new Set([FIELD]) });

      act(() => result.current.openConfirm("accept"));

      expect(result.current.count).toBe(0);
      expect(result.current.overlay.action).toBeNull();
    });
  });

  it("does not open when nothing is waiting", () => {
    const { result } = renderSettleAll({ candidatePaths: [] });

    act(() => result.current.openConfirm("accept"));

    expect(result.current.overlay.action).toBeNull();
  });

  it("closes on cancel without accepting anything", () => {
    const { result } = renderSettleAll();

    act(() => result.current.openConfirm("accept"));
    act(() => result.current.overlay.onCancel());

    expect(result.current.overlay.action).toBeNull();
    expect(acceptCandidatesMock).not.toHaveBeenCalled();
  });

  it("accepts what the dialog showed, not what changed while it was open", async () => {
    acceptCandidatesMock.mockResolvedValue(batchResult({ settled: [LAKE] }));
    const { result, rerender } = renderSettleAll({ candidatePaths: [LAKE] });

    act(() => result.current.openConfirm("accept"));
    rerender({ folderItemCount: 5, candidatePaths: [LAKE, RIDGE], selectedPaths: null });

    expect(result.current.overlay.scope.note).toBe("1 of them has a staged candidate.");

    await act(async () => {
      await result.current.overlay.onConfirm();
    });

    expect(acceptCandidatesMock).toHaveBeenCalledWith([LAKE]);
  });

  it("ignores cancel while the batch is in flight", async () => {
    let finish!: (value: ComfyCandidateBatchResponse) => void;
    acceptCandidatesMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderSettleAll();

    act(() => result.current.openConfirm("accept"));

    let confirmPromise!: Promise<void>;
    act(() => {
      confirmPromise = result.current.overlay.onConfirm();
    });

    expect(result.current.overlay.busy).toBe(true);

    act(() => result.current.overlay.onCancel());
    expect(result.current.overlay.action).toBe("accept");

    await act(async () => {
      finish(batchResult());
      await confirmPromise;
    });

    expect(result.current.overlay.action).toBeNull();
    expect(result.current.overlay.busy).toBe(false);
  });

  it("refreshes before notifying, so the toast and the grid agree", async () => {
    const order: string[] = [];
    acceptCandidatesMock.mockImplementation(async () => {
      order.push("api");
      return batchResult();
    });
    const onSettled = vi.fn(async () => {
      order.push("refreshed");
    });
    const { result } = renderSettleAll({}, onSettled);

    await confirm(result);

    expect(order).toEqual(["api", "refreshed"]);
    expect(screen.getByRole("status")).toHaveTextContent("Accepted 2 candidates.");
  });

  it("closes and notifies danger when the request fails", async () => {
    acceptCandidatesMock.mockRejectedValue(new Error("Permission denied"));
    const onSettled = vi.fn();
    const { result } = renderSettleAll({}, onSettled);

    await confirm(result);

    expect(onSettled).not.toHaveBeenCalled();
    expect(result.current.overlay.action).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
  });

  describe("deleting", () => {
    it("deletes the scoped candidates and never accepts them", async () => {
      rejectCandidatesMock.mockResolvedValue(batchResult({ settled: [RIDGE] }));
      const { result } = renderSettleAll({ selectedPaths: new Set([RIDGE, FIELD]) });

      await confirm(result, "delete");

      expect(rejectCandidatesMock).toHaveBeenCalledWith([RIDGE]);
      expect(acceptCandidatesMock).not.toHaveBeenCalled();
    });

    it("opens the delete confirmation with the same scope as accepting", () => {
      const { result } = renderSettleAll();

      act(() => result.current.openConfirm("delete"));

      expect(result.current.overlay.action).toBe("delete");
      expect(result.current.overlay.scope.note).toBe("2 of them have a staged candidate.");
    });

    it("refreshes, then reports what it deleted", async () => {
      rejectCandidatesMock.mockResolvedValue(batchResult());
      const onSettled = vi.fn();
      const { result } = renderSettleAll({}, onSettled);

      await confirm(result, "delete");

      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(result.current.overlay.action).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("Deleted 2 candidates.");
    });
  });
});
