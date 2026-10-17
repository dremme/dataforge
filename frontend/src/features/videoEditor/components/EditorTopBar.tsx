import { useState } from "react";
import {
  iconArrowLeft,
  iconCircleCheck,
  iconClapperboard,
  iconCopy,
  iconEllipsis,
  iconFolderOpen,
  iconHistory,
  iconLoader2,
  iconPanelLeftClose,
  iconPanelLeftOpen,
  iconPanelRightClose,
  iconPanelRightOpen,
  iconSettings,
  iconTrash2,
  iconTriangleAlert,
  iconUpload,
  iconX,
} from "@/shared/icons";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { classNames } from "@/shared/lib/classNames";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import type { VideoProjectExportState } from "@/shared/types";
import type { VideoProjectState } from "@/features/videoEditor/hooks/useVideoProject";
import { ToolButton } from "./ToolButton";
import { useChanged } from "@/shared/hooks/useChanged";

interface EditorTopBarProps {
  state: VideoProjectState;
  latestExport: VideoProjectExportState | undefined;
  onCancelExport: () => void;
  onDismissExport: () => void;
  onOpenExport: () => void;
  browserOpen: boolean;
  inspectorOpen: boolean;
  onToggleBrowser: () => void;
  onToggleInspector: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onOpenProject: () => void;
  onSettings: () => void;
  onDuplicate: () => void;
  onVersions: () => void;
  onDelete: () => void;
  onExport: () => void;
  canExport: boolean;
  onBack: () => void;
}

/** Where the editor is going back to, what is open, how it is saved, and how it leaves as video. */
export function EditorTopBar({
  state,
  latestExport,
  onCancelExport,
  onDismissExport,
  onOpenExport,
  browserOpen,
  inspectorOpen,
  onToggleBrowser,
  onToggleInspector,
  menuOpen,
  onMenuOpenChange,
  onOpenProject,
  onSettings,
  onDuplicate,
  onVersions,
  onDelete,
  onExport,
  canExport,
  onBack,
}: EditorTopBarProps) {
  const { project } = state;
  const rate = Number(project.frame_rate.toFixed(3));
  return (
    <header className="video-editor__topbar">
      <div className="video-editor__topbar-start">
        <Tooltip content="Back to gallery" placement="bottom">
          <button
            type="button"
            className="video-editor__back"
            onClick={onBack}
            aria-label="Back to gallery"
          >
            <Icon icon={iconArrowLeft} />
            <span>Gallery</span>
          </button>
        </Tooltip>
        <span className="video-editor__topbar-divider" aria-hidden="true" />
        <span className="video-editor__project-mark" aria-hidden="true">
          <Icon icon={iconClapperboard} />
        </span>
        <div className="video-editor__project-text">
          <ProjectName state={state} />
          <SaveStatus state={state} />
        </div>
      </div>

      <div className="video-editor__topbar-center">
        <Tooltip content="Canvas size and frame rate" placement="bottom">
          <button
            type="button"
            className="video-editor__format"
            onClick={onSettings}
            aria-label={`Project settings: ${project.width} × ${project.height}, ${rate} fps`}
          >
            <span>
              {project.width} × {project.height}
            </span>
            <span className="video-editor__format-dot" aria-hidden="true" />
            <span>{rate} fps</span>
          </button>
        </Tooltip>
      </div>

      <div className="video-editor__topbar-end">
        {latestExport && (
          <ExportStatus
            state={latestExport}
            onCancel={onCancelExport}
            onDismiss={onDismissExport}
            onOpen={onOpenExport}
          />
        )}
        <div className="video-editor__layout-toggles" role="group" aria-label="Panels">
          <ToolButton
            icon={browserOpen ? iconPanelLeftClose : iconPanelLeftOpen}
            label={browserOpen ? "Hide media browser" : "Show media browser"}
            tooltipPlacement="bottom"
            onClick={onToggleBrowser}
          />
          <ToolButton
            icon={inspectorOpen ? iconPanelRightClose : iconPanelRightOpen}
            label={inspectorOpen ? "Hide inspector" : "Show inspector"}
            tooltipPlacement="bottom"
            onClick={onToggleInspector}
          />
        </div>
        <ProjectMenu
          open={menuOpen}
          onOpenChange={onMenuOpenChange}
          saved={state.path !== null}
          onOpenProject={onOpenProject}
          onSettings={onSettings}
          onDuplicate={onDuplicate}
          onVersions={onVersions}
          onDelete={onDelete}
        />
        <button
          type="button"
          className="video-editor__export-btn"
          onClick={onExport}
          disabled={!canExport}
        >
          <Icon icon={iconUpload} /> Export
        </button>
      </div>
    </header>
  );
}

