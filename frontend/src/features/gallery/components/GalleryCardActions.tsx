import { useRef, useState, type KeyboardEvent } from "react";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import { iconCheck, iconCopy, iconExpand, iconTrash2, type AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface CardAction {
  id: string;
  label: string;
  icon: AppIcon;
  danger?: boolean;
  copied?: boolean;
  run: () => void;
}

interface GalleryCardActionsProps {
  name: string;
  path: string;
  caption: string | null | undefined;
  displayMode: "large" | "small";
  /** Selecting owns the card click, so only Open stays: it is the one way left to the viewer. */
  selectionMode: boolean;
  onOpen: (path: string) => void;
  onCopyCaptionFailed?: () => void;
  onDelete?: (path: string) => void;
}

/**
 * A sibling of the card button, never inside it: interactive content cannot nest in a button.
 * One tab stop for the whole bar; arrows move between its buttons.
 */
export function GalleryCardActions({
  name,
  path,
  caption,
  displayMode,
  selectionMode,
  onOpen,
  onCopyCaptionFailed,
  onDelete,
}: GalleryCardActionsProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const { copyState, copyLabel, copyText } = useCopyFeedback();

  const actions: CardAction[] = [
    { id: "open", label: "Open", icon: iconExpand, run: () => onOpen(path) },
  ];
  if (!selectionMode && caption) {
    const copied = copyState === "copied";
    actions.push({
      id: "copy",
      label: copied ? copyLabel : "Copy caption",
      icon: copied ? iconCheck : iconCopy,
      copied,
      run: () => {
        void copyText(caption).then((succeeded) => {
          if (!succeeded) onCopyCaptionFailed?.();
        });
      },
    });
  }
  if (!selectionMode && onDelete) {
    actions.push({
      id: "delete",
      label: "Delete",
      icon: iconTrash2,
      danger: true,
      run: () => onDelete(path),
    });
  }
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
        aria-label={`Actions for ${name}`}
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
