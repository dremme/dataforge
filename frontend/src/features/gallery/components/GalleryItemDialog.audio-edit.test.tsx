import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import { makeItem } from "@/test/galleryItemDialog";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { stubVideoElement } from "@/test/videoElement";
import type { AudioEditSpec, CaptionSaveResponse, GalleryItem } from "@/shared/types";
import type * as audioEditApi from "@/features/gallery/api/audioEdit";
import type * as audioProxyApi from "@/shared/api/audioProxy";
import {
  applyAudioEdit,
  fetchAudioEditState,
  revertAudioEdit,
} from "@/features/gallery/api/audioEdit";
import { prepareAudioProxy } from "@/shared/api/audioProxy";
import { RESTING_EFFECTS } from "@/shared/lib/audioEffects";
import { GalleryItemDialog } from "./GalleryItemDialog";

vi.mock("@/shared/lib/defer", () => ({
  deferNonCriticalWork: (callback: () => void) => {
    callback();
    return () => {};
  },
}));

vi.mock("@/features/gallery/api/audioEdit", async (importOriginal) => {
  const actual = await importOriginal<typeof audioEditApi>();
  return {
    ...actual,
    fetchAudioEditState: vi.fn<typeof fetchAudioEditState>(),
    applyAudioEdit: vi.fn<typeof applyAudioEdit>(),
    revertAudioEdit: vi.fn<typeof revertAudioEdit>(),
    measureAudioLoudness: vi.fn<typeof actual.measureAudioLoudness>(),
  };
});

vi.mock("@/shared/api/audioProxy", async (importOriginal) => ({
  ...(await importOriginal<typeof audioProxyApi>()),
  prepareAudioProxy: vi.fn<typeof prepareAudioProxy>(),
}));

const fetchStateMock = vi.mocked(fetchAudioEditState);
const applyMock = vi.mocked(applyAudioEdit);
const revertMock = vi.mocked(revertAudioEdit);
const prepareMock = vi.mocked(prepareAudioProxy);

const PATH = `${HOME_PATH}\\voice.wav`;
const EDITED = {
  path: PATH,
  size: 2048,
  modified_at: "2026-03-15T15:00:00.000Z",
  duration: 4,
  has_backup: true,
};

function savedSpec(overrides: Partial<AudioEditSpec> = {}): AudioEditSpec {
  return {
    trim_start: 0,
    trim_end: null,
    fade_in: 0,
    fade_out: 0,
    fade_curve: "equal_power",
    volume: 1,
    level: "unchanged",
    speed: 1,
    pitch: 0,
    effects: { ...RESTING_EFFECTS },
    ...overrides,
  };
}

describe("GalleryItemDialog audio editing", () => {
  let restoreMedia: (() => void) | undefined;

  beforeEach(() => {
    installMockBackend();
    restoreMedia = stubVideoElement({ duration: 8 });
    fetchStateMock
      .mockReset()
      .mockResolvedValue({ path: PATH, has_backup: false, duration: 8, spec: null });
    applyMock.mockReset().mockResolvedValue(EDITED);
    revertMock.mockReset().mockResolvedValue({ ...EDITED, has_backup: false });
    prepareMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    restoreMedia?.();
    restoreMedia = undefined;
  });

  function renderDialog(item: GalleryItem = makeItem("voice.wav", { media_type: "audio" })) {
    const onCopied = vi.fn<() => void | Promise<void>>();
    renderWithProviders(
      <GalleryItemDialog
        items={[item]}
        index={0}
        currentFolder={HOME_PATH}
        onClose={vi.fn<() => void>()}
        onPrevious={vi.fn<() => void>()}
        onNext={vi.fn<() => void>()}
        onCaptionSaved={vi.fn<(path: string, update: CaptionSaveResponse) => void>()}
        onCopied={onCopied}
      />,
    );
    return { onCopied };
  }

  async function openEditMode(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await screen.findByRole("dialog", { name: "Viewing voice.wav" });
    await user.click(within(dialog).getByRole("button", { name: "Edit voice.wav" }));
    const panel = await within(dialog).findByRole("group", { name: "Audio editing" });
    await waitFor(() => expect(within(panel).getByRole("button", { name: /^Trim/ })).toBeEnabled());
    return { dialog, panel };
  }

  it("opens the sound tools on the original, without the player's own controls", async () => {
    const user = userEvent.setup();
    renderDialog();

    const { dialog, panel } = await openEditMode(user);

    expect(fetchStateMock).toHaveBeenCalledWith(PATH);
    const audio = dialog.querySelector("audio")!;
    expect(audio).not.toHaveAttribute("controls");
    expect(audio.getAttribute("src")).toContain("original=1");
    for (const tool of ["Trim", "Fades", "Volume", "Speed", "EQ", "Clean"]) {
      expect(within(panel).getByRole("button", { name: tool })).toBeInTheDocument();
    }
    expect(within(panel).getByRole("slider", { name: "Trim end" })).toHaveAttribute(
      "aria-valuenow",
      "8",
    );
  });

  it("applies the chosen fades and level as one spec", async () => {
    const user = userEvent.setup();
    const { onCopied } = renderDialog();
    const { panel } = await openEditMode(user);

    expect(within(panel).getByRole("button", { name: "Apply" })).toBeDisabled();
    await user.click(within(panel).getByRole("button", { name: "Fades" }));
    await user.click(
      within(within(panel).getByRole("group", { name: "Fade out" })).getByRole("button", {
        name: "2s",
      }),
    );
    await user.click(within(panel).getByRole("button", { name: "Volume" }));
    await user.click(within(panel).getByRole("button", { name: "Limit peaks" }));
    await user.click(within(panel).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    expect(applyMock.mock.calls[0]).toEqual([PATH, savedSpec({ fade_out: 2, level: "limit" })]);
    await waitFor(() => expect(onCopied).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(panel).getByRole("button", { name: "Apply" })).toBeDisabled(),
    );
  });

  it("reopens on a saved edit and reverts to the original", async () => {
    fetchStateMock.mockResolvedValue({
      path: PATH,
      has_backup: true,
      duration: 8,
      spec: savedSpec({ trim_start: 1, trim_end: 5 }),
    });
    const user = userEvent.setup();
    renderDialog(makeItem("voice.wav", { media_type: "audio", has_backup: true }));
    const { panel } = await openEditMode(user);

    await waitFor(() =>
      expect(within(panel).getByRole("slider", { name: "Trim end" })).toHaveAttribute(
        "aria-valuenow",
        "5",
      ),
    );
    await user.click(within(panel).getByRole("button", { name: "Revert original" }));
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(revertMock).toHaveBeenCalledWith(PATH));
  });

  it("plays noise reduction from the server's proxy once it is ready", async () => {
    const user = userEvent.setup();
    renderDialog();
    const { dialog, panel } = await openEditMode(user);

    await user.click(within(panel).getByRole("button", { name: "Clean" }));
    const dial = within(panel).getByRole("slider", { name: "Noise reduction" });
    dial.focus();
    await user.keyboard("{ArrowRight}");

    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(1));
    expect(prepareMock.mock.calls[0][0]).toEqual({
      path: PATH,
      noiseReduction: 0.01,
      pitch: 0,
      original: true,
    });
    await waitFor(() =>
      expect(dialog.querySelector("audio")!.getAttribute("src")).toContain(
        "/api/media/audio-proxy?",
      ),
    );
  });
});
