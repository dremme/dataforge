import { execFileSync } from "node:child_process";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { WORKSPACE } from "./workspace";

test("free crop readouts reflect the visible image and video rectangles", async ({
  page,
}, testInfo) => {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  await copyFile(
    path.join(projectRoot, "sample_images", "sunset.jpg"),
    path.join(WORKSPACE, "landscape.jpg"),
  );
  const backend = path.join(projectRoot, "backend");
  const python = path.join(
    backend,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const ffmpeg = execFileSync(
    python,
    ["-c", "from ffmpeg_bin import ffmpeg_path; print(ffmpeg_path() or '')"],
    { cwd: backend, encoding: "utf8" },
  ).trim();
  expect(ffmpeg).not.toBe("");
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=steelblue:s=320x180:r=10",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-an",
    path.join(WORKSPACE, "landscape.mp4"),
  ]);
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);

  await page.getByRole("button", { name: "View landscape.jpg" }).click();
  await page.getByRole("button", { name: "Edit landscape.jpg" }).click();
  await expect(page.locator(".crop-overlay__readout")).toHaveText("640 × 480 · 4:3");
  await page.screenshot({ path: testInfo.outputPath("image-crop.png") });

  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await page.getByRole("button", { name: "Rotate right" }).click();
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(page.locator(".crop-overlay__readout")).toHaveText("480 × 640 · 3:4");
  await page.screenshot({ path: testInfo.outputPath("rotated-image-crop.png") });

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".crop-overlay__readout")).toHaveText("640 × 480 · 4:3");

  const cropBox = await page.locator(".crop-overlay__rect").boundingBox();
  const corner = await page.locator(".crop-overlay__handle--se").boundingBox();
  expect(cropBox).not.toBeNull();
  expect(corner).not.toBeNull();
  await page.mouse.move(corner!.x + corner!.width / 2, corner!.y + corner!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cropBox!.x + cropBox!.width / 4, cropBox!.y + cropBox!.height / 4);
  await page.mouse.up();
  await expect(page.locator(".crop-overlay__readout")).toHaveText("160 × 120 · 4:3");
  await page.screenshot({ path: testInfo.outputPath("small-crop.png") });

  await page.locator(".gallery-item-modal__close").click();
  await page.getByRole("button", { name: "View landscape.mp4" }).click();
  await page.getByRole("button", { name: "Edit landscape.mp4" }).click();
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(page.locator(".crop-overlay__readout")).toHaveText("320 × 180 · 16:9");
  await page.screenshot({ path: testInfo.outputPath("video-crop.png") });
});
