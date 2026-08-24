import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobType } from "@/shared/types";
import {
  emptyAutomationSettings,
  loadAutomationSettings,
} from "@/features/automation/preferences/automationPreferences";
import { useAutomationDialogOverlays } from "./useAutomationDialogOverlays";

import type * as AutomationPreferences from "@/features/automation/preferences/automationPreferences";

vi.mock("@/features/automation/preferences/automationPreferences", async (importOriginal) => {
  const actual = await importOriginal<typeof AutomationPreferences>();
  return {
    ...actual,
    loadAutomationSettings: vi.fn(async (folderPath: string) => ({
      ...actual.emptyAutomationSettings(folderPath),
      verify_captions: {
        mode: "instruct" as const,
        reasoning_effort: "medium" as const,
        preserve_thinking: true,
        context: "Outdoor portraits.",
      },
      watermark: {
        text: "Sample Studio",
        size: "large" as const,
        opacity: 75 as const,
        position: "top" as const,
      },
      find_duplicates: { threshold: "loose" as const },
    })),
  };
});

function setupOverlays(
  startingJobType: JobType | null = null,
  scope: { itemCount?: number; folderItemCount?: number; selectionActive?: boolean } = {},
) {
  const startJob = vi.fn().mockResolvedValue({ id: "job-1" });
  const { itemCount = 3, folderItemCount = 3, selectionActive = false } = scope;

  const { result } = renderHook(() =>
    useAutomationDialogOverlays({
      folderPath: "C:\\Photos",
      folderLabel: "Photos",
      startingJobType,
      itemCount,
      folderItemCount,
      selectionActive,
      startJob,
    }),
  );

  return { result, startJob };
}

describe("useAutomationDialogOverlays scope", () => {
  it("reports the selection when one is narrowing the jobs", () => {
    const { result } = setupOverlays(null, {
      itemCount: 23,
      folderItemCount: 2473,
      selectionActive: true,
    });

    expect(result.current.dialogs.setCaptions.scope).toMatchObject({
      itemCount: 23,
      folderLabel: "Photos",
      fromSelection: true,
    });
  });

  it("reports the whole folder when nothing is selected", () => {
    const { result } = setupOverlays(null, { itemCount: 2473, folderItemCount: 2473 });

    expect(result.current.dialogs.setCaptions.scope).toMatchObject({
      itemCount: 2473,
      fromSelection: false,
    });
  });

  /**
   * The backend drops the paths for this one (`train_lora.py`), so reporting the
   * selection here would promise a narrowing that never happens.
   */
  it("keeps LoRA training on the folder and says why while a selection is active", () => {
    const { result } = setupOverlays(null, {
      itemCount: 23,
      folderItemCount: 2473,
      selectionActive: true,
    });

    expect(result.current.dialogs.trainLora.scope).toMatchObject({
      itemCount: 2473,
      fromSelection: false,
    });
    expect(result.current.dialogs.trainLora.scope.note).toMatch(/whole folder/i);
  });

  it("leaves the LoRA note off when there is no selection to contradict", () => {
    const { result } = setupOverlays(null, { itemCount: 2473, folderItemCount: 2473 });

    expect(result.current.dialogs.trainLora.scope.note).toBeUndefined();
  });
});

