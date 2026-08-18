import { StrictMode, type ReactNode } from "react";
import { act, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteSidecars } from "@/features/gallery/api/sidecars";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import type { SidecarDeleteResponse } from "@/shared/types";
import { useSidecarSweep } from "./useSidecarSweep";

vi.mock("@/features/gallery/api/sidecars", () => ({
  deleteSidecars: vi.fn(),
}));

const deleteSidecarsMock = vi.mocked(deleteSidecars);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <NotificationsProvider>{children}</NotificationsProvider>
    </StrictMode>
  );
}

function sweepResult(overrides: Partial<SidecarDeleteResponse> = {}): SidecarDeleteResponse {
  return {
    folder: "C:\\Photos",
    kind: "issue",
    deleted: ["sunset.issue.json"],
    failed: [],
    deletes_to_trash: true,
    ...overrides,
  };
}

function renderSweep(onSwept = vi.fn()) {
  return renderHook(
    () =>
      useSidecarSweep({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        issueCount: 2,
        duplicateCount: 1,
        onSwept,
      }),
    { wrapper },
  );
}

describe("useSidecarSweep", () => {
  afterEach(() => {
    deleteSidecarsMock.mockReset();
  });

  it("opens a pending sweep of the requested kind", () => {
    const { result } = renderSweep();

    act(() => result.current.openSweep("issue"));

    expect(result.current.overlay.pending).toBe("issue");
    expect(result.current.overlay.count).toBe(2);
    expect(result.current.overlay.folderLabel).toBe("Photos");
  });

  it("does not open a sweep when the count is zero", () => {
    const { result } = renderHook(
      () =>
        useSidecarSweep({
          folderPath: "C:\\Photos",
          folderLabel: "Photos",
          issueCount: 0,
          duplicateCount: 0,
          onSwept: vi.fn(),
        }),
      { wrapper },
    );

    act(() => result.current.openSweep("issue"));

    expect(result.current.overlay.pending).toBeNull();
  });

  it("does not open a sweep without a folder to sweep", () => {
    const { result } = renderHook(
      () =>
        useSidecarSweep({
          folderPath: undefined,
          folderLabel: "this folder",
          issueCount: 2,
          duplicateCount: 1,
          onSwept: vi.fn(),
        }),
      { wrapper },
    );

    act(() => result.current.openSweep("issue"));

    expect(result.current.overlay.pending).toBeNull();
  });

  it("counts each kind separately", () => {
    const { result } = renderSweep();

    expect(result.current.counts).toEqual({ issue: 2, duplicate: 1 });

    act(() => result.current.openSweep("duplicate"));
    expect(result.current.overlay.count).toBe(1);
  });

  it("clears the pending sweep on cancel", () => {
    const { result } = renderSweep();

    act(() => result.current.openSweep("duplicate"));
    act(() => result.current.overlay.onCancel());

    expect(result.current.overlay.pending).toBeNull();
  });

  it("ignores cancel while a sweep is in flight", async () => {
    let finish!: (value: SidecarDeleteResponse) => void;
    deleteSidecarsMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const { result } = renderSweep();

    act(() => result.current.openSweep("issue"));

    let confirmPromise!: Promise<void>;
    act(() => {
      confirmPromise = result.current.overlay.onConfirm();
    });

    expect(result.current.overlay.busy).toBe(true);
    expect(result.current.overlay.pending).toBe("issue");

    act(() => result.current.overlay.onCancel());
    expect(result.current.overlay.pending).toBe("issue");

    await act(async () => {
      finish(sweepResult());
      await confirmPromise;
    });

    expect(result.current.overlay.pending).toBeNull();
    expect(result.current.overlay.busy).toBe(false);
  });

  it("confirms with the pending kind, then refreshes, then notifies", async () => {
    const order: string[] = [];
    deleteSidecarsMock.mockImplementation(async () => {
      order.push("api");
      return sweepResult();
    });
    const onSwept = vi.fn(async () => {
      order.push("swept");
    });

    const { result } = renderSweep(onSwept);

    act(() => result.current.openSweep("issue"));
    await act(async () => {
      await result.current.overlay.onConfirm();
    });

    expect(deleteSidecarsMock).toHaveBeenCalledWith("C:\\Photos", "issue");
    expect(onSwept).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["api", "swept"]);
    expect(result.current.overlay.pending).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved 1 caption issue file to the Recycle Bin.",
    );
  });

  it("closes the dialog and notifies danger when the request fails", async () => {
    deleteSidecarsMock.mockRejectedValue(new Error("Permission denied"));
    const onSwept = vi.fn();
    const { result } = renderSweep(onSwept);

    act(() => result.current.openSweep("duplicate"));
    await act(async () => {
      await result.current.overlay.onConfirm();
    });

    expect(onSwept).not.toHaveBeenCalled();
    expect(result.current.overlay.pending).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
  });
});
