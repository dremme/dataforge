import { expect, test } from "@playwright/test";
import { openWorkspace } from "./workspace";
import type { JobsResponse } from "../src/shared/types";

test("reverse tab from the initial dialog focus cannot reach the gallery", async ({ page }) => {
  await openWorkspace(page);
  await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toBeVisible();
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
});

test("closing a native dialog restores focus to its opener", async ({ page }) => {
  await openWorkspace(page);
  const opener = page.getByRole("button", { name: "Open settings", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("the offline cover remains above an open native dialog", async ({ page }) => {
  let releaseHealth!: () => void;
  const unavailable = new Promise<void>((resolve) => {
    releaseHealth = resolve;
  });
  await page.route("**/api/health", async (route) => {
    await unavailable;
    await route.abort("connectionfailed");
  });
  try {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Open settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
    releaseHealth();
    const cover = page.locator("dialog.backend-unavailable");
    await expect(cover).toBeVisible({ timeout: 15_000 });
    await expect(cover.getByRole("alert")).toBeVisible();
    expect(await cover.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    await page.keyboard.press("Escape");
    await expect(cover).toBeVisible();
    await expect(page.locator("dialog.settings-dialog")).toHaveCount(1);
  } finally {
    releaseHealth();
  }
});

test("a job filter menu stays inside its modal and owns the first Escape", async ({ page }) => {
  const history: JobsResponse = {
    jobs: [
      {
        id: "example-job",
        folder: "C:\\Media",
        folder_name: "Media",
        job_type: "auto_caption",
        status: "completed",
        effective_status: "completed",
        total: 1,
        processed: 1,
        stats: {},
        workflow_edited: false,
        revision: 1,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    total: 1,
    active_count: 0,
    revision: 1,
  };
  await page.route("**/api/jobs?**", (route) =>
    route.fulfill({
      json: history,
    }),
  );
  await openWorkspace(page);
  await page.getByRole("button", { name: /^Open automation jobs/ }).click();
  const jobs = page.getByRole("dialog", { name: "Automation jobs" });
  await jobs.getByRole("button", { name: /^Type:/ }).click();
  const menu = jobs.getByRole("menu", { name: "Job types" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitemcheckbox", { name: "All types", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(jobs).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(jobs).toHaveCount(0);
});

test("form cancellation preserves edits until discard is confirmed", async ({ page }, testInfo) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Auto-caption", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start auto-caption?" });
  const option = dialog.getByRole("checkbox", { name: "Caption audio", exact: true });
  const original = await option.isChecked();
  await dialog.getByText("Caption audio", { exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Discard changes?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator(".dialog-backdrop")).toHaveCSS("backdrop-filter", "none");
  await page.screenshot({
    path: testInfo.outputPath("discard-changes.png"),
    animations: "disabled",
  });
  await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(option).toBeChecked({ checked: !original });
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Auto-caption", exact: true })).toBeFocused();
});

test("settings keep their draft after Escape and close without prompting after undo", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const original = await dialog.getByRole("radio", { checked: true }).getAttribute("value");
  const editedName = original === "light" ? "Dark" : "Light";
  const edited = dialog.getByRole("radio", { name: new RegExp(`^${editedName}`) });
  await dialog.getByText(editedName, { exact: true }).click();
  await page.keyboard.press("Escape");
  const confirmation = page.getByRole("alertdialog", { name: "Discard changes?" });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(edited).toBeChecked();
  const originalName = original === "system" ? "System" : original === "light" ? "Light" : "Dark";
  await dialog.getByText(originalName, { exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);
});

for (const name of ["Cancel", "Close"]) {
  test(`Enter activates the focused ${name} without starting a job`, async ({ page }) => {
    let starts = 0;
    await page.route("**/api/automation/auto-caption?**", (route) => {
      starts += 1;
      return route.fulfill({ status: 503, json: { detail: "No job should start." } });
    });
    await openWorkspace(page);
    await page.getByRole("button", { name: "Auto-caption", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start auto-caption?" });
    const dismiss = dialog.getByRole("button", { name, exact: true });
    await dismiss.focus();
    // Exercise the shortcut after the opening key guard has expired.
    await page.waitForTimeout(150);
    await dismiss.press("Enter");

    await expect(dialog).toHaveCount(0);
    expect(starts).toBe(0);
  });
}

test("Escape dismisses the discard confirmation and retains the instruction draft", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Edit instructions", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Folder instructions" });
  const prompt = editor.getByRole("textbox", { name: "System prompt" });
  const draft = "Describe the scene using the edited instructions.";
  await prompt.fill(draft);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Discard changes?" });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(confirmation).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(prompt).toHaveText(draft);
  await expect(editor.getByRole("button", { name: "Close", exact: true })).toBeFocused();
});

test("keyboard shortcuts has one close control and dismisses through its backdrop", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toBeVisible();
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("shortcuts-dialog.png"),
    animations: "disabled",
  });
  await page.getByLabel("Close dialog", { exact: true }).click({
    position: { x: 8, y: 8 },
  });
  await expect(dialog).toHaveCount(0);
});
