import { useCallback, useEffect, useRef, useState } from "react";
import { createMvccSim, DISK_PAGE_CAP, HORIZON_AGE_DANGER } from "../sim/mvccSim";
import type { MvccSim, MvccSnapshot } from "../sim/mvccSim";
import { HeapDiagram } from "./HeapDiagram";
import { MvccControls } from "./MvccControls";
import { useReducedMotion, useSimLoop, Legend, Stat, EventLog } from "../../../../lib/viz";

const SEED = 0x5eed_c0de;

const LEGEND_ITEMS = [
  { color: "var(--color-ok)", glyph: "●", label: "live (current version)" },
  { color: "var(--color-pending)", glyph: "◆", label: "dead, pinned by horizon" },
  { color: "var(--color-dead)", glyph: "✕", label: "dead, removable" },
  { color: "var(--color-entity)", glyph: "▢", label: "visible to held snapshot" },
  { color: "var(--color-muted)", glyph: "·", label: "free slot" },
];

function initialSim(): MvccSim {
  return createMvccSim(SEED);
}

function simCaption(snap: MvccSnapshot): string {
  if (snap.diskFull) {
    return `table at ${DISK_PAGE_CAP}-page cap — updates refused; ${snap.deadPinned} dead tuples pinned by oldest xmin ${snap.horizonXid}`;
  }
  if (snap.longTxn) {
    return `snapshot xmin ${snap.longTxn.snapshotXmin} held for ${snap.longTxn.heldForXids} xids — ${snap.deadPinned} dead tuples pinned, bloat ${snap.bloatRatio.toFixed(1)}×`;
  }
  if (snap.lastVacuum) {
    return `last vacuum removed ${snap.lastVacuum.removed}, kept ${snap.lastVacuum.kept} (oldest xmin ${snap.lastVacuum.oldestXmin}); ${snap.pageCount} pages, bloat ${snap.bloatRatio.toFixed(1)}×`;
  }
  return `${snap.liveCount} live, ${snap.deadTotal} dead tuples on ${snap.pageCount} pages`;
}

export default function MvccViz() {
  const simRef = useRef<MvccSim>(initialSim());
  // Reading simRef.current in a useState lazy initializer trips react-hooks/refs;
  // same two-instance pattern as the other explainers (the second sim only
  // supplies the initial snapshot and is deterministically identical).
  const [snap, setSnap] = useState<MvccSnapshot>(() => createMvccSim(SEED).snapshot());
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

  const handleUpdate = useCallback(() => {
    simRef.current.update();
    takeSnap();
  }, [takeSnap]);

  const handleVacuum = useCallback(() => {
    simRef.current.vacuum();
    takeSnap();
  }, [takeSnap]);

  const handleToggleLongTxn = useCallback(() => {
    if (simRef.current.snapshot().longTxn) simRef.current.closeLongTxn();
    else simRef.current.openLongTxn();
    takeSnap();
  }, [takeSnap]);

  const handleToggleAutoUpdate = useCallback(() => {
    simRef.current.setAutoUpdate(!snap.autoUpdate);
    takeSnap();
  }, [snap.autoUpdate, takeSnap]);

  const handleToggleAutoVacuum = useCallback(() => {
    simRef.current.setAutoVacuum(!snap.autoVacuum);
    takeSnap();
  }, [snap.autoVacuum, takeSnap]);

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
  const txnOpen = snap.longTxn !== null;

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
        <span>HEAP ({DISK_PAGE_CAP}-PAGE DISK)</span>
        {txnOpen && (
          <span style={{ color: "var(--color-entity)", fontWeight: 600 }}>
            snapshot xmin {snap.longTxn!.snapshotXmin} held
          </span>
        )}
        {snap.diskFull && (
          <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>disk full — updates refused</span>
        )}
      </div>

      <HeapDiagram snap={snap} />

      {/* Latest vs snapshot view, per row */}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexWrap: "wrap",
          gap: "2px 14px",
          fontSize: 10,
          color: "var(--color-muted)",
        }}
      >
        {snap.rows.map((r) => (
          <span key={r.rowId} style={{ whiteSpace: "nowrap" }}>
            r{r.rowId} <span style={{ color: "var(--color-ink)", fontWeight: 600 }}>v{r.latestVersion}</span>
            {r.snapshotVersion !== null && (
              <span style={{ color: "var(--color-entity)" }}> · txn sees v{r.snapshotVersion}</span>
            )}
          </span>
        ))}
      </div>

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
        <Stat label="pages" value={`${snap.pageCount}/${DISK_PAGE_CAP}`} danger={snap.diskFull} />
        <Stat label="bloat" value={`${snap.bloatRatio.toFixed(1)}×`} danger={snap.bloatRatio >= 3} />
        <Stat label="dead removable" value={snap.deadRemovable} />
        <Stat label="dead pinned" value={snap.deadPinned} danger={snap.deadPinned >= 12} />
        <Stat label="oldest xmin" value={snap.horizonXid} />
        <Stat
          label="horizon age"
          value={`${snap.horizonAgeXids} xids`}
          danger={snap.horizonAgeXids >= HORIZON_AGE_DANGER}
        />
        <Stat label="next xid" value={snap.nextXid} />
        <Stat label="dead / autovac at" value={`${snap.deadTotal} / ${snap.autovacuumThreshold}`} />
      </div>

      <div style={{ marginTop: 8 }}>
        <Legend items={LEGEND_ITEMS} />
      </div>

      <div style={{ marginTop: 8 }}>
        {/* caption="" keeps EventLog's internal aria-live region silent — the
            island's single live region above announces all state changes */}
        <EventLog lines={recentLog} caption="" />
      </div>

      <MvccControls
        snap={snap}
        paused={paused}
        speed={speed}
        reducedMotion={reducedMotion}
        onUpdate={handleUpdate}
        onVacuum={handleVacuum}
        onToggleLongTxn={handleToggleLongTxn}
        onToggleAutoUpdate={handleToggleAutoUpdate}
        onToggleAutoVacuum={handleToggleAutoVacuum}
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
