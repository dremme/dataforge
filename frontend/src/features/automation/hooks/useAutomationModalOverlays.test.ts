import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobType } from "@/shared/types";
import {
  emptyAutomationSettings,
  loadAutomationSettings,
} from "@/features/automation/preferences/automationPreferences";
import { useAutomationModalOverlays } from "./useAutomationModalOverlays";

import type * as AutomationPreferences from "@/features/automation/preferences/automationPreferences";
import { createTestQueryClient, renderHookWithQueryClient } from "@/test/queryClient";
import type { JobStartBody } from "@/shared/api/jobStartBodies";

vi.mock("@/features/automation/preferences/automationPreferences", async (importOriginal) => {
  const actual = await importOriginal<typeof AutomationPreferences>();
  return {
    ...actual,
    loadAutomationSettings: vi.fn<typeof loadAutomationSettings>(async (folderPath: string) => ({
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
        strip_metadata: false,
      },
      find_duplicates: { threshold: "loose" as const },
    })),
  };
});

function setupOverlays(
  startingJobType: JobType | null = null,
  scope: { itemCount?: number; folderItemCount?: number; selectionActive?: boolean } = {},
) {
  const startJob = vi
    .fn<
      (jobType: JobType, folder: string, body?: JobStartBody, paths?: string[]) => Promise<unknown>
    >()
    .mockResolvedValue({ id: "job-1" });
  const { itemCount = 3, folderItemCount = 3, selectionActive = false } = scope;

  const { result } = renderHookWithQueryClient(() =>
    useAutomationModalOverlays({
      folderPath: "C:\\Photos",
      folderLabel: "Photos",
      startingJobType,
      itemCount,
      folderItemCount,
      scopeKind: selectionActive ? "selected" : "folder",
      startJob,
    }),
  );

  return { result, startJob };
}

describe("useAutomationModalOverlays scope", () => {
  it("freezes target paths and preview counts before loading the modal", async () => {
    const paths = ["C:\\Photos\\one.png"];
    const startJob = vi
      .fn<
        (
          jobType: JobType,
          folder: string,
          body?: JobStartBody,
          paths?: string[],
        ) => Promise<unknown>
      >()
      .mockResolvedValue({ id: "job-1" });
    const { result, rerender } = renderHookWithQueryClient(() =>
      useAutomationModalOverlays({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        startingJobType: null,
        itemCount: paths.length,
        folderItemCount: 3,
        scopeKind: "visible",
        startJob,
        getJobPaths: () => paths,
      }),
    );
    await act(async () => result.current.openModalForJobType("replace_captions"));
    paths.push("C:\\Photos\\two.png");
    rerender();
    expect(result.current.modals.replaceCaptions.scope.itemCount).toBe(1);
    expect(result.current.modals.replaceCaptions.selectedPaths).toEqual(["C:\\Photos\\one.png"]);
    await act(async () =>
      result.current.modals.replaceCaptions.onConfirm({
        mode: "replace",
        search: "lake",
        replacement: "river",
        useRegex: false,
        caseSensitive: false,
        backup: false,
      }),
    );
    expect(startJob.mock.calls[0][3]).toEqual(["C:\\Photos\\one.png"]);
    expect(startJob.mock.calls[0][2]).toEqual({
      mode: "replace",
      search: "lake",
      replacement: "river",
      use_regex: false,
      case_sensitive: false,
      backup: false,
    });
  });

  it("does not open an ordinary bulk modal for an empty target", async () => {
    const startJob =
      vi.fn<
        (
          jobType: JobType,
          folder: string,
          body?: JobStartBody,
          paths?: string[],
        ) => Promise<unknown>
      >();
    const { result } = renderHookWithQueryClient(() =>
      useAutomationModalOverlays({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        startingJobType: null,
        itemCount: 0,
        folderItemCount: 3,
        scopeKind: "visible",
        startJob,
        getJobPaths: () => [],
      }),
    );
    await act(async () => result.current.openModalForJobType("set_captions"));
    expect(result.current.modals.setCaptions.open).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
  });

  it("submits whole-folder training without a filtered path list", async () => {
    const startJob = vi
      .fn<
        (
          jobType: JobType,
          folder: string,
          body?: JobStartBody,
          paths?: string[],
        ) => Promise<unknown>
      >()
      .mockResolvedValue({ id: "job-1" });
    const { result } = renderHookWithQueryClient(() =>
      useAutomationModalOverlays({
        folderPath: "C:\\Photos",
        folderLabel: "Photos",
        startingJobType: null,
        itemCount: 1,
        folderItemCount: 3,
        scopeKind: "visible",
        startJob,
        getJobPaths: () => ["C:\\Photos\\one.png"],
      }),
    );
    await act(async () => result.current.openModalForJobType("train_lora"));
    expect(result.current.modals.trainLora.scope.kind).toBe("folder");
    expect(result.current.modals.trainLora.scope.itemCount).toBe(3);
    await act(async () =>
      result.current.modals.trainLora.onConfirm({
        loraName: "sample_train_v1",
        triggerWord: "",
        prompts: ["a lake"],
        model: "h3_fl2va",
        template: null,
      }),
    );
    expect(startJob.mock.calls[0][3]).toBeUndefined();
  });
  it("reports the selection when one is narrowing the jobs", () => {
    const { result } = setupOverlays(null, {
      itemCount: 23,
      folderItemCount: 2473,
      selectionActive: true,
    });

    expect(result.current.modals.setCaptions.scope).toMatchObject({
      itemCount: 23,
      folderLabel: "Photos",
      kind: "selected" as const,
    });
  });

  it("reports the whole folder when nothing is selected", () => {
    const { result } = setupOverlays(null, { itemCount: 2473, folderItemCount: 2473 });

    expect(result.current.modals.setCaptions.scope).toMatchObject({
      itemCount: 2473,
      kind: "folder" as const,
    });
  });

  /** train_lora drops selected paths; a selection here would promise a narrowing it never does. */
  it("keeps LoRA training on the folder and says why while a selection is active", () => {
    const { result } = setupOverlays(null, {
      itemCount: 23,
      folderItemCount: 2473,
      selectionActive: true,
    });

    expect(result.current.modals.trainLora.scope).toMatchObject({
      itemCount: 2473,
      kind: "folder" as const,
    });
    expect(result.current.modals.trainLora.scope.note).toMatch(/whole folder/i);
  });

  it("always explains that search and filters do not narrow LoRA training", () => {
    const { result } = setupOverlays(null, { itemCount: 2473, folderItemCount: 2473 });

    expect(result.current.modals.trainLora.scope.note).toContain("Search, filters, and selection");
  });
});

