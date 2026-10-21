import { describe, expect, it } from "vitest";
import {
  audioDraftFromSpec,
  audioOutputDuration,
  audioSpecsEqual,
  emptyAudioDraft,
  fadeGainAt,
  fittedFades,
  formatPitch,
  isIdentityAudioEdit,
  loudnessKey,
  toAudioEditSpec,
} from "./audioEdit";

describe("audio edit draft", () => {
  it("is an identity edit until something changes", () => {
    const draft = emptyAudioDraft(10);
    expect(isIdentityAudioEdit(draft, 10)).toBe(true);
    expect(isIdentityAudioEdit({ ...draft, pitch: 2 }, 10)).toBe(false);
    expect(isIdentityAudioEdit({ ...draft, effects: { ...draft.effects, mid: 3 } }, 10)).toBe(
      false,
    );
    expect(isIdentityAudioEdit({ ...draft, level: "limit" }, 10)).toBe(false);
  });

  it("sends a trim to the end as running to the end", () => {
    const spec = toAudioEditSpec({ ...emptyAudioDraft(10), trimStart: 2 }, 10);
    expect(spec.trim_start).toBe(2);
    expect(spec.trim_end).toBeNull();
  });

  it("round-trips through the wire form", () => {
    const draft = {
      ...emptyAudioDraft(10),
      trimStart: 1,
      trimEnd: 7,
      fadeOut: 1.5,
      speed: 2,
      pitch: -3,
    };
    const spec = toAudioEditSpec(draft, 10);
    expect(audioSpecsEqual(toAudioEditSpec(audioDraftFromSpec(spec, 10), 10), spec)).toBe(true);
  });

  it("measures the output in retimed seconds", () => {
    expect(audioOutputDuration({ ...emptyAudioDraft(10), trimStart: 2, speed: 2 })).toBe(4);
  });

  it("shortens fades that no longer fit, the out side first", () => {
    const draft = { ...emptyAudioDraft(10), fadeIn: 3, fadeOut: 3, trimEnd: 4 };
    expect(fittedFades(draft)).toMatchObject({ fadeIn: 3, fadeOut: 1 });
  });

  it("fades in output time, with the chosen curve", () => {
    const draft = { ...emptyAudioDraft(10), speed: 2, fadeIn: 1, fadeCurve: "linear" as const };
    // One output second of fade is two source seconds at double speed.
    expect(fadeGainAt(draft, 1)).toBeCloseTo(0.5);
    expect(fadeGainAt({ ...draft, fadeCurve: "equal_power" }, 1)).toBeCloseTo(Math.SQRT1_2);
    expect(fadeGainAt(draft, 5)).toBe(1);
  });

  it("measures loudness without the level stage", () => {
    const spec = toAudioEditSpec({ ...emptyAudioDraft(10), level: "normalize", volume: 0.5 }, 10);
    expect(loudnessKey(spec)).toEqual({ ...spec, level: "unchanged" });
  });

  it("signs a pitch move", () => {
    expect(formatPitch(3)).toBe("+3");
    expect(formatPitch(-2)).toBe("−2");
    expect(formatPitch(0)).toBe("0");
  });
});
