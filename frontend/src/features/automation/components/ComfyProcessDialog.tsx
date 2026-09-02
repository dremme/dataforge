import { useCallback, useEffect, useId, useState } from "react";
import { fetchComfyPresets } from "@/features/automation/api/jobs";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { formatApiError } from "@/shared/api/http";
import { iconLoader2, iconTriangleAlert } from "@/shared/icons";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import { Icon } from "@/shared/ui/Icon";
import type { ComfyPresetSummary } from "@/shared/types";

export interface ComfyProcessSettings {
  preset: string;
  /** Null runs whatever seeds the preset itself carries. */
  seed: number | null;
  /** Empty runs whatever text the preset's prompt node was saved with. */
  promptText: string;
  overwriteCandidates: boolean;
}

interface ComfyProcessDialogProps {
  scope: DialogScopeInfo;
  initialSettings: JobSettingsByType["comfy_process"];
  busy?: boolean;
  onConfirm: (settings: ComfyProcessSettings) => void;
  onCancel: () => void;
}

type PresetsState =
  | { status: "loading" }
  | { status: "ready"; presets: ComfyPresetSummary[]; available: boolean; baseUrl: string }
  | { status: "error"; message: string };

export function ComfyProcessDialog({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: ComfyProcessDialogProps) {
  const [state, setState] = useState<PresetsState>({ status: "loading" });
  const [preset, setPreset] = useState(initialSettings.preset);
  const [seedText, setSeedText] = useState(
    initialSettings.seed === null ? "" : String(initialSettings.seed),
  );
  const [promptText, setPromptText] = useState(initialSettings.prompt_text);
  const [overwrite, setOverwrite] = useState(initialSettings.overwrite_candidates);
  const [error, setError] = useState<string | null>(null);
  const promptId = useId();
  const seedId = useId();
  const overwriteId = useId();
  const errorId = useId();
  const presetId = useId();

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetchComfyPresets(controller.signal);
        if (controller.signal.aborted) return;

        setState({
          status: "ready",
          presets: response.presets,
          available: response.available,
          baseUrl: response.base_url,
        });
        // Honour a stored name only once the list is known, or the select shows a missing option.
        setPreset((current) =>
          response.presets.some((entry) => entry.name === current)
            ? current
            : (response.presets[0]?.name ?? ""),
        );
      } catch (caught) {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: formatApiError(caught) });
      }
    })();

    return () => controller.abort();
  }, []);

  const handleConfirm = useCallback(() => {
    if (busy) return;

    if (!preset) {
      setError("Choose a workflow preset.");
      return;
    }

    const trimmed = seedText.trim();
    if (trimmed && !/^\d+$/.test(trimmed)) {
      setError("The seed must be a whole number, or empty to use the preset's own.");
      return;
    }

    setError(null);
    onConfirm({
      preset,
      seed: trimmed ? Number(trimmed) : null,
      promptText: promptText.trim(),
      overwriteCandidates: overwrite,
    });
  }, [busy, onConfirm, overwrite, preset, promptText, seedText]);

  const ready = state.status === "ready";
  const disabled = busy || !ready;

  return (
    <Dialog
      scope={scope}
      title="Process with ComfyUI?"
      description={
        <>
          Runs each image through the workflow and writes the result as a <strong>candidate</strong>{" "}
          in the <strong>staging</strong> subfolder, for you to accept or reject.
        </>
      }
      panelClassName="comfy-process-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      describedById={error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Start processing"
          busyLabel="Starting..."
          busy={busy}
          confirmDisabled={disabled || !preset}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      {state.status === "loading" && (
        <p className="comfy-process-dialog__loading" role="status">
          <Icon icon={iconLoader2} spin className="comfy-process-dialog__loading-icon" />
          Loading workflow presets...
        </p>
      )}

      {state.status === "error" && (
        <p className="dialog__error" role="alert">
          Could not load workflow presets. {state.message}
        </p>
      )}

      {ready && state.presets.length === 0 && (
        <p className="dialog__hint">
          No workflow presets found. Export one from ComfyUI with <strong>Save (API Format)</strong>{" "}
          into the <strong>comfy-workflows</strong> folder, titling its loader node{" "}
          <strong>DataForge Input</strong>.
        </p>
      )}

      {ready && state.presets.length > 0 && (
        <div className="dialog__field">
          <label htmlFor={presetId} className="dialog__label">
            Workflow
          </label>
          <div className="dialog__select-wrap">
            <select
              id={presetId}
              className="dialog__select"
              value={preset}
              disabled={busy}
              onChange={(event) => {
                setPreset(event.target.value);
                setError(null);
              }}
            >
              {state.presets.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {ready && !state.available && (
        <div className="dialog__warning" role="alert">
          <Icon icon={iconTriangleAlert} className="dialog__warning-icon" />
          <span>
            ComfyUI is not answering at <strong>{state.baseUrl}</strong>. Start it before the job
            reaches the first image, or point <strong>COMFY_BASE_URL</strong> at the port it is
            listening on - otherwise every file will fail.
          </span>
        </div>
      )}

      <div className="dialog__field comfy-process-dialog__row">
        <div className="comfy-process-dialog__cell">
          <label htmlFor={promptId} className="dialog__label">
            Prompt
          </label>
          <input
            id={promptId}
            type="text"
            className="dialog__input"
            value={promptText}
            onChange={(event) => {
              setPromptText(event.target.value);
              setError(null);
            }}
            placeholder="e.g. sharp studio photograph, no watermark"
            disabled={busy}
          />
        </div>

        <div className="comfy-process-dialog__cell">
          <label htmlFor={seedId} className="dialog__label">
            Seed
          </label>
          <input
            id={seedId}
            type="number"
            className="dialog__input"
            value={seedText}
            onChange={(event) => {
              setSeedText(event.target.value);
              setError(null);
            }}
            placeholder="e.g. 424242"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
        </div>
      </div>

      <p className="dialog__hint">
        Both optional; written into the preset's <strong>DataForge Prompt</strong> and{" "}
        <strong>DataForge Seed</strong> nodes.
      </p>

      {error && (
        <p id={errorId} className="dialog__error" role="alert">
          {error}
        </p>
      )}

      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={overwriteId}>
          <input
            id={overwriteId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={overwrite}
            disabled={busy}
            onChange={(event) => setOverwrite(event.target.checked)}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">
            Replace candidates already waiting in <strong>staging</strong>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
