import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { FolderResponse } from "../src/shared/types";
import { WORKSPACE } from "./workspace";

async function openWorkspace(page: Page) {
  await page.route("**/api/folders/contents?**", async (route) => {
    const response = await route.fetch();
    const folder = (await response.json()) as FolderResponse;
    const items = folder.items.filter(
      (item) => item.name === "photo.png" || item.name === "clip.mp4",
    );
    await route.fulfill({
      json: { ...folder, items, item_count: items.length, subfolders: [], subfolder_count: 0 },
    });
  });
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
}

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

test("search expands on focus, retains a query on blur, and collapses when cleared", async ({
  page,
}) => {
  await openWorkspace(page);
  const field = page.locator(".toolbar__search");
  const compact = (await field.boundingBox())!.width;
  await page.keyboard.press("Control+f");
  const search = page.getByRole("searchbox", {
    name: "Search files and folders by name or caption",
  });
  await expect(search).toBeFocused();
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(compact * 3);
  await search.fill("photo");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: "Filter media" }).click();
  await expect.poll(async () => (await field.boundingBox())!.width).toBeLessThan(compact + 1);
});

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

for (const theme of ["dark", "light"]) {
  for (const width of [1920, 1440, 1024, 768]) {
    test(`${theme} workspace and caption inspector at ${width}px`, async ({ page }, testInfo) => {
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
      await inspector.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Auto-caption", exact: true }).hover();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath("auto-caption-hover.png"),
      });
      await page.getByRole("button", { name: "Tools", exact: true }).hover();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath("actions-hover.png"),
      });
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      const tools = page.getByRole("menu", { name: "Tools" });
      await expect(tools).toBeVisible();
      const toolsBox = (await tools.boundingBox())!;
      expect(toolsBox.x).toBeGreaterThanOrEqual(0);
      expect(toolsBox.x + toolsBox.width).toBeLessThanOrEqual(width);
      const triggerBox = (await page
        .getByRole("button", { name: "Tools", exact: true })
        .boundingBox())!;
      expect(toolsBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
      expect(toolsBox.height).toBeLessThan(900);
      await expect(tools.getByRole("searchbox")).toHaveCount(0);
      await expect(tools.getByRole("menuitem", { name: "Folder instructions" })).toHaveCount(0);
      await expect(tools.getByRole("group")).toHaveCount(4);
      if (width >= 1440) {
        expect(toolsBox.width).toBeLessThan(950);
        const groups = await tools.getByRole("group").all();
        const boxes = await Promise.all(groups.map((group) => group.boundingBox()));
        expect(
          Math.max(...boxes.map((box) => box!.y)) - Math.min(...boxes.map((box) => box!.y)),
        ).toBeLessThan(1);
      }
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath("tools.png") });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Tools", exact: true })).toBeFocused();
      // Neither file has findings, so there is nothing to review.
      await expect(page.getByRole("button", { name: /^Review/ })).toHaveCount(0);
    });
  }
}

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

test("sends only filtered media paths to bulk tools", async ({ page }, testInfo) => {
  await openWorkspace(page);
  await page.keyboard.press("Control+f");
  await page
    .getByRole("searchbox", { name: "Search files and folders by name or caption" })
    .fill("photo.png");
  await expect(page.getByRole("button", { name: "View clip.mp4", exact: true })).toHaveCount(0);
  const toolbarHeight = (await page.locator(".toolbar").boundingBox())!.height;
  await page.getByRole("button", { name: "Filter media" }).click();
  await page.getByRole("menuitemradio", { name: /^Images/ }).click();
  await page.keyboard.press("Escape");
  const clearFilters = page.getByRole("button", { name: "Clear filters" });
  const filterChip = page.getByRole("button", { name: "Remove media type filter" });
  // The summary lives in the Media header, so it stays as compact as that header's own buttons.
  const select = page.getByRole("button", { name: "Select", exact: true });
  const controlHeight = (await select.boundingBox())!.height;
  expect((await clearFilters.boundingBox())!.height).toBeLessThanOrEqual(controlHeight);
  expect((await filterChip.boundingBox())!.height).toBeLessThanOrEqual(controlHeight);
  // Filter chips never reflow the toolbar.
  expect((await page.locator(".toolbar").boundingBox())!.height).toBe(toolbarHeight);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("compact-filters.png"),
  });
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("menu", { name: "Tools" })
    .getByRole("menuitem", { name: /^Set captions/ })
    .click();
  const dialog = page.getByRole("alertdialog", { name: "Set captions?" });
  await expect(dialog.locator(".dialog-scope__line")).toContainText("Matching 1 file");
  let submitted: { paths?: string[] } | undefined;
  await page.route("**/api/automation/set-captions?**", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { detail: "Captured request" } });
  });
  await dialog.getByRole("textbox").fill("A dataset caption");
  await dialog.getByRole("button", { name: "Set captions", exact: true }).click();
  await expect.poll(() => submitted?.paths).toEqual([path.join(WORKSPACE, "photo.png")]);
});

