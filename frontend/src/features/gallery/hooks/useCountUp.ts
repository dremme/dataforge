import { useEffect, useRef, useState, type RefObject } from "react";
import { easedCount } from "@/features/gallery/lib/countUp";

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function useCountUp(value: number, ref: RefObject<HTMLElement | null>): number {
  const [displayed, setDisplayed] = useState(0);
  const displayedRef = useRef(0);
  const visibleRef = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame = 0;
    let cancelled = false;

    const play = (to: number) => {
      cancelAnimationFrame(frame);
      const from = displayedRef.current;
      if (to === from || prefersReducedMotion()) {
        displayedRef.current = to;
        setDisplayed(to);
        return;
      }

      // Clock from the first vsync: counting the delay to it as elapsed makes the first tick jump.
      let started: number | undefined;
      const step = (now: number) => {
        if (cancelled) return;
        if (started === undefined) {
          started = now;
          frame = requestAnimationFrame(step);
          return;
        }
        const next = easedCount(from, to, now - started);
        if (next !== displayedRef.current) {
          displayedRef.current = next;
          setDisplayed(next);
        }
        if (next !== to) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    if (visibleRef.current) {
      play(value);
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        visibleRef.current = true;
        observer.disconnect();
        play(value);
      },
      { root: element.closest("[data-scroll-lock-allow]"), threshold: 0.2 },
    );
    observer.observe(element);

    return () => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref, value]);

  return displayed;
}
