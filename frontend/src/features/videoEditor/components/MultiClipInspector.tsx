import type { ReactNode } from "react";
import {
  iconClipboardPaste,
  iconFilm,
  iconPalette,
  iconScaling,
  iconTimer,
  iconVolume2,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { percent, seconds } from "@/features/videoEditor/lib/sliderUnits";
import { restingAdjust, type Clip, type Project } from "@/features/videoEditor/lib/timeline";
import { GradePresets } from "./GradePresets";
import { HeaderAction, InspectorHeader, Panel, ResetButton, Slider } from "./InspectorParts";
import { TimecodeField } from "./TimecodeField";

import { effectsEqual } from "@/shared/lib/audioEffects";
import { SoundPanel } from "./SoundPanel";

/** Returns the change for one clip, or null when the setting does not apply to it. */
export type BatchEdit = (patch: (clip: Clip) => Partial<Clip> | null, final: boolean) => void;

interface MultiClipInspectorProps {
  project: Project;
  selection: Clip[];
  onBatchEdit: BatchEdit;
  /** Sets the length of the selected stills and titles. */
  onBatchLength: (seconds: number) => void;
  /** Present while the clipboard holds a clip whose settings can be pasted. */
  onPasteAttributes?: () => void;
  /** ``HeaderAction`` buttons for link and delete, which the single-clip view words differently. */
  actions: ReactNode;
  /** Sound clips whose noise-reduced proxy is still rendering. */
  preparingSound: ReadonlySet<string>;
}

/** The first clip's value, and whether the others differ from it. */
function shared(clips: Clip[], read: (clip: Clip) => number): { value: number; mixed: boolean } {
  const value = read(clips[0]);
  return { value, mixed: clips.some((clip) => Math.abs(read(clip) - value) > 1e-6) };
}

/**
 * One setting changed here is set on every selected clip it applies to, as one undo step.
 * A value the clips do not share shows the first clip's, marked as mixed.
 */
export function MultiClipInspector({
  project,
  selection,
  onBatchEdit,
  onBatchLength,
  onPasteAttributes,
  actions,
  preparingSound,
}: MultiClipInspectorProps) {
  const frame = 1 / project.frame_rate;
  const pictured = selection.filter((clip) => clip.kind === "video" || clip.kind === "image");
  const placed = selection.filter((clip) => clip.kind !== "audio" && clip.kind !== "title");
  const visual = selection.filter((clip) => clip.kind !== "audio");
  const audio = selection.filter((clip) => clip.kind === "audio");
  const sized = selection.filter((clip) => clip.kind === "image" || clip.kind === "title");
  const shortest = Math.min(...selection.map((clip) => clip.duration));
  const fadeIn = shared(selection, (clip) => clip.fade_in);
  const fadeOut = shared(selection, (clip) => clip.fade_out);

  return (
    <div className="video-editor__inspector-body" data-scroll-lock-allow>
      <InspectorHeader
        icon={iconFilm}
        kind="multiple"
        title={`${selection.length} clips selected`}
        meta="Settings here change every selected clip they apply to. Linked clips move together."
        actions={
          <>
            {onPasteAttributes && (
              <HeaderAction
                icon={iconClipboardPaste}
                label="Paste attributes..."
                onClick={onPasteAttributes}
              />
            )}
            {actions}
          </>
        }
      />

      <Panel title="Timing" icon={iconTimer}>
        {sized.length > 0 && (
          <div className="video-editor__field">
            <span>
              {shared(sized, (clip) => clip.duration).mixed ? "Length (mixed)" : "Length"}
            </span>
            <TimecodeField
              label="Length of the selected stills and titles"
              value={sized[0].duration}
              frameRate={project.frame_rate}
              onCommit={onBatchLength}
            />
          </div>
        )}
        <Slider
          label="Fade in"
          mixed={fadeIn.mixed}
          value={fadeIn.value}
          resting={0}
          min={0}
          max={Math.max(0, shortest / 2)}
          step={frame}
          unit={seconds}
          onChange={(value, final) => onBatchEdit(() => ({ fade_in: value }), final)}
        />
        <Slider
          label="Fade out"
          mixed={fadeOut.mixed}
          value={fadeOut.value}
          resting={0}
          min={0}
          max={Math.max(0, shortest / 2)}
          step={frame}
          unit={seconds}
          onChange={(value, final) => onBatchEdit(() => ({ fade_out: value }), final)}
        />
      </Panel>

      {audio.length > 0 && (
        <Panel title="Audio" icon={iconVolume2}>
          <Slider
            label="Gain"
            mixed={shared(audio, (clip) => clip.gain).mixed}
            value={audio[0].gain}
            resting={1}
            min={0}
            max={2}
            step={0.01}
            unit={percent}
            onChange={(value, final) =>
              onBatchEdit((clip) => (clip.kind === "audio" ? { gain: value } : null), final)
            }
          />
        </Panel>
      )}

      {audio.length > 0 && (
        <SoundPanel
          effects={audio[0].audio_effects}
          mixed={audio.some((clip) => !effectsEqual(clip.audio_effects, audio[0].audio_effects))}
          preparing={audio.some((clip) => preparingSound.has(clip.id))}
          onChange={(change, final) =>
            onBatchEdit(
              (clip) =>
                clip.kind === "audio"
                  ? { audio_effects: { ...clip.audio_effects, ...change } }
                  : null,
              final,
            )
          }
        />
      )}

      {visual.length > 0 && (
        <Panel title="Transform" icon={iconScaling}>
          {placed.length > 0 && (
            <>
              <div
                className="video-editor__segmented video-editor__segmented--wide"
                role="radiogroup"
                aria-label="Fit"
              >
                {(["fit", "fill"] as const).map((mode) => {
                  const on = placed.every((clip) => clip.fit === mode);
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={classNames(
                        "video-editor__segment",
                        on && "video-editor__segment--on",
                      )}
                      onClick={() =>
                        onBatchEdit(
                          (clip) =>
                            clip.kind === "audio" || clip.kind === "title" ? null : { fit: mode },
                          true,
                        )
                      }
                    >
                      {mode === "fit" ? "Fit" : "Fill"}
                    </button>
                  );
                })}
              </div>
              <Slider
                label="Scale"
                mixed={shared(placed, (clip) => clip.transform.scale).mixed}
                value={placed[0].transform.scale}
                resting={1}
                min={0.05}
                max={4}
                step={0.01}
                unit={percent}
                onChange={(value, final) =>
                  onBatchEdit(
                    (clip) =>
                      clip.kind === "audio" || clip.kind === "title"
                        ? null
                        : { transform: { ...clip.transform, scale: value } },
                    final,
                  )
                }
              />
            </>
          )}
          <Slider
            label="Opacity"
            mixed={shared(visual, (clip) => clip.transform.opacity).mixed}
            value={visual[0].transform.opacity}
            resting={1}
            min={0}
            max={1}
            step={0.01}
            unit={percent}
            onChange={(value, final) =>
              onBatchEdit(
                (clip) =>
                  clip.kind === "audio"
                    ? null
                    : { transform: { ...clip.transform, opacity: value } },
                final,
              )
            }
          />
        </Panel>
      )}

      {pictured.length > 0 && (
        <Panel
          title="Color"
          icon={iconPalette}
          action={
            <ResetButton
              label="Reset color of the selected clips"
              onClick={() =>
                onBatchEdit(
                  (clip) =>
                    clip.kind === "video" || clip.kind === "image"
                      ? { adjust: restingAdjust(), auto_adjust: null }
                      : null,
                  true,
                )
              }
            />
          }
        >
          <p className="video-editor__hint">
            Gives every selected picture the same saved grade. Individual sliders stay per clip.
          </p>
          <GradePresets
            onApply={(adjust) =>
              onBatchEdit(
                (clip) =>
                  clip.kind === "video" || clip.kind === "image"
                    ? { adjust, auto_adjust: null }
                    : null,
                true,
              )
            }
          />
        </Panel>
      )}
    </div>
  );
}
