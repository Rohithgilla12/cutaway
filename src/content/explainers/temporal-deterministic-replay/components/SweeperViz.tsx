import { useRef, useState, useCallback, useEffect } from "react";
import { createSweeperSim } from "../sim/sweeperSim";
import type { SweeperSim, SweeperSnapshot } from "../sim/sweeperSim";
import {
  useReducedMotion,
  useSimLoop,
  VizButton,
  PlayPauseOrStep,
  SpeedControl,
  Stat,
  EventLog,
} from "../../../../lib/viz";

const SEED = 0xc0ffee42;
const STEP_DT_MS = 100;

function makeSnap(): SweeperSnapshot {
  return createSweeperSim(SEED).snapshot();
}

function orderColor(status: SweeperSnapshot["orderStatus"]): string {
  switch (status) {
    case "pending":
      return "var(--color-pending)";
    case "charged":
      return "var(--color-entity)";
    case "done":
      return "var(--color-ok)";
  }
}

function orderLabel(status: SweeperSnapshot["orderStatus"]): string {
  switch (status) {
    case "pending":
      return "ORDER: PENDING";
    case "charged":
      return "ORDER: CHARGED";
    case "done":
      return "ORDER: DONE";
  }
}

export default function SweeperViz() {
  const simRef = useRef<SweeperSim>(createSweeperSim(SEED));
  const [snap, setSnap] = useState<SweeperSnapshot>(makeSnap);
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

  const isTerminal = snap.orderStatus === "done";
  const effectivePaused = paused || isTerminal;

  useSimLoop({
    step: stepSim,
    onFrame: takeSnap,
    speed,
    paused: effectivePaused,
    reducedMotion,
    rootRef,
  });

  const handleStart = useCallback(() => {
    simRef.current.start();
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const handleCrash = useCallback(() => {
    simRef.current.crashWorker();
    takeSnap();
  }, [takeSnap]);

  const handleRestart = useCallback(() => {
    simRef.current.restartWorker();
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

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

  const {
    orderStatus,
    chargeCount,
    emailCount,
    workerPhase,
    workerAlive,
    sweeperCountdownMs,
    sweeperIntervalMs,
    eventLog,
  } = snap;

  const isStarted = workerAlive || workerPhase !== "idle" || orderStatus !== "pending" || chargeCount > 0;
  const canStart = !workerAlive && !isStarted;
  const canCrash = workerAlive && orderStatus !== "done";
  const canRestart = !workerAlive && orderStatus !== "done" && isStarted;

  const inGap = workerAlive && workerPhase === "gap";
  const countdownPct = (sweeperCountdownMs / sweeperIntervalMs) * 100;
  const countdownDanger = sweeperCountdownMs < 400;

  const recentLog = eventLog.slice(-5);
  const liveCaption = recentLog[recentLog.length - 1] ?? "idle";

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
      <div aria-live="polite" className="sr-only">
        {liveCaption}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <div
          style={{
            padding: "4px 10px",
            borderRadius: 3,
            border: `1px solid ${orderColor(orderStatus)}`,
            color: orderColor(orderStatus),
            fontWeight: 600,
            letterSpacing: "0.06em",
            fontSize: 11,
          }}
        >
          {orderLabel(orderStatus)}
        </div>

        <div style={{ flex: 1, minWidth: 120 }}>
          {workerAlive ? (
            <div
              style={{
                padding: "4px 8px",
                borderRadius: 3,
                border: inGap ? "1px solid var(--color-pending)" : "1px solid var(--color-rule)",
                background: inGap ? "color-mix(in srgb, var(--color-pending) 10%, transparent)" : "transparent",
                color: inGap ? "var(--color-pending)" : "var(--color-ink)",
                fontSize: 11,
              }}
            >
              {workerPhase === "charging" && "WORKER: charging…"}
              {workerPhase === "gap" && "WORKER: gap — side effect done, status not written ⚠"}
              {workerPhase === "emailing" && "WORKER: emailing…"}
              {workerPhase === "email-gap" && "WORKER: email-gap — writing status…"}
              {workerPhase === "done" && "WORKER: done"}
              {workerPhase === "idle" && "WORKER: idle"}
            </div>
          ) : isStarted ? (
            <div
              style={{
                padding: "4px 8px",
                borderRadius: 3,
                border: "1px solid var(--color-danger)",
                color: "var(--color-danger)",
                fontSize: 11,
              }}
            >
              WORKER: dead
            </div>
          ) : (
            <div style={{ padding: "4px 8px", color: "var(--color-muted)", fontSize: 11 }}>WORKER: not started</div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 3,
            fontSize: 10,
            color: countdownDanger ? "var(--color-pending)" : "var(--color-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          <span>SWEEPER</span>
          <span>{Math.ceil(sweeperCountdownMs)}ms</span>
        </div>
        <div
          style={{
            width: "100%",
            height: 6,
            background: "var(--color-rule)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${countdownPct}%`,
              height: "100%",
              background: countdownDanger ? "var(--color-pending)" : "var(--color-entity)",
              transition: reducedMotion ? "none" : "width 0.1s linear",
              borderRadius: 3,
            }}
          />
        </div>
      </div>

      {inGap && (
        <div
          style={{
            marginBottom: 10,
            padding: "4px 8px",
            border: "1px solid var(--color-pending)",
            borderRadius: 3,
            background: "color-mix(in srgb, var(--color-pending) 10%, transparent)",
            color: "var(--color-pending)",
            fontSize: 11,
          }}
        >
          gap — side effect done, status not yet written
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: "4px 16px",
          paddingTop: 6,
          paddingBottom: 6,
          borderTop: "1px solid var(--color-rule)",
          borderBottom: "1px solid var(--color-rule)",
          marginBottom: 8,
        }}
      >
        <div>
          <Stat label="charges" value={chargeCount} danger={chargeCount > 1} />
          {chargeCount > 1 && (
            <div style={{ fontSize: 10, color: "var(--color-danger)", marginTop: 2 }}>double charge!</div>
          )}
        </div>
        <Stat label="emails" value={emailCount} />
      </div>

      <div style={{ marginBottom: 10 }}>
        <EventLog lines={recentLog} caption={liveCaption} />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          paddingTop: 8,
          borderTop: "1px solid var(--color-rule)",
          alignItems: "flex-start",
        }}
      >
        <VizButton variant="primary" disabled={!canStart} onClick={handleStart} title="Start the worker">
          Start
        </VizButton>

        <VizButton variant="danger" disabled={!canCrash} onClick={handleCrash} title="Crash the worker mid-flight">
          Crash worker
        </VizButton>

        <VizButton
          disabled={!canRestart}
          onClick={handleRestart}
          title="Restart a dead worker (naive retry from scratch)"
        >
          Restart worker
        </VizButton>

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
            paused={effectivePaused}
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
        <p style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 4, fontStyle: "italic" }}>
          Stepped mode active (prefers-reduced-motion). Use Step or action buttons to advance.
        </p>
      )}
    </div>
  );
}
