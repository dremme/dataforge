import { useState } from "react";
import {
  AUDIO_HIGH_CUT_MAX_HZ,
  AUDIO_HIGH_CUT_MIN_HZ,
  AUDIO_LOW_CUT_MAX_HZ,
  AUDIO_EQ_MAX_DB,
  AUDIO_PITCH_MAX_SEMITONES,
} from "@/shared/constants";
import {
  formatDecibels,
  formatHertz,
  formatHighCut,
  highCutDial,
  highCutFromDial,
  isEqIdentity,
  lowCutFromDial,
} from "@/shared/lib/audioEffects";
import {
  AUDIO_LEVELS,
  AUDIO_TRIM_STEP,
  AUDIO_VOLUME_PRESETS,
  FADE_PRESETS,
  formatFade,
  formatPitch,
} from "@/features/gallery/lib/audioEdit";
import {
  SPEED_PRESETS,
  TRIM_LENGTH_PRESETS,
  formatSpeed,
  formatVolume,
  hasTrimLength,
  trimForLength,
} from "@/features/gallery/lib/videoEdit";
import { formatFrameTime } from "@/features/gallery/lib/videoFrameCapture";
import {
  iconAudioLines,
  iconGauge,
  iconLoader2,
  iconScissors,
  iconSliders,
  iconBroom,
  iconVolume2,
} from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { RulerDial } from "@/shared/ui/RulerDial";
import type { AudioEdit } from "@/features/gallery/hooks/useAudioEdit";
import type { AudioEffects } from "@/shared/types";
import {
  EditActions,
  OutputChange,
  OutputPart,
  PresetButton,
  PresetChoices,
  ToolGroup,
  ToolHint,
  ToolPresets,
  ToolTabs,
  type EditTool,
} from "./EditPanelParts";
import { VideoEditTimeline } from "./VideoEditTimeline";

type ToolId = "trim" | "fades" | "volume" | "speed" | "eq" | "clean";

const TOOLS: ReadonlyArray<EditTool<ToolId>> = [
  { id: "trim", label: "Trim", icon: iconScissors },
  { id: "fades", label: "Fades", icon: iconAudioLines },
  { id: "volume", label: "Volume", icon: iconVolume2 },
  { id: "speed", label: "Speed", icon: iconGauge },
  { id: "eq", label: "EQ", icon: iconSliders },
  { id: "clean", label: "Clean", icon: iconBroom },
];

const HINTS: Record<ToolId, string> = {
  trim: "Both follow the playhead. Drag a handle, or nudge it with the arrow keys.",
  fades: "Equal power sounds even; linear dips in the middle.",
  volume: "Peaks are limited in the file, not in the preview.",
  speed: "Speed changes the length and keeps the pitch; pitch keeps the length.",
  eq: "Cuts remove rumble or hiss; the shelves and the peak lift or lower a range.",
  clean: "Learns the noise from the file's quietest moment, then lowers it everywhere.",
};

type BandId = "low_cut" | "bass" | "mid" | "treble" | "high_cut";

interface Band {
  id: BandId;
  label: string;
  /** The dial's range; a cut reads 0, off, at the end it stops cutting. */
  min: number;
  max: number;
  step: number;
  rest: number;
  format: (value: number) => string;
  /** From dial position to the stored value, and back. */
  stored: (value: number) => number;
  shown: (effects: AudioEffects) => number;
}

const gain = (id: "bass" | "mid" | "treble", label: string): Band => ({
  id,
  label,
  min: -AUDIO_EQ_MAX_DB,
  max: AUDIO_EQ_MAX_DB,
  step: 0.5,
  rest: 0,
  format: formatDecibels,
  stored: (value) => value,
  shown: (effects) => effects[id],
});

const BANDS: readonly Band[] = [
  {
    id: "low_cut",
    label: "Low cut",
    min: 0,
    max: AUDIO_LOW_CUT_MAX_HZ,
    step: 5,
    rest: 0,
    format: formatHertz,
    stored: lowCutFromDial,
    shown: (effects) => effects.low_cut,
  },
  gain("bass", "Bass"),
  gain("mid", "Mid"),
  gain("treble", "Treble"),
  {
    id: "high_cut",
    label: "High cut",
    min: AUDIO_HIGH_CUT_MIN_HZ,
    max: AUDIO_HIGH_CUT_MAX_HZ,
    step: 100,
    rest: AUDIO_HIGH_CUT_MAX_HZ,
    format: formatHighCut,
    stored: highCutFromDial,
    shown: highCutDial,
  },
];

