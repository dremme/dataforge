import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRecentActionIds } from "@/features/quickAction/lib/quickActionHistory";
import { mediaItem } from "@/test/fixtures";
import { useAutomationHost } from "./useAutomationHost";

import type * as AutomationPreferences from "@/features/automation/preferences/automationPreferences";
import { renderHookWithQueryClient } from "@/test/queryClient";
import type { loadAutomationSettings } from "@/features/automation/preferences/automationPreferences";
import type { StartJob } from "@/features/jobs/hooks/useJobStartConfirmation";

vi.mock("@/features/automation/preferences/automationPreferences", async (importOriginal) => {
  const actual = await importOriginal<typeof AutomationPreferences>();
  return {
    ...actual,
    loadAutomationSettings: vi.fn<typeof loadAutomationSettings>(async (folderPath: string) =>
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
  const startJob = vi.fn<StartJob>().mockResolvedValue({ id: "job-1" });

  const automation = {
    folderJob: null,
    folderHasActiveJob: false,
    startingJobType: null,
    isStarting: false,
    cancellingJob: false,
    cancelFolderJob: vi.fn<() => void>(),
    startJob,
  };

  const { result } = renderHookWithQueryClient(() =>
    useAutomationHost({
      folder: "C:\\Photos",
      breadcrumbs: [{ name: "Photos", path: "C:\\Photos" }],
      items: [mediaItem("sunset.png", "C:\\Photos")],
      syspromptApplies: false,
      hasCaptionBackup: options.hasCaptionBackup ?? true,
      ostrisAvailable: options.ostrisAvailable ?? false,
      comfyPresetsAvailable: options.comfyPresetsAvailable ?? false,
      getJobPaths: () => undefined,
      // The hook only reads the fields asserted here.
      automation: automation as never,
      onEditSysprompt: vi.fn<() => void>(),
      issueCount: 0,
      duplicateGroupCount: 0,
      candidateCount: 0,
    }),
  );

  return { result, startJob };
}

afterEach(() => {
  localStorage.clear();
});

describe("useAutomationHost", () => {
  it("opens the dialog before backing up captions", async () => {
    const { result, startJob } = setupHost();

    await act(async () => {
      result.current.actions.onRequestStart("backup_captions");
    });

    expect(result.current.jobStartConfirm.pending).toBeNull();
    expect(result.current.dialogs.backupCaptions.open).toBe(true);
    expect(startJob).not.toHaveBeenCalled();

    await act(async () => {
      result.current.dialogs.backupCaptions.onConfirm();
    });

    expect(startJob).toHaveBeenCalledWith("backup_captions", "C:\\Photos", undefined, undefined);
    expect(result.current.dialogs.backupCaptions.open).toBe(false);
  });

  it("opens the comparison dialog before restoring captions", async () => {
    const { result, startJob } = setupHost();

    await act(async () => {
      result.current.actions.onRequestStart("restore_captions");
    });

    expect(result.current.jobStartConfirm.pending).toBeNull();
    expect(result.current.dialogs.restoreCaptions.open).toBe(true);
    expect(result.current.dialogs.restoreCaptions.folderPath).toBe("C:\\Photos");
    expect(startJob).not.toHaveBeenCalled();

    await act(async () => {
      result.current.dialogs.restoreCaptions.onConfirm();
    });

    expect(startJob).toHaveBeenCalledWith("restore_captions", "C:\\Photos", undefined, undefined);
    expect(result.current.dialogs.restoreCaptions.open).toBe(false);
  });

  it("does not restore captions when the dialog is dismissed", async () => {
    const { result, startJob } = setupHost();

    await act(async () => {
      result.current.actions.onRequestStart("restore_captions");
    });
    act(() => {
      result.current.dialogs.restoreCaptions.onCancel();
    });

    expect(result.current.dialogs.restoreCaptions.open).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
  });

  it("does not open the restore dialog when the folder has no backup", async () => {
    const { result, startJob } = setupHost({ hasCaptionBackup: false });

    await act(async () => {
      result.current.actions.onRequestStart("restore_captions");
    });

    expect(result.current.dialogs.restoreCaptions.open).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
  });

  it("records a started job so the empty palette can offer it again", async () => {
    const { result } = setupHost();

    await act(async () => {
      result.current.actions.onRequestStart("replace_captions");
    });

    expect(readRecentActionIds()).toEqual(["run:replace_captions"]);
  });

  it("does not record a job the folder cannot start", () => {
    const { result } = setupHost({ hasCaptionBackup: false });

    act(() => {
      result.current.actions.onRequestStart("restore_captions");
    });

    expect(readRecentActionIds()).toEqual([]);
  });

  it("still allows a backup when the folder has no backup yet", async () => {
    const { result } = setupHost({ hasCaptionBackup: false });

    await act(async () => {
      result.current.actions.onRequestStart("backup_captions");
    });

    expect(result.current.dialogs.backupCaptions.open).toBe(true);
  });
});
