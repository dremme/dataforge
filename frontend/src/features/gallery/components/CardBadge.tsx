import type { AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

type CardBadgeVariant = "video" | "gif" | "issue" | "duplicate" | "candidate";

interface CardBadgeProps {
  icon: AppIcon;
  compact: boolean;
  label: string;
  variant: CardBadgeVariant;
}

export function CardBadge({ icon, compact, label, variant }: CardBadgeProps) {
  return (
    <span
      className={classNames(
        "card__badge",
        `card__badge--${variant}`,
        compact && "card__badge--compact",
      )}
      aria-hidden="true"
    >
      <Icon icon={icon} className="card__badge-icon" />
      {!compact && <span className="card__badge-label">{label}</span>}
    </span>
  );
}
