import { useRef, type ReactNode } from "react";
import { useStickyFloating } from "@/shared/hooks/useStickyFloating";
import type { AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "./Icon";

interface SectionHeaderProps {
  section: "folder" | "gallery";
  icon: AppIcon;
  title: string;
  count: number;
  /**
   * Marks what `count` is counting, for slots whose meaning changes with mode —
   * the gallery's flips between "items the filters left" and "items selected".
   * Decorative: the `aria-label` already spells the pair out.
   */
  countIcon?: AppIcon;
  /**
   * The set `count` is measured against; rendered next to it only while the two
   * differ. Whose size that is belongs to the call site — the gallery hands over
   * the folder normally and the filtered view while selecting.
   */
  total?: number;
  /** Keeps the total visible even when it equals `count`, e.g. selection progress. */
  alwaysShowTotal?: boolean;
  loading?: boolean;
  /** Docks the header below the automation panel while its section scrolls past. */
  sticky?: boolean;
  actions?: ReactNode;
}

export function SectionHeader({
  section,
  icon,
  title,
  count,
  countIcon,
  total,
  alwaysShowTotal = false,
  loading = false,
  sticky = false,
  actions,
}: SectionHeaderProps) {
  const showTotal = total !== undefined && (alwaysShowTotal || total !== count);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // `sticky` is fixed per call site, so the refs are populated before effects run.
  const floating = useStickyFloating(stickySentinelRef, headerRef);

  return (
    <>
      {sticky && <div ref={stickySentinelRef} className="sticky-sentinel" aria-hidden="true" />}
      <div
        ref={headerRef}
        className={classNames(
          `${section}-section__header`,
          sticky && `${section}-section__header--sticky`,
          floating && `${section}-section__header--floating`,
        )}
      >
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
            {countIcon && <Icon icon={countIcon} className="section-header__count-icon" />}
            {count}
            {showTotal && (
              <>
                <span className="section-header__count-divider">/</span>
                <span className="section-header__count-total">{total}</span>
              </>
            )}
          </span>
        )}
        {actions}
      </div>
    </>
  );
}
