import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { iconSearch } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { findSearchMatchRanges } from "@/shared/lib/searchMatchRanges";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import { touchRecentAction } from "../lib/quickActionHistory";
import {
  flattenGroups,
  rankQuickActionItems,
  recentActionsGroup,
  withUniqueIds,
} from "../lib/quickActionResults";
import type { QuickActionItem } from "../types";

interface QuickActionBarProps {
  items: QuickActionItem[];
  recentItems: QuickActionItem[];
  onClose: () => void;
}

function HighlightedLabel({ text, query }: { text: string; query: string }) {
  const ranges = findSearchMatchRanges(text, query, false);
  if (ranges.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.from > cursor) parts.push(text.slice(cursor, range.from));
    parts.push(
      <mark key={index} className="quick-action__match">
        {text.slice(range.from, range.to)}
      </mark>,
    );
    cursor = range.to;
  });

  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
}

export function QuickActionBar({ items, recentItems, onClose }: QuickActionBarProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const trimmed = query.trim();
    const built = trimmed ? rankQuickActionItems(items, query) : recentActionsGroup(recentItems);
    return withUniqueIds(built);
  }, [items, query, recentItems]);

  const rows = useMemo(() => flattenGroups(groups), [groups]);
  const selectable = useMemo(() => rows.filter((item) => !item.disabled), [rows]);

  // Track by id so a jobs refresh cannot leave the highlight on whichever row slid into its slot.
  const [activeId, setActiveId] = useState<string | null>(null);

  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setActiveId(null);
  }

  const activeIndex = selectable.findIndex((item) => item.id === activeId);
  const active = activeIndex >= 0 ? selectable[activeIndex] : (selectable[0] ?? null);

  const activeRowIndex = active ? rows.indexOf(active) : -1;
  const activeDomId = activeRowIndex >= 0 ? `${listId}-option-${activeRowIndex}` : undefined;

  useEffect(() => {
    activeRowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeDomId]);

  const move = (delta: number) => {
    if (selectable.length === 0) return;

    const base = activeIndex >= 0 ? activeIndex : 0;
    const next = (base + delta + selectable.length) % selectable.length;
    setActiveId(selectable[next].id);
  };

  // Ignore mousemove with unchanged coordinates; arrowing scrolls the list under a stationary cursor.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const handleRowPointerMove = (event: MouseEvent<HTMLDivElement>, item: QuickActionItem) => {
    const last = pointerRef.current;
    if (last && last.x === event.clientX && last.y === event.clientY) return;

    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (!item.disabled) setActiveId(item.id);
  };

  const runItem = (item: QuickActionItem) => {
    if (item.disabled) return;

    touchRecentAction(item.id);
    onClose();
    item.run();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        if (selectable.length > 0) {
          event.preventDefault();
          setActiveId(selectable[0].id);
        }
        break;
      case "End":
        if (selectable.length > 0) {
          event.preventDefault();
          setActiveId(selectable[selectable.length - 1].id);
        }
        break;
      case "Enter":
        if (active) {
          event.preventDefault();
          runItem(active);
        }
        break;
      default:
        break;
    }
  };

  let rowIndex = -1;

  return (
    <ModalShell
      block="quick-action"
      label="Quick actions"
      onClose={onClose}
      scrollLock="quick-action-open"
      backdropLabel="Close quick actions"
      initialFocusRef={inputRef}
    >
      <div className="quick-action__search">
        <Icon icon={iconSearch} className="quick-action__search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="quick-action__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search jobs, actions, and folders"
          aria-label="Search jobs, actions, and folders"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeDomId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div
        id={listId}
        className="quick-action__results"
        role="listbox"
        aria-label="Quick action results"
      >
        {groups.map((group) => (
          <div key={group.id} className="quick-action__group" role="group" aria-label={group.label}>
            <div className="quick-action__group-label" aria-hidden="true">
              {group.label}
            </div>

            {group.items.map((item) => {
              rowIndex += 1;
              const isActive = item === active;

              return (
                <div
                  key={item.id}
                  ref={isActive ? activeRowRef : undefined}
                  id={`${listId}-option-${rowIndex}`}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={item.disabled || undefined}
                  className={classNames(
                    "quick-action__option",
                    item.disabled && "quick-action__option--disabled",
                  )}
                  title={item.detail}
                  onMouseMove={(event) => handleRowPointerMove(event, item)}
                  onClick={() => runItem(item)}
                >
                  <Icon icon={item.icon} className="quick-action__option-icon" />
                  <span className="quick-action__option-text">
                    <span className="quick-action__option-label">
                      <HighlightedLabel text={item.label} query={query} />
                    </span>
                    {item.detail && (
                      <span className="quick-action__option-detail">{item.detail}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {rows.length === 0 && (
          <p className="quick-action__empty" role="status">
            No matches
          </p>
        )}
      </div>

      <footer className="quick-action__hint" aria-hidden="true">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> select
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
      </footer>
    </ModalShell>
  );
}
