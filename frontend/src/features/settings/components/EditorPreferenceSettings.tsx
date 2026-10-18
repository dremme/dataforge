import { iconFileText, iconSpellCheck2 } from "@/shared/icons";
import { SPELLCHECK_LANGUAGES, type EditorOptions } from "@/shared/preferences/editorPreferences";
import type { SpellcheckLanguage } from "@/shared/types";
import { ModalSelect, type ModalSelectOption } from "@/shared/ui/ModalSelect";
import { SettingsCheckbox } from "./SettingsCheckbox";
import { SettingsGroup } from "./SettingsGroup";

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

const LANGUAGE_OPTIONS: ModalSelectOption<SpellcheckLanguage>[] = SPELLCHECK_LANGUAGES.map(
  (code) => ({ value: code, title: languageNames.of(code) ?? code }),
).sort((a, b) => a.title.localeCompare(b.title));

interface EditorPreferenceSettingsProps {
  value: EditorOptions;
  disabled: boolean;
  onChange: (value: EditorOptions) => void;
}

export function EditorPreferenceSettings({
  value,
  disabled,
  onChange,
}: EditorPreferenceSettingsProps) {
  const change = (partial: Partial<EditorOptions>) => onChange({ ...value, ...partial });

  return (
    <>
      <SettingsGroup
        title="All editors"
        icon={iconFileText}
        hint="Captions, folder instructions, and training templates."
      >
        <div className="settings-group__checks">
          <SettingsCheckbox
            label="Wrap long lines"
            checked={value.lineWrap}
            disabled={disabled}
            onChange={(lineWrap) => change({ lineWrap })}
          />
          <SettingsCheckbox
            label="Show line numbers"
            checked={value.lineNumbers}
            disabled={disabled}
            onChange={(lineNumbers) => change({ lineNumbers })}
          />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Captions" icon={iconSpellCheck2}>
        <div className="settings-modal__row">
          <SettingsCheckbox
            label="Check spelling"
            hint="Uses the browser's dictionaries. Chrome and Edge may follow their own language settings instead."
            checked={value.captionSpellcheck}
            disabled={disabled}
            onChange={(captionSpellcheck) => change({ captionSpellcheck })}
          />
          <ModalSelect
            label="Spelling language"
            value={value.captionSpellcheckLanguage}
            options={LANGUAGE_OPTIONS}
            disabled={disabled || !value.captionSpellcheck}
            onChange={(captionSpellcheckLanguage) => change({ captionSpellcheckLanguage })}
          />
        </div>
        <SettingsCheckbox
          label="Suggest words while typing"
          hint="Suggestions come from this folder's captions. Ctrl+Space still shows them when this is off."
          checked={value.captionSuggestions}
          disabled={disabled}
          onChange={(captionSuggestions) => change({ captionSuggestions })}
        />
      </SettingsGroup>
    </>
  );
}
