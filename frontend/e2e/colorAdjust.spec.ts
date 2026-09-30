import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { WORKSPACE } from "./workspace";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const python = path.join(
  projectRoot,
  "backend",
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

/** Mean colors over a 32 x 24 grid, at the preview's own resolution so both sides average alike. */
async function blocks(page: Page, source: { file: string } | "preview"): Promise<number[]> {
  return page.evaluate(
    async ({ workspace, source }) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const preview = document.querySelector("canvas.adjust-canvas") as HTMLCanvasElement;
      const { width, height } = preview;
      const full = document.createElement("canvas");
      full.width = width;
      full.height = height;
      const context = full.getContext("2d")!;
      if (source === "preview") {
        context.drawImage(preview, 0, 0);
      } else {
        const separator = workspace.includes("\\") ? "\\" : "/";
        const url = `/api/media?path=${encodeURIComponent(workspace + separator + source.file)}&v=${Date.now()}`;
        if (source.file.endsWith(".mp4")) {
          const video = document.createElement("video");
          video.muted = true;
          video.src = url;
          await new Promise((resolve) =>
            video.addEventListener("loadeddata", resolve, { once: true }),
          );
          video.currentTime = 0.5;
          await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
          context.imageSmoothingQuality = "high";
          context.drawImage(video, 0, 0, width, height);
        } else {
          const image = new Image();
          image.src = url;
          await image.decode();
          context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, width, height);
        }
      }
      const data = context.getImageData(0, 0, width, height).data;
      const [columns, rows] = [32, 24];
      const [blockWidth, blockHeight] = [Math.floor(width / columns), Math.floor(height / rows)];
      const means: number[] = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const sum = [0, 0, 0];
          for (let y = row * blockHeight; y < (row + 1) * blockHeight; y += 1) {
            for (let x = column * blockWidth; x < (column + 1) * blockWidth; x += 1) {
              const index = (y * width + x) * 4;
              for (let channel = 0; channel < 3; channel += 1)
                sum[channel] += data[index + channel];
            }
          }
          means.push(...sum.map((value) => value / (blockWidth * blockHeight)));
        }
      }
      return means;
    },
    { workspace: WORKSPACE, source },
  );
}

function difference(a: number[], b: number[]): { mean: number; worst: number } {
  let total = 0;
  let worst = 0;
  a.forEach((value, index) => {
    const gap = Math.abs(value - b[index]);
    total += gap;
    worst = Math.max(worst, gap);
  });
  return { mean: total / a.length, worst };
}

async function setTool(page: Page, tool: string, key: string, presses = 1): Promise<void> {
  await page.getByRole("tab", { name: new RegExp(`^${tool}`) }).click();
  await page.getByRole("slider", { name: tool }).focus();
  for (let press = 0; press < presses; press += 1) await page.keyboard.press(key);
}

async function applyAndWait(page: Page): Promise<void> {
  const apply = page.getByRole("button", { name: "Apply" });
  await apply.click();
  await expect(apply).toBeDisabled({ timeout: 60_000 });
}

test("the adjust preview matches the image Apply writes", async ({ page }) => {
  execFileSync(python, [
    "-c",
    "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2])",
    path.join(projectRoot, "sample_images", "sunset.jpg"),
    path.join(WORKSPACE, "adjust.png"),
  ]);
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await page.getByRole("button", { name: "View adjust.png" }).click();
  await page.getByRole("button", { name: "Edit adjust.png" }).click();

  const heights = new Set<number>();
  for (const tool of ["Crop", "Size", "Rotate", "Blur", "Adjust"]) {
    await page
      .getByRole("button", { name: new RegExp(`^${tool}`) })
      .first()
      .click();
    heights.add((await page.locator(".image-edit-panel").boundingBox())?.height ?? -1);
  }
  expect(heights.size).toBe(1);

  await setTool(page, "Exposure", "Shift+ArrowRight", 3);
  await setTool(page, "Shadows", "Shift+ArrowRight", 4);
  await setTool(page, "Warmth", "Shift+ArrowLeft", 2);
  await setTool(page, "Noise Reduction", "End");
  await setTool(page, "Definition", "End");
  await expect(page.getByRole("tab", { name: "Exposure, +30" })).toBeVisible();

  const preview = await blocks(page, "preview");
  await applyAndWait(page);
  const written = await blocks(page, { file: "adjust.png" });

  const { mean, worst } = difference(preview, written);
  expect(mean).toBeLessThan(1.5);
  expect(worst).toBeLessThan(6);
});

test("the wand moves the tools it reads a fault in", async ({ page }) => {
  execFileSync(python, [
    "-c",
    "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').point(lambda v: v // 3).save(sys.argv[2])",
    path.join(projectRoot, "sample_images", "sunset.jpg"),
    path.join(WORKSPACE, "dark.png"),
  ]);
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await page.getByRole("button", { name: "View dark.png" }).click();
  await page.getByRole("button", { name: "Edit dark.png" }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();

  await page.getByRole("tab", { name: "Auto" }).click();

  await expect(page.getByRole("tab", { name: /^Auto, 50$/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Exposure, \+/ })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Auto" })).toHaveAttribute("aria-valuetext", "50");
});

test("the adjust preview matches the video Apply writes", async ({ page }) => {
  const ffmpeg = execFileSync(
    python,
    ["-c", "from ffmpeg_bin import ffmpeg_path; print(ffmpeg_path() or '')"],
    { cwd: path.join(projectRoot, "backend"), encoding: "utf8" },
  ).trim();
  expect(ffmpeg).not.toBe("");
  // Still content, so whichever frame each side lands on shows the same picture. Limited range,
  // like nearly every camera file: headless Chromium reads a full-range stream as limited.
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-loop",
    "1",
    "-i",
    path.join(projectRoot, "sample_images", "sunset.jpg"),
    "-t",
    "1",
    "-r",
    "10",
    "-vf",
    "scale=640:480:out_range=tv",
    "-c:v",
    "libx264",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    "-an",
    path.join(WORKSPACE, "still.mp4"),
  ]);
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await page.getByRole("button", { name: "View still.mp4" }).click();
  await page.getByRole("button", { name: "Edit still.mp4" }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();

  await setTool(page, "Exposure", "Shift+ArrowRight", 3);
  await setTool(page, "Vibrance", "Shift+ArrowRight", 5);
  await setTool(page, "Definition", "End");
  await expect(page.getByRole("tab", { name: "Exposure, +30" })).toBeVisible();

  const preview = await blocks(page, "preview");
  await applyAndWait(page);
  const written = await blocks(page, { file: "still.mp4" });

  const { mean, worst } = difference(preview, written);
  expect(mean).toBeLessThan(1.5);
  expect(worst).toBeLessThan(8);
});
