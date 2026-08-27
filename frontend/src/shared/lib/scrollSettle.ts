const DEFAULT_TIMEOUT_MS = 1000;

export interface ScrollSettleOptions {
  timeoutMs?: number;
}

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

  // Read back `scrollTop`; comparing to `scrollHeight` fails in jsdom, which has no layout.
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
