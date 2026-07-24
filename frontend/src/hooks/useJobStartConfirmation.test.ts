import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useJobStartConfirmation } from "./useJobStartConfirmation";

describe("useJobStartConfirmation", () => {
  it("starts strip metadata after confirmation", async () => {
    const startStripMetadata = vi.fn().mockResolvedValue({ id: "job-2" });
    const { result } = renderHook(() =>
      useJobStartConfirmation("C:\\Photos", [{ name: "Photos", path: "C:\\Photos" }], {
        strip_metadata: startStripMetadata,
      }),
    );

    act(() => {
      result.current.requestJobStart("strip_metadata");
    });

    expect(result.current.pendingJobStart).toBe("strip_metadata");

    await act(async () => {
      result.current.confirmPendingJobStart();
    });

    expect(startStripMetadata).toHaveBeenCalledWith("C:\\Photos", undefined);
    expect(result.current.pendingJobStart).toBeNull();
  });

  it("passes selected gallery paths to the job starter on confirmation", async () => {
    const selectedPaths = ["C:\\Photos\\one.png", "C:\\Photos\\two.png"];
    const getJobPaths = vi.fn(() => selectedPaths);
    const startStripMetadata = vi.fn().mockResolvedValue({ id: "job-1" });
    const { result } = renderHook(() =>
      useJobStartConfirmation(
        "C:\\Photos",
        [{ name: "Photos", path: "C:\\Photos" }],
        {
          strip_metadata: startStripMetadata,
        },
        getJobPaths,
      ),
    );

    act(() => {
      result.current.requestJobStart("strip_metadata");
    });

    await act(async () => {
      result.current.confirmPendingJobStart();
    });

    expect(getJobPaths).toHaveBeenCalled();
    expect(startStripMetadata).toHaveBeenCalledWith("C:\\Photos", selectedPaths);
    expect(result.current.pendingJobStart).toBeNull();
  });
});
