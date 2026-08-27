import type { TrainingModel } from "@/shared/types";
import type { RadioTileOption } from "@/shared/ui/RadioTileGroup";

export const TRAINING_MODEL_OPTIONS: ReadonlyArray<RadioTileOption<TrainingModel>> = [
  {
    value: "krea2_turbo",
    title: "Krea 2 Turbo",
    description: "Image model. 1024px samples.",
  },
  {
    value: "h3_fl2va",
    title: "MiniMax H3",
    description: "Video model. 1.6s sample clips.",
  },
];

export const DEFAULT_TRAINING_MODEL: TrainingModel = "krea2_turbo";

export function trainingModelLabel(model: TrainingModel): string {
  return TRAINING_MODEL_OPTIONS.find((option) => option.value === model)?.title ?? model;
}

export const DEFAULT_TRAINING_PROMPTS = [
  "a mountain lake at sunrise, mist over the water",
  "a red hatchback parked on a wet city street at night",
  "a wooden chair beside a window, soft daylight",
];

export const MAX_LORA_NAME_LENGTH = 80;

const INVALID_NAME_PATTERN = /[<>:"/\\|?*]/;

export function validateLoraName(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed) return "Enter a name for the LoRA.";
  if (trimmed.length > MAX_LORA_NAME_LENGTH) {
    return `The name can be at most ${MAX_LORA_NAME_LENGTH} characters.`;
  }
  if (trimmed === "." || trimmed === "..") return "Choose a different name.";
  if (INVALID_NAME_PATTERN.test(trimmed)) {
    return 'The name cannot contain < > : " / \\ | ? *';
  }

  return null;
}

export function cleanTrainingPrompts(prompts: readonly string[]): string[] {
  return prompts.map((prompt) => prompt.trim()).filter((prompt) => prompt.length > 0);
}
