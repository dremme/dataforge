/** Slack for sub-pixel scroll heights and browser zoom; an exact comparison never holds. */
const BOTTOM_EPSILON_PX = 8;

/**
 * Whether the log should keep following new output. False once the reader scrolls up to read
 * something, true again as soon as they come back to the bottom.
 */
export function shouldStickToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_EPSILON_PX;
}
