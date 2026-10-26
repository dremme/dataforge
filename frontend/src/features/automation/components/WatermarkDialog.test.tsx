import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type * as JobsApi from "@/features/automation/api/jobs";
import { fetchWatermarkImageInfo, uploadWatermarkImage } from "@/features/automation/api/jobs";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { ApiError } from "@/shared/api/http";
import type { WatermarkImageInfo } from "@/shared/types";
import { watermarkImageQueryOptions } from "@/features/automation/lib/automationQueries";
import { renderWithQueryClient } from "@/test/queryClient";
import { MAX_WATERMARK_TEXT_LENGTH, WatermarkDialog } from "./WatermarkDialog";

vi.mock("@/features/automation/api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof JobsApi>()),
  fetchWatermarkImageInfo: vi.fn<typeof fetchWatermarkImageInfo>(),
  uploadWatermarkImage: vi.fn<typeof uploadWatermarkImage>(),
}));

const fetchInfo = vi.mocked(fetchWatermarkImageInfo);
const upload = vi.mocked(uploadWatermarkImage);

const NO_IMAGE: WatermarkImageInfo = { available: false, width: 0, height: 0, revision: 0 };
const STORED: WatermarkImageInfo = { available: true, width: 120, height: 60, revision: 42 };

const DEFAULTS: JobSettingsByType["watermark"] = {
  text_enabled: true,
  text: "",
  size: "medium",
  opacity: 50,
  position: "bottom_right",
  image_enabled: false,
  image_size: "medium",
  image_opacity: 100,
  image_position: "top_right",
  strip_metadata: false,
};

type ConfirmMock = ReturnType<typeof vi.fn<ComponentProps<typeof WatermarkDialog>["onConfirm"]>>;

