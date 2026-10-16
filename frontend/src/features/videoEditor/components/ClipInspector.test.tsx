import type { ComponentProps } from "react";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import type { Clip, Project } from "@/features/videoEditor/lib/timeline";
import { ClipInspector } from "./ClipInspector";

const video = makeClip("shot", "v1", 0, 2, { kind: "video", source_id: "film", link_id: "pair" });
const sound = makeClip("sound", "a1", 0, 2, { kind: "audio", source_id: "film", link_id: "pair" });
const after = makeClip("after", "v1", 2, 2);

function projectWith(clips: Clip[], patch: Partial<Project> = {}): Project {
  return makeProject({
    sources: [makeSource("still", "still.png", "image"), makeSource("film", "film.mp4", "video")],
    clips,
    ...patch,
  });
}

function renderInspector(overrides: Partial<ComponentProps<typeof ClipInspector>> = {}) {
  const props: ComponentProps<typeof ClipInspector> = {
    project: projectWith([video, sound]),
    selection: [],
    transitionId: null,
    onEdit: vi.fn(),
    onSpeed: vi.fn(),
    onStart: vi.fn(),
    onSourceIn: vi.fn(),
    onDuration: vi.fn(),
    onBatchEdit: vi.fn(),
    onBatchLength: vi.fn(),
    onUnlink: vi.fn(),
    onLink: vi.fn(),
    onAddDissolve: vi.fn(),
    onDissolveDuration: vi.fn(),
    onRemoveDissolve: vi.fn(),
    onDelete: vi.fn(),
    autoPending: false,
    onAuto: vi.fn(),
    ...overrides,
  };
  return { ...props, ...renderWithProviders(<ClipInspector {...props} />) };
}

