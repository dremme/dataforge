import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { WORKSPACE } from "./workspace";
import type { ComfyWorkflowPromptsResponse } from "../src/shared/types";

const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
const python = path.join(
  backend,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "narrow", width: 390, height: 844 },
]) {
  test(`${viewport.name}: unresolved workflow opens on the first output`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mkdir(WORKSPACE, { recursive: true });
    const folder = await mkdtemp(path.join(WORKSPACE, "comfy-workflow-"));
    const prefix = `landscape_${"detail_".repeat(12)}`;
    const name = `${prefix}_00001_.png`;
    const outputId = `7:${"1234567890".repeat(6)}`;
    const graph = {
      "2": { class_type: "CLIPTextEncode", inputs: { text: "a quiet lake at sunrise" } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "a forest path in fog" } },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: "blurry, low quality, watermark, text, oversaturated colours" },
      },
      // Settings and a negative prompt make this output much taller than the first.
      "5": {
        class_type: "KSampler",
        inputs: {
          positive: ["3", 0],
          negative: ["4", 0],
          seed: 1,
          steps: 20,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1,
        },
      },
      [outputId]: {
        class_type: "SaveImage",
        _meta: { title: "Landscape render" },
        inputs: { images: ["2", 0], filename_prefix: `renders/${prefix}` },
      },
      "8": {
        class_type: "SaveImage",
        _meta: { title: "Forest render" },
        inputs: { images: ["5", 0], filename_prefix: `renders/${prefix}` },
      },
    };
    execFileSync(python, [
      "-c",
      "import sys; from PIL import Image, PngImagePlugin; " +
        "metadata = PngImagePlugin.PngInfo(); metadata.add_text('prompt', sys.argv[2]); " +
        "Image.new('RGB', (640, 480), 'steelblue').save(sys.argv[1], pnginfo=metadata)",
      path.join(folder, name),
      JSON.stringify(graph),
    ]);

    await page.goto(`/?path=${encodeURIComponent(folder)}`);
    await page.getByRole("button", { name: `View ${name}`, exact: true }).click();
    await page.getByRole("button", { name: /ComfyUI/ }).click();
    const dialog = page.getByRole("dialog", { name: "ComfyUI prompts" });
    await expect(dialog.getByText(/2 outputs share a naming pattern/)).toBeVisible();
    // No filename match, so the first output is shown rather than an empty pane.
    const prompts = dialog.getByRole("group", { name: "Prompts", exact: true });
    await expect(prompts.getByText("a quiet lake at sunrise", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Landscape render/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // Layout height, not the bounding box: the opening animation scales the panel.
    const panelHeight = () => dialog.evaluate((element: HTMLElement) => element.offsetHeight);
    const firstHeight = await panelHeight();
    await expect(prompts.getByText("a forest path in fog", { exact: true })).toHaveCount(0);
    await expect(prompts.getByText(`Node #${outputId} · SaveImage`)).toBeVisible();
    await expect(prompts.getByText(`Filename prefix: renders/${prefix}`)).toBeVisible();
    await expect(prompts.getByText("Selected for inspection — source unverified")).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await prompts.getByText("a quiet lake at sunrise", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`selected-${viewport.name}.png`),
      animations: "disabled",
    });

    await dialog.getByRole("button", { name: /Forest render/ }).click();
    await expect(prompts.getByText("a forest path in fog", { exact: true })).toBeVisible();
    await expect(prompts.getByText("a quiet lake at sunrise", { exact: true })).toHaveCount(0);
    // Picking an output must not resize the panel under the pointer.
    expect(await panelHeight()).toBe(firstHeight);
  });
}

test("linked GetNode settings are displayed for the likely output", async ({ page }, testInfo) => {
  await mkdir(WORKSPACE, { recursive: true });
  const folder = await mkdtemp(path.join(WORKSPACE, "comfy-settings-"));
  const graph = {
    "1": { class_type: "PrimitiveString", inputs: { value: "euler" } },
    "2": { class_type: "StringConstant", inputs: { string: "karras" } },
    "3": { class_type: "INTConstant", inputs: { value: 24 } },
    "4": { class_type: "FloatConstant", inputs: { value: 1.5 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        sampler_name: ["10", 0],
        scheduler: ["11", 0],
        steps: ["12", 0],
        positive: ["6", 0],
      },
    },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "a quiet lake at sunrise" } },
    "7": {
      class_type: "ImageScaleToTotalPixels",
      inputs: { image: ["5", 0], megapixels: ["13", 0] },
    },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "scene" } },
  };
  const names = ["sampler", "scheduler", "steps", "megapixels"];
  const workflow = {
    nodes: names.flatMap((name, index) => [
      { id: 20 + index, type: "SetNode", widgets_values: [name], inputs: [{ link: 100 + index }] },
      { id: 10 + index, type: "GetNode", widgets_values: [name] },
    ]),
    links: names.map((_, index) => [100 + index, index + 1, 0, 20 + index, 0, "*"]),
  };
  execFileSync(python, [
    "-c",
    "import sys; from PIL import Image, PngImagePlugin; " +
      "metadata = PngImagePlugin.PngInfo(); metadata.add_text('prompt', sys.argv[2]); " +
      "metadata.add_text('workflow', sys.argv[3]); " +
      "Image.new('RGB', (640, 480), 'steelblue').save(sys.argv[1], pnginfo=metadata)",
    path.join(folder, "scene_00001_.png"),
    JSON.stringify(graph),
    JSON.stringify(workflow),
  ]);

  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  await page.getByRole("button", { name: "View scene_00001_.png", exact: true }).click();
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/comfy-workflow/prompts",
  );
  await page.getByRole("button", { name: /ComfyUI/ }).click();
  const response = await responsePromise;
  const payload = (await response.json()) as ComfyWorkflowPromptsResponse;
  expect(payload.matched_node_id).toBe("8");
  const dialog = page.getByRole("dialog", { name: "ComfyUI prompts" });
  await expect(dialog.getByText("Likely output — matched by filename")).toBeVisible();
  for (const [label, value] of [
    ["Sampler", "euler"],
    ["Scheduler", "karras"],
    ["Steps", "24"],
    ["Megapixels", "1.5"],
  ]) {
    await expect(
      dialog.getByText(label, { exact: true }).locator("..").getByText(value, { exact: true }),
    ).toBeVisible();
  }
  expect(payload.branches[0].prompts.map((prompt) => prompt.text)).toEqual([
    "a quiet lake at sunrise",
  ]);
  await page.screenshot({
    path: testInfo.outputPath("linked-settings.png"),
    animations: "disabled",
  });
});