describe("useAutomationDialogOverlays", () => {
  it("opens dialogs and starts jobs after confirm", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("set_captions");
    });
    expect(result.current.dialogs.setCaptions.open).toBe(true);

    await act(async () => {
      result.current.dialogs.setCaptions.onConfirm("A sunny day", true);
    });

    expect(result.current.dialogs.setCaptions.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "set_captions",
      "C:\\Photos",
      { caption: "A sunny day", overwrite: true },
      undefined,
    );
  });

  it("sends the auto-caption mode and audio choice", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("auto_caption");
    });

    await act(async () => {
      result.current.dialogs.autoCaption.onConfirm("instruct", true, "xhigh", false);
    });

    expect(result.current.dialogs.autoCaption.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "auto_caption",
      "C:\\Photos",
      {
        mode: "instruct",
        caption_audio: true,
        reasoning_effort: "xhigh",
        preserve_thinking: false,
      },
      undefined,
    );
  });

  it("fetches preferences before opening verify captions dialog", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("verify_captions");
    });
    expect(result.current.dialogs.verifyCaptions.open).toBe(true);
    expect(result.current.dialogs.verifyCaptions.initialSettings).toEqual({
      mode: "instruct",
      reasoning_effort: "medium",
      preserve_thinking: true,
      context: "Outdoor portraits.",
    });

    await act(async () => {
      result.current.dialogs.verifyCaptions.onConfirm(
        "thinking",
        "Outdoor portraits.",
        "low",
        true,
      );
    });

    expect(result.current.dialogs.verifyCaptions.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "verify_captions",
      "C:\\Photos",
      {
        mode: "thinking",
        context: "Outdoor portraits.",
        reasoning_effort: "low",
        preserve_thinking: true,
      },
      undefined,
    );
  });

  it("fetches preferences before opening the watermark dialog", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("watermark");
    });
    expect(result.current.dialogs.watermark.open).toBe(true);
    expect(result.current.dialogs.watermark.initialSettings).toEqual({
      text: "Sample Studio",
      size: "large",
      opacity: 75,
      position: "top",
    });

    await act(async () => {
      result.current.dialogs.watermark.onConfirm("Sample Studio", "large", 75, "center");
    });

    expect(result.current.dialogs.watermark.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "watermark",
      "C:\\Photos",
      { text: "Sample Studio", size: "large", opacity: 75, position: "center" },
      undefined,
    );
  });

  it("keeps at most one dialog open", async () => {
    const { result } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("batch_rename");
    });
    expect(result.current.dialogs.batchRename.open).toBe(true);

    await act(async () => {
      result.current.openDialogForJobType("auto_caption");
    });
    expect(result.current.dialogs.autoCaption.open).toBe(true);
    expect(result.current.dialogs.batchRename.open).toBe(false);
  });

  it("marks dialog busy from startingJobType", () => {
    const { result } = setupOverlays("set_captions");

    expect(result.current.dialogs.setCaptions.busy).toBe(true);
    expect(result.current.dialogs.batchRename.busy).toBe(false);
  });

  it("opens the LoRA training dialog and starts the job after confirm", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("train_lora");
    });
    expect(result.current.dialogs.trainLora.open).toBe(true);

    await act(async () => {
      result.current.dialogs.trainLora.onConfirm({
        loraName: "sample_train_v1",
        triggerWord: "",
        prompts: ["a mountain lake at sunrise"],
        model: "h3_fl2va",
        template: null,
      });
    });

    expect(result.current.dialogs.trainLora.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "train_lora",
      "C:\\Photos",
      {
        lora_name: "sample_train_v1",
        trigger_word: "",
        prompts: ["a mountain lake at sunrise"],
        model: "h3_fl2va",
        template: null,
      },
      undefined,
    );
  });
});

describe("useAutomationDialogOverlays saved settings", () => {
  const DIALOG_JOB_TYPES = [
    ["setCaptions", "set_captions"],
    ["replaceCaptions", "replace_captions"],
    ["backupCaptions", "backup_captions"],
    ["autoCaption", "auto_caption"],
    ["verifyCaptions", "verify_captions"],
    ["findDuplicates", "find_duplicates"],
    ["batchRename", "batch_rename"],
    ["trainLora", "train_lora"],
    ["watermark", "watermark"],
  ] as const;

  it("hands every dialog its own block of this folder's settings", async () => {
    const { result } = setupOverlays();
    const expected = await loadAutomationSettings("C:\\Photos");

    for (const [dialog, jobType] of DIALOG_JOB_TYPES) {
      await act(async () => {
        result.current.openDialogForJobType(jobType);
      });

      expect(result.current.dialogs[dialog].initialSettings).toEqual(expected[jobType]);
    }
  });

  it("loads the settings once per open", async () => {
    const { result } = setupOverlays();
    vi.mocked(loadAutomationSettings).mockClear();

    await act(async () => {
      result.current.openDialogForJobType("watermark");
    });

    expect(loadAutomationSettings).toHaveBeenCalledTimes(1);
    expect(loadAutomationSettings).toHaveBeenCalledWith("C:\\Photos");
  });

  it("drops the settings again when a dialog is cancelled", async () => {
    const { result } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("find_duplicates");
    });
    expect(result.current.dialogs.findDuplicates.initialSettings).not.toBeNull();

    act(() => {
      result.current.dialogs.findDuplicates.onCancel();
    });

    expect(result.current.dialogs.findDuplicates.initialSettings).toBeNull();
  });

  it("falls back to the defaults when preferences cannot be read", async () => {
    vi.mocked(loadAutomationSettings).mockResolvedValueOnce(emptyAutomationSettings("C:\\Photos"));
    const { result } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("find_duplicates");
    });

    expect(result.current.dialogs.findDuplicates.initialSettings).toEqual({ threshold: "near" });
  });
});
