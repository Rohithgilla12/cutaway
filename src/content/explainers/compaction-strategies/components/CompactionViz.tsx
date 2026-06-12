import { useCallback, useEffect, useRef, useState } from "react";
import { createCompactionSim, STOP_TRIGGER_RUNS } from "../sim/compactionSim";
import type { CompactionSim, CompactionSnapshot, Strategy } from "../sim/compactionSim";
import { RunDiagram } from "./RunDiagram";
import { CompactionControls } from "./CompactionControls";
import { useReducedMotion, useSimLoop, Legend, Stat, EventLog } from "../../../../lib/viz";

const SEED = 0xc0_4ac7;

const LEGEND_ITEMS = [
  { color: "var(--color-ok)", glyph: "▬", label: "memtable" },
  { color: "var(--color-entity)", glyph: "▬", label: "sorted run (width = entries)" },
  { color: "var(--color-pending)", glyph: "▬", label: "compaction input / output in progress" },
  { color: "var(--color-danger)", glyph: "▣", label: "write stall" },
];

function initialSim(): CompactionSim {
  return createCompactionSim(SEED);
}

function simCaption(snap: CompactionSnapshot): string {
  if (snap.stalled) {
    return `WRITE STALL — L0 at ${snap.l0RunCount} runs (stop trigger ${STOP_TRIGGER_RUNS}); ${snap.stalledWrites} writes refused so far`;
  }
  if (snap.job) {
    return `${snap.strategy}: compacting ${snap.job.inputRunIds.length} runs into L${snap.job.targetLevel} (${Math.floor(snap.job.writtenSoFar)}/${snap.job.outputSize}); WA ${snap.writeAmplification.toFixed(1)}, SA ${snap.spaceAmplification.toFixed(1)}`;
  }
  return `${snap.strategy}: ${snap.runCount} runs, WA ${snap.writeAmplification.toFixed(1)}, RA avg ${snap.readAmplificationAvg.toFixed(1)}, SA ${snap.spaceAmplification.toFixed(1)}`;
}

export default function CompactionViz() {
  const simRef = useRef<CompactionSim>(initialSim());
  // Reading simRef.current in a useState lazy initializer trips react-hooks/refs;
  // same two-instance pattern as the other explainers (the second sim only
  // supplies the initial snapshot and is deterministically identical).
  const [snap, setSnap] = useState<CompactionSnapshot>(() => createCompactionSim(SEED).snapshot());
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

  const handleStrategy = useCallback(
    (s: Strategy) => {
      simRef.current.setStrategy(s);
      takeSnap();
    },
    [takeSnap],
  );

  const handleIngestRate = useCallback(
    (n: number) => {
      simRef.current.setIngestRate(n);
      takeSnap();
    },
    [takeSnap],
  );

  const handleRead = useCallback(() => {
    simRef.current.read();
    takeSnap();
  }, [takeSnap]);

  const handleFullCompaction = useCallback(() => {
    simRef.current.fullCompaction();
    takeSnap();
  }, [takeSnap]);

  const handleToggleAutoRead = useCallback(() => {
    simRef.current.setAutoRead(!snap.autoRead);
    takeSnap();
  }, [snap.autoRead, takeSnap]);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  const handleStep = useCallback(() => {
    simRef.current.step(250);
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

  const caption = simCaption(snap);
  const recentLog = snap.eventLog.slice(-6);
  const lastRead = snap.lastReadPath;

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption}
      </div>

      <div
        style={{
          display: "flex",
          gap: "0 16px",
          fontSize: 10,
          color: "var(--color-muted)",
          letterSpacing: "0.05em",
          marginBottom: 4,
          flexWrap: "wrap",
          alignItems: "baseline",
        }}
      >
        <span>{snap.strategy.toUpperCase()} COMPACTION</span>
        {snap.stalled && (
          <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>
            write stall — L0 at stop trigger ({STOP_TRIGGER_RUNS} runs)
          </span>
        )}
      </div>

      <RunDiagram snap={snap} />

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
          gap: "6px 16px",
          marginTop: 10,
          padding: "8px 4px",
          borderTop: "1px solid var(--color-rule)",
          fontSize: 11,
        }}
      >
        <Stat label="writeAmp" value={snap.writeAmplification.toFixed(1)} danger={snap.writeAmplification >= 6} />
        <Stat
          label="readAmp last/avg"
          value={`${snap.readAmplificationLast || "—"} / ${snap.readAmplificationAvg ? snap.readAmplificationAvg.toFixed(1) : "—"}`}
          danger={snap.readAmplificationAvg >= 6}
        />
        <Stat label="spaceAmp" value={`${snap.spaceAmplification.toFixed(1)}×`} danger={snap.spaceAmplification >= 3} />
        <Stat label="sorted runs" value={snap.runCount} danger={snap.runCount >= 10} />
        <Stat label="stalled writes" value={snap.stalledWrites} danger={snap.stalledWrites > 0} />
        <Stat label="on disk / live" value={`${Math.floor(snap.onDiskEntries)} / ${snap.uniqueLiveOnDisk}`} />
      </div>

      {lastRead && (
        <div style={{ fontSize: 10, color: "var(--color-muted)", padding: "2px 4px" }}>
          read {lastRead.key}: {lastRead.probes.length} probes →{" "}
          {lastRead.found ? `value ${lastRead.value}` : "not found"} (
          {lastRead.probes
            .map((p) => (p.structure === "memtable" ? "mem" : `L${p.level}`) + (p.hit ? "✓" : "✕"))
            .join(" ")}
          )
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <Legend items={LEGEND_ITEMS} />
      </div>

      <div style={{ marginTop: 8 }}>
        {/* caption="" keeps EventLog's internal aria-live region silent — the
            island's single live region above announces all state changes */}
        <EventLog lines={recentLog} caption="" />
      </div>

      <CompactionControls
        snap={snap}
        paused={paused}
        speed={speed}
        reducedMotion={reducedMotion}
        onStrategy={handleStrategy}
        onIngestRate={handleIngestRate}
        onRead={handleRead}
        onFullCompaction={handleFullCompaction}
        onToggleAutoRead={handleToggleAutoRead}
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
