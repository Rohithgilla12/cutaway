import { useCallback, useEffect, useRef, useState } from "react";
import { createIsolationSim } from "../sim/isolationSim";
import type { IsolationLevel, IsolationSim, IsolationSnapshot, ScenarioId, TxnId } from "../sim/isolationSim";
import { TxnColumn, TXN_ACCENT } from "./TxnColumn";
import { DatabasePanel } from "./DatabasePanel";
import { DependencyGraph } from "./DependencyGraph";
import { IsolationControls } from "./IsolationControls";
import { useReducedMotion, useSimLoop, EventLog } from "../../../../lib/viz";

const START: ScenarioId = "write-skew";

function caption(snap: IsolationSnapshot): string {
  if (snap.anomaly) {
    return `${snap.scenarioTitle} at ${snap.level}: ${snap.anomaly.text}`;
  }
  return `${snap.scenarioTitle} at ${snap.level} — stepping the interleaving`;
}

export default function IsolationViz() {
  const simRef = useRef<IsolationSim>(createIsolationSim(START));
  const [snap, setSnap] = useState<IsolationSnapshot>(() => createIsolationSim(START).snapshot());
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  const takeSnap = useCallback(() => setSnap(simRef.current.snapshot()), []);
  const stepSim = useCallback((dtMs: number) => simRef.current.step(dtMs), []);

  useSimLoop({ step: stepSim, onFrame: takeSnap, speed, paused, reducedMotion, rootRef });

  const stepTxn = useCallback(
    (id: TxnId) => {
      simRef.current.setAutoPlay(false);
      simRef.current.stepTxn(id);
      takeSnap();
    },
    [takeSnap],
  );

  const stepScript = useCallback(() => {
    simRef.current.scriptStep();
    takeSnap();
  }, [takeSnap]);

  const toggleAutoPlay = useCallback(() => {
    simRef.current.setAutoPlay(!simRef.current.snapshot().autoPlay);
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const setScenario = useCallback(
    (id: ScenarioId) => {
      simRef.current.setScenario(id);
      setPaused(false);
      takeSnap();
    },
    [takeSnap],
  );

  const setLevel = useCallback(
    (l: IsolationLevel) => {
      simRef.current.setLevel(l);
      setPaused(false);
      takeSnap();
    },
    [takeSnap],
  );

  const reset = useCallback(() => {
    simRef.current.reset();
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const showGraph = snap.level === "SER" && snap.edges.length > 0;

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption(snap)}
      </div>

      <p style={{ fontSize: 11, color: "var(--color-muted)", margin: "0 0 8px" }}>{snap.scenarioQuestion}</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
        <TxnColumn txn={snap.txns.T1} accent={TXN_ACCENT.T1} onStep={() => stepTxn("T1")} />
        <TxnColumn txn={snap.txns.T2} accent={TXN_ACCENT.T2} onStep={() => stepTxn("T2")} />
      </div>

      <div style={{ marginTop: 10 }}>
        <DatabasePanel snap={snap} />
      </div>

      {showGraph && (
        <div style={{ marginTop: 10 }}>
          <DependencyGraph edges={snap.edges} />
        </div>
      )}

      {snap.anomaly && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 3,
            border: `1px solid ${snap.anomaly.happened ? "var(--color-danger)" : "var(--color-ok)"}`,
            background: "var(--color-paper)",
            fontSize: 12,
          }}
        >
          <span
            style={{
              fontWeight: 700,
              color: snap.anomaly.happened ? "var(--color-danger)" : "var(--color-ok)",
            }}
          >
            {snap.anomaly.happened ? "✕ anomaly" : "✓ no anomaly"}
          </span>{" "}
          <span style={{ color: "var(--color-ink)" }}>{snap.anomaly.text}</span>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <EventLog lines={snap.eventLog.slice(-5)} caption="" />
      </div>

      <div style={{ marginTop: 8 }}>
        <IsolationControls
          snap={snap}
          paused={paused}
          speed={speed}
          reducedMotion={reducedMotion}
          onSetScenario={setScenario}
          onSetLevel={setLevel}
          onToggleAutoPlay={toggleAutoPlay}
          onTogglePause={() => setPaused((p) => !p)}
          onStepScript={stepScript}
          onReset={reset}
          onSpeedChange={(s) => setSpeed(s as 0.5 | 1 | 2)}
        />
      </div>

      {reducedMotion && (
        <p style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 4, fontStyle: "italic" }}>
          Stepped mode active (prefers-reduced-motion). Use the per-transaction Run buttons or Step script to advance.
        </p>
      )}
    </div>
  );
}
