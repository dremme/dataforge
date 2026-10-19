import { RadioTileGroup, type RadioTileOption } from "@/shared/ui/RadioTileGroup";
import type { ReasoningEffort } from "@/shared/types";

export type { ReasoningEffort };

// The set is fixed by the chat template, which raises on anything outside it. Descriptions
// paraphrase the instruction each level makes the template inject.
const EFFORTS: ReadonlyArray<RadioTileOption<ReasoningEffort>> = [
  {
    value: "xhigh",
    title: "Extra high",
    description: "Validates assumptions, weighs alternatives",
  },
  { value: "medium", title: "Medium", description: "Balanced; the right level for captioning" },
  { value: "low", title: "Low", description: "Brief thinking, straight to the answer" },
];

interface ReasoningEffortSelectorProps {
  value: ReasoningEffort;
  /** Radio group name; unique per dialog so stacked dialogs stay independent. */
  name: string;
  /** Accessible name for the group, e.g. "Caption reasoning effort". */
  groupLabel: string;
  disabled?: boolean;
  onChange: (effort: ReasoningEffort) => void;
}

/** How hard the model reasons, for the vision-LLM job dialogs in reasoning mode. */
export function ReasoningEffortSelector({
  value,
  name,
  groupLabel,
  disabled = false,
  onChange,
}: ReasoningEffortSelectorProps) {
  return (
    <RadioTileGroup
      value={value}
      options={EFFORTS}
      label="Reasoning effort"
      name={name}
      groupLabel={groupLabel}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
