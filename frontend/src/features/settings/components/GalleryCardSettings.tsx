import {
  LARGE_CARD_CAPTION_LINES,
  SMALL_CARD_CAPTION_LINES,
  type GalleryCardOptions,
} from "@/features/gallery/lib/cardOptions";
import { iconGrid2x2, iconRows3 } from "@/shared/icons";
import { DialogSelect, type DialogSelectOption } from "@/shared/ui/DialogSelect";
import { SettingsCheckbox } from "./SettingsCheckbox";
import { SettingsGroup } from "./SettingsGroup";

function lineOptions(counts: readonly number[]): DialogSelectOption<string>[] {
  return counts.map((count) => ({
    value: String(count),
    title: count === 0 ? "Off" : `${count} ${count === 1 ? "line" : "lines"}`,
  }));
}

const LARGE_OPTIONS = lineOptions(LARGE_CARD_CAPTION_LINES);
const SMALL_OPTIONS = lineOptions(SMALL_CARD_CAPTION_LINES);

interface GalleryCardSettingsProps {
  value: GalleryCardOptions;
  disabled: boolean;
  onChange: (value: GalleryCardOptions) => void;
}

export function GalleryCardSettings({ value, disabled, onChange }: GalleryCardSettingsProps) {
  const change = (partial: Partial<GalleryCardOptions>) => onChange({ ...value, ...partial });

  return (
    <>
      <SettingsGroup title="Cards" icon={iconGrid2x2}>
        <div className="settings-modal__row">
          <DialogSelect
            label="Large card caption"
            value={String(value.largeCaptionLines)}
            options={LARGE_OPTIONS}
            disabled={disabled}
            onChange={(lines) =>
              change({
                largeCaptionLines: Number(lines) as GalleryCardOptions["largeCaptionLines"],
              })
            }
          />
          <DialogSelect
            label="Small card caption"
            value={String(value.smallCaptionLines)}
            options={SMALL_OPTIONS}
            disabled={disabled}
            onChange={(lines) =>
              change({
                smallCaptionLines: Number(lines) as GalleryCardOptions["smallCaptionLines"],
              })
            }
          />
        </div>
        <div className="settings-group__checks">
          <SettingsCheckbox
            label="Show megapixels"
            checked={value.megapixels}
            disabled={disabled}
            onChange={(megapixels) => change({ megapixels })}
          />
          <SettingsCheckbox
            label="Show the aspect ratio on large cards"
            checked={value.largeAspectRatio}
            disabled={disabled}
            onChange={(largeAspectRatio) => change({ largeAspectRatio })}
          />
        </div>
      </SettingsGroup>
      <SettingsGroup title="List" icon={iconRows3}>
        <SettingsCheckbox
          label="Show a caption preview"
          hint="The start of each caption follows the file name, cut to one line."
          checked={value.listCaptionPreview}
          disabled={disabled}
          onChange={(listCaptionPreview) => change({ listCaptionPreview })}
        />
      </SettingsGroup>
    </>
  );
}
