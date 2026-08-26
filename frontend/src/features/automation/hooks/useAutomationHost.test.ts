import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { useAutomationHost } from "./useAutomationHost";

import type * as AutomationPreferences from "@/features/automation/preferences/automationPreferences";

vi.mock("@/features/automation/preferences/automationPreferences", async (importOriginal) => {
  const actual = await importOriginal<typeof AutomationPreferences>();
  return {
    ...actual,
    loadAutomationSettings: vi.fn(async (folderPath: string) =>
      actual.emptyAutomationSettings(folderPath),
    ),
  };
});

function setupHost(
  options: {
    hasCaptionBackup?: boolean;
    ostrisAvailable?: boolean;
    comfyPresetsAvailable?: boolean;
  } = {},
) {
  const startJob = vi.fn().mockResolvedValue({ id: "job-1" });

  const automation = {
    folderJob: null,
    folderHasActiveJob: false,
    startingJobType: null,
    isStarting: false,
    isStartingType: vi.fn(() => false),
    cancellingJob: false,
    cancelFolderJob: vi.fn(),
    startJob,
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
      comfyPresetsAvailable: options.comfyPresetsAvailable ?? false,
      getJobPaths: () => undefined,
      // The hook only reads the fields asserted here.
      automation: automation as never,
      onEditSysprompt: vi.fn(),
      issueCount: 0,
      duplicateGroupCount: 0,
      candidateCount: 0,
    }),
  );

  return { result, startJob };
}

describe("useAutomationHost", () => {
  it("opens the dialog before backing up captions", async () => {
    const { result, startJob } = setupHost();

    await act(async () => {
      result.current.panelProps.onRequestStart("backup_captions");
    });

    expect(result.current.jobStartConfirm.pending).toBeNull();
    expect(result.current.dialogs.backupCaptions.open).toBe(true);
    expect(startJob).not.toHaveBeenCalled();

    await act(async () => {
      result.current.dialogs.backupCaptions.onConfirm(true);
    });

    expect(startJob).toHaveBeenCalledWith(
      "backup_captions",
      "C:\\Photos",
      { overwrite: true },
      undefined,
    );
    expect(result.current.dialogs.backupCaptions.open).toBe(false);
  });

  it("waits for confirmation before restoring captions", async () => {
    const { result, startJob } = setupHost();

    act(() => {
      result.current.panelProps.onRequestStart("restore_captions");
    });

    expect(result.current.jobStartConfirm.pending).toBe("restore_captions");
    expect(startJob).not.toHaveBeenCalled();

    await act(async () => {
      result.current.jobStartConfirm.onConfirm();
    });

    expect(startJob).toHaveBeenCalledWith("restore_captions", "C:\\Photos", undefined, undefined);
    expect(result.current.jobStartConfirm.pending).toBeNull();
  });

  it("does not restore captions when the confirmation is dismissed", () => {
    const { result, startJob } = setupHost();

    act(() => {
      result.current.panelProps.onRequestStart("restore_captions");
    });

    act(() => {
      result.current.jobStartConfirm.onCancel();
    });

    expect(result.current.jobStartConfirm.pending).toBeNull();
    expect(startJob).not.toHaveBeenCalled();
  });

  it("does not open restore confirmation when the folder has no backup", () => {
    const { result, startJob } = setupHost({ hasCaptionBackup: false });

    act(() => {
      result.current.panelProps.onRequestStart("restore_captions");
    });

    expect(result.current.jobStartConfirm.pending).toBeNull();
    expect(startJob).not.toHaveBeenCalled();
  });

  it("still allows a backup when the folder has no backup yet", async () => {
    const { result } = setupHost({ hasCaptionBackup: false });

    await act(async () => {
      result.current.panelProps.onRequestStart("backup_captions");
    });

    expect(result.current.dialogs.backupCaptions.open).toBe(true);
  });
});
