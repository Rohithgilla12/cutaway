import { useEffect, useRef, useState, useCallback } from "react";
import { createWalSim } from "../sim/walSim";
import type { WalSnapshot, WalSim } from "../sim/walSim";
import { WalStrip } from "./WalStrip";
import { PageGrid } from "./PageGrid";
import { Controls } from "./Controls";
import { useReducedMotion, useSimLoop, Stat, EventLog } from "../../../../lib/viz";

const SEED = 0xc0ffee42;

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
  // m4: reading simRef.current in useState lazy initializer triggers react-hooks/refs;
  // keeping two-instance pattern (second sim is created only for its initial snapshot).
  const [snap, setSnap] = useState<WalSnapshot>(() => createWalSim(SEED).snapshot());
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  const takeSnap = useCallback(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  const stepSim = useCallback((dtMs: number) => {
    simRef.current.step(dtMs);
  }, []);

  useSimLoop({
    step: stepSim,
    onFrame: takeSnap,
    speed,
    paused,
    reducedMotion,
    rootRef,
  });

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
        <PageGrid pages={snap.pages} phase={snap.phase} currentReplayLsn={snap.currentReplayLsn} />
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

      <div style={{ marginTop: 8 }}>
        <EventLog lines={recentLog} caption={caption} />
      </div>

      {snap.phase === "crashed" && (
        <div
          aria-hidden="true"
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
