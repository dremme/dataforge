import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { WORKSPACE, openWorkspace } from "./workspace";

async function openPhoto(page: Page, parent = WORKSPACE) {
  const folder = await mkdtemp(path.join(parent, "unsaved-changes-"));
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

/** Earlier specs crowd the shared root until `photo.png` falls outside the rendered gallery. */
async function openParentFolder(page: Page) {
  const parent = await mkdtemp(path.join(WORKSPACE, "unsaved-parent-"));
  await copyFile(path.join(WORKSPACE, "photo.png"), path.join(parent, "photo.png"));
  await copyFile(path.join(WORKSPACE, "clip.mp4"), path.join(parent, "clip.mp4"));
  const previous = await openPhoto(page, parent);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: path.basename(parent), exact: true }).click();
  await expect(page.getByRole("button", { name: "View clip.mp4", exact: true })).toBeVisible();
  return { parent, previous };
}

const confirmation = (page: Page) => page.getByRole("alertdialog", { name: "Discard changes?" });
const browserBack = (page: Page) => page.evaluate(() => window.history.back());

test("renaming asks before losing the parent media draft", async ({ page }) => {
  await openPhoto(page);
  await rotate(page);
  await page.getByRole("button", { name: "Rename photo.png", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename file" });
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
  const rename = page.getByRole("dialog", { name: "Rename file" });
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

async function openFolderCard(page: Page, folder: string) {
  await expect(page.getByRole("button", { name: "View clip.mp4", exact: true })).toBeVisible();
  const moreFolders = page.getByRole("button").filter({ hasText: /^Show \d+ more folders/ });
  if (await moreFolders.count()) await moreFolders.click();
  await page
    .locator("button.folder-card")
    .filter({ hasText: path.basename(folder) })
    .click();
}

async function openVideoProject(page: Page, extraHistory = 0) {
  const folder = await mkdtemp(path.join(WORKSPACE, "unsaved-project-"));
  await copyFile(path.join(WORKSPACE, "clip.mp4"), path.join(folder, "clip.mp4"));
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  for (let step = 0; step <= extraHistory; step++) {
    await page.getByRole("button", { name: "dataforge-e2e", exact: true }).click();
    await openFolderCard(page, folder);
  }
  await page.getByRole("button", { name: "View clip.mp4", exact: true }).click();
  await page
    .getByRole("button", { name: "Open clip.mp4 in the video editor", exact: true })
    .click();
}

async function openUnsavedVideoProject(page: Page, extraHistory = 0) {
  await openVideoProject(page, extraHistory);
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
    const width = page.locator("dialog").filter({ has: page.getByLabel("Width", { exact: true }) });
    await expect(width).toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await expect(confirmation(page)).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(width.getByLabel("Width", { exact: true })).toHaveValue("800");
    release();
    await expect(page.locator(".video-settings-dialog")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Project name", includeHidden: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

for (const close of ["button", "Escape"] as const) {
  test(`a slow local close by ${close} blocks media and nested rename drafts`, async ({ page }) => {
    await openPhoto(page);
    let release!: () => void;
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/caption?**", async (route) => {
      if (route.request().method() === "PUT") await saving;
      await route.continue();
    });
    try {
      await page.getByRole("textbox", { name: "Caption for photo.png" }).fill("Edited caption.");
      const started = page.waitForRequest(
        (request) => request.method() === "PUT" && request.url().includes("/api/caption?"),
      );
      if (close === "button")
        await page.getByRole("button", { name: "Close", exact: true }).click();
      else {
        await page.getByRole("button", { name: "Close", exact: true }).focus();
        await page.keyboard.press("Escape");
      }
      await started;
      await expect(
        page.getByRole("button", { name: "Edit photo.png", exact: true, includeHidden: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Rename photo.png", exact: true, includeHidden: true }),
      ).toBeDisabled();
      await expect(page.locator(".gallery-item-dialog--inline")).toHaveAttribute("inert", "");
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowRight");
      release();
      await expect(page.locator(".gallery-item-dialog")).toHaveCount(0);
      await expect(page.locator(".rename-dialog")).toHaveCount(0);
      await expect(confirmation(page)).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("cancelling a slow save retry preserves newer nested project settings", async ({ page }) => {
  await openVideoProject(page);
  await page.getByRole("textbox", { name: "Project name" }).fill("Saved project");
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");
  await expect(page.locator(".video-editor__save")).toHaveText("Saved");
  await expect(page).toHaveURL(/\/editor\/project\?/);
  let fail = true;
  let release!: () => void;
  const saving = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/video-projects/project", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    if (fail) return route.fulfill({ status: 503, json: { detail: "Save unavailable." } });
    await saving;
    return route.continue();
  });
  try {
    await page.getByRole("textbox", { name: "Project name" }).fill("Edited project");
    await page.getByRole("textbox", { name: "Project name" }).press("Enter");
    await expect(page.locator(".video-editor__save")).toContainText("Save failed");
    await page.getByRole("button", { name: /^Project settings:/ }).click();
    await page.getByLabel("Width", { exact: true }).fill("800");
    await browserBack(page);
    await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
    const failure = page.getByRole("alertdialog", { name: "Your latest changes are not saved" });
    await expect(failure).toBeVisible();
    fail = false;
    const started = page.waitForRequest(
      (request) =>
        request.method() === "PUT" && request.url().endsWith("/api/video-projects/project"),
    );
    await failure.getByRole("button", { name: "Retry save", exact: true }).click();
    await started;
    await page.keyboard.press("Escape");
    await expect(failure).toHaveCount(0);
    await page.getByLabel("Width", { exact: true }).fill("900");
    release();
    await expect(page.locator(".video-editor__save")).toHaveText("Saved");
    await expect(page.getByLabel("Width", { exact: true })).toHaveValue("900");
    await expect(confirmation(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(confirmation(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Width", { exact: true })).toHaveValue("900");
  } finally {
    release();
  }
});

test("reverting during a save keeps reload protection until the original is saved", async ({
  page,
}) => {
  const folder = await openPhoto(page);
  let release!: () => void;
  const saving = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/api/caption?**", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    await saving;
    await route.fulfill({ response });
  });
  try {
    const caption = page.getByRole("textbox", { name: "Caption for photo.png" });
    await expect(caption).toHaveText("Original caption.");
    await caption.fill("First draft.");
    const captionUrl = `/api/caption?path=${encodeURIComponent(path.join(folder, "photo.png"))}`;
    await expect
      .poll(async () => (await (await page.request.get(captionUrl)).json()).description)
      .toBe("First draft.");
    await caption.fill("Original caption.");
    const warning = page.waitForEvent("dialog");
    const reload = page.evaluate(() => window.location.reload());
    const dialog = await warning;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await reload;
    await expect(caption).toHaveText("Original caption.");
    release();
    await expect
      .poll(async () => (await (await page.request.get(captionUrl)).json()).description)
      .toBe("Original caption.");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".gallery-item-dialog")).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "View photo.png", exact: true }).click();
    await expect(caption).toHaveText("Original caption.");
  } finally {
    release();
  }
});

test("discard waits for an autosave already writing a newer caption", async ({ page }) => {
  await openPhoto(page);
  let fail = true;
  let release!: () => void;
  const saving = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/caption?**", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    if (fail) return route.fulfill({ status: 503, json: { detail: "Save unavailable." } });
    await saving;
    return route.continue();
  });
  try {
    const caption = page.getByRole("textbox", { name: "Caption for photo.png" });
    await caption.fill("Failed caption.");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const discard = page.getByRole("button", { name: "Discard and continue", exact: true });
    await expect(discard).toBeEnabled();
    fail = false;
    const started = page.waitForRequest(
      (request) => request.method() === "PUT" && request.url().includes("/api/caption?"),
    );
    await caption.fill("Caption being saved.");
    await started;
    await expect(discard).toBeDisabled();
    await caption.fill("Newer pending caption.");
    await expect(discard).toBeDisabled();
    release();
    await expect(discard).toBeEnabled();
    await discard.click();
    await expect(page.locator(".gallery-item-dialog")).toHaveCount(0);
  } finally {
    release();
  }
});

for (const repeats of [1, 3]) {
  test(`${repeats} repeated browser Back presses preserve the pending navigation and nested draft lock`, async ({
    page,
  }) => {
    let release!: () => void;
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/video-projects/project", async (route) => {
      if (route.request().method() === "PUT") await saving;
      return route.continue();
    });
    try {
      await openUnsavedVideoProject(page, repeats);
      await browserBack(page);
      await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
      await expect(page.locator("dialog:has(.video-settings-dialog)")).toHaveAttribute("inert", "");
      await page.evaluate((count) => {
        for (let step = 0; step < count; step++) window.history.back();
      }, repeats);
      await expect(page.locator("dialog:has(.video-settings-dialog)")).toHaveAttribute("inert", "");
      await page.keyboard.press("Escape");
      release();
      await expect(page.locator(".video-editor")).toHaveCount(0);
      await expect(page.locator(".video-settings-dialog")).toHaveCount(0);
      await expect(confirmation(page)).toHaveCount(0);
      await expect(page).not.toHaveURL(/\/editor\//);
    } finally {
      release();
    }
  });
}

test("keeping nested edits after autosave preserves the editor's Back and Forward entries", async ({
  page,
}) => {
  let release!: () => void;
  const saving = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/video-projects/project", async (route) => {
    if (route.request().method() === "PUT") await saving;
    return route.continue();
  });
  try {
    await openUnsavedVideoProject(page);
    await browserBack(page);
    await expect(confirmation(page)).toBeVisible();
    release();
    await expect(page.locator(".video-editor__save")).toHaveText("Saved");
    await confirmation(page).getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(page.getByLabel("Width", { exact: true })).toHaveValue("800");
    await expect(page).toHaveURL(/\/editor\/project\?/);
    await browserBack(page);
    await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.locator(".video-editor")).toHaveCount(0);
    await page.evaluate(() => window.history.forward());
    await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "Unsaved project",
    );
    await expect(page.locator(".video-settings-dialog")).toHaveCount(0);
  } finally {
    release();
  }
});

