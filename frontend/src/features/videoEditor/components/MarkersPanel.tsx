import { useEffect, useState } from "react";
import { iconBookmarkPlus, iconSearch, iconTrash2 } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { SHORTCUTS } from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import {
  addMarker,
  markerLabel,
  removeMarker,
  updateMarker,
  type Marker,
} from "@/features/videoEditor/lib/markers";
import {
  EPSILON,
  snapToFrame,
  type EditResult,
  type Project,
} from "@/features/videoEditor/lib/timeline";
import { Panel } from "./InspectorParts";
import { TimecodeField } from "./TimecodeField";
import { ToolButton } from "./ToolButton";

/** A filter appears once the list is long enough to need one. */
const FILTER_FROM = 6;

/** The project's markers in time order: jump to one, rename it, note it, move or remove it. */
export function MarkersPanel({
  project,
  time,
  onSeek,
  onEdit,
}: {
  project: Project;
  time: number;
  onSeek: (time: number) => void;
  onEdit: (result: EditResult) => void;
}) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const shown = query
    ? project.markers.filter((marker) =>
        `${markerLabel(project, marker)} ${marker.note}`.toLowerCase().includes(query),
      )
    : project.markers;
  return (
    <Panel
      title="Markers"
      changed={project.markers.length > 0}
      action={
        <ToolButton
          icon={iconBookmarkPlus}
          label="Add a marker at the playhead"
          shortcut={SHORTCUTS.editorAddMarker}
          onClick={() => onEdit(addMarker(project, snapToFrame(time, project.frame_rate)))}
        />
      }
    >
      {project.markers.length === 0 ? (
        <p className="video-editor__hint">
          Press M while playing to mark beats, lyric lines or shot notes. Edits snap to them.
        </p>
      ) : (
        <>
          {project.markers.length >= FILTER_FROM && (
            <label className="video-editor__marker-filter">
              <Icon icon={iconSearch} />
              <input
                type="search"
                value={filter}
                placeholder="Find a marker"
                aria-label="Find a marker"
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
          )}
          <ul className="video-editor__markers">
            {shown.map((marker) => (
              <MarkerRow
                key={marker.id}
                project={project}
                marker={marker}
                current={Math.abs(marker.time - time) < EPSILON}
                onSeek={onSeek}
                onEdit={onEdit}
              />
            ))}
          </ul>
          {shown.length === 0 && <p className="video-editor__hint">No marker matches.</p>}
        </>
      )}
    </Panel>
  );
}

function MarkerRow({
  project,
  marker,
  current,
  onSeek,
  onEdit,
}: {
  project: Project;
  marker: Marker;
  current: boolean;
  onSeek: (time: number) => void;
  onEdit: (result: EditResult) => void;
}) {
  const label = markerLabel(project, marker);
  return (
    <li className={classNames("video-editor__marker", current && "video-editor__marker--current")}>
      <div className="video-editor__marker-head">
        <button
          type="button"
          className="video-editor__marker-go"
          aria-label={`Go to ${label}`}
          title={`Go to ${label}`}
          onClick={() => onSeek(marker.time)}
        />
        <TimecodeField
          label={`Time of ${label}`}
          value={marker.time}
          frameRate={project.frame_rate}
          onCommit={(seconds) =>
            onEdit(
              updateMarker(project, marker.id, { time: snapToFrame(seconds, project.frame_rate) }),
            )
          }
        />
        <DraftInput
          className="video-editor__marker-name"
          value={marker.name}
          placeholder={label}
          maxLength={80}
          label={`Name of ${label}`}
          onCommit={(name) => onEdit(updateMarker(project, marker.id, { name: name.trim() }))}
        />
        <ToolButton
          icon={iconTrash2}
          label={`Remove ${label}`}
          onClick={() => onEdit(removeMarker(project, marker.id))}
        />
      </div>
      <DraftInput
        className="video-editor__marker-note"
        value={marker.note}
        placeholder="Note"
        maxLength={500}
        label={`Note on ${label}`}
        onCommit={(note) => onEdit(updateMarker(project, marker.id, { note }))}
      />
    </li>
  );
}

/** Typed freely and saved once, when left or on Enter, so a word is one undo step. */
function DraftInput({
  value,
  label,
  onCommit,
  ...rest
}: {
  value: string;
  label: string;
  className: string;
  placeholder: string;
  maxLength: number;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      {...rest}
      value={draft}
      aria-label={label}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
