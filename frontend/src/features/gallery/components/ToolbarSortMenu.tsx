import { useId, type ReactNode } from "react";
import { DEFAULT_SORT, sortOptionLabel, type SortOption } from "@/features/gallery/lib/query";
import { SORT_FIELDS, sortDirectionIcon, sortFieldOf } from "@/features/gallery/lib/sortMenu";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import type { AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface ToolbarSortMenuProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

function SortMenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div className="toolbar__sort-menu-group" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="toolbar__sort-menu-group-label">
        {label}
      </span>
      {children}
    </div>
  );
}

function SortMenuOption({
  icon,
  label,
  checked,
  onPick,
}: {
  icon: AppIcon;
  label: string;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className={classNames(
        "toolbar__sort-menu-option",
        checked && "toolbar__sort-menu-option--active",
      )}
      onClick={onPick}
    >
      <Icon icon={icon} className="toolbar__sort-menu-option-icon" />
      <span className="toolbar__sort-menu-option-label">{label}</span>
    </button>
  );
}

/**
 * An icon, not a dropdown: a select is as wide as its longest order. The icon shows the
 * direction; the menu picks a field, then one of that field's two directions.
 */
export function ToolbarSortMenu({ value, onChange }: ToolbarSortMenuProps) {
  const { open, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();
  const current = sortFieldOf(value);

  return (
    <div
      ref={rootRef}
      className={classNames("toolbar__sort-menu", open && "toolbar__sort-menu--open")}
    >
      <Tooltip content={`Sorted by ${sortOptionLabel(value)}`}>
        <button
          type="button"
          className={classNames(
            "toolbar__sort-menu-trigger",
            value !== DEFAULT_SORT && "toolbar__sort-menu-trigger--sorted",
          )}
          aria-label="Sort media"
          {...triggerProps}
        >
          <Icon icon={sortDirectionIcon(value)} className="toolbar__sort-menu-trigger-icon" />
        </button>
      </Tooltip>

      {/* Stays open like the filter menu, so a field and then its direction take two clicks. */}
      <AnchoredLayer
        anchorRef={rootRef}
        floatingRef={panelRef}
        open={open}
        id={menuId}
        className="toolbar__sort-menu-panel"
        role="menu"
        label="Sort"
      >
        <SortMenuGroup label="Sort by">
          {SORT_FIELDS.map((field) => (
            <SortMenuOption
              key={field.label}
              icon={field.icon}
              label={field.label}
              checked={field === current}
              onPick={() => {
                if (field !== current) onChange(field.orders[0].value);
              }}
            />
          ))}
        </SortMenuGroup>
        <SortMenuGroup label="Order">
          {current.orders.map((order) => (
            <SortMenuOption
              key={order.value}
              icon={sortDirectionIcon(order.value)}
              label={order.label}
              checked={order.value === value}
              onPick={() => onChange(order.value)}
            />
          ))}
        </SortMenuGroup>
      </AnchoredLayer>
    </div>
  );
}
