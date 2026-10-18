import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { WORKSPACE, openWorkspace } from "./workspace";

async function openPhoto(page: Page) {
  const folder = await mkdtemp(path.join(WORKSPACE, "unsaved-changes-"));
  await copyFile(path.join(WORKSPACE, "photo.png"), path.join(folder, "photo.png"));
  await writeFile(path.join(folder, "photo.txt"), "Original caption.");
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  await page.getByRole("button", { name: "View photo.png", exact: true }).click();
  return folder;
}

async function rotate(page: Page) {
  await page.getByRole("button", { name: "Edit photo.png", exact: true }).click();
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await expect(page.locator(".image-edit-stage__canvas")).toHaveCSS("--edit-rotate", "90deg");
}

async function openParentFolder(page: Page) {
  const previous = await openPhoto(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "dataforge-e2e", exact: true }).click();
  await expect(page.getByRole("button", { name: "View clip.mp4", exact: true })).toBeVisible();
  return previous;
}

const confirmation = (page: Page) => page.getByRole("alertdialog", { name: "Discard changes?" });
const browserBack = (page: Page) => page.evaluate(() => window.history.back());

test("renaming asks before losing the parent media draft", async ({ page }) => {
  await openPhoto(page);
  await rotate(page);
  await page.getByRole("button", { name: "Rename photo.png", exact: true }).click();
  const rename = page.getByRole("alertdialog", { name: "Rename file" });
  await rename.getByRole("textbox", { name: "File name" }).fill("renamed");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(confirmation(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rename.getByRole("textbox", { name: "File name" })).toHaveValue("renamed");
  await expect(page.locator(".image-edit-stage__canvas")).toHaveCSS("--edit-rotate", "90deg");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Viewing renamed.png" })).toBeVisible();
  await expect(page.locator(".image-edit-stage__canvas")).toHaveCSS("--edit-rotate", "0deg");
});

test("a failed caption save preserves the proposed filename", async ({ page }) => {
  await openPhoto(page);
  let unavailable = true;
  await page.route("**/api/caption?**", (route) =>
    route.request().method() === "PUT" && unavailable
      ? route.fulfill({ status: 503, json: { detail: "Save unavailable." } })
      : route.continue(),
  );
  await page.getByRole("textbox", { name: "Caption for photo.png" }).fill("Edited caption.");
  await page.getByRole("button", { name: "Rename photo.png", exact: true }).click();
  const rename = page.getByRole("alertdialog", { name: "Rename file" });
  await rename.getByRole("textbox", { name: "File name" }).fill("new-name");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(rename).toContainText("The caption could not be saved");
  await expect(rename.getByRole("textbox", { name: "File name" })).toHaveValue("new-name");
  unavailable = false;
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(rename).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Caption for new-name.png" })).toHaveText(
    "Edited caption.",
  );
});

async function openUnsavedVideoProject(page: Page) {
  const folder = await mkdtemp(path.join(WORKSPACE, "unsaved-project-"));
  await copyFile(path.join(WORKSPACE, "clip.mp4"), path.join(folder, "clip.mp4"));
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  await page.getByRole("button", { name: "dataforge-e2e", exact: true }).click();
  await page
    .locator("button.folder-card")
    .filter({ hasText: path.basename(folder) })
    .click();
  await page.getByRole("button", { name: "View clip.mp4", exact: true }).click();
  await page
    .getByRole("button", { name: "Open clip.mp4 in the video editor", exact: true })
    .click();
  const started = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().endsWith("/api/video-projects/project"),
  );
  await page.getByRole("textbox", { name: "Project name" }).fill("Unsaved project");
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");
  await started;
  await page.getByRole("button", { name: /^Project settings:/ }).click();
  const settings = page.getByRole("dialog", { name: "Project settings", exact: true });
  await settings.getByLabel("Width", { exact: true }).fill("800");
  return settings;
}

