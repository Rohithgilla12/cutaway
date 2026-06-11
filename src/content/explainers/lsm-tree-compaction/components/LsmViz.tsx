import { useCallback, useEffect, useRef, useState } from "react";
import { createLsmSim, MEMTABLE_FLUSH_THRESHOLD } from "../sim/lsmSim";
import type { LsmSim, LsmSnapshot } from "../sim/lsmSim";
import { LevelDiagram, MAX_L0_ROWS } from "./LevelDiagram";
import { ReadPathPanel } from "./ReadPath";
import { LsmControls } from "./LsmControls";
import { useReducedMotion, useSimLoop, Legend, Stat, EventLog } from "../../../../lib/viz";

const SEED = 0x1a8b_3ee3;

const LEGEND_ITEMS = [
  { color: "var(--color-ok)", glyph: "●", label: "value hit" },
  { color: "var(--color-danger)", glyph: "◆", label: "tombstone hit" },
  { color: "var(--color-dead)", glyph: "✕", label: "miss" },
  { color: "var(--color-entity)", glyph: "▬", label: "memtable / L0" },
  { color: "var(--color-ok)", glyph: "▬", label: "L1" },
  { color: "var(--color-danger)", glyph: "▪", label: "table holds tombstones" },
  { color: "var(--color-pending)", glyph: "▣", label: "compaction pressure" },
];

function initialSim(): LsmSim {
  return createLsmSim(SEED);
}

function simCaption(snap: LsmSnapshot): string {
  if (snap.compactionPressure) {
    return `L0 has ${snap.l0FileCount} files — compaction pressure. readAmp last=${snap.readAmplificationLast}`;
  }
  if (snap.lastReadPath) {
    return `read ${snap.lastReadPath.key}: ${snap.lastReadPath.probes.length} probes, outcome=${snap.lastReadPath.outcome}`;
  }
  return `L0: ${snap.l0FileCount} files · L1: ${snap.l1FileCount} files · tombstones: ${snap.tombstoneCount}`;
}

export default function LsmViz() {
  const simRef = useRef<LsmSim>(initialSim());
  // Reading simRef.current in a useState lazy initializer trips react-hooks/refs;
  // same two-instance pattern as WalViz (second sim only supplies the initial
  // snapshot and is deterministically identical — same seed, same init).
  const [snap, setSnap] = useState<LsmSnapshot>(() => createLsmSim(SEED).snapshot());
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

  const handleWrite = useCallback(() => {
    simRef.current.writeRandom();
    takeSnap();
  }, [takeSnap]);

  const handleDelete = useCallback(() => {
    simRef.current.deleteRandom();
    takeSnap();
  }, [takeSnap]);

  const handleRead = useCallback(() => {
    simRef.current.get();
    takeSnap();
  }, [takeSnap]);

  const handleFlush = useCallback(() => {
    simRef.current.flush();
    takeSnap();
  }, [takeSnap]);

  const handleCompact = useCallback(() => {
    simRef.current.compact();
    takeSnap();
  }, [takeSnap]);

  const handleToggleAutoWrite = useCallback(() => {
    simRef.current.setAutoWrite(!snap.autoWrite);
    takeSnap();
  }, [snap.autoWrite, takeSnap]);

  const handleToggleAutoFlush = useCallback(() => {
    simRef.current.setAutoFlush(!snap.autoFlush);
    takeSnap();
  }, [snap.autoFlush, takeSnap]);

  const handleToggleAutoCompact = useCallback(() => {
    simRef.current.setAutoCompact(!snap.autoCompact);
    takeSnap();
  }, [snap.autoCompact, takeSnap]);

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

  const caption = simCaption(snap);
  const recentLog = snap.eventLog.slice(-6);

  const memTableTombstones = snap.memtable.filter((e) => e.tombstone).length;
  const l0Entries = snap.l0.reduce((s, t) => s + t.entryCount, 0);
  const l0Tombstones = snap.l0.reduce((s, t) => s + t.tombstoneCount, 0);
  const l1Entries = snap.l1.reduce((s, t) => s + t.entryCount, 0);

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption}
      </div>

      {/* Level label row */}
      <div
        style={{
          display: "flex",
          gap: "0 24px",
          fontSize: 10,
          color: "var(--color-muted)",
          letterSpacing: "0.05em",
          marginBottom: 2,
          flexWrap: "wrap",
        }}
      >
        <span>MEMTABLE</span>
        <span>L0 (overlapping)</span>
        <span>L1 (sorted, non-overlapping)</span>
        {snap.compactionPressure && (
          <span
            style={{
              color: "var(--color-pending)",
              fontWeight: 600,
            }}
          >
            compaction pressure
          </span>
        )}
      </div>

      <LevelDiagram snap={snap} />

      {/* Per-level detail chips */}
      <div
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          marginTop: 4,
          display: "flex",
          gap: "0 12px",
          flexWrap: "wrap",
          rowGap: 2,
        }}
      >
        <span>
          memtable {snap.memtable.length}/{MEMTABLE_FLUSH_THRESHOLD}
          {memTableTombstones > 0 ? ` (${memTableTombstones} tombstones)` : ""}
        </span>
        <span>·</span>
        <span>
          L0: {snap.l0FileCount} files ({l0Entries} entries
          {l0Tombstones > 0 ? `, ${l0Tombstones} tombstones` : ""})
          {snap.l0FileCount > MAX_L0_ROWS ? ` — drawing newest ${MAX_L0_ROWS}` : ""}
        </span>
        <span>·</span>
        <span>
          L1: {snap.l1FileCount} files ({l1Entries} entries)
        </span>
      </div>

      <div
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          marginTop: 3,
          fontStyle: "italic",
        }}
      >
        compaction merges ALL L0 with overlapping L1 here; real engines pick overlapping files only (event log reports
        genuine overlap counts)
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "6px 16px",
          marginTop: 10,
          padding: "8px 4px",
          borderTop: "1px solid var(--color-rule)",
          fontSize: 11,
        }}
      >
        <Stat
          label="readAmp last"
          value={snap.readAmplificationLast === 0 ? "—" : snap.readAmplificationLast}
          danger={snap.readAmplificationLast > 6}
        />
        <Stat
          label="readAmp avg"
          value={snap.readAmplificationAvg === 0 ? "—" : snap.readAmplificationAvg.toFixed(1)}
          danger={snap.readAmplificationAvg > 6}
        />
        <Stat label="writeAmp" value={snap.writeAmplification.toFixed(1)} />
        <Stat label="spaceAmp" value={snap.spaceAmplification.toFixed(1)} />
        <Stat label="tombstones" value={snap.tombstoneCount} danger={snap.tombstoneCount > 8} />
      </div>

      {/* Read path trace */}
      <ReadPathPanel path={snap.lastReadPath} />

      <div style={{ marginTop: 8 }}>
        <Legend items={LEGEND_ITEMS} />
      </div>

      <div style={{ marginTop: 8 }}>
        {/* caption="" keeps EventLog's internal aria-live region silent — the
            island's single live region above announces all state changes */}
        <EventLog lines={recentLog} caption="" />
      </div>

      <LsmControls
        snap={snap}
        paused={paused}
        speed={speed}
        reducedMotion={reducedMotion}
        onWrite={handleWrite}
        onDelete={handleDelete}
        onRead={handleRead}
        onFlush={handleFlush}
        onCompact={handleCompact}
        onToggleAutoWrite={handleToggleAutoWrite}
        onToggleAutoFlush={handleToggleAutoFlush}
        onToggleAutoCompact={handleToggleAutoCompact}
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
