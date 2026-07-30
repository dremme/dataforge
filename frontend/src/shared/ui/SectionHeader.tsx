import type { ReactNode } from "react";
import type { AppIcon } from "@/shared/icons";
import { Icon } from "./Icon";

interface SectionHeaderProps {
  section: "folder" | "gallery";
  icon: AppIcon;
  title: string;
  count: number;
  /** Unfiltered size of the section; rendered next to `count` only while it differs. */
  total?: number;
  /** Keeps the total visible even when it equals `count`, e.g. selection progress. */
  alwaysShowTotal?: boolean;
  loading?: boolean;
  /** Small status indicator shown after the count, before the actions. */
  badge?: ReactNode;
  actions?: ReactNode;
}

export function SectionHeader({
  section,
  icon,
  title,
  count,
  total,
  alwaysShowTotal = false,
  loading = false,
  badge,
  actions,
}: SectionHeaderProps) {
  const showTotal = total !== undefined && (alwaysShowTotal || total !== count);

  return (
    <div className={`${section}-section__header`}>
      <h2 className={`${section}-section__title`}>
        <Icon icon={icon} className="section-title__icon" />
        {title}
      </h2>
      {loading ? (
        <span className="section-header__count-skeleton skeleton-shimmer" aria-hidden="true" />
      ) : (
        <span
          className={`${section}-section__count`}
          // "3 / 12" reads as "three slash twelve" without this.
          aria-label={showTotal ? `${count} of ${total}` : undefined}
        >
          {count}
          {showTotal && (
            <>
              <span className="section-header__count-divider">/</span>
              <span className="section-header__count-total">{total}</span>
            </>
          )}
        </span>
      )}
      {badge}
      {actions}
    </div>
  );
}
