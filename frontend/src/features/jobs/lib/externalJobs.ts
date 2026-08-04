import type { ExternalOstrisJob } from "@/shared/types";
import { trainingRemainingTimeLabel } from "./jobs";

// Labels aligned with AI-Toolkit ui/src/app/jobs/new/options.ts (modelArchs).
const OSTRIS_MODEL_LABELS: Record<string, string> = {
  "ai-toolkit/Wan2.2-I2V-A14B-Diffusers-bf16": "Wan 2.2 I2V",
  "ai-toolkit/Wan2.2-T2V-A14B-Diffusers-bf16": "Wan 2.2 T2V",
  "Alpha-VLLM/Lumina-Image-2.0": "Lumina2",
  "baidu/ERNIE-Image": "ERNIE",
  "black-forest-labs/FLUX.1-dev": "FLUX.1",
  "black-forest-labs/FLUX.2-dev": "FLUX.2",
  "black-forest-labs/FLUX.2-klein-base-4B": "FLUX.2 [klein] 4B",
  "black-forest-labs/FLUX.2-klein-base-9B": "FLUX.2 [klein] 9B",
  "Boogu/Boogu-Image-0.1-Base": "Boogu",
  "Boogu/Boogu-Image-0.1-Edit": "Boogu Edit",
  "Comfy-Org/MiniMax-H3": "MiniMax H3",
  "HiDream-ai/HiDream-E1-1": "HiDream E1",
  "HiDream-ai/HiDream-I1-Full": "HiDream",
  "HiDream-ai/HiDream-O1-Image": "HiDream-O1",
  "ideogram-ai/ideogram-4-fp8": "Ideogram4",
  "krea/Krea-2-Raw": "Krea 2",
  "krea/Krea-2-Turbo": "Krea 2 Turbo",
  "Lightricks/LTX-2.3/ltx-2.3-22b-dev.safetensors": "LTX 2.3",
  "lodestones/Chroma1-Base": "Chroma",
  "lodestones/Zeta-Chroma/zeta-chroma-base-x0-pixel-dino-distance.safetensors": "Zeta Chroma",
  "NucleusAI/Nucleus-Image": "Nucleus",
  "OmniGen2/OmniGen2": "OmniGen2",
  "ostris/Flex.1-alpha": "Flex.1",
  "ostris/Flex.2-preview": "Flex.2",
  "ostris/Z-Image-De-Turbo": "Z-Image De-Turbo",
  "Qwen/Qwen-Image-2512": "Qwen Image 2512",
  "Qwen/Qwen-Image-Edit-2511": "Qwen Image Edit 2511",
  "stabilityai/stable-diffusion-xl-base-1.0": "SDXL",
  "stable-diffusion-v1-5/stable-diffusion-v1-5": "SD 1.5",
  "Tongyi-MAI/Z-Image": "Z-Image",
  "Tongyi-MAI/Z-Image-Turbo": "Z-Image Turbo",
};

const SAFETENSORS_SUFFIX = ".safetensors";

export function externalJobModelLabel(job: ExternalOstrisJob): string {
  if (!job.model) return "Unknown model";

  const known = OSTRIS_MODEL_LABELS[job.model];
  if (known) return known;

  const model = job.model;
  if (model.toLowerCase().endsWith(SAFETENSORS_SUFFIX)) {
    const baseName = model.split(/[/\\]/).pop() ?? model;
    return baseName.slice(0, -SAFETENSORS_SUFFIX.length);
  }

  return model;
}

export function externalJobProgressPercent(job: ExternalOstrisJob): number {
  if (!job.total_steps || job.total_steps <= 0) return 0;
  return Math.min(100, Math.round((job.step / job.total_steps) * 100));
}

export function parseSpeedSecondsPerStep(speedString: string | null | undefined): number | null {
  if (!speedString) return null;

  const match = speedString.match(/([\d.]+)\s*sec\/iter/i);
  if (!match) return null;

  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function externalJobRemainingTimeLabel(job: ExternalOstrisJob): string | null {
  if (job.status !== "running") return null;

  return trainingRemainingTimeLabel(
    job.step,
    job.total_steps,
    parseSpeedSecondsPerStep(job.speed_string),
  );
}

const ACTIVE_OSTRIS_STATUSES = new Set(["queued", "running", "stopping"]);

export function isActiveExternalJobStatus(status: string): boolean {
  return ACTIVE_OSTRIS_STATUSES.has(status);
}

const OSTRIS_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  completed: "Completed",
  error: "Failed",
};

export function externalJobStatusLabel(job: ExternalOstrisJob, stopping = false): string {
  if (stopping) {
    if (job.save_now) return "Saving checkpoint";
    if (job.stop_requested) return "Stopping";
    return "Saving checkpoint";
  }

  if (job.status === "running") {
    if (job.save_now) return "Saving checkpoint";
    if (job.stop_requested) return "Stopping";
    return "Running";
  }

  return OSTRIS_STATUS_LABELS[job.status] ?? job.status;
}