describe("useAutomationModalOverlays", () => {
  it("hands the auto-caption modal the folder whose system prompt it names", async () => {
    const { result } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("auto_caption");
    });
    await waitFor(() => expect(result.current.modals.autoCaption.open).toBe(true));

    expect(result.current.modals.autoCaption.folderPath).toBe("C:\\Photos");
  });

  it("opens modals and starts jobs after confirm", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("set_captions");
    });
    expect(result.current.modals.setCaptions.open).toBe(true);

    await act(async () => {
      result.current.modals.setCaptions.onConfirm("A sunny day", true);
    });

    expect(result.current.modals.setCaptions.open).toBe(false);
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
      result.current.openModalForJobType("auto_caption");
    });

    await act(async () => {
      result.current.modals.autoCaption.onConfirm("instruct", true, "xhigh", false);
    });

    expect(result.current.modals.autoCaption.open).toBe(false);
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

  it("fetches preferences before opening verify captions modal", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("verify_captions");
    });
    expect(result.current.modals.verifyCaptions.open).toBe(true);
    expect(result.current.modals.verifyCaptions.initialSettings).toEqual({
      mode: "instruct",
      reasoning_effort: "medium",
      preserve_thinking: true,
      context: "Outdoor portraits.",
    });

    await act(async () => {
      result.current.modals.verifyCaptions.onConfirm("thinking", "Outdoor portraits.", "low", true);
    });

    expect(result.current.modals.verifyCaptions.open).toBe(false);
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

  it("starts a resize with the chosen budget and grid", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("resize");
    });
    expect(result.current.modals.resize.initialSettings).toEqual({ megapixels: 2, multiple: 32 });

    await act(async () => {
      result.current.modals.resize.onConfirm(1.5, 8, true);
    });

    expect(result.current.modals.resize.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "resize",
      "C:\\Photos",
      { megapixels: 1.5, multiple: 8, reset_size: true },
      undefined,
    );
  });

  it("fetches preferences before opening the watermark modal", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("watermark");
    });
    expect(result.current.modals.watermark.open).toBe(true);
    expect(result.current.modals.watermark.initialSettings).toEqual({
      text: "Sample Studio",
      size: "large",
      opacity: 75,
      position: "top",
      strip_metadata: false,
    });

    await act(async () => {
      result.current.modals.watermark.onConfirm("Sample Studio", "large", 75, "center", true);
    });

    expect(result.current.modals.watermark.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "watermark",
      "C:\\Photos",
      {
        text: "Sample Studio",
        size: "large",
        opacity: 75,
        position: "center",
        strip_metadata: true,
      },
      undefined,
    );
  });

  it("starts auto-adjust with the choice to replace earlier adjustments", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("auto_adjust");
    });
    expect(result.current.modals.autoAdjust.open).toBe(true);

    await act(async () => {
      result.current.modals.autoAdjust.onConfirm(true, false);
    });

    expect(result.current.modals.autoAdjust.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "auto_adjust",
      "C:\\Photos",
      { replace_adjustments: true, reset_adjustments: false },
      undefined,
    );
  });

  it("starts auto-adjust in reset mode", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("auto_adjust");
      result.current.modals.autoAdjust.onConfirm(false, true);
    });

    expect(startJob).toHaveBeenCalledWith(
      "auto_adjust",
      "C:\\Photos",
      { replace_adjustments: false, reset_adjustments: true },
      undefined,
    );
  });

  it("keeps at most one modal open", async () => {
    const { result } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("batch_rename");
    });
    expect(result.current.modals.batchRename.open).toBe(true);

    await act(async () => {
      result.current.openModalForJobType("auto_caption");
    });
    expect(result.current.modals.autoCaption.open).toBe(true);
    expect(result.current.modals.batchRename.open).toBe(false);
  });

  it("marks modal busy from startingJobType", () => {
    const { result } = setupOverlays("set_captions");

    expect(result.current.modals.setCaptions.busy).toBe(true);
    expect(result.current.modals.batchRename.busy).toBe(false);
  });

  it("opens the LoRA training modal and starts the job after confirm", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("train_lora");
    });
    expect(result.current.modals.trainLora.open).toBe(true);

    await act(async () => {
      result.current.modals.trainLora.onConfirm({
        loraName: "sample_train_v1",
        triggerWord: "",
        prompts: ["a mountain lake at sunrise"],
        model: "h3_fl2va",
        template: null,
      });
    });

    expect(result.current.modals.trainLora.open).toBe(false);
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

