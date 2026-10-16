import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { iconChevronDown, iconRotateCcw, type AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import { Icon } from "@/shared/ui/Icon";
import { rangeFill } from "@/features/videoEditor/lib/rangeFill";
import type { Clip } from "@/features/videoEditor/lib/timeline";

const SECTIONS_KEY = "video-editor-inspector-sections";

/** Collapsed or open per section title, remembered across clips and sessions. */
const SectionContext = createContext<{
  isOpen: (title: string, fallback: boolean) => boolean;
  toggle: (title: string, fallback: boolean) => void;
}>({ isOpen: (_title, fallback) => fallback, toggle: () => undefined });

function parseSections(value: unknown): Record<string, boolean> | null {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

export function SectionMemory({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<Record<string, boolean>>(() =>
    readStoredJson(SECTIONS_KEY, parseSections, {}),
  );
  useEffect(() => writeStoredJson(SECTIONS_KEY, sections), [sections]);
  const isOpen = useCallback(
    (title: string, fallback: boolean) => sections[title] ?? fallback,
    [sections],
  );
  const toggle = useCallback((title: string, fallback: boolean) => {
    setSections((current) => ({ ...current, [title]: !(current[title] ?? fallback) }));
  }, []);
  return <SectionContext.Provider value={{ isOpen, toggle }}>{children}</SectionContext.Provider>;
}

export function InspectorHeader({
  icon,
  kind,
  title,
  meta,
  detail,
  action,
}: {
  icon: AppIcon;
  kind: Clip["kind"] | "dissolve" | "multiple";
  title: string;
  meta: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <header
      className={classNames("video-editor__clip-header", `video-editor__clip-header--${kind}`)}
    >
      <span className="video-editor__clip-icon" aria-hidden="true">
        <Icon icon={icon} />
      </span>
      <div className="video-editor__clip-heading">
        <h3 className="video-editor__clip-title" title={title}>
          {title}
        </h3>
        <p className="video-editor__clip-meta">{meta}</p>
        {detail && (
          <p className="video-editor__clip-meta" title={detail}>
            {detail}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

/** A collapsible group; a dot marks one that holds changes while it is folded away. */
export function Panel({
  title,
  action,
  changed = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  action?: ReactNode;
  changed?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { isOpen, toggle } = useContext(SectionContext);
  const open = isOpen(title, defaultOpen);
  const bodyId = useId();
  return (
    <section className={classNames("video-editor__section", open && "video-editor__section--open")}>
      <header className="video-editor__section-header">
        <button
          type="button"
          className="video-editor__section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => toggle(title, defaultOpen)}
        >
          <Icon icon={iconChevronDown} className="video-editor__section-chevron" />
          <h3 className="video-editor__section-title">{title}</h3>
          {changed && (
            <span className="video-editor__section-changed" title="Changed from the default" />
          )}
        </button>
        {action}
      </header>
      {open && (
        <div id={bodyId} className="video-editor__section-body">
          {children}
        </div>
      )}
    </section>
  );
}

export function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="video-editor__icon-btn"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon icon={iconRotateCcw} />
    </button>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number, final: boolean) => void;
  /** The untouched value: the fill grows from it, and double-clicking the label returns to it. */
  resting?: number;
}

/**
 * Previews while dragged; the release, or a key, records one undo step. Only a moved slider
 * commits: the input reports its value rounded to ``step``, so settling an untouched one would
 * round the clip's value, e.g. on the key-up of the Ctrl+Z that undid it, and clear redo.
 */
export function Slider({ label, value, min, max, step, format, onChange, resting }: SliderProps) {
  const id = useId();
  const movedRef = useRef(false);
  const settle = (event: { currentTarget: HTMLInputElement }) => {
    if (!movedRef.current) return;
    movedRef.current = false;
    onChange(Number(event.currentTarget.value), true);
  };
  const clamped = Math.min(max, Math.max(min, value));
  const changed = resting !== undefined && Math.abs(clamped - resting) > step / 2;
  const origin = resting !== undefined && resting >= min && resting <= max ? resting : min;
  return (
    <div className={classNames("video-editor__slider", changed && "video-editor__slider--changed")}>
      <label
        htmlFor={id}
        title={resting !== undefined ? "Double-click to reset" : undefined}
        onDoubleClick={() => {
          if (resting !== undefined && changed) onChange(resting, true);
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        style={rangeFill(clamped, min, max, origin)}
        onChange={(event) => {
          movedRef.current = true;
          onChange(Number(event.target.value), false);
        }}
        onPointerUp={settle}
        onKeyUp={settle}
        onBlur={settle}
      />
      <output htmlFor={id}>{format(clamped)}</output>
    </div>
  );
}