/** Renamed in place; the edit lands as one undo step when the field is left. */
function ProjectName({ state }: { state: VideoProjectState }) {
  const { project } = state;
  const [name, setName] = useState(project.name);
  if (useChanged(project.name)) {
    setName(project.name);
  }
  return (
    <input
      className="video-editor__name"
      value={name}
      aria-label="Project name"
      title="Rename the project"
      maxLength={120}
      size={Math.min(40, Math.max(8, name.length + 1))}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => {
        const trimmed = name.trim();
        if (trimmed && trimmed !== project.name) state.commit({ ...project, name: trimmed });
        else setName(project.name);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setName(project.name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function SaveStatus({ state }: { state: VideoProjectState }) {
  const labels: Record<VideoProjectState["saveState"], string> = {
    new: "Not saved yet: nothing changed",
    unsaved: "Unsaved changes",
    saving: "Saving...",
    saved: "Saved",
    error: "Save failed",
    conflict: "Changed in another window",
  };
  const failed = state.saveState === "error" || state.saveState === "conflict";
  return (
    <span
      className={classNames(
        "video-editor__save",
        `video-editor__save--${state.saveState}`,
        failed && "video-editor__save--failed",
      )}
      role="status"
      title={state.saveError ?? undefined}
    >
      {state.saveState === "saving" ? (
        <Icon icon={iconLoader2} spin />
      ) : failed ? (
        <Icon icon={iconTriangleAlert} />
      ) : (
        <span className="video-editor__save-dot" aria-hidden="true" />
      )}
      {labels[state.saveState]}
      {state.saveState === "error" && (
        <button type="button" className="video-editor__link-btn" onClick={() => void state.flush()}>
          Retry
        </button>
      )}
      {state.saveState === "conflict" && (
        <button
          type="button"
          className="video-editor__link-btn"
          onClick={() => void state.saveAsCopy()}
        >
          Save as a new draft
        </button>
      )}
    </span>
  );
}

function ExportStatus({
  state,
  onCancel,
  onDismiss,
  onOpen,
}: {
  state: VideoProjectExportState;
  onCancel: () => void;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const percent = Math.round(state.progress * 100);
  return (
    <span
      className={classNames("video-editor__export", `video-editor__export--${state.status}`)}
      role="status"
    >
      {state.status === "running" && (
        <>
          <Icon icon={iconLoader2} spin />
          <span className="video-editor__export-text">
            Exporting {state.output_name} {percent}%
          </span>
          <span className="video-editor__export-bar" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </span>
          <button type="button" className="video-editor__link-btn" onClick={onCancel}>
            Cancel
          </button>
        </>
      )}
      {state.status === "completed" && (
        <>
          <Icon icon={iconCircleCheck} />
          <span className="video-editor__export-text">Exported {state.output_name}</span>
          <ExportLevel state={state} />
          <button type="button" className="video-editor__link-btn" onClick={onOpen}>
            Open in gallery
          </button>
        </>
      )}
      {state.status === "failed" && (
        <>
          <Icon icon={iconTriangleAlert} />
          <span className="video-editor__export-text" title={state.error ?? undefined}>
            Export failed: {state.error}
          </span>
        </>
      )}
      {state.status === "cancelled" && (
        <span className="video-editor__export-text">Export cancelled; nothing was saved</span>
      )}
      {state.status !== "running" && (
        <button
          type="button"
          className="video-editor__icon-btn"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <Icon icon={iconX} />
        </button>
      )}
    </span>
  );
}

/** What the finished file measures: integrated loudness and true peak. */
function ExportLevel({ state }: { state: VideoProjectExportState }) {
  const { loudness_lufs: lufs, true_peak_db: peak } = state;
  if (lufs == null && peak == null) return null;
  const clipped = peak != null && peak >= 0;
  const parts = [
    lufs != null && `${lufs.toFixed(1)} LUFS`,
    peak != null && `peak ${peak.toFixed(1)} dBTP`,
  ].filter(Boolean);
  return (
    <span
      className={classNames(
        "video-editor__export-level",
        clipped && "video-editor__export-level--clipped",
      )}
      title={
        clipped
          ? "The sound reaches full scale and will distort on playback. Export again with " +
            "Limit peaks or Normalize, or lower the loudest clips."
          : "Integrated loudness and true peak, measured on the exported file."
      }
    >
      {parts.join(" · ")}
      {clipped && " · clipped"}
    </span>
  );
}

/** The project's less frequent actions, deletion among them, kept out of the way of Export. */
function ProjectMenu({
  open,
  onOpenChange,
  saved,
  onOpenProject,
  onSettings,
  onDuplicate,
  onVersions,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saved: boolean;
  onOpenProject: () => void;
  onSettings: () => void;
  onDuplicate: () => void;
  onVersions: () => void;
  onDelete: () => void;
}) {
  const { menuId, rootRef, panelRef, triggerProps, close } = usePopupMenu({ open, onOpenChange });
  const pick = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <div ref={rootRef} className="video-editor__menu">
      <Tooltip content="Project actions" placement="bottom">
        <button
          type="button"
          className={classNames("video-editor__tool", open && "video-editor__tool--pressed")}
          aria-label="Project actions"
          {...triggerProps}
        >
          <Icon icon={iconEllipsis} />
        </button>
      </Tooltip>
      <AnchoredLayer
        anchorRef={rootRef}
        floatingRef={panelRef}
        open={open}
        id={menuId}
        className="video-editor__menu-panel"
        role="menu"
        label="Project actions"
      >
        <button
          type="button"
          role="menuitem"
          className="video-editor__menu-item"
          onClick={pick(onOpenProject)}
        >
          <Icon icon={iconFolderOpen} />
          <span>Open project...</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="video-editor__menu-item"
          onClick={pick(onSettings)}
        >
          <Icon icon={iconSettings} />
          <span>Project settings...</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="video-editor__menu-item"
          onClick={pick(onDuplicate)}
        >
          <Icon icon={iconCopy} />
          <span className="video-editor__menu-text">
            <span>Duplicate project</span>
            <span className="video-editor__menu-hint">Keeps this one and continues in a copy</span>
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="video-editor__menu-item"
          onClick={pick(onVersions)}
          disabled={!saved}
        >
          <Icon icon={iconHistory} />
          <span className="video-editor__menu-text">
            <span>Versions...</span>
            {!saved && <span className="video-editor__menu-hint">Not saved yet</span>}
          </span>
        </button>
        <span className="video-editor__menu-divider" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="video-editor__menu-item video-editor__menu-item--danger"
          onClick={pick(onDelete)}
          disabled={!saved}
        >
          <Icon icon={iconTrash2} />
          <span className="video-editor__menu-text">
            <span>Delete project...</span>
            {!saved && (
              <span className="video-editor__menu-hint">Not saved yet, so nothing to delete</span>
            )}
          </span>
        </button>
      </AnchoredLayer>
    </div>
  );
}
