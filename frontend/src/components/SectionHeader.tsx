import type { ReactNode } from "react";
import type { AppIcon } from "../icons";
import { Icon } from "./Icon";

interface SectionHeaderProps {
  section: "folder" | "gallery";
  icon: AppIcon;
  title: string;
  count: number;
  loading?: boolean;
  actions?: ReactNode;
}

export function SectionHeader({
  section,
  icon,
  title,
  count,
  loading = false,
  actions,
}: SectionHeaderProps) {
  return (
    <div className={`${section}-section__header`}>
      <h2 className={`${section}-section__title`}>
        <Icon icon={icon} className="section-title__icon" />
        {title}
      </h2>
      {loading ? (
        <span className="section-header__count-skeleton skeleton-shimmer" aria-hidden="true" />
      ) : (
        <span className={`${section}-section__count`}>{count}</span>
      )}
      {actions}
    </div>
  );
}
