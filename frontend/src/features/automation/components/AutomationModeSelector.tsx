import { RadioTileGroup, type RadioTileOption } from "@/shared/ui/RadioTileGroup";
import type { AutomationMode } from "@/shared/types";

export type { AutomationMode };

const MODES: ReadonlyArray<RadioTileOption<AutomationMode>> = [
  { value: "thinking", title: "Reasoning", description: "Slower, but better overall outcome" },
  { value: "instruct", title: "Instruct", description: "Faster, but makes more mistakes" },
];

interface AutomationModeSelectorProps {
  value: AutomationMode;
  /** Radio group name; unique per dialog so stacked dialogs stay independent. */
  name: string;
  /** Accessible name for the group, e.g. "Caption mode". */
  groupLabel: string;
  disabled?: boolean;
  onChange: (mode: AutomationMode) => void;
}

/** Reasoning / Instruct tiles shared by the vision-LLM job dialogs. */
export function AutomationModeSelector({
  value,
  name,
  groupLabel,
  disabled = false,
  onChange,
}: AutomationModeSelectorProps) {
  return (
    <RadioTileGroup
      value={value}
      options={MODES}
      label="Mode"
      name={name}
      groupLabel={groupLabel}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