test("discard keeps nested forms suspended until a slow project save finishes", async ({
  page,
}) => {
  let release!: () => void;
  const saving = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/video-projects/project", async (route) => {
    if (route.request().method() === "PUT") await saving;
    await route.continue();
  });
  try {
    await openUnsavedVideoProject(page);
    await browserBack(page);
    await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
    await expect(confirmation(page)).toHaveCount(0);
    const width = page
      .locator(".modal-panel")
      .filter({ has: page.getByLabel("Width", { exact: true }) });
    await expect(width).toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await expect(confirmation(page)).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(width.getByLabel("Width", { exact: true })).toHaveValue("800");
    release();
    await expect(page.locator(".video-settings-modal")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Project name", includeHidden: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test("failed project navigation gives only the save failure modal keyboard control", async ({
  page,
}, testInfo) => {
  await page.route("**/api/video-projects/project", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "Save unavailable." } })
      : route.continue(),
  );
  const settings = await openUnsavedVideoProject(page);
  const currentUrl = page.url();
  await browserBack(page);
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  const failure = page.getByRole("alertdialog", { name: "Your latest changes are not saved" });
  await expect(failure).toBeVisible();
  await expect(settings).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("nested-save-failure.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Tab");
  await expect(failure.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(failure).toHaveCount(0);
  await expect(confirmation(page)).toHaveCount(0);
  await expect(settings.getByLabel("Width", { exact: true })).toHaveValue("800");
  await expect(page).toHaveURL(currentUrl);
});

for (const direction of ["back", "forward"] as const) {
  test(`browser ${direction} waits for a slow caption save before changing folders`, async ({
    page,
  }) => {
    const previous = await openParentFolder(page);
    if (direction === "forward") {
      await browserBack(page);
      await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(previous);
    }
    let release!: () => void;
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/caption?**", async (route) => {
      if (route.request().method() === "PUT") await saving;
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: "View photo.png", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Caption for photo.png" })
        .fill("Caption saved before navigation.");
      await page.evaluate((action) => window.history[action](), direction);
      await expect(page.locator(".gallery-item-modal--inline")).toHaveAttribute("inert", "");
      await expect(confirmation(page)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("button", { name: "View clip.mp4", exact: true })).toHaveCount(
        direction === "back" ? 1 : 0,
      );
      release();
      await expect(page.locator(".gallery-item-modal")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "View clip.mp4", exact: true })).toHaveCount(
        direction === "back" ? 0 : 1,
      );
      const saved = await page.request.get(
        `/api/caption?path=${encodeURIComponent(path.join(direction === "back" ? WORKSPACE : previous, "photo.png"))}`,
      );
      expect((await saved.json()).description).toBe("Caption saved before navigation.");
      await expect(confirmation(page)).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("browser discard closes persistent settings and clears their draft", async ({ page }) => {
  const previous = await openParentFolder(page);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByText("Light", { exact: true }).click();
  await browserBack(page);
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(previous);
  await expect(settings).toHaveCount(0);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation(page)).toHaveCount(0);
});

for (const direction of ["back", "forward"] as const) {
  test(`failed captions protect browser ${direction} and reload until discarded`, async ({
    page,
  }) => {
    const previous = await openParentFolder(page);
    if (direction === "forward") {
      await browserBack(page);
      await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(previous);
    }
    const currentUrl = page.url();
    await page.route("**/api/caption?**", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 503, json: { detail: "Save unavailable." } })
        : route.continue(),
    );
    await page.getByRole("button", { name: "View photo.png", exact: true }).click();
    const caption = page.getByRole("textbox", { name: "Caption for photo.png" });
    await caption.fill("Unsaved caption draft.");
    await page.evaluate((action) => window.history[action](), direction);
    await expect(confirmation(page)).toBeVisible();
    await expect(confirmation(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation(page)).toHaveCount(0);
    await expect(page).toHaveURL(currentUrl);
    await expect(caption).toHaveText("Unsaved caption draft.");
    const unload = page.waitForEvent("dialog");
    const reload = page.evaluate(() => window.location.reload());
    const warning = await unload;
    expect(warning.type()).toBe("beforeunload");
    await warning.dismiss();
    await reload;
    await expect(caption).toHaveText("Unsaved caption draft.");
    await page.evaluate((action) => window.history[action](), direction);
    await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.locator(".gallery-item-modal")).toHaveCount(0);
    await expect(page).not.toHaveURL(currentUrl);
  });
}

