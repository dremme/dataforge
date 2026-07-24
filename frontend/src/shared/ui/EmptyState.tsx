import type { AppIcon } from "@/shared/icons";
import { Icon } from "./Icon";

interface EmptyStateProps {
  icon: AppIcon;
  title: string;
  description: string;
  variant?: "default" | "success" | "muted" | "error";
  role?: "alert" | "status";
}

export function EmptyState({
  icon,
  title,
  description,
  variant = "default",
  role,
}: EmptyStateProps) {
  return (
    <div className={`empty-state empty-state--${variant}`} role={role}>
      <div className="empty-state__icon-wrap" aria-hidden="true">
        <Icon icon={icon} className="empty-state__icon" />
      </div>
      <h2 className="empty-state__title">{title}</h2>
      <p className="empty-state__description">{description}</p>
    </div>
  );
}
