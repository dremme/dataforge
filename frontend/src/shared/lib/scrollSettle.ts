/** Give up if the target stays out of reach this long. */
const DEFAULT_TIMEOUT_MS = 1000;

export interface ScrollSettleOptions {
  timeoutMs?: number;
}

/**
 * Drive a container to a scroll offset that its content may not reach yet.
 *
 * The gallery is virtualized on estimated row heights, so at the commit where a
 * folder first paints the scrollable height can be far short of the offset we
 * are restoring and the write silently clamps. Rows measure over the following
 * frames and the height inflates, so the write is repeated until it lands.
 *
 * Deliberately stops the moment it does land: the virtualizer writes `scrollTop`
 * itself to keep content stable when a row above the offset measures, and a loop
 * that kept re-asserting would fight that correction.
 */
export function settleScrollPosition(
  element: HTMLElement,
  target: number,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: ScrollSettleOptions = {},
): () => void {
  let finished = false;
  let rafId = 0;

  const previousOverflowAnchor = element.style.overflowAnchor;
  element.style.overflowAnchor = "none";

  const startTime = performance.now();

  // Read back rather than comparing against `scrollHeight - clientHeight`: the
  // read-back answers "was the container tall enough" directly, and it is the
  // only form that survives jsdom, which has no layout.
  const apply = (): boolean => {
    element.scrollTop = target;
    return element.scrollTop >= target - 1;
  };

  const finish = () => {
    if (finished) return;
    finished = true;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    element.style.overflowAnchor = previousOverflowAnchor;
    element.removeEventListener("wheel", finish, { capture: true });
    element.removeEventListener("touchstart", finish, { capture: true });
    window.removeEventListener("keydown", finish);
    element.removeEventListener("mousedown", onMouseDown);
  };

  // A mousedown on the scroller itself rather than on a descendant means the
  // scrollbar gutter was hit — the user is taking over mid-restore.
  function onMouseDown(event: MouseEvent) {
    if (event.target === element) {
      finish();
    }
  }

  element.addEventListener("wheel", finish, { passive: true, capture: true });
  element.addEventListener("touchstart", finish, { passive: true, capture: true });
  window.addEventListener("keydown", finish);
  element.addEventListener("mousedown", onMouseDown);

  const step = () => {
    rafId = 0;
    if (finished) return;

    if (apply()) {
      // One confirming frame: a row measuring right after we land can shift the
      // content under us, and this re-assert catches that without looping on.
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (finished) return;
        apply();
        finish();
      });
      return;
    }

    if (performance.now() - startTime > timeoutMs) {
      finish();
      return;
    }

    rafId = requestAnimationFrame(step);
  };

  step();

  return finish;
}
