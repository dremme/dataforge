import { GuardedDialog } from "@/shared/ui/GuardedDialog";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { comfyPresetsQueryOptions } from "@/features/automation/lib/automationQueries";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { formatApiError } from "@/shared/api/http";
import { iconLoader2, iconTriangleAlert } from "@/shared/icons";
import { DialogActions } from "@/shared/ui/Dialog";
import { DialogSelect } from "@/shared/ui/DialogSelect";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import { Icon } from "@/shared/ui/Icon";
import { classNames } from "@/shared/lib/classNames";
import type {
  ComfyInputValue,
  ComfyPresetInput,
  ComfyPresetSettings,
  ComfyPresetSummary,
} from "@/shared/types";

export interface ComfyProcessSettings {
  preset: string;
  /** Null runs whatever seeds the preset itself carries. */
  seed: number | null;
  /** Empty runs whatever text the preset's prompt node was saved with. */
  promptText: string;
  /** By custom input name; a name left out runs with the preset's saved value. */
  inputs: Record<string, ComfyInputValue>;
  overwriteCandidates: boolean;
}

interface ComfyProcessDialogProps {
  scope: DialogScopeInfo;
  initialSettings: JobSettingsByType["comfy_process"];
  busy?: boolean;
  onConfirm: (settings: ComfyProcessSettings) => void;
  onCancel: () => void;
}

type BooleanChoice = "" | "on" | "off";

interface PresetDraft {
  seedText: string;
  promptText: string;
  /** Field text by input name; a boolean holds a `BooleanChoice`. Empty runs the saved value. */
  inputs: Record<string, string>;
}

const EMPTY_DRAFT: PresetDraft = { seedText: "", promptText: "", inputs: {} };

function inputText(value: ComfyInputValue): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}

function toDraft(settings: ComfyPresetSettings): PresetDraft {
  return {
    seedText: settings.seed == null ? "" : String(settings.seed),
    promptText: settings.prompt_text,
    inputs: Object.fromEntries(
      Object.entries(settings.inputs).map(([name, value]) => [name, inputText(value)]),
    ),
  };
}

function sameDraft(a: PresetDraft, b: PresetDraft): boolean {
  const names = new Set([...Object.keys(a.inputs), ...Object.keys(b.inputs)]);
  return (
    a.seedText === b.seedText &&
    a.promptText === b.promptText &&
    [...names].every((name) => (a.inputs[name] ?? "") === (b.inputs[name] ?? ""))
  );
}

const KIND_NOUNS: Record<ComfyPresetInput["kind"], string> = {
  boolean: "on or off",
  integer: "a whole number",
  number: "a number",
  text: "text",
};

