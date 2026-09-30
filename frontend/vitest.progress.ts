import type { Reporter, TestSpecification } from "vitest/node";

const PROGRESS_PREFIX = "@progress ";

export default class ProgressReporter implements Reporter {
  private total = 0;
  private finished = 0;

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    this.total = specifications.length;
    this.finished = 0;
    this.report();
  }

  onTestModuleEnd(): void {
    this.finished += 1;
    this.report();
  }

  private report(): void {
    if (process.env.DATAFORGE_PROGRESS) {
      process.stdout.write(`${PROGRESS_PREFIX}${this.finished}/${this.total}\n`);
    }
  }
}
