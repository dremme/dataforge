import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VISION_MODEL_QUERY_KEY } from "@/features/automation/api/visionLlm";
import { formatApiError } from "@/shared/api/http";
import { useTabList } from "@/shared/hooks/useTabList";
import {
  iconAiToolkit,
  iconBrain,
  iconComfyUi,
  iconGauge,
  iconHardDrive,
  iconHistory,
  iconImage,
  iconInfo,
  iconLink,
  iconLoader2,
  iconPalette,
  iconPlug,
  iconSettings,
  iconVideo,
  iconX,
  iconZap,
  type AppIcon,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import {
  previewThemePreference,
  setThemePreference,
  useThemePreference,
} from "@/shared/theme/theme";
import type { AppSettingKey, AppSettingsResponse, ProbedService } from "@/shared/types";
import { DialogButton } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { ModalShell } from "@/shared/ui/ModalShell";
import { ShortcutKeys } from "@/shared/ui/ShortcutKeys";
import { fetchAppSettings, probeService, saveAppSettings, settingsKeys } from "../api/settings";
import {
  buildSettingsUpdate,
  draftFromSettings,
  editDraftValue,
  editedSettingKeys,
  resetDraftValue,
  type SettingsDraft,
} from "../lib/settingsForm";
import { AboutSection } from "./AboutSection";
import { ConnectionStatus, type ProbeState } from "./ConnectionStatus";
import { RememberedDataGroup } from "./RememberedDataGroup";
import { SettingInput } from "./SettingInput";
import { SettingsActionButton } from "./SettingsActionButton";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsPageTabs } from "./SettingsPageTabs";
import { StorageSection } from "./StorageSection";
import { ThemePicker } from "./ThemePicker";

type SectionId = "appearance" | "vision" | "integrations" | "storage" | "data" | "about";

type PageId =
  "appearance" | "server" | "sampling" | "media" | "integrations" | "storage" | "data" | "about";

interface Group {
  title: string;
  icon: AppIcon;
  hint?: string;
  /** Fields in layout order; a row of two sits side by side. */
  rows: AppSettingKey[][];
  probe?: ProbedService;
}

interface Page {
  id: PageId;
  label: string;
  description: string;
  groups: Group[];
  /** Groups sit side by side instead of stacking. */
  columns?: boolean;
}

interface Section {
  id: SectionId;
  label: string;
  caption: string;
  icon: AppIcon;
  /** A section with more than one page shows them as tabs under its header. */
  pages: Page[];
}

const samplingRows = (mode: "thinking" | "instruct"): AppSettingKey[][] => [
  [`${mode}_temperature`],
  [`${mode}_top_p`, `${mode}_min_p`],
  [`${mode}_presence_penalty`],
  [`${mode}_repeat_penalty`],
];

