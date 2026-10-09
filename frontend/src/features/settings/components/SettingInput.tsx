import { useId } from "react";
import type { AppSettingKey, AppSettingsResponse } from "@/shared/types";
import { SETTING_FIELDS } from "../lib/settingsForm";

type SettingState = AppSettingsResponse[AppSettingKey];

const INPUT_TYPES = {
  url: "url",
  text: "text",
  integer: "number",
  decimal: "number",
  secret: "password",
} as const;

type BadgeTone = "default" | "env" | "saved" | "pending";

function describeSource(
  state: SettingState,
  edited: boolean,
  pendingReset: boolean,
): { tone: BadgeTone; badge: string; detail?: string } {
  const fallback = state.fallback_source === "env" ? ".env value" : "default";
  if (pendingReset) {
    return { tone: "pending", badge: "Will reset", detail: `Returns to the ${fallback} on save` };
  }
  if (edited) return { tone: "pending", badge: "Edited" };

  switch (state.source) {
    case "default":
      return { tone: "default", badge: "is_set" in state ? "Not set" : "Default" };
    case "env":
      return { tone: "env", badge: ".env" };
    case "saved":
      return {
        tone: "saved",
        badge: "Saved",
        detail:
          "value" in state
            ? `Overrides ${fallback} ${state.fallback}`
            : `Overrides the ${fallback}`,
      };
  }
}

function placeholderFor(state: SettingState): string {
  if ("value" in state) return String(state.fallback);
  return state.is_set ? "Saved key is hidden" : "No key";
}

interface SettingInputProps {
  settingKey: AppSettingKey;
  state: SettingState;
  value: string;
  edited: boolean;
  pendingReset: boolean;
  invalid: boolean;
  disabled: boolean;
  /** Offered as the user types, e.g. the model ids a server reported. */
  suggestions?: readonly string[];
  onChange: (value: string) => void;
  onReset: () => void;
}

export function SettingInput({
  settingKey,
  state,
  value,
  edited,
  pendingReset,
  invalid,
  disabled,
  suggestions = [],
  onChange,
  onReset,
}: SettingInputProps) {
  const inputId = useId();
  const badgeId = useId();
  const detailId = useId();
  const listId = useId();
  const field = SETTING_FIELDS[settingKey];
  const source = describeSource(state, edited, pendingReset);
  const canReset = state.source === "saved" && !pendingReset;
  const secret = field.kind === "secret";
  const range = "minimum" in state ? state : null;

  return (
    <div className="setting-field">
      <div className="setting-field__head">
        <label className="setting-field__label" htmlFor={inputId}>
          {field.label}
          {field.unit && (
            <>
              {" "}
              <span className="setting-field__unit">({field.unit})</span>
            </>
          )}
        </label>
        <span
          id={badgeId}
          className={`setting-field__badge setting-field__badge--${source.tone}`}
          title={source.tone === "env" ? "From .env or the environment" : undefined}
        >
          {source.badge}
        </span>
      </div>
      <input
        id={inputId}
        className="setting-field__input"
        type={INPUT_TYPES[field.kind]}
        min={range?.minimum}
        max={range?.maximum ?? undefined}
        step={range ? (field.step ?? 1) : undefined}
        spellCheck={false}
        autoComplete={secret ? "new-password" : "off"}
        placeholder={placeholderFor(state)}
        list={suggestions.length ? listId : undefined}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={source.detail ? `${badgeId} ${detailId}` : badgeId}
        onChange={(event) => onChange(event.target.value)}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
      {(source.detail || canReset) && (
        <div className="setting-field__foot">
          <span id={detailId} className="setting-field__detail">
            {source.detail}
          </span>
          {canReset && (
            <button
              type="button"
              className="setting-field__reset"
              disabled={disabled}
              aria-label={`Reset ${field.label}`}
              onClick={onReset}
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