function renderDialog(
  overrides: Partial<JobSettingsByType["watermark"]> = {},
  {
    busy = false,
    onConfirm = vi.fn<ComponentProps<typeof WatermarkDialog>["onConfirm"]>(),
    onCancel = vi.fn<() => void>(),
  }: { busy?: boolean; onConfirm?: ConfirmMock; onCancel?: () => void } = {},
) {
  const { client } = renderWithQueryClient(
    <WatermarkDialog
      scope={{ itemCount: 3, folderLabel: "Photos", kind: "folder" as const }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );

  return { onConfirm, onCancel, client };
}

function group(name: string) {
  return within(screen.getByRole("radiogroup", { name }));
}

function preview() {
  return screen.queryByRole("img", { name: "PNG watermark preview" });
}

function confirm(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Add watermark" }));
}

function pngFile(name = "logo.png", type = "image/png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type });
}

beforeEach(() => {
  fetchInfo.mockResolvedValue(NO_IMAGE);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picked-logo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("WatermarkDialog", () => {
  it("starts from the stored settings", () => {
    renderDialog({
      text: "Sample Studio",
      size: "large",
      opacity: 75,
      position: "top_left",
      image_enabled: true,
      image_size: "small",
      image_opacity: 25,
      image_position: "bottom_left",
    });

    expect(screen.getByLabelText("Watermark text")).toHaveValue("Sample Studio");
    expect(group("Text size").getByRole("radio", { name: "Large" })).toBeChecked();
    expect(group("Text opacity").getByRole("radio", { name: "75%" })).toBeChecked();
    expect(group("Text position").getByRole("radio", { name: "Top left" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Image" })).toBeChecked();
    expect(group("Image size").getByRole("radio", { name: "Small" })).toBeChecked();
    expect(group("Image opacity").getByRole("radio", { name: "25%" })).toBeChecked();
    expect(group("Image position").getByRole("radio", { name: "Bottom left" })).toBeChecked();
  });

  it("defaults to text only, with the PNG fully opaque in the top right", () => {
    renderDialog();

    expect(screen.getByRole("checkbox", { name: "Text" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Image" })).not.toBeChecked();
    expect(group("Text size").getByRole("radio", { name: "Medium" })).toBeChecked();
    expect(group("Text opacity").getByRole("radio", { name: "50%" })).toBeChecked();
    expect(group("Text position").getByRole("radio", { name: "Bottom right" })).toBeChecked();
    expect(group("Image opacity").getByRole("radio", { name: "100%" })).toBeChecked();
    expect(group("Image position").getByRole("radio", { name: "Top right" })).toBeChecked();
  });

  it("offers the text the same opacity and position choices as the PNG", () => {
    renderDialog();

    const names = (label: string) =>
      group(label)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("aria-label") ?? radio.closest("label")?.textContent);
    expect(names("Text opacity")).toEqual(names("Image opacity"));
    expect(names("Text opacity")).toEqual(["25%", "50%", "75%", "100%"]);
    expect(names("Text position")).toEqual(names("Image position"));
    expect(names("Text position")).toHaveLength(5);
  });

  it("submits the text at full opacity in a corner of its own", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ text: "Sample Studio" });

    await user.click(group("Text opacity").getByRole("radio", { name: "100%" }));
    await user.click(group("Text position").getByRole("radio", { name: "Top left" }));
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith({
      ...DEFAULTS,
      text: "Sample Studio",
      opacity: 100,
      position: "top_left",
    });
  });

  it("submits the text with the chosen size, opacity, and position", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.type(screen.getByLabelText("Watermark text"), "  Sample Studio  ");
    await user.click(group("Text size").getByRole("radio", { name: "Large" }));
    await user.click(group("Text opacity").getByRole("radio", { name: "25%" }));
    await user.click(group("Text position").getByRole("radio", { name: "Center" }));
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith({
      ...DEFAULTS,
      text: "Sample Studio",
      size: "large",
      opacity: 25,
      position: "center",
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("submits the metadata strip when it is ticked", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ text: "Sample Studio" });

    await user.click(screen.getByRole("checkbox", { name: /Strip metadata/ }));
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith({
      ...DEFAULTS,
      text: "Sample Studio",
      strip_metadata: true,
    });
  });

  it("keeps the tile groups independent", async () => {
    const user = userEvent.setup();
    renderDialog({ image_enabled: true });

    await user.click(group("Text size").getByRole("radio", { name: "Small" }));
    await user.click(group("Image size").getByRole("radio", { name: "Large" }));

    // A shared radio name would have cleared the other groups' selections.
    expect(group("Text size").getByRole("radio", { name: "Small" })).toBeChecked();
    expect(group("Image size").getByRole("radio", { name: "Large" })).toBeChecked();
    expect(group("Text opacity").getByRole("radio", { name: "50%" })).toBeChecked();
    expect(group("Image opacity").getByRole("radio", { name: "100%" })).toBeChecked();
  });

  it("passes filtergraph metacharacters through untouched", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.type(screen.getByLabelText("Watermark text"), "a:b's 100%");
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith({ ...DEFAULTS, text: "a:b's 100%" });
  });

  it("requires watermark text while the text is on", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.type(screen.getByLabelText("Watermark text"), "   ");
    await confirm(user);

    expect(screen.getByRole("alert")).toHaveTextContent("Enter the watermark text.");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("drops pasted line breaks rather than sending them to drawtext", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByLabelText("Watermark text"));
    await user.paste("first\nsecond");
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith({ ...DEFAULTS, text: "firstsecond" });
  });

  it("caps the text at the length the backend accepts", () => {
    renderDialog();

    expect(screen.getByLabelText("Watermark text")).toHaveAttribute(
      "maxLength",
      String(MAX_WATERMARK_TEXT_LENGTH),
    );
  });

  it("disables each column while its mark is off", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole("button", { name: "Choose PNG..." })).toBeDisabled();
    expect(group("Image position").getByRole("radio", { name: "Center" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Image" }));
    await user.click(screen.getByRole("checkbox", { name: "Text" }));

    expect(screen.getByRole("button", { name: "Choose PNG..." })).toBeEnabled();
    expect(group("Image position").getByRole("radio", { name: "Center" })).toBeEnabled();
    expect(screen.getByLabelText("Watermark text")).toBeDisabled();
    expect(group("Text size").getByRole("radio", { name: "Large" })).toBeDisabled();
  });

  it("needs at least one mark", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ text_enabled: false });

    await confirm(user);

    expect(screen.getByRole("alert")).toHaveTextContent("Turn on the text or the image watermark.");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("needs a PNG before a PNG watermark can start", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ text_enabled: false, image_enabled: true });
    await waitFor(() => expect(fetchInfo).toHaveBeenCalled());

    await confirm(user);

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PNG for the watermark.");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("previews the stored PNG and starts a PNG-only job without uploading", async () => {
    fetchInfo.mockResolvedValue(STORED);
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ text_enabled: false, text: "", image_enabled: true });

    await waitFor(() =>
      expect(preview()).toHaveAttribute("src", "/api/automation/watermark/image?v=42"),
    );
    expect(screen.getByText("Saved PNG, 120 × 60 px.")).toBeInTheDocument();
    await user.click(group("Image position").getByRole("radio", { name: "Bottom left" }));
    await confirm(user);

    expect(upload).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledWith({
      ...DEFAULTS,
      text_enabled: false,
      image_enabled: true,
      image_position: "bottom_left",
    });
  });

  it("changes one image option without resetting the others", async () => {
    fetchInfo.mockResolvedValue(STORED);
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({
      text_enabled: false,
      image_enabled: true,
      image_size: "large",
      image_position: "bottom_left",
    });
    await waitFor(() => expect(preview()).not.toBeNull());

    await user.click(group("Image opacity").getByRole("radio", { name: "25%" }));
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith({
      ...DEFAULTS,
      text_enabled: false,
      image_enabled: true,
      image_size: "large",
      image_opacity: 25,
      image_position: "bottom_left",
    });
  });

  it("previews the chosen opacity on the PNG", async () => {
    fetchInfo.mockResolvedValue(STORED);
    const user = userEvent.setup();
    renderDialog({ image_enabled: true, image_opacity: 100 });
    await waitFor(() => expect(preview()).not.toBeNull());

    await user.click(group("Image opacity").getByRole("radio", { name: "50%" }));

    expect(preview()).toHaveStyle({ opacity: "0.5" });
  });

  it("opens the file picker only from the button", async () => {
    fetchInfo.mockResolvedValue(STORED);
    renderDialog({ image_enabled: true });
    await waitFor(() => expect(preview()).not.toBeNull());

    // A display-only preview: nothing next to the button does the same job.
    expect(screen.getAllByRole("button", { name: /PNG\.\.\./ })).toHaveLength(1);
    expect(preview()!.closest("button")).toBeNull();
  });

  it("uploads a picked PNG before starting the job", async () => {
    let resolveUpload: (info: WatermarkImageInfo) => void = () => {};
    upload.mockImplementation(() => new Promise((resolve) => (resolveUpload = resolve)));
    const user = userEvent.setup();
    const { onConfirm, client } = renderDialog({ text_enabled: false, image_enabled: true });
    const file = pngFile();

    await user.upload(screen.getByLabelText("PNG watermark file"), file);
    expect(preview()).toHaveAttribute("src", "blob:picked-logo");
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    await confirm(user);

    expect(upload).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: "Uploading..." })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();

    resolveUpload(STORED);

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        ...DEFAULTS,
        text_enabled: false,
        image_enabled: true,
      }),
    );
    expect(client.getQueryData(watermarkImageQueryOptions().queryKey)).toEqual(STORED);
  });

  it("keeps an upload error inline and does not start the job", async () => {
    upload.mockRejectedValue(new ApiError(400, "The watermark must be a PNG file", null));
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ text_enabled: false, image_enabled: true });

    await user.upload(screen.getByLabelText("PNG watermark file"), pngFile());
    await confirm(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("The watermark must be a PNG file");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add watermark" })).toBeEnabled();
  });

  it("refuses a file that is not a PNG", async () => {
    // userEvent honours `accept`, so the drop is applied directly.
    const user = userEvent.setup({ applyAccept: false });
    renderDialog({ image_enabled: true });

    await user.upload(
      screen.getByLabelText("PNG watermark file"),
      pngFile("photo.jpg", "image/jpeg"),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PNG file.");
    expect(preview()).toBeNull();
  });

  it("does not upload a picked PNG when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog({ image_enabled: true });

    await user.upload(screen.getByLabelText("PNG watermark file"), pngFile());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(onCancel).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("disables its controls while the job is starting", () => {
    renderDialog({ text: "Sample Studio", image_enabled: true }, { busy: true });

    expect(screen.getByLabelText("Watermark text")).toBeDisabled();
    expect(group("Text size").getByRole("radio", { name: "Large" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Image" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose PNG..." })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Strip metadata/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
  });
});
