import { Fragment, type ReactNode } from "react";
import {
  iconArrowDown,
  iconArrowLeft,
  iconArrowRight,
  iconArrowUp,
  type AppIcon,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { formatChord, formatShortcut, type ShortcutDefinition } from "@/shared/lib/shortcuts";

// The arrow glyphs fall back to different fonts, so ← → never match ↑ ↓ in weight or size.
const KEY_ICONS: Record<string, AppIcon> = {
  "↑": iconArrowUp,
  "↓": iconArrowDown,
  "←": iconArrowLeft,
  "→": iconArrowRight,
};

export function KeyCap({ label }: { label: string }) {
  const icon = KEY_ICONS[label];
  return <kbd className="kbd">{icon ? <Icon icon={icon} className="kbd__icon" /> : label}</kbd>;
}

interface ShortcutKeysProps {
  shortcut: ShortcutDefinition;
  className?: string;
  /** Read the keys out; otherwise the owning control names them through `aria-keyshortcuts`. */
  announce?: boolean;
}

export function ShortcutKeys({ shortcut, className, announce = false }: ShortcutKeysProps) {
  return (
    <span className={classNames("shortcut-keys", className)}>
      <span className="shortcut-keys__visual" aria-hidden="true">
        {shortcut.chords.map((chord, chordIndex) => (
          <Fragment key={chordIndex}>
            {chordIndex > 0 && <span className="shortcut-keys__or">/</span>}
            <span className="shortcut-keys__chord">
              {formatChord(chord).map((part, partIndex) => (
                <KeyCap key={partIndex} label={part} />
              ))}
            </span>
          </Fragment>
        ))}
      </span>
      {announce && <span className="shortcut-keys__text">{formatShortcut(shortcut)}</span>}
    </span>
  );
}

interface ShortcutHintProps {
  shortcut: ShortcutDefinition;
  children: ReactNode;
}

export function ShortcutHint({ shortcut, children }: ShortcutHintProps) {
  return (
    <span className="shortcut-hint">
      {children}
      <ShortcutKeys shortcut={shortcut} className="shortcut-hint__keys" />
    </span>
  );
}
