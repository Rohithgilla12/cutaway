import { useCallback, useEffect, useRef, useState } from "react";
import { createCompactionSim, INGEST_MIN, INGEST_MAX } from "../sim/compactionSim";
import type { CompactionSim, CompactionSnapshot } from "../sim/compactionSim";
import { useReducedMotion, useSimLoop, Stat, VizButton, SpeedControl, PlayPauseOrStep } from "../../../../lib/viz";

const SEED = 0x9ace_d1ce;
const DEFAULT_RATE = 10;

interface Pair {
  leveled: CompactionSnapshot;
  tiered: CompactionSnapshot;
}

function makeSims(): { leveled: CompactionSim; tiered: CompactionSim } {
  return {
    leveled: createCompactionSim(SEED, { strategy: "leveled", ingestRate: DEFAULT_RATE }),
    tiered: createCompactionSim(SEED, { strategy: "tiered", ingestRate: DEFAULT_RATE }),
  };
}

function snapPair(sims: { leveled: CompactionSim; tiered: CompactionSim }): Pair {
  return { leveled: sims.leveled.snapshot(), tiered: sims.tiered.snapshot() };
}

function EngineColumn({ snap }: { snap: CompactionSnapshot }) {
  return (
    <div style={{ flex: "1 1 240px", minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.05em",
          color: "var(--color-muted)",
          marginBottom: 4,
          display: "flex",
          gap: 8,
          alignItems: "baseline",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--color-ink)", fontWeight: 600 }}>{snap.strategy.toUpperCase()}</span>
        {snap.stalled && <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>STALLED</span>}
        {snap.job && <span style={{ color: "var(--color-pending)" }}>compacting…</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 11 }}>
        <Stat label="writeAmp" value={snap.writeAmplification.toFixed(2)} danger={snap.writeAmplification >= 6} />
        <Stat
          label="readAmp avg"
          value={snap.readAmplificationAvg ? snap.readAmplificationAvg.toFixed(1) : "—"}
          danger={snap.readAmplificationAvg >= 6}
        />
        <Stat label="spaceAmp" value={`${snap.spaceAmplification.toFixed(2)}×`} danger={snap.spaceAmplification >= 3} />
        <Stat label="sorted runs" value={snap.runCount} danger={snap.runCount >= 10} />
        <Stat label="stalled writes" value={snap.stalledWrites} danger={snap.stalledWrites > 0} />
        <Stat label="runs by level" value={snap.levels.map((l) => l.length).join("·")} />
      </div>
    </div>
  );
}

export default function RaceViz() {
  const simsRef = useRef(makeSims());
  // Same two-instance pattern as the other explainers: the throwaway pair only
  // supplies the initial snapshots deterministically.
  const [pair, setPair] = useState<Pair>(() => snapPair(makeSims()));
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPair(snapPair(simsRef.current));
  }, []);

  const takeSnap = useCallback(() => {
    setPair(snapPair(simsRef.current));
  }, []);

  const stepSims = useCallback((dtMs: number) => {
    simsRef.current.leveled.step(dtMs);
    simsRef.current.tiered.step(dtMs);
  }, []);

  useSimLoop({
    step: stepSims,
    onFrame: takeSnap,
    speed,
    paused,
    reducedMotion,
    rootRef,
  });

  const handleRate = useCallback(
    (n: number) => {
      setRate(n);
      simsRef.current.leveled.setIngestRate(n);
      simsRef.current.tiered.setIngestRate(n);
      takeSnap();
    },
    [takeSnap],
  );

  const handleTogglePause = useCallback(() => setPaused((p) => !p), []);

  const handleStep = useCallback(() => {
    stepSims(250);
    takeSnap();
  }, [stepSims, takeSnap]);

  const handleReset = useCallback(() => {
    simsRef.current = makeSims();
    setRate(DEFAULT_RATE);
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const caption =
    `same workload at ${rate}/s — leveled: WA ${pair.leveled.writeAmplification.toFixed(1)}, ` +
    `SA ${pair.leveled.spaceAmplification.toFixed(1)}, ${pair.leveled.stalledWrites} stalled; ` +
    `tiered: WA ${pair.tiered.writeAmplification.toFixed(1)}, SA ${pair.tiered.spaceAmplification.toFixed(1)}, ` +
    `${pair.tiered.stalledWrites} stalled`;

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <EngineColumn snap={pair.leveled} />
        <EngineColumn snap={pair.tiered} />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "10px 4px 4px",
          alignItems: "center",
          borderTop: "1px solid var(--color-rule)",
          marginTop: 10,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, minWidth: 0 }}>
          <span style={{ color: "var(--color-muted)", whiteSpace: "nowrap" }}>shared ingest</span>
          <input
            type="range"
            min={INGEST_MIN}
            max={INGEST_MAX}
            value={rate}
            onChange={(e) => handleRate(Number(e.target.value))}
            style={{ width: 120, height: 28 }}
            aria-label="Shared ingest rate, entries per second"
          />
          <span style={{ fontWeight: 600, whiteSpace: "nowrap", width: 38 }}>{rate}/s</span>
        </label>

        <PlayPauseOrStep
          paused={paused}
          reducedMotion={reducedMotion}
          onTogglePause={handleTogglePause}
          onStep={handleStep}
        />

        <VizButton onClick={handleReset} title="Reset both engines to the same seeded start">
          Reset
        </VizButton>

        <SpeedControl speed={speed} onSpeedChange={(s) => setSpeed(s as 0.5 | 1 | 2)} />
      </div>

      {reducedMotion && (
        <p style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 4, fontStyle: "italic" }}>
          Stepped mode active (prefers-reduced-motion). Use Step to advance both engines together.
        </p>
      )}
    </div>
  );
}
