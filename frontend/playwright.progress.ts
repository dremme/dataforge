import type { FullConfig, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

const PROGRESS_PREFIX = "@progress ";

export default class ProgressReporter implements Reporter {
  private total = 0;
  private finished = 0;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.total = suite.allTests().length;
    this.finished = 0;
    this.report();
  }

  // A failed attempt with retries left runs again, so only a test's last attempt is counted.
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === test.expectedStatus || result.retry >= test.retries) {
      this.finished += 1;
      this.report();
    }
  }

  private report(): void {
    if (process.env.DATAFORGE_PROGRESS) {
      process.stdout.write(`${PROGRESS_PREFIX}${this.finished}/${this.total}\n`);
    }
  }
}
