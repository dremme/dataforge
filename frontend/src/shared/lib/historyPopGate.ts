const guards = new Set<(event: PopStateEvent) => void>();
let installed = false;

/** Install before the router so a held traversal never reaches its history listeners. */
export function installHistoryPopGate() {
  if (installed) return;
  installed = true;
  window.addEventListener("popstate", (event) => {
    for (const guard of guards) guard(event);
  });
}

export function registerHistoryPopGuard(guard: (event: PopStateEvent) => void) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}