describe("ClipInspector", () => {
  beforeEach(() => {
    installMockBackend();
    window.localStorage.clear();
  });

  it("sums up the project and lists the main keys while nothing is selected", () => {
    renderInspector();

    expect(screen.getByText("640 × 360")).toBeInTheDocument();
    expect(screen.getByText("30 fps")).toBeInTheDocument();
    expect(screen.getByText("Split at the playhead")).toBeInTheDocument();
  });

  it("links one picture with its sound and deletes several clips at once", async () => {
    const user = userEvent.setup();
    const unlinked = [
      { ...video, link_id: null },
      { ...sound, link_id: null },
    ];
    const { onLink, onDelete } = renderInspector({ selection: unlinked });

    expect(screen.getByText("2 clips selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Link video and audio/ }));
    await user.click(screen.getByRole("button", { name: /Delete clips/ }));

    expect(onLink).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it("changes a dissolve's length while dragging and records it on release", async () => {
    const user = userEvent.setup();
    const project = projectWith([makeClip("one", "v1", 0, 2), makeClip("two", "v1", 1.5, 2)], {
      transitions: [{ id: "mix", from_clip_id: "one", to_clip_id: "two" }],
    });
    const { onDissolveDuration, onRemoveDissolve } = renderInspector({
      project,
      transitionId: "mix",
    });
    const slider = screen.getByRole("slider", { name: "Duration" });

    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.pointerUp(slider);
    await user.click(screen.getByRole("button", { name: /Remove dissolve/ }));

    expect(onDissolveDuration).toHaveBeenNthCalledWith(1, 1, false);
    expect(onDissolveDuration).toHaveBeenNthCalledWith(2, expect.any(Number), true);
    expect(onRemoveDissolve).toHaveBeenCalled();
  });

  it("sets a video's speed, fit and transform and unlinks its sound", async () => {
    const user = userEvent.setup();
    const { onSpeed, onEdit, onUnlink } = renderInspector({ selection: [video] });

    await user.click(screen.getByRole("radio", { name: "2×" }));
    await user.click(screen.getByRole("radio", { name: "Fill" }));
    fireEvent.change(screen.getByRole("slider", { name: "Rotation" }), {
      target: { value: "45" },
    });
    await user.click(screen.getByRole("button", { name: "Reset transform" }));
    await user.click(screen.getByRole("button", { name: /Unlink/ }));

    expect(onSpeed).toHaveBeenCalledWith(2);
    expect(onEdit).toHaveBeenCalledWith({ fit: "fill" }, true);
    expect(onEdit).toHaveBeenCalledWith(
      { transform: expect.objectContaining({ rotation: 45 }) },
      false,
    );
    expect(onEdit).toHaveBeenLastCalledWith(
      { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, fit: "fit" },
      true,
    );
    expect(onUnlink).toHaveBeenCalled();
  });

  it("offers a dissolve only when a clip follows on the same track", async () => {
    const user = userEvent.setup();
    const { onAddDissolve, unmount } = renderInspector({ selection: [video] });
    expect(screen.getByRole("button", { name: /Add cross-dissolve/ })).toBeDisabled();
    unmount();

    renderInspector({
      project: projectWith([video, sound, after]),
      selection: [video],
      onAddDissolve,
    });
    await user.click(screen.getByRole("button", { name: /Add cross-dissolve/ }));

    expect(onAddDissolve).toHaveBeenCalled();
  });

  it("keeps each fade's scale fixed and never lets one fade push the other", () => {
    const fadeIn = () => screen.getByRole("slider", { name: "Fade in" });
    const fadeOut = () => screen.getByRole("slider", { name: "Fade out" });
    for (const fade_out of [0.5, 1.2]) {
      const faded = { ...after, fade_in: 0.5, fade_out };
      const { unmount } = renderInspector({
        project: projectWith([video, sound, faded]),
        selection: [faded],
      });
      // The other fade's length must not rescale this slider, or its thumb jumps.
      expect(fadeIn()).toHaveAttribute("max", "2");
      expect(fadeOut()).toHaveAttribute("max", "2");
      unmount();
    }

    const faded = { ...after, fade_in: 0.5, fade_out: 1.2 };
    const { onEdit } = renderInspector({
      project: projectWith([video, sound, faded]),
      selection: [faded],
    });
    // Dragged into the fade out, the fade in stops where it begins.
    fireEvent.change(fadeIn(), { target: { value: "1.5" } });
    expect(onEdit).toHaveBeenLastCalledWith({ fade_in: 0.8 }, false);
  });

  it("types a still's duration and gives sound a gain instead of a picture", async () => {
    const user = userEvent.setup();
    const { onDuration, unmount } = renderInspector({ selection: [after] });

    const field = screen.getByRole("textbox", { name: "Length" });
    await user.clear(field);
    await user.type(field, "3s{Enter}");
    expect(onDuration).toHaveBeenCalledWith(3);
    unmount();

    const { onEdit } = renderInspector({ selection: [sound] });
    fireEvent.change(screen.getByRole("slider", { name: "Gain" }), { target: { value: "1.5" } });
    expect(onEdit).toHaveBeenCalledWith({ gain: 1.5 }, false);
    expect(screen.queryByRole("button", { name: "Color" })).not.toBeInTheDocument();
  });

  it("crops and grades from their folded sections, and resets each", async () => {
    const user = userEvent.setup();
    const { onEdit } = renderInspector({ selection: [after] });

    await user.click(screen.getByRole("button", { name: "Crop" }));
    fireEvent.change(screen.getByRole("slider", { name: "Left" }), { target: { value: "0.2" } });
    expect(onEdit).toHaveBeenLastCalledWith(
      { crop: { x: 0.2, y: 0, width: 0.8, height: 1 } },
      false,
    );
    await user.click(screen.getByRole("button", { name: "Reset crop" }));
    expect(onEdit).toHaveBeenLastCalledWith({ crop: null }, true);

    await user.click(screen.getByRole("button", { name: "Color" }));
    fireEvent.change(screen.getByRole("slider", { name: "Saturation" }), {
      target: { value: "0.3" },
    });
    expect(vi.mocked(onEdit).mock.lastCall?.[0].adjust?.saturation).toBe(0.3);
    await user.click(screen.getByRole("button", { name: "Reset color" }));
    expect(vi.mocked(onEdit).mock.lastCall?.[0].auto_adjust).toBeNull();
  });

  it("remembers a folded section for the next clip", async () => {
    const user = userEvent.setup();
    const { unmount } = renderInspector({ selection: [video] });

    await user.click(screen.getByRole("button", { name: "Timing" }));
    expect(screen.queryByRole("slider", { name: "Fade in" })).not.toBeInTheDocument();
    unmount();

    renderInspector({ selection: [after] });
    expect(screen.getByRole("button", { name: "Timing" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("edits a title's text, alignment, colors and opacity", async () => {
    const user = userEvent.setup();
    const title = makeClip("words", "v2", 0, 3, {
      kind: "title",
      source_id: null,
      title: {
        text: "Hello",
        size: 0.08,
        color: "#ffffff",
        align: "center",
        x: 0.5,
        y: 0.5,
        outline: 0.04,
        outline_color: "#000000",
      },
    });
    const { onEdit } = renderInspector({ project: projectWith([title]), selection: [title] });

    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
      target: { value: "Bye" },
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      { title: expect.objectContaining({ text: "Bye" }) },
      false,
    );
    await user.click(screen.getByRole("radio", { name: "Left" }));
    expect(onEdit).toHaveBeenLastCalledWith(
      { title: expect.objectContaining({ align: "left" }) },
      true,
    );
    fireEvent.change(screen.getByLabelText("Outline color"), { target: { value: "#ff0000" } });
    expect(onEdit).toHaveBeenLastCalledWith(
      { title: expect.objectContaining({ outline_color: "#ff0000" }) },
      true,
    );
    fireEvent.change(screen.getByRole("slider", { name: "Opacity" }), {
      target: { value: "0.5" },
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      { transform: expect.objectContaining({ opacity: 0.5 }) },
      false,
    );
  });

  it("shows the wand busy while it reads, and its amount once it has", async () => {
    const user = userEvent.setup();
    const { onEdit, unmount } = renderInspector({ selection: [after], autoPending: true });
    await user.click(screen.getByRole("button", { name: "Color" }));
    expect(screen.getByRole("button", { name: /Reading frames/ })).toBeDisabled();
    unmount();

    const suggestion = { ...after.adjust, exposure: 0.4 };
    const tuned = {
      ...after,
      adjust: { ...after.adjust, exposure: 0.4 },
      auto_adjust: { amount: 0.5, suggestion, base: after.adjust },
    };
    renderInspector({ selection: [tuned], onEdit });
    fireEvent.change(screen.getByRole("slider", { name: "Amount" }), { target: { value: "1" } });

    expect(vi.mocked(onEdit).mock.lastCall?.[0].adjust?.exposure).toBeCloseTo(0.8);
    expect(vi.mocked(onEdit).mock.lastCall?.[0].auto_adjust?.amount).toBe(1);
  });
});
