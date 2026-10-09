import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { WORKSPACE, openWorkspace } from "./workspace";

test("remembers expanded media view after closing, folder navigation, and reload", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "View photo.png", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Viewing photo.png" });
  await inspector.getByRole("button", { name: "Expand media view" }).click();
  const focus = page.getByRole("dialog", { name: "Viewing photo.png" });
  await focus.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "View clip.mp4", exact: true }).click();
  const video = page.getByRole("dialog", { name: "Viewing clip.mp4" });
  await expect(video).toBeVisible();
  await video.getByRole("button", { name: "Close", exact: true }).click();
  const nestedPath = testInfo.outputPath("navigation");
  mkdirSync(nestedPath, { recursive: true });
  copyFileSync(path.join(WORKSPACE, "photo.png"), path.join(nestedPath, "photo.png"));
  copyFileSync(path.join(WORKSPACE, "photo.txt"), path.join(nestedPath, "photo.txt"));
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Open folder" });
  await picker.getByRole("textbox", { name: "Folder path" }).fill(nestedPath);
  await picker.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Folder path" })).toContainText("navigation");
  await expect(page.getByRole("button", { name: "New folder", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "View photo.png", exact: true }).click();
  await expect(focus).toBeVisible();
  await focus.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "View photo.png", exact: true }).click();
  await expect(focus).toBeVisible();
  await focus.getByRole("button", { name: "Return to caption inspector" }).click();
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "View photo.png", exact: true }).click();
  await expect(inspector).toBeVisible();
});

for (const inspectorWidth of [320, 380, 520]) {
  test(`video stays inside the ${inspectorWidth}px caption inspector`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(
      (width) => localStorage.setItem("workspace-inspector-width", String(width)),
      inspectorWidth,
    );
    const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
    const python = path.join(
      projectRoot,
      "backend",
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    const ffmpeg = execFileSync(
      python,
      ["-c", "from ffmpeg_bin import ffmpeg_path; print(ffmpeg_path() or '')"],
      { cwd: path.join(projectRoot, "backend"), encoding: "utf8" },
    ).trim();
    const preview = path.join(WORKSPACE, `inspector-preview-${inspectorWidth}.mp4`);
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x640:rate=10",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      preview,
    ]);
    await page.route("**/api/media?**", (route) => {
      if (
        new URL(route.request().url()).searchParams.get("path") === path.join(WORKSPACE, "clip.mp4")
      )
        return route.fulfill({ path: preview, contentType: "video/mp4" });
      return route.continue();
    });
    await openWorkspace(page);
    await page.getByRole("button", { name: "View clip.mp4", exact: true }).click();
    const inspector = page.getByRole("complementary", { name: "Viewing clip.mp4" });
    const video = inspector.locator("video");
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThan(0);
    const stage = (await inspector.locator(".gallery-item-modal__stage").boundingBox())!;
    const media = (await video.boundingBox())!;
    expect(media.y).toBeGreaterThanOrEqual(stage.y);
    expect(media.y + media.height).toBeLessThanOrEqual(stage.y + stage.height);
    await expect(inspector.getByRole("textbox", { name: "Caption for clip.mp4" })).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("video-inspector.png"),
    });
    await inspector.getByRole("button", { name: "Expand media view" }).click();
    const focus = page.getByRole("dialog", { name: "Viewing clip.mp4" });
    await expect
      .poll(() =>
        focus.locator("video").evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThan(0);
    for (const viewport of [
      { width: 1920, height: 1000 },
      { width: 1440, height: 900 },
      { width: 1024, height: 600 },
      { width: 768, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await focus.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
      });
      await expect
        .poll(() =>
          focus.evaluate((element) => {
            const stage = element
              .querySelector(".gallery-item-modal__stage")!
              .getBoundingClientRect();
            const video = element.querySelector("video")!.getBoundingClientRect();
            return Math.max(
              stage.top - video.top,
              video.bottom - stage.bottom,
              stage.left - video.left,
              video.right - stage.right,
            );
          }),
        )
        .toBeLessThanOrEqual(0);
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`video-focus-${viewport.width}.png`),
      });
    }
  });
}

// A laptop browser window leaves about 600px. The media gives up height; the editor keeps its
// floor, and a long caption scrolls inside it instead of pushing the save status out.
for (const height of [600, 720]) {
  test(`the caption inspector fits a ${height}px tall window`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height });
    await page.route("**/api/caption?**", async (route) => {
      const response = await route.fetch();
      const caption = (await response.json()) as Record<string, unknown>;
      const description = "a long caption line\n".repeat(40);
      await route.fulfill({ json: { ...caption, description, has_description: true } });
    });
    await openWorkspace(page);
    await page.getByRole("button", { name: "View photo.png", exact: true }).click();
    const inspector = page.getByRole("complementary", { name: "Viewing photo.png" });
    await expect(inspector.getByRole("textbox", { name: "Caption for photo.png" })).toBeVisible();

    const geometry = await inspector.evaluate((element) => {
      const panel = element.querySelector(".gallery-item-modal__panel")!;
      const rect = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
      return {
        overflow: panel.scrollHeight - panel.clientHeight,
        panelBottom: panel.getBoundingClientRect().bottom,
        statusBottom: rect(".caption-save-status").bottom,
        editor: rect(".code-editor--caption").height,
        stage: rect(".gallery-item-modal__stage").height,
      };
    });
    await page.screenshot({ path: testInfo.outputPath(`inspector-${height}.png`) });

    expect(geometry.overflow).toBe(0);
    expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.panelBottom);
    expect(geometry.editor).toBeGreaterThanOrEqual(104);
    expect(geometry.stage).toBeGreaterThanOrEqual(96);
  });
}

