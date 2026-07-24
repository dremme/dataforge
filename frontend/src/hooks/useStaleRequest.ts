import { useCallback, useRef } from "react";

export function useStaleRequest() {
  const requestRef = useRef(0);

  const next = useCallback(() => {
    requestRef.current += 1;
    return requestRef.current;
  }, []);

  const isCurrent = useCallback((requestId: number) => requestId === requestRef.current, []);

  const invalidate = useCallback(() => {
    requestRef.current += 1;
  }, []);

  return { next, isCurrent, invalidate };
}
