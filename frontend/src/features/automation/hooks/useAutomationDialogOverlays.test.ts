import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobType } from "@/shared/types";
import { useAutomationDialogOverlays } from "./useAutomationDialogOverlays";

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
    context: "Outdoor portraits.",
    folderPath,
  })),
}));

function setupOverlays(startingJobType: JobType | null = null) {
  const startJob = vi.fn().mockResolvedValue({ id: "job-1" });

  const { result } = renderHook(() =>
    useAutomationDialogOverlays({
      folderPath: "C:\\Photos",
      folderLabel: "Photos",
      startingJobType,
      itemCount: 3,
      startJob,
    }),
  );

  return { result, startJob };
}

describe("useAutomationDialogOverlays", () => {
  it("opens dialogs and starts jobs after confirm", async () => {
    const { result, startJob } = setupOverlays();

    act(() => {
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

  it("fetches preferences before opening verify captions dialog", async () => {
    const { result, startJob } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("verify_captions");
    });
    expect(result.current.dialogs.verifyCaptions.open).toBe(true);
    expect(result.current.dialogs.verifyCaptions.initialSettings).toEqual({
      mode: "instruct",
      context: "Outdoor portraits.",
      folderPath: "C:\\Photos",
    });

    await act(async () => {
      result.current.dialogs.verifyCaptions.onConfirm("thinking", "Outdoor portraits.");
    });

    expect(result.current.dialogs.verifyCaptions.open).toBe(false);
    expect(startJob).toHaveBeenCalledWith(
      "verify_captions",
      "C:\\Photos",
      { mode: "thinking", context: "Outdoor portraits." },
      undefined,
    );
  });

  it("fetches preferences before opening body parts dialog", async () => {
    const { result } = setupOverlays();

    await act(async () => {
      result.current.openDialogForJobType("body_parts");
    });

    expect(result.current.dialogs.bodyParts.open).toBe(true);
    expect(result.current.dialogs.bodyParts.initialSettings).toEqual({
      bodyDescription: "body",
      faceDescription: "face",
      keywords: "hat",
      elementDescription: "part",
    });
  });

  it("keeps at most one dialog open", () => {
    const { result } = setupOverlays();

    act(() => {
      result.current.openDialogForJobType("batch_rename");
    });
    expect(result.current.dialogs.batchRename.open).toBe(true);

    act(() => {
      result.current.openDialogForJobType("auto_caption");
    });
    expect(result.current.dialogs.autoCaption.open).toBe(true);
    expect(result.current.dialogs.batchRename.open).toBe(false);
  });

  it("marks dialog busy from startingJobType", () => {
    const { result } = setupOverlays("set_captions");

    expect(result.current.dialogs.setCaptions.busy).toBe(true);
    expect(result.current.dialogs.bodyParts.busy).toBe(false);
  });

  it("opens the LoRA training dialog and starts the job after confirm", async () => {
    const { result, startJob } = setupOverlays();

    act(() => {
      result.current.openDialogForJobType("train_lora");
    });
    expect(result.current.dialogs.trainLora.open).toBe(true);

    await act(async () => {
      result.current.dialogs.trainLora.onConfirm({
        loraName: "sample_train_v1",
        triggerWord: "",
        prompts: ["a mountain lake at sunrise"],
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
      },
      undefined,
    );
  });
});
