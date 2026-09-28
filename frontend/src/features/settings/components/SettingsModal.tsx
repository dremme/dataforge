import { useEffect, useState } from "react";
import { formatApiError, isAbortError } from "@/shared/api/http";
import { useTabList } from "@/shared/hooks/useTabList";
import {
  iconBrain,
  iconAiToolkit,
  iconComfyUi,
  iconGauge,
  iconHardDrive,
  iconLink,
  iconLoader2,
  iconPalette,
  iconPlug,
  iconSettings,
  iconX,
  type AppIcon,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import {
  previewThemePreference,
  setThemePreference,
  useThemePreference,
} from "@/shared/theme/theme";
import type { AppSettingKey, AppSettingsResponse } from "@/shared/types";
import { DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import { fetchAppSettings, saveAppSettings } from "../api/settings";
import {
  buildSettingsUpdate,
  draftFromSettings,
  editDraftValue,
  editedSettingKeys,
  resetDraftValue,
  type SettingsDraft,
} from "../lib/settingsForm";
import { SettingInput } from "./SettingInput";
import { SettingsGroup } from "./SettingsGroup";
import { StorageSection } from "./StorageSection";
import { ThemePicker } from "./ThemePicker";

type SectionId = "appearance" | "vision" | "integrations" | "storage";

interface Group {
  title: string;
  icon: AppIcon;
  hint?: string;
  /** Fields in layout order; a row of two sits side by side. */
  rows: AppSettingKey[][];
}

interface Section {
  id: SectionId;
  label: string;
  caption: string;
  icon: AppIcon;
  description: string;
  groups: Group[];
}

const SECTIONS: Section[] = [
  {
    id: "appearance",
    label: "Appearance",
    caption: "Color scheme",
    icon: iconPalette,
    description: "Pick a color scheme, or let DataForge follow the one your system uses.",
    groups: [],
  },
  {
    id: "vision",
    label: "Vision model",
    caption: "Captioning server",
    icon: iconBrain,
    description:
      "The OpenAI-compatible server behind Auto-caption, Verify captions, and Edit captions.",
    groups: [
      {
        title: "Connection",
        icon: iconLink,
        hint: "A running job keeps the server it started with.",
        rows: [["vision_base_url"], ["vision_model"]],
      },
      {
        title: "Limits",
        icon: iconGauge,
        hint: "Auto-caption leaves captions longer than the draft threshold alone and retries shorter results.",
        rows: [["vision_timeout_seconds", "draft_caption_threshold"]],
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    caption: "ComfyUI and AI-Toolkit",
    icon: iconPlug,
    description:
      "Where DataForge reaches the tools it drives. Use the origin, not a page within it.",
    groups: [
      { title: "ComfyUI", icon: iconComfyUi, rows: [["comfy_base_url"]] },
      { title: "Ostris AI-Toolkit", icon: iconAiToolkit, rows: [["ai_toolkit_base_url"]] },
    ],
  },
  {
    id: "storage",
    label: "Storage",
    caption: "Thumbnail cache",
    icon: iconHardDrive,
    description: "Disk space DataForge uses for itself, and where its files live.",
    groups: [],
  },
];

const STORAGE_KEYS: AppSettingKey[] = ["thumbnail_cache_max_mb"];

const SECTION_IDS = SECTIONS.map((entry) => entry.id);

const keysOf = (entry: Section): AppSettingKey[] =>
  entry.id === "storage" ? STORAGE_KEYS : entry.groups.flatMap((group) => group.rows.flat());

const SECTION_OF = Object.fromEntries(
  SECTIONS.flatMap((entry) => keysOf(entry).map((key) => [key, entry.id])),
) as Record<AppSettingKey, SectionId>;

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; settings: AppSettingsResponse; draft: SettingsDraft };

interface SaveError {
  key?: AppSettingKey;
  message: string;
}

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const savedTheme = useThemePreference();
  const [theme, setTheme] = useState(savedTheme);
  const [section, setSection] = useState<SectionId>("appearance");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const tabs = useTabList(SECTION_IDS, section, setSection, "vertical");
  const active = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];

  useEffect(() => {
    const controller = new AbortController();
    fetchAppSettings(controller.signal).then(
      (settings) => setState({ status: "ready", settings, draft: draftFromSettings(settings) }),
      (loadError: unknown) => {
        if (isAbortError(loadError)) return;
        setState({ status: "failed", message: formatApiError(loadError) });
      },
    );
    return () => controller.abort();
  }, []);

  const themeEdited = theme !== savedTheme;

  useEffect(() => {
    previewThemePreference(themeEdited ? theme : null);
    return () => previewThemePreference(null);
  }, [theme, themeEdited]);

  const editedKeys = state.status === "ready" ? editedSettingKeys(state.settings, state.draft) : [];
  const editedCount = editedKeys.length + (themeEdited ? 1 : 0);
  const isSectionEdited = (entry: Section) =>
    entry.id === "appearance" ? themeEdited : keysOf(entry).some((key) => editedKeys.includes(key));

  const updateDraft = (draft: SettingsDraft) => {
    setState((current) => (current.status === "ready" ? { ...current, draft } : current));
    setError(null);
  };

  const handleSave = async () => {
    const built =
      state.status === "ready" ? buildSettingsUpdate(state.settings, state.draft) : { update: {} };
    if ("error" in built) {
      setError({ key: built.key, message: built.error });
      setSection(SECTION_OF[built.key]);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (Object.keys(built.update).length > 0) await saveAppSettings(built.update);
      if (themeEdited) setThemePreference(theme);
      onClose();
    } catch (saveError) {
      setError({ message: formatApiError(saveError) });
      setSaving(false);
    }
  };

  const renderField = (key: AppSettingKey) => {
    if (state.status !== "ready") return null;
    const { settings, draft } = state;
    return (
      <SettingInput
        key={key}
        settingKey={key}
        state={settings[key]}
        value={draft.values[key]}
        edited={editedKeys.includes(key)}
        pendingReset={draft.resets.has(key)}
        invalid={error?.key === key}
        disabled={saving}
        onChange={(value) => updateDraft(editDraftValue(draft, key, value))}
        onReset={() => updateDraft(resetDraftValue(draft, settings, key))}
      />
    );
  };

  const renderRows = (rows: AppSettingKey[][]) =>
    rows.map((row) =>
      row.length > 1 ? (
        <div key={row.join()} className="settings-modal__row">
          {row.map(renderField)}
        </div>
      ) : (
        renderField(row[0])
      ),
    );

  const renderBody = (entry: Section) => {
    if (entry.id === "appearance") {
      return (
        <SettingsGroup title="Color scheme" icon={iconPalette}>
          <ThemePicker value={theme} disabled={saving} onChange={setTheme} />
        </SettingsGroup>
      );
    }
    if (state.status === "loading") {
      return (
        <p className="settings-modal__status" role="status">
          <Icon icon={iconLoader2} spin className="settings-modal__status-icon" />
          Loading settings...
        </p>
      );
    }
    if (state.status === "failed") {
      return (
        <p className="dialog__error" role="alert">
          {state.message}
        </p>
      );
    }
    if (entry.id === "storage") {
      return (
        <StorageSection settings={state.settings} visible={section === "storage"} disabled={saving}>
          {renderRows([STORAGE_KEYS])}
        </StorageSection>
      );
    }
    return entry.groups.map((group) => (
      <SettingsGroup key={group.title} title={group.title} icon={group.icon} hint={group.hint}>
        {renderRows(group.rows)}
      </SettingsGroup>
    ));
  };

  return (
    <ModalShell
      block="settings-modal"
      label="Settings"
      onClose={onClose}
      busy={saving}
      scrollLock="settings-modal-open"
      backdropLabel="Close settings"
    >
      <aside className="settings-modal__sidebar">
        <p className="settings-modal__brand">
          <Icon icon={iconSettings} className="settings-modal__brand-icon" />
          Settings
        </p>
        <nav {...tabs.tabListProps} aria-label="Settings sections" className="settings-modal__nav">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              {...tabs.tabProps(entry.id)}
              className={classNames(
                "settings-modal__tab",
                entry.id === section && "settings-modal__tab--active",
              )}
            >
              <span className="settings-modal__tab-icon-wrap">
                <Icon icon={entry.icon} className="settings-modal__tab-icon" />
              </span>
              <span className="settings-modal__tab-text">
                <span className="settings-modal__tab-label">{entry.label}</span>
                <span className="settings-modal__tab-caption">{entry.caption}</span>
              </span>
              {isSectionEdited(entry) && (
                <span className="settings-modal__tab-dot" aria-label="Unsaved" />
              )}
            </button>
          ))}
        </nav>
        <p className="settings-modal__shortcut">
          <kbd>Ctrl</kbd>
          <kbd>,</kbd>
          opens settings
        </p>
      </aside>

      <div className="settings-modal__main">
        <header className="settings-modal__header">
          <div className="settings-modal__heading">
            <h2 className="settings-modal__title">{active.label}</h2>
            <p className="settings-modal__description">{active.description}</p>
          </div>
          <button
            type="button"
            className="settings-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <Icon icon={iconX} />
          </button>
        </header>

        {SECTIONS.map((entry) => (
          <div key={entry.id} {...tabs.panelProps(entry.id)} className="settings-modal__body">
            {renderBody(entry)}
          </div>
        ))}

        <footer className="settings-modal__footer">
          <p
            className={classNames(
              "settings-modal__footer-status",
              (error || editedCount > 0) && "settings-modal__footer-status--pending",
              error && "settings-modal__footer-status--error",
            )}
            role={error ? "alert" : undefined}
          >
            {error
              ? error.message
              : editedCount > 0
                ? `${editedCount} unsaved ${editedCount === 1 ? "change" : "changes"}`
                : "Changes apply right away, without a restart."}
          </p>
          <div className="settings-modal__actions">
            <DialogButton label="Cancel" variant="secondary" disabled={saving} onClick={onClose} />
            <DialogButton
              label={saving ? "Saving..." : "Save"}
              variant="primary"
              busy={saving}
              disabled={editedCount === 0}
              onClick={() => void handleSave()}
            />
          </div>
        </footer>
      </div>
    </ModalShell>
  );
}
