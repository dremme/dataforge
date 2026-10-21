import {
  AUDIO_HIGH_CUT_MAX_HZ,
  AUDIO_LOW_CUT_MIN_HZ,
  AUDIO_EQ_BASS_HZ,
  AUDIO_EQ_MID_HZ,
  AUDIO_EQ_MID_Q,
  AUDIO_EQ_TREBLE_HZ,
} from "@/shared/constants";
import type { AudioEffects, VideoProjectFadeCurve } from "@/shared/types";

/**
 * Sound shaping as the preview plays it, for the gallery's audio edit and the editor's audio
 * clips. The bands mirror backend/audio_effects.py `eq_filters`: the same RBJ biquads, so what
 * plays is what renders. Noise reduction is not here: the server renders it into a proxy.
 */

export const RESTING_EFFECTS: Readonly<AudioEffects> = {
  low_cut: 0,
  high_cut: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  noise_reduction: 0,
};

/** A cut's Q is in dB here; ffmpeg's `p=2` Butterworth pair is a linear Q of 1/sqrt(2). */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

const EPSILON = 1e-9;

export function isEqIdentity(effects: AudioEffects): boolean {
  return (
    !effects.low_cut &&
    !effects.high_cut &&
    Math.abs(effects.bass) < EPSILON &&
    Math.abs(effects.mid) < EPSILON &&
    Math.abs(effects.treble) < EPSILON
  );
}

export function isEffectsIdentity(effects: AudioEffects): boolean {
  return isEqIdentity(effects) && effects.noise_reduction < EPSILON;
}

export function effectsEqual(a: AudioEffects, b: AudioEffects): boolean {
  return (
    a.low_cut === b.low_cut &&
    a.high_cut === b.high_cut &&
    Math.abs(a.bass - b.bass) < EPSILON &&
    Math.abs(a.mid - b.mid) < EPSILON &&
    Math.abs(a.treble - b.treble) < EPSILON &&
    Math.abs(a.noise_reduction - b.noise_reduction) < EPSILON
  );
}

/** A ramp's level for `progress` 0..1; equal power is ffmpeg's quarter sine, `qsin`. */
export function fadeCurveLevel(curve: VideoProjectFadeCurve, progress: number): number {
  const level = Math.min(1, Math.max(0, progress));
  return curve === "equal_power" ? Math.sin((level * Math.PI) / 2) : level;
}

export interface EffectsChain {
  /** Connect the sound into this, and this chain's output on; both stay put across updates. */
  input: AudioNode;
  output: AudioNode;
  update: (effects: AudioEffects) => void;
  disconnect: () => void;
}

interface Band {
  node: BiquadFilterNode;
  active: (effects: AudioEffects) => boolean;
  set: (effects: AudioEffects) => void;
}

/**
 * The five bands low to high, as in the render. Bands at rest are left out of the path, as the
 * render leaves out their filters: an idle cut is not quite flat at the bottom of the spectrum.
 */
export function createEffectsChain(context: BaseAudioContext): EffectsChain {
  const input = context.createGain();
  const output = context.createGain();
  const band = (
    type: BiquadFilterType,
    frequency: number,
    q: number,
    active: Band["active"],
    set: Band["set"],
  ): Band => {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return { node, active, set };
  };
  const bands = [
    band(
      "highpass",
      AUDIO_EQ_BASS_HZ,
      BUTTERWORTH_Q_DB,
      (effects) => effects.low_cut > 0,
      (effects) => (bands[0].node.frequency.value = effects.low_cut),
    ),
    band(
      "lowshelf",
      AUDIO_EQ_BASS_HZ,
      0,
      (effects) => Math.abs(effects.bass) >= EPSILON,
      (effects) => (bands[1].node.gain.value = effects.bass),
    ),
    band(
      "peaking",
      AUDIO_EQ_MID_HZ,
      AUDIO_EQ_MID_Q,
      (effects) => Math.abs(effects.mid) >= EPSILON,
      (effects) => (bands[2].node.gain.value = effects.mid),
    ),
    band(
      "highshelf",
      AUDIO_EQ_TREBLE_HZ,
      0,
      (effects) => Math.abs(effects.treble) >= EPSILON,
      (effects) => (bands[3].node.gain.value = effects.treble),
    ),
    band(
      "lowpass",
      AUDIO_EQ_TREBLE_HZ,
      BUTTERWORTH_Q_DB,
      (effects) => effects.high_cut > 0,
      (effects) => (bands[4].node.frequency.value = effects.high_cut),
    ),
  ];

  let path = "";
  const connect = (active: Band[]) => {
    input.disconnect();
    for (const { node } of bands) node.disconnect();
    let last: AudioNode = input;
    for (const { node } of active) {
      last.connect(node);
      last = node;
    }
    last.connect(output);
  };
  const update = (effects: AudioEffects) => {
    const active = bands.filter((entry) => entry.active(effects));
    for (const entry of active) entry.set(effects);
    // Rewired only when a band comes or goes, so dragging a gain does not click.
    const next = active.map((entry) => entry.node.type).join(",");
    if (next !== path) {
      path = next;
      connect(active);
    }
  };
  connect([]);

  return {
    input,
    output,
    update,
    disconnect: () => {
      input.disconnect();
      output.disconnect();
      for (const { node } of bands) node.disconnect();
    },
  };
}

/** A cut is stored as 0 when off; its dial shows off at the end where it stops cutting. */
export function lowCutFromDial(value: number): number {
  return value < AUDIO_LOW_CUT_MIN_HZ ? 0 : value;
}

export function highCutFromDial(value: number): number {
  return value >= AUDIO_HIGH_CUT_MAX_HZ ? 0 : value;
}

export function highCutDial(effects: AudioEffects): number {
  return effects.high_cut || AUDIO_HIGH_CUT_MAX_HZ;
}

export function formatDecibels(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0 dB";
  return `${rounded > 0 ? "+" : "\u2212"}${Math.abs(rounded)} dB`;
}

export function formatHertz(value: number): string {
  if (!value) return "Off";
  return value >= 1000 ? `${Math.round(value / 100) / 10} kHz` : `${Math.round(value)} Hz`;
}

export function formatHighCut(value: number): string {
  return formatHertz(highCutFromDial(value));
}
