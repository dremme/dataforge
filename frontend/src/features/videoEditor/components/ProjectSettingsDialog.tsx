import { GuardedDialog } from "@/shared/ui/GuardedDialog";
import { useId, useState } from "react";
import { VIDEO_PROJECT_SIZE_PRESET_SHORT_SIDES } from "@/shared/constants";
import { iconArrowLeftRight } from "@/shared/icons";
import { DialogActions } from "@/shared/ui/Dialog";
import { DialogSelect } from "@/shared/ui/DialogSelect";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import {
  even,
  frameFromShortSide,
  projectOrientation,
} from "@/features/videoEditor/lib/composition";
import {
  ASPECT_PRESETS,
  aspectLabel,
  FRAME_RATE_PRESETS,
  matchAspect,
  matchFrameRate,
  matchResolution,
  RESOLUTION_NAMES,
  RESOLUTION_PRESETS,
  ratioLabel,
  type ResolutionPreset,
} from "@/features/videoEditor/lib/projectFormat";
import type { Project } from "@/features/videoEditor/lib/timeline";

type ProjectSettings = Pick<Project, "width" | "height" | "frame_rate" | "background">;

interface ProjectSettingsDialogProps {
  project: Project;
  onSave: (patch: ProjectSettings) => void;
  onCancel: () => void;
}

const CUSTOM = "custom";
/** The short side an aspect is applied to while the typed size is unusable. */
const FALLBACK_SHORT_SIDE = 1080;

function formatRate(rate: number): string {
  return String(Number(rate.toFixed(3)));
}

/**
 * Canvas size, frame rate and background. The size and rate fields are the truth; the preset
 * selects are read back from them, so a typed value that no preset names shows as Custom.
 */
