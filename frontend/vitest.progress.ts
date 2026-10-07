import type { UserConsoleLog } from "vitest";
import type { Reporter, TestSpecification } from "vitest/node";

const PROGRESS_PREFIX = "@progress ";
const WARNINGS_PREFIX = "@warnings ";

export default class ProgressReporter implements Reporter {
  private total = 0;
  private finished = 0;
  private warnings = 0;

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    this.total = specifications.length;
    this.finished = 0;
    this.warnings = 0;
    this.report();
  }

  onTestModuleEnd(): void {
    this.finished += 1;
    this.report();
  }

  // console.warn and console.error land here; a test that mocks them out is not counted.
  onUserConsoleLog(log: UserConsoleLog): void {
    if (log.type === "stderr") {
      this.warnings += 1;
    }
  }

  onTestRunEnd(): void {
    if (this.warnings > 0) {
      process.stdout.write(`${WARNINGS_PREFIX}${this.warnings}\n`);
    }
  }

  private report(): void {
    if (process.env.DATAFORGE_PROGRESS) {
      process.stdout.write(`${PROGRESS_PREFIX}${this.finished}/${this.total}\n`);
    }
  }
}