/** The value to send, null for an empty field, or undefined when the text does not parse. */
function parseInput(input: ComfyPresetInput, text: string): ComfyInputValue | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (input.kind === "text") return text;
  if (input.kind === "boolean") return trimmed === "on";
  if (input.kind === "integer") return /^-?\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  const presetsQuery = useQuery(comfyPresetsQueryOptions());
  const state: PresetsState = presetsQuery.data
    ? {
        status: "ready",
        presets: presetsQuery.data.presets,
        available: presetsQuery.data.available,
        baseUrl: presetsQuery.data.base_url,
      }
    : presetsQuery.isError
      ? { status: "error", message: formatApiError(presetsQuery.error) }
      : { status: "loading" };
  const [chosenPreset, setChosenPreset] = useState(initialSettings.preset);
  // Honour a stored name only once the list is known, or the select shows a missing option.
  const loadedPresets = presetsQuery.data?.presets;
  const resolvePreset = (name: string) =>
    loadedPresets && !loadedPresets.some((entry) => entry.name === name)
      ? (loadedPresets[0]?.name ?? "")
      : name;
  const preset = resolvePreset(chosenPreset);
  // One draft per preset, so switching workflows never loses what was typed for another.
  const [drafts, setDrafts] = useState<Record<string, PresetDraft>>(() =>
    Object.fromEntries(
      Object.entries(initialSettings.by_preset).map(([name, saved]) => [name, toDraft(saved)]),
    ),
  );
  const { seedText, promptText, inputs: inputTexts } = drafts[preset] ?? EMPTY_DRAFT;
  const updateDraft = (patch: Partial<PresetDraft>) =>
    setDrafts((current) => ({
      ...current,
      [preset]: { ...(current[preset] ?? EMPTY_DRAFT), ...patch },
    }));
  const [error, setError] = useState<string | null>(null);
  const promptId = useId();
  const seedId = useId();
  const [overwrite, setOverwrite] = useState(initialSettings.overwrite_candidates);
  const overwriteId = useId();
  const errorId = useId();

  const selected = state.status === "ready" ? state.presets.find((e) => e.name === preset) : null;
  // Only false blocks: a preset that could not be parsed reports null and keeps both fields live.
  const promptBlocked = selected?.accepts_prompt === false;
  const seedBlocked = selected?.accepts_seed === false;
  const customInputs = selected?.inputs ?? [];

  const handleConfirm = () => {
    if (busy || state.status !== "ready") return;

    if (!preset) {
      setError("Choose a workflow preset.");
      return;
    }

    const trimmed = seedText.trim();
    if (trimmed && !/^\d+$/.test(trimmed)) {
      setError("The seed must be a whole number, or empty to use the preset's own.");
      return;
    }

    // Only the selected preset's inputs: a remembered name its file no longer has is dropped.
    const inputs: Record<string, ComfyInputValue> = {};
    for (const input of customInputs) {
      const value = parseInput(input, inputTexts[input.name] ?? "");
      if (value === undefined) {
        setError(
          `${input.name} must be ${KIND_NOUNS[input.kind]}, or empty to use the preset's own.`,
        );
        return;
      }
      if (value !== null) inputs[input.name] = value;
    }

    setError(null);
    onConfirm({
      preset,
      seed: seedBlocked || !trimmed ? null : Number(trimmed),
      promptText: promptBlocked ? "" : promptText.trim(),
      inputs,
      overwriteCandidates: overwrite,
    });
  };

  const ready = state.status === "ready";
  const disabled = busy || !ready;

  return (
    <GuardedDialog
      confirmDisabled={disabled || !preset}
      unsavedChanges={
        preset !== resolvePreset(initialSettings.preset) ||
        overwrite !== initialSettings.overwrite_candidates ||
        Object.entries(drafts).some(([name, draft]) => {
          const saved = initialSettings.by_preset[name];
          return !sameDraft(draft, saved ? toDraft(saved) : EMPTY_DRAFT);
        })
      }
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
          into the <strong>comfy_workflows</strong> folder, titling its loader node{" "}
          <strong>DataForge Input</strong>.
        </p>
      )}

      {ready && state.presets.length > 0 && (
        <DialogSelect
          label="Workflow"
          value={preset}
          options={state.presets.map((entry) => ({ value: entry.name, title: entry.name }))}
          disabled={busy}
          onChange={(value) => {
            setChosenPreset(value);
            setError(null);
          }}
        />
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
            value={promptBlocked ? "" : promptText}
            onChange={(event) => {
              updateDraft({ promptText: event.target.value });
              setError(null);
            }}
            placeholder={
              promptBlocked
                ? "This preset has no prompt node"
                : "e.g. sharp studio photograph, no watermark"
            }
            disabled={busy || promptBlocked}
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
            value={seedBlocked ? "" : seedText}
            onChange={(event) => {
              updateDraft({ seedText: event.target.value });
              setError(null);
            }}
            placeholder={seedBlocked ? "This preset has no seed node" : "e.g. 424242"}
            spellCheck={false}
            autoComplete="off"
            disabled={busy || seedBlocked}
          />
        </div>
      </div>

      <p className="dialog__hint">
        {promptBlocked && seedBlocked ? (
          <>
            This preset has neither a <strong>DataForge Prompt</strong> nor a{" "}
            <strong>DataForge Seed</strong> node, so it runs exactly as saved.
          </>
        ) : promptBlocked ? (
          <>
            This preset has no <strong>DataForge Prompt</strong> node. The seed is optional and is
            written into its <strong>DataForge Seed</strong> node.
          </>
        ) : seedBlocked ? (
          <>
            This preset has no <strong>DataForge Seed</strong> node. The prompt is optional and is
            written into its <strong>DataForge Prompt</strong> node.
          </>
        ) : (
          <>
            Both optional; written into the preset's <strong>DataForge Prompt</strong> and{" "}
            <strong>DataForge Seed</strong> nodes.
          </>
        )}
      </p>

      {customInputs.length > 0 && (
        <div className="dialog__field comfy-process-dialog__inputs">
          {customInputs.map((input) => (
            <CustomInputField
              key={input.name}
              input={input}
              text={inputTexts[input.name] ?? ""}
              disabled={busy}
              onChange={(text) => {
                updateDraft({ inputs: { ...inputTexts, [input.name]: text } });
                setError(null);
              }}
            />
          ))}
        </div>
      )}

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
    </GuardedDialog>
  );
}

interface CustomInputFieldProps {
  input: ComfyPresetInput;
  text: string;
  disabled: boolean;
  onChange: (text: string) => void;
}

/** One `DataForge <name>` node; the saved value is the placeholder an empty field runs with. */
function CustomInputField({ input, text, disabled, onChange }: CustomInputFieldProps) {
  const id = useId();

  if (input.kind === "boolean") {
    return (
      <DialogSelect<BooleanChoice>
        label={input.name}
        value={text === "on" || text === "off" ? text : ""}
        options={[
          { value: "", title: `Default (${input.default ? "on" : "off"})` },
          { value: "on", title: "On" },
          { value: "off", title: "Off" },
        ]}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  const numeric = input.kind !== "text";
  return (
    <div
      className={classNames(
        "comfy-process-dialog__cell",
        !numeric && "comfy-process-dialog__cell--wide",
      )}
    >
      <label htmlFor={id} className="dialog__label">
        {input.name}
      </label>
      <input
        id={id}
        type={numeric ? "number" : "text"}
        step={input.kind === "integer" ? 1 : numeric ? "any" : undefined}
        className="dialog__input"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder={String(input.default)}
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
      />
    </div>
  );
}
