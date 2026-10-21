import { describe, expect, it } from "vitest";
import {
  AUDIO_EQ_BASS_HZ,
  AUDIO_EQ_MID_HZ,
  AUDIO_EQ_MID_Q,
  AUDIO_EQ_TREBLE_HZ,
} from "@/shared/constants";
import {
  BUTTERWORTH_Q_DB,
  RESTING_EFFECTS,
  createEffectsChain,
  fadeCurveLevel,
  isEffectsIdentity,
} from "./audioEffects";

class FakeNode {
  readonly outputs: FakeNode[] = [];
  connect(node: FakeNode) {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.outputs.length = 0;
  }
}

class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = { value: 350 };
  Q = { value: 1 };
  gain = { value: 0 };
}

function fakeContext() {
  return {
    createGain: () => new FakeNode(),
    createBiquadFilter: () => new FakeFilter(),
  } as unknown as BaseAudioContext;
}

/** The node types the sound passes through, input to output. */
function path(chain: ReturnType<typeof createEffectsChain>): FakeNode[] {
  const nodes: FakeNode[] = [];
  let node = chain.input as unknown as FakeNode;
  while (node !== (chain.output as unknown as FakeNode)) {
    node = node.outputs[0];
    if (node !== (chain.output as unknown as FakeNode)) nodes.push(node);
  }
  return nodes;
}

describe("audio effects chain", () => {
  it("passes the sound straight through at rest", () => {
    const chain = createEffectsChain(fakeContext());
    chain.update(RESTING_EFFECTS);
    expect(path(chain)).toEqual([]);
    expect(isEffectsIdentity(RESTING_EFFECTS)).toBe(true);
  });

  it("sets the bands the render draws, low to high", () => {
    const chain = createEffectsChain(fakeContext());
    chain.update({ ...RESTING_EFFECTS, low_cut: 80, bass: 4, mid: -3, treble: 2, high_cut: 9000 });

    const filters = path(chain) as FakeFilter[];
    expect(filters.map((filter) => filter.type)).toEqual([
      "highpass",
      "lowshelf",
      "peaking",
      "highshelf",
      "lowpass",
    ]);
    const [lowCut, bass, mid, treble, highCut] = filters;
    // The browser reads a cut's Q in dB: a Butterworth pair, as ffmpeg's p=2.
    expect(BUTTERWORTH_Q_DB).toBeCloseTo(-3.0103, 4);
    expect(lowCut).toMatchObject({ frequency: { value: 80 }, Q: { value: BUTTERWORTH_Q_DB } });
    expect(highCut).toMatchObject({ frequency: { value: 9000 }, Q: { value: BUTTERWORTH_Q_DB } });
    expect(bass).toMatchObject({ frequency: { value: AUDIO_EQ_BASS_HZ }, gain: { value: 4 } });
    expect(mid).toMatchObject({
      frequency: { value: AUDIO_EQ_MID_HZ },
      Q: { value: AUDIO_EQ_MID_Q },
      gain: { value: -3 },
    });
    expect(treble).toMatchObject({ frequency: { value: AUDIO_EQ_TREBLE_HZ }, gain: { value: 2 } });
  });

  it("drops a band that returns to rest", () => {
    const chain = createEffectsChain(fakeContext());
    chain.update({ ...RESTING_EFFECTS, low_cut: 80, mid: 2 });
    chain.update({ ...RESTING_EFFECTS, mid: 2 });
    expect((path(chain) as FakeFilter[]).map((filter) => filter.type)).toEqual(["peaking"]);
  });

  it("ramps fades as ffmpeg's tri and qsin", () => {
    expect(fadeCurveLevel("linear", 0.5)).toBe(0.5);
    expect(fadeCurveLevel("equal_power", 0.5)).toBeCloseTo(Math.SQRT1_2);
    expect(fadeCurveLevel("equal_power", 2)).toBe(1);
  });
});