for (const key of ["Home", "End", "ArrowLeft", "ArrowRight", "Control+Enter"]) {
  test(`${key} keeps media edits when its destination is the current item`, async ({ page }) => {
    await openPhoto(page);
    await rotate(page);
    await page.keyboard.press(key);
    await expect(confirmation(page)).toHaveCount(0);
    await expect(page.locator(".image-edit-stage__canvas")).toHaveCSS("--edit-rotate", "90deg");
  });
}

test("browser Back keeps instructions and the URL until discard is confirmed", async ({
  page,
}, testInfo) => {
  const previous = await openParentFolder(page);
  const currentUrl = page.url();
  await page.getByRole("button", { name: "Edit instructions", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Folder instructions" });
  const prompt = editor.getByRole("textbox", { name: "System prompt" });
  await prompt.fill("Unsaved instruction draft.");
  await browserBack(page);
  await expect(confirmation(page)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("navigation-discard.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(currentUrl);
  await expect(prompt).toHaveText("Unsaved instruction draft.");
  await browserBack(page);
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(previous);
});

test("browser Back protects drafts in both levels of the training form", async ({ page }) => {
  await openParentFolder(page);
  const currentUrl = page.url();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Quick LoRA training/ }).click();
  const parent = page.getByRole("alertdialog", { name: "Start LoRA training?" });
  await parent.getByLabel("LoRA name", { exact: true }).fill("sample_draft");
  await parent.getByRole("button", { name: "Edit template" }).click();
  const editor = page.getByRole("dialog", { name: /^Edit the .* training template$/ });
  const yaml = editor.getByRole("textbox", { name: /training template$/ });
  await yaml.fill("steps: 250\n");
  await browserBack(page);
  await expect(confirmation(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(currentUrl);
  await expect(yaml).toContainText("steps: 250");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(parent.getByLabel("LoRA name", { exact: true })).toHaveValue("sample_draft");
  await parent.getByRole("button", { name: "Edit template" }).click();
  await browserBack(page);
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(parent).toHaveCount(0);
});

test("browser Back protects nested video project settings", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "View clip.mp4", exact: true }).click();
  await page
    .getByRole("button", { name: "Open clip.mp4 in the video editor", exact: true })
    .click();
  await page.getByRole("button", { name: /^Project settings:/ }).click();
  const modal = page.getByRole("dialog", { name: "Project settings", exact: true });
  await modal.getByLabel("Width", { exact: true }).fill("800");
  await browserBack(page);
  await expect(confirmation(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal.getByLabel("Width", { exact: true })).toHaveValue("800");
  await browserBack(page);
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveCount(0);
});

test("browser Back discards gallery edits once before changing folders", async ({ page }) => {
  const previous = await openParentFolder(page);
  await page.getByRole("button", { name: "View photo.png", exact: true }).click();
  await rotate(page);
  await browserBack(page);
  await expect(confirmation(page)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".image-edit-stage__canvas")).toHaveCSS("--edit-rotate", "90deg");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Viewing photo.png" })).toBeVisible();
  await browserBack(page);
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(previous);
  await expect(page.getByRole("dialog", { name: "Viewing photo.png" })).toHaveCount(0);
  await expect(confirmation(page)).toHaveCount(0);
});

test("browser Forward preserves a draft when navigation is cancelled", async ({ page }) => {
  const previous = await openParentFolder(page);
  const nextUrl = page.url();
  await browserBack(page);
  await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(previous);
  await page.getByRole("button", { name: /^(Edit|Create) instructions$/, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Folder instructions" });
  await editor.getByRole("textbox", { name: "System prompt" }).fill("Unsaved forward draft.");
  await page.evaluate(() => window.history.forward());
  await expect(confirmation(page)).toBeVisible();
  await confirmation(page).getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(previous);
  await expect(editor.getByRole("textbox", { name: "System prompt" })).toHaveText(
    "Unsaved forward draft.",
  );
  await page.evaluate(() => window.history.forward());
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(nextUrl);
  await expect(editor).toHaveCount(0);
});