interface AudioEditPanelProps {
  edit: AudioEdit;
  /** The original's sound for the trim track, once its length is known. */
  waveformUrl: string | undefined;
  busy: boolean;
  onRevertRequested: () => void;
}

export function AudioEditPanel({
  edit,
  waveformUrl,
  busy,
  onRevertRequested,
}: AudioEditPanelProps) {
  const [activeTool, setActiveTool] = useState<ToolId>("trim");
  const [bandId, setBandId] = useState<BandId>("low_cut");

  const { draft } = edit;
  const locked = !edit.ready || busy || edit.applying;
  const modified: Record<ToolId, boolean> = {
    trim: draft.trimStart > 0 || (edit.ready && draft.trimEnd < edit.duration),
    fades: draft.fadeIn > 0 || draft.fadeOut > 0,
    volume: draft.volume !== 1 || draft.level !== "unchanged",
    speed: draft.speed !== 1 || draft.pitch !== 0,
    eq: !isEqIdentity(draft.effects),
    clean: draft.effects.noise_reduction > 0,
  };
  const band = BANDS.find((entry) => entry.id === bandId) ?? BANDS[0];

  return (
    <div className="edit-panel" role="group" aria-label="Audio editing">
      <VideoEditTimeline
        duration={edit.duration}
        trimStart={draft.trimStart}
        trimEnd={draft.trimEnd}
        speed={draft.speed}
        frameDuration={AUDIO_TRIM_STEP}
        playheadTime={edit.playheadTime}
        playheadRef={edit.playheadRef}
        playing={edit.playing}
        ready={edit.ready}
        disabled={busy || edit.applying}
        waveformUrl={waveformUrl}
        fadeIn={draft.fadeIn}
        fadeOut={draft.fadeOut}
        onTrimStartChange={edit.setTrimStart}
        onTrimEndChange={edit.setTrimEnd}
        onSeek={edit.seekTo}
        onTogglePlay={edit.togglePlay}
      />

      <div className="edit-panel__tabs-bar">
        <ToolTabs
          tools={TOOLS}
          activeTool={activeTool}
          modified={modified}
          disabled={locked}
          onSelect={setActiveTool}
        />
      </div>

      <div className="edit-panel__body">
        <div className="edit-panel__tool-controls">
          {activeTool === "trim" && (
            <>
              <ToolGroup label="Trim points" className="edit-panel__tool-actions">
                <button
                  type="button"
                  className="edit-panel__control"
                  disabled={locked}
                  onClick={edit.setTrimStartAtPlayhead}
                >
                  Set in
                </button>
                <button
                  type="button"
                  className="edit-panel__control"
                  disabled={locked}
                  onClick={edit.setTrimEndAtPlayhead}
                >
                  Set out
                </button>
              </ToolGroup>
              <ToolPresets label="Length">
                {TRIM_LENGTH_PRESETS.map((seconds) => (
                  <PresetButton
                    key={seconds}
                    active={hasTrimLength(seconds, draft, AUDIO_TRIM_STEP)}
                    disabled={
                      locked || !trimForLength(seconds, draft, edit.duration, AUDIO_TRIM_STEP)
                    }
                    onClick={() => edit.setTrimLength(seconds)}
                  >
                    {seconds}s
                  </PresetButton>
                ))}
              </ToolPresets>
            </>
          )}

          {activeTool === "fades" && (
            <>
              <PresetChoices
                label="Fade in"
                values={FADE_PRESETS}
                current={draft.fadeIn}
                format={formatFade}
                disabled={locked}
                onSelect={edit.setFadeIn}
              />
              <PresetChoices
                label="Fade out"
                values={FADE_PRESETS}
                current={draft.fadeOut}
                format={formatFade}
                disabled={locked}
                onSelect={edit.setFadeOut}
              />
              <ToolPresets label="Curve">
                <PresetButton
                  active={draft.fadeCurve === "equal_power"}
                  disabled={locked}
                  onClick={() => edit.setFadeCurve("equal_power")}
                >
                  Equal power
                </PresetButton>
                <PresetButton
                  active={draft.fadeCurve === "linear"}
                  disabled={locked}
                  onClick={() => edit.setFadeCurve("linear")}
                >
                  Linear
                </PresetButton>
              </ToolPresets>
            </>
          )}

          {activeTool === "volume" && (
            <>
              <PresetChoices
                label="Volume"
                values={AUDIO_VOLUME_PRESETS}
                current={draft.volume}
                format={formatVolume}
                disabled={locked}
                onSelect={edit.setVolume}
              />
              <ToolPresets label="Level">
                {AUDIO_LEVELS.map((level) => (
                  <PresetButton
                    key={level.value}
                    active={draft.level === level.value}
                    disabled={locked}
                    onClick={() => edit.setLevel(level.value)}
                  >
                    {level.label}
                  </PresetButton>
                ))}
              </ToolPresets>
            </>
          )}

          {activeTool === "speed" && (
            <>
              <PresetChoices
                label="Speed"
                values={SPEED_PRESETS}
                current={draft.speed}
                format={formatSpeed}
                disabled={locked}
                onSelect={edit.setSpeed}
              />
              <div className="edit-panel__dial">
                <RulerDial
                  label="Pitch"
                  value={draft.pitch}
                  min={-AUDIO_PITCH_MAX_SEMITONES}
                  max={AUDIO_PITCH_MAX_SEMITONES}
                  step={1}
                  format={(value) => `${formatPitch(value)} st`}
                  disabled={locked}
                  onChange={edit.setPitch}
                />
              </div>
            </>
          )}

          {activeTool === "eq" && (
            <>
              <ToolPresets label="Band">
                {BANDS.map((entry) => (
                  <PresetButton
                    key={entry.id}
                    active={entry.id === band.id}
                    disabled={locked}
                    onClick={() => setBandId(entry.id)}
                  >
                    {entry.label}
                  </PresetButton>
                ))}
              </ToolPresets>
              <div className="edit-panel__dial">
                <RulerDial
                  key={band.id}
                  label={band.label}
                  value={band.shown(draft.effects)}
                  min={band.min}
                  max={band.max}
                  step={band.step}
                  rest={band.rest}
                  format={band.format}
                  disabled={locked}
                  onChange={(value) => edit.setEffects({ [band.id]: band.stored(value) })}
                />
              </div>
            </>
          )}

          {activeTool === "clean" && (
            <div className="edit-panel__dial">
              <RulerDial
                label="Noise reduction"
                value={Math.round(draft.effects.noise_reduction * 100)}
                min={0}
                max={100}
                step={1}
                format={(value) => (value === 0 ? "Off" : `${value}%`)}
                disabled={locked}
                onChange={(value) => edit.setEffects({ noise_reduction: value / 100 })}
              />
            </div>
          )}
        </div>

        <ToolHint>
          {activeTool === "volume"
            ? (AUDIO_LEVELS.find((level) => level.value === draft.level)?.hint ?? HINTS.volume)
            : HINTS[activeTool]}
        </ToolHint>
      </div>

      <div className="edit-panel__footer">
        <p className="edit-panel__output">
          {edit.ready ? (
            <>
              <OutputChange
                from={formatFrameTime(edit.duration)}
                to={formatFrameTime(edit.outputSeconds)}
              />
              {modified.volume && draft.volume !== 1 && (
                <OutputPart>Volume {formatVolume(draft.volume)}</OutputPart>
              )}
              {draft.level === "normalize" && (
                <OutputPart>{edit.measuring ? "Measuring loudness..." : "Normalized"}</OutputPart>
              )}
              {draft.level === "limit" && <OutputPart>Peaks limited</OutputPart>}
              {draft.pitch !== 0 && <OutputPart>Pitch {formatPitch(draft.pitch)}</OutputPart>}
              {modified.eq && <OutputPart>EQ</OutputPart>}
              {modified.clean && <OutputPart>Noise reduced</OutputPart>}
              {edit.preparingPreview && <OutputPart>Preparing preview...</OutputPart>}
              {edit.previewError && <OutputPart>Preview failed: {edit.previewError}</OutputPart>}
              {edit.previewLimited && (modified.eq || draft.volume > 1) && (
                <OutputPart>No live preview in this browser</OutputPart>
              )}
            </>
          ) : (
            <OutputPart>The timeline loads with the sound.</OutputPart>
          )}
        </p>

        {edit.applying ? (
          <div className="edit-panel__actions">
            <span
              className="edit-panel__rendering"
              role="progressbar"
              aria-label="Rendering"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={edit.progress == null ? undefined : Math.round(edit.progress * 100)}
            >
              <Icon icon={iconLoader2} spin />
              {edit.progress == null ? "Rendering" : `${Math.round(edit.progress * 100)}%`}
            </span>
            <button type="button" className="edit-panel__control" onClick={edit.cancel}>
              Cancel
            </button>
          </div>
        ) : (
          <EditActions edit={edit} disabled={locked} onRevertRequested={onRevertRequested} />
        )}
      </div>
    </div>
  );
}
