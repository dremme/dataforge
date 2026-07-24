import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutomationDialogOverlays } from "./useAutomationDialogOverlays";

const baseDialogOverlayProps = {
  startingBatchRename: false,
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
        startingSetCaptions: false,
        startingBodyParts: false,
        startingAutoCaption: false,
        startingVerifyCaptions: false,
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
        startingSetCaptions: false,
        startingBodyParts: false,
        startingAutoCaption: false,
        startingVerifyCaptions: false,
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

  it("opens batch rename dialog and starts job with stem", async () => {
    const startBatchRenameJob = vi.fn().mockResolvedValue({ id: "job-6" });

    const { result } = renderHook(() =>
      useAutomationDialogOverlays({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        startingSetCaptions: false,
        startingBodyParts: false,
        startingAutoCaption: false,
        startingVerifyCaptions: false,
        startingBatchRename: false,
        itemCount: 5,
        startSetCaptionsJob: vi.fn(),
        startBodyPartsJob: vi.fn(),
        startAutoCaptionJob: vi.fn(),
        startVerifyCaptionsJob: vi.fn(),
        startBatchRenameJob,
      }),
    );

    act(() => {
      result.current.openBatchRenameDialog();
    });
    expect(result.current.dialogs.batchRename.open).toBe(true);

    await act(async () => {
      result.current.dialogs.batchRename.onConfirm("portugal");
    });

    expect(result.current.dialogs.batchRename.open).toBe(false);
    expect(startBatchRenameJob).toHaveBeenCalledWith("C:\\Photos", "portugal", undefined);
  });

  it("does not start jobs when folder path is missing", async () => {
    const startSetCaptionsJob = vi.fn().mockResolvedValue({ id: "job-1" });

    const { result } = renderHook(() =>
      useAutomationDialogOverlays({
        folderPath: undefined,
        folderLabel: "Photos",
        startingSetCaptions: false,
        startingBodyParts: false,
        startingAutoCaption: false,
        startingVerifyCaptions: false,
        ...baseDialogOverlayProps,
        startSetCaptionsJob,
        startBodyPartsJob: vi.fn(),
        startAutoCaptionJob: vi.fn(),
        startVerifyCaptionsJob: vi.fn(),
      }),
    );

    act(() => {
      result.current.openSetCaptionsDialog();
    });

    await act(async () => {
      result.current.dialogs.setCaptions.onConfirm("Caption", false);
    });

    expect(result.current.dialogs.setCaptions.open).toBe(true);
    expect(startSetCaptionsJob).not.toHaveBeenCalled();
  });
});
