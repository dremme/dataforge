import { useMemo, useRef } from "react";
import {
  JOB_TYPE_META,
  SECONDARY_JOB_GROUPS,
  SECONDARY_JOB_TYPES,
  isJobAvailable,
  jobTypeIconFor,
  type JobAvailability,
} from "@/features/jobs/lib/jobMeta";
import type { JobType } from "@/shared/types";
import { MENU_VIEWPORT_GUTTER, useMenuViewportFit } from "@/shared/hooks/useMenuViewportFit";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { iconChevronDown, iconLoader2 } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface AutomationMoreJobsMenuProps {
  disabled: boolean;
  startingJobType: JobType | null;
  /** Folder state; a job the registry calls unavailable is listed but not startable. */
  availability: JobAvailability;
  onRequestStart: (jobType: JobType) => void;
}

export function AutomationMoreJobsMenu({
  disabled,
  startingJobType,
  availability,
  onRequestStart,
}: AutomationMoreJobsMenuProps) {
  const { open, close, menuId, rootRef, triggerProps } = usePopupMenu();
  const menuRef = useRef<HTMLDivElement>(null);

  const secondaryStarting =
    startingJobType !== null && SECONDARY_JOB_TYPES.includes(startingJobType);

  const groups = useMemo(
    () =>
      SECONDARY_JOB_GROUPS.map((group) => ({
        ...group,
        jobs: group.types.map((type) => {
          const meta = JOB_TYPE_META[type] as {
            label: string;
            menuLabel?: string;
            menuDescription?: string;
          };
          return {
            id: type,
            label: meta.menuLabel ?? meta.label,
            description: meta.menuDescription ?? "",
            icon: jobTypeIconFor(type),
            starting: startingJobType === type,
            unavailable: !isJobAvailable(type, availability),
          };
        }),
      })),
    [availability, startingJobType],
  );

  // The menu hangs off the trigger, so the room around it depends on where that
  // trigger happens to be — the specs strip alone shifts it ~80px down, and it
  // sits well left of the window edge. Viewport-relative CSS limits therefore
  // overshoot in both axes, clipping the list below or past the left edge.
  const bounds = useMenuViewportFit(menuRef, open, (node) => {
    // Both edges are pinned by the trigger, so neither moves with the menu's
    // own size and this cannot feed back into itself.
    const { top, right } = node.getBoundingClientRect();
    return {
      maxWidth: Math.max(0, right - MENU_VIEWPORT_GUTTER),
      maxHeight: Math.max(0, window.innerHeight - top - MENU_VIEWPORT_GUTTER),
    };
  });

  const handleSelect = (jobType: JobType, starting: boolean, unavailable: boolean) => {
    if (disabled || starting || unavailable) return;
    close();
    onRequestStart(jobType);
  };

  return (
    <div ref={rootRef} className={classNames("automation__more", open && "automation__more--open")}>
      <button type="button" className="automation__more-trigger" {...triggerProps}>
        {secondaryStarting ? (
          <Icon icon={iconLoader2} className="automation__btn-icon automation__btn-icon--spin" />
        ) : null}
        More
        {!secondaryStarting && (
          <Icon icon={iconChevronDown} className="automation__more-trigger-chevron" />
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="automation__more-menu"
          style={bounds}
          role="menu"
          aria-label="More jobs"
        >
          {groups.map((group) => (
            <div
              key={group.id}
              className="automation__more-group"
              role="group"
              aria-label={group.label}
            >
              {/* The group role already carries the label, so this copy is decorative. */}
              <div className="automation__more-group-label" aria-hidden="true">
                {group.label}
              </div>
              {group.jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  role="menuitem"
                  className="automation__more-item"
                  onClick={() => handleSelect(job.id, job.starting, job.unavailable)}
                  disabled={disabled || job.starting || job.unavailable}
                >
                  <Icon icon={job.icon} className="automation__more-item-icon" />
                  <span className="automation__more-item-text">
                    <span className="automation__more-item-title">{job.label}</span>
                    <span className="automation__more-item-desc">{job.description}</span>
                  </span>
                  {job.starting && (
                    <Icon
                      icon={iconLoader2}
                      className="automation__more-item-spinner automation__btn-icon--spin"
                    />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
