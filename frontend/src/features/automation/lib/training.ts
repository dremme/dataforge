import type { TrainingModel } from "@/shared/types";
import type { ModalSelectOption } from "@/shared/ui/ModalSelect";

const TRAINING_MODEL_ENTRIES: Record<
  TrainingModel,
  Omit<ModalSelectOption<TrainingModel>, "value">
> = {
  krea2_raw: { title: "Krea 2 Raw", group: "Image" },
  krea2_turbo: { title: "Krea 2 Turbo", group: "Image" },
  moss_image_sft: { title: "MOSS-Image SFT", group: "Image" },
  qwen_image_2: { title: "Qwen Image 2.1", group: "Image" },
  qwen_image_2_turbo: { title: "Qwen Image 2.1 Turbo", group: "Image" },
  h3_fl2va: { title: "MiniMax H3", group: "Video" },
  h3_ref2va: { title: "MiniMax H3 Ref2VA", group: "Video" },
};

export const TRAINING_MODEL_OPTIONS: ReadonlyArray<ModalSelectOption<TrainingModel>> =
  Object.entries(TRAINING_MODEL_ENTRIES).map(([value, entry]) => ({
    value: value as TrainingModel,
    ...entry,
  }));

export const TRAINING_MODELS: readonly TrainingModel[] = TRAINING_MODEL_OPTIONS.map(
  (option) => option.value,
);

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