test("folder instructions keep the current inspector and restore control focus", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "View photo.png", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Viewing photo.png" });
  await expect(inspector).toBeVisible();
  const instructionsButton = page.getByRole("button", { name: "Edit instructions", exact: true });
  await instructionsButton.click();
  await expect(page.getByRole("dialog", { name: "Folder instructions" })).toBeVisible();
  await expect(page.locator(".gallery-item-modal--inline")).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(inspector).toBeVisible();
  await expect(instructionsButton).toBeFocused();
});

test("retains an unsuccessful caption draft until it is explicitly discarded", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "View photo.png", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Viewing photo.png" });
  await page.route("**/api/caption?**", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({ status: 500, json: { detail: "Write failed" } });
    else await route.continue();
  });
  const caption = inspector.getByRole("textbox", { name: "Caption for photo.png" });
  await caption.fill("Unsaved caption for a lake");
  await page.getByRole("button", { name: "View clip.mp4", exact: true }).click();
  await expect(inspector.getByRole("alert")).toContainText("The caption could not be saved");
  await expect(caption).toHaveText("Unsaved caption for a lake");
  await inspector.getByRole("button", { name: "Discard and continue" }).click();
  await expect(page.getByRole("complementary", { name: "Viewing clip.mp4" })).toBeVisible();
});

for (const theme of ["dark", "light"]) {
  for (const width of [1920, 1440, 1024, 768]) {
    test(`${theme} caption inspector at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((preference) => localStorage.setItem("ui-theme", preference), theme);
      await page.route("**/api/preferences/ui", async (route) => {
        const response = await route.fetch();
        await route.fulfill({ json: { ...(await response.json()), theme } });
      });
      await openWorkspace(page);
      await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "View photo.png", exact: true }).click();
      const inspector =
        width < 1000
          ? page.getByRole("dialog", { name: "Viewing photo.png" })
          : page.getByRole("complementary", { name: "Viewing photo.png" });
      await expect(inspector).toBeVisible();
      await expect(inspector.getByRole("button", { name: "Previous item" })).toBeVisible();
      await expect(inspector.getByRole("button", { name: "Next item" })).toBeVisible();
      await expect(inspector.locator(".gallery-item-modal__counter")).toHaveText(/^[12] \/ 2$/);
      await expect(inspector.getByRole("textbox", { name: "Caption for photo.png" })).toBeVisible();
      expect(
        await page.locator(".app").evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      const box = (await inspector.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath("inspector.png") });
      if (width >= 1000) {
        const panel = (await inspector.locator(".gallery-item-modal__panel").boundingBox())!;
        const footer = (await inspector.locator(".gallery-item-modal__footer").boundingBox())!;
        expect(Math.abs(footer.y + footer.height - panel.y - panel.height)).toBeLessThan(1);
        const captionPadding = await inspector
          .locator(".gallery-item-modal__caption-editor")
          .evaluate((node) => getComputedStyle(node).padding);
        expect(captionPadding).toBe("0px");
        const separator = inspector.getByRole("separator", { name: "Caption inspector width" });
        await separator.focus();
        await page.keyboard.press("ArrowLeft");
        await expect(separator).toHaveAttribute("aria-valuenow", "400");
        await inspector.getByRole("button", { name: "Expand media view" }).click();
        const focus = page.getByRole("dialog", { name: "Viewing photo.png" });
        await expect(focus).toBeVisible();
        await focus.evaluate((element) => {
          for (const animation of element.getAnimations()) animation.finish();
        });
        const stage = (await focus.locator(".gallery-item-modal__stage").boundingBox())!;
        const media = (await focus.locator(".gallery-item-modal__img").boundingBox())!;
        expect(media.height).toBeGreaterThan(stage.height * 0.8);
        const meta = (await focus.locator(".gallery-item-modal__meta").boundingBox())!;
        expect(Math.abs(meta.y - stage.y - stage.height)).toBeLessThan(1);
        expect(Math.abs(meta.x - stage.x)).toBeLessThan(1);
        expect(Math.abs(meta.width - stage.width)).toBeLessThan(1);
        await expect(focus.getByRole("button", { name: "Next item" })).toBeVisible();
        await page.screenshot({ animations: "disabled", path: testInfo.outputPath("focus.png") });
        await focus.getByRole("button", { name: "Return to caption inspector" }).click();
        await expect(inspector).toBeVisible();
      }
    });
  }
}
