/** Sample prompts a new training job starts with; every one is editable. */
export const DEFAULT_TRAINING_PROMPTS = [
  "a mountain lake at sunrise, mist over the water",
  "a red hatchback parked on a wet city street at night",
  "a wooden chair beside a window, soft daylight",
];

export const MAX_LORA_NAME_LENGTH = 80;

const INVALID_NAME_PATTERN = /[<>:"/\\|?*]/;

/** Mirrors the backend rule: the name becomes a folder under the training folder. */
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
