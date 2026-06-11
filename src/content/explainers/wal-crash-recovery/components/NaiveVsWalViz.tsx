import { useRef, useState, useCallback } from "react";
import { createNaiveVsWalSim } from "../sim/naiveVsWalSim";
import type { NaiveVsWalSim, NaiveVsWalSnapshot, CommitRate, LaneSnapshot } from "../sim/naiveVsWalSim";
import {
  useReducedMotion,
  useSimLoop,
  PlayPauseOrStep,
  SpeedControl,
  VizButton,
  Stat,
  Legend,
  BTN_BASE,
} from "../../../../lib/viz";

const SEED = 0xf00dcafe;
const RATES: CommitRate[] = [10, 50, 200];
const MAX_QUEUE_DISPLAY = 50;
const MAX_RATE_DISPLAY = 220;

function initialSim(): NaiveVsWalSim {
  return createNaiveVsWalSim(SEED);
}

interface LaneProps {
  label: string;
  sublabel: string;
  lane: LaneSnapshot;
  colorVar: string;
  isNaive: boolean;
}

function QueueBar({ depth, colorVar }: { depth: number; colorVar: string }) {
  const pct = Math.min(depth / MAX_QUEUE_DISPLAY, 1);
  const overflow = depth >= MAX_QUEUE_DISPLAY;
  return (
    <div
      style={{
        position: "relative",
        height: 20,
        background: "var(--color-raised)",
        border: "1px solid var(--color-rule)",
        borderRadius: 3,
        overflow: "hidden",
        flexGrow: 1,
        minWidth: 0,
      }}
      aria-label={`queue depth: ${depth}`}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct * 100}%`,
          background: overflow ? "var(--color-danger)" : colorVar,
          transition: "width 80ms linear",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 6,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 10,
          color: pct > 0.5 ? "var(--color-paper)" : "var(--color-ink)",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
        }}
      >
        {depth}
      </span>
    </div>
  );
}

function RateBar({ value, colorVar }: { value: number; colorVar: string }) {
  const pct = Math.min(value / MAX_RATE_DISPLAY, 1);
  return (
    <div
      style={{
        position: "relative",
        height: 20,
        background: "var(--color-raised)",
        border: "1px solid var(--color-rule)",
        borderRadius: 3,
        overflow: "hidden",
        flexGrow: 1,
        minWidth: 0,
      }}
      aria-label={`commits per second: ${value}`}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct * 100}%`,
          background: colorVar,
          opacity: 0.7,
          transition: "width 80ms linear",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 6,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 10,
          color: pct > 0.5 ? "var(--color-paper)" : "var(--color-ink)",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
        }}
      >
        {value}/s
      </span>
    </div>
  );
}

function Lane({ label, sublabel, lane, colorVar, isNaive }: LaneProps) {
  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px 12px",
        border: "1px solid var(--color-rule)",
        borderRadius: 3,
        background: "var(--color-paper)",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4, flexWrap: "wrap" }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: colorVar }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-muted)" }}>{sublabel}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-muted)",
            whiteSpace: "nowrap",
            flexShrink: 0,
            width: 30,
          }}
        >
          queue
        </span>
        <QueueBar depth={lane.queueDepth} colorVar={colorVar} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-muted)",
            whiteSpace: "nowrap",
            flexShrink: 0,
            width: 30,
          }}
        >
          rate
        </span>
        <RateBar value={lane.commitsPerSecRolling} colorVar={colorVar} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 10px",
          marginTop: 2,
          paddingTop: 6,
          borderTop: "1px solid var(--color-rule)",
        }}
      >
        <Stat label="done" value={lane.completed} />
        <Stat
          label={isNaive ? "fsyncs" : "fsyncs"}
          value={lane.fsyncsIssued}
          danger={isNaive && lane.queueDepth > 30}
        />
      </div>
    </div>
  );
}

export default function NaiveVsWalViz() {
  const simRef = useRef<NaiveVsWalSim>(initialSim());
  const [snap, setSnap] = useState<NaiveVsWalSnapshot>(() => createNaiveVsWalSim(SEED).snapshot());
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

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

  const handleReset = useCallback(() => {
    simRef.current.reset();
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  const handleStep = useCallback(() => {
    simRef.current.step(100);
    takeSnap();
  }, [takeSnap]);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s as 0.5 | 1 | 2);
  }, []);

  const handleRateChange = useCallback(
    (r: CommitRate) => {
      simRef.current.setRate(r);
      takeSnap();
    },
    [takeSnap],
  );

  const liveCaption = `commit rate ${snap.rate}/s — naive queue ${snap.naive.queueDepth}, WAL queue ${snap.wal.queueDepth}`;

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {liveCaption}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Lane
          label="Naive"
          sublabel="N random fsyncs/commit"
          lane={snap.naive}
          colorVar="var(--color-danger)"
          isNaive={true}
        />
        <Lane
          label="WAL"
          sublabel="1 batched fsync/window"
          lane={snap.wal}
          colorVar="var(--color-ok)"
          isNaive={false}
        />
      </div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "6px 12px",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--color-muted)" }}>rate:</span>
        <div role="radiogroup" aria-label="commit rate" style={{ display: "flex", gap: 4 }}>
          {RATES.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={snap.rate === r}
              style={{
                ...BTN_BASE,
                padding: "4px 10px",
                fontSize: 11,
                minHeight: 44,
                background: snap.rate === r ? "var(--color-ink)" : "var(--color-raised)",
                color: snap.rate === r ? "var(--color-raised)" : "var(--color-muted)",
                border: snap.rate === r ? "1px solid var(--color-ink)" : "1px solid var(--color-rule)",
              }}
              onClick={() => handleRateChange(r)}
            >
              {r}/s
            </button>
          ))}
        </div>

        <div
          style={{
            width: 1,
            height: 28,
            background: "var(--color-rule)",
            margin: "0 2px",
            flexShrink: 0,
          }}
        />

        <PlayPauseOrStep
          paused={paused}
          reducedMotion={reducedMotion}
          onTogglePause={handleTogglePause}
          onStep={handleStep}
        />

        <VizButton onClick={handleReset} title="Reset to initial state">
          Reset
        </VizButton>

        <SpeedControl speed={speed} onSpeedChange={handleSpeedChange} />
      </div>

      <div style={{ marginTop: 8 }}>
        <Legend
          items={[
            { color: "var(--color-danger)", glyph: "▬", label: "naive — queue / rate bar" },
            { color: "var(--color-ok)", glyph: "▬", label: "WAL — queue / rate bar" },
            { color: "var(--color-danger)", glyph: "■", label: "naive queue overflow (≥50 queued)" },
          ]}
        />
      </div>

      {reducedMotion && (
        <p style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 4, fontStyle: "italic" }}>
          Stepped mode active (prefers-reduced-motion). Use Step to advance.
        </p>
      )}
    </div>
  );
}
