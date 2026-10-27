import { Tooltip } from "@/shared/ui/Tooltip";
import type { VideoProjectMix } from "@/shared/types";
import { iconMic, iconSliders } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { percent } from "@/features/videoEditor/lib/sliderUnits";
import type { Project, Track } from "@/features/videoEditor/lib/timeline";
import { Panel, Slider } from "./InspectorParts";

/** ``final`` is false while a slider is still being dragged, as for a clip edit. */
export type TrackEdit = (trackId: string, patch: Partial<Track>, final: boolean) => void;
export type MixEdit = (patch: Partial<VideoProjectMix>, final: boolean) => void;

/** Levels for each sound track and the whole mix, and how far speech ducks the rest. */
export function MixPanel({
  project,
  onTrackEdit,
  onMixEdit,
}: {
  project: Project;
  onTrackEdit: TrackEdit;
  onMixEdit: MixEdit;
}) {
  const audio = project.tracks.filter((track) => track.kind === "audio");
  const speech = audio.some((track) => track.speech);
  const changed =
    project.mix.master_gain !== 1 || audio.some((track) => track.gain !== 1 || track.speech);
  return (
    <Panel title="Mix" icon={iconSliders} changed={changed}>
      {audio.map((track) => (
        <Slider
          key={track.id}
          label={track.name}
          value={track.gain}
          resting={1}
          min={0}
          max={2}
          step={0.01}
          unit={percent}
          onChange={(gain, final) => onTrackEdit(track.id, { gain }, final)}
          trailing={
            <Tooltip
              content={
                track.speech
                  ? `${track.name} is speech: the other tracks duck while it sounds`
                  : `Mark ${track.name} as speech, so the other tracks duck under it`
              }
              placement="top"
            >
              <button
                type="button"
                className={classNames(
                  "video-editor__key-btn",
                  track.speech && "video-editor__key-btn--on",
                )}
                aria-pressed={track.speech}
                aria-label={`${track.name} is speech`}
                onClick={() => onTrackEdit(track.id, { speech: !track.speech }, true)}
              >
                <Icon icon={iconMic} />
              </button>
            </Tooltip>
          }
        />
      ))}
      <Slider
        label="Master"
        value={project.mix.master_gain}
        resting={1}
        min={0}
        max={2}
        step={0.01}
        unit={percent}
        onChange={(master_gain, final) => onMixEdit({ master_gain }, final)}
      />
      <Slider
        label="Duck to"
        value={project.mix.duck_gain}
        resting={0.25}
        min={0}
        max={1}
        step={0.01}
        unit={percent}
        onChange={(duck_gain, final) => onMixEdit({ duck_gain }, final)}
      />
      <p className="video-editor__hint">
        {speech
          ? "While a clip on a speech track sounds, the other tracks drop to the duck level."
          : "Mark a track as speech to duck the others while it sounds."}
      </p>
    </Panel>
  );
}
