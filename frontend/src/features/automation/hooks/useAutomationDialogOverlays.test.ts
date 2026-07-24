import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutomationDialogOverlays } from "./useAutomationDialogOverlays";

const baseDialogOverlayProps = {
  startingJobType: null as null,
  itemCount: 3,
  startBatchRenameJob: vi.fn(),
};

describe("useAutomationDialogOverlays", () => {
  it("opens dialogs and starts jobs after confirm", async () => {
    const startSetCaptionsJob = vi.fn().mockResolvedValue({ id: "job-1" });
    const startBodyPartsJob = vi.fn().mockResolvedValue({ id: "job-2" });
    const startAutoCaptionJob = vi.fn().mockResolvedValue({ id: "job-3" });
    const startVerifyCaptionsJob = vi.fn().mockResolvedValue({ id: "job-4" });

    const { result } = renderHook(() =>
      useAutomationDialogOverlays({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        ...baseDialogOverlayProps,
        startSetCaptionsJob,
        startBodyPartsJob,
        startAutoCaptionJob,
        startVerifyCaptionsJob,
      }),
    );

    act(() => {
      result.current.openSetCaptionsDialog();
    });
    expect(result.current.dialogs.setCaptions.open).toBe(true);

    await act(async () => {
      result.current.dialogs.setCaptions.onConfirm("A sunny day", true);
    });

    expect(result.current.dialogs.setCaptions.open).toBe(false);
    expect(startSetCaptionsJob).toHaveBeenCalledWith("C:\\Photos", "A sunny day", true, undefined);
  });

  it("opens verify captions dialog and starts job with mode and context", async () => {
    const startVerifyCaptionsJob = vi.fn().mockResolvedValue({ id: "job-5" });

    const { result } = renderHook(() =>
      useAutomationDialogOverlays({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        ...baseDialogOverlayProps,
        startSetCaptionsJob: vi.fn(),
        startBodyPartsJob: vi.fn(),
        startAutoCaptionJob: vi.fn(),
        startVerifyCaptionsJob,
      }),
    );

    act(() => {
      result.current.openVerifyCaptionsDialog();
    });
    expect(result.current.dialogs.verifyCaptions.open).toBe(true);

    await act(async () => {
      result.current.dialogs.verifyCaptions.onConfirm("thinking", "Outdoor portraits.");
    });

    expect(result.current.dialogs.verifyCaptions.open).toBe(false);
    expect(startVerifyCaptionsJob).toHaveBeenCalledWith(
      "C:\\Photos",
      "thinking",
      "Outdoor portraits.",
      undefined,
    );
  });

  it("opens dialog by job type via openDialogForJobType", () => {
    const { result } = renderHook(() =>
      useAutomationDialogOverlays({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        ...baseDialogOverlayProps,
        startSetCaptionsJob: vi.fn(),
        startBodyPartsJob: vi.fn(),
        startAutoCaptionJob: vi.fn(),
        startVerifyCaptionsJob: vi.fn(),
      }),
    );

    act(() => {
      result.current.openDialogForJobType("batch_rename");
    });
    expect(result.current.dialogs.batchRename.open).toBe(true);
  });

  it("marks dialog busy from startingJobType", () => {
    const { result } = renderHook(() =>
      useAutomationDialogOverlays({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        startingJobType: "set_captions",
        itemCount: 1,
        startBatchRenameJob: vi.fn(),
        startSetCaptionsJob: vi.fn(),
        startBodyPartsJob: vi.fn(),
        startAutoCaptionJob: vi.fn(),
        startVerifyCaptionsJob: vi.fn(),
      }),
    );

    expect(result.current.dialogs.setCaptions.busy).toBe(true);
    expect(result.current.dialogs.bodyParts.busy).toBe(false);
  });
});
