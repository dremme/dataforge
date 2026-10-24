import { useEffect, useMemo, useRef, useState } from "react";
import { matchRegexTexts } from "@/features/gallery/lib/regexSearch";
import type {
  RegexSearchReply,
  RegexSearchRequest,
} from "@/features/gallery/lib/regexSearch.worker";

/** Long enough for a large folder's honest pattern; a backtracking one gets no further. */
export const REGEX_SEARCH_BUDGET_MS = 1000;

const NO_MATCHES: ReadonlySet<string> = new Set();

export type RegexSearchState =
  | { status: "idle" }
  /** `matches` is the last finished answer, shown until this one arrives. */
  | { status: "pending"; matches: ReadonlySet<string> }
  | { status: "ready"; matches: ReadonlySet<string> }
  | { status: "too-expensive"; matches: ReadonlySet<string> };

interface Settled {
  pattern: string;
  texts: readonly string[];
  status: "ready" | "too-expensive";
  matches: ReadonlySet<string>;
}

let nextRequestId = 0;

function matchedSet(texts: readonly string[], matches: readonly boolean[]): ReadonlySet<string> {
  return new Set(texts.filter((_, index) => matches[index]));
}

function createSearchWorker(): Worker {
  return new Worker(new URL("../lib/regexSearch.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Which of `texts` a search pattern matches, worked out off the main thread under a time budget.
 * A pattern that runs past it gets its worker terminated and reads as `too-expensive`, so a
 * backtracking pattern cannot freeze the gallery. `pattern` must already compile; `null` is idle.
 */
export function useRegexSearch(pattern: string | null, texts: readonly string[]): RegexSearchState {
  const workerAvailable = typeof Worker !== "undefined";
  const [settled, setSettled] = useState<Settled | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Without workers (jsdom, very old engines) there is nothing to time out, so match in place.
  const inline = useMemo(
    () =>
      !workerAvailable && pattern !== null
        ? matchedSet(texts, matchRegexTexts(pattern, texts))
        : null,
    [pattern, texts, workerAvailable],
  );

  useEffect(() => {
    if (!workerAvailable || pattern === null) return;

    const worker = workerRef.current ?? createSearchWorker();
    workerRef.current = worker;
    const id = ++nextRequestId;
    let done = false;

    const retire = () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    const timer = setTimeout(() => {
      done = true;
      retire();
      setSettled({ pattern, texts, status: "too-expensive", matches: NO_MATCHES });
    }, REGEX_SEARCH_BUDGET_MS);
    const onMessage = ({ data }: MessageEvent<RegexSearchReply>) => {
      if (data.id !== id) return;
      done = true;
      clearTimeout(timer);
      setSettled({ pattern, texts, status: "ready", matches: matchedSet(texts, data.matches) });
    };

    worker.addEventListener("message", onMessage);
    const request: RegexSearchRequest = { id, pattern, texts: [...texts] };
    worker.postMessage(request);

    return () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      // A worker still on this pattern would make the next one queue behind it.
      if (!done) retire();
    };
  }, [pattern, texts, workerAvailable]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  if (pattern === null) return { status: "idle" };
  if (inline) return { status: "ready", matches: inline };
  if (settled && settled.pattern === pattern && settled.texts === texts) {
    return { status: settled.status, matches: settled.matches };
  }
  return { status: "pending", matches: settled?.matches ?? NO_MATCHES };
}
