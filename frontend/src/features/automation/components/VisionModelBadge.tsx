import { useVisionModelId } from "@/features/automation/hooks/useVisionModelId";
import { iconBrain } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

/** Inline badge for the configured vision model id (loaded once), or null if unknown. */
export function VisionModelBadge() {
  const modelId = useVisionModelId();
  if (!modelId) return null;
  return (
    <>
      {" "}
      <span className="confirm-dialog__model-badge">
        <Icon icon={iconBrain} className="confirm-dialog__model-badge-icon" />
        {modelId}
      </span>
    </>
  );
}
