import { useRef, useState, type KeyboardEvent } from "react";
import { CARD_ACTIONS, cardActionsFor } from "@/features/gallery/lib/cardActions";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import { iconCheck, type AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type { GalleryCardAction, GalleryItem } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface CardAction {
  id: GalleryCardAction;
  label: string;
  icon: AppIcon;
  danger?: boolean;
  copied?: boolean;
  run: () => void;
}

interface GalleryCardActionsProps {
  item: GalleryItem;
  displayMode: "large" | "small";
  selectionMode: boolean;
  cardActions: readonly GalleryCardAction[];
  onOpen: (path: string) => void;
  onCopyCaptionFailed?: () => void;
  /** Everything but Open and Copy caption, which stay hidden without it. */
  onAction?: (action: GalleryCardAction, item: GalleryItem) => void;
}

/**
 * A sibling of the card button, never inside it: interactive content cannot nest in a button.
 * One tab stop for the whole bar; arrows move between its buttons.
 */
export function GalleryCardActions({
  item,
  displayMode,
  selectionMode,
  cardActions,
  onOpen,
  onCopyCaptionFailed,
  onAction,
}: GalleryCardActionsProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const { copyState, copyLabel, copyText } = useCopyFeedback();

  const actions: CardAction[] = [];
  for (const id of cardActionsFor(item, cardActions, selectionMode)) {
    const { label, icon, danger } = CARD_ACTIONS[id];
    if (id === "open") {
      actions.push({ id, label, icon, run: () => onOpen(item.path) });
    } else if (id === "copy_caption") {
      const copied = copyState === "copied";
      actions.push({
        id,
        label: copied ? copyLabel : label,
        icon: copied ? iconCheck : icon,
        copied,
        run: () => {
          void copyText(item.description ?? "").then((succeeded) => {
            if (!succeeded) onCopyCaptionFailed?.();
          });
        },
      });
    } else if (onAction) {
      actions.push({ id, label, icon, danger, run: () => onAction(id, item) });
    }
  }

  if (actions.length === 0) return null;

  const current = Math.min(active, actions.length - 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const targets: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: actions.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;

    event.preventDefault();
    const next = (target + actions.length) % actions.length;
    setActive(next);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div className={classNames("card-actions", `card-actions--${displayMode}`)}>
      <div
        className="card-actions__bar"
        role="toolbar"
        aria-label={`Actions for ${item.name}`}
        onKeyDown={handleKeyDown}
      >
        {actions.map((action, index) => (
          <Tooltip key={action.id} content={action.label} placement="top">
            <button
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              type="button"
              className={classNames(
                "card-actions__button",
                action.danger && "card-actions__button--danger",
                action.copied && "card-actions__button--copied",
              )}
              aria-label={action.label}
              tabIndex={index === current ? 0 : -1}
              onFocus={() => setActive(index)}
              onClick={action.run}
            >
              <Icon icon={action.icon} />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
