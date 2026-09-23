import { StrictMode, type ReactNode } from "react";
import { act, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptCandidates } from "@/features/gallery/api/comfyCandidates";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import type { ComfyCandidateBatchResponse } from "@/shared/types";
import {
  useAcceptAllCandidates,
  type UseAcceptAllCandidatesOptions,
} from "./useAcceptAllCandidates";

vi.mock("@/features/gallery/api/comfyCandidates", () => ({
  acceptCandidates: vi.fn(),
}));

const acceptCandidatesMock = vi.mocked(acceptCandidates);

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

type Props = Omit<UseAcceptAllCandidatesOptions, "onAccepted" | "folderLabel">;

function renderAcceptAll(props: Partial<Props> = {}, onAccepted = vi.fn()) {
  const initialProps: Props = {
    folderItemCount: 5,
    candidatePaths: [LAKE, RIDGE],
    selectedPaths: null,
    ...props,
  };
  return renderHook(
    (current: Props) => useAcceptAllCandidates({ ...current, folderLabel: "Photos", onAccepted }),
    { wrapper, initialProps },
  );
}

async function confirm(result: { current: ReturnType<typeof useAcceptAllCandidates> }) {
  act(() => result.current.openConfirm());
  await act(async () => {
    await result.current.overlay.onConfirm();
  });
}

describe("useAcceptAllCandidates", () => {
  afterEach(() => {
    acceptCandidatesMock.mockReset();
  });

  describe("with nothing selected", () => {
    it("scopes the whole folder and says how many of its files are staged", () => {
      const { result } = renderAcceptAll();

      act(() => result.current.openConfirm());

      expect(result.current.overlay.open).toBe(true);
      expect(result.current.overlay.scope).toEqual({
        itemCount: 5,
        folderLabel: "Photos",
        fromSelection: false,
        note: "2 of them have a staged candidate.",
      });
    });

    it("accepts every candidate in the folder", async () => {
      acceptCandidatesMock.mockResolvedValue(batchResult());
      const { result } = renderAcceptAll();

      await confirm(result);

      expect(acceptCandidatesMock).toHaveBeenCalledWith([LAKE, RIDGE]);
    });
  });

  describe("with files selected", () => {
    it("accepts only the selected files' candidates", async () => {
      acceptCandidatesMock.mockResolvedValue(batchResult({ settled: [RIDGE] }));
      const { result } = renderAcceptAll({ selectedPaths: new Set([RIDGE, FIELD]) });

      expect(result.current.count).toBe(1);
      expect(result.current.fromSelection).toBe(true);

      await confirm(result);

      expect(acceptCandidatesMock).toHaveBeenCalledWith([RIDGE]);
    });

    it("scopes the selection, not the folder", () => {
      const { result } = renderAcceptAll({ selectedPaths: new Set([RIDGE, FIELD]) });

      act(() => result.current.openConfirm());

      expect(result.current.overlay.scope).toEqual({
        itemCount: 2,
        folderLabel: "Photos",
        fromSelection: true,
        note: "1 of them has a staged candidate.",
      });
    });

    it("drops the note when every selected file has a candidate", () => {
      const { result } = renderAcceptAll({ selectedPaths: new Set([LAKE, RIDGE]) });

      expect(result.current.overlay.scope.note).toBeUndefined();
    });

    it("does not open when no selected file has a candidate", () => {
      const { result } = renderAcceptAll({ selectedPaths: new Set([FIELD]) });

      act(() => result.current.openConfirm());

      expect(result.current.count).toBe(0);
      expect(result.current.overlay.open).toBe(false);
    });
  });

  it("does not open when nothing is waiting", () => {
    const { result } = renderAcceptAll({ candidatePaths: [] });

    act(() => result.current.openConfirm());

    expect(result.current.overlay.open).toBe(false);
  });

  it("closes on cancel without accepting anything", () => {
    const { result } = renderAcceptAll();

    act(() => result.current.openConfirm());
    act(() => result.current.overlay.onCancel());

    expect(result.current.overlay.open).toBe(false);
    expect(acceptCandidatesMock).not.toHaveBeenCalled();
  });

  it("accepts what the dialog showed, not what changed while it was open", async () => {
    acceptCandidatesMock.mockResolvedValue(batchResult({ settled: [LAKE] }));
    const { result, rerender } = renderAcceptAll({ candidatePaths: [LAKE] });

    act(() => result.current.openConfirm());
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
    const { result } = renderAcceptAll();

    act(() => result.current.openConfirm());

    let confirmPromise!: Promise<void>;
    act(() => {
      confirmPromise = result.current.overlay.onConfirm();
    });

    expect(result.current.overlay.busy).toBe(true);

    act(() => result.current.overlay.onCancel());
    expect(result.current.overlay.open).toBe(true);

    await act(async () => {
      finish(batchResult());
      await confirmPromise;
    });

    expect(result.current.overlay.open).toBe(false);
    expect(result.current.overlay.busy).toBe(false);
  });

  it("refreshes before notifying, so the toast and the grid agree", async () => {
    const order: string[] = [];
    acceptCandidatesMock.mockImplementation(async () => {
      order.push("api");
      return batchResult();
    });
    const onAccepted = vi.fn(async () => {
      order.push("refreshed");
    });
    const { result } = renderAcceptAll({}, onAccepted);

    await confirm(result);

    expect(order).toEqual(["api", "refreshed"]);
    expect(screen.getByRole("status")).toHaveTextContent("Accepted 2 candidates.");
  });

  it("closes and notifies danger when the request fails", async () => {
    acceptCandidatesMock.mockRejectedValue(new Error("Permission denied"));
    const onAccepted = vi.fn();
    const { result } = renderAcceptAll({}, onAccepted);

    await confirm(result);

    expect(onAccepted).not.toHaveBeenCalled();
    expect(result.current.overlay.open).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
  });
});