test("keeps a large filtered gallery virtualized while inspecting media", async ({
  page,
}, testInfo) => {
  await page.route("**/api/folders/contents?**", async (route) => {
    const response = await route.fetch();
    const folder = (await response.json()) as FolderResponse;
    const original = folder.items.find((item) => item.name === "photo.png")!;
    const items = Array.from({ length: 2000 }, (_, index) => ({
      ...original,
      path: path.join(WORKSPACE, `image-${index}.png`),
      name: `image-${index}.png`,
    }));
    await route.fulfill({ json: { ...folder, items, item_count: items.length } });
  });
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await expect(page.getByRole("button", { name: "View image-0.png", exact: true })).toBeVisible();
  await expect(page.locator(".gallery-section__header")).not.toHaveClass(/--floating/);
  expect(await page.locator(".card").count()).toBeLessThan(2000);
  await page.locator(".card").first().click();
  await expect(page.locator(".gallery-item-modal--inline")).toBeVisible();
  await page.locator(".main").evaluate((node) => {
    node.scrollTop = 15000;
  });
  await expect(page.locator(".main")).toHaveJSProperty("scrollTop", 15000);
  await expect(page.locator(".gallery-section__header")).toHaveClass(/--floating/);
  expect(await page.locator(".card").count()).toBeLessThan(2000);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("toolbar-floating.png"),
  });
  await page.locator(".main").evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.locator(".main")).toHaveJSProperty("scrollTop", 0);
  await expect(page.locator(".gallery-section__header")).not.toHaveClass(/--floating/);
  await expect
    .poll(() =>
      page
        .locator(".gallery-section__header")
        .evaluate((node) => getComputedStyle(node, "::before").getPropertyValue("visibility")),
    )
    .toBe("hidden");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("toolbar-flat.png") });
  await page.keyboard.press("Control+f");
  await page
    .getByRole("searchbox", { name: "Search files and folders by name or caption" })
    .fill("image-1999.png");
  await expect(
    page.getByRole("button", { name: "View image-1999.png", exact: true }),
  ).toBeVisible();
});

test("search explains its icons and quick-action navigation hints align", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  await page.locator(".toolbar__search-icon").hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Include file and folder names");
  await expect(tooltip).toContainText("Use regular expressions");
  for (const icon of await tooltip.locator("svg").all()) {
    expect((await icon.boundingBox())!.width).toBeLessThanOrEqual(12);
  }
  await page.keyboard.press("Control+p");
  const palette = page.getByRole("dialog", { name: "Quick actions" });
  await palette.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const hint = palette.locator(".quick-action__hint > span").first();
  const hintBox = (await hint.boundingBox())!;
  for (const key of await hint.locator(".kbd").all()) {
    const box = (await key.boundingBox())!;
    expect(Math.abs(box.y + box.height / 2 - (hintBox.y + hintBox.height / 2))).toBeLessThan(1);
  }
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("quick-actions.png") });
});

