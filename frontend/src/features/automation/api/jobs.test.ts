import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobType } from "@/shared/types";

const { postJsonMock } = vi.hoisted(() => ({
  postJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  postJson: postJsonMock,
}));

import { startAutomationJob, trainLoraBody } from "./jobs";

describe("automation API", () => {
  afterEach(() => {
    postJsonMock.mockReset();
  });

  it("routes every job type to its dashed endpoint", async () => {
    postJsonMock.mockResolvedValue({ id: "job-1", status: "queued" });

    const routes: Array<[JobType, string]> = [
      ["auto_caption", "auto-caption"],
      ["strip_metadata", "strip-metadata"],
      ["set_captions", "set-captions"],
      ["verify_captions", "verify-captions"],
      ["batch_rename", "batch-rename"],
      ["backup_captions", "backup-captions"],
      ["restore_captions", "restore-captions"],
      ["train_lora", "train-lora"],
      ["watermark", "watermark"],
    ];

    for (const [jobType, path] of routes) {
      await startAutomationJob(jobType, "C:\\Photos");
      expect(postJsonMock).toHaveBeenLastCalledWith(
        `/api/automation/${path}?path=C%3A%5CPhotos`,
        {},
      );
    }
  });

  it("passes the job body through", async () => {
    postJsonMock.mockResolvedValue({ id: "job-2", status: "queued" });

    await startAutomationJob("set_captions", "C:\\Photos", {
      caption: "Shared caption",
      overwrite: true,
    });

    expect(postJsonMock).toHaveBeenCalledWith("/api/automation/set-captions?path=C%3A%5CPhotos", {
      caption: "Shared caption",
      overwrite: true,
    });
  });

  it("includes selected paths when starting a scoped job", async () => {
    postJsonMock.mockResolvedValue({ id: "job-3", status: "queued" });

    await startAutomationJob("strip_metadata", "C:\\Photos", undefined, [
      "C:\\Photos\\one.png",
      "C:\\Photos\\two.png",
    ]);

    expect(postJsonMock).toHaveBeenCalledWith("/api/automation/strip-metadata?path=C%3A%5CPhotos", {
      paths: ["C:\\Photos\\one.png", "C:\\Photos\\two.png"],
    });
  });

  it("rejects a body field the job type does not accept", async () => {
    postJsonMock.mockResolvedValue({ id: "job-4", status: "queued" });

    // The job type selects its body shape, so a camelCase slip or a field
    // borrowed from another job type fails to compile rather than silently
    // reaching the API and being dropped.
    await startAutomationJob("train_lora", "C:\\Photos", {
      // @ts-expect-error -- the wire field is lora_name
      loraName: "sample_train_v1",
    });
    await startAutomationJob("batch_rename", "C:\\Photos", {
      // @ts-expect-error -- overwrite belongs to set_captions
      overwrite: true,
    });

    // The bodies still go out verbatim: the guarantee is the compile error above,
    // not a runtime filter. Without it the backend would silently ignore both.
    expect(postJsonMock).toHaveBeenCalledTimes(2);
    expect(postJsonMock).toHaveBeenLastCalledWith(
      "/api/automation/batch-rename?path=C%3A%5CPhotos",
      {
        overwrite: true,
      },
    );
  });

  it("maps the settings dialogs onto their wire fields", () => {
    expect(
      trainLoraBody({
        loraName: "sample_train_v1",
        triggerWord: "sampletoken",
        prompts: ["a mountain lake at sunrise"],
      }),
    ).toEqual({
      lora_name: "sample_train_v1",
      trigger_word: "sampletoken",
      prompts: ["a mountain lake at sunrise"],
    });
  });
});
