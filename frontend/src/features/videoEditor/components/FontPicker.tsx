import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { iconCheck, iconChevronDown, iconSearch, iconTriangleAlert } from "@/shared/icons";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { classNames } from "@/shared/lib/classNames";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { Icon } from "@/shared/ui/Icon";
import type { VideoProjectFont, VideoProjectFontFamily } from "@/shared/types";
import { useFontFamilies } from "@/features/videoEditor/hooks/useFontFamilies";
import { useChanged } from "@/shared/hooks/useChanged";

const DEFAULT_LABEL = "Default";

interface FontPickerProps {
  value: VideoProjectFont | null;
  onChange: (font: VideoProjectFont | null) => void;
}

/** The browser draws each name in its own face when the font is installed where it runs too. */
function familyStyle(family: string | null): CSSProperties | undefined {
  return family ? { fontFamily: `"${family.replace(/"/g, "")}", sans-serif` } : undefined;
}

/** Keeps the style across a family change when the new family has it, else its first style. */
function styleIn(family: VideoProjectFontFamily, wanted: string | undefined): string {
  if (wanted && family.styles.includes(wanted)) return wanted;
  return family.styles.includes("Regular") ? "Regular" : (family.styles[0] ?? "Regular");
}

/** A family and its style, chosen from the fonts installed on the machine that renders. */
export function FontPicker({ value, onChange }: FontPickerProps) {
  const query = useFontFamilies();
  const families = useMemo(() => query.data ?? [], [query.data]);
  const current = value
    ? families.find((item) => item.family.toLowerCase() === value.family.toLowerCase())
    : undefined;
  const missing = value !== null && query.isSuccess && !current;
  const styleId = useId();

  return (
    <div className="video-editor__font">
      <div className="video-editor__font-row">
        <FamilyMenu
          families={families}
          loading={query.isPending}
          value={value?.family ?? null}
          onPick={(family) =>
            onChange(
              family ? { family: family.family, style: styleIn(family, value?.style) } : null,
            )
          }
        />
        {value && current && current.styles.length > 1 && (
          <select
            id={styleId}
            className="video-editor__font-style"
            aria-label="Font style"
            value={styleIn(current, value.style)}
            onChange={(event) => onChange({ family: current.family, style: event.target.value })}
          >
            {current.styles.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </select>
        )}
      </div>
      {missing && (
        <p className="video-editor__font-missing">
          <Icon icon={iconTriangleAlert} /> {value.family} is not installed here, so the title is
          drawn in the default font.
        </p>
      )}
    </div>
  );
}

function FamilyMenu({
  families,
  loading,
  value,
  onPick,
}: {
  families: VideoProjectFontFamily[];
  loading: boolean;
  value: string | null;
  onPick: (family: VideoProjectFontFamily | null) => void;
}) {
  const { open, close, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const needle = search.trim().toLowerCase();
  const options: (VideoProjectFontFamily | null)[] = [
    ...(needle ? [] : [null]),
    ...families.filter((family) => family.family.toLowerCase().includes(needle)),
  ];

  // Opens on the chosen family, scrolled into view, with the search ready for typing. Only on
  // opening: a list refreshing while open must not move the cursor.
  if (useChanged(open) && open) {
    setSearch("");
    const index = value
      ? families.findIndex((family) => family.family.toLowerCase() === value.toLowerCase()) + 1
      : 0;
    setActive(Math.max(0, index));
  }
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const pick = (family: VideoProjectFontFamily | null) => {
    onPick(family);
    close();
  };

  return (
    <div ref={rootRef} className="video-editor__font-menu">
      <button
        type="button"
        className="video-editor__font-trigger"
        aria-label={`Font: ${value ?? DEFAULT_LABEL}`}
        {...triggerProps}
        aria-haspopup="dialog"
      >
        <span className="video-editor__font-name" style={familyStyle(value)}>
          {value ?? DEFAULT_LABEL}
        </span>
        <Icon icon={iconChevronDown} />
      </button>
      <AnchoredLayer
        anchorRef={rootRef}
        floatingRef={panelRef}
        open={open}
        id={menuId}
        className="video-editor__font-panel"
        role="dialog"
        label="Choose a font"
        placement="bottom-start"
      >
        <label className="video-editor__search">
          <Icon icon={iconSearch} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search fonts"
            aria-label="Search fonts"
            aria-controls={listId}
            aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive((index) => Math.min(options.length - 1, Math.max(0, index + step)));
              } else if (event.key === "Enter" && options.length > 0) {
                event.preventDefault();
                pick(options[Math.min(active, options.length - 1)]);
              }
            }}
          />
        </label>
        <ul
          ref={listRef}
          id={listId}
          className="video-editor__font-list"
          role="listbox"
          aria-label="Fonts"
        >
          {options.map((family, index) => {
            const name = family?.family ?? null;
            const chosen = (name ?? "").toLowerCase() === (value ?? "").toLowerCase();
            return (
              <li
                key={name ?? ""}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={chosen}
                className={classNames(
                  "video-editor__font-option",
                  index === active && "video-editor__font-option--active",
                )}
                onPointerMove={() => setActive(index)}
                onClick={() => pick(family)}
              >
                <span className="video-editor__font-check" aria-hidden="true">
                  {chosen && <Icon icon={iconCheck} />}
                </span>
                <span className="video-editor__font-label" style={familyStyle(name)}>
                  {name ?? `${DEFAULT_LABEL} font`}
                </span>
                {family && family.styles.length > 1 && (
                  <span className="video-editor__font-count">{family.styles.length}</span>
                )}
              </li>
            );
          })}
          {options.length === 0 && (
            <li className="video-editor__font-empty" role="presentation">
              {loading ? "Reading the installed fonts..." : "No installed font matches."}
            </li>
          )}
        </ul>
      </AnchoredLayer>
    </div>
  );
}
