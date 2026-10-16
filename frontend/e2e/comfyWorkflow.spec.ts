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
  test(`${viewport.name}: workflow map groups preparations and scrolls through later passes`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mkdir(WORKSPACE, { recursive: true });
    const folder = await mkdtemp(path.join(WORKSPACE, "comfy-map-"));
    const graph = {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "base.safetensors" } },
      "2": {
        class_type: "LoraLoader",
        inputs: { model: ["1", 0], lora_name: "lighting.safetensors", strength_model: 0.8 },
      },
      "3": { class_type: "CLIPLoader", inputs: { clip_name: "encoder.safetensors" } },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { clip: ["3", 0], text: "a quiet lake at sunrise" },
      },
      "5": {
        class_type: "CLIPTextEncode",
        inputs: { clip: ["3", 0], text: "blurry, low quality" },
      },
      "6": { class_type: "VAELoader", inputs: { vae_name: "decoder.safetensors" } },
      "7": { class_type: "LoadImage", inputs: { image: "reference.png" } },
      "8": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["6", 0] } },
      "9": {
        class_type: "KSampler",
        _meta: { title: "Base pass" },
        inputs: {
          model: ["2", 0],
          positive: ["4", 0],
          negative: ["5", 0],
          latent_image: ["8", 0],
          steps: 20,
          cfg: 7,
          seed: 1,
        },
      },
      "10": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "refiner.safetensors" } },
      "11": {
        class_type: "LoraLoader",
        inputs: { model: ["10", 0], lora_name: "detail.safetensors", strength_model: 0.5 },
      },
      "12": {
        class_type: "FaceDetailer",
        _meta: { title: "Refine pass" },
        inputs: {
          model: ["11", 0],
          positive: ["4", 0],
          negative: ["5", 0],
          image: ["13", 0],
          vae: ["6", 0],
          steps: 10,
          cfg: 5,
          seed: 2,
        },
      },
      "13": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["6", 0] } },
      "14": { class_type: "SaveImage", inputs: { images: ["12", 0], filename_prefix: "scene" } },
    };
    execFileSync(python, [
      "-c",
      "import sys; from PIL import Image, PngImagePlugin; " +
        "metadata = PngImagePlugin.PngInfo(); metadata.add_text('prompt', sys.argv[2]); " +
        "Image.new('RGB', (640, 480), 'steelblue').save(sys.argv[1], pnginfo=metadata)",
      path.join(folder, "scene_00001_.png"),
      JSON.stringify(graph),
    ]);
    await page.goto(`/?path=${encodeURIComponent(folder)}`);
    await page.getByRole("button", { name: "View scene_00001_.png", exact: true }).click();
    await page.getByRole("button", { name: /ComfyUI/ }).click();
    const dialog = page.getByRole("dialog", { name: "ComfyUI workflow" });
    const map = dialog.getByRole("group", { name: "Workflow map" });
    await expect(map.getByRole("button", { name: "Pass 1: Base pass" })).toBeAttached();
    await expect(map.locator("svg text")).toHaveCount(0);
    const boxes = await map.locator(".comfy-workflow-dialog__map-node").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { label: node.textContent!, x: rect.x, y: rect.y, width: rect.width };
      }),
    );
    const find = (label: string) => boxes.find((box) => box.label.includes(label))!;
    expect(Math.abs(find("base").x - find("lighting").x)).toBeLessThan(1);
    expect(Math.abs(find("base").x - find("refiner").x)).toBeLessThan(1);
    expect(Math.abs(find("encoder").x - find("a quiet lake").x)).toBeLessThan(1);
    expect(find("Base pass").y).toBeLessThan(find("refiner").y);
    expect(find("refiner").y).toBeLessThan(find("Refine pass").y);
    const bounds = (await map.boundingBox())!;
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual((120 / 480) * Math.min(bounds.width, 480));
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    await map.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: testInfo.outputPath("map-preparations.png"),
      animations: "disabled",
    });
    await map.getByText("Output", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("map-output.png"), animations: "disabled" });
    await map.getByRole("button", { name: "Pass 2: Refine pass" }).click();
    await expect(
      dialog.locator(".comfy-workflow-dialog__pass-label").getByText("Refine pass"),
    ).toBeVisible();
  });

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
    const dialog = page.getByRole("dialog", { name: "ComfyUI workflow" });
    await expect(dialog.getByText(/2 outputs share a naming pattern/)).toBeVisible();
    // No filename match, so the first output is shown rather than an empty pane.
    const prompts = dialog.getByRole("group", { name: "Details", exact: true });
    // The workflow map repeats prompt text in its boxes; these checks are about the prompt cards.
    const promptCard = (text: string) =>
      prompts
        .getByText(text, { exact: true })
        .and(page.locator(":not(.comfy-workflow-dialog__map *)"));
    await expect(promptCard("a quiet lake at sunrise")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Landscape render/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // Layout height, not the bounding box: the opening animation scales the panel.
    const panelHeight = () => dialog.evaluate((element: HTMLElement) => element.offsetHeight);
    const firstHeight = await panelHeight();
    await expect(promptCard("a forest path in fog")).toHaveCount(0);
    await expect(prompts.getByText(`Node #${outputId} · SaveImage`)).toBeVisible();
    await expect(prompts.getByText(`Filename prefix: renders/${prefix}`)).toBeVisible();
    await expect(prompts.getByText("Selected for inspection — source unverified")).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await promptCard("a quiet lake at sunrise").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`selected-${viewport.name}.png`),
      animations: "disabled",
    });

    await dialog.getByRole("button", { name: /Forest render/ }).click();
    await expect(promptCard("a forest path in fog")).toBeVisible();
    await expect(promptCard("a quiet lake at sunrise")).toHaveCount(0);
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
  const dialog = page.getByRole("dialog", { name: "ComfyUI workflow" });
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