test("repeated Back followed by Keep editing preserves both nested training drafts", async ({
  page,
}) => {
  const { parent, previous } = await openParentFolder(page);
  await openFolderCard(page, previous);
  await page.getByRole("button", { name: path.basename(parent), exact: true }).click();
  const currentUrl = page.url();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Quick LoRA training/ }).click();
  await page.getByLabel("LoRA name", { exact: true }).fill("sample_draft");
  await page.getByRole("button", { name: "Edit template", exact: true }).click();
  const editor = page.getByRole("dialog", { name: /^Edit the .* training template$/ });
  const yaml = editor.getByRole("textbox", { name: /training template$/ });
  await yaml.fill("steps: 250\n");
  await browserBack(page);
  await expect(confirmation(page)).toBeVisible();
  await browserBack(page);
  await confirmation(page).getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(currentUrl);
  await expect(yaml).toContainText("steps: 250");
  await expect(
    page.locator(".train-lora-dialog").getByLabel("LoRA name", { exact: true }),
  ).toHaveValue("sample_draft");
});

test("failed project navigation gives only the save failure dialog keyboard control", async ({
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
    const { parent, previous } = await openParentFolder(page);
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
      await expect(page.locator(".gallery-item-dialog--inline")).toHaveAttribute("inert", "");
      await expect(confirmation(page)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("button", { name: "View clip.mp4", exact: true })).toHaveCount(
        direction === "back" ? 1 : 0,
      );
      release();
      await expect(page.locator(".gallery-item-dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "View clip.mp4", exact: true })).toHaveCount(
        direction === "back" ? 0 : 1,
      );
      const saved = await page.request.get(
        `/api/caption?path=${encodeURIComponent(path.join(direction === "back" ? parent : previous, "photo.png"))}`,
      );
      expect((await saved.json()).description).toBe("Caption saved before navigation.");
      await expect(confirmation(page)).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("browser discard closes persistent settings and clears their draft", async ({ page }) => {
  const { previous } = await openParentFolder(page);
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
    const { previous } = await openParentFolder(page);
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
    await expect(page.locator(".gallery-item-dialog")).toHaveCount(0);
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
  const { previous } = await openParentFolder(page);
  const currentUrl = page.url();
  await page.getByRole("button", { name: /^(Edit|Create) instructions$/ }).click();
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
  await expect(prompt).toBeFocused();
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
  const parent = page.getByRole("dialog", { name: "Start LoRA training?" });
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
  await expect(yaml).toBeFocused();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(parent.getByLabel("LoRA name", { exact: true })).toHaveValue("sample_draft");
  await expect(parent.getByRole("button", { name: "Edit template" })).toBeFocused();
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
  const dialog = page.getByRole("dialog", { name: "Project settings", exact: true });
  await dialog.getByLabel("Width", { exact: true }).fill("800");
  await browserBack(page);
  await expect(confirmation(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByLabel("Width", { exact: true })).toHaveValue("800");
  await expect(dialog.getByLabel("Width", { exact: true })).toBeFocused();
  await browserBack(page);
  await confirmation(page).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveCount(0);
});

test("browser Back discards gallery edits once before changing folders", async ({ page }) => {
  const { previous } = await openParentFolder(page);
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
  const { previous } = await openParentFolder(page);
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