const SECTIONS: Section[] = [
  {
    id: "appearance",
    label: "Appearance",
    caption: "Color scheme",
    icon: iconPalette,
    pages: [
      {
        id: "appearance",
        label: "Appearance",
        description: "Pick a color scheme, or let DataForge follow the one your system uses.",
        groups: [],
      },
    ],
  },
  {
    id: "vision",
    label: "Vision model",
    caption: "Server, sampling, media",
    icon: iconBrain,
    pages: [
      {
        id: "server",
        label: "Server",
        description:
          "The OpenAI-compatible server behind Auto-caption, Verify captions, and Edit captions.",
        groups: [
          {
            title: "Connection",
            icon: iconLink,
            hint: "A running job keeps the server it started with.",
            rows: [["vision_base_url"], ["vision_api_key", "vision_model"]],
            probe: "vision",
          },
          {
            title: "Limits",
            icon: iconGauge,
            hint: "Auto-caption leaves captions longer than the draft threshold alone and retries shorter results.",
            rows: [["vision_max_tokens", "vision_top_k", "draft_caption_threshold"]],
          },
        ],
      },
      {
        id: "sampling",
        label: "Sampling",
        description:
          "Tune sampling last, once the connection and budgets work. Each job picks its mode.",
        columns: true,
        groups: [
          { title: "Reasoning", icon: iconBrain, rows: samplingRows("thinking") },
          { title: "Instruct", icon: iconZap, rows: samplingRows("instruct") },
        ],
      },
      {
        id: "media",
        label: "Media input",
        description:
          "Pixels and frames sent to the model. Shrink these first when VRAM or context runs out.",
        groups: [
          {
            title: "Stills",
            icon: iconImage,
            hint: "Images, and a GIF's first frame, are downscaled to fit this budget.",
            rows: [["image_max_pixels"]],
          },
          {
            title: "Video",
            icon: iconVideo,
            hint: "Frames are spread across the clip. The frame budget falls from the short-clip value at 7 s to the long-clip value at 20 s.",
            rows: [
              ["video_keyframes_per_second", "video_max_keyframes"],
              ["video_frame_max_pixels", "video_frame_min_pixels"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    caption: "ComfyUI and AI-Toolkit",
    icon: iconPlug,
    pages: [
      {
        id: "integrations",
        label: "Integrations",
        description:
          "Where DataForge reaches the tools it drives. Use the origin, not a page within it.",
        groups: [
          { title: "ComfyUI", icon: iconComfyUi, rows: [["comfy_base_url"]], probe: "comfy" },
          {
            title: "Ostris AI-Toolkit",
            icon: iconAiToolkit,
            rows: [["ai_toolkit_base_url"]],
            probe: "ai_toolkit",
          },
        ],
      },
    ],
  },
  {
    id: "storage",
    label: "Storage",
    caption: "Thumbnail cache",
    icon: iconHardDrive,
    pages: [
      {
        id: "storage",
        label: "Storage",
        description: "Disk space DataForge uses for itself.",
        groups: [
          { title: "Thumbnail cache", icon: iconHardDrive, rows: [["thumbnail_cache_max_mb"]] },
        ],
      },
    ],
  },
  {
    id: "data",
    label: "Data & history",
    caption: "Retention and history",
    icon: iconHistory,
    pages: [
      {
        id: "data",
        label: "Data & history",
        description: "How long DataForge keeps its history, and what it remembers between visits.",
        groups: [
          {
            title: "History",
            icon: iconHistory,
            hint: "Finished jobs and notifications older than this are deleted; running jobs never are. 0 keeps everything.",
            rows: [["job_history_days", "notification_history_days"]],
          },
        ],
      },
    ],
  },
  {
    id: "about",
    label: "About",
    caption: "Version and diagnostics",
    icon: iconInfo,
    pages: [
      {
        id: "about",
        label: "About",
        description: "What is installed and where it lives. Useful when something does not work.",
        groups: [],
      },
    ],
  },
];

const SECTION_IDS = SECTIONS.map((entry) => entry.id);

const keysOf = (page: Page): AppSettingKey[] => page.groups.flatMap((group) => group.rows.flat());

/** Where a setting lives, so a refused value can be shown. */
const HOME_OF = Object.fromEntries(
  SECTIONS.flatMap((entry) =>
    entry.pages.flatMap((page) => keysOf(page).map((key) => [key, [entry.id, page.id]])),
  ),
) as Record<AppSettingKey, [SectionId, PageId]>;

const PROBE_URL_KEY: Record<ProbedService, AppSettingKey> = {
  vision: "vision_base_url",
  comfy: "comfy_base_url",
  ai_toolkit: "ai_toolkit_base_url",
};

/** Editing one of these makes the last test result for that service stale. */
const PROBE_OF: Partial<Record<AppSettingKey, ProbedService>> = {
  vision_base_url: "vision",
  vision_api_key: "vision",
  comfy_base_url: "comfy",
  ai_toolkit_base_url: "ai_toolkit",
};

interface LoadedSettings {
  settings: AppSettingsResponse;
  draft: SettingsDraft;
}

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | ({ status: "ready" } & LoadedSettings);

interface SaveError {
  key?: AppSettingKey;
  message: string;
}

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const queryClient = useQueryClient();
  // Each opening waits for fresh settings; the draft keeps that response as its baseline.
  const settingsQuery = useQuery({
    queryKey: settingsKeys.app,
    queryFn: ({ signal }) => fetchAppSettings(signal),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const [loaded, setLoaded] = useState<LoadedSettings | null>(null);
  if (
    !loaded &&
    settingsQuery.isFetchedAfterMount &&
    !settingsQuery.isError &&
    settingsQuery.data
  ) {
    setLoaded({ settings: settingsQuery.data, draft: draftFromSettings(settingsQuery.data) });
  }
  const state: LoadState = loaded
    ? { status: "ready", ...loaded }
    : settingsQuery.isError
      ? { status: "failed", message: formatApiError(settingsQuery.error) }
      : { status: "loading" };

  const save = useMutation({
    mutationFn: saveAppSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKeys.app, saved);
      // The badge names the configured model, which this save may just have changed.
      void queryClient.invalidateQueries({ queryKey: VISION_MODEL_QUERY_KEY });
    },
  });
  const saving = save.isPending;
  const savedTheme = useThemePreference();
  const [theme, setTheme] = useState(savedTheme);
  const [section, setSection] = useState<SectionId>("appearance");
  const [openPages, setOpenPages] = useState<Partial<Record<SectionId, PageId>>>({});
  const [error, setError] = useState<SaveError | null>(null);
  const [probes, setProbes] = useState<Partial<Record<ProbedService, ProbeState>>>({});
  const tabs = useTabList(SECTION_IDS, section, setSection, "vertical");
  const active = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];
  const pageOf = (entry: Section) =>
    entry.pages.find((page) => page.id === openPages[entry.id]) ?? entry.pages[0];
  const showPage = (entry: SectionId, page: PageId) =>
    setOpenPages((current) => ({ ...current, [entry]: page }));

  const themeEdited = theme !== savedTheme;

  useEffect(() => {
    previewThemePreference(themeEdited ? theme : null);
    return () => previewThemePreference(null);
  }, [theme, themeEdited]);

  const editedKeys = state.status === "ready" ? editedSettingKeys(state.settings, state.draft) : [];
  const editedCount = editedKeys.length + (themeEdited ? 1 : 0);
  const isPageEdited = (page: Page) =>
    page.id === "appearance" ? themeEdited : keysOf(page).some((key) => editedKeys.includes(key));
  const isSectionEdited = (entry: Section) => entry.pages.some(isPageEdited);

  const updateDraft = (next: SettingsDraft) => {
    setLoaded((current) => current && { ...current, draft: next });
    setError(null);
  };

  const editField = (key: AppSettingKey, value: string) => {
    if (state.status !== "ready") return;
    updateDraft(editDraftValue(state.draft, key, value));
    const stale = PROBE_OF[key];
    if (stale) {
      setProbes((current) => {
        const next = { ...current };
        delete next[stale];
        return next;
      });
    }
  };

  const testConnection = async (service: ProbedService) => {
    if (state.status !== "ready") return;
    const { draft } = state;
    setProbes((current) => ({ ...current, [service]: { status: "testing" } }));
    try {
      const result = await probeService({
        service,
        base_url: draft.values[PROBE_URL_KEY[service]],
        api_key: service === "vision" ? draft.values.vision_api_key.trim() || null : null,
      });
      setProbes((current) => ({ ...current, [service]: { status: "done", result } }));
    } catch (probeError) {
      setProbes((current) => ({
        ...current,
        [service]: { status: "failed", message: formatApiError(probeError) },
      }));
    }
  };

  const handleSave = async () => {
    const built =
      state.status === "ready" ? buildSettingsUpdate(state.settings, state.draft) : { update: {} };
    if ("error" in built) {
      const [home, page] = HOME_OF[built.key];
      setError({ key: built.key, message: built.error });
      setSection(home);
      showPage(home, page);
      return;
    }

    setError(null);
    try {
      if (Object.keys(built.update).length > 0) await save.mutateAsync(built.update);
      if (themeEdited) setThemePreference(theme);
      onClose();
    } catch (saveError) {
      setError({ message: formatApiError(saveError) });
    }
  };

  const visionProbe = probes.vision;
  const modelSuggestions =
    visionProbe?.status === "done" && visionProbe.result.reachable ? visionProbe.result.models : [];

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
        suggestions={key === "vision_model" ? modelSuggestions : undefined}
        onChange={(value) => editField(key, value)}
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

  const renderGroup = (group: Group) => {
    const probe = group.probe;
    const probeState = probe ? probes[probe] : undefined;
    return (
      <SettingsGroup
        key={group.title}
        title={group.title}
        icon={group.icon}
        hint={group.hint}
        action={
          probe && (
            <SettingsActionButton
              label="Test connection"
              icon={iconPlug}
              busy={probeState?.status === "testing"}
              disabled={saving}
              onClick={() => void testConnection(probe)}
            />
          )
        }
      >
        {renderRows(group.rows)}
        {probeState && <ConnectionStatus state={probeState} />}
      </SettingsGroup>
    );
  };

  const renderPage = (page: Page) => {
    if (page.id === "appearance") {
      return (
        <SettingsGroup title="Color scheme" icon={iconPalette}>
          <ThemePicker value={theme} disabled={saving} onChange={setTheme} />
        </SettingsGroup>
      );
    }
    if (page.id === "about") {
      return (
        <AboutSection
          settings={state.status === "ready" ? state.settings : null}
          visible={section === "about"}
        />
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
    if (page.id === "storage") {
      return (
        <StorageSection visible={section === "storage"} disabled={saving}>
          {renderRows(page.groups[0].rows)}
        </StorageSection>
      );
    }
    const groups = page.groups.map(renderGroup);
    if (page.id === "data") {
      return (
        <>
          {groups}
          <RememberedDataGroup visible={section === "data"} disabled={saving} />
        </>
      );
    }
    return page.columns ? <div className="settings-modal__columns">{groups}</div> : groups;
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
        <div className="settings-modal__shortcuts">
          <p className="settings-modal__shortcut">
            <ShortcutKeys shortcut={SHORTCUTS.settings} />
            opens settings
          </p>
          <p className="settings-modal__shortcut">
            <ShortcutKeys shortcut={SHORTCUTS.shortcuts} />
            lists every shortcut
          </p>
        </div>
      </aside>

      <div className="settings-modal__main">
        <header className="settings-modal__header">
          <div className="settings-modal__heading">
            <h2 className="settings-modal__title">{active.label}</h2>
            <p className="settings-modal__description">{pageOf(active).description}</p>
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
          <div key={entry.id} {...tabs.panelProps(entry.id)} className="settings-modal__pane">
            {entry.pages.length > 1 ? (
              <SettingsPageTabs
                label={entry.label}
                pages={entry.pages}
                active={pageOf(entry).id}
                isEdited={isPageEdited}
                onSelect={(page) => showPage(entry.id, page)}
                renderPage={renderPage}
              />
            ) : (
              <div className="settings-modal__body">{renderPage(entry.pages[0])}</div>
            )}
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
