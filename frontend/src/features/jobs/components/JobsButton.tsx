import { useJobs } from "@/features/jobs/context/JobsContext";
import { iconBot } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

function describeJobs(running: boolean, unseenCount: number, unseenFailed: boolean): string[] {
  const parts: string[] = [];
  if (running) parts.push("running");
  if (unseenCount > 0) parts.push(`${unseenCount} new`);
  if (unseenFailed) parts.push("some failed");
  return parts;
}

export function JobsButton() {
  const { activeCount, drawerOpen, toggleDrawer, unseenCount, unseenFailed } = useJobs();

  const running = activeCount > 0;
  const unseen = unseenCount > 0;
  const parts = describeJobs(running, unseenCount, unseenFailed);
  const label =
    parts.length > 0 ? `Open automation jobs (${parts.join(", ")})` : "Open automation jobs";
  const tooltip = unseen
    ? `${unseenCount} ${unseenCount === 1 ? "job" : "jobs"} finished since you last looked${
        unseenFailed ? ", with failures" : ""
      }`
    : running
      ? "Automation jobs are running"
      : "Automation jobs";

  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        className={classNames(
          "jobs-button",
          running && "jobs-button--running",
          unseen && "jobs-button--unseen",
        )}
        onClick={toggleDrawer}
        aria-label={label}
        aria-expanded={drawerOpen}
        aria-controls={drawerOpen ? "jobs-drawer-panel" : undefined}
      >
        {/* Running animates the robot; the only badge is the count of unseen finished jobs. */}
        <Icon icon={iconBot} className="jobs-button__icon" />
        {unseen && (
          <span
            className={classNames(
              "jobs-button__count",
              unseenFailed && "jobs-button__count--danger",
            )}
            aria-hidden="true"
          >
            {unseenCount > 99 ? "99+" : unseenCount}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
