import { iconChartBar } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface StatsButtonProps {
  open: boolean;
  onToggle: () => void;
}

export function StatsButton({ open, onToggle }: StatsButtonProps) {
  return (
    <Tooltip content="Dataset statistics">
      <button
        type="button"
        className={classNames("stats-button", open && "stats-button--active")}
        onClick={onToggle}
        aria-label="Open dataset statistics"
        aria-expanded={open}
        // Points at the drawer from outside it, so the id is a fixed string.
        aria-controls={open ? "stats-drawer-panel" : undefined}
      >
        <Icon icon={iconChartBar} className="stats-button__icon" />
      </button>
    </Tooltip>
  );
}
