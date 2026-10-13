import type { UserConsoleLog } from "vitest";
import type { Reporter, TestSpecification, Vitest } from "vitest/node";

const PROGRESS_PREFIX = "@progress ";
const WARNINGS_PREFIX = "@warnings ";
/** One line per warning, its text JSON-encoded so a multi-line message stays on that line. */
const WARNING_PREFIX = "@warning ";
const DETAIL_LENGTH = 200;

export default class ProgressReporter implements Reporter {
  private vitest: Vitest | null = null;
  private total = 0;
  private finished = 0;
  private warnings: string[] = [];

  onInit(vitest: Vitest): void {
    this.vitest = vitest;
  }

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    this.total = specifications.length;
    this.finished = 0;
    this.warnings = [];
    this.report();
  }

  onTestModuleEnd(): void {
    this.finished += 1;
    this.report();
  }

  // console.warn and console.error land here; a test that mocks them out is not counted.
  onUserConsoleLog(log: UserConsoleLog): void {
    if (log.type === "stderr") {
      this.warnings.push(this.describe(log));
    }
  }

  onTestRunEnd(): void {
    if (this.warnings.length > 0) {
      for (const warning of this.warnings) {
        process.stdout.write(`${WARNING_PREFIX}${JSON.stringify(warning)}\n`);
      }
      process.stdout.write(`${WARNINGS_PREFIX}${this.warnings.length}\n`);
    }
  }

  /** The message's first line and the test that logged it; the full text is in `npm test`. */
  private describe(log: UserConsoleLog): string {
    const firstLine = log.content.trim().split("\n", 1)[0] ?? "";
    const text =
      firstLine.length > DETAIL_LENGTH ? `${firstLine.slice(0, DETAIL_LENGTH)}…` : firstLine;
    const task = log.taskId ? this.vitest?.state.idMap.get(log.taskId) : undefined;
    const where = task ? `${task.file.name} > ${task.name}` : "outside a test";
    return `${text} (in ${where})`;
  }

  private report(): void {
    if (process.env.DATAFORGE_PROGRESS) {
      process.stdout.write(`${PROGRESS_PREFIX}${this.finished}/${this.total}\n`);
    }
  }
}
