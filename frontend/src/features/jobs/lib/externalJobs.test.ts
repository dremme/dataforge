import { describe, expect, it } from "vitest";
import type { ExternalOstrisJob } from "@/shared/types";
import {
  externalJobModelLabel,
  externalJobProgressPercent,
  externalJobRemainingTimeLabel,
  externalJobStatusLabel,
  parseSpeedSecondsPerStep,
  trainingRemainingTimeLabel,
} from "./externalJobs";

const runningJob: ExternalOstrisJob = {
  id: "job-1",
  name: "sample_train_v1",
  status: "running",
  step: 100,
  total_steps: 200,
  info: "Training",
  speed_string: "2.00 sec/iter",
  job_type: "train",
  dataset_folder: "C:\\datasets\\photos",
  dataset_folder_name: "photos",
  model: "krea/Krea-2-Turbo",
  created_at: "2026-01-01T00:00:00.000Z",
  save_now: false,
  stop_requested: false,
};

describe("externalJobs utils", () => {
  it("maps known Ostris model paths to friendly labels", () => {
    expect(
      externalJobModelLabel({
        ...runningJob,
        model: "ai-toolkit/Wan2.2-I2V-A14B-Diffusers-bf16",
      }),
    ).toBe("Wan 2.2 I2V");
    expect(externalJobModelLabel({ ...runningJob, model: "krea/Krea-2-Turbo" })).toBe(
      "Krea 2 Turbo",
    );
    expect(externalJobModelLabel({ ...runningJob, model: "black-forest-labs/FLUX.2-dev" })).toBe(
      "FLUX.2",
    );
    expect(
      externalJobModelLabel({
        ...runningJob,
        model: "Lightricks/LTX-2.3/ltx-2.3-22b-dev.safetensors",
      }),
    ).toBe("LTX 2.3");
  });

  it("falls back to the raw model path for unknown models", () => {
    expect(externalJobModelLabel({ ...runningJob, model: "custom/vendor-model" })).toBe(
      "custom/vendor-model",
    );
    expect(externalJobModelLabel({ ...runningJob, model: null })).toBe("Unknown model");
  });

  it("shows only the safetensors base name when the model is a file path", () => {
    expect(
      externalJobModelLabel({
        ...runningJob,
        model: "C:\\models\\checkpoints\\flux-dev-fp8.safetensors",
      }),
    ).toBe("flux-dev-fp8");
    expect(
      externalJobModelLabel({
        ...runningJob,
        model: "/home/models/my-lora.safetensors",
      }),
    ).toBe("my-lora");
    expect(
      externalJobModelLabel({
        ...runningJob,
        model: "local-checkpoint.safetensors",
      }),
    ).toBe("local-checkpoint");
  });

  it("parses sec/iter speed strings", () => {
    expect(parseSpeedSecondsPerStep("2.15 sec/iter")).toBe(2.15);
    expect(parseSpeedSecondsPerStep("invalid")).toBeNull();
  });

  it("computes progress percent from steps", () => {
    expect(externalJobProgressPercent(runningJob)).toBe(50);
  });

  it("estimates remaining time from speed and steps", () => {
    expect(externalJobRemainingTimeLabel(runningJob)).toBe("~4 min left");
    expect(trainingRemainingTimeLabel(100, 200, 2)).toBe("~4 min left");
    expect(trainingRemainingTimeLabel(190, 200, 2)).toBe("<1 min left");
  });

  it("gives every status a readable label, not the raw value", () => {
    expect(externalJobStatusLabel(runningJob)).toBe("Running");
    expect(externalJobStatusLabel({ ...runningJob, status: "queued" })).toBe("Queued");
    expect(externalJobStatusLabel({ ...runningJob, status: "stopping" })).toBe("Stopping");
    expect(externalJobStatusLabel({ ...runningJob, status: "error" })).toBe("Failed");
    expect(externalJobStatusLabel(runningJob, true)).toBe("Saving checkpoint");
  });
});
