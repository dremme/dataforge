import { expect, test } from "@playwright/test";
import { openWorkspace } from "./workspace";

test("form cancellation preserves edits until discard is confirmed", async ({ page }, testInfo) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Auto-caption", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Start auto-caption?" });
  const option = dialog.getByRole("checkbox", { name: "Caption audio", exact: true });
  const original = await option.isChecked();
  await dialog.getByText("Caption audio", { exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Discard changes?" });
  await expect(confirmation).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("discard-changes.png"),
    animations: "disabled",
  });
  await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(option).toBeChecked({ checked: !original });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
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
    const dialog = page.getByRole("alertdialog", { name: "Start auto-caption?" });
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
  await page.getByRole("button", { name: "Close dialog", exact: true }).click({
    position: { x: 8, y: 8 },
  });
  await expect(dialog).toHaveCount(0);
});
