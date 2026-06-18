import { useCallback, useEffect, useRef, useState } from "react";
import { createWraparoundSim, WRAP_SPACE, FREEZE_MAX_AGE, AGE_WARN, AGE_REFUSE } from "../sim/wraparoundSim";
import type { WraparoundSim, WraparoundSnapshot } from "../sim/wraparoundSim";
import { XidRing } from "./XidRing";
import { WraparoundControls } from "./WraparoundControls";
import { useReducedMotion, useSimLoop, Stat, EventLog } from "../../../../lib/viz";

const STATUS_LABEL: Record<WraparoundSnapshot["status"], string> = {
  healthy: "healthy",
  forcing: "forcing anti-wraparound vacuum",
  warning: "WARNING — wraparound approaching",
  refusing: "REFUSING WRITES — single-user recovery needed",
};

function caption(snap: WraparoundSnapshot): string {
  const pin = snap.pinnedXmin !== null ? `, snapshot pinned ${snap.pinnedForXids}M xids ago` : "";
  return `oldest xid age ${snap.age}M of ${WRAP_SPACE}M, ${snap.remaining}M to wraparound — ${STATUS_LABEL[snap.status]}${pin}`;
}

function ProgressBar({ snap }: { snap: WraparoundSnapshot }) {
  const pct = (v: number) => `${Math.min((v / WRAP_SPACE) * 100, 100)}%`;
  const fillColor =
    snap.status === "refusing"
      ? "var(--color-danger)"
      : snap.status === "warning" || snap.status === "forcing"
        ? "var(--color-pending)"
        : "var(--color-ok)";
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ position: "relative", height: 14, background: "var(--color-rule)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: pct(snap.age), background: fillColor }} />
        {[
          { v: FREEZE_MAX_AGE, c: "var(--color-pending)" },
          { v: AGE_WARN, c: "var(--color-danger)" },
          { v: AGE_REFUSE, c: "var(--color-danger)" },
        ].map(({ v, c }) => (
          <div key={v} style={{ position: "absolute", top: 0, bottom: 0, left: pct(v), width: 1.5, background: c }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--color-muted)", marginTop: 1 }}>
        <span>relfrozenxid</span>
        <span>force 200M</span>
        <span>2^31 ≈ {WRAP_SPACE}M</span>
      </div>
    </div>
  );
}

export default function WraparoundViz() {
  const simRef = useRef<WraparoundSim>(createWraparoundSim());
  const [snap, setSnap] = useState<WraparoundSnapshot>(() => createWraparoundSim().snapshot());
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

  const act = useCallback(
    (fn: (s: WraparoundSim) => void) => {
      fn(simRef.current);
      takeSnap();
    },
    [takeSnap],
  );

  const status = snap.status;
  const dangerStatus = status === "warning" || status === "refusing" || status === "forcing";

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption(snap)}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: "0 0 auto" }}>
          <XidRing snap={snap} />
        </div>

        <div style={{ flex: "1 1 220px", minWidth: 200 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: dangerStatus ? (status === "refusing" ? "var(--color-danger)" : "var(--color-pending)") : "var(--color-ok)",
              marginBottom: 6,
            }}
          >
            {STATUS_LABEL[status]}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "6px 14px",
              fontSize: 11,
            }}
          >
            <Stat label="nextXid" value={`${snap.nextXid}M`} />
            <Stat label="relfrozenxid" value={`${snap.relfrozenXid}M`} />
            <Stat label="oldest xid age" value={`${snap.age}M`} danger={snap.age >= FREEZE_MAX_AGE} />
            <Stat label="to wraparound" value={`${snap.remaining}M`} danger={snap.remaining <= WRAP_SPACE - AGE_WARN} />
            {snap.pinnedXmin !== null && <Stat label="snapshot pinned at" value={`${snap.pinnedXmin}M`} danger />}
            {snap.pinnedXmin !== null && <Stat label="held for" value={`${snap.pinnedForXids}M xids`} danger />}
          </div>

          <ProgressBar snap={snap} />
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <EventLog lines={snap.eventLog.slice(-5)} caption="" />
      </div>

      <WraparoundControls
        snap={snap}
        paused={paused}
        speed={speed}
        reducedMotion={reducedMotion}
        onBurn={() => act((s) => s.burnXids(100))}
        onFreeze={() => act((s) => s.freeze())}
        onTogglePin={() => act((s) => (snap.pinnedXmin !== null ? s.releaseSnapshot() : s.pinSnapshot()))}
        onToggleWorkload={() => act((s) => s.setWorkload(!snap.workload))}
        onToggleAutoVacuum={() => act((s) => s.setAutoVacuum(!snap.autoVacuum))}
        onTogglePause={() => setPaused((p) => !p)}
        onStep={() => act((s) => s.step(250))}
        onReset={() => act((s) => s.reset())}
        onSpeedChange={(s) => setSpeed(s as 0.5 | 1 | 2)}
      />

      {reducedMotion && (
        <p style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 4, fontStyle: "italic" }}>
          Stepped mode active (prefers-reduced-motion). Use Burn / VACUUM FREEZE / Step to advance.
        </p>
      )}
    </div>
  );
}
