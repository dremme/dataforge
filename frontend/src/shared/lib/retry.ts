export const LOAD_RETRY_DELAYS_MS = [250, 500, 1000, 1500, 2000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  delays: number[] = LOAD_RETRY_DELAYS_MS,
  shouldRetry: (error: unknown) => boolean = () => true,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error)) {
        throw error;
      }
      const delayMs = delays[attempt];
      if (delayMs === undefined) break;
      await delay(delayMs);
    }
  }

  throw lastError;
}
