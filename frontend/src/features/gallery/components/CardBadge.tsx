import type { AppIcon } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

type CardBadgeVariant = "video" | "gif" | "json" | "issue";

interface CardBadgeProps {
  icon: AppIcon;
  label: string;
  variant: CardBadgeVariant;
}

export function CardBadge({ icon, label, variant }: CardBadgeProps) {
  return (
    <span className={`card__badge card__badge--${variant}`} aria-hidden="true">
      <Icon icon={icon} className="card__badge-icon" />
      {label}
    </span>
  );
}
