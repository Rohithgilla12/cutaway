import { useEffect, useRef, useState, useCallback } from "react";
import { createWalSim } from "../sim/walSim";
import type { WalSnapshot, WalSim } from "../sim/walSim";
import { WalStrip } from "./WalStrip";
import { PageGrid } from "./PageGrid";
import { Controls } from "./Controls";

const SEED = 0xc0ffee42;

function useReducedMotion(): boolean {
  const [rm, setRm] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setRm(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return rm;
}

function phaseCaption(snap: WalSnapshot): string {
  const last = snap.recoveryLog[snap.recoveryLog.length - 1] ?? "";
  if (snap.phase === "crashed") {
    return `crash — records after LSN ${snap.lastDurableLsn} were never fsynced${last ? " · " + last : ""}`;
  }
  if (snap.phase === "recovering") {
    return last || "recovery in progress";
  }
  if (snap.phase === "recovered") {
    return last || "recovery complete";
  }
  return `LSN ${snap.lastLsn} · durable ${snap.lastDurableLsn} · commits ${snap.commitCount}`;
}

function initialSim(): WalSim {
  return createWalSim(SEED);
}

export default function WalViz() {
  const simRef = useRef<WalSim>(initialSim());
  const [snap, setSnap] = useState<WalSnapshot>(() => createWalSim(SEED).snapshot());
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(true);
  const hiddenRef = useRef(false);

  useEffect(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  const takeSnap = useCallback(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.01 },
    );
    if (rootRef.current) obs.observe(rootRef.current);
    const onVis = () => {
      hiddenRef.current = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      obs.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

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
      simRef.current.step(dt * speed);
      setSnap(simRef.current.snapshot());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, reducedMotion, speed]);

  const handleCommit = useCallback(() => {
    simRef.current.commit();
    takeSnap();
  }, [takeSnap]);

  const handleCrash = useCallback(() => {
    simRef.current.crash();
    setPaused(true);
    takeSnap();
  }, [takeSnap]);

  const handleRecoverStep = useCallback(() => {
    simRef.current.recoverStep();
    takeSnap();
  }, [takeSnap]);

  const handleRecoverAll = useCallback(() => {
    simRef.current.recoverAll();
    takeSnap();
  }, [takeSnap]);

  const handleCheckpoint = useCallback(() => {
    simRef.current.checkpoint();
    takeSnap();
  }, [takeSnap]);

  const handleToggleLoad = useCallback(() => {
    simRef.current.setLoad(!snap.loadOn);
    takeSnap();
  }, [snap.loadOn, takeSnap]);

  const handleToggleFsync = useCallback(() => {
    simRef.current.setFsyncOnCommit(!snap.fsyncOnCommit);
    takeSnap();
  }, [snap.fsyncOnCommit, takeSnap]);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  const handleStep = useCallback(() => {
    simRef.current.step(100);
    takeSnap();
  }, [takeSnap]);

  const handleReset = useCallback(() => {
    simRef.current.reset();
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s as 0.5 | 1 | 2);
  }, []);

  const caption = phaseCaption(snap);
  const recentLog = snap.recoveryLog.slice(-6);

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption}
      </div>

      <WalStrip
        records={snap.records}
        lastDurableLsn={snap.lastDurableLsn}
        checkpointLsn={snap.checkpointLsn}
        currentReplayLsn={snap.currentReplayLsn}
        phase={snap.phase}
      />

      <div style={{ marginTop: 8 }}>
        <PageGrid
          pages={snap.pages}
          phase={snap.phase}
          currentReplayLsn={snap.currentReplayLsn}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "6px 16px",
          marginTop: 12,
          padding: "8px 4px",
          borderTop: "1px solid var(--color-rule)",
          fontSize: 11,
        }}
      >
        <Stat label="lastLsn" value={snap.lastLsn} />
        <Stat label="lastDurableLsn" value={snap.lastDurableLsn} />
        <Stat label="fsyncCount" value={snap.fsyncCount} />
        <Stat label="commitCount" value={snap.commitCount} />
        <Stat label="acked" value={snap.acked} />
        <Stat label="survived" value={snap.survived} />
        <Stat label="lost" value={snap.lost} danger={snap.lost > 0} />
        <Stat label="phase" value={snap.phase} danger={snap.phase === "crashed"} />
      </div>

      {recentLog.length > 0 && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 8px",
            borderTop: "1px solid var(--color-rule)",
            fontSize: 10,
            color: "var(--color-muted)",
            lineHeight: 1.7,
          }}
        >
          {recentLog.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {snap.phase === "crashed" && (
        <div
          role="status"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            border: "1px solid var(--color-danger)",
            color: "var(--color-danger)",
            fontSize: 11,
            borderRadius: 3,
          }}
        >
          crash — records after LSN {snap.lastDurableLsn} were never fsynced
        </div>
      )}

      <Controls
        snap={snap}
        paused={paused}
        speed={speed}
        reducedMotion={reducedMotion}
        onCommit={handleCommit}
        onCrash={handleCrash}
        onRecoverStep={handleRecoverStep}
        onRecoverAll={handleRecoverAll}
        onCheckpoint={handleCheckpoint}
        onToggleLoad={handleToggleLoad}
        onToggleFsync={handleToggleFsync}
        onTogglePause={handleTogglePause}
        onStep={handleStep}
        onReset={handleReset}
        onSpeedChange={handleSpeedChange}
      />

      {reducedMotion && (
        <p
          style={{
            fontSize: 10,
            color: "var(--color-muted)",
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          Stepped mode active (prefers-reduced-motion). Use Step or action buttons to advance.
        </p>
      )}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  danger?: boolean;
}

function Stat({ label, value, danger }: StatProps) {
  return (
    <div>
      <span style={{ color: "var(--color-muted)", fontSize: 10 }}>{label} </span>
      <span
        style={{
          color: danger ? "var(--color-danger)" : "var(--color-ink)",
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        {value}
      </span>
    </div>
  );
}
