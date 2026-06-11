import { useRef, useState, useCallback, useEffect } from "react";
import { createReplaySim } from "../sim/replaySim";
import type { ReplaySim, ReplaySnapshot } from "../sim/replaySim";
import { HistoryTape } from "./HistoryTape";
import { WorkflowCode } from "./WorkflowCode";
import { ComparisonStrip } from "./ComparisonStrip";
import {
  useReducedMotion,
  useSimLoop,
  VizButton,
  VizToggle,
  PlayPauseOrStep,
  SpeedControl,
  Stat,
  EventLog,
  Legend,
} from "../../../../lib/viz";

const SEED = 0xdeadbee5;
const STEP_DT_MS = 300;

function makeSim(): ReplaySim {
  return createReplaySim(SEED);
}

function statusLabel(s: ReplaySnapshot["status"]): string {
  switch (s) {
    case "idle":
      return "idle";
    case "running":
      return "running";
    case "crashed":
      return "crashed";
    case "replaying":
      return "replaying";
    case "failed-nondeterminism":
      return "nondeterminism-error";
    case "completed":
      return "completed";
  }
}

function liveCaption(snap: ReplaySnapshot): string {
  if (snap.status === "failed-nondeterminism") {
    return snap.nondeterminismError ?? "nondeterminism detected";
  }
  const last = snap.eventLog[snap.eventLog.length - 1] ?? "";
  return last || `status: ${snap.status} · events: ${snap.events.length}`;
}

const LEGEND_ITEMS = [
  { color: "var(--color-muted)", glyph: "▪", label: "workflow-task event" },
  { color: "var(--color-entity)", glyph: "▪", label: "activity event" },
  { color: "var(--color-pending)", glyph: "▪", label: "timer event" },
  { color: "var(--color-ok)", glyph: "▪", label: "completion" },
  { color: "var(--color-ink)", glyph: "▸", label: "replay cursor" },
  { color: "var(--color-danger)", glyph: "✕", label: "mismatch" },
];

export default function ReplayViz() {
  const simRef = useRef<ReplaySim>(makeSim());
  const [snap, setSnap] = useState<ReplaySnapshot>(() => createReplaySim(SEED).snapshot());
  const [paused, setPaused] = useState(true);
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

  const handleRun = useCallback(() => {
    simRef.current.start();
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const handleCrash = useCallback(() => {
    simRef.current.crashWorker();
    setPaused(true);
    takeSnap();
  }, [takeSnap]);

  const handleReplayStep = useCallback(() => {
    simRef.current.replayStep();
    takeSnap();
  }, [takeSnap]);

  const handleReplayAll = useCallback(() => {
    simRef.current.replayAll();
    takeSnap();
  }, [takeSnap]);

  const handleToggleNondeterminism = useCallback(() => {
    simRef.current.setNondeterminism(!snap.nondeterminism);
    takeSnap();
  }, [snap.nondeterminism, takeSnap]);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  const handleStep = useCallback(() => {
    simRef.current.step(STEP_DT_MS);
    takeSnap();
  }, [takeSnap]);

  const handleReset = useCallback(() => {
    simRef.current.reset();
    setPaused(true);
    takeSnap();
  }, [takeSnap]);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s as 0.5 | 1 | 2);
  }, []);

  const { status, nondeterminism, nondeterminismError, events, code, comparison, activityExecCount, eventLog } = snap;

  const isIdle = status === "idle";
  const isRunning = status === "running";
  const isCrashed = status === "crashed";
  const isReplaying = status === "replaying";
  const isFailed = status === "failed-nondeterminism";
  const isCompleted = status === "completed";

  const canRun = isIdle;
  const canCrash = isRunning;
  const canReplay = isCrashed || isReplaying;
  const canReplayAll = isCrashed || isReplaying;

  const historyEdgeAnnotation =
    nondeterminism && isCompleted && snap.comparison.every((r) => r.outcome === "match" || r.outcome === "pending");

  const recentLog = eventLog.slice(-5);
  const caption = liveCaption(snap);

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
      <div aria-live="polite" className="sr-only">
        {caption}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        <span
          style={{ fontSize: 10, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}
        >
          Event History
        </span>
        <Legend items={LEGEND_ITEMS} />
      </div>

      <HistoryTape events={events} reducedMotion={reducedMotion} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              color: "var(--color-muted)",
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Workflow Code
          </div>
          <WorkflowCode code={code} status={status} />
        </div>

        <div>
          <div
            style={{
              fontSize: 10,
              color: "var(--color-muted)",
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Command Comparison
          </div>
          <ComparisonStrip comparison={comparison} status={status} nondeterminismError={nondeterminismError} />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "4px 16px",
          marginTop: 12,
          padding: "6px 4px",
          borderTop: "1px solid var(--color-rule)",
          fontSize: 11,
        }}
      >
        <Stat label="events" value={events.length} />
        <Stat label="activityExecCount" value={activityExecCount} />
        <Stat label="status" value={statusLabel(status)} danger={isFailed || isCrashed} />
      </div>

      {isFailed && nondeterminismError && (
        <div
          aria-hidden="true"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            border: "2px solid var(--color-danger)",
            borderRadius: 3,
            background: "rgba(239,68,68,0.06)",
            color: "var(--color-danger)",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {nondeterminismError}
        </div>
      )}

      {historyEdgeAnnotation && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            border: "1px solid var(--color-pending)",
            borderRadius: 3,
            background: "rgba(245,158,11,0.06)",
            color: "var(--color-ink)",
            fontSize: 11,
            lineHeight: 1.6,
          }}
        >
          <strong>replay completed</strong> — the divergence fell past the history edge: nothing was recorded yet to
          contradict it. Crash later (after the first activity completes) to see detection fire.
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <EventLog lines={recentLog} caption={caption} />
      </div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          paddingTop: 8,
          borderTop: "1px solid var(--color-rule)",
          alignItems: "flex-start",
        }}
      >
        <VizButton variant="primary" disabled={!canRun} onClick={handleRun} title="Start the workflow execution">
          Run
        </VizButton>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <VizButton
            variant="danger"
            disabled={!canCrash}
            onClick={handleCrash}
            title="Crash the worker (simulate process death)"
          >
            Crash worker
          </VizButton>
          {nondeterminism && isRunning && (
            <span
              style={{
                fontSize: 9,
                color: "var(--color-muted)",
                maxWidth: 160,
                lineHeight: 1.4,
              }}
            >
              for detectable divergence, crash after chargeCard completes
            </span>
          )}
        </div>

        <VizButton disabled={!canReplay} onClick={handleReplayStep} title="Advance replay by one command comparison">
          Replay step
        </VizButton>

        <VizButton disabled={!canReplayAll} onClick={handleReplayAll} title="Run replay to completion">
          Replay all
        </VizButton>

        <VizToggle
          pressed={nondeterminism}
          label={nondeterminism ? "time.Now() ON" : "Inject time.Now()"}
          onClick={handleToggleNondeterminism}
          title="Toggle nondeterminism injection (models naked time.Now() call in workflow code)"
        />

        <div
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
            marginLeft: "auto",
            flexWrap: "wrap",
          }}
        >
          <PlayPauseOrStep
            paused={paused}
            reducedMotion={reducedMotion}
            onTogglePause={handleTogglePause}
            onStep={handleStep}
          />
          <SpeedControl speed={speed} onSpeedChange={handleSpeedChange} />
          <VizButton onClick={handleReset} title="Reset to initial state">
            Reset
          </VizButton>
        </div>
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
          Stepped mode active (prefers-reduced-motion). Use Step or action buttons to advance.
        </p>
      )}
    </div>
  );
}
