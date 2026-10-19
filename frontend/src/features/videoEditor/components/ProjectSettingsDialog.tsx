import { useId, useState } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import { DialogSelect } from "@/shared/ui/DialogSelect";
import type { Project } from "@/features/videoEditor/lib/timeline";

interface ProjectSettingsDialogProps {
  project: Project;
  onSave: (patch: Pick<Project, "width" | "height" | "frame_rate">) => void;
  onCancel: () => void;
}

/** Canvas size and frame rate; presets from the project's own videos come first. */
export function ProjectSettingsDialog({ project, onSave, onCancel }: ProjectSettingsDialogProps) {
  const [width, setWidth] = useState(String(project.width));
  const [height, setHeight] = useState(String(project.height));
  const savedRate = String(Number(project.frame_rate.toFixed(3)));
  const [rate, setRate] = useState(savedRate);
  const widthId = useId();
  const heightId = useId();
  const rateId = useId();

  const parsed = {
    width: Math.round(Number(width)),
    height: Math.round(Number(height)),
    frame_rate: Number(rate),
  };
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
  const save = () => {
    if (error) return;
    onSave({
      width: Math.max(2, Math.floor(parsed.width / 2) * 2),
      height: Math.max(2, Math.floor(parsed.height / 2) * 2),
      frame_rate: parsed.frame_rate,
    });
  };

  return (
    <Dialog
      unsavedChanges={
        width !== String(project.width) || height !== String(project.height) || rate !== savedRate
      }
      title="Project settings"
      role="dialog"
      panelClassName="video-settings-dialog"
      description="The canvas every clip is placed on and the rate the timeline steps in. Odd sizes round down to even, which the encoder needs."
      onConfirm={save}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Apply"
          confirmDisabled={Boolean(error)}
          onConfirm={save}
          onCancel={onCancel}
        />
      }
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
                source.frame_rate ? `, ${Number(source.frame_rate.toFixed(3))} fps` : ""
              })`,
            })),
          ]}
          onChange={(id) => {
            const source = videos.find((item) => item.id === id);
            if (!source) return;
            setWidth(String(source.width));
            setHeight(String(source.height));
            if (source.frame_rate) setRate(String(Number(source.frame_rate.toFixed(3))));
          }}
        />
      )}
      <div className="video-settings-dialog__row">
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
            Frame rate
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
      {error && <p className="dialog__error">{error}</p>}
    </Dialog>
  );
}
