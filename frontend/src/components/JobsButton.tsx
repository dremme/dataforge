import { useJobs } from "../context/JobsContext";
import { iconListChecks } from "../icons";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

export function JobsButton() {
  const { activeCount, drawerOpen, toggleDrawer } = useJobs();

  const tooltip = activeCount > 0 ? `Background jobs (${activeCount} running)` : "Background jobs";

  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        className="jobs-button"
        onClick={toggleDrawer}
        aria-label={
          activeCount > 0 ? `Open background jobs (${activeCount} running)` : "Open background jobs"
        }
        aria-expanded={drawerOpen}
        aria-controls={drawerOpen ? "jobs-drawer-panel" : undefined}
      >
        <Icon icon={iconListChecks} className="jobs-button__icon" />
        {activeCount > 0 && (
          <span className="jobs-button__badge" aria-hidden="true">
            {activeCount}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
