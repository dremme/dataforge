import type { AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

type CardBadgeVariant = "video" | "audio" | "gif" | "issue" | "duplicate" | "candidate";

interface CardBadgeProps {
  icon: AppIcon;
  compact: boolean;
  label: string;
  variant: CardBadgeVariant;
  /** A measurement such as `12 s`, kept in its own case instead of the badge's capitals. */
  numeric?: boolean;
}

export function CardBadge({ icon, compact, label, variant, numeric = false }: CardBadgeProps) {
  return (
    <span
      className={classNames(
        "card__badge",
        `card__badge--${variant}`,
        compact && "card__badge--compact",
        numeric && "card__badge--numeric",
      )}
      aria-hidden="true"
    >
      <Icon icon={icon} className="card__badge-icon" />
      {!compact && <span className="card__badge-label">{label}</span>}
    </span>
  );
}
