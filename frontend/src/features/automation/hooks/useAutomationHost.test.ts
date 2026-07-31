import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { useAutomationHost } from "./useAutomationHost";

vi.mock("@/features/automation/preferences/bodyPartsPreferences", () => ({
  loadBodyPartsSettings: vi.fn(async () => ({
    bodyDescription: "body",
    faceDescription: "face",
    keywords: "hat",
    elementDescription: "part",
  })),
}));

vi.mock("@/features/automation/preferences/verifyCaptionsPreferences", () => ({
  loadVerifyCaptionsSettings: vi.fn(async (folderPath: string) => ({
    mode: "instruct" as const,
    context: "",
    folderPath,
  })),
}));

function setupHost(options: { hasCaptionBackup?: boolean; ostrisAvailable?: boolean } = {}) {
  const startBackupCaptionsJob = vi.fn().mockResolvedValue({ id: "job-backup" });
  const startRestoreCaptionsJob = vi.fn().mockResolvedValue({ id: "job-restore" });

  const automation = {
    folderJob: null,
    folderHasActiveJob: false,
    startingJobType: null,
    isStarting: false,
    isStartingType: vi.fn(() => false),
    cancellingJob: false,
    cancelFolderJob: vi.fn(),
    startBodyPartsJob: vi.fn(),
    startStripMetadataJob: vi.fn(),
    startSetCaptionsJob: vi.fn(),
    startAutoCaptionJob: vi.fn(),
    startVerifyCaptionsJob: vi.fn(),
    startBatchRenameJob: vi.fn(),
    startBackupCaptionsJob,
    startRestoreCaptionsJob,
    startTrainLoraJob: vi.fn(),
  };

  const { result } = renderHook(() =>
    useAutomationHost({
      folder: "C:\\Photos",
      breadcrumbs: [{ name: "Photos", path: "C:\\Photos" }],
      items: [] as GalleryItem[],
      filteredItems: [] as GalleryItem[],
      sysprompt: null,
      hasCaptionBackup: options.hasCaptionBackup ?? true,
      ostrisAvailable: options.ostrisAvailable ?? false,
      getJobPaths: () => undefined,
      // The hook only reads the fields asserted here.
      automation: automation as never,
      onEditSysprompt: vi.fn(),
      issueCount: 0,
    }),
  );

  return { result, startBackupCaptionsJob, startRestoreCaptionsJob };
}

describe("useAutomationHost", () => {
  it("starts a caption backup straight away, with no confirmation", async () => {
    const { result, startBackupCaptionsJob } = setupHost();

    await act(async () => {
      result.current.panelProps.onRequestStart("backup_captions");
    });

    expect(startBackupCaptionsJob).toHaveBeenCalledWith("C:\\Photos", undefined);
    expect(result.current.jobStartConfirm.pending).toBeNull();
  });

  it("waits for confirmation before restoring captions", async () => {
    const { result, startRestoreCaptionsJob } = setupHost();

    act(() => {
      result.current.panelProps.onRequestStart("restore_captions");
    });

    expect(result.current.jobStartConfirm.pending).toBe("restore_captions");
    expect(startRestoreCaptionsJob).not.toHaveBeenCalled();

    await act(async () => {
      result.current.jobStartConfirm.onConfirm();
    });

    expect(startRestoreCaptionsJob).toHaveBeenCalledWith("C:\\Photos", undefined);
    expect(result.current.jobStartConfirm.pending).toBeNull();
  });

  it("does not restore captions when the confirmation is dismissed", () => {
    const { result, startRestoreCaptionsJob } = setupHost();

    act(() => {
      result.current.panelProps.onRequestStart("restore_captions");
    });

    act(() => {
      result.current.jobStartConfirm.onCancel();
    });

    expect(result.current.jobStartConfirm.pending).toBeNull();
    expect(startRestoreCaptionsJob).not.toHaveBeenCalled();
  });

  it("does not open restore confirmation when the folder has no backup", () => {
    const { result, startRestoreCaptionsJob } = setupHost({ hasCaptionBackup: false });

    act(() => {
      result.current.panelProps.onRequestStart("restore_captions");
    });

    expect(result.current.jobStartConfirm.pending).toBeNull();
    expect(startRestoreCaptionsJob).not.toHaveBeenCalled();
  });

  it("still allows a backup when the folder has no backup yet", async () => {
    const { result, startBackupCaptionsJob } = setupHost({ hasCaptionBackup: false });

    await act(async () => {
      result.current.panelProps.onRequestStart("backup_captions");
    });

    expect(startBackupCaptionsJob).toHaveBeenCalledWith("C:\\Photos", undefined);
  });
});
