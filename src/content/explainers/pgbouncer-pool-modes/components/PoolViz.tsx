import { useCallback, useEffect, useRef, useState } from "react";
import { createPoolSim, MAX_CLIENTS, MAX_POOL_SIZE, MIN_CLIENTS, MIN_POOL_SIZE } from "../sim/poolSim";
import type { PoolMode, PoolSim, PoolSnapshot } from "../sim/poolSim";
import { LaneDiagram } from "./LaneDiagram";
import {
  BTN_BASE,
  EventLog,
  Legend,
  PlayPauseOrStep,
  SpeedControl,
  Stat,
  VizButton,
  VizToggle,
  useReducedMotion,
  useSimLoop,
} from "../../../../lib/viz";

const SEED = 0xc0ffee;

function makeSim(): PoolSim {
  return createPoolSim(SEED);
}

const LEGEND_ITEMS = [
  { color: "var(--color-dead)", glyph: "▪", label: "client idle" },
  { color: "var(--color-pending)", glyph: "▪", label: "client waiting" },
  { color: "var(--color-entity)", glyph: "▪", label: "client in-txn" },
  { color: "var(--color-danger)", glyph: "▪", label: "client error" },
  { color: "var(--color-dead)", glyph: "▬", label: "server idle" },
  { color: "var(--color-entity)", glyph: "▬", label: "server active" },
  { color: "var(--color-pending)", glyph: "▬", label: "server reset" },
  { color: "var(--color-entity)", glyph: "●", label: "query pulse" },
];

const MODE_LABELS: Record<PoolMode, string> = {
  session: "session",
  transaction: "transaction",
  statement: "statement",
};

function stepperStyle(disabled: boolean): React.CSSProperties {
  return {
    minWidth: 44,
    minHeight: 44,
    padding: "6px 12px",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    cursor: disabled ? "default" : "pointer",
    border: "1px solid var(--color-rule)",
    borderRadius: 3,
    background: "var(--color-raised)",
    color: disabled ? "var(--color-muted)" : "var(--color-ink)",
    opacity: disabled ? 0.45 : 1,
  };
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onDecrement: () => void;
  onIncrement: () => void;
}

function Stepper({ label, value, min, max, onDecrement, onIncrement }: StepperProps) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        border: "1px solid var(--color-rule)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <button
        style={stepperStyle(value <= min)}
        onClick={onDecrement}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <span
        style={{
          minWidth: 72,
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          padding: "6px 4px",
          borderLeft: "1px solid var(--color-rule)",
          borderRight: "1px solid var(--color-rule)",
          color: "var(--color-ink)",
          userSelect: "none",
        }}
      >
        {label} = {value}
      </span>
      <button
        style={stepperStyle(value >= max)}
        onClick={onIncrement}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}

