import { useId, useRef, type KeyboardEvent } from "react";

type Orientation = "horizontal" | "vertical";

const STEP_KEYS: Record<Orientation, { previous: string; next: string }> = {
  horizontal: { previous: "ArrowLeft", next: "ArrowRight" },
  vertical: { previous: "ArrowUp", next: "ArrowDown" },
};

/** ARIA tabs with a roving tabindex; arrows wrap, Home and End jump. */
export function useTabList<T extends string>(
  ids: readonly T[],
  active: T,
  onSelect: (id: T) => void,
  orientation: Orientation = "horizontal",
) {
  const idPrefix = useId();
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const tabId = (id: T) => `${idPrefix}-${id}-tab`;
  const panelId = (id: T) => `${idPrefix}-${id}-panel`;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = ids.indexOf(active);
    const { previous, next } = STEP_KEYS[orientation];
    const targets: Record<string, number> = {
      [previous]: index - 1,
      [next]: index + 1,
      Home: 0,
      End: ids.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;

    event.preventDefault();
    const id = ids[(target + ids.length) % ids.length];
    onSelect(id);
    tabRefs.current[id]?.focus();
  };

  return {
    tabListProps: { role: "tablist", "aria-orientation": orientation, onKeyDown } as const,
    tabProps: (id: T) =>
      ({
        ref: (element: HTMLButtonElement | null) => {
          tabRefs.current[id] = element;
        },
        type: "button",
        role: "tab",
        id: tabId(id),
        "aria-selected": id === active,
        "aria-controls": panelId(id),
        tabIndex: id === active ? 0 : -1,
        onClick: () => onSelect(id),
      }) as const,
    panelProps: (id: T) =>
      ({
        role: "tabpanel",
        id: panelId(id),
        "aria-labelledby": tabId(id),
        hidden: id !== active,
      }) as const,
  };
}
