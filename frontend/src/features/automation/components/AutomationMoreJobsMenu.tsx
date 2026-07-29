import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { JOB_TYPE_META, SECONDARY_JOB_TYPES, jobTypeIconFor } from "@/features/jobs/lib/jobMeta";
import type { JobType } from "@/shared/types";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { iconChevronDown, iconLoader2 } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface AutomationMoreJobsMenuProps {
  disabled: boolean;
  startingJobType: JobType | null;
  onRequestStart: (jobType: JobType) => void;
}

export function AutomationMoreJobsMenu({
  disabled,
  startingJobType,
  onRequestStart,
}: AutomationMoreJobsMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const secondaryStarting =
    startingJobType !== null && SECONDARY_JOB_TYPES.includes(startingJobType);

  const close = useCallback(() => setOpen(false), []);

  const jobs = useMemo(
    () =>
      SECONDARY_JOB_TYPES.map((type) => {
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
        };
      }),
    [startingJobType],
  );

  useEscapeKey(close, open);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [close, open]);

  const handleSelect = (jobType: JobType, starting: boolean) => {
    if (disabled || starting) return;
    close();
    onRequestStart(jobType);
  };

  return (
    <div ref={rootRef} className={classNames("automation__more", open && "automation__more--open")}>
      <button
        type="button"
        className="automation__more-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        {secondaryStarting ? (
          <Icon icon={iconLoader2} className="automation__btn-icon automation__btn-icon--spin" />
        ) : null}
        More
        {!secondaryStarting && (
          <Icon icon={iconChevronDown} className="automation__more-trigger-chevron" />
        )}
      </button>

      {open && (
        <div id={menuId} className="automation__more-menu" role="menu" aria-label="More jobs">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              role="menuitem"
              className="automation__more-item"
              onClick={() => handleSelect(job.id, job.starting)}
              disabled={disabled || job.starting}
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
      )}
    </div>
  );
}