export default function PoolViz() {
  const simRef = useRef<PoolSim>(makeSim());
  // Two-instance pattern: simRef drives the live simulation; the initial snapshot
  // for useState is taken from a separate instance with the same seed so the hook
  // call is synchronous without a ref read during render.
  const [snap, setSnap] = useState<PoolSnapshot>(() => createPoolSim(SEED).snapshot());
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [announcement, setAnnouncement] = useState("");
  const prevErrPreparedRef = useRef(0);
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  const takeSnap = useCallback(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  const stepSim = useCallback((dtMs: number) => {
    simRef.current.step(dtMs);
  }, []);

  useSimLoop({ step: stepSim, onFrame: takeSnap, speed, paused, reducedMotion, rootRef });

  useEffect(() => {
    const cur = snap.counters.errors.prepared_missing;
    if (cur > 0 && prevErrPreparedRef.current === 0) {
      setAnnouncement("first prepared-statement error — see event log");
    }
    prevErrPreparedRef.current = cur;
  }, [snap.counters.errors.prepared_missing]);

  const handleMode = useCallback(
    (m: PoolMode) => {
      setAnnouncement(`pool mode: ${m}`);
      simRef.current.setMode(m);
      takeSnap();
    },
    [takeSnap],
  );

  const handleClients = useCallback(
    (delta: number) => {
      simRef.current.setClients(simRef.current.snapshot().clientCount + delta);
      takeSnap();
    },
    [takeSnap],
  );

  const handlePoolSize = useCallback(
    (delta: number) => {
      simRef.current.setPoolSize(simRef.current.snapshot().poolSize + delta);
      takeSnap();
    },
    [takeSnap],
  );

  const handleLoad = useCallback(() => {
    const nextLoad = simRef.current.snapshot().load === "low" ? "high" : "low";
    setAnnouncement(`load: ${nextLoad}`);
    simRef.current.setLoad(nextLoad);
    takeSnap();
  }, [takeSnap]);

  const handlePrepared = useCallback(() => {
    const nextOn = !simRef.current.snapshot().preparedOn;
    setAnnouncement(`prepared statements: ${nextOn ? "on" : "off"}`);
    simRef.current.togglePrepared(nextOn);
    takeSnap();
  }, [takeSnap]);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => {
      setAnnouncement(p ? "playing" : "paused");
      return !p;
    });
  }, []);

  const handleStep = useCallback(() => {
    simRef.current.step(100);
    takeSnap();
  }, [takeSnap]);

  const handleReset = useCallback(() => {
    setAnnouncement("simulation reset");
    simRef.current.reset();
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const handleSpeed = useCallback((s: number) => {
    setSpeed(s as 0.5 | 1 | 2);
  }, []);

  const { counters, servers, waitQueue, eventLog } = snap;
  const recentLog = eventLog.slice(-10);

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Mode indicator strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          padding: "5px 8px",
          border: "1px solid var(--color-rule)",
          borderRadius: 3,
          background: "var(--color-raised)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--color-muted)", fontSize: 10 }}>MODE</span>
        <div role="radiogroup" aria-label="Pool mode" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(["session", "transaction", "statement"] as PoolMode[]).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={snap.mode === m}
              onClick={() => handleMode(m)}
              style={{
                ...BTN_BASE,
                background: snap.mode === m ? "var(--color-ink)" : "var(--color-raised)",
                color: snap.mode === m ? "var(--color-raised)" : "var(--color-ink)",
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Lane diagram */}
      <LaneDiagram snap={snap} />

      {/* Per-server prepared chips — HTML, below SVG */}
      <p style={{ fontSize: 9, color: "var(--color-muted)", margin: "6px 0 2px", fontFamily: "var(--font-mono)" }}>
        prepared statements resident per server:
      </p>
      <div
        style={{
          marginTop: 4,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          minHeight: 24,
        }}
      >
        {servers.map((s) => (
          <div
            key={s.id}
            style={{
              fontSize: 10,
              color: "var(--color-muted)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>S{s.id}</span>
            {s.preparedSet.length === 0 ? (
              <span style={{ opacity: 0.5 }}>—</span>
            ) : (
              s.preparedSet.map((p) => (
                <span
                  key={p}
                  style={{
                    padding: "1px 5px",
                    border: "1px solid var(--color-entity)",
                    borderRadius: 2,
                    color: "var(--color-entity)",
                    fontWeight: 500,
                  }}
                >
                  {p}
                </span>
              ))
            )}
          </div>
        ))}
      </div>

      {/* Wait queue depth */}
      {waitQueue.length > 0 && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            color: "var(--color-pending)",
            padding: "3px 6px",
            border: "1px solid var(--color-pending)",
            borderRadius: 3,
            display: "inline-block",
          }}
        >
          wait queue: {waitQueue.length} client{waitQueue.length !== 1 ? "s" : ""} (FIFO — c{waitQueue.join(" · c")})
        </div>
      )}

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
          gap: "4px 16px",
          marginTop: 8,
          padding: "6px 4px",
          borderTop: "1px solid var(--color-rule)",
        }}
      >
        <Stat label="xacts" value={counters.xactsCompleted} />
        <Stat label="queries" value={counters.queriesRun} />
        <Stat
          label="prepared_missing"
          value={counters.errors.prepared_missing}
          danger={counters.errors.prepared_missing > 0}
        />
        <Stat label="timeouts" value={counters.timeouts} danger={counters.timeouts > 0} />
        <Stat label="avg wait" value={`${counters.avgWaitMs}ms`} />
      </div>

      <div style={{ marginTop: 6 }}>
        <Legend items={LEGEND_ITEMS} />
      </div>

      {/* Controls row 1: steppers + toggles */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 10,
          alignItems: "center",
        }}
      >
        <Stepper
          label="clients"
          value={snap.clientCount}
          min={MIN_CLIENTS}
          max={MAX_CLIENTS}
          onDecrement={() => handleClients(-1)}
          onIncrement={() => handleClients(1)}
        />
        <Stepper
          label="pool_size"
          value={snap.poolSize}
          min={MIN_POOL_SIZE}
          max={MAX_POOL_SIZE}
          onDecrement={() => handlePoolSize(-1)}
          onIncrement={() => handlePoolSize(1)}
        />
        <VizToggle
          pressed={snap.load === "high"}
          label={snap.load === "high" ? "load: HIGH" : "load: low"}
          onClick={handleLoad}
        />
        <VizToggle
          pressed={snap.preparedOn}
          label={snap.preparedOn ? "PREPARE: on" : "PREPARE: off"}
          onClick={handlePrepared}
        />
      </div>

      {/* Controls row 2: playback */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 8,
          alignItems: "center",
        }}
      >
        <PlayPauseOrStep
          paused={paused}
          reducedMotion={reducedMotion}
          onTogglePause={handleTogglePause}
          onStep={handleStep}
        />
        <VizButton onClick={handleReset}>Reset</VizButton>
        <SpeedControl speed={speed} onSpeedChange={handleSpeed} />
      </div>

      {reducedMotion && (
        <p
          style={{
            fontSize: 10,
            color: "var(--color-muted)",
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          Stepped mode active (prefers-reduced-motion). Use Step to advance.
        </p>
      )}

      <div style={{ marginTop: 6 }}>
        <EventLog lines={recentLog} />
      </div>
    </div>
  );
}
