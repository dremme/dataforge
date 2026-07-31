import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useJobStartConfirmation } from "./useJobStartConfirmation";

const breadcrumbs = [{ name: "Photos", path: "C:\\Photos" }];

describe("useJobStartConfirmation", () => {
  it("starts strip metadata after confirmation", async () => {
    const startJob = vi.fn().mockResolvedValue({ id: "job-2" });
    const { result } = renderHook(() =>
      useJobStartConfirmation("C:\\Photos", breadcrumbs, startJob),
    );

    act(() => {
      result.current.requestJobStart("strip_metadata");
    });

    expect(result.current.pendingJobStart).toBe("strip_metadata");

    await act(async () => {
      result.current.confirmPendingJobStart();
    });

    expect(startJob).toHaveBeenCalledWith("strip_metadata", "C:\\Photos", undefined, undefined);
    expect(result.current.pendingJobStart).toBeNull();
  });

  it("passes selected gallery paths to the job starter on confirmation", async () => {
    const selectedPaths = ["C:\\Photos\\one.png", "C:\\Photos\\two.png"];
    const getJobPaths = vi.fn(() => selectedPaths);
    const startJob = vi.fn().mockResolvedValue({ id: "job-1" });
    const { result } = renderHook(() =>
      useJobStartConfirmation("C:\\Photos", breadcrumbs, startJob, getJobPaths),
    );

    act(() => {
      result.current.requestJobStart("strip_metadata");
    });

    await act(async () => {
      result.current.confirmPendingJobStart();
    });

    expect(getJobPaths).toHaveBeenCalled();
    expect(startJob).toHaveBeenCalledWith("strip_metadata", "C:\\Photos", undefined, selectedPaths);
    expect(result.current.pendingJobStart).toBeNull();
  });
});
