import { useEffect, useRef } from "react";

interface SimLoopOpts {
  step: (dtMs: number) => void;
  onFrame: () => void;
  speed: number;
  paused: boolean;
  reducedMotion: boolean;
  rootRef: React.RefObject<HTMLElement | null>;
}

export function useSimLoop({ step, onFrame, speed, paused, reducedMotion, rootRef }: SimLoopOpts): void {
  const visibleRef = useRef(true);
  const hiddenRef = useRef(typeof document !== "undefined" ? document.hidden : false);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.01 },
    );
    const el = rootRef.current;
    if (el) obs.observe(el);
    const onVis = () => {
      hiddenRef.current = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      obs.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [rootRef]);

  useEffect(() => {
    if (reducedMotion || paused) return;
    let raf: number;
    let last = performance.now();
    const tick = (now: number) => {
      if (!visibleRef.current || hiddenRef.current) {
        last = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(now - last, 100);
      last = now;
      step(dt * speed);
      onFrame();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, reducedMotion, speed, step, onFrame]);
}
