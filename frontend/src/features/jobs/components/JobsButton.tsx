import { useJobs } from "@/features/jobs/context/JobsContext";
import { iconSettings } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

export function JobsButton() {
  const { activeCount, drawerOpen, toggleDrawer } = useJobs();

  const running = activeCount > 0;
  const tooltip = running ? "Background jobs are running" : "Background jobs";

  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        className={classNames("jobs-button", running && "jobs-button--running")}
        onClick={toggleDrawer}
        aria-label={running ? "Open background jobs (running)" : "Open background jobs"}
        aria-expanded={drawerOpen}
        aria-controls={drawerOpen ? "jobs-drawer-panel" : undefined}
      >
        <Icon icon={iconSettings} className="jobs-button__icon" />
        {running && <span className="jobs-button__dot" aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}