for (const width of [1440, 768]) {
  test(`candidate and duplicate comparisons use the available space at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let root: FolderResponse;
    await page.route("**/api/folders/contents?**", async (route) => {
      const folderPath = new URL(route.request().url()).searchParams.get("path");
      if (folderPath === path.join(WORKSPACE, "staging")) {
        await route.fulfill({ json: { ...root, path: folderPath, items: [root.items[0]] } });
        return;
      }
      const response = await route.fetch();
      const folder = (await response.json()) as FolderResponse;
      const photo = folder.items.find((item) => item.name === "photo.png")!;
      const first = {
        ...photo,
        has_candidate: true,
        candidate_name: "photo.png",
        duplicate_group: "similar-images",
        has_duplicate_file: true,
        width: 1200,
        height: 1200,
      };
      root = {
        ...folder,
        items: [
          first,
          {
            ...first,
            name: "reference.png",
            path: path.join(WORKSPACE, "reference.png"),
            has_candidate: false,
            candidate_name: null,
          },
        ],
        subfolders: [],
        subfolder_count: 0,
      };
      await route.fulfill({ json: root });
    });
    await page.route("**/api/duplicates?**", (route) =>
      route.fulfill({
        json: {
          folder: WORKSPACE,
          groups: [
            { group: "similar-images", max_distance: 0, threshold: "near", members: root.items },
          ],
          stale: [],
          deletes_to_trash: true,
        },
      }),
    );
    await page.route("**/api/media?**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="steelblue"/></svg>',
      }),
    );
    await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
    await page.getByRole("button", { name: /^Review/ }).click();
    await page.getByRole("menuitem", { name: /^Pending candidates/ }).click();
    const candidate = page.locator(".candidate-review-modal__panel");
    await expect(candidate).toBeVisible();
    const candidateStage = (await candidate
      .locator(".candidate-review-modal__stage")
      .first()
      .boundingBox())!;
    expect(candidateStage.height).toBeGreaterThan(width >= 1000 ? 600 : 300);
    const meta = (await candidate.locator(".candidate-review-modal__meta").boundingBox())!;
    const footer = (await candidate.locator(".candidate-review-modal__footer").boundingBox())!;
    expect(Math.abs(meta.y + meta.height - footer.y)).toBeLessThan(1);
    await expect(candidate.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("candidate.png") });
    await candidate.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /^Review/ }).click();
    await page.getByRole("menuitem", { name: /^Duplicate groups/ }).click();
    const duplicates = page.locator(".duplicate-resolver-modal__panel");
    await expect(duplicates).toBeVisible();
    const duplicateStage = (await duplicates
      .locator(".duplicate-resolver-modal__card-stage")
      .first()
      .boundingBox())!;
    expect(duplicateStage.height).toBeGreaterThan(500);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("duplicates.png") });
  });
}

test("entering selection mode keeps the gallery in place", async ({ page }) => {
  await openWorkspace(page);
  // The loading skeleton also renders .card placeholders; measure the loaded gallery.
  await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toBeVisible();
  await expect(page.locator(".gallery--skeleton")).toHaveCount(0);
  const offset = () =>
    page.evaluate(() => {
      const header = document.querySelector(".gallery-section__header")!.getBoundingClientRect();
      const card = document.querySelector(".card")!.getBoundingClientRect();
      return { height: header.height, gap: Math.round(card.y - header.y) };
    });
  const before = await offset();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exit selection mode" })).toBeVisible();
  expect(await offset()).toEqual(before);
});

test("a large duplicate group wraps into balanced rows that fill the panel", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let members: FolderResponse["items"] = [];
  await page.route("**/api/folders/contents?**", async (route) => {
    const folder = (await (await route.fetch()).json()) as FolderResponse;
    const photo = folder.items.find((item) => item.name === "photo.png")!;
    members = Array.from({ length: 6 }, (_, index) => ({
      ...photo,
      name: `copy-${index}.png`,
      path: path.join(WORKSPACE, `copy-${index}.png`),
      duplicate_group: "copies",
      has_duplicate_file: true,
    }));
    await route.fulfill({
      json: { ...folder, items: members, subfolders: [], subfolder_count: 0 },
    });
  });
  await page.route("**/api/duplicates?**", (route) =>
    route.fulfill({
      json: {
        folder: WORKSPACE,
        groups: [{ group: "copies", max_distance: 0, threshold: "near", members }],
        stale: [],
        deletes_to_trash: true,
      },
    }),
  );
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
  await page.getByRole("button", { name: /^Review/ }).click();
  await page.getByRole("menuitem", { name: /^Duplicate groups/ }).click();
  const panel = page.locator(".duplicate-resolver-modal__panel");
  await expect(panel).toBeVisible();
  // The entrance animation scales the panel; measure its resting layout.
  await panel.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) animation.finish();
  });
  const cards = await panel.locator(".duplicate-resolver-modal__card").all();
  const boxes = await Promise.all(cards.map(async (card) => (await card.boundingBox())!));
  const rows = new Set(boxes.map((box) => Math.round(box.y)));
  const columns = new Set(boxes.map((box) => Math.round(box.x)));
  expect([rows.size, columns.size]).toEqual([2, 3]);
  // Both rows fit the panel, so nothing scrolls and each file is large enough to compare.
  const body = panel.locator(".duplicate-resolver-modal__body");
  expect(await body.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  const stages = await panel.locator(".duplicate-resolver-modal__card-stage").all();
  const heights = await Promise.all(
    stages.map(async (stage) => (await stage.boundingBox())!.height),
  );
  expect(Math.min(...heights)).toBeGreaterThan(250);
  // The suggested keeper's label must not shorten its picture against the rest of the row.
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("six-duplicates.png"),
  });
});