export function ProjectSettingsDialog({ project, onSave, onCancel }: ProjectSettingsDialogProps) {
  const savedRate = formatRate(project.frame_rate);
  const [width, setWidth] = useState(String(project.width));
  const [height, setHeight] = useState(String(project.height));
  const [rate, setRate] = useState(savedRate);
  const [background, setBackground] = useState(project.background);
  const widthId = useId();
  const heightId = useId();
  const rateId = useId();
  const backgroundId = useId();

  const parsed = {
    width: Math.round(Number(width)),
    height: Math.round(Number(height)),
    frame_rate: Number(rate),
  };
  const sized = parsed.width > 0 && parsed.height > 0;
  const orientation = sized ? projectOrientation(parsed.width, parsed.height) : "landscape";
  const aspect = sized ? matchAspect(parsed.width, parsed.height) : null;
  const resolution = sized ? matchResolution(parsed.width, parsed.height) : null;
  const ratePreset = matchFrameRate(parsed.frame_rate);
  const error =
    !Number.isFinite(parsed.width) || parsed.width < 16 || parsed.width > 7680
      ? "Width must be between 16 and 7680 pixels."
      : !Number.isFinite(parsed.height) || parsed.height < 16 || parsed.height > 7680
        ? "Height must be between 16 and 7680 pixels."
        : !Number.isFinite(parsed.frame_rate) || parsed.frame_rate <= 0 || parsed.frame_rate > 120
          ? "The frame rate must be above 0 and at most 120."
          : null;
  const videos = project.sources.filter(
    (source) => source.kind === "video" && source.width && source.height,
  );

  const applyFrame = (frame: { width: number; height: number }) => {
    setWidth(String(frame.width));
    setHeight(String(frame.height));
  };
  const chooseAspect = (value: string) => {
    const preset = ASPECT_PRESETS.find((item) => item.value === value);
    if (!preset) return;
    const short = sized ? Math.min(parsed.width, parsed.height) : FALLBACK_SHORT_SIDE;
    const shape =
      preset.ratio === 1 ? "square" : orientation === "square" ? "landscape" : orientation;
    applyFrame(frameFromShortSide(short, preset.ratio, shape));
  };
  const chooseResolution = (value: string) => {
    if (!(value in VIDEO_PROJECT_SIZE_PRESET_SHORT_SIDES)) return;
    const short = VIDEO_PROJECT_SIZE_PRESET_SHORT_SIDES[value as ResolutionPreset];
    const ratio =
      aspect?.ratio ??
      (sized ? Math.max(parsed.width, parsed.height) / Math.min(parsed.width, parsed.height) : 1);
    applyFrame(frameFromShortSide(short, ratio, orientation));
  };
  const chooseRate = (value: string) => {
    const preset = FRAME_RATE_PRESETS.find((item) => item.value === value);
    if (preset) setRate(formatRate(preset.rate));
  };
  const save = () => {
    if (error) return;
    onSave({
      width: even(parsed.width),
      height: even(parsed.height),
      // An untouched rate keeps its stored value; a preset is stored exactly.
      frame_rate: rate === savedRate ? project.frame_rate : (ratePreset?.rate ?? parsed.frame_rate),
      background,
    });
  };

  const summary = error
    ? null
    : [
        `${even(parsed.width)} × ${even(parsed.height)}`,
        aspect ? aspectLabel(aspect.value, orientation) : ratioLabel(parsed.width, parsed.height),
        `${formatRate(ratePreset?.rate ?? parsed.frame_rate)} fps`,
      ].join(" · ");

  return (
    <GuardedDialog
      confirmDisabled={Boolean(error)}
      unsavedChanges={
        width !== String(project.width) ||
        height !== String(project.height) ||
        rate !== savedRate ||
        background !== project.background
      }
      title="Project settings"
      role="dialog"
      panelClassName="video-settings-dialog"
      description="The canvas every clip is placed on, the rate the timeline steps in, and the color behind the picture. Odd sizes round down to even, which the encoder needs."
      onConfirm={save}
      onClose={onCancel}
      footer={<DialogActions confirmLabel="Apply" onCancel={onCancel} />}
    >
      {videos.length > 0 && (
        <DialogSelect
          label="Match a video"
          value=""
          options={[
            { value: "", title: "Choose..." },
            ...videos.map((source) => ({
              value: source.id,
              title: `${source.name} (${source.width} × ${source.height}${
                source.frame_rate ? `, ${formatRate(source.frame_rate)} fps` : ""
              })`,
            })),
          ]}
          onChange={(id) => {
            const source = videos.find((item) => item.id === id);
            if (!source) return;
            setWidth(String(source.width));
            setHeight(String(source.height));
            if (source.frame_rate) setRate(formatRate(source.frame_rate));
          }}
        />
      )}
      <div className="video-settings-dialog__grid">
        <div className="video-settings-dialog__aspect">
          <DialogSelect
            label="Aspect ratio"
            value={aspect?.value ?? CUSTOM}
            options={[
              ...ASPECT_PRESETS.map((preset) => ({
                value: preset.value,
                title: [aspectLabel(preset.value, orientation), preset.name]
                  .filter(Boolean)
                  .join(" "),
              })),
              { value: CUSTOM, title: "Custom" },
            ]}
            onChange={chooseAspect}
          />
        </div>
        <DialogSelect
          label="Resolution"
          value={resolution ?? CUSTOM}
          options={[
            ...RESOLUTION_PRESETS.map((key) => ({
              value: key,
              title: `${key} ${RESOLUTION_NAMES[key]}`,
            })),
            { value: CUSTOM, title: "Custom" },
          ]}
          onChange={chooseResolution}
        />
        <DialogSelect
          label="Frame rate"
          value={ratePreset?.value ?? CUSTOM}
          options={[
            ...FRAME_RATE_PRESETS.map((preset) => ({
              value: preset.value,
              title: `${preset.value} fps`,
            })),
            { value: CUSTOM, title: "Custom" },
          ]}
          onChange={chooseRate}
        />
        <div className="dialog__field">
          <label className="dialog__label" htmlFor={widthId}>
            Width
          </label>
          <input
            id={widthId}
            className="dialog__input"
            inputMode="numeric"
            value={width}
            onChange={(event) => setWidth(event.target.value)}
          />
        </div>
        <Tooltip content="Swap width and height" className="video-settings-dialog__swap">
          <button
            type="button"
            className="video-editor__icon-btn"
            aria-label="Swap width and height"
            onClick={() => {
              setWidth(height);
              setHeight(width);
            }}
          >
            <Icon icon={iconArrowLeftRight} />
          </button>
        </Tooltip>
        <div className="dialog__field">
          <label className="dialog__label" htmlFor={heightId}>
            Height
          </label>
          <input
            id={heightId}
            className="dialog__input"
            inputMode="numeric"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
          />
        </div>
        <div className="dialog__field">
          <label className="dialog__label" htmlFor={rateId}>
            FPS
          </label>
          <input
            id={rateId}
            className="dialog__input"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </div>
      </div>
      <div className="dialog__field">
        <span className="dialog__label" id={backgroundId}>
          Background
        </span>
        <label className="video-editor__swatch video-settings-dialog__background">
          <input
            type="color"
            value={background}
            aria-labelledby={backgroundId}
            onChange={(event) => setBackground(event.target.value)}
          />
          <span>{background}</span>
        </label>
        <p className="dialog__hint">Shows in gaps, around fitted pictures and in export padding.</p>
      </div>
      {summary && (
        <p className="video-settings-dialog__summary" aria-live="polite">
          {summary}
        </p>
      )}
      {error && <p className="dialog__error">{error}</p>}
    </GuardedDialog>
  );
}
