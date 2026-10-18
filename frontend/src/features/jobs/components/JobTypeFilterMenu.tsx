import type { KeyboardEvent } from "react";
import { JOB_TYPE_FILTER_OPTIONS, toggleJobType } from "@/features/jobs/lib/jobFilters";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { iconCheck, iconChevronDown } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type { JobType } from "@/shared/types";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { Icon } from "@/shared/ui/Icon";

interface JobTypeFilterMenuProps {
  /** Empty means every type. */
  value: JobType[];
  onChange: (value: JobType[]) => void;
}

function summaryFor(value: readonly JobType[]): string {
  if (value.length === 0) return "All types";
  if (value.length > 1) return `${value.length} types`;
  return JOB_TYPE_FILTER_OPTIONS.find((option) => option.value === value[0])?.title ?? value[0];
}

interface OptionProps {
  checked: boolean;
  title: string;
  onClick: () => void;
}

function TypeOption({ checked, title, onClick }: OptionProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={classNames(
        "jobs-modal__type-option",
        checked && "jobs-modal__type-option--checked",
      )}
      onClick={onClick}
    >
      <Icon icon={iconCheck} className="jobs-modal__type-option-check" />
      {title}
    </button>
  );
}

/** Multi-select type filter; stays open on pick so several types can be toggled in a row. */
export function JobTypeFilterMenu({ value, onChange }: JobTypeFilterMenuProps) {
  const { open, close, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();
  const summary = summaryFor(value);

  // The drawer closes on a window-level Escape too; stopping it here closes only the menu.
  // Portalled panel events still bubble through this element in the React tree.
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open || event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };

  return (
    <div ref={rootRef} className="jobs-modal__type" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={classNames(
          "jobs-modal__type-trigger",
          value.length > 0 && "jobs-modal__type-trigger--active",
        )}
        aria-label={`Type: ${summary}`}
        {...triggerProps}
      >
        <span className="jobs-modal__type-trigger-label">{summary}</span>
        <Icon icon={iconChevronDown} className="jobs-modal__type-trigger-icon" />
      </button>

      <AnchoredLayer
        anchorRef={rootRef}
        floatingRef={panelRef}
        open={open}
        id={menuId}
        className="jobs-modal__type-panel"
        placement="bottom-start"
        role="menu"
        label="Job types"
      >
        <TypeOption checked={value.length === 0} title="All types" onClick={() => onChange([])} />
        <div className="jobs-modal__type-divider" role="separator" />
        {JOB_TYPE_FILTER_OPTIONS.map((option) => (
          <TypeOption
            key={option.value}
            checked={value.includes(option.value)}
            title={option.title}
            onClick={() => onChange(toggleJobType(value, option.value))}
          />
        ))}
      </AnchoredLayer>
    </div>
  );
}
