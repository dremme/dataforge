import {
  AUDIO_EQ_MAX_DB,
  AUDIO_HIGH_CUT_MAX_HZ,
  AUDIO_HIGH_CUT_MIN_HZ,
  AUDIO_LOW_CUT_MAX_HZ,
} from "@/shared/constants";
import {
  formatDecibels,
  formatHertz,
  formatHighCut,
  highCutDial,
  highCutFromDial,
  isEffectsIdentity,
  lowCutFromDial,
  type GainBand,
} from "@/shared/lib/audioEffects";
import type { AudioEffects } from "@/shared/types";
import { EQ_PROPERTIES } from "@/features/videoEditor/lib/keyframes";
import type { Clip } from "@/features/videoEditor/lib/timeline";
import { Panel, Slider, type ClipEdit } from "./InspectorParts";
import { KeyedSlider, KeyframeBar } from "./KeyframeControls";

/** One clip's EQ bands can be keyframed; several clips' only set their static values. */
interface Keyed {
  clip: Clip;
  time: number;
  onEdit: ClipEdit;
  onSeek: (time: number) => void;
}

/** Sound shaping for audio clips: the gallery audio edit's EQ and noise reduction, per clip. */
export function SoundPanel({
  effects,
  preparing,
  mixed = false,
  keyed,
  onChange,
}: {
  effects: AudioEffects;
  /** Its noise-reduced proxy is still rendering, so the preview plays the source meanwhile. */
  preparing: boolean;
  /** Several clips are shown and their settings differ; the first one's are shown. */
  mixed?: boolean;
  keyed?: Keyed;
  onChange: (change: Partial<AudioEffects>, final: boolean) => void;
}) {
  const label = (text: string) => (mixed ? `${text} (mixed)` : text);
  const range = {
    resting: 0,
    min: -AUDIO_EQ_MAX_DB,
    max: AUDIO_EQ_MAX_DB,
    step: 0.5,
    format: formatDecibels,
  };
  const gain = (key: GainBand, text: string) =>
    keyed ? (
      <KeyedSlider
        clip={keyed.clip}
        property={key}
        time={keyed.time}
        label={text}
        onEdit={keyed.onEdit}
        {...range}
      />
    ) : (
      <Slider
        label={label(text)}
        value={effects[key]}
        onChange={(value, final) => onChange({ [key]: value }, final)}
        {...range}
      />
    );
  const animated = keyed && EQ_PROPERTIES.some((key) => keyed.clip.keyframes[key].length > 0);

  return (
    <Panel title="Sound" changed={!isEffectsIdentity(effects) || Boolean(animated)}>
      {keyed && (
        <KeyframeBar
          clip={keyed.clip}
          properties={EQ_PROPERTIES}
          time={keyed.time}
          onEdit={keyed.onEdit}
          onSeek={keyed.onSeek}
        />
      )}
      <Slider
        label={label("Low cut")}
        value={effects.low_cut}
        resting={0}
        min={0}
        max={AUDIO_LOW_CUT_MAX_HZ}
        step={5}
        format={formatHertz}
        onChange={(value, final) => onChange({ low_cut: lowCutFromDial(value) }, final)}
      />
      {gain("bass", "Bass")}
      {gain("mid", "Mid")}
      {gain("treble", "Treble")}
      <Slider
        label={label("High cut")}
        value={highCutDial(effects)}
        resting={AUDIO_HIGH_CUT_MAX_HZ}
        min={AUDIO_HIGH_CUT_MIN_HZ}
        max={AUDIO_HIGH_CUT_MAX_HZ}
        step={100}
        format={formatHighCut}
        onChange={(value, final) => onChange({ high_cut: highCutFromDial(value) }, final)}
      />
      <Slider
        label={label("Noise reduction")}
        value={effects.noise_reduction}
        resting={0}
        min={0}
        max={1}
        step={0.01}
        format={(value) => (value === 0 ? "Off" : `${Math.round(value * 100)}%`)}
        onChange={(value, final) => onChange({ noise_reduction: value }, final)}
      />
      {preparing && <p className="video-editor__hint">Preparing noise reduction...</p>}
    </Panel>
  );
}
