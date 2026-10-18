import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { WORKSPACE, expectJobCompleted } from "./workspace";

for (const job of ["Find & replace", "Edit captions"] as const) {
  for (const backup of [true, false]) {
    test(`${job} runs with caption backup ${backup ? "enabled" : "disabled"}`, async ({
      page,
    }, testInfo) => {
      const folder = fs.mkdtempSync(path.join(WORKSPACE, "caption-backup-"));
      const original =
        "A red hatchback was parked beside a stone wall with birch trees behind it. " +
        "A bicycle leaned against the wall and the light cast long shadows over the gravel.";
      fs.copyFileSync(path.join(WORKSPACE, "photo.png"), path.join(folder, "photo.png"));
      fs.writeFileSync(path.join(folder, "photo.txt"), original);
      fs.mkdirSync(path.join(folder, ".backup"));
      const existingBackup = "An earlier caption backup.";
      fs.writeFileSync(path.join(folder, ".backup", "photo.txt"), existingBackup);
      await page.setViewportSize({ width: 1024, height: 720 });
      await page.goto(`/?path=${encodeURIComponent(folder)}`);
      await expect(page.getByText("photo.png")).toBeVisible();
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByRole("menuitem", { name: new RegExp(job) }).click();
      const dialog = page.getByRole("alertdialog");
      const checkbox = dialog.getByRole("checkbox", { name: "Back up captions first" });
      const backupLabel = dialog.getByText("Back up captions first", { exact: true });
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toHaveAccessibleDescription(/Existing backups are overwritten/);

      if (!backup) {
        await backupLabel.click();
        await expect(checkbox).not.toBeChecked();
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByRole("button", { name: "Tools", exact: true }).click();
        await page.getByRole("menuitem", { name: new RegExp(job) }).click();
        await expect(checkbox).toBeChecked();
        await checkbox.focus();
        await checkbox.press("Space");
        await expect(checkbox).not.toBeChecked();
      }

      const replace = job === "Find & replace";
      if (replace) {
        await dialog.getByLabel("Search for").fill("red");
        await dialog.getByLabel("Replace with").fill("blue");
      } else {
        await dialog.getByLabel("Edit instruction").fill("Rewrite in present tense.");
      }
      await backupLabel.scrollIntoViewIfNeeded();
      await expect(backupLabel).toBeInViewport();
      const start = dialog.getByRole("button", {
        name: replace ? "Replace" : "Start edit captions",
        exact: true,
      });
      await expect(start).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath("backup-option.png"),
        animations: "disabled",
      });
      expect(fs.readFileSync(path.join(folder, ".backup", "photo.txt"), "utf-8")).toBe(
        existingBackup,
      );
      await start.click();
      await expect(dialog).not.toBeVisible();
      await expectJobCompleted(page, job, 30_000);
      expect(fs.readFileSync(path.join(folder, "photo.txt"), "utf-8")).not.toBe(original);
      if (backup) {
        expect(fs.readFileSync(path.join(folder, ".backup", "photo.txt"), "utf-8")).toBe(original);
      } else {
        expect(fs.readFileSync(path.join(folder, ".backup", "photo.txt"), "utf-8")).toBe(
          existingBackup,
        );
      }
    });
  }
}

test("Backup captions always overwrites existing copies without a checkbox", async ({
  page,
}, testInfo) => {
  const folder = fs.mkdtempSync(path.join(WORKSPACE, "caption-backup-"));
  const current = "A caption to back up.";
  fs.copyFileSync(path.join(WORKSPACE, "photo.png"), path.join(folder, "photo.png"));
  fs.writeFileSync(path.join(folder, "photo.txt"), current);
  fs.mkdirSync(path.join(folder, ".backup"));
  fs.writeFileSync(path.join(folder, ".backup", "photo.txt"), "An earlier caption backup.");
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  await expect(page.getByText("photo.png")).toBeVisible();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /Backup captions/ }).click();
  const dialog = page.getByRole("alertdialog", { name: "Back up captions?" });
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog).toContainText("Existing backups are overwritten.");
  await page.screenshot({
    path: testInfo.outputPath("backup-default.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Back up captions", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectJobCompleted(page, "Backup captions", 30_000);
  expect(fs.readFileSync(path.join(folder, ".backup", "photo.txt"), "utf-8")).toBe(current);
  expect(fs.readFileSync(path.join(folder, "photo.txt"), "utf-8")).toBe(current);
});