describe("useAutomationModalOverlays saved settings", () => {
  const DIALOG_JOB_TYPES = [
    ["setCaptions", "set_captions"],
    ["replaceCaptions", "replace_captions"],
    ["backupCaptions", "backup_captions"],
    ["autoCaption", "auto_caption"],
    ["verifyCaptions", "verify_captions"],
    ["editCaptions", "edit_captions"],
    ["findDuplicates", "find_duplicates"],
    ["batchRename", "batch_rename"],
    ["trainLora", "train_lora"],
    ["watermark", "watermark"],
    ["resize", "resize"],
  ] as const;

  it("hands every modal its own block of this folder's settings", async () => {
    const { result } = setupOverlays();
    const expected = await loadAutomationSettings("C:\\Photos", createTestQueryClient());

    for (const [modal, jobType] of DIALOG_JOB_TYPES) {
      await act(async () => {
        result.current.openModalForJobType(jobType);
      });

      expect(result.current.modals[modal].initialSettings).toEqual(expected[jobType]);
    }
  });

  it("loads the settings once per open", async () => {
    const { result } = setupOverlays();
    vi.mocked(loadAutomationSettings).mockClear();

    await act(async () => {
      result.current.openModalForJobType("watermark");
    });

    expect(loadAutomationSettings).toHaveBeenCalledTimes(1);
    expect(loadAutomationSettings).toHaveBeenCalledWith("C:\\Photos", expect.anything());
  });

  it("drops the settings again when a modal is cancelled", async () => {
    const { result } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("find_duplicates");
    });
    expect(result.current.modals.findDuplicates.initialSettings).not.toBeNull();

    act(() => {
      result.current.modals.findDuplicates.onCancel();
    });

    expect(result.current.modals.findDuplicates.initialSettings).toBeNull();
  });

  it("falls back to the defaults when preferences cannot be read", async () => {
    vi.mocked(loadAutomationSettings).mockResolvedValueOnce(emptyAutomationSettings("C:\\Photos"));
    const { result } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("find_duplicates");
    });

    expect(result.current.modals.findDuplicates.initialSettings).toEqual({ threshold: "near" });
  });
});

describe("useAutomationModalOverlays edit captions", () => {
  it("sends the instruction, the model controls and the backup choice", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openModalForJobType("edit_captions");
    });
    expect(result.current.modals.editCaptions.open).toBe(true);

    await act(async () => {
      result.current.modals.editCaptions.onConfirm(
        "thinking",
        "Rewrite in present tense.",
        "low",
        false,
        false,
      );
    });

    expect(result.current.modals.editCaptions.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "edit_captions",
      "C:\\Photos",
      {
        mode: "thinking",
        instruction: "Rewrite in present tense.",
        reasoning_effort: "low",
        preserve_thinking: false,
        backup: false,
      },
      undefined,
    );
  });
});
